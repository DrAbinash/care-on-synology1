/**
 * Thin infrastructure pulse strip for My Daily Summary (admin only).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { buildInfrastructurePulse, type PulseTone } from "@/lib/infrastructurePulse";
import { Button } from "@/components/ui/button";
import { RefreshCw, Gauge } from "lucide-react";

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

const ORANGE_OK_DOT = "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.75)]";

export function InfrastructurePulseStrip() {
  const { data, isLoading, isFetching, refetch, error } = useQuery<OpsReport>({
    queryKey: ["/api/admin/operations/health", "infrastructure-pulse"],
    queryFn: () => api.get("/api/admin/operations/health?includeOptional=1&timeout=4500"),
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: false,
  });

  if (error) return null;

  const pills = data ? buildInfrastructurePulse(data.checks) : [];
  const badCount = pills.filter((p) => p.tone === "red" || p.tone === "amber").length;
  const okCount = pills.filter((p) => p.tone === "green").length;

  return (
    <div
      className="rounded-lg border border-slate-200/80 dark:border-card-border bg-white/90 dark:bg-card/80 px-2.5 py-2 shadow-sm"
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
              {badCount === 0 ? `${okCount} OK` : `${badCount} need attention`}
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
          <Link href="/radiology/operational-health">
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1">
              <Gauge size={11} /> Details
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
