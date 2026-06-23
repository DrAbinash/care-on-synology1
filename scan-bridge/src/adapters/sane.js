// SANE (Scanner Access Now Easy) adapter for Linux / macOS.
// Uses the system `scanimage` command (from sane-backends package).
//
// REAL DEPLOYMENT:
// 1. Install sane-backends:  sudo apt-get install sane-backends  (Debian/Ubuntu)
//                            sudo dnf install sane-backends     (Fedora)
//                            brew install sane-backends         (macOS)
// 2. Verify scanner is detected:  scanimage -L
// 3. Run the bridge with BRIDGE_SCAN_VENDOR=sane
//
// TROUBLESHOOTING:
// - "scanimage: no SANE devices found": Check USB connection / driver.
// - Permission denied on /dev/bus/usb: Add user to scanner group: sudo usermod -aG scanner $USER
// - macOS: You may need to install sane-backends via Homebrew and add the binary to PATH.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DPI = Number(process.env.SANE_DPI ?? "300");
const MODE = process.env.SANE_MODE ?? "Color"; // Color | Gray | Lineart

function execAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

export default {
  name: "sane",
  async status() {
    try {
      const { stdout } = await execAsync("scanimage", ["-L"]);
      const lines = stdout.split("\n").filter((l) => l.includes("device "));
      return {
        deviceConnected: lines.length > 0,
        deviceCount: lines.length,
        devices: lines,
        type: "sane",
      };
    } catch (e) {
      return { deviceConnected: false, error: e.message, type: "sane" };
    }
  },

  async scan() {
    const outPath = join(tmpdir(), `scan-${Date.now()}.png`);
    try {
      await execAsync("scanimage", [
        "--format=png",
        `--resolution=${DPI}`,
        `--mode=${MODE}`,
        `--output-file=${outPath}`,
      ]);
      const buffer = await fs.readFile(outPath);
      await fs.unlink(outPath).catch(() => {});
      return {
        imageBase64: buffer.toString("base64"),
        mimeType: "image/png",
      };
    } catch (e) {
      throw new Error(`SANE scan failed: ${e.message}`);
    }
  },
};
