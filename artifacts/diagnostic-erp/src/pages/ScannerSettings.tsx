/**
 * ScannerSettings.tsx — Admin/owner-only page for scanner preferences and
 * workstation-local bridge/TVS setup. Linked from Form F's ID Scan panel
 * ("Scanner Settings").
 *
 * Clinic-wide: Preferred Scanning Source (webcam / flatbed / mobile) — which
 * tab Form F opens by default. Workstation-local: bridge URL/secret and TVS
 * device binding (saved in this browser only).
 *
 * Env-var-level adapter config (BRIDGE_SCAN_VENDOR, WIA_DEVICE_INDEX, etc.)
 * stays on the bridge process — per-machine hardware, not ERP settings.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { CheckCircle2, XCircle, Loader2, RefreshCcw, ShieldCheck, Camera } from "lucide-react";
import {
  checkScanBridgeHealth,
  getScanBridgeSecret,
  getScanBridgeUrl,
  setScanBridgeSecret,
  setScanBridgeUrl,
  type ScanBridgeHealth,
} from "@/lib/scanBridgeClient";
import {
  clearPreferredTvsDevice,
  getPreferredTvsDeviceId,
  getPreferredTvsDeviceLabel,
  guessTvsDevice,
  setPreferredTvsDevice,
} from "@/lib/tvsDeviceProfile";
import { classifyCameraError } from "@/lib/cameraDiagnostics";

type PreferredScanner = "camera" | "bridge" | "mobile";

export default function ScannerSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [bridgeUrl, setBridgeUrlInput] = useState(getScanBridgeUrl());
  const [bridgeSecret, setBridgeSecretInput] = useState(getScanBridgeSecret());
  const [health, setHealth] = useState<ScanBridgeHealth | null>(null);
  const [testing, setTesting] = useState(false);

  // Clinic-wide default capture method for Form F's ID Scan panel.
  const { data: clinicSettings } = useQuery<{ preferredScanner?: string }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [preferredScanner, setPreferredScanner] = useState<PreferredScanner>("bridge");
  useEffect(() => {
    const v = clinicSettings?.preferredScanner;
    if (v === "camera" || v === "bridge" || v === "mobile") setPreferredScanner(v);
    else if (clinicSettings) setPreferredScanner("bridge");
  }, [clinicSettings]);
  const savePreferred = useMutation({
    mutationFn: (value: PreferredScanner) =>
      api.put("/api/clinic-settings", { preferredScanner: value }),
    onSuccess: (_data, value) => {
      setPreferredScanner(value);
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      toast({
        title: "Preferred scanning source saved",
        description: "Form F will open this tab by default. Other methods stay available.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    },
  });

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

  // ── TVS PDS 8M device binding ──
  // See tvsDeviceProfile.ts: the TVS PDS 8M is expected to appear as a plain
  // UVC webcam device (no vendor driver), so binding it is just "point a
  // live preview at each connected camera and let the admin confirm which
  // one is the TVS" — no automatic hardware detection is claimed here.
  const [tvsDevices, setTvsDevices] = useState<MediaDeviceInfo[]>([]);
  const [tvsPreviewId, setTvsPreviewId] = useState<string>("");
  const [tvsPreviewError, setTvsPreviewError] = useState<string | null>(null);
  const [tvsBoundId, setTvsBoundId] = useState(getPreferredTvsDeviceId());
  const [tvsBoundLabel, setTvsBoundLabel] = useState(getPreferredTvsDeviceLabel());
  const tvsVideoRef = useRef<HTMLVideoElement>(null);
  const tvsStreamRef = useRef<MediaStream | null>(null);
  const isSecureCameraContext = typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices;

  useEffect(() => {
    if (!isSecureCameraContext) return;
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => {
        const cams = devices.filter((d) => d.kind === "videoinput");
        setTvsDevices(cams);
        const guess = guessTvsDevice(cams);
        if (guess && !tvsPreviewId) setTvsPreviewId(guess.deviceId);
      })
      .catch(() => setTvsDevices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSecureCameraContext]);

  useEffect(() => {
    if (!tvsPreviewId) return;
    let cancelled = false;
    setTvsPreviewError(null);
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: tvsPreviewId } } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        tvsStreamRef.current?.getTracks().forEach((t) => t.stop());
        tvsStreamRef.current = stream;
        if (tvsVideoRef.current) {
          tvsVideoRef.current.srcObject = stream;
          void tvsVideoRef.current.play();
        }
      })
      .catch((e) => { if (!cancelled) setTvsPreviewError(classifyCameraError(e).message); });
    return () => {
      cancelled = true;
      tvsStreamRef.current?.getTracks().forEach((t) => t.stop());
      tvsStreamRef.current = null;
    };
  }, [tvsPreviewId]);

  function confirmTvsDevice() {
    const device = tvsDevices.find((d) => d.deviceId === tvsPreviewId);
    if (!device) return;
    const label = device.label || "TVS PDS 8M";
    setPreferredTvsDevice(device.deviceId, label);
    setTvsBoundId(device.deviceId);
    setTvsBoundLabel(label);
    toast({ title: "TVS PDS 8M bound", description: `"Scan with TVS PDS 8M" will now use: ${label}` });
  }

  function unbindTvsDevice() {
    clearPreferredTvsDevice();
    setTvsBoundId("");
    setTvsBoundLabel("");
    toast({ title: "TVS PDS 8M binding removed" });
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader title="Scanner Settings" subtitle="Form F ID scan defaults and workstation scanner setup" />

      <div className="border rounded-xl p-5 space-y-4 bg-card">
        <div>
          <h3 className="text-sm font-semibold mb-1">Preferred Scanning Source</h3>
          <p className="text-xs text-muted-foreground">
            Which capture method Form F opens by default on the ID Scan panel. All methods stay available as tabs.
            This is clinic-wide (shared by every workstation).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferred-scanner">Default method</Label>
          <Select
            value={preferredScanner}
            onValueChange={(v) => {
              if (v === "camera" || v === "bridge" || v === "mobile") {
                savePreferred.mutate(v);
              }
            }}
            disabled={savePreferred.isPending}
          >
            <SelectTrigger id="preferred-scanner" className="h-9 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bridge">Flatbed Scanner / ScanBridge (default)</SelectItem>
              <SelectItem value="camera">Webcam / TVS PDS 8M</SelectItem>
              <SelectItem value="mobile">Wireless Mobile Scan</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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

      <div className="border rounded-xl p-5 space-y-4 bg-card">
        <div>
          <h3 className="text-sm font-semibold mb-1">TVS PDS 8M</h3>
          <p className="text-xs text-muted-foreground">
            The TVS PDS 8M connects as a USB camera, not a traditional scanner — the browser can already see it once
            plugged in. This binding has <strong>not yet been physically verified</strong> against a real TVS PDS 8M;
            preview each camera below and confirm which one is actually the TVS before binding it.
          </p>
        </div>

        {!isSecureCameraContext && (
          <p className="text-xs text-amber-700">Camera preview requires HTTPS (or localhost) on this page.</p>
        )}

        {isSecureCameraContext && (
          <>
            {tvsBoundId && (
              <div className="rounded-lg border border-green-200 bg-green-50/40 p-3 text-xs flex items-center justify-between">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-green-600" /> Bound: {tvsBoundLabel}</span>
                <Button variant="ghost" size="sm" className="h-6 text-[11px] text-destructive" onClick={unbindTvsDevice}>Unbind</Button>
              </div>
            )}

            {tvsDevices.length === 0 && (
              <p className="text-xs text-muted-foreground">No cameras detected. Plug in the TVS PDS 8M and reload this page.</p>
            )}

            {tvsDevices.length > 0 && (
              <div className="space-y-2">
                <Label>Select camera to preview</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={tvsPreviewId}
                  onChange={(e) => setTvsPreviewId(e.target.value)}
                >
                  {tvsDevices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                  ))}
                </select>
                <div className="rounded-lg overflow-hidden bg-black aspect-video">
                  <video ref={tvsVideoRef} className="w-full h-full object-contain" playsInline muted />
                </div>
                {tvsPreviewError && (
                  <p className="text-xs text-amber-700">{tvsPreviewError}</p>
                )}
                <Button size="sm" onClick={confirmTvsDevice} className="gap-1.5">
                  <Camera size={14} /> This is the TVS PDS 8M
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border rounded-xl p-5 space-y-2 bg-card">
        <h3 className="text-sm font-semibold">Reception scan options</h3>
        <p className="text-xs text-muted-foreground">
          Form F opens the Preferred Scanning Source above (Scanner / ScanBridge by default). Staff can still switch tabs to
          Existing Scanner, Mobile, or Upload. Advanced bridge/device diagnostics live only on this page —
          reception never sees bridge URLs, ports, or vendor adapter names.
        </p>
        <Badge variant="outline" className="text-[10px]">TVS PDS 8M capture — code-complete, awaiting physical hardware validation</Badge>
      </div>
    </div>
  );
}
