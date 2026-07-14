/**
 * ScannerSettings.tsx — Admin/owner-only page holding the technical scanner
 * options moved OUT of the reception-facing UnifiedScanCapture dialog per
 * the scanner-overhaul plan: bridge base URL override, workstation-pairing
 * secret, and a live bridge health/diagnostics readout.
 *
 * This intentionally does NOT expose scan-bridge's env-var-level adapter
 * config (BRIDGE_SCAN_VENDOR, WIA_DEVICE_INDEX, etc.) — those stay
 * workstation-local env vars set when starting the bridge process, since
 * they're per-machine hardware config, not something to sync through the
 * ERP's central settings. What IS useful centrally: the URL/secret the
 * browser uses to reach whichever bridge is running locally, and a way to
 * verify it's actually working without digging through browser devtools.
 */
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  checkScanBridgeHealth,
  getScanBridgeSecret,
  getScanBridgeUrl,
  setScanBridgeSecret,
  setScanBridgeUrl,
  type ScanBridgeHealth,
} from "@/lib/scanBridgeClient";

export default function ScannerSettings() {
  const { toast } = useToast();
  const [bridgeUrl, setBridgeUrlInput] = useState(getScanBridgeUrl());
  const [bridgeSecret, setBridgeSecretInput] = useState(getScanBridgeSecret());
  const [health, setHealth] = useState<ScanBridgeHealth | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    try {
      const result = await checkScanBridgeHealth();
      setHealth(result);
    } finally {
      setTesting(false);
    }
  }

  function save() {
    setScanBridgeUrl(bridgeUrl.trim() || "http://127.0.0.1:8766");
    setScanBridgeSecret(bridgeSecret.trim());
    toast({ title: "Scanner settings saved", description: "Applies to this workstation only." });
    void runTest();
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader title="Scanner Settings" subtitle="Technical scanner bridge configuration for this workstation" />

      <div className="border rounded-xl p-5 space-y-4 bg-card">
        <div>
          <h3 className="text-sm font-semibold mb-1">Scanner Bridge</h3>
          <p className="text-xs text-muted-foreground">
            The Scanner Bridge is a small local app that runs on each reception workstation and lets the browser
            talk to a physically connected scanner (Canon flatbed/ADF, or the TVS PDS 8M). These settings are
            saved per-browser (this computer only) — every workstation configures its own.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bridge-url">Bridge URL</Label>
          <Input id="bridge-url" value={bridgeUrl} onChange={(e) => setBridgeUrlInput(e.target.value)} placeholder="http://127.0.0.1:8766" />
          <p className="text-[11px] text-muted-foreground">Default is correct for almost every setup — only change this if you've moved the bridge to a non-default port.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bridge-secret">Workstation Secret (optional)</Label>
          <Input id="bridge-secret" type="password" value={bridgeSecret} onChange={(e) => setBridgeSecretInput(e.target.value)} placeholder="Leave blank unless your bridge requires one" />
          <p className="text-[11px] text-muted-foreground">
            Only needed if this workstation's bridge was started with <code className="text-[10px] bg-muted px-1 rounded">BRIDGE_REQUIRE_AUTH=true</code>.
            Must match the bridge's <code className="text-[10px] bg-muted px-1 rounded">ERP_BRIDGE_SECRET</code> env var exactly.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} size="sm">Save &amp; Test</Button>
          <Button onClick={runTest} variant="outline" size="sm" disabled={testing} className="gap-1.5">
            {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Test Connection
          </Button>
        </div>

        {health && (
          <div className={`rounded-lg border p-3 text-xs space-y-1 ${health.state === "ok" ? "border-green-200 bg-green-50/40" : "border-amber-200 bg-amber-50/40"}`}>
            <div className="flex items-center gap-1.5 font-semibold">
              {health.state === "ok" ? <CheckCircle2 size={14} className="text-green-600" /> : <XCircle size={14} className="text-amber-600" />}
              {health.state === "ok" && "Bridge connected"}
              {health.state === "not-running" && "Bridge not detected"}
              {health.state === "blocked" && "Bridge reachable but request blocked"}
              {health.state === "device-error" && "Bridge running, device problem"}
            </div>
            {health.vendor && <div>Adapter: <span className="font-mono">{health.vendor}</span></div>}
            {health.corsConfigured === false && (
              <div className="text-amber-700">
                The bridge has no ERP origin allowlisted (BRIDGE_ALLOW_ORIGINS/ERP_BASE_URL unset on the bridge) —
                this is the most common cause of "Offline".
              </div>
            )}
            {health.authRequired && (
              <div className="flex items-center gap-1 text-muted-foreground"><ShieldCheck size={12} /> This bridge requires a workstation secret.</div>
            )}
            {health.error && <div className="text-muted-foreground">{health.error}</div>}
          </div>
        )}
      </div>

      <div className="border rounded-xl p-5 space-y-2 bg-card">
        <h3 className="text-sm font-semibold">Reception scan options</h3>
        <p className="text-xs text-muted-foreground">
          Reception staff see a simplified 4-option scan dialog (Existing Scanner, Upload, Mobile Scan, Webcam).
          Advanced bridge diagnostics live only on this page — reception never sees bridge URLs, ports, or vendor
          adapter names.
        </p>
        <Badge variant="outline" className="text-[10px]">TVS PDS 8M dedicated capture — arriving once verified on the reception workstation</Badge>
      </div>
    </div>
  );
}
