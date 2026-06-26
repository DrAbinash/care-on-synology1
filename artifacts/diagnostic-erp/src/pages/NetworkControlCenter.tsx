import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession } from "@/lib/staffSession";
import { resolveActiveProfile, updateProfilePreference, getOhifUrl, getWeasisUrl, adaptUrlToProfile } from "@/lib/viewerService";
import {
  Activity,
  Server,
  Settings2,
  RefreshCw,
  Play,
  AlertTriangle,
  ArrowRight,
  Database,
  Monitor,
  Download,
  Terminal,
  Radio,
  ExternalLink,
  Save,
  ShieldCheck,
  Wrench,
  CheckCircle2,
  Info,
  Network
} from "lucide-react";

type ServiceHealth = {
  name: string;
  endpoint: string;
  status: "green" | "yellow" | "red";
  details: string;
};

type HealthResponse = {
  ok: boolean;
  timestamp: string;
  services: {
    orthancHttp: ServiceHealth;
    orthancDicom: ServiceHealth;
    ohifHttp: ServiceHealth;
    weasisWado: ServiceHealth;
    conquestDicom: ServiceHealth;
    ollamaAi: ServiceHealth;
  };
};

type Modality = {
  id: number;
  machineName: string;
  modality: string | null;
  aeTitle: string | null;
  ipAddress: string | null;
  port: number | null;
  destinationPacs?: string;
  lastConnectionStatus: string | null;
  lastSeenAt: string | null;
};

type NetworkConfig = {
  orthanc: {
    aeTitle: string;
    ip: string;
    dicomPort: number;
    httpPort: number;
    dicomWebUrl: string;
    wadoUrl: string;
  };
  conquest: {
    aeTitle: string;
    ip: string;
    dicomPort: number;
    wadoUrl: string;
  };
  erp: {
    lanUrl: string;
    internalApiUrl: string;
    hasApiKey: boolean;
  };
  ohif: {
    baseUrl: string;
    studyLaunchTemplate: string;
  };
  weasis: {
    wadoUrl: string;
    launchTemplate: string;
  };
};

type SettingsResponse = {
  ok: boolean;
  config: NetworkConfig;
  env: Record<string, boolean>;
};

type PacsErrorLog = {
  id: number;
  severity: string;
  source: string | null;
  message: string;
  createdAt: string;
  studyInstanceUid?: string | null;
  suggestedAction?: string;
};

type HealthMonitorResponse = {
  ok: boolean;
  timestamps: {
    lastStudyReceived: string | null;
    lastOrthancImport: string | null;
    lastErpSync: string | null;
    lastWorklistCreation: string | null;
    lastOhifLaunch: string | null;
    lastWeasisLaunch: string | null;
  };
  counters: {
    receivedToday: number;
    syncedToday: number;
    failedToday: number;
    launchFailures: number;
    syncFailures: number;
    pullerErrors: number;
  };
  health: {
    orthanc: "green" | "yellow" | "red";
    conquest: "green" | "yellow" | "red";
    erpSync: "green" | "yellow" | "red";
    ohif: "green" | "yellow" | "red";
    weasis: "green" | "yellow" | "red";
    dicomPuller: "green" | "yellow" | "red";
    worklistCreation: "green" | "yellow" | "red";
  };
  recentErrors: PacsErrorLog[];
};

