/**
 * RadiologyFlightDeck.tsx — Ticket M1.3: the ONE admin diagnostics page.
 *
 * A clinic administrator diagnoses the complete radiology stack from this
 * screen: deployment verdict, system/backend health, viewer & DICOMweb,
 * network routes, settings verification, per-study diagnostics, and the ONE
 * "Run Complete Workflow" dry-run button. Traffic lights per check,
 * expandable details, copy + JSON/Markdown export. Read-only end to end —
 * the page changes nothing and deletes nothing.
 *
 * Backend: /api/radiology-diagnostics/* (admin-only). Non-admin staff get a
 * friendly gate instead of data.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Activity, AlertTriangle, ChevronDown, ChevronRight, ClipboardCopy, Download,
  FileText, Play, RefreshCw, Search, ShieldAlert,
} from "lucide-react";
import {
  LIGHT_CLASSES, VERDICT_STYLE, checkToText, countByStatus, exportFileName,
  reportToMarkdown, trafficLight,
  type DeploymentReport, type DiagnosticCheck, type DiagnosticSection,
} from "@/lib/flightDeckReport";

function Light({ status }: { status: DiagnosticCheck["status"] }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full shrink-0 ${LIGHT_CLASSES[trafficLight(status)]}`}
      title={status}
      data-testid={`light-${trafficLight(status)}`}
    />
  );
}

function CheckRow({ check }: { check: DiagnosticCheck }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(check.fix || check.endpoint || check.data || typeof check.latencyMs === "number");
  return (
    <div className="rounded-lg border bg-card" data-testid={`check-${check.id}`}>
      <button
        type="button"
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Light status={check.status} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            {check.name}
            <span className="text-[10px] text-muted-foreground font-mono">{check.id}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">{check.detail}</div>
        </div>
        {typeof check.latencyMs === "number" && (
          <Badge variant="outline" className="text-[10px] shrink-0">{check.latencyMs}ms</Badge>
        )}
        {hasDetails && (open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />)}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs" data-testid={`check-details-${check.id}`}>
          <div className="whitespace-pre-wrap break-words text-muted-foreground">{check.detail}</div>
          {check.endpoint && (
            <div><span className="font-medium">Endpoint:</span> <span className="font-mono break-all">{check.endpoint}</span></div>
          )}
          {typeof check.httpStatus === "number" && (
            <div><span className="font-medium">HTTP:</span> {check.httpStatus}</div>
          )}
          {check.fix && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2">
              <span className="font-medium">Fix:</span> {check.fix}
            </div>
          )}
          {check.data && (
            <pre className="rounded-md bg-muted p-2 overflow-x-auto max-h-48">{JSON.stringify(check.data, null, 2)}</pre>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => void navigator.clipboard.writeText(checkToText(check))}
          >
            <ClipboardCopy size={12} className="mr-1" /> Copy this check
          </Button>
        </div>
      )}
    </div>
  );
}

function SectionCard({ section }: { section: DiagnosticSection }) {
  const [collapsed, setCollapsed] = useState(false);
  const counts = useMemo(() => countByStatus([section]), [section]);
  return (
    <div className="rounded-xl border bg-card" data-testid={`section-${section.id}`}>
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        <Light status={section.status} />
        <h3 className="font-semibold text-sm flex-1">{section.title}</h3>
        <span className="text-[11px] text-muted-foreground">
          {counts.PASS} pass{counts.WARNING ? ` · ${counts.WARNING} warn` : ""}{counts.FAIL ? ` · ${counts.FAIL} fail` : ""}{counts.UNKNOWN ? ` · ${counts.UNKNOWN} unknown` : ""}
        </span>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 space-y-2">
          {section.checks.map((c) => <CheckRow key={c.id} check={c} />)}
        </div>
      )}
    </div>
  );
}

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RadiologyFlightDeck() {
  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(readStaffSession()?.user.role ?? ""));
  const [studyUid, setStudyUid] = useState("");
  const [copied, setCopied] = useState(false);

  const report = useQuery<DeploymentReport>({
    queryKey: ["/api/radiology-diagnostics/report"],
    queryFn: () => api.get<DeploymentReport>("/api/radiology-diagnostics/report"),
    enabled: isAdmin,
    staleTime: 30_000,
    retry: false,
  });

  const study = useQuery<DiagnosticSection>({
    queryKey: ["/api/radiology-diagnostics/study", studyUid],
    queryFn: () => api.get<DiagnosticSection>(`/api/radiology-diagnostics/study/${encodeURIComponent(studyUid.trim())}`),
    enabled: false,
    retry: false,
  });

  const simulation = useMutation<DiagnosticSection, Error>({
    mutationFn: () => api.post<DiagnosticSection>("/api/radiology-diagnostics/workflow-simulation", {}),
  });

  if (!isAdmin) {
    return (
      <div className="p-6 space-y-4" data-testid="flight-deck-admin-gate">
        <PageHeader title="Radiology Flight Deck" subtitle="Clinical activation & deployment diagnostics" />
        <div className="rounded-xl border bg-card p-6 flex items-center gap-3 text-sm">
          <ShieldAlert className="text-amber-500" size={20} />
          Administrator role required — this screen exposes deployment topology and is limited to admins.
        </div>
      </div>
    );
  }

  const data = report.data;
  const totals = data ? countByStatus(data.sections) : null;
  const verdictStyle = data ? VERDICT_STYLE[data.verdict] : null;

  const copyAll = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(reportToMarkdown(data));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 space-y-4" data-testid="flight-deck-page">
      <PageHeader
        title="Radiology Flight Deck"
        subtitle="One screen to diagnose the complete radiology stack — read-only, changes nothing"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void report.refetch()} disabled={report.isFetching} data-testid="btn-refresh">
              <RefreshCw size={14} className={`mr-1 ${report.isFetching ? "animate-spin" : ""}`} />
              {report.isFetching ? "Running…" : "Re-run diagnostics"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copyAll()} disabled={!data} data-testid="btn-copy">
              <ClipboardCopy size={14} className="mr-1" /> {copied ? "Copied!" : "Copy diagnostics"}
            </Button>
            <Button
              size="sm" variant="outline" disabled={!data} data-testid="btn-export-json"
              onClick={() => data && downloadFile(exportFileName("json", data.generatedAt), "application/json", JSON.stringify(data, null, 2))}
            >
              <Download size={14} className="mr-1" /> JSON
            </Button>
            <Button
              size="sm" variant="outline" disabled={!data} data-testid="btn-export-md"
              onClick={() => data && downloadFile(exportFileName("md", data.generatedAt), "text/markdown", reportToMarkdown(data))}
            >
              <FileText size={14} className="mr-1" /> Markdown
            </Button>
          </div>
        }
      />

      {report.isLoading && (
        <div className="rounded-xl border bg-card p-6 text-sm flex items-center gap-2" data-testid="flight-deck-loading">
          <Activity size={16} className="animate-pulse text-primary" /> Running full-stack diagnostics — probing PACS, viewers and network routes…
        </div>
      )}
      {report.isError && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-sm" data-testid="flight-deck-error">
          Diagnostics failed to run: {report.error instanceof Error ? report.error.message : "unknown error"}
        </div>
      )}

      {data && verdictStyle && totals && (
        <>
          {/* Deployment verdict — Healthy / Degraded / Broken, never vague */}
          <div className={`rounded-xl border p-4 ${verdictStyle.className}`} data-testid="deployment-verdict">
            <div className="flex items-center gap-3">
              <Light status={data.verdict === "HEALTHY" ? "PASS" : data.verdict === "DEGRADED" ? "WARNING" : "FAIL"} />
              <div className="font-semibold">{verdictStyle.label}</div>
              <div className="ml-auto text-xs">
                {totals.PASS} pass · {totals.WARNING} warning · {totals.FAIL} fail · {totals.UNKNOWN} unknown
                <span className="ml-2 opacity-70">generated {new Date(data.generatedAt).toLocaleString()}</span>
              </div>
            </div>
            {data.findings.length > 0 && (
              <div className="mt-3 space-y-2" data-testid="verdict-findings">
                {data.findings.map((f, i) => (
                  <div key={`${f.where}-${i}`} className="rounded-lg bg-white/60 dark:bg-black/20 border p-2 text-xs">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle size={12} className={f.severity === "BLOCKER" ? "text-red-600" : "text-amber-600"} />
                      {f.severity} · <span className="font-mono">{f.where}</span>
                    </div>
                    <div className="mt-1"><span className="font-medium">Why:</span> {f.why}</div>
                    <div><span className="font-medium">Fix:</span> {f.fix}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Workflow simulation + study lookup toolbar */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Play size={15} className="text-primary" /> Clinical workflow simulation
              </h3>
              <p className="text-xs text-muted-foreground">
                Dry-run of the complete reporting workflow — open study, viewer launch, draft, structured
                report, finalize, read-back, print/PDF, share, amendment, voice, assignment, lock.
                Nothing is created, signed, sent or deleted.
              </p>
              <Button size="sm" onClick={() => simulation.mutate()} disabled={simulation.isPending} data-testid="btn-run-workflow">
                <Play size={14} className="mr-1" /> {simulation.isPending ? "Simulating…" : "Run Complete Workflow"}
              </Button>
              {simulation.isError && (
                <div className="text-xs text-red-600">Simulation failed: {simulation.error.message}</div>
              )}
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Search size={15} className="text-primary" /> Study diagnostics
              </h3>
              <p className="text-xs text-muted-foreground">
                Given a Study UID: PACS presence, QIDO visibility, WADO metadata, image access,
                launch URL and patient-identifier consistency.
              </p>
              <div className="flex gap-2">
                <Input
                  value={studyUid}
                  onChange={(e) => setStudyUid(e.target.value)}
                  placeholder="StudyInstanceUID e.g. 1.2.840…"
                  className="h-8 text-xs font-mono"
                  data-testid="input-study-uid"
                />
                <Button
                  size="sm" variant="outline"
                  disabled={!studyUid.trim() || study.isFetching}
                  onClick={() => void study.refetch()}
                  data-testid="btn-run-study"
                >
                  {study.isFetching ? "Checking…" : "Diagnose"}
                </Button>
              </div>
              {study.isError && (
                <div className="text-xs text-red-600">{study.error instanceof Error ? study.error.message : "lookup failed"}</div>
              )}
            </div>
          </div>

          {simulation.data && <SectionCard section={simulation.data} />}
          {study.data && <SectionCard section={study.data} />}

          {data.sections.map((section) => <SectionCard key={section.id} section={section} />)}

          <div className="text-[11px] text-muted-foreground">
            Version {data.version.app} ({data.version.commit}) · every check above is read-only — settings
            recommendations are advisory and nothing is auto-deleted.
          </div>
        </>
      )}
    </div>
  );
}
