/**
 * AiDraftAutomationSettings — Settings → Radiology → AI → Draft automation.
 *
 * Timing is selectable:
 *   - on_arrival: draft as soon as DICOM is stable (intake)
 *   - scheduled: only inside the configured night window
 * Multi-select modalities. Saves via /api/ai/draft-automation (enables master flag).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { aiClient } from "@/lib/aiClient";
import { api } from "@/lib/fetchApi";
import { Moon, Play, RefreshCw, Save, Bot, Zap, Clock } from "lucide-react";

const MODALITY_OPTIONS: Array<{ code: string; label: string; hint: string }> = [
  { code: "MR", label: "MRI", hint: "MR / MRI studies" },
  { code: "CT", label: "CT", hint: "CT / HRCT" },
  { code: "CR", label: "X-Ray", hint: "CR / DX / XR" },
  { code: "US", label: "USG", hint: "Ultrasound" },
  { code: "MG", label: "Mammography", hint: "MG" },
  { code: "Doppler", label: "Doppler", hint: "Vascular Doppler" },
];

const STUDY_AGE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: "all", label: "All eligible studies", hint: "No date filter (previous default)" },
  { id: "today", label: "Today / current day", hint: "IST calendar day — not the same as last 24 hours" },
  { id: "last_24h", label: "Last 24 hours", hint: "Rolling 24 hours from now" },
  { id: "last_48h", label: "Last 48 hours", hint: "Rolling 48 hours from now" },
  { id: "last_3d", label: "Last 3 days", hint: "Rolling 72 hours from now" },
  { id: "last_7d", label: "Last 7 days", hint: "Rolling 7 days from now" },
  { id: "custom", label: "Custom date/time range", hint: "Inclusive from / to" },
];

export default function OvernightAiSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: policies = [], isLoading: loadingPolicies } = useQuery({
    queryKey: ["ai-modality-policies"],
    queryFn: () => aiClient.getModalityPolicies(),
  });
  const { data: scheduler, isLoading: loadingSched } = useQuery({
    queryKey: ["ai-scheduler-config"],
    queryFn: () => aiClient.getSchedulerConfig(),
  });
  const { data: queue } = useQuery({
    queryKey: ["ai-queue"],
    queryFn: () => aiClient.getQueue(),
    refetchInterval: 30_000,
  });
  const { data: preview, refetch: refetchPreview } = useQuery({
    queryKey: ["ai-night-batch-preview"],
    queryFn: () => aiClient.previewNightBatch(),
    refetchInterval: 30_000,
  });
  const { data: diagnostics } = useQuery({
    queryKey: ["ai-overnight-diagnostics"],
    queryFn: () => aiClient.getOvernightDiagnostics(),
    refetchInterval: 20_000,
  });
  const { data: masterFlagOn } = useQuery({
    queryKey: ["feature-flags", "ff_radiology_ai"],
    queryFn: async () => {
      const rows = await api.get<Array<{ key: string; enabled: boolean }>>("/api/feature-flags");
      return rows.find((r) => r.key === "ff_radiology_ai")?.enabled ?? false;
    },
  });

  const [timing, setTiming] = useState<DraftTiming>("on_arrival");
  const [selected, setSelected] = useState<string[]>([]);
  const [nightStart, setNightStart] = useState("17:00");
  const [nightEnd, setNightEnd] = useState("10:00");
  const [quietStart, setQuietStart] = useState("10:00");
  const [quietEnd, setQuietEnd] = useState("17:00");
  const [enableAi, setEnableAi] = useState(true);
  const [studyAgeWindow, setStudyAgeWindow] = useState("all");
  const [studyAgeCustomFrom, setStudyAgeCustomFrom] = useState("");
  const [studyAgeCustomTo, setStudyAgeCustomTo] = useState("");

  useEffect(() => {
    if (masterFlagOn !== undefined) setEnableAi(masterFlagOn);
  }, [masterFlagOn]);

  useEffect(() => {
    const active = policies
      .filter((p) => p.mode === "night_batch" || p.mode === "immediate")
      .map((p) => p.modality);
    setSelected(active);
  }, [policies]);

  useEffect(() => {
    if (!scheduler) return;
    setTiming((scheduler.draftTiming as DraftTiming) === "scheduled" ? "scheduled" : "on_arrival");
    setNightStart(String(scheduler.nightStart ?? "23:00"));
    setNightEnd(String(scheduler.nightEnd ?? "06:00"));
    setQuietStart(String(scheduler.quietStart ?? "08:00"));
    setQuietEnd(String(scheduler.quietEnd ?? "20:00"));
    setStudyAgeWindow(String(scheduler.studyAgeWindow ?? "all"));
    const from = scheduler.studyAgeCustomFrom;
    const to = scheduler.studyAgeCustomTo;
    setStudyAgeCustomFrom(typeof from === "string" ? from.slice(0, 16) : "");
    setStudyAgeCustomTo(typeof to === "string" ? to.slice(0, 16) : "");
  }, [scheduler]);

  const selectedLabel = useMemo(
    () => (selected.length === 0 ? "None — AI drafting will not run" : selected.join(", ")),
    [selected],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      aiClient.saveDraftAutomation({
        draftTiming: timing,
        modalities: selected,
        nightStart,
        nightEnd,
        quietStart,
        quietEnd,
        studyAgeWindow,
        studyAgeCustomFrom: studyAgeWindow === "custom" && studyAgeCustomFrom ? new Date(studyAgeCustomFrom).toISOString() : null,
        studyAgeCustomTo: studyAgeWindow === "custom" && studyAgeCustomTo ? new Date(studyAgeCustomTo).toISOString() : null,
        enableAi,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["ai-modality-policies"] });
      void qc.invalidateQueries({ queryKey: ["ai-scheduler-config"] });
      void qc.invalidateQueries({ queryKey: ["feature-flags"] });
      void qc.invalidateQueries({ queryKey: ["ai-reporting-settings"] });
      void qc.invalidateQueries({ queryKey: ["ai-night-batch-preview"] });
      void qc.invalidateQueries({ queryKey: ["ai-overnight-diagnostics"] });
      window.dispatchEvent(new Event("featureFlagsChanged"));
      toast({
        title: "AI draft automation saved",
        description: `${timing === "on_arrival" ? "On DICOM arrival" : `Scheduled ${nightStart}–${nightEnd}`}: ${selectedLabel}. Master AI ${res.masterEnabled ? "ON" : "OFF"}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: () => aiClient.runNightBatch(true, true),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["ai-queue"] });
      void qc.invalidateQueries({ queryKey: ["ai-night-batch-preview"] });
      void qc.invalidateQueries({ queryKey: ["ai-overnight-diagnostics"] });
      void refetchPreview();
      toast({
        title: "Eligible drafts queued",
        description: `Enqueued ${res.enqueued ?? 0} new studies (skipped READY / already queued).`,
      });
    },
    onError: (e: Error) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (code: string) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  if (loadingPolicies || loadingSched) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading AI draft settings…
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="ai-draft-automation-settings">
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 dark:from-indigo-950/30 dark:to-sky-950/20 p-4">
        <div className="flex items-start gap-3">
          <Bot className="h-5 w-5 text-indigo-700 mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-indigo-900 dark:text-indigo-100">DICOM → Ollama draft automation</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Choose when selected modalities are drafted: as soon as DICOM arrives, or only inside a time window.
              Drafts are saved on the worklist (AI READY) and seeded into the patient report draft for morning edit/sign.
              Print and PACS archive stay on the normal finalize path.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">When to draft</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={timing === "on_arrival"}
            onClick={() => setTiming("on_arrival")}
            className={`rounded-md border px-3 py-3 text-left transition ${
              timing === "on_arrival"
                ? "border-emerald-500 bg-emerald-600 text-white"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4" /> On DICOM arrival
            </div>
            <p className={`text-[10px] mt-1 ${timing === "on_arrival" ? "text-emerald-100" : "text-muted-foreground"}`}>
              Stable study intake triggers Ollama draft immediately for selected modalities.
            </p>
          </button>
          <button
            type="button"
            aria-pressed={timing === "scheduled"}
            onClick={() => setTiming("scheduled")}
            className={`rounded-md border px-3 py-3 text-left transition ${
              timing === "scheduled"
                ? "border-indigo-500 bg-indigo-600 text-white"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4" /> At scheduled time
            </div>
            <p className={`text-[10px] mt-1 ${timing === "scheduled" ? "text-indigo-100" : "text-muted-foreground"}`}>
              Batch runs only inside the night window below (default 17:00–10:00 IST). Cron polls every 15 min; the window check is server-side.
            </p>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">Modalities (multi-select)</Label>
        <p className="text-[11px] text-muted-foreground">
          Only checked modalities are drafted. Example: MRI alone → CT / X-Ray / USG are skipped.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MODALITY_OPTIONS.map((opt) => {
            const on = selected.includes(opt.code);
            return (
              <button
                key={opt.code}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(opt.code)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  on
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className={`text-[10px] ${on ? "text-indigo-100" : "text-muted-foreground"}`}>{opt.hint}</div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] font-medium text-foreground">Active: {selectedLabel}</p>
      </div>

      {timing === "scheduled" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-[11px]">Window start</Label>
            <Input type="time" value={nightStart} onChange={(e) => setNightStart(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-[11px]">Window end</Label>
            <Input type="time" value={nightEnd} onChange={(e) => setNightEnd(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-[11px]">Quiet start</Label>
            <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-[11px]">Quiet end</Label>
            <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="h-8" />
          </div>
        </div>
      )}
      {timing === "scheduled" && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Moon className="h-3 w-3" /> Quiet hours only apply if a modality is still on daytime immediate elsewhere. STAT always runs now.
        </p>
      )}

      <div className="space-y-2" data-testid="overnight-study-age-window">
        <Label className="text-sm font-semibold">Study selection</Label>
        <p className="text-[11px] text-muted-foreground">
          Limits which studies the overnight batch enqueues. <strong>Today</strong> is the IST calendar day;
          <strong> Last 24 hours</strong> is a rolling window — they are not the same.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {STUDY_AGE_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer ${
                studyAgeWindow === opt.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="study-age-window"
                className="mt-1"
                checked={studyAgeWindow === opt.id}
                onChange={() => setStudyAgeWindow(opt.id)}
              />
              <span>
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="block text-[10px] text-muted-foreground">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {studyAgeWindow === "custom" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <Label className="text-[11px]">From</Label>
              <Input type="datetime-local" value={studyAgeCustomFrom} onChange={(e) => setStudyAgeCustomFrom(e.target.value)} className="h-8" />
            </div>
            <div>
              <Label className="text-[11px]">To</Label>
              <Input type="datetime-local" value={studyAgeCustomTo} onChange={(e) => setStudyAgeCustomTo(e.target.value)} className="h-8" />
            </div>
          </div>
        )}
      </div>

      {diagnostics && (
        <div className="rounded-md border bg-muted/30 p-3 text-[11px] space-y-1" data-testid="overnight-ai-diagnostics">
          <div className="font-semibold">Overnight AI diagnostics</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>Scheduler: <strong className="text-foreground">{String(diagnostics.scheduler ?? "—")}</strong></span>
            <span>Night window: <strong className="text-foreground">{String(diagnostics.nightWindow ?? "—")}</strong></span>
            <span>Worker: <strong className="text-foreground">{String(diagnostics.worker ?? "—")}</strong></span>
            <span>Local AI: <strong className="text-foreground">{String(diagnostics.localAi ?? "—")}</strong></span>
            <span>Model: <strong className="text-foreground">{String(diagnostics.model ?? "qwen3-vl:8b")}</strong></span>
            <span>Queue depth: <strong className="text-foreground">{String(diagnostics.queueDepth ?? 0)}</strong></span>
            <span>Running: <strong className="text-foreground">{String(diagnostics.running ?? 0)}</strong></span>
            <span>Oldest queued: <strong className="text-foreground">{diagnostics.oldestQueuedAt ? String(diagnostics.oldestQueuedAt).slice(11, 16) : "—"}</strong></span>
            <span>Last success: <strong className="text-foreground">{diagnostics.lastSuccessfulDraftAt ? String(diagnostics.lastSuccessfulDraftAt).slice(11, 16) : "—"}</strong></span>
          </div>
          {diagnostics.lastError ? (
            <p className="text-red-700 truncate">Last error: {String(diagnostics.lastError)}</p>
          ) : null}
          <p className="text-[10px] text-muted-foreground">Concurrency stays at 1 — Ollama processes one MRI draft at a time.</p>
        </div>
      )}

      {preview && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 text-[11px] space-y-1" data-testid="overnight-batch-preview">
          <div className="font-semibold text-indigo-900 dark:text-indigo-100">Batch preview</div>
          <p>Eligible MRI studies: <strong>{Number(preview.eligible ?? 0)}</strong></p>
          <p>Already READY: <strong>{Number(preview.alreadyReady ?? 0)}</strong></p>
          <p>Already QUEUED/RUNNING: <strong>{Number(preview.alreadyQueuedOrRunning ?? 0)}</strong></p>
          <p>Previously ERROR: <strong>{Number(preview.previouslyError ?? 0)}</strong></p>
          <p>New eligible studies: <strong>{Number(preview.newEligible ?? 0)}</strong></p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enableAi}
          onChange={(e) => setEnableAi(e.target.checked)}
          className="rounded border"
        />
        Enable radiology AI master flag + pilot visibility when saving
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" className="gap-1.5" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save draft automation
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={runMutation.isPending || Number(preview?.newEligible ?? 0) === 0}
          onClick={() => {
            const n = Number(preview?.newEligible ?? 0);
            if (!window.confirm(`Queue ${n} new eligible studies now? READY and already queued/running studies will be skipped.`)) return;
            runMutation.mutate();
          }}
        >
          {runMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run eligible {Number(preview?.newEligible ?? 0)}
        </Button>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-[11px] space-y-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <Bot className="h-3.5 w-3.5" /> Radiologist workflow
        </div>
        <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
          <li>Selected modalities are drafted via on-prem Ollama (images + study metadata).</li>
          <li>Worklist shows AI READY; patient report draft is seeded with findings.</li>
          <li>Open Reporting Workspace → AI Draft panel → Accept / edit → Finalize (sign).</li>
          <li>Print / PDF and PACS Encapsulated PDF archive run from finalize.</li>
        </ol>
        {queue && (
          <p className="pt-1 text-muted-foreground">
            Queue: {JSON.stringify((queue as { backlog?: unknown }).backlog ?? queue).slice(0, 180)}
          </p>
        )}
      </div>
    </div>
  );
}
