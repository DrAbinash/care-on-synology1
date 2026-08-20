/**
 * Shape the worklist "View AI Draft" payload into a radiologist-readable form.
 *
 * Overnight / shadow pipeline stores a compact pointer on radiology_worklist.ai_draft_json
 * (`source`, `draftId`, `findingCount`, findings string, impression[]). The authoritative
 * grounded content lives in ai_shadow_drafts. This helper prefers the shadow draft when
 * present, falls back to the stored summary, and never requires the UI to dump raw JSON.
 */
import type { WorkspaceDraft } from "./draftService";
import { classifyShadowDraftUsability, type ShadowDraftClinicalStatus } from "./shadowDraftUsability";

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
  usable: boolean;
  clinicalStatus: ShadowDraftClinicalStatus | "UNKNOWN";
  emptyReason: string | null;
  emptyReasonLabel: string | null;
  degraded: boolean;
  quarantinedCount: number;
  candidateCount: number;
  imageCount: number | null;
  quarantineReasonClasses: Array<{ reason: string; count: number }>;
  updatedAt: string | null;
  qualityScore: number | null;
  provenance: WorkspaceDraft["provenance"] | null;
  /** PHI-safe technical details for collapsible debug. */
  technical: Record<string, unknown> | null;
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

function reasonClassesFromStored(stored: Record<string, unknown>): Array<{ reason: string; count: number }> {
  const raw = stored.quarantineReasonClasses;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ reason: string; count: number }> = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.reason !== "string") continue;
    out.push({ reason: row.reason, count: typeof row.count === "number" ? row.count : 1 });
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
    const quarantinedCount = shadow.quarantinedCount;
    const candidateFromStored = typeof stored?.candidateCount === "number" ? stored.candidateCount : null;
    const candidateCount = candidateFromStored ?? (findings.length + quarantinedCount);
    const usability = classifyShadowDraftUsability({
      acceptedFindings: findings,
      quarantinedFindings: Array.from({ length: quarantinedCount }, () => ({
        reasons: reasonClassesFromStored(stored ?? {}).map((r) => r.reason),
      })),
      impression,
      candidateCount,
      degraded: shadow.degraded,
      imageCount: typeof stored?.imageCount === "number" ? stored.imageCount : undefined,
    });
    // Prefer explicit clinicalStatus from pointer when present.
    const pointerStatus = typeof stored?.clinicalStatus === "string"
      ? stored.clinicalStatus.toUpperCase()
      : null;
    const clinicalStatus =
      pointerStatus === "READY" || pointerStatus === "EMPTY" || pointerStatus === "QUARANTINED"
        ? (pointerStatus as ShadowDraftClinicalStatus)
        : usability.clinicalStatus;

    return {
      source: shadow.degraded ? "ai_shadow_degraded" : "ai_shadow",
      draftId: shadow.draftId,
      version: shadow.version,
      findingCount: findings.length,
      findingsText,
      findings,
      impression,
      empty: !usability.usable,
      usable: clinicalStatus === "READY",
      clinicalStatus,
      emptyReason: (typeof stored?.emptyReason === "string" ? stored.emptyReason : usability.emptyReason),
      emptyReasonLabel: (typeof stored?.emptyReasonLabel === "string" ? stored.emptyReasonLabel : usability.emptyReasonLabel),
      degraded: shadow.degraded,
      quarantinedCount,
      candidateCount,
      imageCount: typeof stored?.imageCount === "number" ? stored.imageCount : null,
      quarantineReasonClasses: reasonClassesFromStored(stored ?? {}).length > 0
        ? reasonClassesFromStored(stored ?? {})
        : usability.quarantineReasonClasses,
      updatedAt: shadow.provenance.createdAt ?? null,
      qualityScore: shadow.qualityScore,
      provenance: shadow.provenance,
      technical: {
        draftId: shadow.draftId,
        version: shadow.version,
        clinicalStatus,
        candidateCount,
        acceptedCount: findings.length,
        quarantinedCount,
        degraded: shadow.degraded,
        modelVersion: shadow.provenance.modelVersion,
        promptVersion: shadow.provenance.promptVersion,
        imageCount: typeof stored?.imageCount === "number" ? stored.imageCount : null,
      },
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
      usable: false,
      clinicalStatus: "EMPTY",
      emptyReason: "no_candidate_findings",
      emptyReasonLabel: "No draft stored for this study.",
      degraded: false,
      quarantinedCount: 0,
      candidateCount: 0,
      imageCount: null,
      quarantineReasonClasses: [],
      updatedAt: null,
      qualityScore: null,
      provenance: null,
      technical: null,
    };
  }

  const findings = findingsFromStored(stored);
  const impression = asStringArray(stored.impression);
  const findingsText = findings.map((f) => f.text).join("\n");
  const quarantinedCount =
    typeof stored.quarantinedCount === "number" && Number.isFinite(stored.quarantinedCount)
      ? stored.quarantinedCount
      : 0;
  const candidateCount =
    typeof stored.candidateCount === "number" && Number.isFinite(stored.candidateCount)
      ? stored.candidateCount
      : findings.length + quarantinedCount;
  const usability = classifyShadowDraftUsability({
    acceptedFindings: findings,
    quarantinedFindings: Array.from({ length: quarantinedCount }, () => ({ reasons: [] })),
    impression,
    candidateCount,
    degraded: stored.source === "ai_shadow_degraded" || stored.degraded === true,
    imageCount: typeof stored.imageCount === "number" ? stored.imageCount : undefined,
  });
  const pointerStatus = typeof stored.clinicalStatus === "string" ? stored.clinicalStatus.toUpperCase() : null;
  const clinicalStatus =
    pointerStatus === "READY" || pointerStatus === "EMPTY" || pointerStatus === "QUARANTINED"
      ? (pointerStatus as ShadowDraftClinicalStatus)
      : usability.clinicalStatus;

  return {
    source: typeof stored.source === "string" ? stored.source : null,
    draftId: typeof stored.draftId === "number" ? stored.draftId : null,
    version: typeof stored.version === "number" ? stored.version : null,
    findingCount: findings.length,
    findingsText,
    findings,
    impression,
    empty: !usability.usable,
    usable: clinicalStatus === "READY",
    clinicalStatus,
    emptyReason: typeof stored.emptyReason === "string" ? stored.emptyReason : usability.emptyReason,
    emptyReasonLabel: typeof stored.emptyReasonLabel === "string" ? stored.emptyReasonLabel : usability.emptyReasonLabel,
    degraded: stored.source === "ai_shadow_degraded" || stored.degraded === true,
    quarantinedCount,
    candidateCount,
    imageCount: typeof stored.imageCount === "number" ? stored.imageCount : null,
    quarantineReasonClasses: reasonClassesFromStored(stored),
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
    qualityScore: typeof stored.qualityScore === "number" ? stored.qualityScore : null,
    provenance: null,
    technical: {
      draftId: typeof stored.draftId === "number" ? stored.draftId : null,
      version: typeof stored.version === "number" ? stored.version : null,
      clinicalStatus,
      candidateCount,
      acceptedCount: findings.length,
      quarantinedCount,
      imageCount: typeof stored.imageCount === "number" ? stored.imageCount : null,
      degraded: stored.source === "ai_shadow_degraded" || stored.degraded === true,
      modelVersion: typeof stored.modelVersion === "string" ? stored.modelVersion : null,
    },
  };
}
