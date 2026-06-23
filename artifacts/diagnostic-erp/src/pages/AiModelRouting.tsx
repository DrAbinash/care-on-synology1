import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Route, RotateCcw, Save, Eye, ShieldCheck } from "lucide-react";

interface TaskDef {
  key: string;
  label: string;
  description: string;
  vision: boolean;
}

interface ProviderMeta {
  name: string;
  label: string;
  models: string[];
}

interface RouteConfig {
  provider: string;
  model: string | null;
  isActive: boolean;
}

interface RoutingResponse {
  tasks: TaskDef[];
  providers: ProviderMeta[];
  routes: Record<string, RouteConfig>;
}

const DEFAULT_SENTINEL = "__default__";
const PROVIDER_MODEL_SENTINEL = "__provider_default__";

export default function AiModelRouting() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-model-routing"],
    queryFn: () => api.get<RoutingResponse>("/api/ai-model-routing"),
  });

  const [draft, setDraft] = useState<Record<string, RouteConfig | null>>({});

  useEffect(() => {
    if (data) {
      const next: Record<string, RouteConfig | null> = {};
      for (const t of data.tasks) {
        next[t.key] = data.routes[t.key] ?? null;
      }
      setDraft(next);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (vars: { taskKey: string; cfg: RouteConfig }) =>
      api.put(`/api/ai-model-routing/${vars.taskKey}`, {
        provider: vars.cfg.provider,
        model: vars.cfg.model,
        isActive: vars.cfg.isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-model-routing"] });
      toast({ title: "Route saved", description: "This AI task will now use the selected provider." });
    },
    onError: (e: unknown) => {
      toast({ title: "Could not save route", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (taskKey: string) => api.delete(`/api/ai-model-routing/${taskKey}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-model-routing"] });
      toast({ title: "Reverted to default", description: "This task will use the global default AI provider." });
    },
    onError: (e: unknown) => {
      toast({ title: "Could not reset route", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const providers = data?.providers ?? [];

  function providerLabel(name: string): string {
    return providers.find((p) => p.name === name)?.label ?? name;
  }

  function modelsFor(provider: string): string[] {
    return providers.find((p) => p.name === provider)?.models ?? [];
  }

  function setTaskProvider(taskKey: string, provider: string) {
    if (provider === DEFAULT_SENTINEL) {
      setDraft((d) => ({ ...d, [taskKey]: null }));
      return;
    }
    setDraft((d) => ({
      ...d,
      [taskKey]: { provider, model: null, isActive: d[taskKey]?.isActive ?? true },
    }));
  }

  function setTaskModel(taskKey: string, model: string) {
    setDraft((d) => {
      const cur = d[taskKey];
      if (!cur) return d;
      return { ...d, [taskKey]: { ...cur, model: model === PROVIDER_MODEL_SENTINEL ? null : model } };
    });
  }

  function setTaskActive(taskKey: string, isActive: boolean) {
    setDraft((d) => {
      const cur = d[taskKey];
      if (!cur) return d;
      return { ...d, [taskKey]: { ...cur, isActive } };
    });
  }

  function handleSave(taskKey: string) {
    const cfg = draft[taskKey];
    if (!cfg) {
      resetMutation.mutate(taskKey);
      return;
    }
    saveMutation.mutate({ taskKey, cfg });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Model Routing"
        subtitle="Send each AI task to the provider and model that suits it best — radiology on a vision model, billing on a fast text model, and so on. Tasks left on 'Default' use the global default provider."
      />

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Routing only changes which model produces a draft. AI never finalizes or signs reports —
          every AI output is labeled <strong>"AI Draft – Requires Radiologist Review"</strong>.
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading routing configuration…</div>
      ) : (
        <div className="space-y-3">
          {(data?.tasks ?? []).map((task) => {
            const cfg = draft[task.key] ?? null;
            const usingDefault = !cfg;
            const models = cfg ? modelsFor(cfg.provider) : [];
            return (
              <div
                key={task.key}
                className="rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <Route className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{task.label}</span>
                      {task.vision && (
                        <Badge variant="secondary" className="gap-1">
                          <Eye className="h-3 w-3" /> Vision
                        </Badge>
                      )}
                      {usingDefault ? (
                        <Badge variant="outline">Default provider</Badge>
                      ) : !cfg!.isActive ? (
                        <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>
                      ) : (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">{providerLabel(cfg!.provider)}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={cfg?.provider ?? DEFAULT_SENTINEL}
                      onValueChange={(v) => setTaskProvider(task.key, v)}
                    >
                      <SelectTrigger className="w-[190px]">
                        <SelectValue placeholder="Provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_SENTINEL}>Use global default</SelectItem>
                        {providers.map((p) => (
                          <SelectItem key={p.name} value={p.name}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {cfg && (
                      <>
                        {models.length > 0 ? (
                          <Select
                            value={cfg.model ?? PROVIDER_MODEL_SENTINEL}
                            onValueChange={(v) => setTaskModel(task.key, v)}
                          >
                            <SelectTrigger className="w-[210px]">
                              <SelectValue placeholder="Model" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={PROVIDER_MODEL_SENTINEL}>Provider default model</SelectItem>
                              {models.map((m) => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="w-[210px]"
                            placeholder="Model (optional)"
                            value={cfg.model ?? ""}
                            onChange={(e) => setTaskModel(task.key, e.target.value)}
                          />
                        )}

                        <div className="flex items-center gap-1.5" title="Enable this route">
                          <Switch
                            checked={cfg.isActive}
                            onCheckedChange={(v) => setTaskActive(task.key, v)}
                          />
                        </div>
                      </>
                    )}

                    <Button
                      size="sm"
                      onClick={() => handleSave(task.key)}
                      disabled={saveMutation.isPending || resetMutation.isPending}
                    >
                      <Save className="mr-1 h-4 w-4" /> Save
                    </Button>
                    {!usingDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetMutation.mutate(task.key)}
                        disabled={saveMutation.isPending || resetMutation.isPending}
                        title="Revert to global default provider"
                      >
                        <RotateCcw className="mr-1 h-4 w-4" /> Reset
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
