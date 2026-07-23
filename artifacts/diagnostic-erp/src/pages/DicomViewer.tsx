import { useState, useRef } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { queryAiReporting, type AiReportingQueryRequest } from "@/lib/aiReportingClient";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ExternalLink, MonitorPlay, AlertTriangle, Settings,
  Tv2, BrainCircuit, X, ChevronDown, ChevronUp, Copy, Send,
  RefreshCw, FileText, BookOpen, Sparkles, ClipboardPaste, Save,
  History, Zap, Info, CheckCircle2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ViewerLaunchData {
  studyInstanceUID: string;
  patientName?: string | null;
  accessionNumber?: string | null;
  viewerType?: "OHIF" | "WEASIS";
  ohifUrl?: string | null;
  weasisUrl?: string | null;
  dicomWebBaseUrl?: string | null;
  wadoBaseUrl?: string | null;
  pacsType?: string;
  error?: string;
}

interface AiSettings {
  global: {
    enabled: boolean;
    defaultProvider: string;
    defaultPromptTemplate: string;
    defaultPrompt: string;
    anonymize: boolean;
    includeDemographics: boolean;
    allowedRoles: string[];
  };
  providers: Record<string, {
    isEnabled: boolean;
    isDefault: boolean;
    hasApiKey: boolean;
    hasEndpointUrl: boolean;
    defaultModel: string | null;
    label: string;
  }>;
  promptTemplates: string[];
}

interface AiDraft {
  id: number;
  provider: string;
  model: string | null;
  templateName: string | null;
  aiResponse: string | null;
  draftText: string | null;
  status: string;
  createdAt: string;
}

// ─── WeasisInstallHint ────────────────────────────────────────────────────────
function WeasisInstallHint() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-amber-800 dark:text-amber-300">Weasis not detected</p>
          <p className="text-amber-700 dark:text-amber-400 mt-1">
            Install <strong>Weasis Viewer</strong> on this computer to open DICOM images.
          </p>
          <a
            href="https://weasis.org/en/getting-started/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-amber-700 underline font-medium"
          >
            Download Weasis <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── AI Disclaimer ────────────────────────────────────────────────────────────
function AiDisclaimer() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
      <div className="flex gap-2">
        <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
        <p>
          <strong>AI-assisted draft only.</strong> Generated from selected images only. Verify all sequences, measurements, laterality and clinical context before final reporting. AI output must never auto-sign a final report.
        </p>
      </div>
    </div>
  );
}

