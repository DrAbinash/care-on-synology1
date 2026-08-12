/**
 * Read-only Acceptance Tests panel for Settings → Radiology → MWL.
 *
 * Explains the four hardware workflows, shows MWL infrastructure readiness
 * counts, and never creates fake patients/bills or triggers scans.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, AlertTriangle, XCircle, ClipboardList, ExternalLink, ShieldAlert,
} from "lucide-react";

type AcceptanceScenario = {
  id: string;
  title: string;
  testPatientPn: string;
  expectedModality: string;
  procedureDescription: string;
  chain: string[];
  manualDoc: string;
};

type AcceptanceMeta = {
  readOnly: true;
  warning: string;
  scenarios: AcceptanceScenario[];
};

type MwlDeploymentStatus = {
  ready: boolean;
  verdict?: "healthy" | "degraded" | "failed";
  wlFileCount: number;
  activeProcedureCount?: number;
  quarantineCount?: number;
  worklistDir: string | null;
};

const FALLBACK_SCENARIOS: AcceptanceScenario[] = [
  {
    id: "mri_brain",
    title: "MRI Brain",
    testPatientPn: "TEST^MRI^BRAIN",
    expectedModality: "MR",
    procedureDescription: "MRI Brain",
    chain: [
      "Billing → ERP → MWL → MRI C-FIND → select patient → scan → Orthanc → ERP reporting",
    ],
    manualDoc: "docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md",
  },
  {
    id: "mri_whole_spine",
    title: "MRI Whole Spine",
    testPatientPn: "TEST^MRI^WHOLESPINE",
    expectedModality: "MR",
    procedureDescription: "MRI Whole Spine",
    chain: [
      "Same pipeline as MRI Brain — verify description survives, unique accession",
    ],
    manualDoc: "docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md",
  },
  {
    id: "usg_abdomen",
    title: "USG Whole Abdomen",
    testPatientPn: "TEST^USG^ABDOMEN",
    expectedModality: "US",
    procedureDescription: "USG Whole Abdomen",
    chain: [
      "Billing → ERP → USG queue/MWL → operator selects patient → study/reporting",
      "TV: Billing USG → /queue/usg shows it; Billing MRI → /queue/usg must NOT",
    ],
    manualDoc: "docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md",
  },
  {
    id: "cancellation",
    title: "Cancellation",
    testPatientPn: "TEST^CANCEL^CASE",
    expectedModality: "MR",
    procedureDescription: "Cancel after MWL publish",
    chain: [
      "Create one test procedure → confirm visible → cancel → confirm removed from MWL/.wl/modality",
    ],
    manualDoc: "docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md",
  },
];

export function MwlAcceptanceTestsPanel() {
  const { data: mwl } = useQuery<MwlDeploymentStatus>({
    queryKey: ["mwl-deployment-status"],
    queryFn: () => api.get("/api/radiology/mwl-status"),
    refetchInterval: 60_000,
  });

  const { data: meta } = useQuery<AcceptanceMeta>({
    queryKey: ["radiology-acceptance-checklist"],
    queryFn: () => api.get("/api/radiology-diagnostics/acceptance-checklist"),
    // Endpoint is optional for older servers — fall back to static copy.
    retry: false,
  });

  const scenarios = meta?.scenarios?.length ? meta.scenarios : FALLBACK_SCENARIOS;
  const warning = meta?.warning
    ?? "Manual hardware acceptance only. Production UI never creates fake patients or bills as part of health checking.";

  const verdict = mwl?.verdict ?? (mwl?.ready ? "healthy" : mwl ? "failed" : undefined);

  return (
    <div className="space-y-4" data-testid="mwl-acceptance-tests-panel">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ClipboardList size={16} className="text-primary" />
              Acceptance Tests
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Read-only guidance for MRI / USG / cancellation hardware checks.
              Counts below reflect live MWL infrastructure — this panel does not
              create bills, patients, or .wl files.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled
            title="See docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md in the repo"
          >
            <ExternalLink size={13} /> docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-100">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <p>{warning}</p>
        </div>

        {mwl && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-muted-foreground">Infrastructure readiness</span>
            {verdict === "healthy" ? (
              <Badge variant="outline" className="text-emerald-700 border-emerald-200 gap-1">
                <CheckCircle2 size={12} /> MWL healthy
              </Badge>
            ) : verdict === "degraded" ? (
              <Badge variant="outline" className="text-amber-700 border-amber-200 gap-1">
                <AlertTriangle size={12} /> MWL degraded
              </Badge>
            ) : (
              <Badge variant="outline" className="text-red-700 border-red-200 gap-1">
                <XCircle size={12} /> MWL not ready
              </Badge>
            )}
            <span className="text-muted-foreground font-mono">
              {mwl.wlFileCount} live .wl
              {typeof mwl.activeProcedureCount === "number" ? ` · ${mwl.activeProcedureCount} active` : ""}
              {mwl.quarantineCount ? ` · ${mwl.quarantineCount} quarantined` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {scenarios.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border bg-card p-4 space-y-2"
            data-testid={`acceptance-card-${s.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-sm">{s.title}</h4>
              <Badge variant="outline" className="font-mono text-[10px]">{s.expectedModality}</Badge>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground">{s.testPatientPn}</p>
            <p className="text-xs">{s.procedureDescription}</p>
            <ol className="list-decimal pl-4 space-y-1 text-[11px] text-muted-foreground">
              {s.chain.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="flex gap-3 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>□ PASS</span>
              <span>□ FAIL</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
