import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  BrainCircuit, Eye, EyeOff, Save, TestTube2, RefreshCw, ShieldCheck,
  Key, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle,
  BookOpen, Settings2, Users, FileText, Wifi, WifiOff, Zap, Gauge, Moon,
} from "lucide-react";
import OvernightAiSettings from "@/components/ai/OvernightAiSettings";

// ─── Types ────────────────────────────────────────────────────────────────────
interface GlobalSettings {
  enabled: boolean;
  defaultProvider: string;
  defaultPrompt: string;
  defaultPromptTemplate: string;
  includeDemographics: boolean;
  anonymize: boolean;
  allowedRoles: string[];
}

interface ProviderInfo {
  provider: string;
  isEnabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  hasEndpointUrl: boolean;
  defaultModel: string | null;
  endpointUrl: string | null;
  label: string;
  needsApiKey: boolean;
  needsEndpointUrl: boolean;
  defaultModels: string[];
  placeholder: string;
}

interface SettingsResponse {
  global: GlobalSettings;
  providers: Record<string, ProviderInfo>;
  promptTemplates: string[];
}

interface ProviderDraft {
  isEnabled: boolean;
  isDefault: boolean;
  apiKey: string;
  endpointUrl: string;
  defaultModel: string;
  showKey: boolean;
  testStatus: "idle" | "testing" | "ok" | "fail";
  testMessage: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200 dark:border-green-800",
  gemini: "from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800",
  anthropic: "from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border-orange-200 dark:border-orange-800",
  ollama: "from-purple-50 to-violet-50 dark:from-purple-950/20 dark:to-violet-950/20 border-purple-200 dark:border-purple-800",
};

const ALL_ROLES = ["admin", "super_admin", "doctor", "radiologist", "technician", "receptionist"];

const SECTION_LABELS: Record<string, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
  doctor: "Doctor",
  radiologist: "Radiologist",
  technician: "Technician",
  receptionist: "Receptionist",
};