// ─── AI Side Drawer ───────────────────────────────────────────────────────────
function AiDrawer({
  studyInstanceUID,
  accessionNumber,
  patientId,
  aiSettings,
  onClose,
}: {
  studyInstanceUID: string;
  accessionNumber?: string | null;
  patientId?: number;
  aiSettings: AiSettings | undefined;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const responseRef = useRef<HTMLDivElement>(null);

  // Drafts for this study
  const { data: drafts = [], refetch: refetchDrafts } = useQuery<AiDraft[]>({
    queryKey: ["ai-drafts", studyInstanceUID],
    queryFn: () => api.get(`/api/ai-reporting/drafts/${studyInstanceUID}`),
    enabled: !!studyInstanceUID,
  });

  // Form state
  const [scope, setScope] = useState<"study" | "limited">("study");
  const [maxImages, setMaxImages] = useState(6);
  const [selectedTemplate, setSelectedTemplate] = useState(aiSettings?.global.defaultPromptTemplate ?? "");
  const [customPrompt, setCustomPrompt] = useState("");
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [provider, setProvider] = useState(aiSettings?.global.defaultProvider ?? "gemini");
  const [anonymize, setAnonymize] = useState(aiSettings?.global.anonymize ?? true);
  const [showDrafts, setShowDrafts] = useState(false);

  // Response state
  const [aiResponse, setAiResponse] = useState("");
  const [draftText, setDraftText] = useState("");
  const [lastProvider, setLastProvider] = useState("");
  const [lastNumImages, setLastNumImages] = useState(0);
  const [savedDraftId, setSavedDraftId] = useState<number | null>(null);

  const enabledProviders = Object.entries(aiSettings?.providers ?? {})
    .filter(([, v]) => v.isEnabled && (v.hasApiKey || v.hasEndpointUrl))
    .map(([k]) => k);

  const notEnabled = !aiSettings?.global.enabled;
  const noProviders = aiSettings?.global.enabled && enabledProviders.length === 0;
  const canQuery = !notEnabled && !noProviders;

  function buildPayload(overridePrompt?: string): AiReportingQueryRequest {
    return {
      studyInstanceUID,
      accessionNumber,
      patientId,
      scope,
      provider,
      promptText: (overridePrompt ?? customPrompt.trim()) || undefined,
      templateName: !overridePrompt && !customPrompt.trim() ? selectedTemplate || undefined : undefined,
      clinicalHistory: clinicalHistory.trim() || undefined,
      anonymize,
      maxImages: scope === "limited" ? 3 : maxImages,
    };
  }

  const queryMutation = useMutation({
    mutationFn: (payload: AiReportingQueryRequest) => queryAiReporting(payload),
    onSuccess: (data) => {
      setAiResponse(data.aiResponse);
      setDraftText(data.aiResponse);
      setLastProvider(data.provider);
      setLastNumImages(data.numImages);
      setSavedDraftId(null);
      setTimeout(() => responseRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: Error) => toast({ title: "AI query failed", description: e.message, variant: "destructive" }),
  });

  const saveDraftMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>("/api/ai-reporting/drafts", {
        id: savedDraftId ?? undefined,
        studyInstanceUID,
        accessionNumber,
        patientId,
        provider: lastProvider || provider,
        promptText: customPrompt || selectedTemplate || undefined,
        templateName: selectedTemplate || undefined,
        aiResponse,
        draftText,
        status: "draft",
      }),
    onSuccess: (d) => {
      setSavedDraftId(d.id);
      toast({ title: "Draft saved" });
      void refetchDrafts();
      void queryClient.invalidateQueries({ queryKey: ["ai-drafts", studyInstanceUID] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const insertMutation = useMutation({
    mutationFn: () => api.post("/api/ai-reporting/insert-to-report", { draftId: savedDraftId }),
    onSuccess: () => {
      toast({ title: "Marked as inserted into report" });
      void refetchDrafts();
    },
  });

  function handleCopy() {
    void navigator.clipboard.writeText(draftText || aiResponse);
    toast({ title: "Copied to clipboard" });
  }

  const isQuerying = queryMutation.isPending;

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 shrink-0">
        <BrainCircuit size={16} className="text-purple-600 shrink-0" />
        <p className="text-sm font-semibold flex-1 truncate">AI Radiology Assistant</p>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted/50 shrink-0">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
        {/* Status warnings */}
        {notEnabled && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs flex gap-2">
            <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
            <span>
              AI Reporting is disabled.{" "}
              <a href="/erp/radiology/ai-reporting-settings" className="underline font-medium">Configure here.</a>
            </span>
          </div>
        )}
        {noProviders && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-xs flex gap-2">
            <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
            <span>
              No provider has an API key or endpoint URL.{" "}
              <a href="/erp/radiology/ai-reporting-settings" className="underline font-medium">Add API keys or endpoint URL.</a>
            </span>
          </div>
        )}

        {/* ── Scope ── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Image Scope</p>
          <div className="grid grid-cols-2 gap-2">
            {(["study", "limited"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${scope === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50"}`}
              >
                {s === "study" ? "Full Study" : "First 3 Images"}
              </button>
            ))}
          </div>
          {scope === "study" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Max:</span>
              <input
                type="range"
                min={1}
                max={20}
                value={maxImages}
                onChange={(e) => setMaxImages(Number(e.target.value))}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs font-mono w-5 text-center">{maxImages}</span>
            </div>
          )}
        </div>

        {/* ── Clinical History ── */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Clinical History</label>
          <textarea
            value={clinicalHistory}
            onChange={(e) => setClinicalHistory(e.target.value)}
            placeholder="e.g. 55M, 3-week headache, hypertension. Previous CT 6 months ago was normal."
            className="w-full h-20 p-2 text-xs rounded-lg border bg-background resize-none"
          />
        </div>

        {/* ── Prompt Template ── */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prompt Template</label>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="w-full h-8 px-2 text-xs rounded-lg border bg-background"
          >
            <option value="">-- Custom prompt below --</option>
            {(aiSettings?.promptTemplates ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* ── Custom Prompt ── */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Custom Prompt</label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={
              selectedTemplate
                ? `Template "${selectedTemplate}" selected. Add extra instructions (optional)…`
                : "Describe what you want the AI to analyse or report…"
            }
            className="w-full h-20 p-2 text-xs rounded-lg border bg-background resize-none"
          />
        </div>

        {/* ── Provider + Anonymize ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full h-8 px-2 text-xs rounded-lg border bg-background"
            >
              {aiSettings && enabledProviders.length > 0 ? (
                enabledProviders.map((p) => (
                  <option key={p} value={p}>{aiSettings.providers[p]?.label ?? p}</option>
                ))
              ) : aiSettings ? (
                <option value={aiSettings.global.defaultProvider}>{aiSettings.providers[aiSettings.global.defaultProvider]?.label ?? aiSettings.global.defaultProvider} (not configured)</option>
              ) : (
                <option value={provider}>{provider}</option>
              )}
            </select>
          </div>

          <label className="flex flex-col justify-between p-2.5 rounded-lg border bg-background cursor-pointer select-none">
            <span className="text-[10px] font-semibold text-muted-foreground">ANONYMIZE</span>
            <div className="flex items-center gap-2 mt-1">
              <div
                className={`relative w-8 h-4 rounded-full transition-colors ${anonymize ? "bg-green-500" : "bg-muted"}`}
                onClick={() => setAnonymize(!anonymize)}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${anonymize ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-xs">{anonymize ? "On" : "Off"}</span>
            </div>
          </label>
        </div>

        {/* ── Action Buttons ── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</p>
          <Button
            className="w-full gap-2 h-9"
            disabled={isQuerying || !canQuery}
            onClick={() => queryMutation.mutate(buildPayload())}
          >
            {isQuerying ? <RefreshCw size={13} className="animate-spin" /> : <FileText size={13} />}
            Generate Draft Report
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline" size="sm"
              className="gap-1.5 h-8 text-xs"
              disabled={isQuerying || !canQuery}
              onClick={() => queryMutation.mutate(buildPayload())}
            >
              <Send size={11} /> Send to AI
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-1.5 h-8 text-xs"
              disabled={isQuerying || !canQuery}
              onClick={() => queryMutation.mutate(buildPayload("Describe key findings in these images in plain language. What is the most significant abnormality, if any?"))}
            >
              <Sparkles size={11} /> Ask About
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-1.5 h-8 text-xs"
              disabled={isQuerying || !canQuery}
              onClick={() => queryMutation.mutate(buildPayload("Compare with typical prior study of same modality. What appears new, improved, or worsened?"))}
            >
              <History size={11} /> Compare
            </Button>
            <Button
              variant="outline" size="sm"
              className="gap-1.5 h-8 text-xs text-red-700 border-red-200 hover:bg-red-50"
              disabled={isQuerying || !canQuery}
              onClick={() => queryMutation.mutate(buildPayload("Identify any life-threatening or time-critical findings requiring urgent action. If none found, confirm normal urgent findings."))}
            >
              <Zap size={11} /> Emergency
            </Button>
          </div>

          {aiResponse && !isQuerying && (
            <Button
              variant="ghost" size="sm"
              className="w-full gap-1.5 h-8 text-xs"
              disabled={isQuerying}
              onClick={() => queryMutation.mutate(buildPayload())}
            >
              <RefreshCw size={11} /> Regenerate
            </Button>
          )}
        </div>

        {/* ── Querying state ── */}
        {isQuerying && (
          <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3 text-xs text-muted-foreground">
            <RefreshCw size={14} className="animate-spin text-purple-500 shrink-0" />
            <span>Fetching images from PACS and querying AI…</span>
          </div>
        )}

        {/* ── AI Response ── */}
        {aiResponse && !isQuerying && (
          <div ref={responseRef} className="space-y-3">
            <AiDisclaimer />

            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Response</p>
                <span className="text-[10px] text-muted-foreground capitalize">
                  {lastProvider}{lastNumImages > 0 && ` · ${lastNumImages} img`}
                </span>
              </div>
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                className="w-full h-64 p-2 text-xs rounded-lg border bg-background resize-y font-mono leading-relaxed"
              />
              <p className="text-[10px] text-muted-foreground">Edit the draft above before inserting into the report.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleCopy}>
                <Copy size={11} /> Copy
              </Button>
              <Button
                variant="outline" size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={() => saveDraftMutation.mutate()}
                disabled={saveDraftMutation.isPending}
              >
                {saveDraftMutation.isPending
                  ? <RefreshCw size={11} className="animate-spin" />
                  : <Save size={11} />
                }
                {savedDraftId ? "Update Draft" : "Save Draft"}
              </Button>
            </div>

            {savedDraftId && (
              <Button
                size="sm"
                className="w-full gap-1.5 h-8 text-xs bg-purple-600 hover:bg-purple-700"
                onClick={() => insertMutation.mutate()}
                disabled={insertMutation.isPending}
              >
                {insertMutation.isPending
                  ? <RefreshCw size={11} className="animate-spin" />
                  : <ClipboardPaste size={11} />
                }
                Insert Into Report
              </Button>
            )}

            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-2 flex gap-1.5 text-[10px] text-blue-800 dark:text-blue-300">
              <Info size={11} className="shrink-0 mt-0.5" />
              Doctor/radiologist must review and approve before final signing.
            </div>
          </div>
        )}

        {/* ── Saved Drafts ── */}
        {drafts.length > 0 && (
          <div className="space-y-2">
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground w-full"
              onClick={() => setShowDrafts((s) => !s)}
            >
              <BookOpen size={12} />
              Saved Drafts ({drafts.length})
              {showDrafts ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
            </button>

            {showDrafts && (
              <div className="space-y-2">
                {drafts.map((d) => (
                  <div key={d.id} className="rounded-lg border bg-background p-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize truncate">
                        {d.provider}{d.templateName ? ` · ${d.templateName}` : ""}
                      </span>
                      <Badge variant="outline" className="text-[9px] h-4 shrink-0">{d.status}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(d.createdAt).toLocaleDateString()} {new Date(d.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-[10px] line-clamp-2 text-muted-foreground">{d.draftText ?? d.aiResponse}</p>
                    <div className="flex gap-1.5 mt-1">
                      <Button
                        size="sm" variant="ghost"
                        className="h-5 text-[10px] px-2 gap-1"
                        onClick={() => {
                          setAiResponse(d.aiResponse ?? "");
                          setDraftText(d.draftText ?? d.aiResponse ?? "");
                          setLastProvider(d.provider);
                          setSavedDraftId(d.id);
                          setShowDrafts(false);
                        }}
                      >
                        <ClipboardPaste size={9} /> Load
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-5 text-[10px] px-2 gap-1"
                        onClick={() => {
                          void navigator.clipboard.writeText(d.draftText ?? d.aiResponse ?? "");
                          toast({ title: "Copied" });
                        }}
                      >
                        <Copy size={9} /> Copy
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main DicomViewer page ────────────────────────────────────────────────────
export default function DicomViewer() {
  const { studyInstanceUID } = useParams<{ studyInstanceUID: string }>();
  const [aiOpen, setAiOpen] = useState(false);

  const ohifQuery = useQuery<ViewerLaunchData>({
    queryKey: ["ohif-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${studyInstanceUID}/ohif-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 60_000,
  });

  const weasisQuery = useQuery<ViewerLaunchData>({
    queryKey: ["weasis-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${studyInstanceUID}/weasis-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 60_000,
  });

  const settingsQuery = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<{ key: string; value: string; category: string }[]>("/api/radiology/pacs-settings");
      const map: Record<string, string> = {};
      for (const r of rows) if (r.category === "viewer") map[r.key] = r.value;
      return map;
    },
    staleTime: 60_000,
  });

  const aiSettingsQuery = useQuery<AiSettings>({
    queryKey: ["ai-reporting-settings"],
    queryFn: () => api.get("/api/ai-reporting/settings"),
    staleTime: 120_000,
  });

  const ohif = ohifQuery.data;
  const weasis = weasisQuery.data;
  const settings = settingsQuery.data ?? {};

  const viewerMode = settings["viewer_mode"] ?? "BOTH";
  const defaultViewer = settings["default_viewer"] ?? "OHIF";
  const ohifEnabled = settings["ohif_enabled"] !== "false";
  const weasisEnabled = settings["weasis_enabled"] !== "false";
  const openMode = settings["viewer_open_mode"] ?? "NEW_TAB";
  const allowEmbedded = openMode === "EMBEDDED";

  const patientName = ohif?.patientName ?? weasis?.patientName ?? null;
  const accessionNumber = ohif?.accessionNumber ?? weasis?.accessionNumber ?? null;
  const aiEnabled = aiSettingsQuery.data?.global.enabled ?? false;
  const loading = ohifQuery.isLoading || weasisQuery.isLoading;

  const openOhif = () => { if (ohif?.ohifUrl) window.open(ohif.ohifUrl, "_blank"); };
  const openWeasis = () => { if (weasis?.weasisUrl) window.open(weasis.weasisUrl, "_blank"); };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main viewer column ── */}
      <div className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-w-0`}>
        <PageHeader
          title="DICOM Viewer"
          subtitle={studyInstanceUID}
          actions={
            <div className="flex gap-2">
              <Button
                variant={aiOpen ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => setAiOpen((o) => !o)}
                title={aiEnabled ? "AI Radiology Assistant" : "AI Reporting not enabled — configure in Settings"}
              >
                <BrainCircuit
                  size={14}
                  className={aiOpen ? "" : aiEnabled ? "text-purple-600" : "text-muted-foreground"}
                />
                {aiOpen ? "Close AI" : "AI Assistant"}
                {!aiEnabled && <AlertTriangle size={11} className="text-amber-500" />}
              </Button>
            </div>
          }
        />

        {/* Study metadata */}
        {(patientName || accessionNumber || ohif?.pacsType) && (
          <div className="rounded-xl border bg-card p-4 flex flex-wrap gap-6 text-sm">
            {patientName && (
              <div>
                <p className="text-xs text-muted-foreground">Patient</p>
                <p className="font-semibold uppercase">{patientName}</p>
              </div>
            )}
            {accessionNumber && (
              <div>
                <p className="text-xs text-muted-foreground">Accession #</p>
                <p className="font-mono font-semibold">{accessionNumber}</p>
              </div>
            )}
            {ohif?.pacsType && (
              <div>
                <p className="text-xs text-muted-foreground">PACS</p>
                <Badge variant="outline">{ohif.pacsType}</Badge>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border p-10 flex items-center justify-center text-muted-foreground text-sm gap-3">
            <RefreshCw size={16} className="animate-spin" />
            Loading viewer configuration…
          </div>
        )}

        {!loading && (
          <div className="space-y-4">
            {/* Open viewer buttons */}
            <div className="flex flex-wrap gap-3">
              {ohifEnabled && (viewerMode === "OHIF" || viewerMode === "BOTH") && (
                <>
                  {ohif?.ohifUrl ? (
                    <Button
                      onClick={openOhif}
                      className="gap-2 h-10 px-5"
                      variant={defaultViewer === "OHIF" ? "default" : "outline"}
                    >
                      <MonitorPlay size={16} />
                      {defaultViewer === "OHIF" ? "Open Viewer (OHIF)" : "Open in OHIF"}
                      <ExternalLink size={13} />
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground max-w-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle size={14} className="text-amber-500" />
                        <span className="font-medium">OHIF not configured</span>
                      </div>
                      <p className="text-xs">{ohif?.error ?? "Configure OHIF Base URL in PACS Settings → Viewer Settings."}</p>
                      <a href="/erp/radiology/pacs-settings" className="text-xs underline text-primary mt-1 inline-flex items-center gap-1">
                        Open PACS Settings <Settings size={10} />
                      </a>
                    </div>
                  )}
                </>
              )}

              {weasisEnabled && (viewerMode === "WEASIS" || viewerMode === "BOTH") && (
                <>
                  {weasis?.weasisUrl && !weasis.error ? (
                    <Button
                      onClick={openWeasis}
                      className="gap-2 h-10 px-5"
                      variant={defaultViewer === "WEASIS" ? "default" : "outline"}
                    >
                      <Tv2 size={16} />
                      {defaultViewer === "WEASIS" ? "Open Viewer (Weasis)" : "Open in Weasis"}
                      <ExternalLink size={13} />
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground max-w-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle size={14} className="text-amber-500" />
                        <span className="font-medium">Weasis not configured</span>
                      </div>
                      <p className="text-xs">{weasis?.error ?? "Configure WADO URL in PACS Settings → Viewer Settings."}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {weasisEnabled && weasis?.weasisUrl && !weasis.error && <WeasisInstallHint />}

            {/* Embedded OHIF iframe */}
            {allowEmbedded && ohif?.ohifUrl && (
              <div className="rounded-xl border overflow-hidden shadow-sm">
                <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">OHIF Viewer (embedded)</span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={openOhif}>
                    <ExternalLink size={11} /> Full Screen
                  </Button>
                </div>
                <iframe
                  src={ohif.ohifUrl}
                  title="OHIF Viewer"
                  className="w-full"
                  style={{ height: aiOpen ? "50vh" : "70vh", border: "none" }}
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
                />
              </div>
            )}

            {/* Technical details + config status */}
            <div className="rounded-xl border bg-muted/20 p-4 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-muted-foreground">Study Details &amp; Config Status</p>
                <a href="/erp/radiology/pacs-settings" className="text-primary underline text-[10px] inline-flex items-center gap-1 hover:opacity-80">
                  PACS Settings <Settings size={9} />
                </a>
              </div>
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-40 shrink-0">Study Instance UID</span>
                  <code className="bg-muted px-1 rounded break-all">{studyInstanceUID}</code>
                </div>
                {ohif?.dicomWebBaseUrl && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-40 shrink-0">DICOMweb Base URL</span>
                    <code className="bg-muted px-1 rounded break-all">{ohif.dicomWebBaseUrl}</code>
                  </div>
                )}
                {weasis?.wadoBaseUrl && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-40 shrink-0">WADO Base URL</span>
                    <code className="bg-muted px-1 rounded break-all">{weasis.wadoBaseUrl}</code>
                  </div>
                )}
              </div>
              {/* 9-key config status grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1 border-t">
                {([
                  { key: "ohif_base_url",                label: "OHIF Base URL" },
                  { key: "ohif_study_url_template",      label: "OHIF URL Template" },
                  { key: "dicom_web_base_url",           label: "DICOMweb URL" },
                  { key: "wado_uri_base_url",            label: "WADO-URI URL" },
                  { key: "weasis_manifest_url_template", label: "Weasis Template" },
                  { key: "conquest_base_url",            label: "Conquest URL" },
                  { key: "pacs_ae_title",                label: "PACS AE Title" },
                  { key: "pacs_ip",                      label: "PACS IP" },
                  { key: "pacs_port",                    label: "PACS Port" },
                ] as const).map(({ key, label }) => {
                  const configured = !!(settings[key]?.trim());
                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] ${
                        configured
                          ? "border-green-200 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300"
                          : "border-red-200 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"
                      }`}
                    >
                      {configured
                        ? <CheckCircle2 size={9} className="shrink-0" />
                        : <AlertTriangle size={9} className="shrink-0" />
                      }
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI nudge when not open and enabled */}
            {!aiOpen && aiEnabled && (
              <div className="rounded-xl border border-purple-200 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-800 p-4 flex items-center gap-3">
                <BrainCircuit size={18} className="text-purple-500 shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-purple-900 dark:text-purple-200">AI Assistant available</p>
                  <p className="text-xs text-purple-700 dark:text-purple-400">Generate a draft report, ask about findings, or check for emergencies.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-purple-300 text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-300"
                  onClick={() => setAiOpen(true)}
                >
                  <BrainCircuit size={13} /> Open
                </Button>
              </div>
            )}

            {!aiOpen && !aiEnabled && (
              <div className="rounded-xl border border-dashed p-4 flex items-center gap-3 text-sm text-muted-foreground">
                <BrainCircuit size={18} className="shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">AI Reporting not enabled</p>
                  <p className="text-xs">Configure API keys and enable AI reporting in Radiology → AI Reporting.</p>
                </div>
                <a href="/erp/radiology/ai-reporting-settings">
                  <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
                    <Settings size={12} /> Configure
                  </Button>
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI Side Drawer ── */}
      {aiOpen && studyInstanceUID && (
        <div
          className="shrink-0 overflow-hidden border-l"
          style={{ width: "clamp(300px, 30vw, 400px)" }}
        >
          <AiDrawer
            studyInstanceUID={studyInstanceUID}
            accessionNumber={accessionNumber}
            aiSettings={aiSettingsQuery.data}
            onClose={() => setAiOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
