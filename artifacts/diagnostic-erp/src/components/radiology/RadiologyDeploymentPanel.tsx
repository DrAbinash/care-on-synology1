import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Info } from "lucide-react";

type Overview = {
  orthancInternal: { display: string; networkNote: string; source: string };
  deployment: {
    orthancWorklistDir: string | null;
    orthancWorklistHostHint: string | null;
    stagingDir: string | null;
    pacsProvider: string;
    secrets: { orthancPasswordSet: boolean; internalApiKeySet: boolean };
  };
  syncWorkers: Array<{ id: string; label: string; enabled: boolean; detail: string }>;
};

/**
 * READ-ONLY deployment panel — shows resolved env values without inventing
 * Docker hostnames or exposing secrets.
 */
export function RadiologyDeploymentPanel() {
  const { data, isLoading, error } = useQuery<Overview>({
    queryKey: ["radiology-admin-overview"],
    queryFn: () => api.get("/api/radiology/admin-overview"),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="rounded-xl border p-4 text-sm text-muted-foreground animate-pulse">Loading deployment status…</div>;
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Could not load deployment overview. Values may still be configured via care.env / compose.
      </div>
    );
  }

  const rows: Array<{ label: string; value: string; note?: string }> = [
    { label: "ORTHANC_INTERNAL_URL", value: data.orthancInternal.display, note: data.orthancInternal.networkNote },
    { label: "ORTHANC_WORKLIST_DIR (container)", value: data.deployment.orthancWorklistDir ?? "Not set — configure via deployment environment" },
    { label: "ORTHANC_WORKLIST_HOST_DIR (hint)", value: data.deployment.orthancWorklistHostHint ?? "Configured via deployment environment (if set)" },
    { label: "MWL staging (container)", value: data.deployment.stagingDir ?? "Derived as sibling worklists-staging or unavailable" },
    { label: "PACS_PROVIDER", value: data.deployment.pacsProvider },
    { label: "Orthanc password", value: data.deployment.secrets.orthancPasswordSet ? "Set (hidden)" : "Not set" },
    { label: "INTERNAL_API_KEY", value: data.deployment.secrets.internalApiKeySet ? "Set (hidden)" : "Not set" },
  ];

  return (
    <div className="space-y-4" data-testid="radiology-deployment-panel">
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert size={16} className="text-primary" />
          Advanced / Deployment (read-only)
        </h3>
        <p className="text-xs text-muted-foreground flex gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          These values come from the API process environment and mounts. They cannot be edited here.
          StorageDirectory / IndexDirectory are owned by care-pacs — not shown or editable in ERP.
        </p>
      </div>

      <div className="rounded-xl border divide-y bg-card">
        {rows.map((r) => (
          <div key={r.label} className="p-3 grid sm:grid-cols-[220px_1fr] gap-2 text-xs">
            <div className="font-semibold text-muted-foreground">{r.label}</div>
            <div>
              <div className="font-mono break-all text-foreground">{r.value}</div>
              {r.note && <p className="text-[10px] text-muted-foreground mt-1">{r.note}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Worker flags (this process)</h4>
        <ul className="space-y-1">
          {data.syncWorkers.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 text-xs">
              <span title={w.detail}>{w.label}</span>
              <Badge variant="outline" className={w.enabled ? "text-emerald-700" : ""}>{w.enabled ? "ON" : "OFF"}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
