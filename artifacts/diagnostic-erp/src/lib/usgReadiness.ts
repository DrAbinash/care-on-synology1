/**
 * usgReadiness — deterministic report-readiness for the USG Companion (P2.1).
 *
 * A single compact, advisory readiness surface. It reuses the consistency
 * engine (usgConsistency) and organ-status logic — it is NOT a second readiness
 * engine. Every item names the organ / field needing attention. Readiness is
 * advisory only; the sole finalize block remains the server-side PCPNDT gate
 * (surfaced here for the radiologist, never enforced client-side).
 */

import { organStatus, type UsgOrganSection } from "./usgReportComposer";
import { checkReportConsistency, type ConsistencyIssue } from "./usgConsistency";

export type ReadinessSeverity = "info" | "advisory" | "warning";

export interface ReadinessItem {
  code: string;
  severity: ReadinessSeverity;
  organ?: string;
  message: string;
}

export interface ReadinessInput {
  sections: UsgOrganSection[];
  expectedOrganKeys: string[];
  impressionLines: string[];
  unsaved?: boolean;
  lockStatus?: string;
  pcpndt?: { applicable: boolean; compliant: boolean | null } | null;
  measurementsPending?: number;
  measurementsUnreconciled?: number;
}

export interface ReadinessResult {
  percent: number;             // 0–100 organ-coverage readiness
  reviewedOrgans: number;
  expectedOrgans: number;
  items: ReadinessItem[];
  consistency: ConsistencyIssue[];
  pcpndtBlocking: boolean;     // obstetric + not compliant (server would block)
}

const REVIEWED = new Set(["normal", "abnormal", "not_visualized", "surgically_absent", "not_applicable"]);

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const { sections, expectedOrganKeys, impressionLines } = input;
  const byKey = new Map(sections.map((s) => [s.organ, s]));
  const items: ReadinessItem[] = [];

  // 1 — expected organs not yet reviewed.
  let reviewed = 0;
  for (const key of expectedOrganKeys) {
    const s = byKey.get(key);
    const st = s ? organStatus(s) : "untouched";
    if (REVIEWED.has(st)) reviewed++;
    else {
      items.push({ code: "organ_not_reviewed", severity: "advisory", organ: key, message: `${s?.label ?? key}: not yet reviewed.` });
    }
  }
  const expected = expectedOrganKeys.length || 1;
  const percent = Math.round((reviewed / expected) * 100);

  // 2 — incomplete finding objects (carry a builder warning) + explicit incomplete.
  for (const s of sections) {
    if (organStatus(s) === "incomplete") {
      items.push({ code: "organ_incomplete", severity: "warning", organ: s.label, message: `${s.label}: marked incomplete.` });
    }
    for (const f of s.findings) {
      if ((f.warnings ?? []).length) {
        items.push({ code: "finding_incomplete", severity: "warning", organ: s.label, message: `${s.label}: "${f.findingType}" has unresolved warnings.` });
      }
    }
  }

  // 3 — measurements awaiting review / not reconciled.
  if (input.measurementsPending && input.measurementsPending > 0) {
    items.push({ code: "measurements_pending", severity: "advisory", message: `${input.measurementsPending} measurement(s) awaiting review.` });
  }
  if (input.measurementsUnreconciled && input.measurementsUnreconciled > 0) {
    items.push({ code: "measurements_unreconciled", severity: "warning", message: `${input.measurementsUnreconciled} approved measurement(s) not reconciled.` });
  }

  // 4 — report/impression consistency (advisory/warning).
  const consistency = checkReportConsistency(sections, impressionLines);
  for (const c of consistency) {
    items.push({ code: c.code, severity: c.severity, organ: c.organ, message: c.message });
  }

  // 5 — unsaved / lock / PCPNDT.
  if (input.unsaved) items.push({ code: "unsaved", severity: "info", message: "Unsaved changes." });
  if (input.lockStatus === "locked-by-other") items.push({ code: "locked", severity: "warning", message: "Study is locked by another radiologist." });

  let pcpndtBlocking = false;
  if (input.pcpndt?.applicable) {
    if (input.pcpndt.compliant === true) {
      items.push({ code: "pcpndt_ok", severity: "info", message: "PCPNDT / Form F complete." });
    } else {
      pcpndtBlocking = true;
      items.push({ code: "pcpndt_incomplete", severity: "warning", message: "PCPNDT / Form F incomplete — finalization will be blocked server-side." });
    }
  }

  return { percent, reviewedOrgans: reviewed, expectedOrgans: expected, items, consistency, pcpndtBlocking };
}
