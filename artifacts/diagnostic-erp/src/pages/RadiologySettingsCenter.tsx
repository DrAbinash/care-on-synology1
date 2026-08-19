import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import PresentationTemplateManager from "@/components/radiology/PresentationTemplateManager";
import ReportLayoutQuickSelect, {
  type ReportLayoutKey,
  quickSelectLayoutKey,
} from "@/components/radiology/ReportLayoutQuickSelect";
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
  Wrench, Activity, ShieldAlert,
  RefreshCw, Save,
  Zap, ShieldCheck, PlayCircle, Info, Palette, Mic, Waves, Cpu, BookOpen
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
import PacsViewerSetupWizard from "@/components/radiology/PacsViewerSetupWizard";

// Sub-panels imported or reconstructed for unified look
import { ModalityPanel } from "@/pages/ModalityManagement";
import { DicomNodesPanel } from "@/pages/DicomNodes";
import { AgentSetupPanel } from "@/pages/AgentSetup";
import PacsSettings from "@/pages/PacsSettings";
import { AiInferencePanel } from "@/pages/AiInferenceSettings";
import { AiReportingPanel } from "@/pages/AiReportingSettings";
import { RadiologyStylePanel } from "@/pages/RadiologyStyleSettings";
import { UsgExtractionPanel } from "@/pages/UsgAdminSettings";
import {
  AiImpressionCard, QualityCheckerCard, FollowUpRecommendationsCard,
  TemplateLearningCard, MultiLanguageCard, RoutingRulesCard,
} from "@/components/smartRadiology/SmartRadiologyCards";
import { RisMonitorCommandGrid } from "@/components/risMonitoring/RisMonitorCards";
import ViewerNetworkRoutesCard from "@/components/radiology/ViewerNetworkRoutesCard";
import { MwlStatusPanel } from "@/components/radiology/MwlStatusPanel";
import { MwlAcceptanceTestsPanel } from "@/components/radiology/MwlAcceptanceTestsPanel";
import { OllamaAiDraftVerifyPanel } from "@/components/radiology/OllamaAiDraftVerifyPanel";
import { RadiologyAdminOverviewPanel } from "@/components/radiology/RadiologyAdminOverviewPanel";
import { RadiologyDeploymentPanel } from "@/components/radiology/RadiologyDeploymentPanel";
import RadiologyQuickSelectSettings from "@/pages/RadiologyQuickSelectSettings";
import { RadiologyCatalogPanel } from "@/pages/RadiologyCatalogAdmin";

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

type MriWarmStatus = {
  enabled: boolean;
  mode: string;
  lastN: number;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastWarmed: number;
  lastFailed: number;
  lastSkipped: number;
  lastError: string | null;
  candidates: number;
  orthancReachable: boolean | null;
  pausedForPeakHours?: boolean;
};


