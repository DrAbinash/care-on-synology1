import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import {
  ShieldAlert, ShieldCheck, ArrowLeft, RefreshCw, Power, PowerOff, AlertTriangle, Lock, CheckCircle2,
} from "lucide-react";

// ── Types mirror the /api/usg-admin/readiness response (usgReadinessService). ──
interface FlagStatus {
  phase: string;
  flag: string;
  codeAvailable: boolean;
  wired: boolean;
  enabled: boolean;
  dependsOn: string[];
  unmetDependencies: string[];
  validation: "not_started" | "code_complete" | "clinic_validated";
  enabledDependents: string[];
  purpose: string | null;
  rollbackEffect: string | null;
  ownerSubsystem: string | null;
  enableableNow: boolean;
  validationOverrideRequired: boolean;
  blockers: string[];
}
interface ReadinessMatrix {
  productionReady: boolean;
  summary: string;
  flags: FlagStatus[];
  enabledFlags: string[];
}
interface HealthResult { ok: boolean; message: string; checkedServerSide: boolean }

const SHORT = (f: string) => f.replace(/^ff_radiology_usg_/, "");

export default function UsgAdminReadiness() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(session?.user.role ?? ""));

  const [forceFor, setForceFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ReadinessMatrix>({
    queryKey: ["usg-readiness"],
    queryFn: () => fetchApi("/api/usg-admin/readiness"),
    enabled: isAdmin,
  });

  const enableM = useMutation({
    mutationFn: (v: { flag: string; force?: boolean; reason?: string }) =>
      fetchApi(`/api/usg-admin/flags/${v.flag}/enable`, { method: "POST", body: JSON.stringify({ force: v.force, reason: v.reason }) }),
    onSuccess: (_r, v) => { toast({ title: `Enabled ${SHORT(v.flag)}` }); setForceFor(null); setReason(""); qc.invalidateQueries({ queryKey: ["usg-readiness"] }); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast({ title: "Enable blocked", description: (e?.body?.blockers ?? [e?.message]).join(" "), variant: "destructive" }),
  });
  const disableM = useMutation({
    mutationFn: (flag: string) => fetchApi(`/api/usg-admin/flags/${flag}/disable`, { method: "POST", body: JSON.stringify({}) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (r: any, flag) => { toast({ title: `Disabled ${SHORT(flag)}`, description: r?.dependentsStillOn?.length ? `Dependents left on: ${r.dependentsStillOn.map(SHORT).join(", ")}` : undefined }); qc.invalidateQueries({ queryKey: ["usg-readiness"] }); },
    onError: () => toast({ title: "Disable failed", variant: "destructive" }),
  });
  const killM = useMutation({
    mutationFn: () => fetchApi("/api/usg-admin/kill-switch", { method: "POST", body: JSON.stringify({}) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (r: any) => { toast({ title: "Kill switch applied", description: `Disabled: ${(r?.disabled ?? []).map(SHORT).join(", ") || "none"}` }); qc.invalidateQueries({ queryKey: ["usg-readiness"] }); },
  });

  // ── Production activation (Group A safe / Group B health-gated) ──
  interface ActivationResp {
    health: { orthanc: HealthResult; viewer: HealthResult; ai_gateway: HealthResult };
    flags: { flag: string; group: "A" | "B"; label: string; status: string; enabled: boolean; activatable: boolean; remediation: string | null }[];
    safetyControls: string[];
    groupBActivatable: string[];
  }
  const actQ = useQuery<ActivationResp>({
    queryKey: ["usg-activation"],
    queryFn: () => fetchApi("/api/usg-admin/activation"),
    enabled: isAdmin,
  });
  const activateSafeM = useMutation({
    mutationFn: () => fetchApi("/api/usg-admin/activate-safe", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { toast({ title: "Safe (Group A) features enabled" }); qc.invalidateQueries({ queryKey: ["usg-readiness"] }); qc.invalidateQueries({ queryKey: ["usg-activation"] }); },
  });
  const activateInfraM = useMutation({
    mutationFn: () => fetchApi("/api/usg-admin/activate-infra", { method: "POST", body: JSON.stringify({}) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (r: any) => { toast({ title: "Infra features enabled where healthy", description: `Enabled: ${(r?.enabled ?? []).map(SHORT).join(", ") || "none"}` }); qc.invalidateQueries({ queryKey: ["usg-readiness"] }); qc.invalidateQueries({ queryKey: ["usg-activation"] }); },
  });

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <Lock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold">Admin access required</h2>
        <p className="text-sm text-muted-foreground mt-1">The USG rollout control plane is restricted to administrators.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/radiology")}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader title="USG Companion — Rollout Control" subtitle="Per-phase readiness and server-enforced feature-flag rollout. Every change is audited." />

      {/* Overall status banner */}
      <Card className={data?.productionReady ? "border-emerald-500/40" : "border-amber-500/40"}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {data?.productionReady ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldAlert className="w-5 h-5 text-amber-600" />}
            {data?.productionReady ? "Production-ready" : "Not production-ready"}
          </CardTitle>
          <CardDescription>{data?.summary ?? "Loading readiness…"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" variant="destructive" onClick={() => { if (confirm("Disable ALL enabled USG flags now?")) killM.mutate(); }} disabled={killM.isPending || !(data?.enabledFlags?.length)}>
            <PowerOff className="w-4 h-4 mr-1" />Kill switch{data?.enabledFlags?.length ? ` (${data.enabledFlags.length} on)` : ""}
          </Button>
        </CardContent>
      </Card>

      {/* Production activation — safe (Group A) one-click + infra (Group B) health-gated */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Production activation</CardTitle>
          <CardDescription>Enable the safe features for owner review in one click; infra features enable only when their health check passes.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => activateSafeM.mutate()} disabled={activateSafeM.isPending}><Power className="w-4 h-4 mr-1" />Enable safe features (Group A)</Button>
            <Button size="sm" variant="outline" onClick={() => activateInfraM.mutate()} disabled={activateInfraM.isPending || !(actQ.data?.groupBActivatable?.length)}>
              <Power className="w-4 h-4 mr-1" />Enable infra features where healthy{actQ.data?.groupBActivatable?.length ? ` (${actQ.data.groupBActivatable.length})` : ""}
            </Button>
          </div>
          {/* Infra health */}
          {actQ.data && (
            <div className="flex flex-wrap gap-2 text-xs">
              {(["orthanc", "ai_gateway", "viewer"] as const).map((k) => {
                const h = actQ.data!.health[k];
                return <span key={k} className={`px-2 py-0.5 rounded border ${h.ok ? "text-emerald-600 border-emerald-500/40" : "text-amber-600 border-amber-500/40"}`} title={h.message}>{k}: {h.ok ? "healthy" : (h.checkedServerSide ? "unavailable" : "browser-checked")}</span>;
              })}
            </div>
          )}
          {/* Per-flag activation status */}
          {actQ.data && (
            <div className="grid gap-1 md:grid-cols-2 text-xs">
              {actQ.data.flags.map((f) => (
                <div key={f.flag} className="flex items-center gap-2">
                  <Badge variant="outline">{f.group}</Badge>
                  <span className="flex-1">{f.label}</span>
                  <span className={f.status === "Live" ? "text-emerald-600" : f.status === "Available" ? "text-sky-600" : "text-amber-600"}>{f.status}</span>
                </div>
              ))}
            </div>
          )}
          {actQ.data && <p className="text-[10px] text-muted-foreground">Always-on safety controls (never flag-toggled): {actQ.data.safetyControls.join(" · ")}</p>}
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading readiness matrix…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load readiness. <button className="underline" onClick={() => refetch()}>Retry</button></p>}
      {data && data.flags.length === 0 && <p className="text-sm text-muted-foreground">No USG phase flags registered.</p>}

      {/* Per-phase rows */}
      <div className="space-y-2">
        {data?.flags.map((f) => (
          <Card key={f.flag} className={f.enabled ? "border-emerald-500/30" : ""}>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{f.phase}</span>
                <span className="font-medium">{SHORT(f.flag)}</span>
                {f.enabled ? <Badge className="bg-emerald-600">ON</Badge> : <Badge variant="outline">off</Badge>}
                <Badge variant={f.wired ? "secondary" : "outline"} title="Server code gates on this flag">{f.wired ? "wired" : "not wired"}</Badge>
                <Badge variant="outline" className={f.validation === "clinic_validated" ? "text-emerald-600" : "text-amber-600"}>
                  {f.validation === "clinic_validated" ? <CheckCircle2 className="w-3 h-3 mr-1 inline" /> : null}{f.validation.replace("_", " ")}
                </Badge>
                <div className="ml-auto flex items-center gap-2">
                  {f.enabled ? (
                    <Button size="sm" variant="outline" onClick={() => disableM.mutate(f.flag)} disabled={disableM.isPending}><PowerOff className="w-4 h-4 mr-1" />Disable</Button>
                  ) : f.unmetDependencies.length > 0 ? (
                    <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />needs {f.unmetDependencies.map(SHORT).join(", ")}</span>
                  ) : f.validationOverrideRequired ? (
                    <Button size="sm" variant="outline" onClick={() => setForceFor(f.flag)}><Power className="w-4 h-4 mr-1" />Enable (override)</Button>
                  ) : (
                    <Button size="sm" onClick={() => enableM.mutate({ flag: f.flag })} disabled={enableM.isPending}><Power className="w-4 h-4 mr-1" />Enable</Button>
                  )}
                </div>
              </div>

              {f.purpose && <p className="text-xs text-muted-foreground mt-1.5">{f.purpose}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                {f.dependsOn.length > 0 && <span>deps: {f.dependsOn.map(SHORT).join(", ")}</span>}
                {f.enabledDependents.length > 0 && <span>dependents on: {f.enabledDependents.map(SHORT).join(", ")}</span>}
                {f.rollbackEffect && <span title="rollback effect">rollback: {f.rollbackEffect}</span>}
              </div>

              {/* Force-enable acknowledgement row (phase not clinic-validated) */}
              {forceFor === f.flag && (
                <div className="mt-2 p-2 rounded border border-amber-500/40 bg-amber-500/5 text-xs space-y-2">
                  <p className="flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" />This phase is not clinic-validated. Enabling requires an audited acknowledgement.</p>
                  <input className="w-full border rounded px-2 py-1 bg-background" placeholder="Reason (≥ 3 chars, recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={reason.trim().length < 3 || enableM.isPending} onClick={() => enableM.mutate({ flag: f.flag, force: true, reason })}>Acknowledge &amp; enable</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setForceFor(null); setReason(""); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground pt-2">
        Dependencies and clinic-validation gates are enforced server-side — the UI cannot bypass them. Flags default OFF; nothing is enabled in production automatically.
      </p>
    </div>
  );
}
