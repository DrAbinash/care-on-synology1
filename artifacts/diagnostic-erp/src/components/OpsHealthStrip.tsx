import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Gauge, RefreshCw } from "lucide-react";

type OpsReport = {
  overall: "PASS" | "WARNING" | "FAIL" | "SKIPPED" | "UNKNOWN";
  generatedAt: string;
  summary: { pass: number; warning: number; fail: number; skipped: number; unknown: number; total: number };
  checks: Array<{ id: string; name: string; status: OpsReport["overall"]; message: string; required: boolean }>;
};

function badgeClass(status: OpsReport["overall"]) {
  if (status === "PASS") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "FAIL") return "bg-red-100 text-red-700 border-red-200";
  if (status === "WARNING") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function OpsHealthStrip() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<OpsReport>({
    queryKey: ["/api/admin/operations/health", "dashboard-strip"],
    queryFn: () => api.get("/api/admin/operations/health?includeOptional=0&timeout=2500"),
    retry: false,
    staleTime: 60_000,
  });

  if (error) return null;
  const failing = data?.checks.filter((c) => c.status === "FAIL" || c.status === "UNKNOWN").slice(0, 3) ?? [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-card-border bg-white dark:bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${data?.overall === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {data?.overall === "PASS" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">Operational health</h3>
              <Badge variant="outline" className={data ? badgeClass(data.overall) : ""}>
                {isLoading ? "Loading" : data?.overall ?? "Unknown"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {data
                ? `${data.summary.pass}/${data.summary.total} checks pass · ${data.summary.fail} fail · ${data.summary.warning} warn`
                : "Verifying API, DB, auth, ERP, radiology, integrations, and storage."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? "mr-1 animate-spin" : "mr-1"} /> Refresh
          </Button>
          <Link href="/radiology/operational-health">
            <Button size="sm" variant="outline">
              <Gauge size={13} className="mr-1" /> Details
            </Button>
          </Link>
        </div>
      </div>
      {failing.length > 0 && (
        <div className="mt-2 grid md:grid-cols-3 gap-2">
          {failing.map((check) => (
            <div key={check.id} className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <strong>{check.name}:</strong> {check.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
