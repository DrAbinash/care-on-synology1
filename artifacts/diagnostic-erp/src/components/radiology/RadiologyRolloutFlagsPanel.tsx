/**
 * Radiology rollout flags — enable the canonical catalog chain from Settings.
 * Uses GET/PATCH /api/feature-flags with registry dependency rules enforced server-side.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { setServerFeatureFlags } from "@/lib/staffSession";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

type FlagRow = {
  key: string;
  enabled: boolean;
  description: string;
  wired?: boolean;
};

/** Catalog admin requires structured core → catalog (registry enable order 1 → 2). */
export const CATALOG_ROLLOUT_FLAGS = [
  "ff_radiology_structured_core",
  "ff_radiology_catalog",
] as const;

type Props = {
  title?: string;
  subtitle?: string;
  flagKeys?: readonly string[];
  disabled?: boolean;
};

export function RadiologyRolloutFlagsPanel({
  title = "Radiology rollout flags",
  subtitle = "Server-side switches (feature_flags table). Enable in order: structured core, then canonical catalog.",
  flagKeys = CATALOG_ROLLOUT_FLAGS,
  disabled = false,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: flags = [], isLoading } = useQuery<FlagRow[]>({
    queryKey: ["feature-flags"],
    queryFn: () => api.get("/api/feature-flags"),
  });

  const rows = useMemo(
    () => flagKeys.map((key) => flags.find((f) => f.key === key)).filter(Boolean) as FlagRow[],
    [flags, flagKeys],
  );

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api.patch<FlagRow>(`/api/feature-flags/${key}`, { enabled }),
    onSuccess: (updated) => {
      setServerFeatureFlags({ [updated.key]: updated.enabled });
      void qc.invalidateQueries({ queryKey: ["feature-flags"] });
      toast({
        title: updated.enabled ? "Flag enabled" : "Flag disabled",
        description: updated.key,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not update flag",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading flags…</p>}
      {!isLoading && rows.length === 0 && (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          Flag rows not found in database — run migrations / seed feature_flags.
        </p>
      )}
      <div className="space-y-2">
        {rows.map((f) => {
          const wired = f.wired !== false;
          return (
            <div key={f.key} className="flex items-start justify-between gap-3 border rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs font-mono">{f.key}</Label>
                  {wired ? (
                    <Badge variant="outline" className="text-[10px]">wired</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">not wired</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{f.description}</p>
              </div>
              <Switch
                checked={f.enabled}
                disabled={disabled || toggle.isPending || (!wired && !f.enabled)}
                onCheckedChange={(v) => toggle.mutate({ key: f.key, enabled: v })}
              />
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Full registry: Settings → Feature Flags (Server) or Radiology Ops → Flags.
      </p>
    </div>
  );
}
