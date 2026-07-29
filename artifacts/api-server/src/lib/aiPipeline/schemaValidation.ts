/**
 * Lightweight JSON schema validation for AI draft outputs.
 */

export interface DraftReport {
  status: "DRAFT";
  findings: string;
  impression: string;
  advice: string;
  warnings: string[];
  uncertainty: string[];
  evidenceNotes: string[];
}

export function validateDraftReport(raw: unknown): { ok: true; value: DraftReport } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "not_an_object" };
  const o = raw as Record<string, unknown>;
  if (o.status !== "DRAFT") return { ok: false, error: "status_must_be_DRAFT" };
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : []);
  return {
    ok: true,
    value: {
      status: "DRAFT",
      findings: str("findings"),
      impression: str("impression"),
      advice: str("advice"),
      warnings: arr("warnings"),
      uncertainty: arr("uncertainty"),
      evidenceNotes: arr("evidenceNotes"),
    },
  };
}

export function parseJsonFromModel(text: string): unknown {
  const trimmed = (text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : trimmed;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonText = (objectMatch ? objectMatch[0] : candidate).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/** Ensure laterality tokens from OCR still appear when present in draft findings */
export function lateralityPreserved(ocrText: string, draftFindings: string): boolean {
  const tokens = Array.from(new Set((ocrText.match(/\b(left|right|bilateral)\b/gi) || []).map((t) => t.toLowerCase())));
  if (tokens.length === 0) return true;
  const draft = (draftFindings || "").toLowerCase();
  // If OCR mentioned a side and draft has findings content, at least one laterality token should remain
  if (!draft.trim()) return true;
  return tokens.some((t) => draft.includes(t));
}

export function measurementsPreserved(
  ocrMeasurements: Array<{ value: string; unit?: string }>,
  draftText: string,
): boolean {
  if (!ocrMeasurements.length) return true;
  const draft = draftText || "";
  // At least half of numeric values should still appear (soft check)
  let hit = 0;
  for (const m of ocrMeasurements.slice(0, 20)) {
    if (draft.includes(m.value)) hit++;
  }
  return hit >= Math.ceil(Math.min(ocrMeasurements.length, 20) / 2);
}