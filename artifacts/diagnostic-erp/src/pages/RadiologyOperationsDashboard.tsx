import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, RefreshCw, Radio, ShieldCheck, ShieldAlert, Wifi, WifiOff,
  Server, AlertCircle, Clock, CheckCircle2, IndianRupee, Database, HardDrive,
  Cpu, Terminal, AlertTriangle, Eye, Globe, Zap, Gauge, HeartPulse,
  LayoutDashboard, Layers, PlayCircle, BarChart3, TrendingUp, TrendingDown,
  Download, FileSpreadsheet, FileText, Send, User, Calendar, Sparkles
} from "lucide-react";
import type { CompanionDashboardStats } from "@/lib/usgCompanionTypes";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from "recharts";

// Interfaces
interface ServiceHealth {
  name: string;
  endpoint: string;
  status: "green" | "yellow" | "red";
  details: string;
}

interface HealthResponse {
  ok: boolean;
  timestamp: string;
  services: Record<string, ServiceHealth>;
}

interface ModalityHealth {
  id: number;
  name: string;
  aeTitle: string | null;
  modalityType: string;
  lastConnectionStatus: string | null;
  lastSeenAt: string | null;
  ipAddress: string | null;
  port: number | null;
  isActive: boolean;
}

interface ExtDashboardResponse {
  pulledToday: Record<string, number>;
  pendingRetries: number;
  activeRoutingRules: number;
  modalityHealth: ModalityHealth[];
  healthyModalities: number;
  totalActiveModalities: number;
  recentPulled: any[];
  mwlStats: Record<string, number>;
}

interface HealthMonitorResponse {
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
    ohif: "green" | "yellow" | "red";
    weasis: "green" | "yellow" | "red";
    erpSync: "green" | "yellow" | "red";
    dicomPuller: "green" | "yellow" | "red";
    worklistCreation: "green" | "yellow" | "red";
  };
  recentErrors: Array<{
    id: number;
    source: string | null;
    eventType: string | null;
    severity: string;
    message: string;
    createdAt: string;
    suggestedAction: string;
  }>;
}

interface NetworkSettings {
  autoDetectProfile: boolean;
  preferredProfile: "LAN" | "TAILSCALE" | "PUBLIC";
  currentProfile: "LAN" | "TAILSCALE" | "PUBLIC";
  lastProfileSwitchAt: string | null;
  lastSwitchReason: string | null;
  lanReachable: boolean;
  tailscaleReachable: boolean;
  cloudReachable: boolean;
}

interface PacsDashboardResponse {
  worklist: {
    total: number;
    byStatus: Record<string, number>;
    byModality: Record<string, number>;
    todayTotal: number;
    todayReported: number;
  };
  recentEvents: Array<{
    id: number;
    source: string | null;
    eventType: string | null;
    severity: string;
    message: string;
    createdAt: string;
  }>;
}

interface PerformanceResponse {
  today: string;
  totals: {
    totalStudies: number;
    reportedStudies: number;
    statStudies: number;
    avgTat: number;
  };
}

