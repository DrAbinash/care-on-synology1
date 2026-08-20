/**
 * Shape the worklist "View AI Draft" payload into a radiologist-readable form.
 *
 * Overnight / shadow pipeline stores a compact pointer on radiology_worklist.ai_draft_json
 * (`source`, `draftId`, `findingCount`, findings string, impression[]). The authoritative
 * grounded content lives in ai_shadow_drafts. This helper prefers the shadow draft when
 * present, falls back to the stored summary, and never requires the UI to dump raw JSON.
 */
import type { WorkspaceDraft } from "./draftService";

export interface WorklistAiDraftViewerFinding {
  key?: string;
  text: string;
  laterality?: string;
}

export interface WorklistAiDraftViewerPayload {
  source: string | null;
  draftId: number | null;
  version: number | null;
  findingCount: number;
  findingsText: string;
  findings: WorklistAiDraftViewerFinding[];
  impression: string[];
  empty: boolean;
  degraded: boolean;
  quarantinedCount: number;
  updatedAt: string | null;
  qualityScore: number | null;
  provenance: WorkspaceDraft["provenance"] | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function findingsFromStored(stored: Record<string, unknown>): WorklistAiDraftViewerFinding[] {
  const raw = stored.findings;
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? [{ text }] : [];
  }
  if (!Array.isArray(raw)) {
    const fallback = asString(stored.text || stored.content).trim();
    return fallback ? [{ text: fallback }] : [];
  }
  const out: WorklistAiDraftViewerFinding[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ text: item.trim() });
      continue;
    }
    const row = asRecord(item);
    if (!row) continue;
    const text = asString(row.text || row.finding || row.content).trim();
    if (!text) continue;
    out.push({
      key: typeof row.key === "string" ? row.key : undefined,
      text,
      laterality: typeof row.laterality === "string" ? row.laterality : undefined,
    });
  }
  return out;
}

export function shapeWorklistAiDraftViewer(input: {
  stored: Record<string, unknown> | null;
  shadow: WorkspaceDraft | null;
}): WorklistAiDraftViewerPayload {
  const { stored, shadow } = input;

  if (shadow) {
    const findings = shadow.findings
      .map((f) => ({
        key: f.key,
        text: (f.text ?? "").trim(),
        laterality: f.laterality,
      }))
      .filter((f) => f.text.length > 0);
    const impression = (shadow.impression ?? []).map((s) => s.trim()).filter(Boolean);
    const findingsText = findings.map((f) => f.text).join("\n");
    return {
      source: shadow.degraded ? "ai_shadow_degraded" : "ai_shadow",
      draftId: shadow.draftId,
      version: shadow.version,
      findingCount: findings.length,
      findingsText,
      findings,
      impression,
      empty: findings.length === 0 && impression.length === 0,
      degraded: shadow.degraded,
      quarantinedCount: shadow.quarantinedCount,
      updatedAt: shadow.provenance.createdAt ?? null,
      qualityScore: shadow.qualityScore,
      provenance: shadow.provenance,
    };
  }

  if (!stored) {
    return {
      source: null,
      draftId: null,
      version: null,
      findingCount: 0,
      findingsText: "",
      findings: [],
      impression: [],
      empty: true,
      degraded: false,
      quarantinedCount: 0,
      updatedAt: null,
      qualityScore: null,
      provenance: null,
    };
  }

  const findings = findingsFromStored(stored);
  const impression = asStringArray(stored.impression);
  const findingsText = findings.map((f) => f.text).join("\n");
  const findingCount =
    typeof stored.findingCount === "number" && Number.isFinite(stored.findingCount)
      ? stored.findingCount
      : findings.length;

  return {
    source: typeof stored.source === "string" ? stored.source : null,
    draftId: typeof stored.draftId === "number" ? stored.draftId : null,
    version: typeof stored.version === "number" ? stored.version : null,
    findingCount,
    findingsText,
    findings,
    impression,
    empty: findings.length === 0 && impression.length === 0,
    degraded: stored.source === "ai_shadow_degraded" || stored.degraded === true,
    quarantinedCount:
      typeof stored.quarantinedCount === "number" && Number.isFinite(stored.quarantinedCount)
        ? stored.quarantinedCount
        : 0,
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
    qualityScore: typeof stored.qualityScore === "number" ? stored.qualityScore : null,
    provenance: null,
  };
}
