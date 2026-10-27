/**
 * Voice Report Composer — structured change-plan contract.
 * Model output is validated here before any client applies mutations.
 */
import { z } from "zod";

export const VoiceObservationSchema = z.object({
  id: z.string().optional(),
  concept: z.string().min(1),
  level: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  laterality: z.string().nullable().optional(),
  modifiers: z.array(z.string()).optional().default([]),
  findingsText: z.string().min(1),
  impressionText: z.string().optional(),
  anatomicalSection: z.string().optional(),
  conflictGroup: z.string().optional(),
  baselineReplaces: z.string().optional(),
  operation: z.enum(["add", "update", "remove"]).optional().default("add"),
  targetObservationId: z.string().optional(),
});

export const VoiceChangePlanSchema = z.object({
  operation: z.literal("report_change_plan"),
  observations: z.array(VoiceObservationSchema).default([]),
  removeConflictingBaselineConcepts: z.array(z.string()).optional().default([]),
  impressionCandidates: z.array(z.string()).optional().default([]),
  impressionUpdate: z.string().optional(),
  uncertainties: z.array(z.string()).default([]),
  clarificationRequired: z.string().nullable().optional(),
});

/** Parsed/normalized observation (defaults applied). */
export type VoiceObservation = z.output<typeof VoiceObservationSchema>;
/** Parsed/normalized change plan (defaults applied). */
export type VoiceChangePlan = z.output<typeof VoiceChangePlanSchema>;
/** Construction-friendly input — defaults filled by parse helpers. */
export type VoiceObservationInput = z.input<typeof VoiceObservationSchema>;
export type VoiceChangePlanInput = z.input<typeof VoiceChangePlanSchema>;

export function observation(partial: VoiceObservationInput): VoiceObservation {
  return VoiceObservationSchema.parse(partial);
}

export function changePlan(
  partial: Omit<VoiceChangePlanInput, "operation"> & { operation?: "report_change_plan" },
): VoiceChangePlan {
  return VoiceChangePlanSchema.parse({
    operation: "report_change_plan",
    observations: [],
    uncertainties: [],
    ...partial,
  });
}

export const VOICE_COMPOSER_JSON_SCHEMA = {
  type: "object",
  required: ["operation", "observations"],
  properties: {
    operation: { type: "string", enum: ["report_change_plan"] },
    observations: {
      type: "array",
      items: {
        type: "object",
        required: ["concept", "findingsText"],
        properties: {
          id: { type: "string" },
          concept: { type: "string" },
          level: { type: "string", nullable: true },
          severity: { type: "string", nullable: true },
          laterality: { type: "string", nullable: true },
          modifiers: { type: "array", items: { type: "string" } },
          findingsText: { type: "string" },
          impressionText: { type: "string" },
          anatomicalSection: { type: "string" },
          conflictGroup: { type: "string" },
          baselineReplaces: { type: "string" },
          operation: { type: "string", enum: ["add", "update", "remove"] },
          targetObservationId: { type: "string" },
        },
      },
    },
    removeConflictingBaselineConcepts: { type: "array", items: { type: "string" } },
    impressionCandidates: { type: "array", items: { type: "string" } },
    impressionUpdate: { type: "string" },
    uncertainties: { type: "array", items: { type: "string" } },
    clarificationRequired: { type: "string", nullable: true },
  },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ollama models encode "no value" as an explicit JSON null, and occasionally
 * as a boolean `false` for the string-typed `clarificationRequired` — the
 * AI-PC benchmark caught qwen3:14b doing this on 21 of its 31 clinically
 * correct plans (68%), every one of which surfaced to the radiologist as
 * "Invalid structured response — dictation preserved". The zod contract
 * already treats those fields as optional, and "absent" and an explicit null
 * carry the same meaning here, so both normalize to "absent" BEFORE strict
 * typing runs. Nothing else is coerced: wrong-typed values (numbers where
 * strings belong, strings where arrays belong) and required fields set to
 * null still reject, so genuinely invalid instructions keep failing — a
 * boolean `clarificationRequired: true` is equally refused, because "the model
 * wants to ask something" without the question text is not something we can
 * invent for it.
 */
function stripOptionalNulls(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) continue;
    if (key === "clarificationRequired" && value === false) continue;
    out[key] = value;
  }
  return out;
}

/** Normalize one model payload (plan + per-observation) for the strict parse. */
function normalizeChangePlanInput(parsed: unknown): unknown {
  if (!isPlainObject(parsed)) return parsed;
  const plan = stripOptionalNulls(parsed);
  if (Array.isArray(plan.observations)) {
    plan.observations = (plan.observations as unknown[]).map((o) =>
      isPlainObject(o) ? stripOptionalNulls(o) : o,
    );
  }
  return plan;
}

export function parseChangePlanJson(raw: string): VoiceChangePlan | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = VoiceChangePlanSchema.safeParse(normalizeChangePlanInput(parsed));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
