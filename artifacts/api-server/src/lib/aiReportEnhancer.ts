/**
 * aiReportEnhancer.ts — LEGACY / DEPRECATED. Do not build on this path.
 *
 * Superseded by the Report Composer (`lib/reportComposer/**`), which is the
 * only AI drafting surface with a frozen snapshot, canonical-observation
 * grounding, blocking validation, tracked review and a finalize guard. This
 * generator has none of those: its prompt contained a modality and an
 * accession number and nothing else — no observations, no measurements, no
 * laterality — so every clinical fact it returned was invented.
 *
 * It stays mounted because deleting a route is a bigger change than making it
 * safe, but the invented-clinical-value behaviour is gone:
 *  - the model is no longer asked to supply "example measurements";
 *  - no measurement is ever persisted from this path (there was no source for
 *    one; `2.4 cm` / `45 HU` used to be written to the table on parse failure);
 *  - unparsable output now FAILS CLOSED instead of storing a placeholder
 *    impression such as "AI impression — correlate clinically.";
 *  - the accession number is no longer copied into an outbound prompt, because
 *    it identifies the study and helps the model not at all.
 *
 * Any future work here should move the caller to the composer instead.
 */
import { db } from "@workspace/db";
import {
  radiologyAiEnhancementsTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateAiForTask } from "@workspace/ai-providers";
import { logger } from "./logger";

export type AiEnhancementResult = {
  findings: string;
  impression: string;
  measurements: Array<{ type: string; value: string; unit: string }>;
};

/**
 * @deprecated Legacy ghost text with no clinical grounding. Kept for route
 * compatibility only; returns null when nothing verifiable was produced.
 */
export async function generateAiEnhancement(studyId: number, provider?: string): Promise<AiEnhancementResult | null> {
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId));
  if (!study) return null;

  // Deliberately thin: no accession, no patient field, no request for
  // measurements. The earlier prompt asked for "two example measurements with
  // units" against a study it had never observed, which is an instruction to
  // fabricate clinical numbers.
  const prompt = `You are a radiology writing assistant. A ${study.modality} study needs a neutral summary sentence and a short provisional impression line, both to be treated as unreviewed ghost text and rewritten by a radiologist.

Return ONLY a JSON object with this exact shape:
{"findings": "...", "impression": "..."}`;

  const result = await generateAiForTask("report_enhancement", prompt, [], {
    provider,
    maxTokens: 2048,
  });
  if (!result.success) {
    return null;
  }

  let parsed: AiEnhancementResult | null = null;
  try {
    const text = result.text.trim();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd >= 0) {
      const raw = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Partial<AiEnhancementResult>;
      const findings = typeof raw.findings === "string" ? raw.findings.trim() : "";
      const impression = typeof raw.impression === "string" ? raw.impression.trim() : "";
      if (findings && impression) {
        parsed = { findings, impression, measurements: [] };
      }
    }
  } catch {
    parsed = null;
  }

  // FAIL CLOSED. A malformed answer used to be replaced with invented numbers
  // and a canned impression, then written to the database as if it had come
  // from the study.
  if (!parsed) {
    logger.warn(
      { studyId, rawLength: result.text?.length ?? 0 },
      "legacy AI report enhancement returned unparsable output — nothing was stored (fail closed)",
    );
    return null;
  }

  await db.insert(radiologyAiEnhancementsTable).values({
    studyId,
    findingsJson: JSON.stringify({ findings: parsed.findings }),
    impressionDraft: parsed.impression,
    // Always empty by construction: this path has no measurement source, and a
    // value it could not observe is a value it must not store.
    measurementExtractsJson: JSON.stringify([]),
    aiModel: provider ?? "gemini",
    aiVersion: "2025-05-legacy",
  });

  return parsed;
}

export async function getAiEnhancement(studyId: number): Promise<typeof radiologyAiEnhancementsTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(radiologyAiEnhancementsTable)
    .where(eq(radiologyAiEnhancementsTable.studyId, studyId))
    .orderBy(radiologyAiEnhancementsTable.createdAt)
    .limit(1);
  return row ?? null;
}

export async function acceptAiEnhancement(enhancementId: number, reviewerId: number): Promise<void> {
  await db
    .update(radiologyAiEnhancementsTable)
    .set({ accepted: true, reviewedBy: reviewerId, reviewedAt: new Date() })
    .where(eq(radiologyAiEnhancementsTable.id, enhancementId));
}

export async function rejectAiEnhancement(enhancementId: number, reviewerId: number): Promise<void> {
  await db
    .update(radiologyAiEnhancementsTable)
    .set({ accepted: false, reviewedBy: reviewerId, reviewedAt: new Date() })
    .where(eq(radiologyAiEnhancementsTable.id, enhancementId));
}
