/**
 * ScannerSetupHelp — a small "Set up scanner" shortcut for Form F's ID-capture
 * panel. It explains the one-time reception-PC setup for the local Scanner
 * Bridge (so a flatbed scanner appears under "Existing Scanner"), shows the
 * live detected/not-detected status, and links to Scanner Settings.
 *
 * The heavy lifting is done by scan-bridge/install-windows.ps1 on the
 * workstation; this dialog just guides staff to it and confirms when it worked.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Wrench, Settings2, CheckCircle2, Copy, Check, ExternalLink, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ScannerSetupHelp({ online }: { online: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const erp = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://caredeoghar.com";
  // Served from the ERP's public assets (BASE_URL is "/erp/" in production).
  const installerUrl = `${import.meta.env.BASE_URL}scanner/install-scan-bridge.ps1`;

  function copyErp() {
    try {
      navigator.clipboard?.writeText(erp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — the value is visible to type manually */ }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-violet-700 hover:underline"
      >
        <Wrench size={11} /> Set up scanner
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-base">
              <Wrench size={16} className="text-violet-600" /> Set up the workstation scanner
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {/* Live status */}
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                online
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-400"}`} />
              {online
                ? "Scanner bridge detected on this PC — you're all set."
                : "Not detected on this PC. Do the one-time setup below."}
            </div>

            <p className="text-xs text-gray-600">
              A flatbed scanner plugs into this reception PC, so a tiny helper (the
              "Scanner Bridge") must run here for the browser to reach it. One-time setup:
            </p>

            <ol className="space-y-2 text-xs text-gray-700">
              <li className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-semibold flex items-center justify-center">1</span>
                <span>
                  Install <b>Node.js LTS</b> —{" "}
                  <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline inline-flex items-center gap-0.5">
                    nodejs.org <ExternalLink size={10} />
                  </a>{" "}
                  (one time per PC).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-semibold flex items-center justify-center">2</span>
                <span>Download the installer below, then right-click it → <b>Run with PowerShell</b>. It sets everything up on its own — no folder to copy.</span>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-semibold flex items-center justify-center">3</span>
                <span className="min-w-0">
                  When it asks for the ERP address, enter:
                  <span className="mt-1 flex items-center gap-1.5">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[11px] truncate">{erp}</code>
                    <button type="button" onClick={copyErp} className="inline-flex items-center gap-0.5 text-[10px] text-violet-600 hover:underline shrink-0">
                      {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? "Copied" : "Copy"}
                    </button>
                  </span>
                </span>
              </li>
            </ol>

            <a
              href={installerUrl}
              download="install-scan-bridge.ps1"
              className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Download size={16} /> Download installer (install-scan-bridge.ps1)
            </a>
            <p className="text-[10px] text-gray-400 -mt-1">
              If Windows blocks it: right-click the file → <b>Properties</b> → tick <b>Unblock</b> → OK, then run it.
            </p>

            <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />
              The installer auto-starts the bridge on every logon. Works with any scanner in
              Windows "Fax &amp; Scan" (WIA), or your scanner's own software via folder-watch.
              This tab turns <b className="text-emerald-700">Online</b> automatically when it's ready.
            </p>

            <div className="flex justify-between items-center pt-1 border-t">
              <Link href="/settings/scanner" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline">
                <Settings2 size={13} /> Scanner Settings
              </Link>
              <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">
                Done
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
