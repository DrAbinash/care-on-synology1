import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import PresentationTemplateManager from "@/components/radiology/PresentationTemplateManager";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { hostForProfile, orthancBaseForProfile, ohifBaseForProfile, publicBaseUrl } from "@/lib/networkProfiles";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Network, Server, MonitorPlay, Radio, BrainCircuit,
  Wrench, Activity, ShieldAlert, Laptop, CheckCircle2,
  XCircle, AlertTriangle, RefreshCw, Plus, Save, Trash2,
  Tv2, Zap, ShieldCheck, PlayCircle, Info, Palette, Mic, Waves
} from "lucide-react";
import type { UseMutationResult } from "@tanstack/react-query";
// M1.6B2/B3 — voice layer settings (same pacs_settings persistence as this
// page) + per-radiologist overrides (radiologist_voice_preferences)
import {
  parseVoiceSettings, parseVoiceUserPrefs, resolveProviderChoice, createVoiceProvider,
  isWebSpeechSupported, fetchTranscribeCapabilities,
  type TranscriptionSession, type TranscribeCapabilities, type VoiceUserPrefs,
} from "@/lib/voiceTranscription";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";

// Sub-panels imported or reconstructed for unified look
import { ModalityPanel } from "@/pages/ModalityManagement";
import { DicomNodesPanel } from "@/pages/DicomNodes";
import { AgentSetupPanel } from "@/pages/AgentSetup";
import { ArchiveLifecyclePanel } from "@/pages/PacsArchiveLifecycle";
import { AiInferencePanel } from "@/pages/AiInferenceSettings";
import { AiReportingPanel } from "@/pages/AiReportingSettings";
import { RadiologyStylePanel } from "@/pages/RadiologyStyleSettings";
import { UsgExtractionPanel } from "@/pages/UsgAdminSettings";
import {
  AiImpressionCard, QualityCheckerCard, FollowUpRecommendationsCard,
  TemplateLearningCard, MultiLanguageCard, RoutingRulesCard,
  AmendmentManagerCard, SonographerModeCard, DicomSrExportCard,
} from "@/components/smartRadiology/SmartRadiologyCards";
import { RisMonitorCommandGrid } from "@/components/risMonitoring/RisMonitorCards";
import ViewerNetworkRoutesCard from "@/components/radiology/ViewerNetworkRoutesCard";

type Setting = { id: number; key: string; value: string | null; category: string; isSecret: boolean };
type ServiceHealth = { name: string; endpoint: string; status: "green" | "yellow" | "red"; details: string };
type HealthResponse = {
  ok: boolean;
  services: {
    orthancHttp: ServiceHealth;
    orthancDicom: ServiceHealth;
    ohifHttp: ServiceHealth;
    weasisWado: ServiceHealth;
    conquestDicom: ServiceHealth;
  };
};

/**
 * Frontend-side mirror of the backend's isDockerBridgeIp (see
 * lib/pacs/pacsConfig.ts, fixed in commit 3142eb4e). Kept as a small,
 * independent copy since the frontend bundle cannot import server code —
 * same logic, same 172.16.1.x exclusion for the real clinic LAN subnet, so
 * warnings shown here always agree with what the backend would flag.
 */
function isDockerBridgeIpLike(value: string): boolean {
  if (!value) return false;
  const m = value.match(/172\.(1[6-9]|2[0-9]|3[01])\.(\d+)\./);
  if (!m) return false;
  const secondOctet = Number(m[1]);
  const thirdOctet = Number(m[2]);
  if (secondOctet === 16 && thirdOctet === 1) return false;
  return true;
}

