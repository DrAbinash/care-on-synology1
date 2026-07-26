// Windows Image Acquisition (WIA) adapter — GENERIC for any scanner brand.
// Uses an embedded PowerShell script to trigger scanning via the WIA COM API.
// Works with any WIA-compatible flatbed or document-feeder (Canon, HP, Epson, Brother, Fujitsu, etc.).
//
// REAL DEPLOYMENT:
// 1. Ensure the scanner driver is installed and visible in Windows Fax and Scan.
// 2. Run the bridge with BRIDGE_SCAN_VENDOR=wia
// 3. If you have multiple scanners, set WIA_DEVICE_INDEX (1-based) to pick one.
// 4. If direct WIA fails, fall back to folder-watch mode:
//    BRIDGE_SCAN_VENDOR=folder-watch SCAN_WATCH_FOLDER="C:\\Scans"
//
// TROUBLESHOOTING:
// - "No WIA devices found": Install the scanner driver or check USB connection.
// - "Scanner is busy": Another app is using the scanner. Close it and retry.
// - "Driver does not support direct WIA scan": The scanner vendor blocked programmatic access.
//   Switch to folder-watch mode (see README).
// - Wrong scanner selected: Set WIA_DEVICE_INDEX env var, or call /devices to see the list.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEVICE_INDEX = Number(process.env.WIA_DEVICE_INDEX ?? "1");
const DPI = Number(process.env.WIA_DPI ?? "300");
const COLOR_MODE = Number(process.env.WIA_COLOR_MODE ?? "1"); // 1 = Color, 2 = Grayscale, 4 = B&W

// ── PowerShell: enumerate all WIA devices ───────────────────────────────────
const PS_DEVICES = `
try {
  $dm = New-Object -ComObject WIA.DeviceManager
  $devices = @()
  for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
    $name = $dm.DeviceInfos.Item($i).Properties("Name").Value
    $devices += "{ \"index\": $i, \"name\": \"$name\" }"
  }
  if ($devices.Count -eq 0) {
    Write-Output "[]"
  } else {
    Write-Output ("[" + ($devices -join ",") + "]")
  }
} catch {
  Write-Output "[]"
}`;

function execAsync(command, args, timeout = 60000, windowsHide = true) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

function classifyError(msg) {
  const m = msg.toLowerCase();
  if (m.includes("no wia devices found") || m.includes("device infos.count") || m.includes("count -eq 0")) {
    const err = new Error("No WIA scanner found. Check USB connection and that the driver is installed.");
    err.code = "WIA_NO_DEVICE";
    return err;
  }
  if (m.includes("scanner is busy") || m.includes("busy") || m.includes("in use") || m.includes("0x80210006") || m.includes("0x8021000a") || m.includes("already in use") || m.includes("another app")) {
    const err = new Error("Scanner is busy. Close any other scanning software and retry.");
    err.code = "WIA_DEVICE_BUSY";
    return err;
  }
  if (m.includes("driver does not support") || m.includes("not supported") || m.includes("unsupported") || m.includes("0x80210015") || m.includes("0x8021000d") || m.includes("specified cast is not valid")) {
    const err = new Error("Scanner driver does not support direct WIA scan. Use folder-watch mode instead: set BRIDGE_SCAN_VENDOR=folder-watch and SCAN_WATCH_FOLDER to your scanner software's output folder.");
    err.code = "WIA_UNSUPPORTED_DRIVER";
    return err;
  }
  const err = new Error(`WIA scan failed: ${msg}`);
  err.code = "WIA_SCAN_FAILED";
  return err;
}

