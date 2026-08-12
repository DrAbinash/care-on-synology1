/**
 * OvernightAiSettings — configure midnight DICOM → Ollama draft batch.
 *
 * Radiologists pick which modalities run overnight (multi-select). Selected
 * modalities are stored as night_batch policies; others stay disabled.
 * Schedule times write to ai_scheduler_config (nightStart / nightEnd).
 * Open WebUI remains the offline layout-training surface; ERP inference
 * uses the on-prem Ollama gateway (radiology_draft).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { aiClient } from "@/lib/aiClient";
import { Moon, Play, RefreshCw, Save, Bot } from "lucide-react";

const OVERNIGHT_OPTIONS: Array<{ code: string; label: string; hint: string }> = [
  { code: "MR", label: "MRI", hint: "MR / MRI studies" },
  { code: "CT", label: "CT", hint: "CT / HRCT" },
  { code: "CR", label: "X-Ray", hint: "CR / DX / XR" },
  { code: "US", label: "USG", hint: "Ultrasound" },
  { code: "MG", label: "Mammography", hint: "MG" },
  { code: "Doppler", label: "Doppler", hint: "Vascular Doppler" },
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

  const [selected, setSelected] = useState<string[]>([]);
  const [nightStart, setNightStart] = useState("23:00");
  const [nightEnd, setNightEnd] = useState("06:00");
  const [quietStart, setQuietStart] = useState("08:00");
  const [quietEnd, setQuietEnd] = useState("20:00");

  useEffect(() => {
    // Chips reflect night_batch only — immediate/manual are daytime policies.
    const overnight = policies.filter((p) => p.mode === "night_batch").map((p) => p.modality);
    setSelected(overnight);
  }, [policies]);

  useEffect(() => {
    if (!scheduler) return;
    setNightStart(String(scheduler.nightStart ?? "23:00"));
    setNightEnd(String(scheduler.nightEnd ?? "06:00"));
    setQuietStart(String(scheduler.quietStart ?? "08:00"));
    setQuietEnd(String(scheduler.quietEnd ?? "20:00"));
  }, [scheduler]);

  const selectedLabel = useMemo(
    () => (selected.length === 0 ? "None — overnight AI will not run" : selected.join(", ")),
    [selected],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      await aiClient.saveSchedulerConfig({ nightStart, nightEnd, quietStart, quietEnd });
      await aiClient.setOvernightModalities(selected, "night_batch");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ai-modality-policies"] });
      void qc.invalidateQueries({ queryKey: ["ai-scheduler-config"] });
      toast({
        title: "Overnight AI saved",
        description: `Modalities: ${selectedLabel}. Window ${nightStart}–${nightEnd}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: () => aiClient.runNightBatch(true),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["ai-queue"] });
      toast({
        title: "Night batch triggered",
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
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading overnight AI…
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="overnight-ai-settings">
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/20 p-4">
        <div className="flex items-start gap-3">
          <Moon className="h-5 w-5 text-indigo-700 mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-indigo-900 dark:text-indigo-100">Overnight DICOM → Ollama drafts</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              After midnight (your window below), complete studies for the selected modalities are sent to on-prem Ollama.
              Structured drafts are saved for morning review. Radiologists edit/sign in the reporting workspace; print and
              PACS archive use the normal finalize path. Open WebUI is for offline layout/format practice — production
              inference stays on the Ollama gateway.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">Overnight modalities (multi-select)</Label>
        <p className="text-[11px] text-muted-foreground">
          Only checked modalities are drafted overnight. Example: MRI alone → CT / X-Ray / USG are skipped.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {OVERNIGHT_OPTIONS.map((opt) => {
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <Label className="text-[11px]">Night start</Label>
          <Input type="time" value={nightStart} onChange={(e) => setNightStart(e.target.value)} className="h-8" />
        </div>
        <div>
          <Label className="text-[11px]">Night end</Label>
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
      <p className="text-[10px] text-muted-foreground">
        Quiet hours defer routine immediate work to the night window. STAT/emergency still run immediately.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="gap-1.5"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save overnight settings
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={runMutation.isPending}
          onClick={() => {
            if (!window.confirm("Run overnight batch now (forces outside the night window)?")) return;
            runMutation.mutate();
          }}
          title="Admin force-run — processes selected modalities immediately"
        >
          {runMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run batch now
        </Button>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-[11px] space-y-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <Bot className="h-3.5 w-3.5" /> Morning workflow
        </div>
        <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
          <li>Overnight job drafts selected modalities via Ollama (images + study metadata).</li>
          <li>Worklist shows AI draft READY; open Reporting Workspace → AI Draft panel.</li>
          <li>Accept / edit findings, then Finalize (sign) as usual.</li>
          <li>Print / PDF and PACS Encapsulated PDF archive run from finalize — unchanged.</li>
        </ol>
        {queue && (
          <p className="pt-1 text-muted-foreground">
            Queue snapshot: {JSON.stringify((queue as { backlog?: unknown }).backlog ?? queue).slice(0, 180)}
          </p>
        )}
      </div>
    </div>
  );
}