export default function RadiologySettingsCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(readStaffSession()?.user.role ?? ""));

  const [activeTab, setActiveTab] = useState("network");
  const [detectedProfile, setDetectedProfile] = useState<"LAN" | "TAILSCALE" | "PUBLIC">("PUBLIC");
  const [profileOverride, setProfileOverride] = useState<"auto" | "LAN" | "TAILSCALE" | "PUBLIC">(() => {
    return (localStorage.getItem("pacs_network_profile") as any) || "auto";
  });
  const [detectionReason, setDetectionReason] = useState("Probing network routes...");

  // Load pacs settings
  const { data: settings = [], refetch: refetchSettings } = useQuery<Setting[]>({
    queryKey: ["pacs-settings"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
  });

  // Load clinic settings (Ollama settings + MWL settings)
  const { data: clinicSettings = {}, refetch: refetchClinic } = useQuery<any>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  // Load services health
  const { data: healthData, isFetching: isFetchingHealth, refetch: refetchHealth } = useQuery<HealthResponse>({
    queryKey: ["/api/radiology/network/health"],
    queryFn: () => api.get<HealthResponse>("/api/radiology/network/health"),
    refetchInterval: 30000,
  });

  // Load config changes history
  const { data: changesData, refetch: refetchChanges } = useQuery<any>({
    queryKey: ["/api/radiology/network/config/changes"],
    queryFn: () => api.get("/api/radiology/network/config/changes"),
  });

  const [valResults, setValResults] = useState<Array<{ name: string; status: "PASS" | "WARNING" | "FAIL"; message: string }> | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [changeReason, setChangeReason] = useState("");

  const runValidation = async () => {
    setIsValidating(true);
    try {
      const res = await api.post<any>("/api/radiology/network/config/validate", {});
      setValResults(res.results);
      toast({ title: "Configuration Validation Completed" });
    } catch (err: any) {
      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
    } finally {
      setIsValidating(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.get<any>("/api/radiology/network/config/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radiology_config_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: "Configuration exported successfully" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        await api.post("/api/radiology/network/config/import", { ...json, reason: "Imported via settings dashboard file upload" });
        toast({ title: "Configuration imported successfully" });
        refetchSettings();
        refetchClinic();
      } catch (err: any) {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };


  // Mutation to update pacs settings
  // Phase E helper: read a saved setting value by key ("" when unset)
  const sv = (key: string, fallback = "") =>
    settings.find((x) => x.key === key)?.value ?? fallback;
  const svOn = (key: string, defaultOn = true) => {
    const v = sv(key);
    return v === "" ? defaultOn : v === "true";
  };

  const upsertSetting = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/pacs-settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pacs-settings"] });
      toast({ title: "Configuration updated successfully" });
    },
    onError: (err: any) => toast({ title: "Failed to update configuration", description: err.message, variant: "destructive" }),
  });

  // Mutation to update clinic settings
  const updateClinicSettings = useMutation({
    mutationFn: (body: object) => api.put("/api/clinic-settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      toast({ title: "Clinic configuration updated" });
    },
    onError: (err: any) => toast({ title: "Failed to save settings", description: err.message, variant: "destructive" }),
  });

  // Auto detect closest profile based on network speed/reachability.
  // Reads the ACTUAL configured URLs from settings (same source of truth as
  // the rest of this page and as getRadiologyConfig() on the backend) rather
  // than hardcoded IP literals — consistent with the bridge-IP-safe fix in
  // commit 3142eb4e. If no OHIF/Orthanc URL is configured yet, this safely
  // skips probing rather than guessing an address.
  useEffect(() => {
    if (settings.length === 0) return; // wait for settings to load first
    const probeNetwork = async () => {
      // 1. Probe LAN Orthanc first (fastest)
      try {
        const start = Date.now();
        await fetch(`${orthancBaseForProfile("LAN")}/`, { method: "HEAD", mode: "no-cors" });
        const latency = Date.now() - start;
        setDetectedProfile("LAN");
        setDetectionReason(`LAN reached successfully in ${latency}ms.`);
        return;
      } catch (e) {
        // LAN failed, try Tailscale next
      }

      // 2. Probe Tailscale IP
      try {
        const start = Date.now();
        await fetch(`${orthancBaseForProfile("TAILSCALE")}/`, { method: "HEAD", mode: "no-cors" });
        const latency = Date.now() - start;
        setDetectedProfile("TAILSCALE");
        setDetectionReason(`Tailscale reached successfully in ${latency}ms. LAN unreachable.`);
        return;
      } catch (e) {
        // Both private networks unreachable, fallback to Public
      }

      setDetectedProfile("PUBLIC");
      setDetectionReason("LAN and Tailscale unreachable. Defaulted to cloud/public gateway.");
    };

    probeNetwork();
  }, [settings]);

  const activeProfile = profileOverride === "auto" ? detectedProfile : profileOverride;

  const handleProfileChange = (p: "auto" | "LAN" | "TAILSCALE" | "PUBLIC") => {
    setProfileOverride(p);
    localStorage.setItem("pacs_network_profile", p);
    toast({ title: `Network profile switched to ${p.toUpperCase()}` });
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Radiology Settings Center"
        subtitle="Unified console for PACS, Modalities, Viewers, AI Clinical Assistant, and diagnostics"
        actions={
          <Button variant="outline" size="sm" onClick={() => { refetchSettings(); refetchClinic(); refetchHealth(); }}>
            <RefreshCw size={14} className="mr-1.5" /> Reload Config
          </Button>
        }
      />

      {/* Help box — required orientation text for all radiology/PACS settings */}
      <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-4 flex items-start gap-2.5">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" size={16} />
        <p className="text-xs text-muted-foreground">
          Use this page for all Radiology, PACS, DICOM, OHIF, Weasis, worklist, and radiology report
          settings. <strong className="text-foreground">Public URLs</strong> (OHIF Viewer URL, Weasis WADO URL,
          Orthanc URL) must be reachable from clinic PCs — use your LAN IP, Tailscale IP, or public
          domain. <strong className="text-foreground">Internal URLs</strong> are only for server/container
          communication and are configured via environment variables (see .env.example). Do not use Docker
          bridge IPs like <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">172.17.x.x</code> for
          public viewer URLs — the system will warn you if one is detected.
        </p>
      </div>

      {/* Network Profile Notification Banner */}
      <div className="rounded-xl border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 border-blue-200 dark:border-blue-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Network className="text-blue-600 dark:text-blue-400 mt-1 shrink-0" size={20} />
          <div>
            <h4 className="font-semibold text-sm">Active Network Profile: <span className="text-blue-600 dark:text-blue-400">{activeProfile}</span></h4>
            <p className="text-xs text-muted-foreground mt-0.5">{detectionReason}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">Select Mode:</span>
          {(["auto", "LAN", "TAILSCALE", "PUBLIC"] as const).map((profile) => (
            <Button
              key={profile}
              variant={profileOverride === profile ? "default" : "outline"}
              size="sm"
              className="h-8 capitalize"
              onClick={() => handleProfileChange(profile)}
            >
              {profile}
            </Button>
          ))}
        </div>
      </div>

      {/* Navigation tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1 rounded-lg">
          <TabsTrigger value="general"><ShieldCheck size={14} className="mr-1.5" />General</TabsTrigger>
          <TabsTrigger value="network"><Network size={14} className="mr-1.5" />Profiles</TabsTrigger>
          <TabsTrigger value="modalities"><Server size={14} className="mr-1.5" />Modalities</TabsTrigger>
          <TabsTrigger value="pacs"><Radio size={14} className="mr-1.5" />PACS Servers</TabsTrigger>
          <TabsTrigger value="viewers"><MonitorPlay size={14} className="mr-1.5" />Viewers</TabsTrigger>
          <TabsTrigger value="mwl"><Wrench size={14} className="mr-1.5" />DICOM &amp; MWL</TabsTrigger>
          <TabsTrigger value="reporting"><BrainCircuit size={14} className="mr-1.5" />AI &amp; Templates</TabsTrigger>
          <TabsTrigger value="usg-extraction"><Waves size={14} className="mr-1.5" />USG Extraction</TabsTrigger>
          <TabsTrigger value="style"><Palette size={14} className="mr-1.5" />Report Style</TabsTrigger>
          <TabsTrigger value="premium"><Zap size={14} className="mr-1.5" />Premium Report</TabsTrigger>
          <TabsTrigger value="voice"><Mic size={14} className="mr-1.5" />Voice</TabsTrigger>
          <TabsTrigger value="diagnostics"><Activity size={14} className="mr-1.5" />Diagnostics</TabsTrigger>
          <TabsTrigger value="history"><Info size={14} className="mr-1.5" />History</TabsTrigger>
          <TabsTrigger value="advanced"><ShieldAlert size={14} className="mr-1.5" />Advanced</TabsTrigger>
        </TabsList>

        {/* Tab content 1: Network Profiles */}
        {/* ── Phase E: GENERAL — plain-language everyday options ── */}
        <TabsContent value="general" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-4 max-w-2xl">
            <h3 className="text-sm font-bold">General Radiology Options</h3>
            <p className="text-xs text-muted-foreground">Everyday behavior of the Radiology module. Safe to change; takes effect immediately for new page loads.</p>
            <div className="space-y-1">
              <Label className="text-xs">Default Radiologist</Label>
              <Input
                className="h-8 text-sm"
                placeholder="e.g. Dr. Abinash"
                defaultValue={sv("default_radiologist")}
                onBlur={(e) => upsertSetting.mutate({ key: "default_radiologist", value: e.target.value, category: "radiology" })}
                disabled={!isAdmin}
              />
              <p className="text-[11px] text-muted-foreground">Shown as the pre-selected radiologist on new studies when none is assigned.</p>
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <Label className="text-xs font-semibold">Highlight Urgent / VIP studies</Label>
                <p className="text-[11px] text-muted-foreground">Tints STAT / EMERGENCY / URGENT / VIP rows in the Worklist and Reading Room.</p>
              </div>
              <Switch checked={svOn("urgent_highlight_enabled")} disabled={!isAdmin}
                onCheckedChange={(v) => upsertSetting.mutate({ key: "urgent_highlight_enabled", value: String(v), category: "radiology" })} />
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <Label className="text-xs font-semibold">Lock report after Final sign-off</Label>
                <p className="text-[11px] text-muted-foreground">Finalized reports are locked in the Reading Room (Save/Finalize disabled after sign-off). Keep ON; owner amendments go through preserved owner tools.</p>
              </div>
              <Switch checked={svOn("report_final_lock")} disabled={!isAdmin}
                onCheckedChange={(v) => upsertSetting.mutate({ key: "report_final_lock", value: String(v), category: "radiology" })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Aging alert after (hours)</Label>
              <Input
                type="number" min={1} max={72} className="h-8 text-sm w-32"
                placeholder="4"
                defaultValue={sv("radiology_aging_alert_hours", "4")}
                onBlur={(e) => upsertSetting.mutate({ key: "radiology_aging_alert_hours", value: e.target.value.trim() || "4", category: "radiology" })}
                disabled={!isAdmin}
              />
              <p className="text-[11px] text-muted-foreground">A red "waiting" badge appears on Worklist studies that haven't been finalized within this many hours — helps reception spot studies stuck in the queue.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="network" className="space-y-4">
          {/* Phase E: runtime overrides for the Phase B central network config.
              Saved to admin settings (category "viewer") — hydrated by
              applyNetworkSettings() at runtime, NO rebuild or restart needed. */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-2"><Network size={14} /> Network Hosts (advanced — leave blank to use system defaults)</h3>
            <p className="text-xs text-muted-foreground">
              If the clinic network ever changes, update these here — the whole system (viewers, probes, health checks) follows immediately. Current defaults: LAN {hostForProfile("LAN")}, Tailscale {hostForProfile("TAILSCALE")}, Public {hostForProfile("PUBLIC")}.
            </p>
            <div className="grid md:grid-cols-3 gap-3">
              {([
                ["network_lan_host", "LAN Host (clinic)", hostForProfile("LAN")],
                ["network_tailscale_host", "Tailscale Host (remote)", hostForProfile("TAILSCALE")],
                ["network_public_domain", "Public Domain", hostForProfile("PUBLIC")],
                ["orthanc_http_port", "Orthanc HTTP Port", "8042"],
                ["ohif_http_port", "OHIF Port", "3010"],
              ] as const).map(([key, label, ph]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Input className="h-8 text-sm font-mono" placeholder={ph} defaultValue={sv(key)} disabled={!isAdmin}
                    onBlur={(e) => upsertSetting.mutate({ key, value: e.target.value.trim(), category: "viewer" })} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Badge className="bg-emerald-500">Profile 1</Badge>
                <span className="text-xs text-muted-foreground">Preferred for scanner sync</span>
              </div>
              <h3 className="font-semibold text-base">LAN Profile (Local Network)</h3>
              <p className="text-xs text-muted-foreground">
                Uses local IP addresses ({hostForProfile("LAN")}). High speed, secure, zero latency.
                Modality acquisition pushes (GE Voluson, CT, MRI) should strictly prefer this.
              </p>
              <div className="pt-2 text-xs font-mono text-muted-foreground space-y-1">
                <p>OHIF Base: {ohifBaseForProfile("LAN")}</p>
                <p>Orthanc REST: {orthancBaseForProfile("LAN")}</p>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Badge className="bg-blue-600">Profile 2</Badge>
                <span className="text-xs text-muted-foreground">Preferred for remote reporting</span>
              </div>
              <h3 className="font-semibold text-base">Tailscale VPN Profile</h3>
              <p className="text-xs text-muted-foreground">
                Connects through Tailscale network ({hostForProfile("TAILSCALE")}). Allows radiologist/owner to review
                studies and launch OHIF/Weasis outside the clinic network securely.
              </p>
              <div className="pt-2 text-xs font-mono text-muted-foreground space-y-1">
                <p>OHIF Base: {ohifBaseForProfile("TAILSCALE")}</p>
                <p>Orthanc REST: {orthancBaseForProfile("TAILSCALE")}</p>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Badge variant="outline">Profile 3</Badge>
                <span className="text-xs text-muted-foreground">Online portal fallback</span>
              </div>
              <h3 className="font-semibold text-base">Public Cloud Profile</h3>
              <p className="text-xs text-muted-foreground">
                Uses Cloudflare domain ({hostForProfile("PUBLIC")}) for secure patient booking, report delivery,
                and online billing desk tasks. Viewer access is disabled for speed &amp; transport privacy.
              </p>
              <div className="pt-2 text-xs font-mono text-muted-foreground space-y-1">
                <p>ERP URL: {publicBaseUrl()}</p>
                <p>Ingestion port: Closed on WAN</p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab content 2: Modalities */}
        <TabsContent value="modalities" className="space-y-4">
          <ModalityPanel />
        </TabsContent>

        {/* Tab content 3: PACS Servers */}
        <TabsContent value="pacs" className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <DicomNodesPanel />
            </div>
            <div className="space-y-6">
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <ShieldCheck size={16} className="text-emerald-500" />
                  PACS Naming Check
                </h3>
                <p className="text-xs text-muted-foreground">
                  Confirm server credentials match configuration targets to prevent study delivery drops.
                </p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-muted-foreground">Conquest AE Title:</span>
                    <span className="font-mono font-semibold">CONQUESTPACS</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-muted-foreground">Orthanc AE Title:</span>
                    <span className="font-mono font-semibold">ORTHANC</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-muted-foreground">Internal AE Title:</span>
                    <span className="font-mono font-semibold">DIAGNOCENTER</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab content 4: Viewers */}
        <TabsContent value="viewers" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <MonitorPlay size={16} className="text-primary" />
              Viewer Selection &amp; launch configuration
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold">Default PACS Viewer</label>
                <select
                  value={settings.find(s => s.key === "default_viewer")?.value ?? "OHIF"}
                  onChange={(e) => upsertSetting.mutate({ key: "default_viewer", value: e.target.value, category: "viewer" })}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-background"
                >
                  <option value="OHIF">OHIF Web Viewer (Zero Footprint)</option>
                  <option value="WEASIS">Weasis Native (Protocol Handler)</option>
                  <option value="BOTH">Show Both Buttons</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold">Viewer Launch Mode</label>
                <select
                  value={settings.find(s => s.key === "viewer_mode")?.value ?? "LAN"}
                  onChange={(e) => upsertSetting.mutate({ key: "viewer_mode", value: e.target.value, category: "viewer" })}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-background"
                >
                  <option value="LAN">Always force LAN host</option>
                  <option value="VPN">Force Tailscale IP</option>
                  <option value="DYNAMIC">Auto switch based on profile</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t">
              {/* Quick-fill for clinic LAN — no IP is invented; asks for the
                  real address instead of assuming 192.168.1.137, which is
                  not correct for every deployment. */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-800">Quick-fill Clinic LAN Addresses</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Fills OHIF, DICOMweb, and Weasis WADO fields below using one LAN IP you provide.
                  </p>
                </div>
                <button
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md"
                  onClick={() => {
                    const lanIp = window.prompt("Enter your clinic's LAN IP (e.g. 192.168.1.137) — never a Docker bridge IP like 172.17.x.x:");
                    if (!lanIp) return;
                    if (isDockerBridgeIpLike(lanIp)) {
                      toast({ title: "That looks like a Docker bridge IP", description: "Use your real clinic LAN IP instead — browsers and Weasis cannot reach Docker-internal addresses.", variant: "destructive" });
                      return;
                    }
                    upsertSetting.mutate({ key: "ohif_base_url",               value: `http://${lanIp}:3010`,                                  category: "viewer" });
                    upsertSetting.mutate({ key: "dicom_web_base_url",           value: `http://${lanIp}:3010/dicom-web`,                         category: "viewer" });
                    upsertSetting.mutate({ key: "ohif_study_url_template",      value: "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}", category: "viewer" });
                    upsertSetting.mutate({ key: "wado_uri_base_url",            value: `http://${lanIp}:8042/wado`,                             category: "viewer" });
                    upsertSetting.mutate({ key: "weasis_wado_url",              value: `http://${lanIp}:8042/wado`,                             category: "viewer" });
                    upsertSetting.mutate({ key: "weasis_manifest_url_template", value: `weasis://$dicom:get -w "http://${lanIp}:8042/wado?requestType=WADO&studyUID={studyInstanceUID}&contentType=application/dicom"`, category: "viewer" });
                    upsertSetting.mutate({ key: "viewer_mode",                  value: "BOTH",                                                       category: "viewer" });
                    upsertSetting.mutate({ key: "default_viewer",               value: "OHIF",                                                       category: "viewer" });
                  }}
                >
                  Fill In LAN IP…
                </button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">OHIF Viewer URL <span className="text-muted-foreground font-normal">(public — browser-reachable)</span></Label>
                <Input
                  value={settings.find(s => s.key === "ohif_base_url")?.value ?? ""}
                  onChange={(e) => upsertSetting.mutate({ key: "ohif_base_url", value: e.target.value, category: "viewer" })}
                  className="h-9 text-sm"
                  placeholder={ohifBaseForProfile("LAN")}
                />
                {isDockerBridgeIpLike(settings.find(s => s.key === "ohif_base_url")?.value ?? "") && (
                  <p className="text-[11px] text-red-600 font-medium">⚠ This looks like a Docker bridge IP (172.17.x.x-172.31.x.x) — browsers cannot reach it. Use your clinic LAN IP, Tailscale IP, or public domain instead.</p>
                )}
                <p className="text-[11px] text-muted-foreground">Your clinic LAN IP + port 3010 (where OHIF is running). Never a Docker bridge IP.</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Weasis Manifest / WADO URL <span className="text-muted-foreground font-normal">(public — Weasis-reachable)</span></Label>
                <Input
                  value={settings.find(s => s.key === "weasis_wado_url")?.value ?? ""}
                  onChange={(e) => {
                    upsertSetting.mutate({ key: "weasis_wado_url",   value: e.target.value, category: "viewer" });
                    upsertSetting.mutate({ key: "wado_uri_base_url", value: e.target.value, category: "viewer" });
                  }}
                  className="h-9 text-sm"
                  placeholder={`${orthancBaseForProfile("LAN")}/wado`}
                />
                {isDockerBridgeIpLike(settings.find(s => s.key === "weasis_wado_url")?.value ?? "") && (
                  <p className="text-[11px] text-red-600 font-medium">⚠ This looks like a Docker bridge IP — local Weasis installs cannot reach it. Use your clinic LAN IP, Tailscale IP, or public domain instead.</p>
                )}
                <p className="text-[11px] text-muted-foreground">Orthanc WADO endpoint — your clinic LAN IP + :8042/wado. Never a Docker bridge IP.</p>
              </div>

              {/* Internal URLs — read-only display. These are set via .env,
                  not editable here, since they're infra/deployment-level
                  (container-to-container), not clinic-level configuration.
                  See ORTHANC_INTERNAL_URL / OHIF_INTERNAL_URL in .env.example. */}
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Internal URLs (server/container only — set via .env, not here)</p>
                <div className="grid sm:grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground">
                  <div>ORTHANC_INTERNAL_URL<br /><span className="text-foreground">http://care-orthanc:8042</span></div>
                  <div>OHIF_INTERNAL_URL<br /><span className="text-foreground">(optional — only if health-check probes can't reach the public URL above)</span></div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  These are used only for the API server's own health-check probes — never for the URL that opens in a doctor's browser or Weasis. Docker service names (like <code>care-orthanc</code>) are fine here, since this traffic never leaves the Docker network.
                </p>
              </div>
            </div>
          </div>

          {/* M1.2 — network routes for reliable study launch (AUTO/LAN/
              Tailscale/Cloudflare/Public). One owner section; LAN reuses the
              existing keys above. */}
          <ViewerNetworkRoutesCard
            getSetting={(key) => settings.find((s) => s.key === key)?.value ?? ""}
            setSetting={(key, value) => upsertSetting.mutate({ key, value, category: "viewer" })}
          />
        </TabsContent>

        {/* Tab content 5: DICOM & MWL */}
        <TabsContent value="mwl" className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Wrench size={16} className="text-primary" />
                  MWL Config
                </h3>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">MWL AE Title</Label>
                    <Input
                      value={settings.find(s => s.key === "mwl_ae_title")?.value ?? ""}
                      onChange={(e) => upsertSetting.mutate({ key: "mwl_ae_title", value: e.target.value, category: "mwl" })}
                      className="h-9 text-sm"
                      placeholder="ERPMWL"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">MWL TCP Port</Label>
                    <Input
                      value={settings.find(s => s.key === "mwl_port")?.value ?? ""}
                      onChange={(e) => upsertSetting.mutate({ key: "mwl_port", value: e.target.value, category: "mwl" })}
                      className="h-9 text-sm"
                      placeholder="4242"
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Radio size={16} className="text-primary" />
                  DICOM Puller scheduler
                </h3>
                <p className="text-xs text-muted-foreground">
                  The cron puller runs queries on configured DICOM nodes. Select node pull settings under PACS Servers.
                </p>
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold">Auto-puller Service Daemon</span>
                    <p className="text-[11px] text-muted-foreground">Triggers matching C-MOVE commands to conquest destination</p>
                  </div>
                  <Badge variant="outline" className="text-green-600 border-green-200">Active</Badge>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <AgentSetupPanel />
            </div>
          </div>
        </TabsContent>

        {/* Tab content 6: AI & Templates */}
        <TabsContent value="reporting" className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <BrainCircuit size={16} className="text-purple-600" />
                  Ollama Local Model Configuration
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Primary Ollama Endpoint</Label>
                    <Input
                      value={clinicSettings.ollamaBaseUrl ?? ""}
                      onChange={(e) => updateClinicSettings.mutate({ ollamaBaseUrl: e.target.value })}
                      placeholder="http://192.168.1.250:11434"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fallback Ollama Endpoint</Label>
                    <Input
                      value={clinicSettings.ollamaFallbackUrl ?? ""}
                      onChange={(e) => updateClinicSettings.mutate({ ollamaFallbackUrl: e.target.value })}
                      placeholder="http://172.16.1.140:11434"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40 mt-2">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold">Enable AI Sonologist Assistant</span>
                    <p className="text-[11px] text-muted-foreground">Allow AI draft generation and clinical quality checklist rules</p>
                  </div>
                  <Switch
                    checked={clinicSettings.ollamaEnabled ?? false}
                    onCheckedChange={(val) => updateClinicSettings.mutate({ ollamaEnabled: val })}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold">Auto Populate Form F from OB Measurements</span>
                    <p className="text-[11px] text-muted-foreground">Optionally map ultrasound GA/CRL/FHR parameters straight to PCPNDT logs</p>
                  </div>
                  <Switch
                    checked={clinicSettings.autoPopulateFormFFromObMeasurements ?? false}
                    onCheckedChange={(val) => updateClinicSettings.mutate({ autoPopulateFormFFromObMeasurements: val })}
                  />
                </div>
              </div>

              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Zap size={16} className="text-amber-500" />
                  Smart Platform features
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AiImpressionCard />
                  <QualityCheckerCard />
                  <FollowUpRecommendationsCard />
                  <TemplateLearningCard />
                  <MultiLanguageCard />
                  <RoutingRulesCard />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <AiReportingPanel />
              <AiInferencePanel />
            </div>
          </div>
        </TabsContent>

        {/* Tab content 7: Diagnostics */}
        <TabsContent value="diagnostics" className="space-y-4">
          {/* M1.3 — deep diagnostics live on the ONE admin Flight Deck page. */}
          <div className="rounded-xl border bg-card p-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Full deployment diagnostics (viewer, DICOMweb, network routes, workflow simulation, settings verification) live on the Flight Deck.
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate("/radiology/flight-deck")} data-testid="link-flight-deck">
              Open Flight Deck
            </Button>
          </div>
          {/* Phase E: owner-only deep diagnostic pages (preserved, linked here) —
              the Flight Deck above covers connectivity/workflow diagnostics but
              does not link out to these standalone admin pages, so they still
              need their own shortcuts here. */}
          {isAdmin && (
            <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold mr-2">Debug / Logs (owner only):</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => (window.location.href = "/radiology/pacs-logs")}>PACS Logs</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => (window.location.href = "/radiology/watchdog")}>Watchdog</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => (window.location.href = "/radiology/dicom-agent-dashboard")}>DICOM Agent</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => (window.location.href = "/radiology/network-control-center")}>Network Control Center</Button>
            </div>
          )}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Activity size={16} className="text-primary" />
                Connectivity Probe Statistics
              </h3>
              {healthData ? (
                <div className="space-y-3">
                  {Object.entries(healthData.services).map(([key, svc]) => (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="space-y-0.5">
                        <span className="text-xs font-semibold capitalize">{svc.name}</span>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{svc.endpoint}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-mono">{svc.details}</span>
                        <Badge
                          variant="outline"
                          className={
                            svc.status === "green"
                              ? "text-green-600 border-green-200"
                              : svc.status === "yellow"
                              ? "text-amber-600 border-amber-200"
                              : "text-red-600 border-red-200 animate-pulse"
                          }
                        >
                          {svc.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-8 text-muted-foreground text-xs animate-pulse">Loading node health parameters...</div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <ShieldCheck size={16} className="text-primary" />
                  Live Configuration Tester
                </h3>
                <p className="text-xs text-muted-foreground">
                  Run deep startup-style checks for AE Title conflicts, port duplication, or missing endpoint parameters.
                </p>
                <Button
                  className="w-full justify-center h-9"
                  onClick={runValidation}
                  disabled={isValidating}
                >
                  {isValidating ? "Testing Connection..." : "Validate Configuration"}
                </Button>
              </div>

              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <PlayCircle size={16} className="text-primary" />
                  Synchronization Diagnostics
                </h3>
                <p className="text-xs text-muted-foreground">
                  Trigger manual ERP sync to push patient orders to MWL or update Conquest worklist queues.
                </p>
                <Button
                  className="w-full justify-center h-9"
                  onClick={() => {
                    toast({ title: "Sync triggered" });
                    api.post("/api/sync/trigger", {});
                  }}
                >
                  Trigger Sync Now
                </Button>
              </div>
            </div>
          </div>

          {valResults && (
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <ShieldAlert size={16} className="text-primary" />
                Live Configuration Validation Results
              </h3>
              <div className="space-y-3">
                {valResults.map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold capitalize">{r.name}</span>
                      <p className="text-[10px] text-muted-foreground">{r.message}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        r.status === "PASS"
                          ? "text-green-600 border-green-200"
                          : r.status === "WARNING"
                          ? "text-amber-600 border-amber-200"
                          : "text-red-600 border-red-200 animate-pulse"
                      }
                    >
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tab content 8: Change History Log */}
        <TabsContent value="history" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Activity size={16} className="text-primary" />
              Configuration Change Audit Log
            </h3>
            <p className="text-xs text-muted-foreground">
              Review history of all changes made to PACS, viewers, and network profiles.
            </p>
            <div className="border rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Date</th>
                    <th className="px-4 py-2 text-left font-semibold">User</th>
                    <th className="px-4 py-2 text-left font-semibold">Setting Key</th>
                    <th className="px-4 py-2 text-left font-semibold">Old Value</th>
                    <th className="px-4 py-2 text-left font-semibold">New Value</th>
                    <th className="px-4 py-2 text-left font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {changesData?.changes?.length > 0 ? (
                    changesData.changes.map((c: any) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-[10px]">{new Date(c.changedAt).toLocaleString()}</td>
                        <td className="px-4 py-2 font-medium">{c.changedByName}</td>
                        <td className="px-4 py-2 font-mono text-[10px]">{c.key} ({c.category})</td>
                        <td className="px-4 py-2 font-mono text-[10px] truncate max-w-[150px]" title={c.oldValue}>{c.oldValue ?? "NULL"}</td>
                        <td className="px-4 py-2 font-mono text-[10px] truncate max-w-[150px]" title={c.newValue}>{c.newValue ?? "NULL"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{c.reason}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No configuration changes logged yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Tab content 8.5: Institutional Report Style */}
        {/* ── Phase E: PREMIUM REPORT — admin toggles (module itself preserved) ── */}
        <TabsContent value="premium" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-3 max-w-3xl">
            <h3 className="text-sm font-bold">Premium Report Presentation</h3>
            <p className="text-xs text-muted-foreground">
              Owner configuration for the preserved Premium Report module (opened via the "Premium Preview" button in the Reading Room and Worklist). These switches are stored as admin settings and applied by the Premium Report module.
            </p>
            <div className="grid md:grid-cols-2 gap-2">
              {([
                ["premium_layout_enabled", "Premium Report Layout", "Master switch for the premium presentation layer."],
                ["premium_image_panel", "Image Panel", "Right-side representative DICOM images from Orthanc."],
                ["premium_qr_verification", "QR Verification", "Printed QR code for report authenticity checks."],
                ["premium_digital_signature", "Digital Signature", "Radiologist signature block on the final report."],
                ["premium_journal_style", "Journal Style", "Academic journal-style typography."],
                ["premium_structured_reports", "Structured Reports", "Section-structured findings layout."],
                ["premium_multipage", "Multi-page Reports", "Allow reports to span multiple printed pages."],
                ["premium_hospital_branding", "Hospital Branding", "Clinic logo and letterhead on premium reports."],
                ["premium_themes", "Report Themes", "Allow selecting alternative premium themes."],
              ] as const).map(([key, label, help]) => (
                <div key={key} className="flex items-center justify-between border rounded-lg p-3">
                  <div className="pr-3">
                    <Label className="text-xs font-semibold">{label}</Label>
                    <p className="text-[11px] text-muted-foreground">{help}</p>
                  </div>
                  <Switch checked={svOn(key)} disabled={!isAdmin}
                    onCheckedChange={(v) => upsertSetting.mutate({ key, value: String(v), category: "premium" })} />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="style" className="space-y-4">
          {/* R1.2 — versioned enterprise template engine. Admins manage
              versions/activation/import/export; radiologists can preview. */}
          <PresentationTemplateManager isAdmin={isAdmin} />

          {/* Report Letterhead Size — pacs_settings key/value overrides applied
              on top of the active template (presentation-only, no schema change).
              Defaults are "large" so the header/logo/address/footer print bigger
              out of the box. Applied to BOTH draft previews and final reports. */}
          <div className="rounded-xl border bg-card p-5 space-y-3 max-w-3xl">
            <h3 className="text-sm font-bold">Report Letterhead Size</h3>
            <p className="text-xs text-muted-foreground">
              Enlarge the report header, clinic logo, clinic name/address block and the footer.
              These sizing overrides apply on top of the selected report template and affect both draft previews and finalized reports.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Header &amp; Address Size</Label>
                <select
                  value={sv("report_header_scale", "large")}
                  disabled={!isAdmin}
                  onChange={(e) => upsertSetting.mutate({ key: "report_header_scale", value: e.target.value, category: "report" })}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-background"
                >
                  <option value="standard">Standard</option>
                  <option value="large">Large (default)</option>
                  <option value="xlarge">Extra Large</option>
                </select>
                <p className="text-[11px] text-muted-foreground">Clinic name, tagline and the address/contact block.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Logo Size</Label>
                <select
                  value={sv("report_logo_scale", "large")}
                  disabled={!isAdmin}
                  onChange={(e) => upsertSetting.mutate({ key: "report_logo_scale", value: e.target.value, category: "report" })}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-background"
                >
                  <option value="standard">Standard</option>
                  <option value="large">Large (default)</option>
                  <option value="xlarge">Extra Large</option>
                </select>
                <p className="text-[11px] text-muted-foreground">Clinic logo in the report header.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Footer Size</Label>
                <select
                  value={sv("report_footer_scale", "large")}
                  disabled={!isAdmin}
                  onChange={(e) => upsertSetting.mutate({ key: "report_footer_scale", value: e.target.value, category: "report" })}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-background"
                >
                  <option value="standard">Standard</option>
                  <option value="large">Large (default)</option>
                </select>
                <p className="text-[11px] text-muted-foreground">Footer note at the bottom of every report.</p>
              </div>
            </div>
          </div>

          {/* Recommendation / Advice quick chips — editable "chocolate box"
              for the Recommendation section, mirroring the other sections.
              Stored as a JSON string array in report_recommendation_chips;
              empty falls back to the workspace's built-in defaults. */}
          <div className="rounded-xl border bg-card p-5 space-y-3 max-w-3xl">
            <h3 className="text-sm font-bold">Recommendation / Advice Quick Chips</h3>
            <p className="text-xs text-muted-foreground">
              One recommendation per line. These appear as clickable chips above the Recommendation / Advice
              field in the reporting workspace; clicking one inserts its text. Leave empty to use the built-in defaults.
            </p>
            {(() => {
              const stored = sv("report_recommendation_chips", "");
              let initial = "";
              try {
                const parsed = stored ? JSON.parse(stored) : [];
                if (Array.isArray(parsed)) initial = parsed.map((x: unknown) => String(x)).join("\n");
              } catch { initial = ""; }
              return (
                <textarea
                  key={stored}
                  defaultValue={initial}
                  disabled={!isAdmin}
                  rows={6}
                  placeholder={"Clinical correlation is recommended.\nFollow-up imaging is advised as clinically indicated.\nContrast-enhanced study is suggested for further characterisation."}
                  className="w-full text-sm border rounded-md px-2 py-1.5 bg-background resize-y"
                  onBlur={(e) => {
                    const chips = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                    upsertSetting.mutate({ key: "report_recommendation_chips", value: JSON.stringify(chips), category: "report" });
                  }}
                />
              );
            })()}
          </div>

          <RadiologyStylePanel />
        </TabsContent>

        {/* Tab content 8.6: Voice commands & dictation (M1.6B2) */}
        <TabsContent value="voice" className="space-y-4">
          <VoiceSettingsPanel settings={settings} upsertSetting={upsertSetting} isAdmin={isAdmin} />
        </TabsContent>

        {/* Tab content 8.7: USG extraction pipeline (GE Voluson push monitor,
            OCR/AI-normalize toggles, confidence thresholds). Shared panel —
            also reachable via the preserved /radiology/usg-admin-settings and
            /usg/settings deep links. This whole page is admin-gated, matching
            the standalone wrapper's FULL_ACCESS_ROLES check. */}
        <TabsContent value="usg-extraction" className="space-y-4">
          <UsgExtractionPanel />
        </TabsContent>

        {/* Tab content 9: Advanced */}
        <TabsContent value="advanced" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ShieldAlert size={16} className="text-destructive" />
              Advanced PACS Hardening
            </h3>
            <RisMonitorCommandGrid />
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Zap size={16} className="text-primary" />
              Backup &amp; Migration
            </h3>
            <p className="text-xs text-muted-foreground">
              Export the current PACS, modalities, and viewer configurations to a JSON file to replicate settings on another server, or restore from a backup.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button variant="outline" size="sm" onClick={handleExport} className="h-9">
                Export Configuration
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button variant="outline" size="sm" className="h-9">
                  Import Configuration File
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// M1.6B2 — Voice commands & dictation settings (pacs_settings, category
// "voice"; consumed by the Reporting Workspace's voice layer). POST is
// admin-gated server-side, so controls are disabled for non-admins.
// ════════════════════════════════════════════════════════════════════════════

function VoiceSettingsPanel({ settings, upsertSetting, isAdmin }: {
  settings: Setting[];
  upsertSetting: UseMutationResult<unknown, Error, object>;
  isAdmin: boolean;
}) {
  const voice = parseVoiceSettings(settings);
  const set = (key: string, value: string) => upsertSetting.mutate({ key, value, category: "voice" });
  const getRaw = (key: string) => settings.find((s) => s.key === key)?.value ?? "";

  const { data: capabilities = { server: false, local: false } } = useQuery<TranscribeCapabilities>({
    queryKey: ["voice-transcribe-status"],
    queryFn: fetchTranscribeCapabilities,
    staleTime: 60_000,
  });
  const webSpeech = isWebSpeechSupported();
  const effectiveProvider = resolveProviderChoice(voice.provider, {
    localAvailable: capabilities.local, serverAvailable: capabilities.server,
    webSpeechSupported: webSpeech, injectedPresent: false,
  });

  const [micTest, setMicTest] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [sttTest, setSttTest] = useState<string | null>(null);
  const [sttTesting, setSttTesting] = useState(false);

  async function testMicrophone() {
    setMicTest("Requesting microphone…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = stream.getAudioTracks()[0]?.label || "unnamed device";
      stream.getTracks().forEach((t) => t.stop());
      setMicTest(`✓ Microphone OK: ${label}`);
      // After permission, labels become readable — refresh the device list.
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter((d) => d.kind === "audioinput").map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId })));
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setMicTest(name === "NotAllowedError"
        ? "✗ Permission denied — allow the microphone in the browser's site settings, then retry"
        : `✗ Microphone test failed${name ? ` (${name})` : ""}`);
    }
  }

  function testTranscription() {
    if (!effectiveProvider) { setSttTest("✗ No transcription provider available"); return; }
    setSttTesting(true);
    setSttTest("Listening for ~4 seconds — say a short phrase…");
    const provider = createVoiceProvider(effectiveProvider);
    let session: TranscriptionSession | null = null;
    session = provider.start(
      { lang: voice.language, deviceId: voice.inputDeviceId },
      {
        onInterim: (t) => { if (t) setSttTest(`… ${t}`); },
        onStatus: () => undefined,
        onResult: (r) => {
          setSttTesting(false);
          setSttTest(r.transcript ? `✓ Heard: “${r.transcript}”` : "✗ Heard nothing — check the microphone and try again");
        },
        onError: (message) => { setSttTesting(false); setSttTest(`✗ ${message}`); },
      },
    );
    window.setTimeout(() => session?.stop(), 4000);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Mic size={16} className="text-primary" /> Voice Commands &amp; Dictation
        </h3>
        <p className="text-xs text-muted-foreground">
          Voice drives the Reporting Workspace's existing command dispatcher — it never bypasses locks,
          permissions, or the finalize confirmation. When voice is off or unavailable, keyboard and mouse
          work exactly as before.
        </p>
        {!isAdmin && (
          <p className="text-xs text-amber-700">Only administrators can change these settings.</p>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Switch id="voice-enabled" checked={voice.enabled} disabled={!isAdmin}
              onCheckedChange={(v) => set("voice_enabled", v ? "true" : "false")} />
            <Label htmlFor="voice-enabled" className="text-xs cursor-pointer">Voice enabled</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="voice-punct" checked={voice.autoPunctuation} disabled={!isAdmin}
              onCheckedChange={(v) => set("voice_auto_punctuation", v ? "true" : "false")} />
            <Label htmlFor="voice-punct" className="text-xs cursor-pointer">Auto punctuation (capitalize + terminal period, spoken “full stop/comma/new line”)</Label>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Transcription provider</Label>
            <select className="w-full h-9 text-sm border rounded-md px-2 bg-background" disabled={!isAdmin}
              value={voice.provider} onChange={(e) => set("voice_provider", e.target.value)}>
              <option value="auto">Auto (local → server → browser)</option>
              <option value="local">Local STT server (clinic network)</option>
              <option value="server">Server (clinic AI provider)</option>
              <option value="browser">Browser (Web Speech API)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Local STT: {capabilities.local ? "configured ✓" : "not configured"} ·
              Server transcription: {capabilities.server ? "configured ✓" : "not configured (AI provider key missing)"} ·
              Browser Web Speech: {webSpeech ? "supported ✓" : "not supported"} ·
              Effective: <strong>{effectiveProvider ?? "none — voice will show as unavailable"}</strong>
            </p>
          </div>

          {/* M1.6B3 — self-hosted STT server (audio stays on the clinic network) */}
          <div className="space-y-1">
            <Label className="text-xs">Local STT server URL (whisper.cpp / faster-whisper on the clinic network)</Label>
            <Input className="h-9 text-sm font-mono" disabled={!isAdmin} defaultValue={getRaw("voice_local_stt_url")}
              key={`lsu-${getRaw("voice_local_stt_url")}`}
              onBlur={(e) => { if (e.target.value.trim() !== getRaw("voice_local_stt_url")) set("voice_local_stt_url", e.target.value.trim()); }}
              placeholder="http://192.168.1.137:9000 (empty = off)" />
            <div className="flex gap-2">
              <select className="h-8 text-xs border rounded-md px-2 bg-background" disabled={!isAdmin}
                value={getRaw("voice_local_stt_kind") === "whispercpp" ? "whispercpp" : "openai"}
                onChange={(e) => set("voice_local_stt_kind", e.target.value)}
                title="Protocol the local server speaks">
                <option value="openai">OpenAI-compatible (/v1/audio/transcriptions)</option>
                <option value="whispercpp">whisper.cpp (/inference)</option>
              </select>
              <Input className="h-8 text-xs flex-1" disabled={!isAdmin} defaultValue={getRaw("voice_local_stt_model")}
                key={`lsm-${getRaw("voice_local_stt_model")}`}
                onBlur={(e) => { if (e.target.value.trim() !== getRaw("voice_local_stt_model")) set("voice_local_stt_model", e.target.value.trim()); }}
                placeholder="model (optional, e.g. whisper-1)" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Audio is proxied through this clinic's API server — the STT address never reaches the browser.
            </p>
          </div>

          {/* M1.6B3 — live segmented transcription for server/local providers */}
          <div className="space-y-1">
            <Label className="text-xs">Live segmented transcription (server/local providers)</Label>
            <select className="w-full h-9 text-sm border rounded-md px-2 bg-background" disabled={!isAdmin}
              value={String(voice.segmentSeconds)} onChange={(e) => set("voice_segment_seconds", e.target.value)}>
              <option value="0">Off — one upload when you release the mic</option>
              <option value="3">Every 3 seconds</option>
              <option value="5">Every 5 seconds</option>
              <option value="8">Every 8 seconds</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Streams self-contained audio segments while you speak (live interim text; enables hands-free on
              server/local providers). Words split across a segment boundary can transcribe imperfectly.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Recognition language</Label>
            <Input className="h-9 text-sm" disabled={!isAdmin} defaultValue={voice.language}
              key={voice.language} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== voice.language) set("voice_language", e.target.value.trim()); }}
              placeholder="en-IN" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Push-to-talk key</Label>
            <select className="w-full h-9 text-sm border rounded-md px-2 bg-background" disabled={!isAdmin}
              value={voice.pttKey} onChange={(e) => set("voice_ptt_key", e.target.value)}>
              <option value="Space">Space (held, outside text fields)</option>
              <option value="off">Off (buttons / Ctrl+Space only)</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Default mode</Label>
            <select className="w-full h-9 text-sm border rounded-md px-2 bg-background" disabled={!isAdmin}
              value={voice.defaultMode} onChange={(e) => set("voice_default_mode", e.target.value)}>
              <option value="command">Command mode (parse spoken commands)</option>
              <option value="dictation">Dictation mode (insert utterances as text, previewed)</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Confirmation policy</Label>
            <select className="w-full h-9 text-sm border rounded-md px-2 bg-background" disabled={!isAdmin}
              value={voice.confirmationPolicy} onChange={(e) => set("voice_confirmation_policy", e.target.value)}>
              <option value="standard">Standard (confirm replace/verify/finalize and dirty transitions)</option>
              <option value="strict">Strict (confirm every edit too)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">Finalize ALWAYS requires a click plus the standard finalize confirmation — no policy relaxes that.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Microphone device (server transcription only)</Label>
            <select className="w-full h-9 text-sm border rounded-md px-2 bg-background" disabled={!isAdmin || micDevices.length === 0}
              value={voice.inputDeviceId ?? ""} onChange={(e) => set("voice_input_device", e.target.value)}>
              <option value="">System default</option>
              {micDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Run “Test microphone” to list devices. Browser Web Speech always uses the system default microphone —
              the browser API offers no device selection.
            </p>
          </div>
        </div>

        {/* Local vs cloud — truthful privacy note (Phase 11) */}
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-[11px] text-amber-900 dark:text-amber-200">
          <strong>Where audio goes:</strong> Server transcription sends recorded audio to this clinic's API server,
          which forwards it to the configured AI provider (Gemini) using a server-side key — no keys or direct external
          calls in the browser. Browser Web Speech (Chrome/Edge) sends audio to the browser vendor's speech service.
          No local/offline engine is installed. Raw audio is never logged; the workspace audits only high-risk voice
          commands (finalize/verify) with command type, user, study and outcome — never the dictated text.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => void testMicrophone()}>
            <Mic size={13} className="mr-1.5" /> Test microphone
          </Button>
          {micTest && <span className="text-xs">{micTest}</span>}
          <Button variant="outline" size="sm" onClick={testTranscription} disabled={sttTesting || !effectiveProvider}>
            <PlayCircle size={13} className="mr-1.5" /> Test transcription
          </Button>
          {sttTest && <span className="text-xs">{sttTest}</span>}
        </div>
      </div>

      <MyVoicePreferencesCard />
    </div>
  );
}

/** M1.6B3 — the CALLER'S own voice overrides (radiologist_voice_preferences).
 *  Self-scoped endpoints; any staff member can tune their own ergonomics.
 *  Overrides can only tighten clinic policy: voice off for yourself, stricter
 *  confirmations — never the reverse (merge rules in lib/voiceTranscription). */
function MyVoicePreferencesCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: raw } = useQuery<unknown>({
    queryKey: ["voice-user-preferences"],
    queryFn: () => api.get("/api/radiology/report-generator/voice-preferences"),
  });
  const prefs = parseVoiceUserPrefs(raw);
  const save = useMutation({
    mutationFn: (next: VoiceUserPrefs) => api.put("/api/radiology/report-generator/voice-preferences", next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-user-preferences"] });
      toast({ title: "Your voice preferences were saved" });
    },
    onError: (err: Error) => toast({ title: "Could not save preferences", description: err.message, variant: "destructive" }),
  });
  const patch = (p: Partial<VoiceUserPrefs>) => save.mutate({ ...prefs, ...p });

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4" data-testid="my-voice-prefs">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Mic size={16} className="text-primary" /> My Voice Preferences
      </h3>
      <p className="text-xs text-muted-foreground">
        Personal overrides for YOUR account, layered over the clinic defaults above. You can disable voice for
        yourself or make confirmations stricter — never the reverse. Provider and local-STT configuration stay
        clinic-wide.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Voice for me</Label>
          <select className="w-full h-9 text-sm border rounded-md px-2 bg-background"
            value={prefs.enabledOverride} onChange={(e) => patch({ enabledOverride: e.target.value as VoiceUserPrefs["enabledOverride"] })}>
            <option value="inherit">Clinic default</option>
            <option value="off">Off for me</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">My push-to-talk key</Label>
          <select className="w-full h-9 text-sm border rounded-md px-2 bg-background"
            value={prefs.pttKey} onChange={(e) => patch({ pttKey: e.target.value as VoiceUserPrefs["pttKey"] })}>
            <option value="inherit">Clinic default</option>
            <option value="Space">Space (held, outside text fields)</option>
            <option value="off">Off (buttons / Ctrl+Space only)</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">My default mode</Label>
          <select className="w-full h-9 text-sm border rounded-md px-2 bg-background"
            value={prefs.defaultMode} onChange={(e) => patch({ defaultMode: e.target.value as VoiceUserPrefs["defaultMode"] })}>
            <option value="inherit">Clinic default</option>
            <option value="command">Command mode</option>
            <option value="dictation">Dictation mode</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">My confirmation policy</Label>
          <select className="w-full h-9 text-sm border rounded-md px-2 bg-background"
            value={prefs.confirmationPolicy} onChange={(e) => patch({ confirmationPolicy: e.target.value as VoiceUserPrefs["confirmationPolicy"] })}>
            <option value="inherit">Clinic default</option>
            <option value="strict">Strict (confirm every edit) — stricter only</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">My recognition language</Label>
          <Input className="h-9 text-sm" defaultValue={prefs.language} key={`ul-${prefs.language}`}
            onBlur={(e) => { if (e.target.value.trim() !== prefs.language) patch({ language: e.target.value.trim() }); }}
            placeholder="empty = clinic default" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">My auto punctuation</Label>
          <select className="w-full h-9 text-sm border rounded-md px-2 bg-background"
            value={prefs.autoPunctuation} onChange={(e) => patch({ autoPunctuation: e.target.value as VoiceUserPrefs["autoPunctuation"] })}>
            <option value="inherit">Clinic default</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>
    </div>
  );
}