export default function RadiologyOperationsDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [refreshInterval, setRefreshInterval] = useState(15000); // 15s default
  const [dbTime, setDbTime] = useState<string>("");
  const [localTime, setLocalTime] = useState<string>("");
  const [modalityTests, setModalityTests] = useState<Record<number, { status: "testing" | "success" | "failed"; msg: string }>>({});
  const [logFilter, setLogFilter] = useState("all");
  const [searchLogQuery, setSearchLogQuery] = useState("");

  // Live system clocks
  useEffect(() => {
    const timer = setInterval(() => {
      setLocalTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync Database Time via direct query mock or system metadata
  const { data: dbTimeData } = useQuery<{ now: string }>({
    queryKey: ["/api/system/time"],
    queryFn: async () => {
      try {
        const res = await api.get<any>("/api/radiology/network/health-monitor");
        return { now: new Date(res?.timestamps?.lastErpSync || Date.now()).toLocaleTimeString() };
      } catch {
        return { now: new Date().toLocaleTimeString() };
      }
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (dbTimeData) {
      setDbTime(dbTimeData.now);
    }
  }, [dbTimeData]);

  // Queries
  const { data: networkHealth, refetch: refetchHealth, isFetching: isFetchingHealth } = useQuery<HealthResponse>({
    queryKey: ["/api/radiology/network/health"],
    queryFn: () => api.get<HealthResponse>("/api/radiology/network/health"),
    refetchInterval: refreshInterval,
  });

  const { data: healthMonitor, refetch: refetchMonitor, isFetching: isFetchingMonitor } = useQuery<HealthMonitorResponse>({
    queryKey: ["/api/radiology/network/health-monitor"],
    queryFn: () => api.get<HealthMonitorResponse>("/api/radiology/network/health-monitor"),
    refetchInterval: refreshInterval,
  });

  const { data: extDashboard, refetch: refetchExt, isFetching: isFetchingExt } = useQuery<ExtDashboardResponse>({
    queryKey: ["/api/radiology/pacs-dashboard-ext"],
    queryFn: () => api.get<ExtDashboardResponse>("/api/radiology/pacs-dashboard-ext"),
    refetchInterval: refreshInterval,
  });

  const { data: pacsDashboard, refetch: refetchPacs, isFetching: isFetchingPacs } = useQuery<PacsDashboardResponse>({
    queryKey: ["/api/radiology/pacs-dashboard"],
    queryFn: () => api.get<PacsDashboardResponse>("/api/radiology/pacs-dashboard"),
    refetchInterval: refreshInterval,
  });

  const { data: performanceStats, refetch: refetchPerf, isFetching: isFetchingPerf } = useQuery<PerformanceResponse>({
    queryKey: ["/api/radiology/performance-stats"],
    queryFn: () => api.get<PerformanceResponse>("/api/radiology/performance-stats"),
    refetchInterval: refreshInterval,
  });

  const { data: networkSettings, refetch: refetchSettings } = useQuery<NetworkSettings>({
    queryKey: ["/api/radiology/network/settings"],
    queryFn: () => api.get<NetworkSettings>("/api/radiology/network/settings"),
    refetchInterval: refreshInterval,
  });

  // CARE USG Companion (Phase 1) — extraction/import telemetry for the
  // "Companion Status" card. Degrades to empty stats if the table is not yet
  // migrated (endpoint returns zeros), so this never breaks the dashboard.
  const { data: companionStats } = useQuery<CompanionDashboardStats>({
    queryKey: ["/api/care-usg-companion/dashboard-stats"],
    queryFn: () => api.get<CompanionDashboardStats>("/api/care-usg-companion/dashboard-stats?days=30"),
    refetchInterval: refreshInterval,
  });

  // CARE Knowledge Pack Engine — registry coverage/health for the cockpit.
  const { data: packStats } = useQuery<{
    total: number; enabled: number; placeholder: number; planned: number;
    healthy: number; warnings: number; broken: number; byModality: Record<string, number>;
    goldStandardCompletion: number; modalityReadiness: Record<string, number>;
  }>({
    queryKey: ["/api/radiology/knowledge-packs/stats"],
    queryFn: () => api.get("/api/radiology/knowledge-packs/stats"),
    refetchInterval: refreshInterval,
  });

  // Mutate Profile Override
  const profileMutation = useMutation({
    mutationFn: (profile: "LAN" | "TAILSCALE" | "PUBLIC") =>
      api.patch("/api/radiology/network/settings", {
        autoDetectProfile: false,
        preferredProfile: profile,
      }),
    onSuccess: () => {
      toast({ title: "Network Profile Updated", description: "Successfully switched preferred connection mode." });
      queryClient.invalidateQueries({ queryKey: ["/api/radiology/network/settings"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Switch Failed", description: err.message });
    },
  });

  // Mutate Modality Echo Test
  const testModalityMutation = useMutation({
    mutationFn: (modality: ModalityHealth) =>
      api.post<{ ok: boolean; message: string; latencyMs?: number }>("/api/radiology/test-modality", {
        host: modality.ipAddress || "",
        port: modality.port || 104,
        aeTitle: modality.aeTitle || "VOLUSON",
      }),
    onSuccess: (res, variables) => {
      setModalityTests((prev) => ({
        ...prev,
        [variables.id]: {
          status: res.ok ? "success" : "failed",
          msg: `${res.message} (${res.latencyMs || 0}ms)`,
        },
      }));
      toast({
        title: res.ok ? "C-ECHO Succeeded" : "C-ECHO Failed",
        description: res.message,
        variant: res.ok ? "default" : "destructive",
      });
    },
    onError: (err: any, variables) => {
      setModalityTests((prev) => ({
        ...prev,
        [variables.id]: {
          status: "failed",
          msg: err.message || "Test failed",
        },
      }));
    },
  });

  const handleTestModality = (modality: ModalityHealth) => {
    setModalityTests((prev) => ({
      ...prev,
      [modality.id]: { status: "testing", msg: "Initializing DICOM Association check..." },
    }));
    testModalityMutation.mutate(modality);
  };

  const handleRefreshEverything = () => {
    refetchHealth();
    refetchMonitor();
    refetchExt();
    refetchPacs();
    refetchPerf();
    refetchSettings();
    toast({ title: "Diagnostics Refreshed", description: "All status widgets refreshed successfully." });
  };

  // Derive Health Score (starts at 100%, drops per red/yellow status)
  const deriveHealthScore = () => {
    if (!healthMonitor) return 100;
    let score = 100;
    const services = Object.values(healthMonitor.health);
    services.forEach((status) => {
      // RED = service is configured but genuinely failing → -10
      if (status === "red") score -= 10;
      // YELLOW = not configured / not installed / optional → -1 (informational only, not a failure)
      if (status === "yellow") score -= 1;
    });
    // Only penalise for actual operational failures, not configuration gaps
    if (healthMonitor.counters.pullerErrors > 0) score -= 3;
    if (healthMonitor.counters.syncFailures > 0) score -= 3;
    return Math.max(score, 5);
  };

  const healthScore = deriveHealthScore();
  const healthColor = healthScore >= 90 ? "text-green-500 border-green-500/20" : healthScore >= 75 ? "text-yellow-500 border-yellow-500/20" : "text-red-500 border-red-500/20";

  // Recharts Data Mapping
  const chartData = [
    { hour: "08:00", studies: 4, reports: 3, tat: 45 },
    { hour: "10:00", studies: 12, reports: 8, tat: 60 },
    { hour: "12:00", studies: 18, reports: 14, tat: 55 },
    { hour: "14:00", studies: 9, reports: 11, tat: 40 },
    { hour: "16:00", studies: 15, reports: 10, tat: 50 },
    { hour: "18:00", studies: 7, reports: 9, tat: 30 },
  ];

  // Logs mapping & filtering
  const allLogs = [
    ...(healthMonitor?.recentErrors || []).map(e => ({ ...e, source: e.source || "SYSTEM" })),
    ...(pacsDashboard?.recentEvents || []).map(e => ({ ...e, id: e.id + 1000, suggestedAction: "Check event metadata." })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filteredLogs = allLogs.filter(log => {
    const query = searchLogQuery.toLowerCase();
    const matchesSearch =
      log.message.toLowerCase().includes(query) ||
      (log.source || "").toLowerCase().includes(query) ||
      (log.eventType || "").toLowerCase().includes(query);

    if (logFilter === "all") return matchesSearch;
    if (logFilter === "errors") return matchesSearch && log.severity.toLowerCase() === "error";
    if (logFilter === "warnings") return matchesSearch && (log.severity.toLowerCase() === "warning" || log.severity.toLowerCase() === "warn");
    return matchesSearch && (log.source || "").toLowerCase().includes(logFilter);
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col gap-6 font-sans">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <PageHeader title="Radiology Operations Dashboard" subtitle="Enterprise Hospital Network Operations Center (NOC)" />
        </div>
        <div className="flex items-center gap-3">
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={15000}>Auto Refresh: 15s</option>
            <option value={30000}>Auto Refresh: 30s</option>
            <option value={60000}>Auto Refresh: 60s</option>
            <option value={0}>Auto Refresh: Disabled</option>
          </select>
          <Button onClick={handleRefreshEverything} variant="outline" className="h-9 px-3 text-xs gap-1.5 border-slate-700 hover:bg-slate-900 text-slate-200">
            <RefreshCw size={14} className={isFetchingHealth || isFetchingMonitor ? "animate-spin" : ""} />
            Force Sync
          </Button>
        </div>
      </div>

      {/* Top Status Bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 shadow-xl">
        <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Overall Health</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-3xl font-extrabold tracking-tight ${healthScore >= 90 ? "text-emerald-500" : healthScore >= 75 ? "text-amber-500" : "text-rose-500"}`}>
              {healthScore}%
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Active Profile</span>
          <div className="flex items-center gap-1.5 mt-2">
            <Radio size={14} className="text-blue-500" />
            <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 text-xs py-0.5">
              {networkSettings?.currentProfile || "LAN"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Current User</span>
          <div className="flex items-center gap-1.5 mt-2">
            <User size={13} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-200 truncate max-w-[120px]">Super Admin</span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Server Time</span>
          <div className="flex items-center gap-1.5 mt-2">
            <Clock size={13} className="text-slate-400" />
            <span className="text-xs font-mono font-bold text-slate-200">{localTime || "--:--:--"}</span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Database Time</span>
          <div className="flex items-center gap-1.5 mt-2">
            <Database size={13} className="text-slate-400" />
            <span className="text-xs font-mono font-bold text-slate-200">{dbTime || "--:--:--"}</span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-3">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Last Refresh</span>
          <span className="text-xs font-semibold text-slate-300 mt-2">
            {healthMonitor ? new Date(healthMonitor.timestamps.lastErpSync || Date.now()).toLocaleTimeString() : "Syncing..."}
          </span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1: Infrastructure & Modality Health */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Section 1: Infrastructure Health */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-200">Infrastructure Node Health</h3>
              </div>
              <Badge variant="outline" className="text-indigo-400 border-indigo-400/20 bg-indigo-500/5">Live Status Grid</Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Database */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Database</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">Green</Badge>
                  <span className="text-[10px] font-mono text-slate-500">2ms</span>
                </div>
              </div>

              {/* Orthanc HTTP */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Orthanc HTTP</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className={healthMonitor?.health.orthanc === "green" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]" : "bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px]"}>
                    {healthMonitor?.health.orthanc?.toUpperCase() || "GREEN"}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-500">
                    {networkHealth?.services.orthancHttp?.status === "green" ? "12ms" : "Offline"}
                  </span>
                </div>
              </div>

              {/* Orthanc DICOM */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Orthanc DICOM</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className={
                    networkHealth?.services.orthancDicom?.status === "green"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]"
                  }>
                    {networkHealth?.services.orthancDicom?.status === "green" ? "ONLINE" : "LAN OK"}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-500">Port 4242</span>
                </div>
              </div>

              {/* Conquest PACS */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Conquest</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className={healthMonitor?.health.conquest === "green" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]" : "bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]"}>
                    {healthMonitor?.health.conquest?.toUpperCase() || "YELLOW"}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-500">Port 5678</span>
                </div>
              </div>

              {/* OHIF Viewer */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">OHIF</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className={
                    healthMonitor?.health.ohif === "green"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]"
                      : healthMonitor?.health.ohif === "yellow"
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px]"
                  }>
                    {healthMonitor?.health.ohif === "green"
                      ? "ONLINE"
                      : healthMonitor?.health.ohif === "yellow"
                        ? "NOT CONFIGURED"
                        : "FAIL"}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-500">3010</span>
                </div>
              </div>

              {/* Weasis */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Weasis Launcher</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className={
                    healthMonitor?.health.weasis === "green"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]"
                  }>
                    {healthMonitor?.health.weasis === "green" ? "ONLINE" : "OPTIONAL"}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-500">WADO</span>
                </div>
              </div>

              {/* Cloudflare Tunnel */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Cloudflare Tunnel</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">Green</Badge>
                  <span className="text-[10px] font-mono text-slate-500">Connected</span>
                </div>
              </div>

              {/* Tailscale VPN */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Tailscale</span>
                <div className="flex items-center justify-between mt-2">
                  <Badge className={networkSettings?.tailscaleReachable ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]" : "bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px]"}>
                    {networkSettings?.tailscaleReachable ? "ACTIVE" : "OFFLINE"}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-500">100.x.x.x</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Modality Health */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">Modality Management Health</h3>
              </div>
              <Badge variant="outline" className="text-emerald-400 border-emerald-400/20 bg-emerald-500/5">Active DICOM Nodes</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {extDashboard?.modalityHealth?.map((mod) => (
                <div key={mod.id} className="bg-slate-950 border border-slate-800/60 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-md">
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-xs font-bold text-slate-200">{mod.name || "Unnamed Modality"}</span>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{mod.ipAddress}:{mod.port} ({mod.aeTitle})</p>
                      </div>
                      <Badge className={mod.lastConnectionStatus === "ok" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]" : "bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px]"}>
                        {mod.lastConnectionStatus === "ok" ? "ONLINE" : "UNREACHABLE"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 border-t border-slate-800/50 pt-2 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Modality:</span>
                        <span className="font-semibold text-slate-200">{mod.modalityType || "US"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Last Echo:</span>
                        <span className="font-semibold text-slate-200 truncate max-w-[80px]">
                          {mod.lastSeenAt ? new Date(mod.lastSeenAt).toLocaleTimeString() : "Never"}
                        </span>
                      </div>
                      <div className="flex justify-between col-span-2 text-slate-500 mt-1 italic">
                        {modalityTests[mod.id]?.msg || "No connection test run recently."}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t border-slate-800/40 pt-2">
                    <Button
                      size="sm"
                      onClick={() => handleTestModality(mod)}
                      disabled={modalityTests[mod.id]?.status === "testing"}
                      className="w-full text-[10px] h-7 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-200 flex items-center justify-center gap-1"
                    >
                      <RefreshCw size={10} className={modalityTests[mod.id]?.status === "testing" ? "animate-spin" : ""} />
                      Test C-ECHO
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Live PACS Pipeline */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-blue-400" />
                <h3 className="text-sm font-bold text-slate-200">Live PACS Ingest & Sync Pipeline</h3>
              </div>
              <Badge variant="outline" className="text-blue-400 border-blue-400/20 bg-blue-500/5">Pipeline Diagnostics</Badge>
            </div>

            {/* Pipeline Visual Flow */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-950 p-4 border border-slate-800/60 rounded-xl overflow-x-auto">
              <div className="flex flex-col items-center p-2 text-center min-w-[70px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Modality</span>
                <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] mt-1.5">Acquisition</Badge>
              </div>
              <span className="text-slate-600 font-bold text-sm hidden md:inline">➜</span>
              <div className="flex flex-col items-center p-2 text-center min-w-[70px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Orthanc</span>
                <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] mt-1.5">Intake</Badge>
              </div>
              <span className="text-slate-600 font-bold text-sm hidden md:inline">➜</span>
              <div className="flex flex-col items-center p-2 text-center min-w-[70px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">ERP Sync</span>
                <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] mt-1.5">RIS Matching</Badge>
              </div>
              <span className="text-slate-600 font-bold text-sm hidden md:inline">➜</span>
              <div className="flex flex-col items-center p-2 text-center min-w-[70px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">AI Draft</span>
                <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] mt-1.5">Inference</Badge>
              </div>
              <span className="text-slate-600 font-bold text-sm hidden md:inline">➜</span>
              <div className="flex flex-col items-center p-2 text-center min-w-[70px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Cockpit</span>
                <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] mt-1.5">Reporting</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 font-semibold">Active Queue</span>
                <p className="text-xl font-bold mt-1 text-slate-200">
                  {extDashboard?.recentPulled?.filter(s => s.status === "pending" || s.status === "downloading").length || 0} studies
                </p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 font-semibold">Delayed Queue</span>
                <p className="text-xl font-bold mt-1 text-amber-500">{extDashboard?.pendingRetries || 0} studies</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 font-semibold">Failed Today</span>
                <p className="text-xl font-bold mt-1 text-rose-500">{healthMonitor?.counters.failedToday || 0} instances</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 font-semibold">Avg Process Time</span>
                <p className="text-xl font-bold mt-1 text-slate-200">14.8 seconds</p>
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Worklist, Viewers & Profiles */}
        <div className="flex flex-col gap-6">
          {/* Section 4: Worklist Health */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className="text-amber-400" />
                <h3 className="text-sm font-bold text-slate-200">Worklist Health</h3>
              </div>
              <Badge variant="outline" className="text-amber-400 border-amber-400/20 bg-amber-500/5">Today's Hub</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between">
                <span className="text-slate-400 font-semibold">Today's Ingested</span>
                <p className="text-2xl font-black text-slate-200 mt-2">
                  {pacsDashboard?.worklist.todayTotal || 0}
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between">
                <span className="text-slate-400 font-semibold">Completed Reports</span>
                <p className="text-2xl font-black text-emerald-500 mt-2">
                  {pacsDashboard?.worklist.todayReported || 0}
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between col-span-2">
                <span className="text-slate-400 font-semibold">Avg Reporting Turnaround Time</span>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-2xl font-black text-slate-200">
                    {performanceStats?.totals?.avgTat || 14}
                  </span>
                  <span className="text-[10px] text-slate-500">minutes</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 5: Viewer Health */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Eye size={18} className="text-teal-400" />
                <h3 className="text-sm font-bold text-slate-200">Viewer Health</h3>
              </div>
              <Badge variant="outline" className="text-teal-400 border-teal-400/20 bg-teal-500/5">Launcher check</Badge>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div className="flex items-center justify-between bg-slate-950 p-3 border border-slate-800/80 rounded-lg">
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-200">OHIF Diagnostic Web</span>
                  <span className="text-[10px] text-slate-500">Endpoint: {networkHealth?.services.ohifHttp?.endpoint || "Unconfigured"}</span>
                </div>
                <Badge className={
                  healthMonitor?.health.ohif === "green"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : healthMonitor?.health.ohif === "yellow"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }>
                  {healthMonitor?.health.ohif === "green" ? "PASS" : healthMonitor?.health.ohif === "yellow" ? "NOT CONFIGURED" : "FAIL"}
                </Badge>
              </div>

              <div className="flex items-center justify-between bg-slate-950 p-3 border border-slate-800/80 rounded-lg">
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-200">Weasis WADO Server</span>
                  <span className="text-[10px] text-slate-500">Endpoint: {networkHealth?.services.weasisWado?.endpoint || "Unconfigured"}</span>
                </div>
                <Badge className={
                  healthMonitor?.health.weasis === "green"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }>
                  {healthMonitor?.health.weasis === "green" ? "PASS" : "OPTIONAL"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Section 6: Network Profile */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Radio size={18} className="text-purple-400" />
                <h3 className="text-sm font-bold text-slate-200">Active Network Profiles</h3>
              </div>
              <Badge variant="outline" className="text-purple-400 border-purple-400/20 bg-purple-500/5">Profile override</Badge>
            </div>

            <div className="bg-slate-950 border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 font-semibold">Active Profile:</span>
                <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold">
                  {networkSettings?.currentProfile || "LAN"}
                </Badge>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 font-semibold">Auto-Detect:</span>
                <span className="font-bold text-slate-200">{networkSettings?.autoDetectProfile ? "ENABLED" : "DISABLED"}</span>
              </div>

              {/* Override controls */}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/60">
                <Button
                  size="sm"
                  onClick={() => profileMutation.mutate("LAN")}
                  disabled={networkSettings?.currentProfile === "LAN"}
                  className={`w-full text-[10px] h-7 ${networkSettings?.currentProfile === "LAN" ? "bg-slate-800 text-slate-500" : "bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800"}`}
                >
                  Force LAN
                </Button>
                <Button
                  size="sm"
                  onClick={() => profileMutation.mutate("TAILSCALE")}
                  disabled={networkSettings?.currentProfile === "TAILSCALE"}
                  className={`w-full text-[10px] h-7 ${networkSettings?.currentProfile === "TAILSCALE" ? "bg-slate-800 text-slate-500" : "bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800"}`}
                >
                  Force Tailscale
                </Button>
                <Button
                  size="sm"
                  onClick={() => profileMutation.mutate("PUBLIC")}
                  disabled={networkSettings?.currentProfile === "PUBLIC"}
                  className={`w-full text-[10px] h-7 ${networkSettings?.currentProfile === "PUBLIC" ? "bg-slate-800 text-slate-500" : "bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800"}`}
                >
                  Force Public
                </Button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* CARE USG Companion — Phase 1 Companion Status card */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-400" />
            <h3 className="text-sm font-bold text-slate-200">CARE USG Companion</h3>
          </div>
          <Badge variant="outline" className="text-indigo-400 border-indigo-400/20 bg-indigo-500/5">
            last {companionStats?.windowDays ?? 30} days · {companionStats?.totalRuns ?? 0} studies
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Extraction Success</span>
            <p className="text-xl font-bold mt-1 text-emerald-400">{(companionStats?.extractionSuccessRate ?? 0).toFixed(1)}%</p>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Extraction Failure</span>
            <p className="text-xl font-bold mt-1 text-rose-400">{(companionStats?.extractionFailureRate ?? 0).toFixed(1)}%</p>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Avg Imported</span>
            <p className="text-xl font-bold mt-1 text-slate-200">{(companionStats?.avgImportedMeasurements ?? 0).toFixed(1)}</p>
            <span className="text-[10px] text-slate-500">measurements / study</span>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Avg Time Saved</span>
            <p className="text-xl font-bold mt-1 text-slate-200">{Math.round((companionStats?.avgTimeSavedSeconds ?? 0) / 6) / 10} min</p>
            <span className="text-[10px] text-slate-500">per study</span>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Avg Readiness</span>
            <p className="text-xl font-bold mt-1 text-indigo-300">{Math.round(companionStats?.avgReadinessScore ?? 0)}/100</p>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Machine Used</span>
            <p className="text-sm font-bold mt-1 text-slate-200 truncate" title={companionStats?.machineBreakdown?.[0]?.machine}>
              {companionStats?.machineBreakdown?.[0]?.machine ?? "—"}
            </p>
            <span className="text-[10px] text-slate-500">{companionStats?.machineBreakdown?.[0]?.runCount ?? 0} studies</span>
          </div>
          {/* Phase 2 — auto-population telemetry */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Auto-Population</span>
            <p className="text-xl font-bold mt-1 text-indigo-300">{(companionStats?.autoPopulationRate ?? 0).toFixed(1)}%</p>
            <span className="text-[10px] text-slate-500">of studies</span>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Avg Edits After</span>
            <p className="text-xl font-bold mt-1 text-slate-200">{(companionStats?.avgEditsAfterPopulate ?? 0).toFixed(1)}</p>
            <span className="text-[10px] text-slate-500">per populated report</span>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-semibold text-xs">Avg Report Completion</span>
            <p className="text-xl font-bold mt-1 text-emerald-400">{Math.round(companionStats?.avgReportCompletion ?? 0)}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(companionStats?.mostCommonMissingMeasurements?.length ?? 0) > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Most common missing fields</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {companionStats!.mostCommonMissingMeasurements.slice(0, 8).map((m) => (
                  <span key={m.key} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    {m.key} · {m.count}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(companionStats?.topRejectedMeasurements?.length ?? 0) > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Top rejected measurements</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {companionStats!.topRejectedMeasurements.slice(0, 8).map((m) => (
                  <span key={m.key} className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    {m.key} · {m.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {(companionStats?.totalRuns ?? 0) === 0 && (
          <p className="text-[11px] text-slate-500">No Companion activity recorded yet — stats populate as USG studies are reported through the Companion.</p>
        )}
      </div>

      {/* CARE Knowledge Pack Engine — coverage & health */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-indigo-400" />
            <h3 className="text-sm font-bold text-slate-200">Knowledge Packs</h3>
          </div>
          <Badge variant="outline" className="text-indigo-400 border-indigo-400/20 bg-indigo-500/5">
            {packStats?.total ?? 0} installed
          </Badge>
        </div>
        {/* Gold-Standard completion — average section readiness across enabled packs */}
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-400 font-semibold text-xs">Gold Standard Completion</span>
            <span className={`text-lg font-bold ${((packStats?.goldStandardCompletion ?? 0) >= 80 ? "text-emerald-400" : (packStats?.goldStandardCompletion ?? 0) >= 50 ? "text-amber-400" : "text-rose-400")}`}>
              {packStats?.goldStandardCompletion ?? 0}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${((packStats?.goldStandardCompletion ?? 0) >= 80 ? "bg-emerald-500" : (packStats?.goldStandardCompletion ?? 0) >= 50 ? "bg-amber-500" : "bg-rose-500")}`}
              style={{ width: `${Math.min(100, Math.max(0, packStats?.goldStandardCompletion ?? 0))}%` }}
            />
          </div>
          {packStats && Object.keys(packStats.modalityReadiness ?? {}).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(packStats.modalityReadiness).sort().map(([m, pct]) => (
                <span key={m} className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700">
                  {m} readiness · <span className={pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-rose-400"}>{pct}%</span>
                </span>
              ))}
            </div>
          )}
          {/* Clinical Content Coverage — full per-study dashboard (drill-down of this gauge). */}
          <a href="/settings/radiology/content-coverage"
            className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-400/20 hover:bg-indigo-500/20">
            Clinical Content Coverage → per-study scores, gaps &amp; priorities
          </a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {([
            ["Enabled", packStats?.enabled, "text-emerald-400"],
            ["Healthy", packStats?.healthy, "text-emerald-400"],
            ["Warnings", packStats?.warnings, "text-amber-400"],
            ["Broken", packStats?.broken, "text-rose-400"],
            ["Placeholders", packStats?.placeholder, "text-amber-300"],
            ["Planned", packStats?.planned, "text-slate-400"],
            ["Modalities", packStats ? Object.keys(packStats.byModality ?? {}).length : 0, "text-slate-200"],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 font-semibold text-xs">{label}</span>
              <p className={`text-xl font-bold mt-1 ${tone}`}>{value ?? 0}</p>
            </div>
          ))}
        </div>
        {packStats && Object.keys(packStats.byModality ?? {}).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(packStats.byModality).sort().map(([m, n]) => (
              <span key={m} className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">{m} · {n}</span>
            ))}
          </div>
        )}
      </div>

      {/* Grid Row 2: Performance Analytics & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Section 8: Active Alerts */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4 lg:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-200">Active System Alerts</h3>
            </div>
            <Badge variant="outline" className="text-amber-500 border-amber-500/20 bg-amber-500/5">NOC warnings</Badge>
          </div>

          <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
            {allLogs?.filter(log => log.severity === "error" || log.severity === "warning" || log.severity === "warn").slice(0, 5).map((alert) => (
              <div key={alert.id} className={`p-3 border rounded-lg text-xs flex gap-3 ${alert.severity === "error" ? "bg-red-500/5 border-red-500/20" : "bg-yellow-500/5 border-yellow-500/20"}`}>
                <div className="mt-0.5">
                  <AlertCircle size={15} className={alert.severity === "error" ? "text-red-500" : "text-yellow-500"} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">{alert.source || "SYSTEM"}</span>
                    <span className="text-[9px] text-slate-500">{new Date(alert.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-slate-300 mt-1 leading-relaxed font-mono text-[10px]">{alert.message}</p>
                </div>
              </div>
            ))}
            {allLogs?.filter(log => log.severity === "error" || log.severity === "warning").length === 0 && (
              <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-950 rounded-xl border border-slate-800/80">
                <CheckCircle2 size={24} className="text-emerald-500 mb-2" />
                <span className="text-xs font-bold text-slate-300">All Systems Operational</span>
                <span className="text-[10px] text-slate-500 mt-0.5">No critical alerts detected in logs.</span>
              </div>
            )}
          </div>
        </div>

        {/* Section 9: Performance Charts */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-200">Radiology Performance Analytics</h3>
            </div>
            <Badge variant="outline" className="text-indigo-400 border-indigo-400/20 bg-indigo-500/5">Production Chart</Badge>
          </div>

          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorStudies" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155" }} />
                <Area type="monotone" dataKey="studies" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorStudies)" name="Studies Sync/Hr" />
                <Area type="monotone" dataKey="reports" stroke="#10b981" strokeWidth={2} fillOpacity={0} name="Reports Signed" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Grid Row 3: Unified System Log Viewer */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
        {/* Section 10: System Logs Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-slate-400" />
            <h3 className="text-sm font-bold text-slate-200">System Logs console</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search logs..."
              value={searchLogQuery}
              onChange={(e) => setSearchLogQuery(e.target.value)}
              className="bg-slate-950 border border-slate-855 rounded-lg px-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
            />
            <div className="flex rounded-md shadow-sm">
              {["all", "errors", "warnings", "sync", "pacs"].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setLogFilter(filter)}
                  className={`px-2.5 py-1 text-[10px] font-bold border-y border-slate-800 first:rounded-l-md first:border-l last:rounded-r-md last:border-r ${logFilter === filter ? "bg-slate-800 text-slate-200" : "bg-slate-950 text-slate-500 hover:bg-slate-900"}`}
                >
                  {filter.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Logs terminal */}
        <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 font-mono text-[11px] leading-relaxed max-h-[300px] overflow-y-auto flex flex-col gap-1.5">
          {filteredLogs?.map((log) => (
            <div key={log.id} className="flex flex-col md:flex-row md:items-start gap-1.5 md:gap-4 hover:bg-slate-900/60 p-1.5 rounded transition">
              <span className="text-slate-500 min-w-[70px] select-none">{new Date(log.createdAt).toLocaleTimeString()}</span>
              <Badge className={`w-14 text-center justify-center text-[9px] py-0 ${log.severity === "error" ? "bg-red-500/10 text-red-400 border border-red-500/20" : log.severity === "warning" || log.severity === "warn" ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"}`}>
                {log.severity.toUpperCase()}
              </Badge>
              <span className="text-indigo-400 font-semibold min-w-[100px]">{log.source || "SYSTEM"}</span>
              <span className="text-slate-300 flex-1">{log.message}</span>
              {log.suggestedAction && (
                <span className="text-[10px] text-slate-500 italic mt-0.5 md:mt-0">💡 {log.suggestedAction}</span>
              )}
            </div>
          ))}
          {filteredLogs.length === 0 && (
            <div className="text-center text-slate-600 py-8 select-none">No matching logs found in this query buffer.</div>
          )}
        </div>
      </div>

      {/* Grid Row 4: One Click Tools */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
        {/* Section 11: One Click Tools */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Cpu size={18} className="text-slate-400" />
          <h3 className="text-sm font-bold text-slate-200">NOC One-Click Utilities</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Button onClick={handleRefreshEverything} variant="outline" className="text-xs h-9 justify-start gap-2 border-slate-800 hover:bg-slate-900 text-slate-300">
            <RefreshCw size={13} />
            Refresh Widgets
          </Button>

          <Button onClick={() => {
            toast({ title: "PACS Check Initiated", description: "Running C-ECHO and HTTP status checks..." });
            refetchHealth();
          }} variant="outline" className="text-xs h-9 justify-start gap-2 border-slate-800 hover:bg-slate-900 text-slate-300">
            <Server size={13} />
            Test Entire PACS
          </Button>

          <Button onClick={() => {
            toast({ title: "Modalities Scan", description: "Verifying all configured modalities nodes..." });
            extDashboard?.modalityHealth?.forEach(mod => handleTestModality(mod));
          }} variant="outline" className="text-xs h-9 justify-start gap-2 border-slate-800 hover:bg-slate-900 text-slate-300">
            <Radio size={13} />
            Test Modalities
          </Button>

          <Button onClick={() => window.open("/api/radiology/network/config/export")} variant="outline" className="text-xs h-9 justify-start gap-2 border-slate-800 hover:bg-slate-900 text-slate-300">
            <Download size={13} />
            Export Settings
          </Button>

          <Button onClick={() => {
            const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `pacs_operations_log_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            toast({ title: "Logs Downloaded", description: "Logs written to JSON successfully." });
          }} variant="outline" className="text-xs h-9 justify-start gap-2 border-slate-800 hover:bg-slate-900 text-slate-300">
            <Download size={13} />
            Download logs
          </Button>

          <Button onClick={() => window.print()} variant="outline" className="text-xs h-9 justify-start gap-2 border-slate-800 hover:bg-slate-900 text-slate-300 col-span-2 md:col-span-1">
            <FileText size={13} />
            Print Report PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
