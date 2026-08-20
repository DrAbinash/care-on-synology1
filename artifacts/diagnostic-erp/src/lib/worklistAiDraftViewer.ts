/**
 * Worklist AI Draft Viewer — shapes API payload into display sections.
 * Mirrors server `shapeWorklistAiDraftViewer` fields used by the dialog.
 */

export interface WorklistAiDraftViewerFinding {
  key?: string;
  text: string;
  laterality?: string;
}

export interface WorklistAiDraftViewerPayload {
  source?: string | null;
  draftId?: number | null;
  version?: number | null;
  findingCount?: number;
  findingsText?: string;
  findings?: WorklistAiDraftViewerFinding[];
  impression?: string[];
  empty?: boolean;
  degraded?: boolean;
  quarantinedCount?: number;
  updatedAt?: string | null;
  qualityScore?: number | null;
  provenance?: {
    modelVersion?: string;
    promptVersion?: string;
    rulesVersion?: string;
    degraded?: boolean;
    createdAt?: string;
  } | null;
}

/** Normalize legacy raw JSON / new shaped payloads into display-ready sections. */
export function normalizeWorklistAiDraftViewer(
  draft: WorklistAiDraftViewerPayload | Record<string, unknown> | null | undefined,
): {
  findings: WorklistAiDraftViewerFinding[];
  impression: string[];
  empty: boolean;
  degraded: boolean;
  quarantinedCount: number;
  findingCount: number;
  draftId: number | null;
  version: number | null;
  updatedAt: string | null;
  provenanceLine: string | null;
} {
  if (!draft || typeof draft !== "object") {
    return {
      findings: [],
      impression: [],
      empty: true,
      degraded: false,
      quarantinedCount: 0,
      findingCount: 0,
      draftId: null,
      version: null,
      updatedAt: null,
      provenanceLine: null,
    };
  }

  const d = draft as WorklistAiDraftViewerPayload;
  const rawFindings: unknown = d.findings;
  let findings: WorklistAiDraftViewerFinding[] = [];
  if (Array.isArray(rawFindings)) {
    findings = rawFindings
      .map((f) => {
        const row = f && typeof f === "object" ? (f as WorklistAiDraftViewerFinding) : null;
        return {
          key: typeof row?.key === "string" ? row.key : undefined,
          text: typeof row?.text === "string" ? row.text.trim() : "",
          laterality: typeof row?.laterality === "string" ? row.laterality : undefined,
        };
      })
      .filter((f) => f.text.length > 0);
  } else if (typeof d.findingsText === "string" && d.findingsText.trim()) {
    findings = [{ text: d.findingsText.trim() }];
  } else if (typeof rawFindings === "string") {
    const text = rawFindings.trim();
    if (text) findings = [{ text }];
  }

  const impression = Array.isArray(d.impression)
    ? d.impression.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
    : [];

  const empty =
    typeof d.empty === "boolean" ? d.empty : findings.length === 0 && impression.length === 0;

  const provenance = d.provenance;
  const provenanceLine = provenance
    ? [
        provenance.modelVersion ? `model ${provenance.modelVersion}` : null,
        provenance.promptVersion ? `prompt ${provenance.promptVersion}` : null,
        provenance.rulesVersion ? `rules ${provenance.rulesVersion}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  return {
    findings,
    impression,
    empty,
    degraded: d.degraded === true || d.source === "ai_shadow_degraded",
    quarantinedCount: typeof d.quarantinedCount === "number" ? d.quarantinedCount : 0,
    findingCount: typeof d.findingCount === "number" ? d.findingCount : findings.length,
    draftId: typeof d.draftId === "number" ? d.draftId : null,
    version: typeof d.version === "number" ? d.version : null,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
    provenanceLine,
  };
}
