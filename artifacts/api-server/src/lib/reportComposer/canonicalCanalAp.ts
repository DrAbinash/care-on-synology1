/**
 * The one read the AI Composer makes of the spinal canal AP record.
 *
 * `structured_json.careCanalApProvenance` is the canonical record the reporting
 * workspace's measurement grid writes (RIS-013, owner DECISION 1–2). The signed
 * report's canal table is folded from it through `canalApValue` and
 * `canalPrintPlan`. This module hands the Composer the SAME fold, and nothing
 * else: it is a projection, not a store, not a cache, and not a second place a
 * diameter can live.
 *
 * Why the record does not travel inside `ComposerInputSnapshot`:
 *   - The snapshot is the frozen AI input, and its `inputHash` / `reportRevision`
 *     are verified against the client's own copy (`stale_browser` refusal).
 *     Clinical content that only the server knows would make every spine job hash
 *     against something the workstation cannot reproduce.
 *   - The snapshot is client-declared. A canal diameter sent by the browser could
 *     be stale or forged, which is the class of defect that produced DECISION 2:
 *     prose and the pinned table disagreeing in one patient's report.
 *   - The draft row is already resolved server-side for image ownership
 *     (`resolveAuthoritativeComposeDraft`). Reading the record from that same row
 *     means the AI is told what the report of record will print, by construction.
 *
 * So the record is passed as its own argument, resolved from the database, and the
 * Composer has no write path to it.
 */
import { canalApComposerReadings, type CanalApComposerRecord } from "@workspace/measurements";
import { extractCareCanalApProvenance } from "../structuredJsonColumn";

/**
 * The composer-facing projection of a draft's canal record.
 *
 * Accepts the whole `structured_json` column (envelope or bare) and pulls the
 * provenance out with the same reader the print preparers use, so the two can
 * never be looking at different keys of one column. A column with no record — a
 * brain MRI, a legacy draft, an unreadable envelope — projects to an empty record
 * rather than an error, because a study without canal measurements is the normal
 * case and must not cost the radiologist a draft.
 */
export function canalApFromStructuredJson(column: unknown): CanalApComposerRecord {
  return canalApComposerReadings(extractCareCanalApProvenance(column));
}

/**
 * The Refine / combine prompt payload: the record as DATA, plus the rule.
 *
 * A preserving job answers in JSON-shaped prose, and its conservation rule is
 * about the text it was handed — a grid measurement is not in that text, so it
 * needs to arrive as its own field or the rewrite has no way to know the numbers
 * the table is going to print.
 *
 * Lives here rather than inline in `composeEngine` because that module evaluates
 * `@workspace/db` at import time, and a clinical contract that can only be tested
 * next to a live database is a contract that quietly stops being tested.
 */
export function canalApPromptFields(
  canalAp: CanalApComposerRecord | null | undefined,
): Record<string, unknown> {
  if (!canalAp || canalAp.isEmpty) return {};
  return {
    canalApDiametersMm: canalAp.readings.map((r) => ({
      level: r.level,
      mm: r.valueMm,
      unit: r.unit,
      source: r.source,
      manualOverride: r.manualOverride,
    })),
    ...(canalAp.declinedLevels.length ? { canalApDeclinedLevels: canalAp.declinedLevels } : {}),
    canalApRule:
      "CANAL AP DIAMETERS are the radiologist's READ-ONLY canonical measurement record, and the "
      + "numbers the signed report's canal table prints. Keep each value exactly as given, on the "
      + "same level, in millimetres. Modify none of them, supply none for a level that is not "
      + "listed, and say nothing about the levels in canalApDeclinedLevels. Do not restate them as "
      + "a table: the table is generated from this record, and a copy in the prose prints them twice.",
  };
}
