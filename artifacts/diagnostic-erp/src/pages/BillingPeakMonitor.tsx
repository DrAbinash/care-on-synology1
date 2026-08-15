/**
 * BillingPeakMonitor — owner/admin Clinic Peak + Billing Lane dashboard.
 * Observability only. Polls ≥45s. No PHI.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshCw, Copy, Activity, Gauge } from "lucide-react";
import { useState } from "react";

type LatencySummary = {
  count: number;
  slowCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  avgMs: number | null;
};

type Snapshot = {
  generatedAt: string;
  refreshHintSec: number;
  billingLane: { tone: "GREEN" | "AMBER" | "RED"; reason: string };
  peakMode: { active: boolean; windowLabel: string };
  latency: {
    windowMinutes: number;
    slowThresholdMs: number;
    billSave: LatencySummary;
    patientSearch: LatencySummary;
    requestsPerMinute: number;
  };
  last15m: {
    slowBillSaveCount: number;
    slowPatientSearchCount: number;
    slowEndpoints: Array<{
      method: string;
      path: string;
      count: number;
      slowCount: number;
      p95Ms: number | null;
      maxMs: number | null;
    }>;
    dbPoolWaiting: number | null;
    checkpointerWriteDeltaMs: number | null;
    background: {
      mriWarmRunning: boolean;
      mriPausedForPeak: boolean;
      dicomPausedForPeak: boolean;
      usgPipelineEnabled: boolean;
    };
  };
  dbPool: { total: number; idle: number; waiting: number } | null;
  postgres: {
    ok: boolean;
    message: string;
    sharedBuffers: string | null;
    maxWalSize: string | null;
    checkpointTimeout: string | null;
    synchronousCommit: string | null;
    checkpointer: {
      available: boolean;
      cumulativeWriteTimeMs: number | null;
      cumulativeSyncTimeMs: number | null;
      numTimed: number | null;
      numRequested: number | null;
      statsResetAt: string | null;
      sinceLastSample: {
        sampleIntervalMs: number;
        writeTimeDeltaMs: number;
        syncTimeDeltaMs: number;
        numTimedDelta: number;
        numRequestedDelta: number;
      } | null;
    };
  };
  redis: { connected: boolean; note: string };
  mriWarmCache: {
    state: string;
    lastRunAt: string | null;
    lastError: string | null;
    pausedForPeakHours: boolean;
  };
  dicomAutoPull: {
    state: string;
    pendingOrRunningJobs: number | null;
    lastCompletedAt: string | null;
    pausedForPeakHours: boolean;
  };
  usgErpPipeline: { enabled: boolean; note: string };
  services: {
    careApi: { ok: boolean; message: string };
    careDb: { ok: boolean; message: string };
    careWeb: { ok: boolean; message: string };
    orthanc: { ok: boolean | null; message: string };
    icici: { ok: boolean | null; message: string };
  };
};

type ApiResponse = { ok: boolean; snapshot: Snapshot; text: string };

const LANE_CLASS: Record<Snapshot["billingLane"]["tone"], string> = {
  GREEN: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-800",
  AMBER: "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800",
  RED: "border-red-300 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100 dark:border-red-800",
};

function ms(v: number | null | undefined): string {
  return v == null ? "—" : `${v} ms`;
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

function LatencyBlock({ title, s, threshold }: { title: string; s: LatencySummary; threshold: number }) {
  return (
    <StatCard label={title}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-normal">
        <span className="text-muted-foreground">count</span><span>{s.count}</span>
        <span className="text-muted-foreground">slow (&gt;{threshold}ms)</span>
        <span className={s.slowCount > 0 ? "text-amber-700 dark:text-amber-300 font-semibold" : ""}>{s.slowCount}</span>
        <span className="text-muted-foreground">p50</span><span>{ms(s.p50Ms)}</span>
        <span className="text-muted-foreground">p95</span>
        <span className={(s.p95Ms ?? 0) > threshold ? "text-amber-700 dark:text-amber-300 font-semibold" : ""}>{ms(s.p95Ms)}</span>
        <span className="text-muted-foreground">max</span><span>{ms(s.maxMs)}</span>
      </div>
    </StatCard>
  );
}

export function BillingPeakMonitorPanel({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { data, isFetching, refetch, error } = useQuery<ApiResponse>({
    queryKey: ["billing-performance-snapshot"],
    queryFn: () => api.get("/api/admin/billing-performance"),
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: false,
  });

  const s = data?.snapshot;

  const copy = async () => {
    const text = data?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"} data-testid="billing-peak-monitor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-primary" />
          Clinic Peak / Billing Lane
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()} disabled={!data?.text}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            {copied ? "Copied" : "Copy Performance Snapshot"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Could not load snapshot (Redis down is OK — check API). {(error as Error).message}
        </div>
      )}

      {s && (
        <>
          <div className={`rounded-xl border px-4 py-3 ${LANE_CLASS[s.billingLane.tone]}`} data-testid="billing-lane-status">
            <div className="text-xs uppercase tracking-wide opacity-80">Billing Lane</div>
            <div className="text-2xl font-bold">{s.billingLane.tone}</div>
            <div className="text-sm mt-0.5">{s.billingLane.reason}</div>
            <div className="text-[11px] mt-2 opacity-80">
              Peak mode: {s.peakMode.active ? "ACTIVE" : "INACTIVE"} · {s.peakMode.windowLabel} · refresh ~{s.refreshHintSec}s · {new Date(s.generatedAt).toLocaleTimeString()}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <LatencyBlock title={`Bill save (${s.latency.windowMinutes}m)`} s={s.latency.billSave} threshold={s.latency.slowThresholdMs} />
            <LatencyBlock title={`Patient search (${s.latency.windowMinutes}m)`} s={s.latency.patientSearch} threshold={s.latency.slowThresholdMs} />
            <StatCard label="API volume">
              <div className="text-2xl font-bold">{s.latency.requestsPerMinute}</div>
              <div className="text-xs text-muted-foreground font-normal">requests / last minute</div>
            </StatCard>
            <StatCard label="DB pool">
              {s.dbPool ? (
                <div className="text-xs font-normal space-y-0.5">
                  <div>active/total: {s.dbPool.total - s.dbPool.idle}/{s.dbPool.total}</div>
                  <div>idle: {s.dbPool.idle}</div>
                  <div className={s.dbPool.waiting > 0 ? "text-amber-700 font-semibold" : ""}>waiting: {s.dbPool.waiting}</div>
                </div>
              ) : (
                "—"
              )}
            </StatCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <StatCard label="PostgreSQL">
              <div className="text-xs font-normal space-y-0.5">
                <div>{s.postgres.ok ? "OK" : "DOWN"} — {s.postgres.message}</div>
                <div>shared_buffers: {s.postgres.sharedBuffers ?? "—"}</div>
                <div>max_wal_size: {s.postgres.maxWalSize ?? "—"}</div>
                <div>checkpoint_timeout: {s.postgres.checkpointTimeout ?? "—"}</div>
                <div>synchronous_commit: {s.postgres.synchronousCommit ?? "—"}</div>
                {s.postgres.checkpointer.available ? (
                  <>
                    <div className="pt-1 font-medium">pg_stat_checkpointer (cumulative since stats_reset)</div>
                    <div>timed checkpoints: {s.postgres.checkpointer.numTimed ?? "—"}</div>
                    <div>requested checkpoints: {s.postgres.checkpointer.numRequested ?? "—"}</div>
                    <div>cumulative write time: {ms(s.postgres.checkpointer.cumulativeWriteTimeMs)}</div>
                    <div>cumulative sync time: {ms(s.postgres.checkpointer.cumulativeSyncTimeMs)}</div>
                    <div>stats_reset: {s.postgres.checkpointer.statsResetAt ? new Date(s.postgres.checkpointer.statsResetAt).toLocaleString() : "—"}</div>
                    {s.postgres.checkpointer.sinceLastSample ? (
                      <>
                        <div className="pt-1 font-medium">Since last monitor sample ({s.postgres.checkpointer.sinceLastSample.sampleIntervalMs} ms)</div>
                        <div>write Δ: {ms(s.postgres.checkpointer.sinceLastSample.writeTimeDeltaMs)}</div>
                        <div>sync Δ: {ms(s.postgres.checkpointer.sinceLastSample.syncTimeDeltaMs)}</div>
                        <div>timed Δ / requested Δ: {s.postgres.checkpointer.sinceLastSample.numTimedDelta} / {s.postgres.checkpointer.sinceLastSample.numRequestedDelta}</div>
                        <div className="text-muted-foreground">Not “last checkpoint duration” — deltas of cumulative counters between samples.</div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">Sample delta available after the next refresh (~45s).</div>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground">pg_stat_checkpointer unavailable (needs PostgreSQL 17+)</div>
                )}
              </div>
            </StatCard>
            <StatCard label="Redis / background / payments">
              <div className="text-xs font-normal space-y-0.5">
                <div>Redis: {s.redis.connected ? "connected" : "disconnected"}</div>
                <div className="text-muted-foreground">{s.redis.note}</div>
                <div>MRI warm-cache: {s.mriWarmCache.state}{s.mriWarmCache.lastError ? ` · err: ${s.mriWarmCache.lastError}` : ""}</div>
                <div>DICOM auto-pull: {s.dicomAutoPull.state} · queue {s.dicomAutoPull.pendingOrRunningJobs ?? "—"}</div>
                <div>USG ERP pipeline: {s.usgErpPipeline.enabled ? "enabled" : "paused"}</div>
                <div className="text-muted-foreground">{s.usgErpPipeline.note}</div>
                <div>Orthanc: {s.services.orthanc.ok == null ? "n/a" : s.services.orthanc.ok ? "ok" : "down"} — {s.services.orthanc.message}</div>
                <div>ICICI: {s.services.icici.ok == null ? "n/a" : s.services.icici.ok ? "ok" : "fail"} — {s.services.icici.message}</div>
                <div>API / DB / Web: ok / {s.services.careDb.ok ? "ok" : "down"} / {s.services.careWeb.message.slice(0, 40)}…</div>
              </div>
            </StatCard>
          </div>

          <div className="rounded-lg border bg-card p-3" data-testid="billing-peak-last15m">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Activity className="h-4 w-4" /> Last 15 minutes
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
              <div>Slow bill saves: <strong>{s.last15m.slowBillSaveCount}</strong></div>
              <div>Slow patient search: <strong>{s.last15m.slowPatientSearchCount}</strong></div>
              <div>Pool waiting: <strong>{s.last15m.dbPoolWaiting ?? "—"}</strong></div>
              <div>Checkpointer write Δ (sample): <strong>{ms(s.last15m.checkpointerWriteDeltaMs)}</strong></div>
            </div>
            <div className="text-[11px] text-muted-foreground mb-1">
              Background: MRI {s.last15m.background.mriPausedForPeak ? "paused-peak" : s.last15m.background.mriWarmRunning ? "running" : "idle"}
              {" · "}DICOM {s.last15m.background.dicomPausedForPeak ? "paused-peak" : "off-peak"}
              {" · "}USG ERP {s.last15m.background.usgPipelineEnabled ? "on" : "paused"}
            </div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left py-1 font-medium">Route</th>
                  <th className="text-right py-1 font-medium">count</th>
                  <th className="text-right py-1 font-medium">slow</th>
                  <th className="text-right py-1 font-medium">p95</th>
                  <th className="text-right py-1 font-medium">max</th>
                </tr>
              </thead>
              <tbody>
                {s.last15m.slowEndpoints.length === 0 ? (
                  <tr><td colSpan={5} className="py-2 text-muted-foreground">No slow endpoints in buffer window.</td></tr>
                ) : (
                  s.last15m.slowEndpoints.map((e) => (
                    <tr key={`${e.method} ${e.path}`} className="border-t">
                      <td className="py-1 font-mono">{e.method} {e.path}</td>
                      <td className="py-1 text-right">{e.count}</td>
                      <td className="py-1 text-right">{e.slowCount}</td>
                      <td className="py-1 text-right">{ms(e.p95Ms)}</td>
                      <td className="py-1 text-right">{ms(e.maxMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!compact && (
            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3">
              <Link href="/diagnostics" className="underline">API Diagnostics</Link>
              <Link href="/radiology/operational-health" className="underline">Operational Health</Link>
              <span>Added load: ~1 GET / 45s while this page is open (in-memory metrics + cheap SHOW/SELECT; no Cloudflare cache on auth APIs).</span>
            </div>
          )}
        </>
      )}

      {!s && !error && (
        <div className="text-sm text-muted-foreground py-6 text-center">{isFetching ? "Loading…" : "No data"}</div>
      )}
    </div>
  );
}

export default function BillingPeakMonitorPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <PageHeader
        title="Billing Performance"
        subtitle="Clinic Peak Monitor — why billing feels slow (observability only, no PHI)"
      />
      <BillingPeakMonitorPanel />
    </div>
  );
}
