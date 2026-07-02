import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
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
  Tv2, Zap, ShieldCheck, PlayCircle, Info, Palette
} from "lucide-react";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";

// Sub-panels imported or reconstructed for unified look
import { ModalityPanel } from "@/pages/ModalityManagement";
import { DicomNodesPanel } from "@/pages/DicomNodes";
import { AgentSetupPanel } from "@/pages/AgentSetup";
import { ArchiveLifecyclePanel } from "@/pages/PacsArchiveLifecycle";
import { AiInferencePanel } from "@/pages/AiInferenceSettings";
import { AiReportingPanel } from "@/pages/AiReportingSettings";
import { RadiologyStylePanel } from "@/pages/RadiologyStyleSettings";
import {
  AiImpressionCard, QualityCheckerCard, FollowUpRecommendationsCard,
  TemplateLearningCard, MultiLanguageCard, RoutingRulesCard,
  AmendmentManagerCard, SonographerModeCard, DicomSrExportCard,
} from "@/components/smartRadiology/SmartRadiologyCards";
import { RisMonitorCommandGrid } from "@/components/risMonitoring/RisMonitorCards";

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

export default function RadiologySettingsCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();
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

  // Auto detect closest profile based on network speed/reachability
  useEffect(() => {
    const probeNetwork = async () => {
      // 1. Probe LAN Orthanc first (fastest)
      try {
        const start = Date.now();
        const res = await fetch("http://192.168.1.137:8042/", { method: "HEAD", mode: "no-cors" });
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
        await fetch("http://100.65.255.115:8042/", { method: "HEAD", mode: "no-cors" });
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
  }, []);

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
          <TabsTrigger value="network"><Network size={14} className="mr-1.5" />Profiles</TabsTrigger>
          <TabsTrigger value="modalities"><Server size={14} className="mr-1.5" />Modalities</TabsTrigger>
          <TabsTrigger value="pacs"><Radio size={14} className="mr-1.5" />PACS Servers</TabsTrigger>
          <TabsTrigger value="viewers"><MonitorPlay size={14} className="mr-1.5" />Viewers</TabsTrigger>
          <TabsTrigger value="mwl"><Wrench size={14} className="mr-1.5" />DICOM &amp; MWL</TabsTrigger>
          <TabsTrigger value="reporting"><BrainCircuit size={14} className="mr-1.5" />AI &amp; Templates</TabsTrigger>
          <TabsTrigger value="style"><Palette size={14} className="mr-1.5" />Report Style</TabsTrigger>
          <TabsTrigger value="diagnostics"><Activity size={14} className="mr-1.5" />Diagnostics</TabsTrigger>
          <TabsTrigger value="history"><Info size={14} className="mr-1.5" />History</TabsTrigger>
          <TabsTrigger value="advanced"><ShieldAlert size={14} className="mr-1.5" />Advanced</TabsTrigger>
        </TabsList>

        {/* Tab content 1: Network Profiles */}
        <TabsContent value="network" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Badge className="bg-emerald-500">Profile 1</Badge>
                <span className="text-xs text-muted-foreground">Preferred for scanner sync</span>
              </div>
              <h3 className="font-semibold text-base">LAN Profile (Local Network)</h3>
              <p className="text-xs text-muted-foreground">
                Uses local IP addresses (`192.168.1.137`). High speed, secure, zero latency.
                Modality acquisition pushes (GE Voluson, CT, MRI) should strictly prefer this.
              </p>
              <div className="pt-2 text-xs font-mono text-muted-foreground space-y-1">
                <p>OHIF Base: http://192.168.1.137:3010</p>
                <p>Orthanc REST: http://192.168.1.137:8042</p>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Badge className="bg-blue-600">Profile 2</Badge>
                <span className="text-xs text-muted-foreground">Preferred for remote reporting</span>
              </div>
              <h3 className="font-semibold text-base">Tailscale VPN Profile</h3>
              <p className="text-xs text-muted-foreground">
                Connects through Tailscale network (`100.65.255.115`). Allows radiologist/owner to review
                studies and launch OHIF/Weasis outside the clinic network securely.
              </p>
              <div className="pt-2 text-xs font-mono text-muted-foreground space-y-1">
                <p>OHIF Base: http://100.65.255.115:3010</p>
                <p>Orthanc REST: http://100.65.255.115:8042</p>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Badge variant="outline">Profile 3</Badge>
                <span className="text-xs text-muted-foreground">Online portal fallback</span>
              </div>
              <h3 className="font-semibold text-base">Public Cloud Profile</h3>
              <p className="text-xs text-muted-foreground">
                Uses Cloudflare domain (`caredeoghar.com`) for secure patient booking, report delivery,
                and online billing desk tasks. Viewer access is disabled for speed &amp; transport privacy.
              </p>
              <div className="pt-2 text-xs font-mono text-muted-foreground space-y-1">
                <p>ERP URL: https://caredeoghar.com</p>
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
              {/* One-click fix for clinic LAN defaults */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-800">Set Clinic LAN Defaults</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Sets OHIF → <code className="bg-amber-100 px-1 rounded">192.168.1.137:3010</code> and
                    Weasis WADO → <code className="bg-amber-100 px-1 rounded">192.168.1.137:8042/wado</code>
                  </p>
                </div>
                <button
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md"
                  onClick={() => {
                    upsertSetting.mutate({ key: "ohif_base_url",               value: "http://192.168.1.137:3010",                                  category: "viewer" });
                    upsertSetting.mutate({ key: "dicom_web_base_url",           value: "http://192.168.1.137:3010/dicom-web",                         category: "viewer" });
                    upsertSetting.mutate({ key: "ohif_study_url_template",      value: "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}", category: "viewer" });
                    upsertSetting.mutate({ key: "wado_uri_base_url",            value: "http://192.168.1.137:8042/wado",                             category: "viewer" });
                    upsertSetting.mutate({ key: "weasis_wado_url",              value: "http://192.168.1.137:8042/wado",                             category: "viewer" });
                    upsertSetting.mutate({ key: "weasis_manifest_url_template", value: 'weasis://$dicom:get -w "http://192.168.1.137:8042/wado?requestType=WADO&studyUID={studyInstanceUID}&contentType=application/dicom"', category: "viewer" });
                    upsertSetting.mutate({ key: "viewer_mode",                  value: "BOTH",                                                       category: "viewer" });
                    upsertSetting.mutate({ key: "default_viewer",               value: "OHIF",                                                       category: "viewer" });
                  }}
                >
                  Set Defaults
                </button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">OHIF Viewer URL</Label>
                <Input
                  value={settings.find(s => s.key === "ohif_base_url")?.value ?? ""}
                  onChange={(e) => upsertSetting.mutate({ key: "ohif_base_url", value: e.target.value, category: "viewer" })}
                  className="h-9 text-sm"
                  placeholder="http://192.168.1.137:3010"
                />
                <p className="text-[11px] text-muted-foreground">Your NAS IP + port 3010 (where OHIF is running)</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Weasis Manifest / WADO URL</Label>
                <Input
                  value={settings.find(s => s.key === "weasis_wado_url")?.value ?? ""}
                  onChange={(e) => {
                    upsertSetting.mutate({ key: "weasis_wado_url",   value: e.target.value, category: "viewer" });
                    upsertSetting.mutate({ key: "wado_uri_base_url", value: e.target.value, category: "viewer" });
                  }}
                  className="h-9 text-sm"
                  placeholder="http://192.168.1.137:8042/wado"
                />
                <p className="text-[11px] text-muted-foreground">Orthanc WADO endpoint — your NAS IP + :8042/wado</p>
              </div>
            </div>
          </div>
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
        <TabsContent value="style" className="space-y-4">
          <RadiologyStylePanel />
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
