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
import { Moon, Play, RefreshCw, Save, Bot, Zap, Clock } from "lucide-react";

const MODALITY_OPTIONS: Array<{ code: string; label: string; hint: string }> = [
  { code: "MR", label: "MRI", hint: "MR / MRI studies" },
  { code: "CT", label: "CT", hint: "CT / HRCT" },
  { code: "CR", label: "X-Ray", hint: "CR / DX / XR" },
  { code: "US", label: "USG", hint: "Ultrasound" },
  { code: "MG", label: "Mammography", hint: "MG" },
  { code: "Doppler", label: "Doppler", hint: "Vascular Doppler" },
];

type DraftTiming = "on_arrival" | "scheduled";

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

  const [timing, setTiming] = useState<DraftTiming>("on_arrival");
  const [selected, setSelected] = useState<string[]>([]);
  const [nightStart, setNightStart] = useState("23:00");
  const [nightEnd, setNightEnd] = useState("06:00");
  const [quietStart, setQuietStart] = useState("08:00");
  const [quietEnd, setQuietEnd] = useState("20:00");
  const [enableAi, setEnableAi] = useState(true);

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
        enableAi,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["ai-modality-policies"] });
      void qc.invalidateQueries({ queryKey: ["ai-scheduler-config"] });
      toast({
        title: "AI draft automation saved",
        description: `${timing === "on_arrival" ? "On DICOM arrival" : `Scheduled ${nightStart}–${nightEnd}`}: ${selectedLabel}. Master AI ${res.masterEnabled ? "ON" : "OFF"}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: () => aiClient.runNightBatch(true),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["ai-queue"] });
      toast({
        title: "Draft batch triggered",
        description: `Considered ${res.considered ?? 0}, enqueued ${res.enqueued ?? 0}.`,
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
              Batch runs only inside the night window below (e.g. after midnight).
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
          disabled={runMutation.isPending}
          onClick={() => {
            if (!window.confirm("Run draft batch now for selected modalities (forces outside the night window)?")) return;
            runMutation.mutate();
          }}
        >
          {runMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run batch now
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
