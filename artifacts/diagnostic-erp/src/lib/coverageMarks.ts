/**
 * Coverage Cockpit — advisory only.
 * VIEWED ≠ REVIEWED. Never blocks sign-off by itself.
 */

import type { ObservationAnchor } from "./observationAnchor";
import type { MriLumbarRegionKey } from "./mriLumbarRegions";
import { MRI_LUMBAR_ALL_REGIONS } from "./mriLumbarRegions";

export type CoverageStatus = "unopened" | "viewed" | "partial" | "reviewed" | "waived";

export type CoverageMark = {
  regionKey: MriLumbarRegionKey | string;
  status: CoverageStatus;
  reason?: string;
  anchorHint?: ObservationAnchor;
  updatedAt: string;
};

export const COVERAGE_ENVELOPE_KEY = "careCoverageMarks";

export function defaultCoverageMarks(): CoverageMark[] {
  const now = new Date().toISOString();
  return MRI_LUMBAR_ALL_REGIONS.map((r) => ({
    regionKey: r.key,
    status: "unopened" as const,
    updatedAt: now,
  }));
}

export function coverageMarksEqual(a: CoverageMark[], b: CoverageMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i]!;
    return m.regionKey === n.regionKey && m.status === n.status && (m.reason ?? "") === (n.reason ?? "");
  });
}

/** Promote unopened → viewed only (never auto-promote to reviewed). */
export function markRegionViewed(marks: CoverageMark[], regionKey: string, anchor?: ObservationAnchor | null): CoverageMark[] {
  return marks.map((m) => {
    if (m.regionKey !== regionKey) return m;
    if (m.status === "reviewed" || m.status === "waived" || m.status === "partial") return m;
    if (m.status === "viewed") return m;
    return {
      ...m,
      status: "viewed",
      anchorHint: anchor ?? m.anchorHint,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function setCoverageStatus(
  marks: CoverageMark[],
  regionKey: string,
  status: CoverageStatus,
  reason?: string,
): CoverageMark[] {
  const found = marks.some((m) => m.regionKey === regionKey);
  const next = marks.map((m) => {
    if (m.regionKey !== regionKey) return m;
    return {
      ...m,
      status,
      reason: status === "waived" ? (reason ?? m.reason) : reason,
      updatedAt: new Date().toISOString(),
    };
  });
  if (found) return next;
  return [
    ...next,
    {
      regionKey,
      status,
      reason,
      updatedAt: new Date().toISOString(),
    },
  ];
}

export function parseCoverageMarks(raw: unknown): CoverageMark[] | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as Record<string, unknown>;
  const list = Array.isArray(env) ? env : env[COVERAGE_ENVELOPE_KEY];
  if (!Array.isArray(list)) return null;
  const out: CoverageMark[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.regionKey !== "string" || !r.regionKey) continue;
    const status = r.status;
    if (
      status !== "unopened"
      && status !== "viewed"
      && status !== "partial"
      && status !== "reviewed"
      && status !== "waived"
    ) {
      continue;
    }
    out.push({
      regionKey: r.regionKey,
      status,
      reason: typeof r.reason === "string" ? r.reason : undefined,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
    });
  }
  return out.length > 0 ? out : null;
}

export function coverageAdvisories(marks: CoverageMark[]): string[] {
  return marks
    .filter((m) => m.status === "unopened" || m.status === "viewed")
    .map((m) => {
      if (m.status === "unopened") return `${m.regionKey} has no review mark.`;
      return `${m.regionKey} was viewed but not marked reviewed.`;
    });
}

/** Architectural note: coverage never flips finalize hard gates. */
export function coverageBlocksFinalize(_marks: CoverageMark[]): false {
  return false;
}
