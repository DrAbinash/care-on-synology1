/**
 * draftTechniqueRoundTrip.ts — the persistence seam for the report Technique line.
 *
 * Why this field is clinical, not cosmetic: `sequencesAvailable` is DERIVED from
 * this text (`useWorkspaceClinicalUi.tsx` → `deriveSpineSequencesAvailable`), and
 * that derived state is what gates every strong spine/vascular sentence and what
 * decides whether a "the study did not include …" limitation is emitted. Losing
 * the Technique is therefore not losing a paragraph — it is silently changing the
 * acquisition record the rest of the report is written against.
 *
 * Where the value is actually stored:
 *   1. autosave sends it as `technique` (`useDraftPersistence.ts` saveDraft body);
 *   2. `POST /api/radiology/report-generator/save-draft` composes it into the
 *      `findings_sections` JSON column under the `Technique` section
 *      (`api-server/src/routes/radiology-report-generator.ts`, `sectionsForStore`);
 *   3. `GET /drafts` returns the whole row (a full-column select), so the row the
 *      workspace hydrates from carries `findingsSections` — and carries NO
 *      `technique` key, because `radiology_report_drafts` has no technique column
 *      at all (`lib/db/src/schema/radiologyReportGenerator.ts`).
 *
 * The defect this file closes: hydration read `draft.technique`, a key that can
 * never exist. Every reopen therefore restored `""`, and because the save body is
 * built from the live store, the next autosave wrote `findings_sections` back
 * WITHOUT the Technique section — the persisted value was destroyed, not merely
 * hidden. (The server's own print path reads that same section, so the blanking
 * reached the signed document too.)
 *
 * Deliberately zero-dependency — no React, no store, no `@/` alias — for the same
 * reason as `radiologyDraftId.ts`: it lets the api-server route test execute the
 * real client-side reader against the real server-side writer in one process, so
 * the round trip is proven by running it rather than by grepping for it.
 */

/** The section name the server writes the Technique into. Keep in sync with save-draft. */
export const TECHNIQUE_SECTION_KEY = "Technique";

/** Anything shaped like a draft row: the column that exists, plus the one that doesn't. */
export type DraftTechniqueCarrier = {
  technique?: unknown;
  findingsSections?: unknown;
};

function parseSectionsColumn(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  // The column is TEXT, so the API hands back a JSON string. An object is also
  // accepted, because that is what a future JSON column or a local backup
  // envelope would carry — the reader must not be the reason a value is lost.
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * The Technique section of a persisted `findings_sections` column, or "" when
 * there is none. Never throws, never invents a sentence, and never upgrades a
 * missing section to a placeholder: an absent Technique must stay absent so the
 * radiologist sees an empty box rather than text the system made up.
 */
export function techniqueFromFindingsSections(raw: unknown): string {
  const sections = parseSectionsColumn(raw);
  if (!sections) return "";
  const exact = sections[TECHNIQUE_SECTION_KEY];
  if (typeof exact === "string") return exact;
  // The server writes the exact key above; this fallback only widens the read so
  // a section stored by another writer as "TECHNIQUE"/"technique " still survives.
  for (const [name, body] of Object.entries(sections)) {
    if (typeof body === "string" && name.trim().toLowerCase() === "technique") return body;
  }
  return "";
}

/**
 * What Technique a reopened study should show. A row that carries `technique`
 * directly wins (no endpoint does today; it is the forward-compatible reading),
 * otherwise the persisted section is the source of truth.
 */
export function resolveDraftTechnique(row: DraftTechniqueCarrier | null | undefined): string {
  if (!row) return "";
  const direct = row.technique;
  if (typeof direct === "string" && direct.trim()) return direct;
  return techniqueFromFindingsSections(row.findingsSections);
}