function buildPsScanScript(outputPath, deviceIndex, dpi, colorMode) {
  // Values are embedded directly — no param() block, so no parameter passing issues.
  // NOTE: PowerShell comments are '#', not '//'. Using '//' here previously made
  // the script a parse/cast failure ("Specified cast is not valid").
  const safePath = outputPath.replace(/'/g, "''");
  return `
$OutputPath = '${safePath}'
$DeviceIndex = ${deviceIndex}
$DPI = ${dpi}
$ColorMode = ${colorMode}
$ErrorActionPreference = "Stop"

# wiaFormatJPEG / wiaFormatBMP GUIDs
$wiaFormatJPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"

try {
  $deviceManager = New-Object -ComObject WIA.DeviceManager
  if ($deviceManager.DeviceInfos.Count -eq 0) {
    Write-Error "No WIA devices found"
    exit 1
  }
  if ($DeviceIndex -gt $deviceManager.DeviceInfos.Count -or $DeviceIndex -lt 1) { $DeviceIndex = 1 }
  $deviceInfo = $deviceManager.DeviceInfos.Item($DeviceIndex)
  $device = $deviceInfo.Connect()
  $item = $device.Items.Item(1)

  # Best-effort DPI via WIA property IDs (6147 = Horizontal, 6148 = Vertical
  # Resolution; 6146 = Current Intent). Numeric IDs are far more reliable than
  # string names across drivers. Each set is wrapped so a rejection never aborts
  # the scan.
  foreach ($propId in 6147, 6148) {
    try { $item.Properties.Item($propId).Value = $DPI } catch { }
  }
  try { $item.Properties.Item(6146).Value = $ColorMode } catch { }

  # Transfer as JPEG. Passing the format GUID stops the driver returning a raw
  # type (BMP/TIFF) that then fails to cast/save. If the driver rejects an
  # explicit format, retry with its default and convert to JPEG below.
  $image = $null
  try {
    $image = $item.Transfer($wiaFormatJPEG)
  } catch {
    try { $image = $item.Transfer() } catch { }
  }

  if ($null -eq $image) {
    Write-Error "Transfer failed: the scanner driver does not support direct WIA scan. Use folder-watch mode instead."
    exit 1
  }

  # If it came back as something other than JPEG, convert it so SaveFile writes a
  # real JPEG (not BMP bytes in a .jpg).
  try {
    if ($image.FormatID -ne $wiaFormatJPEG) {
      $conv = New-Object -ComObject WIA.ImageProcess
      $conv.Filters.Add($conv.FilterInfos.Item("Convert").FilterID)
      $conv.Filters.Item($conv.Filters.Count).Properties.Item("FormatID").Value = $wiaFormatJPEG
      $image = $conv.Apply($image)
    }
  } catch { }

  if (Test-Path $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue }
  $image.SaveFile($OutputPath)
  Write-Output "OK"
} catch {
  $msg = $_.Exception.Message
  if ($msg -match "busy|in use|0x80210006|0x8021000A|already in use|another app") {
    Write-Error "Scanner is busy"
  } elseif ($msg -match "0x80210015|0x8021000D|not supported|unsupported") {
    Write-Error "Driver does not support direct WIA scan"
  } else {
    Write-Error $msg
  }
  exit 1
}`;
}

export default {
  name: "wia",

  async devices() {
    try {
      const { stdout } = await execAsync("powershell", [
        "-ExecutionPolicy", "Bypass",
        "-Command",
        PS_DEVICES,
      ], 15000);
      const devices = JSON.parse(stdout.trim() || "[]");
      return { devices };
    } catch (e) {
      return { devices: [], error: e.message };
    }
  },

  async status() {
    try {
      const { devices } = await this.devices();
      const selected = devices.find((d) => d.index === DEVICE_INDEX);
      return {
        deviceConnected: devices.length > 0,
        deviceCount: devices.length,
        deviceIndex: DEVICE_INDEX,
        selectedDevice: selected?.name || null,
        devices: devices.map((d) => ({ index: d.index, name: d.name })),
        type: "wia",
        dpi: DPI,
      };
    } catch (e) {
      return { deviceConnected: false, error: e.message, type: "wia" };
    }
  },

  async scan() {
    const outPath = join(tmpdir(), `scan-${Date.now()}.jpg`);
    const psScript = buildPsScanScript(outPath, DEVICE_INDEX, DPI, COLOR_MODE);
    const psPath = join(tmpdir(), `scan-${Date.now()}.ps1`);
    try {
      await fs.writeFile(psPath, psScript, "utf8");
      // windowsHide=false so the WIA CommonDialog.ShowTransfer() scanner dialog can appear.
      await execAsync("powershell", [
        "-ExecutionPolicy", "Bypass",
        "-File", psPath,
      ], 60000, false);
      const buffer = await fs.readFile(outPath);
      await fs.unlink(outPath).catch(() => {});
      const filename = outPath.split("\\").pop()?.split("/").pop() ?? "scan.jpg";
      return {
        ok: true,
        imageBase64: buffer.toString("base64"),
        mimeType: "image/jpeg",
        filename,
      };
    } catch (e) {
      throw classifyError(e.message || "");
    } finally {
      await fs.unlink(psPath).catch(() => {});
    }
  },
};
