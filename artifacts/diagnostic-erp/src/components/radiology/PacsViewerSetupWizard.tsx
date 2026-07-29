/**
 * PacsViewerSetupWizard — first-run Orthanc / OHIF / Weasis probe + save.
 * Mounted on Radiology Settings → Viewers.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Circle, Loader2, Radar } from "lucide-react";

type StepStatus = "idle" | "running" | "ok" | "fail";

type Step = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

type Props = {
  lanIpHint?: string;
  onSaved?: () => void;
  setSetting: (key: string, value: string) => void;
};

async function probeUrl(url: string): Promise<{ ok: boolean; detail: string }> {
  if (!url.trim()) return { ok: false, detail: "URL empty" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { method: "GET", mode: "no-cors", signal: ctrl.signal });
    clearTimeout(t);
    // no-cors cannot read status; reaching here without throw ≈ reachable
    void res;
    return { ok: true, detail: "Reachable (browser probe)" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Unreachable" };
  }
}

export default function PacsViewerSetupWizard({ lanIpHint = "", onSaved, setSetting }: Props) {
  const { toast } = useToast();
  const [lanIp, setLanIp] = useState(lanIpHint);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([
    { id: "orthanc", label: "Detect Orthanc health", status: "idle" },
    { id: "profile", label: "Probe LAN profile", status: "idle" },
    { id: "ohif", label: "Test OHIF base URL", status: "idle" },
    { id: "weasis", label: "Test Weasis WADO URL", status: "idle" },
    { id: "save", label: "Save working clinic defaults", status: "idle" },
  ]);

  function patchStep(id: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function runWizard() {
    const ip = lanIp.trim();
    if (!ip) {
      toast({ title: "Enter clinic LAN IP", variant: "destructive" });
      return;
    }
    setBusy(true);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "idle", detail: undefined })));

    const orthancUrl = `http://${ip}:8042/system`;
    const ohifUrl = `http://${ip}:3010`;
    const wadoUrl = `http://${ip}:8042/wado`;

    patchStep("orthanc", { status: "running" });
    const orthanc = await probeUrl(orthancUrl);
    const orthancOk = orthanc.ok;
    patchStep("orthanc", { status: orthanc.ok ? "ok" : "fail", detail: `${orthancUrl} — ${orthanc.detail}` });

    patchStep("profile", { status: "running" });
    patchStep("profile", {
      status: orthancOk ? "ok" : "fail",
      detail: orthancOk ? `LAN profile candidate: ${ip}` : "Orthanc not reachable on LAN — check IP / firewall",
    });

    patchStep("ohif", { status: "running" });
    const ohif = await probeUrl(ohifUrl);
    patchStep("ohif", { status: ohif.ok ? "ok" : "fail", detail: `${ohifUrl} — ${ohif.detail}` });

    patchStep("weasis", { status: "running" });
    const weasis = await probeUrl(wadoUrl);
    patchStep("weasis", { status: weasis.ok ? "ok" : "fail", detail: `${wadoUrl} — ${weasis.detail}` });

    if (!orthancOk && !ohif.ok && !weasis.ok) {
      patchStep("save", { status: "fail", detail: "Nothing reachable — not saving" });
      setBusy(false);
      toast({ title: "Setup incomplete", description: "Fix Orthanc/viewer URLs and retry.", variant: "destructive" });
      return;
    }

    patchStep("save", { status: "running" });
    try {
      setSetting("ohif_base_url", ohifUrl);
      setSetting("dicom_web_base_url", `${ohifUrl}/dicom-web`);
      setSetting("ohif_study_url_template", "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}");
      setSetting("wado_uri_base_url", wadoUrl);
      setSetting("weasis_wado_url", wadoUrl);
      setSetting("viewer_mode", "BOTH");
      setSetting("default_viewer", "WEASIS");
      setSetting("lan_host", ip);
      patchStep("save", { status: "ok", detail: "Clinic viewer defaults saved" });
      toast({ title: "Viewer profile saved", description: `LAN ${ip} applied as clinic default.` });
      onSaved?.();
    } catch (e) {
      patchStep("save", { status: "fail", detail: e instanceof Error ? e.message : "Save failed" });
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="pacs-viewer-setup-wizard">
      <div className="flex items-center gap-2">
        <Radar className="h-4 w-4 text-indigo-600" />
        <div>
          <h3 className="text-sm font-semibold">First-run PACS / viewer setup</h3>
          <p className="text-[11px] text-muted-foreground">
            Detect Orthanc, probe OHIF &amp; Weasis on the clinic LAN, then save working defaults.
          </p>
        </div>
      </div>
      <div className="grid gap-2 max-w-sm">
        <Label className="text-xs">Clinic LAN IP</Label>
        <Input
          value={lanIp}
          onChange={(e) => setLanIp(e.target.value)}
          placeholder="e.g. 192.168.1.50"
          disabled={busy}
        />
      </div>
      <ol className="space-y-1.5 text-xs">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2">
            {s.status === "running" ? (
              <Loader2 className="h-3.5 w-3.5 mt-0.5 animate-spin text-indigo-600" />
            ) : s.status === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600" />
            ) : (
              <Circle className={`h-3.5 w-3.5 mt-0.5 ${s.status === "fail" ? "text-rose-500" : "text-muted-foreground"}`} />
            )}
            <span>
              <span className="font-medium">{s.label}</span>
              {s.detail ? <span className="text-muted-foreground"> — {s.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <Button type="button" size="sm" onClick={() => void runWizard()} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Radar className="h-3.5 w-3.5 mr-1.5" />}
        Run setup wizard
      </Button>
    </div>
  );
}
