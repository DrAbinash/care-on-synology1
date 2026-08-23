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

export type VoiceObservation = z.infer<typeof VoiceObservationSchema>;
export type VoiceChangePlan = z.infer<typeof VoiceChangePlanSchema>;

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

export function parseChangePlanJson(raw: string): VoiceChangePlan | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = VoiceChangePlanSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