/** Admin diagnostics for PaddleOCR worker + Ollama (staff-auth API). */
function PipelineDiagnosticsPanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [testOut, setTestOut] = useState<Record<string, unknown> | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const h = await api.get<Record<string, unknown>>("/api/ai-pipeline/health");
      setHealth(h);
    } catch (e) {
      toast({ title: "Pipeline health failed", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      const r = await api.post<Record<string, unknown>>("/api/ai-pipeline/test", { dryRun: true, mode: "OCR_ONLY" });
      setTestOut(r);
      toast({ title: "Pipeline test complete", description: "Non-PHI OCR-only dry run" });
    } catch (e) {
      toast({ title: "Pipeline test failed", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const ollama = (health?.ollama ?? null) as { reachable?: boolean; installedModels?: string[]; selected?: Record<string, string> } | null;
  const paddle = (health?.paddle ?? null) as {
    ok?: boolean; paddle_loaded?: boolean; device_actual?: string; gpu_available?: boolean;
    profiles_ready?: string[]; active_jobs?: number; last_error?: string | null;
  } | null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">OCR / AI Pipeline Diagnostics</p>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy} onClick={() => void refresh()}>
            {busy ? <RefreshCw size={10} className="animate-spin" /> : <Wifi size={10} />} Refresh
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy} onClick={() => void runTest()}>
            <TestTube2 size={10} /> Test (OCR only)
          </Button>
        </div>
      </div>
      {health && (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className={`rounded border px-2 py-1.5 ${ollama?.reachable ? "border-green-300 bg-green-50 dark:bg-green-950/20" : "border-red-300 bg-red-50 dark:bg-red-950/20"}`}>
            <p className="font-semibold">Ollama</p>
            <p>{ollama?.reachable ? "reachable" : "unreachable"} · {(ollama?.installedModels ?? []).length} models</p>
            <p className="font-mono truncate">std: {ollama?.selected?.standard ?? "—"}</p>
          </div>
          <div className={`rounded border px-2 py-1.5 ${paddle?.ok ? "border-green-300 bg-green-50 dark:bg-green-950/20" : "border-amber-300 bg-amber-50 dark:bg-amber-950/20"}`}>
            <p className="font-semibold">PaddleOCR worker</p>
            <p>{paddle?.paddle_loaded ? "loaded" : "not loaded"} · device {paddle?.device_actual ?? "?"}</p>
            <p>GPU {paddle?.gpu_available ? "yes" : "no"} · jobs {paddle?.active_jobs ?? 0}</p>
          </div>
        </div>
      )}
      {testOut && (
        <pre className="text-[10px] bg-background border rounded p-2 overflow-auto max-h-40">{JSON.stringify(testOut, null, 2)}</pre>
      )}
      <p className="text-[10px] text-muted-foreground">
        AI drafts are never final medical reports — radiologist approval required. Set OCR_WORKER_URL on the Synology API to the Windows PC (:8090).
      </p>
    </div>
  );
}

// ─── ProviderCard ─────────────────────────────────────────────────────────────
function ProviderCard({
  name,
  meta,
  draft,
  onChange,
  onTest,
}: {
  name: string;
  meta: ProviderInfo;
  draft: ProviderDraft;
  onChange: (d: Partial<ProviderDraft>) => void;
  onTest: () => void;
}) {
  const color = PROVIDER_COLORS[name] ?? "bg-muted/50 border-muted";
  const models = meta.defaultModels ?? [];
  const needsApiKey = meta.needsApiKey ?? false;

  return (
    <div className={`rounded-xl border bg-gradient-to-br p-5 space-y-4 ${color}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">{meta.label}</h3>
          {draft.isDefault && (
            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-semibold">DEFAULT</span>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-muted-foreground">Enable</span>
          <div
            className={`relative w-10 h-5 rounded-full transition-colors ${draft.isEnabled ? "bg-primary" : "bg-muted"}`}
            onClick={() => onChange({ isEnabled: !draft.isEnabled })}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${draft.isEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
        </label>
      </div>

      {/* API Key or Endpoint URL */}
      <div className="space-y-1.5">
        {needsApiKey ? (
          <>
            <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Key size={11} /> API Key
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={draft.showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(e) => onChange({ apiKey: e.target.value })}
                  placeholder={draft.apiKey ? "••••••••••••••••" : `Enter ${meta.label} API key (${meta.placeholder})`}
                  className="w-full h-9 px-3 pr-9 text-xs rounded-lg border bg-background font-mono"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => onChange({ showKey: !draft.showKey })}
                >
                  {draft.showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Leave blank to keep existing key. Only updated when you type a new one.</p>
          </>
        ) : (
          <>
            <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Key size={11} /> Endpoint URL
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={draft.endpointUrl}
                  onChange={(e) => onChange({ endpointUrl: e.target.value })}
                  placeholder={draft.endpointUrl ? draft.endpointUrl : `Enter ${meta.label} endpoint (${meta.placeholder})`}
                  className="w-full h-9 px-3 pr-9 text-xs rounded-lg border bg-background font-mono"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Leave blank to keep existing URL. Only updated when you type a new one.</p>
          </>
        )}
      </div>

      {/* Default Model */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">Default Model</label>
        <div className="flex gap-2">
          <select
            value={draft.defaultModel}
            onChange={(e) => onChange({ defaultModel: e.target.value })}
            className="flex-1 h-9 px-3 text-xs rounded-lg border bg-background"
          >
            <option value="">-- select model --</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {draft.defaultModel && !models.includes(draft.defaultModel) && (
              <option value={draft.defaultModel}>{draft.defaultModel} (custom)</option>
            )}
          </select>
          <input
            type="text"
            value={draft.defaultModel}
            onChange={(e) => onChange({ defaultModel: e.target.value })}
            placeholder="or type custom model name"
            className="w-48 h-9 px-3 text-xs rounded-lg border bg-background font-mono"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={draft.testStatus === "testing"}
          onClick={onTest}
        >
          {draft.testStatus === "testing" ? (
            <><RefreshCw size={11} className="animate-spin" /> Testing…</>
          ) : (
            <><TestTube2 size={11} /> Test Connection</>
          )}
        </Button>

        {draft.testStatus === "ok" && (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle2 size={13} /> Connected
          </span>
        )}
        {draft.testStatus === "fail" && (
          <span className="flex items-center gap-1 text-xs text-red-600 font-medium max-w-xs truncate">
            <XCircle size={13} /> {draft.testMessage || "Connection failed"}
          </span>
        )}

        <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={draft.isDefault}
            onChange={(e) => onChange({ isDefault: e.target.checked })}
            className="w-3.5 h-3.5"
          />
          <span className="text-xs text-muted-foreground">Set as default provider</span>
        </label>
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export function AiReportingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeSection, setActiveSection] = useState<
    "general" | "providers" | "prompts" | "permissions" | "local-ai" | "overnight"
  >("general");

  // Local AI settings state
  const [localAi, setLocalAi] = useState({
    primaryUrl: "http://192.168.1.250:11434",
    fallbackUrl: "http://172.16.1.140:11434",
    model: "gemma3:4b",
    enabled: false,
    localOnly: true,
    timeoutSeconds: 30,
    auditEnabled: true,
  });
  const [localAiTestStatus, setLocalAiTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [localAiTestMsg, setLocalAiTestMsg] = useState("");
  const [localAiProbing, setLocalAiProbing] = useState(false);
  const [localAiProbeResult, setLocalAiProbeResult] = useState<{ url: string; reachable: boolean }[]>([]);
  const [localAiSaving, setLocalAiSaving] = useState(false);

  async function handleLocalAiProbe() {
    setLocalAiProbing(true);
    try {
      const r = await api.post<{ results: { url: string; reachable: boolean }[]; recommendedUrl: string | null }>(
        "/api/radiology-ollama/probe", {}
      );
      setLocalAiProbeResult(r.results);
      if (r.recommendedUrl) {
        setLocalAi((s) => ({ ...s, primaryUrl: r.recommendedUrl! }));
        toast({ title: `Auto-detected: ${r.recommendedUrl}` });
      } else {
        toast({ title: "No Ollama endpoint reachable", description: "Ensure Ollama is running on the Windows PC.", variant: "destructive" });
      }
    } catch { toast({ title: "Probe failed", variant: "destructive" }); }
    setLocalAiProbing(false);
  }

  async function handleLocalAiTest() {
    setLocalAiTestStatus("testing"); setLocalAiTestMsg("");
    try {
      const r = await api.post<{ ok: boolean; error?: string; models?: string[] }>(
        "/api/radiology-ollama/test",
        { baseUrl: localAi.primaryUrl, model: localAi.model, allowLocal: localAi.localOnly }
      );
      if (r.ok) {
        setLocalAiTestStatus("ok");
        setLocalAiTestMsg(`Connected! ${r.models?.length ?? 0} models available.`);
      } else {
        setLocalAiTestStatus("fail"); setLocalAiTestMsg(r.error ?? "Failed");
      }
    } catch (e: unknown) {
      setLocalAiTestStatus("fail"); setLocalAiTestMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  async function handleLocalAiSave() {
    setLocalAiSaving(true);
    try {
      await api.post("/api/clinic-settings/ollama", {
        ollamaEnabled: localAi.enabled,
        ollamaBaseUrl: localAi.primaryUrl,
        ollamaFallbackUrl: localAi.fallbackUrl,
        ollamaModel: localAi.model,
        ollamaLocalOnly: localAi.localOnly,
        ollamaTimeoutSeconds: localAi.timeoutSeconds,
        ollamaAuditEnabled: localAi.auditEnabled,
      });
      // Keep the shared clinic-settings cache in sync — RadiologySettingsCenter
      // and any other consumer read from the same ["clinic-settings"] query key.
      void queryClient.invalidateQueries({ queryKey: ["clinic-settings"] });
      toast({ title: "Local AI settings saved" });
    } catch (e: unknown) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    }
    setLocalAiSaving(false);
  }

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["ai-reporting-settings"],
    queryFn: () => api.get("/api/ai-reporting/settings"),
  });

  // Clinic settings — the Local AI tab is the ONE place Ollama endpoint/model/
  // timeout/enabled config lives, so it must reflect what's actually saved
  // (clinic_settings.ollama_*), not just UI defaults. Shares the ["clinic-settings"]
  // query cache with RadiologySettingsCenter (same key), so no extra fetch when
  // this panel is embedded there.
  const { data: clinicSettingsData } = useQuery<Record<string, unknown>>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [localAiHydrated, setLocalAiHydrated] = useState(false);

  // Local state
  const [globalDraft, setGlobalDraft] = useState<GlobalSettings>({
    enabled: false,
    defaultProvider: "gemini",
    defaultPrompt: "",
    defaultPromptTemplate: "",
    includeDemographics: false,
    anonymize: true,
    allowedRoles: ["admin", "super_admin", "doctor", "radiologist"],
  });

  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate form from API data when it arrives
  if (data && !hydrated) {
    setHydrated(true);
    setGlobalDraft({ ...globalDraft, ...data.global });
    const newDrafts: Record<string, ProviderDraft> = {};
    for (const p of Object.keys(data.providers)) {
      const pd = data.providers[p];
      const defaultModel = pd.defaultModel ?? (pd.defaultModels?.[0] ?? "");
      newDrafts[p] = {
        isEnabled: pd.isEnabled,
        isDefault: pd.isDefault,
        apiKey: "",
        endpointUrl: pd.endpointUrl ?? "",
        defaultModel,
        showKey: false,
        testStatus: "idle",
        testMessage: "",
      };
    }
    setProviderDrafts(newDrafts);
  }

  // Hydrate Local AI (Ollama) state from clinic_settings when it arrives —
  // without this, the tab always showed hardcoded placeholder values, so
  // opening it and clicking Save could silently overwrite real production
  // endpoints with UI defaults.
  if (clinicSettingsData && !localAiHydrated) {
    setLocalAiHydrated(true);
    const cs = clinicSettingsData as {
      ollamaBaseUrl?: string | null; ollamaFallbackUrl?: string | null; ollamaModel?: string | null;
      ollamaEnabled?: boolean; ollamaLocalOnly?: boolean; ollamaTimeoutSeconds?: number; ollamaAuditEnabled?: boolean;
    };
    setLocalAi((s) => ({
      ...s,
      primaryUrl: cs.ollamaBaseUrl ?? s.primaryUrl,
      fallbackUrl: cs.ollamaFallbackUrl ?? s.fallbackUrl,
      model: cs.ollamaModel ?? s.model,
      enabled: cs.ollamaEnabled ?? s.enabled,
      localOnly: cs.ollamaLocalOnly ?? s.localOnly,
      timeoutSeconds: cs.ollamaTimeoutSeconds ?? s.timeoutSeconds,
      auditEnabled: cs.ollamaAuditEnabled ?? s.auditEnabled,
    }));
  }

  const saveMutation = useMutation({
    mutationFn: (payload: { global: GlobalSettings; providers: Record<string, Omit<ProviderDraft, "showKey" | "testStatus" | "testMessage">> }) =>
      api.post("/api/ai-reporting/settings", payload),
    onSuccess: () => {
      toast({ title: "AI Reporting settings saved" });
      void queryClient.invalidateQueries({ queryKey: ["ai-reporting-settings"] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function handleSave() {
    const providers: Record<string, Omit<ProviderDraft, "showKey" | "testStatus" | "testMessage">> = {};
    for (const p of Object.keys(providerDrafts)) {
      const d = providerDrafts[p];
      providers[p] = { isEnabled: d.isEnabled, isDefault: d.isDefault, apiKey: d.apiKey, endpointUrl: d.endpointUrl, defaultModel: d.defaultModel };
    }
    saveMutation.mutate({ global: globalDraft, providers });
  }

  async function handleTestProvider(name: string) {
    setProviderDrafts((prev) => ({
      ...prev,
      [name]: { ...prev[name], testStatus: "testing", testMessage: "" },
    }));
    try {
      const payload: Record<string, unknown> = { provider: name, model: providerDrafts[name].defaultModel };
      if (name === "ollama") {
        payload.endpointUrl = providerDrafts[name].endpointUrl || undefined;
      } else {
        payload.apiKey = providerDrafts[name].apiKey || undefined;
      }
      const res = await api.post<{ success: boolean; response?: string; error?: string; availableModels?: string[] }>(
        "/api/ai-reporting/test-provider",
        payload,
      );
      setProviderDrafts((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          testStatus: res.success ? "ok" : "fail",
          testMessage: res.error ?? res.response ?? "",
        },
      }));
    } catch (e: unknown) {
      setProviderDrafts((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          testStatus: "fail",
          testMessage: e instanceof Error ? e.message : "Connection failed",
        },
      }));
    }
  }

  const SECTIONS = [
    { id: "general", icon: Settings2, label: "General" },
    { id: "providers", icon: Key, label: "AI Providers" },
    { id: "local-ai", icon: Zap, label: "Local AI" },
    { id: "overnight", icon: Moon, label: "Draft automation" },
    { id: "prompts", icon: BookOpen, label: "Prompt Templates" },
    { id: "permissions", icon: Users, label: "Permissions" },
  ] as const;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
          {saveMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Save Settings
        </Button>
      </div>

      {/* AI Enabled master toggle */}
      <div className={`rounded-xl border p-5 flex items-center justify-between ${globalDraft.enabled ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-muted/30"}`}>
        <div className="flex items-center gap-3">
          <BrainCircuit size={22} className={globalDraft.enabled ? "text-green-600" : "text-muted-foreground"} />
          <div>
            <p className="font-semibold text-sm">{globalDraft.enabled ? "AI Reporting is ENABLED" : "AI Reporting is DISABLED"}</p>
            <p className="text-xs text-muted-foreground">Toggle to allow or restrict AI assistance across all radiology workflows</p>
          </div>
        </div>
        <div
          className={`relative w-12 h-6 rounded-full cursor-pointer transition-colors ${globalDraft.enabled ? "bg-green-500" : "bg-muted-foreground/30"}`}
          onClick={() => setGlobalDraft((g) => ({ ...g, enabled: !g.enabled }))}
        >
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${globalDraft.enabled ? "translate-x-7" : "translate-x-1"}`} />
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
        {SECTIONS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${activeSection === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon size={13} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ── General Settings ── */}
      {activeSection === "general" && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Settings2 size={14} /> General Settings</h3>

            {/* Default Provider */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Default AI Provider</label>
              <select
                value={globalDraft.defaultProvider}
                onChange={(e) => setGlobalDraft((g) => ({ ...g, defaultProvider: e.target.value }))}
                className="w-full h-9 px-3 text-sm rounded-lg border bg-background"
              >
                {data && Object.values(data.providers).map((p) => (
                  <option key={p.provider} value={p.provider}>{p.label}</option>
                ))}
                {!data && <option value={globalDraft.defaultProvider}>{globalDraft.defaultProvider}</option>}
              </select>
            </div>

            {/* Privacy toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background cursor-pointer select-none">
                <div>
                  <p className="text-xs font-semibold">Anonymize Patient Data</p>
                  <p className="text-[10px] text-muted-foreground">Strip identifiers from DICOM images before sending to AI</p>
                </div>
                <div
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${globalDraft.anonymize ? "bg-primary" : "bg-muted"}`}
                  onClick={() => setGlobalDraft((g) => ({ ...g, anonymize: !g.anonymize }))}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${globalDraft.anonymize ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
              </label>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background cursor-pointer select-none">
                <div>
                  <p className="text-xs font-semibold">Include Patient Demographics</p>
                  <p className="text-[10px] text-muted-foreground">Append age, gender (not name) to AI prompt for context</p>
                </div>
                <div
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${globalDraft.includeDemographics ? "bg-primary" : "bg-muted"}`}
                  onClick={() => setGlobalDraft((g) => ({ ...g, includeDemographics: !g.includeDemographics }))}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${globalDraft.includeDemographics ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
              </label>
            </div>

            {globalDraft.anonymize && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 text-xs">
                <ShieldCheck size={14} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-amber-800 dark:text-amber-300">
                  <strong>Anonymization enabled</strong> — patient name, ID, and DOB will be stripped from all DICOM metadata before sending to AI. Only image pixels and non-identifying clinical context are transmitted.
                </p>
              </div>
            )}
          </div>

          {/* Security notice */}
          <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
            <h3 className="text-xs font-semibold flex items-center gap-2 text-muted-foreground">
              <ShieldCheck size={13} /> Security
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>API keys are AES-256 encrypted at rest and never exposed to the browser.</li>
              <li>All AI queries are routed through the ERP backend — never directly from the browser.</li>
              <li>Only users with the <code className="bg-muted px-1 rounded">ai_reporting.use</code> permission can query AI.</li>
              <li>Only admins can configure API keys (<code className="bg-muted px-1 rounded">ai_reporting.configure</code> permission).</li>
              <li>Every AI query is audit-logged with user, study, provider, and anonymization status.</li>
              <li>AI responses are draft-only — a doctor/radiologist must review and approve before final signing.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Local AI / Ollama Settings ── */}
      {activeSection === "local-ai" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-4 flex gap-3 text-xs">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-amber-800 dark:text-amber-300 space-y-1">
              <p><strong>Local AI runs entirely on-premise.</strong> Patient data never leaves your network.</p>
              <p>Requires Ollama running on the Windows PC (192.168.1.250) with models downloaded. See <code className="bg-amber-200 dark:bg-amber-900 px-1 rounded">docs/OLLAMA_SETUP.md</code> for full setup guide.</p>
            </div>
          </div>

          {/* Master enable */}
          <div className={`rounded-xl border p-4 flex items-center justify-between ${localAi.enabled ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-muted/30"}`}>
            <div className="flex items-center gap-3">
              <Zap size={20} className={localAi.enabled ? "text-orange-500" : "text-muted-foreground"} />
              <div>
                <p className="font-semibold text-sm">Local AI Assistant {localAi.enabled ? "ENABLED" : "DISABLED"}</p>
                <p className="text-xs text-muted-foreground">Shows AI tab in Radiology Command Center</p>
              </div>
            </div>
            <div
              className={`relative w-12 h-6 rounded-full cursor-pointer transition-colors ${localAi.enabled ? "bg-orange-500" : "bg-muted-foreground/30"}`}
              onClick={() => setLocalAi((s) => ({ ...s, enabled: !s.enabled }))}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${localAi.enabled ? "translate-x-7" : "translate-x-1"}`} />
            </div>
          </div>

          {/* URL Configuration */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Wifi size={14} /> Ollama Endpoint URLs</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Primary URL (Windows PC LAN IP)</label>
              <input
                type="text"
                value={localAi.primaryUrl}
                onChange={(e) => setLocalAi((s) => ({ ...s, primaryUrl: e.target.value }))}
                placeholder="http://192.168.1.250:11434"
                className="w-full h-9 px-3 text-xs rounded-lg border bg-background font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Fallback URL (secondary NIC / IP)</label>
              <input
                type="text"
                value={localAi.fallbackUrl}
                onChange={(e) => setLocalAi((s) => ({ ...s, fallbackUrl: e.target.value }))}
                placeholder="http://172.16.1.140:11434"
                className="w-full h-9 px-3 text-xs rounded-lg border bg-background font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Backend probes primary first, switches to fallback if primary doesn't respond. Cached for 5 minutes.</p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={localAiProbing} onClick={handleLocalAiProbe}>
                {localAiProbing ? <RefreshCw size={11} className="animate-spin" /> : <Wifi size={11} />}
                Auto-Detect
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={localAiTestStatus === "testing"} onClick={handleLocalAiTest}>
                {localAiTestStatus === "testing" ? <RefreshCw size={11} className="animate-spin" /> : <TestTube2 size={11} />}
                Test Primary
              </Button>
              {localAiTestStatus === "ok" && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> {localAiTestMsg}</span>}
              {localAiTestStatus === "fail" && <span className="flex items-center gap-1 text-xs text-red-600"><XCircle size={12} /> {localAiTestMsg}</span>}
            </div>

            {localAiProbeResult.length > 0 && (
              <div className="space-y-1">
                {localAiProbeResult.map((r) => (
                  <div key={r.url} className={`flex items-center gap-2 text-[10px] px-2 py-1 rounded border ${r.reachable ? "border-green-300 bg-green-50 dark:bg-green-950/20 text-green-700" : "border-red-300 bg-red-50 dark:bg-red-950/20 text-red-600"}`}>
                    {r.reachable ? <Wifi size={10} /> : <WifiOff size={10} />}
                    <code className="font-mono">{r.url}</code>
                    <span className="ml-auto">{r.reachable ? "✓ reachable" : "✗ unreachable"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Model & Options */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><BrainCircuit size={14} /> Model & Options</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Default Model</label>
              <select
                value={localAi.model}
                onChange={(e) => setLocalAi((s) => ({ ...s, model: e.target.value }))}
                className="w-full h-9 px-3 text-xs rounded-lg border bg-background font-mono"
              >
                <option value="gemma3:4b">gemma3:4b — routine FAST/STANDARD (recommended)</option>
                <option value="gemma3:12b">gemma3:12b — DEEP only (slower on RTX 3050 8GB)</option>
                <option value="qwen3:14b">qwen3:14b — approved alternate</option>
                <option value="gpt-oss:20b">gpt-oss:20b — approved alternate</option>
              </select>
              <input
                type="text"
                value={localAi.model}
                onChange={(e) => setLocalAi((s) => ({ ...s, model: e.target.value }))}
                placeholder="gemma3:4b"
                className="w-full h-9 px-3 text-xs rounded-lg border bg-background font-mono"
              />
              {/12b|14b|20b|27b|70b/i.test(localAi.model) && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Large models may be slow or OOM on RTX 3050 8 GB. Prefer gemma3:4b for routine OCR cleanup and drafting. AI output is always a DRAFT requiring radiologist approval.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Modes: AUTO / FAST / STANDARD use <code className="bg-muted px-1 rounded">gemma3:4b</code>.
                DEEP uses <code className="bg-muted px-1 rounded">gemma3:12b</code> (explicit only).
                OCR ONLY skips the LLM. Pipeline diagnostics: <code className="bg-muted px-1 rounded">GET /api/ai-pipeline/health</code>
              </p>
            </div>

            <PipelineDiagnosticsPanel />

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><Gauge size={11} /> Timeout: {localAi.timeoutSeconds}s</label>
              <input
                type="range" min={10} max={120} step={5}
                value={localAi.timeoutSeconds}
                onChange={(e) => setLocalAi((s) => ({ ...s, timeoutSeconds: Number(e.target.value) }))}
                className="w-full"
              />
              <p className="text-[10px] text-muted-foreground">Per-action timeout. 30s for impression; 60–120s for full draft generation.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background cursor-pointer">
                <div>
                  <p className="text-xs font-semibold">LAN Mode</p>
                  <p className="text-[10px] text-muted-foreground">Allow private IP addresses</p>
                </div>
                <div
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors shrink-0 ${localAi.localOnly ? "bg-primary" : "bg-muted"}`}
                  onClick={() => setLocalAi((s) => ({ ...s, localOnly: !s.localOnly }))}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${localAi.localOnly ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
              </label>
              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background cursor-pointer">
                <div>
                  <p className="text-xs font-semibold">Audit Logging</p>
                  <p className="text-[10px] text-muted-foreground">Log all AI actions to DB</p>
                </div>
                <div
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors shrink-0 ${localAi.auditEnabled ? "bg-primary" : "bg-muted"}`}
                  onClick={() => setLocalAi((s) => ({ ...s, auditEnabled: !s.auditEnabled }))}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${localAi.auditEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
              </label>
            </div>
          </div>

          <Button onClick={handleLocalAiSave} disabled={localAiSaving} className="gap-2 w-full">
            {localAiSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Save Local AI Settings
          </Button>
        </div>
      )}

      {/* ── Overnight DICOM → Ollama drafts ── */}
      {activeSection === "overnight" && (
        <div className="space-y-4">
          <OvernightAiSettings />
        </div>
      )}

      {/* ── AI Providers ── */}
      {activeSection === "providers" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 flex gap-3 text-xs">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-amber-800 dark:text-amber-300 space-y-1">
              <p><strong>API Keys are stored encrypted.</strong> Enter a new key to update it; leave blank to keep the existing key.</p>
              <p>Enable at least one provider and set a default model before using AI reporting.</p>
            </div>
          </div>
          {data && Object.values(data.providers).map((p) => (
            <ProviderCard
              key={p.provider}
              name={p.provider}
              meta={p}
              draft={providerDrafts[p.provider]}
              onChange={(d) => setProviderDrafts((prev) => ({ ...prev, [p.provider]: { ...prev[p.provider], ...d } }))}
              onTest={() => void handleTestProvider(p.provider)}
            />
          ))}
        </div>
      )}

      {/* ── Prompt Templates ── */}
      {activeSection === "prompts" && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><BookOpen size={14} /> Default Prompt</h3>
            <p className="text-xs text-muted-foreground">
              Used when no template is selected in the AI drawer. Leave blank for a generic radiology report prompt.
            </p>
            <textarea
              value={globalDraft.defaultPrompt}
              onChange={(e) => setGlobalDraft((g) => ({ ...g, defaultPrompt: e.target.value }))}
              placeholder="e.g. Provide a detailed, structured radiology report for the images provided. Include findings, impression and clinical recommendations."
              className="w-full h-28 p-3 text-sm rounded-lg border bg-background resize-none"
            />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Default Template</label>
              <select
                value={globalDraft.defaultPromptTemplate}
                onChange={(e) => setGlobalDraft((g) => ({ ...g, defaultPromptTemplate: e.target.value }))}
                className="w-full h-9 px-3 text-sm rounded-lg border bg-background"
              >
                <option value="">-- No default template (use custom prompt above) --</option>
                {(data?.promptTemplates ?? []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Preset templates reference */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><FileText size={14} /> Built-in Preset Templates</h3>
            <p className="text-xs text-muted-foreground">These are available in the AI viewer drawer. They cannot be edited here but you can add a custom default prompt above.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(data?.promptTemplates ?? []).map((t) => (
                <div key={t} className="flex items-center gap-2 p-2 rounded-lg border bg-background text-xs">
                  <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Permissions ── */}
      {activeSection === "permissions" && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Users size={14} /> Role Permissions</h3>
            <p className="text-xs text-muted-foreground">
              Select which roles can use AI reporting. Admins and Super Admins always have access.
              Staff must also have the <code className="bg-muted px-1 rounded">ai_reporting.use</code> permission in their profile.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ALL_ROLES.map((role) => {
                const isAlwaysOn = role === "admin" || role === "super_admin";
                const checked = isAlwaysOn || globalDraft.allowedRoles.includes(role);
                return (
                  <label
                    key={role}
                    className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer select-none text-xs ${checked ? "bg-primary/10 border-primary/30" : "bg-background"} ${isAlwaysOn ? "opacity-70 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isAlwaysOn}
                      onChange={(e) => {
                        if (isAlwaysOn) return;
                        setGlobalDraft((g) => ({
                          ...g,
                          allowedRoles: e.target.checked
                            ? [...g.allowedRoles, role]
                            : g.allowedRoles.filter((r) => r !== role),
                        }));
                      }}
                      className="w-3.5 h-3.5"
                    />
                    <span className="font-medium">{SECTION_LABELS[role]}</span>
                    {isAlwaysOn && <span className="text-[10px] text-muted-foreground ml-auto">(always)</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/30 p-5 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground">Permission Reference</h3>
            <div className="space-y-2 text-xs">
              <div className="flex gap-3 p-2 rounded border bg-background">
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs shrink-0">ai_reporting.use</code>
                <p className="text-muted-foreground">Send images/queries to AI, view responses, save and insert drafts. Grant to doctors, radiologists, or any role above.</p>
              </div>
              <div className="flex gap-3 p-2 rounded border bg-background">
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs shrink-0">ai_reporting.configure</code>
                <p className="text-muted-foreground">Manage API keys, enable/disable providers, view audit logs. Admin and Super Admin only.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiReportingSettings() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="AI Reporting Integration" subtitle="Configure AI providers for DICOM/radiology study analysis and report generation" />
      <AiReportingPanel />
    </div>
  );
}