export default function NetworkControlCenter() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<Record<string, string>>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [testingModalityId, setTestingModalityId] = useState<number | null>(null);

  const [activeProfile, setActiveProfile] = useState<"LAN" | "TAILSCALE" | "PUBLIC">("PUBLIC");
  const [whySelected, setWhySelected] = useState("Resolving active profile...");
  const [latency, setLatency] = useState(0);
  const [profileOverride, setProfileOverride] = useState<"auto" | "LAN" | "TAILSCALE" | "PUBLIC">("auto");
  const [stats, setStats] = useState({
    lastSuccessProfile: "—",
    lastSuccessViewer: "—",
    lastSuccessTime: "—",
    lastFailedTime: "—",
    lastFailedStage: "—",
    averageLaunchTime: 0,
    lastSwitchTime: "—"
  });

  const loadViewerMetrics = async () => {
    try {
      const settingsRows = await api.get<{ key: string; value: string; category: string }[]>("/api/radiology/pacs-settings");
      const settingsMap: Record<string, string> = {};
      for (const r of settingsRows) if (r.category === "viewer") settingsMap[r.key] = r.value;

      const { profile, reason, latencyMs } = await resolveActiveProfile(settingsMap);
      setActiveProfile(profile);
      setWhySelected(reason);
      setLatency(latencyMs);

      const session = readStaffSession();
      const dbProfile = session?.user?.pacsNetworkProfile;
      const localOverride = localStorage.getItem("pacs_network_profile");
      setProfileOverride((dbProfile || localOverride || "auto") as "auto" | "LAN" | "TAILSCALE" | "PUBLIC");

      setStats({
        lastSuccessProfile: localStorage.getItem("pacs_last_good_profile") || "—",
        lastSuccessViewer: localStorage.getItem("pacs_last_good_viewer") || "—",
        lastSuccessTime: formatTime(localStorage.getItem("pacs_last_success_time")),
        lastFailedTime: formatTime(localStorage.getItem("pacs_last_failed_time")),
        lastFailedStage: localStorage.getItem("pacs_last_failed_stage") || "—",
        averageLaunchTime: Number(localStorage.getItem("pacs_avg_launch_time") || "0"),
        lastSwitchTime: formatTime(localStorage.getItem("pacs_last_switch_time"))
      });
    } catch (e) {
      console.error("Failed to load viewer metrics", e);
    }
  };

  useEffect(() => {
    loadViewerMetrics();
    const interval = setInterval(loadViewerMetrics, 10000);
    return () => clearInterval(interval);
  }, []);

  // Queries
  const { data: settingsData, isLoading: settingsLoading } = useQuery<SettingsResponse>({
    queryKey: ["/api/radiology/network/settings"],
    queryFn: () => api.get<SettingsResponse>("/api/radiology/network/settings"),
  });

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth, isFetching: healthFetching } = useQuery<HealthResponse>({
    queryKey: ["/api/radiology/network/health"],
    queryFn: () => api.get<HealthResponse>("/api/radiology/network/health"),
    refetchInterval: 30000,
  });

  const { data: warningsData, refetch: refetchWarnings } = useQuery<{ ok: boolean; warnings: string[] }>({
    queryKey: ["/api/radiology/network/warnings"],
    queryFn: () => api.get<{ ok: boolean; warnings: string[] }>("/api/radiology/network/warnings"),
  });

  const { data: modalities, isLoading: modalitiesLoading, refetch: refetchModalities } = useQuery<Modality[]>({
    queryKey: ["/api/radiology/modalities"],
    queryFn: () => api.get<Modality[]>("/api/radiology/modalities"),
  });

  const { data: monitorData, refetch: refetchMonitor, isFetching: monitorFetching } = useQuery<HealthMonitorResponse>({
    queryKey: ["/api/radiology/network/health-monitor"],
    queryFn: () => api.get<HealthMonitorResponse>("/api/radiology/network/health-monitor"),
    refetchInterval: 15000,
  });

  // Mutations
  const updateSettingsMutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch("/api/radiology/network/settings", body),
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Radiology Network settings successfully updated." });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/radiology/network/settings"] });
      refetchHealth();
      refetchWarnings();
    },
    onError: (err: any) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    }
  });

  const testModalityMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/api/radiology/modalities/${id}/echo-test`, {}),
    onSuccess: (res: any) => {
      toast({
        title: res.ok ? "C-ECHO Succeeded" : "C-ECHO Failed",
        description: res.ok ? `Latency: ${res.latencyMs}ms (${res.message})` : res.error || "Connection timed out",
        variant: res.ok ? "default" : "destructive"
      });
      refetchModalities();
    },
    onError: (err: any) => {
      toast({ title: "Test Failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => {
      setTestingModalityId(null);
    }
  });

  // Sync settings response to edit form
  useEffect(() => {
    if (settingsData?.config) {
      const cfg = settingsData.config;
      setForm({
        orthanc_ae_title: cfg.orthanc.aeTitle,
        orthanc_ip: cfg.orthanc.ip,
        orthanc_dicom_port: String(cfg.orthanc.dicomPort),
        orthanc_http_port: String(cfg.orthanc.httpPort),
        orthanc_dicomweb_url: cfg.orthanc.dicomWebUrl,
        orthanc_wado_url: cfg.orthanc.wadoUrl,
        conquest_ae_title: cfg.conquest.aeTitle,
        conquest_ip: cfg.conquest.ip,
        conquest_port: String(cfg.conquest.dicomPort),
        conquest_wado_url: cfg.conquest.wadoUrl,
        ohif_base_url: cfg.ohif.baseUrl,
        ohif_study_url_template: cfg.ohif.studyLaunchTemplate,
        weasis_wado_url: cfg.weasis.wadoUrl,
        weasis_manifest_url_template: cfg.weasis.launchTemplate,
        erp_lan_url: cfg.erp.lanUrl,
        erp_internal_api_url: cfg.erp.internalApiUrl,
      });
    }
  }, [settingsData]);

  // Overall Health Summary Badge
  const getOverallHealth = () => {
    if (healthLoading) return { label: "Loading Probes...", color: "bg-muted text-muted-foreground" };
    if (!healthData?.ok) return { label: "Offline", color: "bg-red-500 text-white animate-pulse" };
    
    const services = Object.values(healthData.services);
    const redCount = services.filter(s => s.status === "red").length;
    const yellowCount = services.filter(s => s.status === "yellow").length;

    if (redCount > 0) return { label: "Critical Failure / Broken Route", color: "bg-red-500 text-white animate-pulse" };
    if (yellowCount > 0) return { label: "Degraded Warning Status", color: "bg-amber-500 text-white" };
    return { label: "Healthy / All Pathways Connected", color: "bg-emerald-500 text-white" };
  };

  const overallHealth = getOverallHealth();

  const handleSave = () => {
    const payload: Record<string, string> = {};
    Object.entries(form).forEach(([k, v]) => {
      if (v !== undefined) payload[k] = v;
    });
    updateSettingsMutation.mutate(payload);
  };

  const applySuggestedFix = (key: string, suggestedValue: string) => {
    if (window.confirm(`Are you sure you want to update '${key}' to suggested LAN value: '${suggestedValue}'?`)) {
      updateSettingsMutation.mutate({ [key]: suggestedValue });
    }
  };

  // Safe checks for settings that contain the bridge IP or wrong ports/hosts
  const checkSettingStatus = (key: string, val: string | undefined) => {
    if (!val) return { isWarning: true, message: "Missing setting value", suggest: null };
    if (val.includes("172.16.1.139") || val.includes("172.16.1.")) {
      let suggest = val.replace(/172\.16\.1\.139/g, "192.168.1.137");
      if (key === "ohif_base_url" && val.includes(":3000")) {
        suggest = suggest.replace(":3000", ":3010");
      }
      return { isWarning: true, message: "Needs Review (Docker Bridge IP detected)", suggest };
    }
    return { isWarning: false, message: "OK", suggest: null };
  };

  const triggerErpSyncTest = () => {
    toast({ title: "Testing Sync", description: "Triggering ERP data synchronization..." });
    api.post<{ ok: boolean; message: string }>("/api/sync/trigger", {})
      .then((res) => {
        toast({ title: "Sync Triggered", description: res.message || "Sync started successfully." });
      })
      .catch((err) => {
        toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
      });
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return "Never";
    try {
      const d = new Date(isoString);
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return "Invalid Date";
    }
  };

  const getHealthStatusDetails = (status: "green" | "yellow" | "red" | undefined) => {
    switch (status) {
      case "green":
        return {
          bg: "bg-emerald-950/40 border-emerald-800/40 text-emerald-400",
          dot: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse",
          label: "Green / Active"
        };
      case "yellow":
        return {
          bg: "bg-amber-950/40 border-amber-800/40 text-amber-400",
          dot: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse",
          label: "Yellow / Warning"
        };
      case "red":
      default:
        return {
          bg: "bg-red-950/40 border-red-800/40 text-red-400",
          dot: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse",
          label: "Red / Offline"
        };
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <PageHeader
          title="Radiology Network Control Center"
          subtitle="Live PACS reachability console, route flow visualizer, and centralized network manager."
        />
        <div className="flex items-center gap-3">
          <Badge className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${overallHealth.color}`}>
            {overallHealth.label}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              refetchHealth();
              refetchWarnings();
              refetchModalities();
              refetchMonitor();
              toast({ title: "Refreshing Probes", description: "Triggered live network diagnostics..." });
            }}
            disabled={healthFetching || monitorFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${(healthFetching || monitorFetching) ? "animate-spin" : ""}`} />
            Refresh Diagnostics
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Info className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" size={18} />
          <div>
            <h4 className="font-semibold text-sm">These settings have moved!</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              To simplify configuration and avoid profile/IP mismatches, all PACS, DICOM, Modality, and AI settings are now consolidated in the unified Settings Center.
            </p>
          </div>
        </div>
        <Button variant="default" size="sm" onClick={() => navigate("/radiology/settings-center")} className="shrink-0">
          Go to Settings Center
        </Button>
      </div>

      {/* Prevention Warnings Box */}
      {warningsData?.warnings && warningsData.warnings.length > 0 && (
        <div className="bg-red-50/80 border border-red-200 rounded-xl p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
            <AlertTriangle className="h-5 w-5 text-red-600 animate-bounce" />
            Detected System Vulnerabilities / Mismatches
          </div>
          <ul className="list-disc pl-5 text-xs text-red-600/90 space-y-1.5">
            {warningsData.warnings.map((w, idx) => (
              <li key={idx} className="leading-relaxed">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Master Flow Topology Diagram */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-lg space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500 animate-pulse" />
            Radiology Master Flow Topology
          </h3>
          <span className="text-[10px] text-slate-500 font-mono">Real-time Data Stream Status</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 items-center gap-8 py-6 relative">
          {/* Step 1: Modalities */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2 relative shadow-md">
            <Radio className="h-8 w-8 text-sky-400" />
            <span className="text-xs font-semibold">Imaging Modalities</span>
            <span className="text-[10px] text-slate-400 font-mono">CT, MRI, USG, X-Ray</span>
            <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 hidden lg:block z-10">
              <ArrowRight className="h-5 w-5 text-slate-600" />
            </div>
          </div>

          {/* Step 2: PACS / Storage Nodes */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2 relative shadow-md">
            <Server className="h-8 w-8 text-emerald-400" />
            <span className="text-xs font-semibold">PACS Archival</span>
            <span className="text-[10px] text-slate-400 font-mono">Orthanc / Conquest</span>
            <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 hidden lg:block z-10">
              <ArrowRight className="h-5 w-5 text-slate-600" />
            </div>
          </div>

          {/* Step 3: ERP Integration */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2 relative shadow-md">
            <Database className="h-8 w-8 text-indigo-400" />
            <span className="text-xs font-semibold">Care RIS/ERP</span>
            <span className="text-[10px] text-slate-400 font-mono">Intake Sync API</span>
            <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 hidden lg:block z-10">
              <ArrowRight className="h-5 w-5 text-slate-600" />
            </div>
          </div>

          {/* Step 4: Web Viewer Integration */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2 relative shadow-md">
            <Monitor className="h-8 w-8 text-purple-400" />
            <span className="text-xs font-semibold">Diagnostic Viewers</span>
            <span className="text-[10px] text-slate-400 font-mono">OHIF & Weasis</span>
            <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 hidden lg:block z-10">
              <ArrowRight className="h-5 w-5 text-slate-600" />
            </div>
          </div>

          {/* Step 5: Radiologist Reporting Command Center */}
          <div className="bg-slate-800/80 border border-indigo-900 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2 shadow-md ring-1 ring-indigo-500/20">
            <ShieldCheck className="h-8 w-8 text-amber-400" />
            <span className="text-xs font-semibold text-amber-300">Reporting Center</span>
            <span className="text-[10px] text-slate-400 font-mono">AI Assist / Finalize</span>
          </div>
        </div>
      </div>

      {/* PACS Health Monitor Dashboard */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-lg space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-2">
            <Activity className="h-4.5 w-4.5 text-emerald-400 animate-pulse" />
            PACS Health Monitor
          </h3>
          {(monitorFetching || healthFetching) && (
            <span className="text-xs text-slate-500 animate-pulse flex items-center gap-1.5 font-mono">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              Polling Live Metrics...
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Health Status Column */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Health Status</h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "Orthanc", key: "orthanc" as const },
                { name: "Conquest", key: "conquest" as const },
                { name: "ERP Sync", key: "erpSync" as const },
                { name: "OHIF", key: "ohif" as const },
                { name: "Weasis", key: "weasis" as const },
                { name: "DICOM Puller", key: "dicomPuller" as const },
                { name: "Worklist Creation", key: "worklistCreation" as const },
              ].map((service) => {
                const status = monitorData?.health?.[service.key] ?? "red";
                const details = getHealthStatusDetails(status);
                return (
                  <div
                    key={service.name}
                    className={`flex flex-col p-3 rounded-xl border ${details.bg} transition-all duration-300 hover:scale-[1.02]`}
                  >
                    <span className="text-[10px] uppercase font-bold tracking-wide opacity-80">{service.name}</span>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${details.dot}`} />
                      <span className="text-xs font-semibold">{details.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily Counters Column */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Daily Counters</h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Studies Received Today", value: monitorData?.counters?.receivedToday ?? 0, color: "text-sky-400" },
                { label: "Studies Synced Today", value: monitorData?.counters?.syncedToday ?? 0, color: "text-emerald-400" },
                { label: "Studies Failed Today", value: monitorData?.counters?.failedToday ?? 0, color: "text-red-400" },
                { label: "Viewer Launch Failures Today", value: monitorData?.counters?.launchFailures ?? 0, color: "text-amber-400" },
                { label: "ERP Sync Failures Today", value: monitorData?.counters?.syncFailures ?? 0, color: "text-rose-400" },
                { label: "DICOM Puller Errors Today", value: monitorData?.counters?.pullerErrors ?? 0, color: "text-red-300" },
              ].map((counter, idx) => (
                <div
                  key={idx}
                  className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3 flex flex-col justify-between hover:bg-slate-800/80 transition-colors"
                >
                  <span className="text-[10px] text-slate-400 font-semibold leading-tight">{counter.label}</span>
                  <span className={`text-2xl font-bold mt-2 font-mono ${counter.color}`}>{counter.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Operational Timestamps Column */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Operations Timestamps</h4>
            <div className="bg-slate-800/30 border border-slate-800/80 rounded-xl p-4 space-y-3 font-mono text-xs">
              {[
                { label: "Last Study Received", val: monitorData?.timestamps?.lastStudyReceived },
                { label: "Last Orthanc Import", val: monitorData?.timestamps?.lastOrthancImport },
                { label: "Last ERP Sync", val: monitorData?.timestamps?.lastErpSync },
                { label: "Last Worklist Creation", val: monitorData?.timestamps?.lastWorklistCreation },
                { label: "Last OHIF Launch", val: monitorData?.timestamps?.lastOhifLaunch },
                { label: "Last Weasis Launch", val: monitorData?.timestamps?.lastWeasisLaunch },
              ].map((t, idx) => (
                <div key={idx} className="flex justify-between items-center border-b border-slate-800/60 pb-1.5 last:border-0 last:pb-0">
                  <span className="text-[11px] text-slate-400 font-sans">{t.label}</span>
                  <span className="text-[11px] text-slate-200 font-semibold">{formatTime(t.val ?? null)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Errors Section (Terminal Style) */}
        <div className="space-y-3 border-t border-slate-850 pt-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-red-400" />
            Recent Errors & Warnings Log (Last 20)
          </h4>
          <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 font-mono text-[11px] max-h-72 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
            {!monitorData?.recentErrors || monitorData.recentErrors.length === 0 ? (
              <div className="text-slate-500 italic text-center py-4">No recent errors or warnings logged in PACS audit table.</div>
            ) : (
              monitorData.recentErrors.map((log) => {
                const isErr = log.severity?.toLowerCase() === "error";
                const color = isErr ? "text-red-400" : "text-amber-400";
                return (
                  <div key={log.id} className="flex flex-col gap-1 border-b border-slate-900/60 pb-2.5 last:border-0 last:pb-0 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">{formatTime(log.createdAt)}</span>
                      <span className={`font-bold ${color}`}>[{log.severity?.toUpperCase()}]</span>
                      <span className="text-slate-400">[{log.source || "UNKNOWN"}]</span>
                    </div>
                    <div className="text-slate-300 break-all pl-2 border-l border-slate-800">{log.message}</div>
                    {log.studyInstanceUid && (
                      <div className="text-[10px] text-slate-500 font-mono pl-2">
                        Affected Study UID: <span className="text-slate-400 select-all">{log.studyInstanceUid}</span>
                      </div>
                    )}
                    {log.suggestedAction && (
                      <div className="text-[10px] text-emerald-400 font-sans pl-2 italic">
                        Suggested Action: {log.suggestedAction}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Viewer Smart Routing & Auto-Detection Console */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-lg space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5 text-indigo-400 animate-pulse" />
            <div>
              <h3 className="text-sm font-semibold tracking-wider uppercase text-slate-400">
                Viewer Intelligent Routing Console
              </h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">Real-time profile selection &amp; latency analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Selected Mode:</span>
            {(["auto", "LAN", "TAILSCALE", "PUBLIC"] as const).map((profile) => (
              <Button
                key={profile}
                variant={profileOverride === profile ? "default" : "outline"}
                size="sm"
                className={`h-7 capitalize text-[11px] font-semibold ${
                  profileOverride === profile 
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white" 
                    : "border-slate-700 hover:bg-slate-800 text-slate-300"
                }`}
                onClick={async () => {
                  await updateProfilePreference(profile, toast);
                  loadViewerMetrics();
                }}
              >
                {profile}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Active Network Profile</span>
            <span className={`text-xl font-bold mt-2 ${activeProfile === "LAN" ? "text-emerald-400" : activeProfile === "TAILSCALE" ? "text-blue-400" : "text-amber-400"}`}>
              {activeProfile}
            </span>
            <span className="text-[10px] text-slate-500 mt-1 leading-relaxed font-sans">{whySelected}</span>
          </div>

          <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Active Host Target</span>
            <span className="text-lg font-bold font-mono mt-2 text-indigo-300">
              {activeProfile === "LAN" ? "192.168.1.137" : activeProfile === "TAILSCALE" ? "100.65.255.115" : "caredeoghar.com"}
            </span>
            <span className="text-[10px] text-slate-500 mt-1 leading-relaxed">Centralized PACS configuration</span>
          </div>

          <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Average Launch Time</span>
            <span className="text-xl font-bold font-mono mt-2 text-sky-400">
              {stats.averageLaunchTime > 0 ? `${stats.averageLaunchTime}ms` : "—"}
            </span>
            <span className="text-[10px] text-slate-500 mt-1 leading-relaxed">Calculated across successful starts</span>
          </div>

          <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Last Launch Result</span>
            <span className="text-xs font-semibold mt-2 font-mono text-slate-200">
              {stats.lastSuccessProfile !== "—" ? (
                <span className="text-emerald-400">Success (${stats.lastSuccessProfile} via ${stats.lastSuccessViewer})</span>
              ) : stats.lastFailedStage !== "—" ? (
                <span className="text-red-400">Failed (${stats.lastFailedStage})</span>
              ) : "—"}
            </span>
            <span className="text-[10px] text-slate-500 mt-1 leading-relaxed font-sans">
              Time: {stats.lastSuccessProfile !== "—" ? stats.lastSuccessTime : stats.lastFailedTime !== "—" ? stats.lastFailedTime : "—"}
            </span>
          </div>
        </div>

        {/* Resolved URL Checklist */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Resolved Routing Parameters (Active)</h4>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 font-mono text-xs space-y-3">
            <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-slate-800 pb-2">
              <span className="text-[11px] text-slate-400 font-sans">OHIF Viewer URL</span>
              <span className="text-[11px] text-slate-200 break-all select-all">
                {settingsData?.config?.ohif?.baseUrl ? adaptUrlToProfile(settingsData.config.ohif.baseUrl, activeProfile) + "/viewer?StudyInstanceUIDs={studyUID}" : "—"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-slate-800 pb-2">
              <span className="text-[11px] text-slate-400 font-sans">DICOMweb Endpoint</span>
              <span className="text-[11px] text-slate-200 break-all select-all">
                {settingsData?.config?.orthanc?.dicomWebUrl ? adaptUrlToProfile(settingsData.config.orthanc.dicomWebUrl, activeProfile) : "—"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-slate-800 pb-2">
              <span className="text-[11px] text-slate-400 font-sans">WADO Service URL</span>
              <span className="text-[11px] text-slate-200 break-all select-all">
                {settingsData?.config?.orthanc?.wadoUrl ? adaptUrlToProfile(settingsData.config.orthanc.wadoUrl, activeProfile) : "—"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-1">
              <span className="text-[11px] text-slate-400 font-sans">Weasis Protocol Target</span>
              <span className="text-[11px] text-slate-200 break-all select-all">
                {settingsData?.config?.weasis?.wadoUrl ? `weasis://$dicom:get -w "${adaptUrlToProfile(settingsData.config.weasis.wadoUrl, activeProfile)}" -r "studyUID={studyUID}"` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Hand: Config Editor Form */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-slate-500" />
                Network Config Settings
              </h3>
              <Button
                size="sm"
                variant={isEditing ? "destructive" : "default"}
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? "Cancel" : "Edit Config"}
              </Button>
            </div>

            {settingsLoading ? (
              <div className="text-sm text-slate-500">Loading configurations...</div>
            ) : (
              <div className="space-y-6">
                {/* Orthanc section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-indigo-600">Orthanc PACS</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">AE Title</label>
                      <Input
                        value={form.orthanc_ae_title || ""}
                        onChange={e => setForm({ ...form, orthanc_ae_title: e.target.value })}
                        disabled={!isEditing}
                        placeholder="ORTHANC"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">LAN IP / Host</label>
                      <Input
                        value={form.orthanc_ip || ""}
                        onChange={e => setForm({ ...form, orthanc_ip: e.target.value })}
                        disabled={!isEditing}
                        placeholder="192.168.1.137"
                        className="font-mono text-xs"
                      />
                      {checkSettingStatus("orthanc_ip", form.orthanc_ip).isWarning && (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-red-600 font-semibold">
                            {checkSettingStatus("orthanc_ip", form.orthanc_ip).message}
                          </span>
                          {checkSettingStatus("orthanc_ip", form.orthanc_ip).suggest && (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-[10px] text-sky-600 hover:text-sky-700 underline font-bold"
                              onClick={() => applySuggestedFix("orthanc_ip", checkSettingStatus("orthanc_ip", form.orthanc_ip).suggest!)}
                            >
                              Apply Suggested Fix
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">DICOM Listen Port</label>
                      <Input
                        value={form.orthanc_dicom_port || ""}
                        onChange={e => setForm({ ...form, orthanc_dicom_port: e.target.value })}
                        disabled={!isEditing}
                        placeholder="4242"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">HTTP REST Port</label>
                      <Input
                        value={form.orthanc_http_port || ""}
                        onChange={e => setForm({ ...form, orthanc_http_port: e.target.value })}
                        disabled={!isEditing}
                        placeholder="8042"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">DICOMWeb URL</label>
                      <Input
                        value={form.orthanc_dicomweb_url || ""}
                        onChange={e => setForm({ ...form, orthanc_dicomweb_url: e.target.value })}
                        disabled={!isEditing}
                        placeholder="http://192.168.1.137:8042/dicom-web"
                        className="font-mono text-xs"
                      />
                      {checkSettingStatus("orthanc_dicomweb_url", form.orthanc_dicomweb_url).isWarning && (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-red-600 font-semibold">
                            {checkSettingStatus("orthanc_dicomweb_url", form.orthanc_dicomweb_url).message}
                          </span>
                          {checkSettingStatus("orthanc_dicomweb_url", form.orthanc_dicomweb_url).suggest && (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-[10px] text-sky-600 hover:text-sky-700 underline font-bold"
                              onClick={() => applySuggestedFix("orthanc_dicomweb_url", checkSettingStatus("orthanc_dicomweb_url", form.orthanc_dicomweb_url).suggest!)}
                            >
                              Apply Suggested Fix
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Conquest section */}
                <div className="space-y-3 border-t pt-4">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-sky-600">Conquest PACS</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">AE Title</label>
                      <Input
                        value={form.conquest_ae_title || ""}
                        onChange={e => setForm({ ...form, conquest_ae_title: e.target.value })}
                        disabled={!isEditing}
                        placeholder="CONQUESTPACS"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">Host/IP Address</label>
                      <Input
                        value={form.conquest_ip || ""}
                        onChange={e => setForm({ ...form, conquest_ip: e.target.value })}
                        disabled={!isEditing}
                        placeholder="192.168.1.137"
                        className="font-mono text-xs"
                      />
                      {checkSettingStatus("conquest_ip", form.conquest_ip).isWarning && (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-red-600 font-semibold">
                            {checkSettingStatus("conquest_ip", form.conquest_ip).message}
                          </span>
                          {checkSettingStatus("conquest_ip", form.conquest_ip).suggest && (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-[10px] text-sky-600 hover:text-sky-700 underline font-bold"
                              onClick={() => applySuggestedFix("conquest_ip", checkSettingStatus("conquest_ip", form.conquest_ip).suggest!)}
                            >
                              Apply Suggested Fix
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">DICOM Port</label>
                      <Input
                        value={form.conquest_port || ""}
                        onChange={e => setForm({ ...form, conquest_port: e.target.value })}
                        disabled={!isEditing}
                        placeholder="5678"
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Viewers section */}
                <div className="space-y-3 border-t pt-4">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-purple-600">OHIF & Weasis Viewers</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">OHIF Base URL</label>
                      <Input
                        value={form.ohif_base_url || ""}
                        onChange={e => setForm({ ...form, ohif_base_url: e.target.value })}
                        disabled={!isEditing}
                        placeholder="http://192.168.1.137:3010"
                        className="font-mono text-xs"
                      />
                      {checkSettingStatus("ohif_base_url", form.ohif_base_url).isWarning && (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-red-600 font-semibold">
                            {checkSettingStatus("ohif_base_url", form.ohif_base_url).message}
                          </span>
                          {checkSettingStatus("ohif_base_url", form.ohif_base_url).suggest && (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-[10px] text-sky-600 hover:text-sky-700 underline font-bold"
                              onClick={() => applySuggestedFix("ohif_base_url", checkSettingStatus("ohif_base_url", form.ohif_base_url).suggest!)}
                            >
                              Apply Suggested Fix
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">Weasis WADO URL</label>
                      <Input
                        value={form.weasis_wado_url || ""}
                        onChange={e => setForm({ ...form, weasis_wado_url: e.target.value })}
                        disabled={!isEditing}
                        placeholder="http://192.168.1.137:8042/wado"
                        className="font-mono text-xs"
                      />
                      {checkSettingStatus("weasis_wado_url", form.weasis_wado_url).isWarning && (
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-red-600 font-semibold">
                            {checkSettingStatus("weasis_wado_url", form.weasis_wado_url).message}
                          </span>
                          {checkSettingStatus("weasis_wado_url", form.weasis_wado_url).suggest && (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-[10px] text-sky-600 hover:text-sky-700 underline font-bold"
                              onClick={() => applySuggestedFix("weasis_wado_url", checkSettingStatus("weasis_wado_url", form.weasis_wado_url).suggest!)}
                            >
                              Apply Suggested Fix
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ERP Sync section */}
                <div className="space-y-3 border-t pt-4">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-amber-600">Care RIS/ERP Endpoints</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">ERP LAN Url</label>
                      <Input
                        value={form.erp_lan_url || ""}
                        onChange={e => setForm({ ...form, erp_lan_url: e.target.value })}
                        disabled={!isEditing}
                        placeholder="http://192.168.1.137:8888"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[11px] text-slate-500 font-semibold block mb-1">Internal API URL</label>
                      <Input
                        value={form.erp_internal_api_url || ""}
                        onChange={e => setForm({ ...form, erp_internal_api_url: e.target.value })}
                        disabled={!isEditing}
                        placeholder="http://192.168.1.137:8888/api/internal"
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                    <Button onClick={handleSave}>
                      <Save className="h-4 w-4 mr-1.5" />
                      Save Network Config
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modalities Table */}
          <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-3 text-slate-700">
              <Radio className="h-4 w-4 text-sky-500" />
              Connected Imaging Modalities
            </h3>

            {modalitiesLoading ? (
              <div className="text-sm text-slate-400">Loading modalities registry...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                      <th className="p-3">Name</th>
                      <th className="p-3">AE Title</th>
                      <th className="p-3">IP / Host</th>
                      <th className="p-3">Port</th>
                      <th className="p-3">Preferred Route</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalities?.map(m => (
                      <tr key={m.id} className="border-b hover:bg-slate-50/50">
                        <td className="p-3 font-semibold text-slate-700">{m.machineName}</td>
                        <td className="p-3 font-mono">{m.aeTitle || "—"}</td>
                        <td className="p-3 font-mono">{m.ipAddress || "—"}</td>
                        <td className="p-3 font-mono">{m.port || "—"}</td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-[10px]">
                            {m.destinationPacs || "ORTHANC"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            className={`text-[10px] ${
                              m.lastConnectionStatus === "success"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-red-50 text-red-700 border-red-200"
                            }`}
                          >
                            {m.lastConnectionStatus === "success" ? "Online" : "Connection Error"}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-sky-600 hover:text-sky-700 font-semibold"
                            onClick={() => {
                              setTestingModalityId(m.id);
                              testModalityMutation.mutate(m.id);
                            }}
                            disabled={testingModalityId === m.id}
                          >
                            {testingModalityId === m.id ? (
                              <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3 mr-1 fill-current" />
                            )}
                            Echo
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Hand: Health Dashboard & Warnings */}
        <div className="space-y-6">
          {/* PACS Nodes Diagnostics */}
          <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-3 text-slate-700">
              <Server className="h-4 w-4 text-emerald-500" />
              PACS Servers Liveness
            </h3>

            {healthLoading ? (
              <div className="text-sm text-slate-400">Pinging PACS Nodes...</div>
            ) : (
              <div className="space-y-4">
                {healthData && Object.entries(healthData.services).map(([key, service]) => (
                  <div key={key} className="flex items-start justify-between border-b pb-3 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-800">{service.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]" title={service.endpoint}>
                        {service.endpoint}
                      </div>
                      <div className="text-[10px] text-slate-500 italic leading-relaxed">{service.details}</div>
                    </div>
                    <Badge
                      className={`text-[9px] font-bold ${
                        service.status === "green"
                          ? "bg-emerald-500 text-white"
                          : service.status === "yellow"
                          ? "bg-amber-500 text-white"
                          : "bg-red-500 text-white"
                      }`}
                    >
                      {service.status === "green" ? "ONLINE" : service.status === "yellow" ? "WARNING" : "DOWN"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conquest & Orthanc Hook Downloads */}
          <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-3 text-slate-700">
              <Terminal className="h-4 w-4 text-indigo-500" />
              ERP Hook Deployments
            </h3>

            <div className="space-y-4 text-xs">
              <div className="space-y-2">
                <div className="font-semibold text-slate-800">Conquest Intake Hook</div>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  Downloads <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">erp_notify.lua</code> with pre-configured target URLs and internal credentials to automatically populate worklists.
                </p>
                <Button
                  size="sm"
                  className="w-full bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200"
                  onClick={() => window.open("/api/radiology/network/lua-hook/conquest")}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download Conquest Lua Hook
                </Button>
              </div>

              <div className="space-y-2 border-t pt-4">
                <div className="font-semibold text-slate-800">Orthanc Intake Hook</div>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  Downloads <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">orthanc_erp_notify.lua</code> to forward new Orthanc instances instantly to the ERP PACS Worklist.
                </p>
                <Button
                  size="sm"
                  className="w-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                  onClick={() => window.open("/api/radiology/network/lua-hook/orthanc")}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download Orthanc Lua Hook
                </Button>
              </div>
            </div>
          </div>

          {/* Viewers & ERP Sync Diagnostics */}
          <div className="bg-white border rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-3 text-slate-700">
              <Activity className="h-4 w-4 text-amber-500" />
              Integration Triggers
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span>OHIF Viewer Status</span>
                <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">Standard Mode</Badge>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span>Weasis Protocol URL</span>
                <Badge variant="outline">weasis://</Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={triggerErpSyncTest}
              >
                Test ERP Sync Connection
              </Button>
              {settingsData?.config?.ohif?.baseUrl && (
                <Button
                  size="sm"
                  className="w-full bg-slate-50 text-slate-800 hover:bg-slate-100 border"
                  onClick={() => window.open(`${settingsData.config.ohif.baseUrl}`, "_blank")}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Launch OHIF Main Viewer
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
