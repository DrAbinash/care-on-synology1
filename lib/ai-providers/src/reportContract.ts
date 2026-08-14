/**
 * Provisional-report contract — Phase P2 / Gate G7.
 *
 * The model-agnostic JSON contract the AI Gateway enforces on every structured
 * draft, plus the per-provider schema PROJECTION and a validate/repair pass. The
 * ERP never sees free text from a model — only structured JSON that conforms to
 * this contract (or a degraded, empty conforming draft). Shape mirrors the P1
 * shadow draft so nothing downstream changes.
 */
import { z } from "zod";

export const evidenceAnchorSchema = z.object({
  findingKey: z.string().min(1),
  evidenceType: z.enum(["image", "measurement", "heatmap"]),
  seriesInstanceUid: z.string().optional(),
  sopInstanceUid: z.string().optional(),
  frameNumber: z.number().int().optional(),
  measurementRef: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

export const provisionalFindingSchema = z.object({
  key: z.string().min(1),
  text: z.string(),
  laterality: z.enum(["left", "right", "bilateral", "none"]).optional(),
  negated: z.boolean().optional(),
  evidence: z.array(evidenceAnchorSchema).default([]),
});

export const provisionalReportSchema = z.object({
  studyContext: z.object({
    studyInstanceUid: z.string().min(1),
    modality: z.string().optional(),
    imageCount: z.number().int().nonnegative().default(0),
  }),
  findings: z.array(provisionalFindingSchema).default([]),
  measurements: z.array(z.object({ id: z.string(), value: z.number(), unit: z.string() })).default([]),
  impression: z.array(z.string()).default([]),
});

export type ProvisionalReport = z.infer<typeof provisionalReportSchema>;
export type ProvisionalFinding = z.infer<typeof provisionalFindingSchema>;
export type EvidenceAnchorContract = z.infer<typeof evidenceAnchorSchema>;

export interface ContractValidation {
  ok: boolean;
  data?: ProvisionalReport;
  errors?: string[];
  repaired?: boolean;
}

/**
 * Validate raw model output against the contract, with ONE best-effort repair:
 * if the raw JSON is a string it is parsed; unknown/garbage finding entries are
 * dropped rather than failing the whole draft. Returns a conforming report or an
 * error list (the pipeline then degrades to deterministic-only).
 */
export function validateProvisionalReport(raw: unknown, studyInstanceUid: string): ContractValidation {
  let value = raw;
  let repaired = false;
  if (typeof value === "string") {
    try {
      // Strip chain-of-thought blocks some models emit even with think=false.
      const stripped = value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      // tolerate ```json fences and surrounding prose
      const m = stripped.match(/\{[\s\S]*\}/);
      value = JSON.parse(m ? m[0] : stripped);
      repaired = true;
    } catch {
      return { ok: false, errors: ["model output is not valid JSON"] };
    }
  }

  const first = provisionalReportSchema.safeParse(value);
  if (first.success) return { ok: true, data: first.data, repaired };

  // Repair pass: keep the envelope, drop only the malformed findings.
  const obj = (value ?? {}) as Record<string, unknown>;
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const goodFindings = rawFindings.filter((f) => provisionalFindingSchema.safeParse(f).success);
  const patched = {
    studyContext: {
      studyInstanceUid,
      modality: (obj.studyContext as Record<string, unknown> | undefined)?.modality,
      imageCount: Number((obj.studyContext as Record<string, unknown> | undefined)?.imageCount ?? 0) || 0,
    },
    findings: goodFindings,
    measurements: Array.isArray(obj.measurements) ? obj.measurements : [],
    impression: Array.isArray(obj.impression) ? obj.impression : [],
  };
  const second = provisionalReportSchema.safeParse(patched);
  if (second.success) {
    return { ok: true, data: second.data, repaired: true };
  }
  return { ok: false, errors: first.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}

/** An empty, contract-conforming draft — used for deterministic degradation. */
export function emptyProvisionalReport(studyInstanceUid: string, modality?: string, imageCount = 0): ProvisionalReport {
  return { studyContext: { studyInstanceUid, modality, imageCount }, findings: [], measurements: [], impression: [] };
}

// ── Schema projection ───────────────────────────────────────────────────────
// The full contract uses constructs (enums, optionals) that each backend's
// constrained-decoding mode expresses differently. Projection returns the
// provider-appropriate hint; server-side validateProvisionalReport() is the
// authoritative safety net regardless of what the backend enforces.
export type ProjectionMode = "openai-json-schema" | "gemini-response-schema" | "ollama-format" | "none";

export interface SchemaProjection {
  mode: ProjectionMode;
  /** A JSON-schema-ish descriptor the caller may pass to the provider SDK. */
  schema: Record<string, unknown>;
}

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    studyContext: { type: "object" },
    findings: { type: "array" },
    measurements: { type: "array" },
    impression: { type: "array" },
  },
  required: ["studyContext", "findings"],
};

export function projectSchemaForProvider(provider: string): SchemaProjection {
  switch (provider) {
    case "openai":
      return { mode: "openai-json-schema", schema: JSON_SCHEMA };
    case "gemini":
      return { mode: "gemini-response-schema", schema: JSON_SCHEMA };
    case "ollama":
      return { mode: "ollama-format", schema: JSON_SCHEMA };
    default:
      return { mode: "none", schema: JSON_SCHEMA };
  }
}
