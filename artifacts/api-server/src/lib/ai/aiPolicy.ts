/**
 * AI enablement policy — pure logic (Phase P3 / Gate G11 safety spine).
 *
 * The default is OFF for everyone. The global master flag (feature_flags
 * `ff_radiology_ai`) is a hard gate; on top of it, per-hospital / per-modality /
 * per-study-type / per-radiologist policies resolve most-specific-wins. This is
 * what makes "AI OFF for all users except explicitly enabled pilot users" true.
 * No DB — unit-tested directly.
 */
export type AiMode = "shadow" | "pilot" | "production";
export type AiScope = "global" | "hospital" | "modality" | "study_type" | "radiologist";

export interface AiPolicyRow {
  scope: AiScope;
  scopeKey: string;
  enabled: boolean;
  mode: AiMode;
}

export interface EnablementContext {
  globalMasterOn: boolean; // feature_flags ff_radiology_ai
  staffId?: number | null;
  modality?: string | null;
  studyType?: string | null;
  hospitalKey?: string | null;
}

export interface Enablement {
  enabled: boolean;
  mode: AiMode;
  /** True only when a radiologist should actually SEE AI output (pilot/production + enabled). */
  visibleToRadiologist: boolean;
  reason: string;
}

const RANK: Record<AiScope, number> = { radiologist: 4, study_type: 3, modality: 2, hospital: 1, global: 0 };

function matches(r: AiPolicyRow, ctx: EnablementContext): boolean {
  switch (r.scope) {
    case "global": return r.scopeKey === "*";
    case "hospital": return ctx.hospitalKey != null && (r.scopeKey === "*" || r.scopeKey === ctx.hospitalKey);
    case "modality": return ctx.modality != null && r.scopeKey.toUpperCase() === ctx.modality.toUpperCase();
    case "study_type": return ctx.studyType != null && r.scopeKey.toLowerCase() === ctx.studyType.toLowerCase();
    case "radiologist": return ctx.staffId != null && r.scopeKey === String(ctx.staffId);
    default: return false;
  }
}

/**
 * Resolve whether AI is enabled for this context, and in what mode. The global
 * master flag must be on; otherwise OFF regardless of policy rows. Among matching
 * rows, the most specific wins (explicit enable OR disable). No match ⇒ OFF.
 */
export function resolveAiEnablement(rows: AiPolicyRow[], ctx: EnablementContext): Enablement {
  if (!ctx.globalMasterOn) {
    return { enabled: false, mode: "shadow", visibleToRadiologist: false, reason: "global master flag off" };
  }
  const winner = rows
    .filter((r) => matches(r, ctx))
    .sort((a, b) => RANK[b.scope] - RANK[a.scope])[0];
  if (!winner) {
    return { enabled: false, mode: "shadow", visibleToRadiologist: false, reason: "no matching policy — default OFF" };
  }
  const visibleToRadiologist = winner.enabled && (winner.mode === "pilot" || winner.mode === "production");
  return { enabled: winner.enabled, mode: winner.mode, visibleToRadiologist, reason: `${winner.scope}:${winner.scopeKey}` };
}