function SpineFormatUpgradePanel({ disabled }: { disabled?: boolean }) {
  const { toast } = useToast();
  const upgrade = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; inserted: number; upgraded: number; findingsRemapped: number; message: string }>(
        "/api/radiology/structured-report-templates/upgrade-spine-formats",
        {},
      ),
    onSuccess: (res) => {
      toast({
        title: "Spine formats",
        description: res.message
          || `Inserted ${res.inserted}, upgraded ${res.upgraded}, remapped ${res.findingsRemapped}.`,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Spine upgrade failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-[11px]" data-testid="spine-format-upgrade">
      <p className="text-muted-foreground">
        Applies denser Cervical / Dorsal / LS anatomy sections to clinic presets and remaps Quick Select
        labels that still point at old bundled sections (e.g. “C2-C3 to C6-C7” → per-level / {"{level}"}).
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-[10px]"
        disabled={disabled || upgrade.isPending}
        onClick={() => upgrade.mutate()}
        data-testid="btn-upgrade-spine-formats"
      >
        <RefreshCw size={11} className={`mr-1 ${upgrade.isPending ? "animate-spin" : ""}`} />
        {upgrade.isPending ? "Upgrading…" : "Upgrade spine formats now"}
      </Button>
    </div>
  );
}

function MriWarmCacheStatusPanel() {
  const { toast } = useToast();
  const { data, refetch, isFetching } = useQuery<MriWarmStatus>({
    queryKey: ["mri-warm-cache-status"],
    queryFn: () => api.get("/api/radiology/mri-warm-cache/status"),
    refetchInterval: 30_000,
  });
  const runNow = useMutation({
    mutationFn: () => api.post("/api/radiology/mri-warm-cache/run", { force: true }),
    onSuccess: () => {
      void refetch();
      toast({ title: "MRI warm cache run started" });
    },
    onError: (err: Error) => toast({ title: "Warm cache failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-[11px]" data-testid="mri-warm-cache-status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-xs">Status</span>
        {data?.running ? (
          <Badge className="bg-amber-100 text-amber-800 border-amber-300">Running…</Badge>
        ) : data?.pausedForPeakHours ? (
          <Badge className="bg-sky-100 text-sky-800 border-sky-300">Paused 8am–4pm (billing priority)</Badge>
        ) : data?.orthancReachable === false ? (
          <Badge className="bg-red-100 text-red-800 border-red-300">Orthanc unreachable</Badge>
        ) : (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Idle</Badge>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[10px] ml-auto"
          disabled={runNow.isPending || data?.running}
          onClick={() => runNow.mutate()}
        >
          <RefreshCw size={11} className={`mr-1 ${isFetching || runNow.isPending ? "animate-spin" : ""}`} />
          Warm now
        </Button>
      </div>
      <p className="text-muted-foreground">
        Last run: {data?.lastRunAt ? new Date(data.lastRunAt).toLocaleString() : "—"}
        {data?.lastDurationMs != null ? ` · ${Math.round(data.lastDurationMs / 1000)}s` : ""}
        {" · "}warmed {data?.lastWarmed ?? 0}/{data?.candidates ?? 0}
        {(data?.lastSkipped ?? 0) > 0 ? ` · ${data?.lastSkipped} not in Orthanc yet` : ""}
        {(data?.lastFailed ?? 0) > 0 ? ` · ${data?.lastFailed} failed` : ""}
      </p>
      {data?.lastError && <p className="text-red-700">{data.lastError}</p>}
    </div>
  );
}

export default function RadiologySettingsCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(readStaffSession()?.user.role ?? ""));

  const SETTINGS_TABS = [
    "overview", "general", "reading-suite", "network", "modalities", "pacs", "pacs-advanced", "viewers", "mwl",
    "sync", "reporting", "usg-extraction", "quick-select", "content-catalog", "style", "premium", "voice",
    "diagnostics", "history", "deployment", "advanced",
  ] as const;

  const [activeTab, setActiveTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && (SETTINGS_TABS as readonly string[]).includes(t)) return t;
      // Aliases from old deep links
      if (t === "usg") return "usg-extraction";
      if (t === "dicom") return "mwl";
    } catch { /* ignore */ }
    return "overview";
  });

  function goTab(tab: string) {
    setActiveTab(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    } catch { /* ignore */ }
  }
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
  const [mwlSyncing, setMwlSyncing] = useState(false);
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
  /** R1.1 premium layout — active when the canonical template is care-premium
   *  or the legacy master switch is explicitly ON. */
  const premiumLayoutActive =
    sv("report_presentation_template") === "care-premium" ||
    sv("premium_layout_enabled") === "true";
  const activeReportLayout = quickSelectLayoutKey(
    sv("report_presentation_template") || (premiumLayoutActive ? "care-premium" : "care-classic"),
  );

  const upsertSetting = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/pacs-settings", {
      ...body,
      ...(changeReason.trim() ? { reason: changeReason.trim() } : {}),
    }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["pacs-settings"] });
      if ((variables as { key?: string }).key === "premium_layout_enabled"
        || (variables as { key?: string }).key === "report_presentation_template") {
        qc.invalidateQueries({ queryKey: ["presentation-templates"] });
      }
      toast({ title: "Configuration updated successfully" });
    },
    onError: (err: any) => toast({ title: "Failed to update configuration", description: err.message, variant: "destructive" }),
  });

  const setActiveReportLayout = (layout: ReportLayoutKey) => {
    const reason = layout === "care-premium" ? "Premium report layout activated" : "Classic report layout activated";
    upsertSetting.mutate({
      key: "report_presentation_template",
      value: layout,
      category: "premium",
      reason,
    });
    upsertSetting.mutate({
      key: "premium_layout_enabled",
      value: String(layout === "care-premium"),
      category: "premium",
      reason,
    });
  };

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
        subtitle="Admin hub for PACS, viewers, MWL, report style, voice, and USG — start on the General tab"
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

      {/* Navigation tabs — primary IA first, then clinical/content, then diagnostics */}
      <Tabs value={activeTab} onValueChange={goTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1 rounded-lg">
          <TabsTrigger value="overview"><Activity size={14} className="mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="pacs"><Radio size={14} className="mr-1.5" />PACS Server</TabsTrigger>
          <TabsTrigger value="viewers"><MonitorPlay size={14} className="mr-1.5" />Viewer</TabsTrigger>
          <TabsTrigger value="mwl"><Wrench size={14} className="mr-1.5" />MWL</TabsTrigger>
          <TabsTrigger value="modalities"><Server size={14} className="mr-1.5" />Modalities</TabsTrigger>
          <TabsTrigger value="sync"><RefreshCw size={14} className="mr-1.5" />Sync</TabsTrigger>
          <TabsTrigger value="usg-extraction"><Waves size={14} className="mr-1.5" />USG</TabsTrigger>
          <TabsTrigger value="quick-select"><Zap size={14} className="mr-1.5" />Quick Select</TabsTrigger>
          <TabsTrigger value="content-catalog"><BookOpen size={14} className="mr-1.5" />Content Catalog</TabsTrigger>
          <TabsTrigger value="reporting"><BrainCircuit size={14} className="mr-1.5" />AI</TabsTrigger>
          <TabsTrigger value="diagnostics"><Activity size={14} className="mr-1.5" />Diagnostics</TabsTrigger>
          <TabsTrigger value="deployment"><ShieldAlert size={14} className="mr-1.5" />Deployment</TabsTrigger>
          <TabsTrigger value="general"><ShieldCheck size={14} className="mr-1.5" />General</TabsTrigger>
          <TabsTrigger value="reading-suite"><BookOpen size={14} className="mr-1.5" />Reading Suite</TabsTrigger>
          <TabsTrigger value="network"><Network size={14} className="mr-1.5" />Profiles</TabsTrigger>
          <TabsTrigger value="pacs-advanced"><Server size={14} className="mr-1.5" />PACS Full</TabsTrigger>
          <TabsTrigger value="style"><Palette size={14} className="mr-1.5" />Report Style</TabsTrigger>
          <TabsTrigger value="premium"><Zap size={14} className="mr-1.5" />Premium</TabsTrigger>
          <TabsTrigger value="voice"><Mic size={14} className="mr-1.5" />Voice</TabsTrigger>
          <TabsTrigger value="history"><Info size={14} className="mr-1.5" />History</TabsTrigger>
          <TabsTrigger value="advanced"><ShieldAlert size={14} className="mr-1.5" />Advanced</TabsTrigger>
        </TabsList>

        {isAdmin && (
          <div className="rounded-lg border bg-muted/30 p-3 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs font-semibold">Change reason (optional — appears in History tab)</Label>
              <Input
                className="h-8 mt-1 text-sm"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="e.g. Updated OHIF URL after NAS migration"
              />
            </div>
            <p className="text-[11px] text-muted-foreground max-w-md">
              Applied to the next PACS/viewer/premium setting you save on this page.
            </p>
          </div>
        )}

        {/* ── Overview (canonical landing) ── */}
        <TabsContent value="overview" className="space-y-4">
          <RadiologyAdminOverviewPanel onGotoTab={goTab} />
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-3">
              All radiology / USG / PACS / MWL admin settings live on this page. Old sidebar entries and deep links redirect here.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {([
                { tab: "pacs", title: "PACS Server", desc: "Orthanc endpoints & AE" },
                { tab: "viewers", title: "Viewer", desc: "OHIF / Weasis / network routes" },
                { tab: "mwl", title: "MWL", desc: "Worklist status & sync" },
                { tab: "sync", title: "Sync", desc: "Poller / agents / duplicate warning" },
                { tab: "usg-extraction", title: "USG", desc: "Extraction & companion" },
                { tab: "quick-select", title: "Quick Select", desc: "Finding chips & macros" },
                { tab: "reporting", title: "AI", desc: "Reporting & inference" },
                { tab: "deployment", title: "Deployment", desc: "Read-only env values" },
              ] as const).map((card) => (
                <button
                  key={card.tab}
                  type="button"
                  onClick={() => goTab(card.tab)}
                  className="text-left rounded-lg border bg-muted/20 hover:bg-muted/50 p-3 transition-colors"
                >
                  <div className="text-xs font-semibold">{card.title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{card.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Tab content 1: Network Profiles */}
        {/* ── Phase E: GENERAL — plain-language everyday options ── */}
        <TabsContent value="general" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-3" data-testid="radiology-settings-overview">
            <div>
              <h3 className="text-sm font-bold">Radiology Settings Center — start here</h3>
              <p className="text-xs text-muted-foreground mt-1">
                This is the main admin hub for PACS, viewers, MWL, report style, voice, and USG extraction.
                Browser-only productivity toggles live under Settings → Radiology Flags; server roadmap switches under Feature Flags.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {([
                { tab: "network", title: "Network profiles", desc: "LAN / Tailscale / Public routing for Orthanc & viewers" },
                { tab: "pacs", title: "PACS servers", desc: "Orthanc / Conquest endpoints and AE titles" },
                { tab: "viewers", title: "Viewers", desc: "OHIF & Weasis launch URLs and diagnostics" },
                { tab: "mwl", title: "DICOM & MWL", desc: "Modality worklist sync and status" },
                { tab: "style", title: "Report style", desc: "Letterhead, fonts, and print chrome" },
                { tab: "voice", title: "Voice", desc: "Dictation provider and radiologist prefs" },
                { tab: "usg-extraction", title: "USG extraction", desc: "Measurement / SR extraction for ultrasound" },
                { tab: "reporting", title: "AI & templates", desc: "AI reporting panels and template helpers" },
                { tab: "diagnostics", title: "Diagnostics", desc: "Live health checks for PACS services" },
              ] as const).map((card) => (
                <button
                  key={card.tab}
                  type="button"
                  onClick={() => goTab(card.tab)}
                  className="text-left rounded-lg border bg-muted/20 hover:bg-muted/50 p-3 transition-colors"
                  data-testid={`radiology-settings-goto-${card.tab}`}
                >
                  <div className="text-xs font-semibold">{card.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{card.desc}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate("/settings?tab=radiology")}>
                ERP Settings → Radiology
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate("/settings?tab=feature-flags")}>
                Server Feature Flags
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate("/radiology/reporting-workspace")}>
                Open Reporting Workspace
              </Button>
            </div>
          </div>
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
                <p className="text-[11px] text-muted-foreground">Moved to <button type="button" className="underline text-primary" onClick={() => goTab("reading-suite")}>Reading Suite</button> — default OFF for trial.</p>
              </div>
              <Switch checked={svOn("report_final_lock", false)} disabled={!isAdmin}
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
          <div className="rounded-xl border bg-muted/30 p-4 space-y-2 max-w-2xl" data-testid="name-gender-extras-moved">
            <h3 className="text-sm font-bold">Patient name → Sex suggestion</h3>
            <p className="text-xs text-muted-foreground">
              Moved to <Link href="/settings?tab=clinic" className="text-primary underline">General Settings → Clinic Info</Link> so registration Sex pre-fill is configured alongside clinic identity, not under Radiology.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-2 max-w-2xl">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Related settings</h4>
            <div className="flex flex-wrap gap-2 text-sm">
              <button type="button" className="text-primary hover:underline" onClick={() => goTab("quick-select")}>Quick Select</button>
              <span className="text-muted-foreground">·</span>
              <button type="button" className="text-primary hover:underline" onClick={() => goTab("usg-extraction")}>USG Settings</button>
              <span className="text-muted-foreground">·</span>
              <button type="button" className="text-primary hover:underline" onClick={() => goTab("advanced")}>HL7 / Advanced</button>
              <span className="text-muted-foreground">·</span>
              <a href="/radiology/structured-report-templates" className="text-primary hover:underline">Structured templates</a>
              <span className="text-muted-foreground">·</span>
              <a href="/radiology/normal-templates" className="text-primary hover:underline">Normal one-click templates</a>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reading-suite" className="space-y-4" data-testid="reading-suite-tab">
          <div className="rounded-xl border bg-card p-5 space-y-2 max-w-3xl">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <BookOpen size={16} className="text-sky-600" /> Reading Suite
            </h3>
            <p className="text-xs text-muted-foreground">
              One place for Worklist + Reporting Workspace behaviour. Trial defaults favour speed over hard locks —
              tighten these when you go live with a multi-reader roster.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-4 max-w-3xl">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Permissions &amp; safety</h4>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <Label className="text-xs font-semibold">Lock report after Final sign-off</Label>
                <p className="text-[11px] text-muted-foreground">
                  OFF (trial default): you can keep editing after Finalize. ON: Final/Amended reports become read-only in the workspace.
                </p>
              </div>
              <Switch checked={svOn("report_final_lock", false)} disabled={!isAdmin}
                onCheckedChange={(v) => upsertSetting.mutate({ key: "report_final_lock", value: String(v), category: "radiology" })} />
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <Label className="text-xs font-semibold">Relax concurrent study locks</Label>
                <p className="text-[11px] text-muted-foreground">
                  ON (trial default): owners/radiologists can keep typing even if another session holds the study lock.
                  Turn OFF for strict single-reader safety.
                </p>
              </div>
              <Switch checked={svOn("report_relax_study_locks", true)} disabled={!isAdmin}
                onCheckedChange={(v) => upsertSetting.mutate({ key: "report_relax_study_locks", value: String(v), category: "radiology" })} />
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-4 max-w-3xl">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Worklist queue</h4>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <Label className="text-xs font-semibold">Highlight Urgent / VIP studies</Label>
                <p className="text-[11px] text-muted-foreground">Tints STAT / EMERGENCY / URGENT / VIP rows on the Worklist.</p>
              </div>
              <Switch checked={svOn("urgent_highlight_enabled")} disabled={!isAdmin}
                onCheckedChange={(v) => upsertSetting.mutate({ key: "urgent_highlight_enabled", value: String(v), category: "radiology" })} />
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
              <p className="text-[11px] text-muted-foreground">Red “waiting” badge on studies not finalized within this window.</p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Modality quick filter (USG / MRI / More) lives on the <button type="button" className="underline text-primary" onClick={() => navigate("/radiology/worklist")}>Worklist</button>, not the reporting editor.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-4 max-w-3xl">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">MRI study warm cache</h4>
            <p className="text-[11px] text-muted-foreground">
              Speeds up Reporting Workspace MRI opens by touching today+yesterday (or last N) MR studies in Orthanc
              every ~10 minutes after 4pm IST, and by prefetching DICOMweb metadata in the browser when the queue loads
              outside clinic hours. Automatic warm + browser prefetch pause 08:00–16:00 IST so billing and USG DICOM
              send (C-STORE) keep Orthanc. Use “Warm now” if a radiologist needs MRI opens sped up during the day.
              Pixel data stays in Orthanc — nothing heavy is stored in the ERP database.
            </p>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <Label className="text-xs font-semibold">Enable MRI warm cache</Label>
                <p className="text-[11px] text-muted-foreground">ON (trial default). Auto-runs after 4pm IST. Disable if Orthanc load is a concern overnight.</p>
              </div>
              <Switch checked={svOn("mri_warm_cache_enabled", true)} disabled={!isAdmin}
                onCheckedChange={(v) => upsertSetting.mutate({ key: "mri_warm_cache_enabled", value: String(v), category: "radiology" })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Selection mode</Label>
                <select
                  className="h-8 w-full text-xs border rounded-md px-2 bg-background"
                  disabled={!isAdmin}
                  value={sv("mri_warm_cache_mode", "today_yesterday")}
                  onChange={(e) => upsertSetting.mutate({ key: "mri_warm_cache_mode", value: e.target.value, category: "radiology" })}
                >
                  <option value="today_yesterday">Today + Yesterday (auto-refresh daily)</option>
                  <option value="last_n">Last N MRI cases</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Last N (when mode = Last N)</Label>
                <Input
                  type="number" min={5} max={50} className="h-8 text-sm w-32"
                  placeholder="20"
                  defaultValue={sv("mri_warm_cache_last_n", "20")}
                  onBlur={(e) => upsertSetting.mutate({ key: "mri_warm_cache_last_n", value: e.target.value.trim() || "20", category: "radiology" })}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <MriWarmCacheStatusPanel />
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-4 max-w-3xl">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Spine format upgrade</h4>
            <p className="text-[11px] text-muted-foreground">
              Expands Cervical / Dorsal / LS structured templates to per-level anatomy (C2–C7, T1–T12, L1–S1)
              and remaps Quick Select sections that still point at old bundled labels like “C2-C3 to C6-C7”.
              Safe to run more than once — only upgrades when the new preset has more sections.
            </p>
            <SpineFormatUpgradePanel disabled={!isAdmin} />
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3 max-w-3xl">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reporting content &amp; tools</h4>
            <div className="grid sm:grid-cols-2 gap-2 text-sm">
              {[
                { tab: "quick-select", label: "Quick Select (findings & protocols)" },
                { tab: "content-catalog", label: "Content catalog (canonical API)" },
                { href: "/radiology/structured-report-templates", label: "Structured templates" },
                { href: "/radiology/normal-templates", label: "Normal one-click templates" },
                { tab: "reporting", label: "AI reporting" },
                { tab: "usg-extraction", label: "USG extraction admin" },
                { href: "/settings/radiology/knowledge-packs", label: "Knowledge packs" },
                { href: "/radiology/reporting-workspace", label: "Open Reporting Workspace" },
                { href: "/radiology/worklist", label: "Open Worklist" },
              ].map((l) => (
                <button
                  key={l.tab ?? l.href}
                  type="button"
                  className="text-left rounded-lg border px-3 py-2 hover:bg-muted/50 text-primary"
                  onClick={() => (l.tab ? goTab(l.tab) : navigate(l.href!))}
                >
                  {l.label}
                </button>
              ))}
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

        {/* PACS / DICOM (Full) — the complete PACS/DICOM/viewer/MWL/routing/
            connection-test configuration, embedded from the former standalone
            PacsSettings page (now retired) so there is ONE settings entry point. */}
        <TabsContent value="pacs-advanced" className="space-y-4">
          <PacsSettings embedded />
        </TabsContent>

        {/* Tab content 4: Viewers */}
        <TabsContent value="viewers" className="space-y-4">
          <PacsViewerSetupWizard
            lanIpHint={settings.find((s) => s.key === "lan_host")?.value ?? ""}
            setSetting={(key, value) => upsertSetting.mutate({ key, value, category: "viewer" })}
            onSaved={() => void qc.invalidateQueries({ queryKey: ["pacs-settings"] })}
          />
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <MonitorPlay size={16} className="text-primary" />
              Viewer Selection &amp; launch configuration
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold">Default PACS Viewer</label>
                <select
                  value={settings.find(s => s.key === "default_viewer")?.value ?? "WEASIS"}
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
                  real address instead of assuming 172.16.1.139, which is
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
                    const lanIp = window.prompt("Enter your clinic's LAN IP (e.g. 172.16.1.139) — never a Docker bridge IP like 172.17.x.x:");
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
                    upsertSetting.mutate({ key: "default_viewer",               value: "WEASIS",                                                       category: "viewer" });
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

              {/* Internal Orthanc URL — never invent Docker hostnames; see Deployment tab. */}
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Server-side Orthanc URL</p>
                <p className="text-[11px] text-muted-foreground">
                  Browser launch URLs are edited above. The API&apos;s <code className="font-mono">ORTHANC_INTERNAL_URL</code> is
                  deployment-owned (often a LAN IP when ERP and Orthanc are on separate Docker networks).
                  {" "}
                  <button type="button" className="underline text-primary" onClick={() => goTab("deployment")}>
                    View resolved value on Deployment tab
                  </button>
                  — never invent a Docker service hostname when ERP and Orthanc are on separate networks.
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
        <TabsContent value="mwl" className="space-y-4" data-testid="settings-radiology-mwl">
          <MwlStatusPanel
            isAdmin={isAdmin}
            syncing={mwlSyncing}
            onSync={async () => {
              setMwlSyncing(true);
              try {
                const r = await api.post<{ total: number; written: number; removed: number }>("/api/radiology/mwl-worklist/sync", {});
                toast({ title: "MWL sync complete", description: `${r.written} written, ${r.removed} removed (${r.total} procedures)` });
                void qc.invalidateQueries({ queryKey: ["mwl-deployment-status"] });
                void qc.invalidateQueries({ queryKey: ["radiology-admin-overview"] });
                if (r.written === 0 && r.total > 0) {
                  toast({
                    title: "MWL sync wrote 0 files",
                    description: "Check staging/live mounts and atomic rename (EXDEV) on the MWL tab.",
                    variant: "destructive",
                  });
                }
              } catch (e: unknown) {
                toast({ title: "MWL sync failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
              } finally {
                setMwlSyncing(false);
              }
            }}
          />
          <MwlAcceptanceTestsPanel />
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Wrench size={16} className="text-primary" />
                  How it works
                </h3>
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info size={14} className="mt-0.5 shrink-0 text-primary" />
                  <p>
                    <strong>Bill USG</strong> → ERP writes patient name + accession to a shared folder →
                    <strong> USG machine C-FINDs</strong> the worklist → technologist selects patient (no re-typing) →
                    scan ends → <strong>Orthanc</strong> → ERP matches accession → queue completes + reporting worklist updates.
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Alternative: Windows MWL agent queries <code className="font-mono bg-muted px-1 rounded">GET /api/internal/radiology/mwl</code> — see Agent Setup panel →
                </p>
                <p className="text-[11px] text-muted-foreground">
                  DICOM auto-puller schedules are configured under <strong>PACS Servers</strong>.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Sync / Automation — workers + agent setup (moved from sidebar Agent Setup) */}
        <TabsContent value="sync" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
            Prefer a single Orthanc→ERP intake path. If both <code className="font-mono">ORTHANC_CHANGES_POLLER</code> and
            care-erp-sync are active, you may get duplicate study notifications — check the Overview tab.
            Storage paths are not editable here (care-pacs owns Orthanc storage).
            {" "}
            <button type="button" className="underline text-primary" onClick={() => goTab("overview")}>Open Overview</button>
            {" · "}
            <button type="button" className="underline text-primary" onClick={() => goTab("mwl")}>Open MWL status</button>
          </div>
          <AgentSetupPanel />
        </TabsContent>

        {/* Tab content 6: AI & Templates */}
        <TabsContent value="reporting" className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <BrainCircuit size={16} className="text-purple-600" />
                  Radiology AI Settings
                </h3>
                {/* Ollama endpoint (primary/fallback), model, timeout, and the
                    Local AI enable toggle live in ONE place — the "Local AI" tab
                    of the panel to the right — so there is exactly one working
                    save path (POST /api/clinic-settings/ollama) instead of two
                    UIs writing the same columns through different, inconsistently
                    validated code paths. */}
                <div className="flex items-start gap-2 p-3 rounded-lg border bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
                  <Info size={14} className="text-purple-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Ollama endpoint (primary/fallback), model, timeout, and the AI-enabled toggle are configured
                    in the <strong>Local AI</strong> tab of the AI Reporting panel, on the right.
                  </p>
                </div>

                <OllamaAiDraftVerifyPanel compact />

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
                  onClick={async () => {
                    try {
                      const r = await api.post<{ total: number; written: number; removed: number }>("/api/radiology/mwl-worklist/sync", {});
                      toast({ title: "MWL sync complete", description: `${r.written} written, ${r.removed} removed` });
                    } catch (e: unknown) {
                      toast({ title: "MWL sync failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
                    }
                  }}
                >
                  Sync MWL Worklist Now
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
              Choose the clinic-wide report layout below. All print, PDF, and workspace preview surfaces use the same canonical server renderer. Radiologists can still compare layouts in the Reading Room preview without changing this default.
            </p>
            <ReportLayoutQuickSelect
              value={activeReportLayout}
              activeKey={activeReportLayout}
              disabled={!isAdmin}
              onChange={setActiveReportLayout}
              className="max-w-md"
            />
            <div className="grid md:grid-cols-2 gap-2">
              {([
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
                  <Switch
                    checked={svOn(key, false)}
                    disabled={!isAdmin}
                    onCheckedChange={(v) => upsertSetting.mutate({ key, value: String(v), category: "premium" })}
                  />
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
              These sizes apply to clinic-branded templates (Hope, Government, CARE V2).
              CARE Classic and CARE Premium take logo size and the St. Francis address from the
              presentation template above — edit that template’s letter-pad fields to change the printed pad.
              For logo left/right on clinic-branded templates, use the Style controls further down.
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

        {/* Tab content 8.7: USG extraction pipeline */}
        <TabsContent value="usg-extraction" className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Canonical home for USG admin settings. Old routes <code className="font-mono">/radiology/usg-admin-settings</code> and
            <code className="font-mono"> /usg/settings</code> redirect here.
          </div>
          <UsgExtractionPanel />
        </TabsContent>

        {/* Quick Select (was /settings/radiology-quick-select) */}
        <TabsContent value="quick-select" className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Canonical home for Quick Select. Old route <code className="font-mono">/settings/radiology-quick-select</code> redirects here.
          </div>
          <RadiologyQuickSelectSettings />
        </TabsContent>

        {/* Canonical catalog API (findings, parameters, aliases) — ff_radiology_catalog */}
        <TabsContent value="content-catalog" className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Canonical finding/parameter graph at <code className="font-mono">/api/radiology/catalog</code>.
            Legacy Quick Select tiles, structured templates, and techniques stay on their own pages (see Hub tab).
          </div>
          <RadiologyCatalogPanel embedded />
        </TabsContent>

        {/* Deployment — read-only env */}
        <TabsContent value="deployment" className="space-y-4">
          <RadiologyDeploymentPanel />
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

          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Cpu size={16} className="text-primary" />
              Radiology admin tools (moved from sidebar)
            </h3>
            <p className="text-xs text-muted-foreground">
              Deep tools keep their routes; discovery is here and under Settings → Radiology Tools.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { href: "/radiology/advanced-tools", label: "Advanced Tools catalog" },
                { href: "/radiology/network-control-center", label: "Network Control" },
                { tab: "pacs-advanced", label: "DICOM Nodes / PACS Full" },
                { tab: "modalities", label: "Modalities" },
                { href: "/radiology/dicom-agent-dashboard", label: "DICOM Agent" },
                { href: "/radiology/watchdog", label: "Watchdog" },
                { href: "/radiology/hl7-settings", label: "HL7 Settings" },
                { tab: "reporting", label: "AI Reporting" },
                { href: "/radiology/ai-prompt-manager", label: "AI Prompt Manager" },
                { href: "/radiology/ai-comparison", label: "AI Comparison" },
                { href: "/radiology/missed-finding-detector", label: "Missed Finding Detector" },
                { href: "/radiology/image-review", label: "Image Review" },
                { href: "/radiology/provider-fallback", label: "Provider Fallback" },
                { href: "/settings/radiology/knowledge-packs", label: "Knowledge Packs" },
                { href: "/teaching-cases", label: "Teaching Files" },
              ].map((item) => (
                <Button
                  key={item.tab ?? item.href}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => (item.tab ? goTab(item.tab) : navigate(item.href!))}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={() => navigate("/settings?tab=radiology")}
            >
              Open Settings → Radiology Tools hub
            </Button>
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
              placeholder="http://172.16.1.139:9000 (empty = off)" />
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
