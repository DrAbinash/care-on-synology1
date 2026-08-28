/**
 * Coverage Cockpit — advisory only.
 * VIEWED ≠ REVIEWED. Never blocks sign-off by itself.
 * Scoped by Study Tab / reporting region (not anatomical level alone).
 */

import type { ObservationAnchor } from "./observationAnchor";
import type { MriLumbarRegionKey } from "./mriLumbarRegions";
import { MRI_LUMBAR_ALL_REGIONS } from "./mriLumbarRegions";
import { coverageScopeKey } from "./mriLumbarLevelState";

export type CoverageStatus = "unopened" | "viewed" | "partial" | "reviewed" | "waived";

export type CoverageMark = {
  regionKey: MriLumbarRegionKey | string;
  status: CoverageStatus;
  reason?: string;
  anchorHint?: ObservationAnchor;
  updatedAt: string;
  /** Study Tab / reporting-region scope — prevents LS marks leaking into Brain. */
  scopeKey?: string;
};

export const COVERAGE_ENVELOPE_KEY = "careCoverageMarks";
export const COVERAGE_BY_SCOPE_KEY = "careCoverageByScope";

export function defaultCoverageMarks(scopeKey?: string | null): CoverageMark[] {
  const now = new Date().toISOString();
  const scope = coverageScopeKey(scopeKey);
  return MRI_LUMBAR_ALL_REGIONS.map((r) => ({
    regionKey: r.key,
    status: "unopened" as const,
    updatedAt: now,
    scopeKey: scope,
  }));
}

export function coverageMarksEqual(a: CoverageMark[], b: CoverageMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i]!;
    return (
      m.regionKey === n.regionKey
      && m.status === n.status
      && (m.reason ?? "") === (n.reason ?? "")
      && (m.scopeKey ?? "") === (n.scopeKey ?? "")
    );
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
  scopeKey?: string | null,
): CoverageMark[] {
  const scope = scopeKey != null ? coverageScopeKey(scopeKey) : undefined;
  const found = marks.some((m) => m.regionKey === regionKey);
  const next = marks.map((m) => {
    if (m.regionKey !== regionKey) return m;
    return {
      ...m,
      status,
      reason: status === "waived" ? (reason ?? m.reason) : reason,
      updatedAt: new Date().toISOString(),
      ...(scope ? { scopeKey: scope } : {}),
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
      ...(scope ? { scopeKey: scope } : {}),
    },
  ];
}

export function filterCoverageForScope(
  marks: CoverageMark[],
  scopeKey: string | null | undefined,
): CoverageMark[] {
  const scope = coverageScopeKey(scopeKey);
  const scoped = marks.filter((m) => !m.scopeKey || m.scopeKey === scope || m.scopeKey === "__unscoped__");
  if (scoped.length > 0) return scoped.map((m) => ({ ...m, scopeKey: scope }));
  return defaultCoverageMarks(scope);
}

export function parseCoverageMarks(raw: unknown): CoverageMark[] | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as Record<string, unknown>;

  // Scoped map envelope: { careCoverageByScope: { "LS Spine": [...] } }
  if (env[COVERAGE_BY_SCOPE_KEY] && typeof env[COVERAGE_BY_SCOPE_KEY] === "object") {
    const byScope = env[COVERAGE_BY_SCOPE_KEY] as Record<string, unknown>;
    const active = typeof env.activeScope === "string" ? env.activeScope : null;
    const list = active && Array.isArray(byScope[active])
      ? byScope[active]
      : Object.values(byScope).find((v) => Array.isArray(v));
    if (Array.isArray(list)) {
      return parseCoverageList(list, active);
    }
  }

  const list = Array.isArray(env) ? env : env[COVERAGE_ENVELOPE_KEY];
  if (!Array.isArray(list)) return null;
  return parseCoverageList(list, typeof env.scopeKey === "string" ? env.scopeKey : null);
}

function parseCoverageList(list: unknown[], scopeFallback: string | null): CoverageMark[] | null {
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
      scopeKey: typeof r.scopeKey === "string" ? r.scopeKey : (scopeFallback ?? undefined),
    });
  }
  return out.length > 0 ? out : null;
}

/** Serialize marks with optional multi-scope bag for draft persistence. */
export function serializeCoverageEnvelope(
  marks: CoverageMark[],
  opts?: { scopeKey?: string | null; byScope?: Record<string, CoverageMark[]> },
): Record<string, unknown> {
  const scope = coverageScopeKey(opts?.scopeKey);
  const byScope = { ...(opts?.byScope ?? {}) };
  byScope[scope] = marks.map((m) => ({ ...m, scopeKey: scope }));
  return {
    [COVERAGE_ENVELOPE_KEY]: byScope[scope],
    [COVERAGE_BY_SCOPE_KEY]: byScope,
    activeScope: scope,
    scopeKey: scope,
  };
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
