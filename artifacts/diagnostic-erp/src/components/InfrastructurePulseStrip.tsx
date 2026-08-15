/**
 * Thin infrastructure pulse strip for My Daily Summary (admin only).
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { buildInfrastructurePulse, type PulseTone } from "@/lib/infrastructurePulse";
import { buildClinicSystemsSummary, type EmergencyStatusLike } from "@/lib/clinicSystemsSummary";
import { Button } from "@/components/ui/button";
import { RefreshCw, Gauge, ShieldCheck } from "lucide-react";
import { useState } from "react";

type OpsReport = {
  checks: Array<{ id: string; status: "PASS" | "WARNING" | "FAIL" | "SKIPPED" | "UNKNOWN"; message: string }>;
};

const DOT_CLASS: Record<PulseTone, string> = {
  green: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
  red: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]",
  amber: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.75)]",
  grey: "bg-slate-400",
};

const PILL_CLASS: Record<PulseTone, string> = {
  green: "border-emerald-200/80 bg-emerald-50/80 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800",
  red: "border-red-200/90 bg-red-50/90 text-red-900 dark:bg-red-950/35 dark:text-red-200 dark:border-red-800",
  amber: "border-amber-200/90 bg-amber-50/90 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100 dark:border-amber-800",
  grey: "border-slate-200 bg-slate-50/80 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 dark:border-slate-700",
};

const ROW_VALUE: Record<PulseTone, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  red: "text-red-700 dark:text-red-300 font-semibold",
  amber: "text-amber-800 dark:text-amber-200 font-medium",
  grey: "text-muted-foreground",
};

const ORANGE_OK_DOT = "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.75)]";

export function InfrastructurePulseStrip() {
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const { data, isLoading, isFetching, refetch, error } = useQuery<OpsReport>({
    queryKey: ["/api/admin/operations/health", "infrastructure-pulse"],
    queryFn: () => api.get("/api/admin/operations/health?includeOptional=1&timeout=4500"),
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: false,
  });

  const { data: emergency } = useQuery<EmergencyStatusLike>({
    queryKey: ["emergency-nas-status", "clinic-systems"],
    queryFn: () => api.get("/api/emergency-billing/status"),
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; jobId?: number; note?: string }>("/api/radiology-ops/restore-verify", {}),
    onMutate: () => setVerifyMsg("Queuing restore-verify job…"),
    onSuccess: (r) => {
      setVerifyMsg(`✓ Queued (job #${r.jobId}). Result lands in ~1-2 min — refresh to see the Backup Verify light turn green.`);
      // Refetch health after a short delay so the new check result appears
      setTimeout(() => void refetch(), 5000);
      setTimeout(() => void refetch(), 30000);
      setTimeout(() => void refetch(), 90000);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setVerifyMsg(`✗ Failed to queue: ${msg}`);
    },
  });

  if (error) return null;

  const pills = data ? buildInfrastructurePulse(data.checks) : [];
  const summary = data ? buildClinicSystemsSummary({ checks: data.checks, emergency: emergency ?? null }) : null;
  const badCount = pills.filter((p) => p.tone === "red" || p.tone === "amber").length;
  const okCount = pills.filter((p) => p.tone === "green").length;
  const alertCount = summary?.alerts.length ?? 0;

  return (
    <div
      className="rounded-lg border border-slate-200/80 dark:border-card-border bg-white/90 dark:bg-card/80 px-2.5 py-2 shadow-sm space-y-2"
      data-testid="infrastructure-pulse-strip"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0 pr-1">
          Clinic systems
        </span>

        {isLoading ? (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <RefreshCw size={11} className="animate-spin" /> Checking…
          </span>
        ) : (
          pills.map((pill) => {
            const dotClass =
              pill.tone === "green" && pill.accent === "orange"
                ? ORANGE_OK_DOT
                : DOT_CLASS[pill.tone];
            const blink = pill.shouldBlink;
            return (
              <div
                key={pill.key}
                className={`group relative inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${PILL_CLASS[pill.tone]} ${pill.accent === "orange" && pill.tone === "green" ? "border-orange-300/80" : ""}`}
                title={pill.message}
              >
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${dotClass} ${blink ? "animate-[pulse-attention_2.5s_ease-in-out_infinite]" : ""}`}
                  aria-hidden
                />
                <span>{pill.label}</span>
                <span
                  className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden min-w-[14rem] max-w-xs rounded-md border bg-popover px-2 py-1.5 text-[10px] text-popover-foreground shadow-md group-hover:block group-focus-within:block"
                >
                  {pill.message}
                  {pill.detailsHref && (
                    <Link href={pill.detailsHref} className="block mt-1 text-primary underline">
                      Open settings
                    </Link>
                  )}
                </span>
              </div>
            );
          })
        )}

        <div className="flex items-center gap-1 ml-auto shrink-0">
          {!isLoading && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {alertCount > 0
                ? `${alertCount} emergency alert${alertCount === 1 ? "" : "s"}`
                : badCount === 0
                  ? `${okCount} OK`
                  : `${badCount} need attention`}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={isFetching}
            onClick={() => void refetch()}
            title="Refresh systems check"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            disabled={verifyMutation.isPending}
            onClick={() => verifyMutation.mutate()}
            title="Prove your latest backup actually restores — creates a throwaway DB, restores the dump, verifies tables/row-counts/audit-chain, then drops it"
          >
            <ShieldCheck size={11} className={verifyMutation.isPending ? "animate-spin" : ""} />
            {verifyMutation.isPending ? "Verifying…" : "Verify Backup"}
          </Button>
          <Link href="/radiology/operational-health">
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1">
              <Gauge size={11} /> Details
            </Button>
          </Link>
        </div>
      </div>

      {verifyMsg && (
        <div className="rounded-md px-2 py-1 text-[11px] bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-800">
          {verifyMsg}
        </div>
      )}

      {summary && (
        <div className="grid gap-2 sm:grid-cols-3 text-[11px] leading-5 font-mono" data-testid="clinic-systems-emergency">
          {summary.sections.map((section) => (
            <div key={section.title}>
              <div className="text-[10px] font-sans font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                {section.title}
              </div>
              {section.rows.map((row) => (
                <div key={row.key} className="flex justify-between gap-2">
                  <span className="text-muted-foreground font-sans">{row.label}</span>
                  <span className={ROW_VALUE[row.tone]}>{row.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {summary && summary.alerts.length > 0 && (
        <div className="space-y-1" data-testid="clinic-systems-emergency-alerts">
          {summary.alerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-md px-2 py-1 text-[11px] ${
                alert.severity === "red"
                  ? "bg-red-50 text-red-900 border border-red-200 dark:bg-red-950/40 dark:text-red-100 dark:border-red-800"
                  : "bg-amber-50 text-amber-950 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800"
              }`}
            >
              {alert.severity === "red" ? "⚠ " : ""}
              {alert.message}
              <Link href="/settings?tab=emergency-billing" className="ml-2 underline">
                Emergency Billing
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
