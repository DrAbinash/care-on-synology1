/**
 * Which billed lines are allowed to appear on a machine's worklist.
 *
 * The clinic books things that are not examinations: `MRI CONTRAST` as its own
 * line next to `MRI BRAIN`, `PEN DRIVE / CD STORAGE`, `EXTRA FILM MRI`. Because
 * the study fan-out makes one accession per order test, each of those became a
 * second worklist entry on the same scanner — measured over the 45 days to
 * 7 Nov 2026: 20 MRI contrast items, 10 CT contrast items, 4 pen-drive items and
 * 2 `MRI BRAIN EMG`, on bills that were one appointment at one machine.
 * The owner's ruling was that a contrast line must not create a worklist entry.
 *
 * Suppression is a property of the TEST, not of the name: it lives in
 * `pacs_settings` category `mwl` as a JSON array of `diagnostic_tests.id`, the
 * same store the MWL tab already uses for per-test defaults, and it is edited by
 * the tickbox on Settings → Radiology → PACS Full → Worklist (MWL).
 *
 * What suppression does NOT do: the bill line, the `radiology_studies` row and
 * the `radiology_scheduled_procedures` row all stay exactly as they are, because
 * the charge and the reporting entry are real. Only the `.wl` file is withheld.
 * And the reason the parent entry still says "CONTRAST" is clinical, not
 * cosmetic: a technologist who does not know gadolinium is planned can be handed
 * the wrong protocol, so the suppressed line is folded into the parent's
 * description instead of vanishing.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  orderTestsTable,
  pacsSettingsTable,
  radiologyStudiesTable,
  testsTable,
} from "@workspace/db/schema";
import { logger } from "../logger";
import { MWL_TERMINAL_STATUSES } from "./mwlWorklistWriter";

export const MWL_SUPPRESSED_TEST_IDS_KEY = "mwl_suppressed_test_ids";

/** LO values are 64 bytes; a folded-in suffix must never break the parent. */
export const MWL_DESCRIPTION_MAX_BYTES = 64;

function parseTestIdArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
  } catch {
    // A corrupt list must not silently start publishing every add-on again, and
    // must not stop the worklist either: the safe reading is "no suppression".
    logger.warn({ key: MWL_SUPPRESSED_TEST_IDS_KEY }, "mwl: suppressed test id list is not valid JSON");
    return [];
  }
}

/** Test ids that must not reach a modality worklist. Empty when unset. */
export async function loadMwlSuppressedTestIds(): Promise<number[]> {
  try {
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(
        and(
          eq(pacsSettingsTable.category, "mwl"),
          eq(pacsSettingsTable.key, MWL_SUPPRESSED_TEST_IDS_KEY),
        ),
      )
      .limit(1);
    return parseTestIdArray(row?.value);
  } catch (err) {
    logger.warn({ err }, "mwl: could not read the suppressed test list");
    return [];
  }
}

/**
 * True when this catalog test is booked as a line but is not an examination a
 * machine should be told about.
 *
 * A missing test id is NOT suppressed: publishing is the behaviour that has
 * always been, and an unknown must never be read as a reason to withhold a
 * worklist item the scanner is waiting for.
 */
export function isMwlPublicationSuppressedFor(
  testId: number | null | undefined,
  suppressed: readonly number[],
): boolean {
  if (testId == null || !Number.isInteger(testId)) return false;
  return suppressed.includes(testId);
}

/**
 * The single answer to "may this accession be on a machine's worklist right
 * now", for as many rows as a caller has.
 *
 * Every path that writes a worklist file has to ask it, because the suppression
 * list is a property of the booked TEST and `radiology_scheduled_procedures`
 * stores no test id — the study row is read by accession. The paths that needed
 * this are `POST /mwl-worklist/sync` (regenerates the whole folder from the
 * table, so pressing Sync put every withheld entry straight back on the scanner
 * while the settings tab still said it was off), the two admin procedure routes,
 * and `republishWorklistForAccession`, which the Reporting Workspace calls after
 * correcting a referring doctor.
 *
 * A terminal status removes the file, as it always did. An accession CARE cannot
 * name publishes: withholding an examination a machine is waiting for is the
 * worse mistake.
 */
export async function planMwlWorklistSync(
  rows: Array<{ accessionNumber: string | null; status: string }>,
): Promise<{ write: string[]; remove: string[] }> {
  const write: string[] = [];
  const remove: string[] = [];
  const accessions = rows
    .map((r) => (r.accessionNumber ?? "").trim())
    .filter(Boolean);
  const withheld = new Set<string>();
  if (accessions.length > 0) {
    const suppressed = await loadMwlSuppressedTestIds();
    if (suppressed.length > 0) {
      const studies = await db
        .select({
          accessionNumber: radiologyStudiesTable.accessionNumber,
          testId: radiologyStudiesTable.testId,
        })
        .from(radiologyStudiesTable)
        .where(inArray(radiologyStudiesTable.accessionNumber, accessions));
      for (const study of studies) {
        if (isMwlPublicationSuppressedFor(study.testId, suppressed)) {
          withheld.add(study.accessionNumber);
        }
      }
    }
  }
  for (const row of rows) {
    const acc = (row.accessionNumber ?? "").trim();
    if (!acc) continue;
    if (MWL_TERMINAL_STATUSES.has((row.status || "").toUpperCase()) || withheld.has(acc)) {
      remove.push(acc);
    } else {
      write.push(acc);
    }
  }
  return { write, remove };
}

/**
 * True when this one accession must not have a worklist file — for the routes
 * that act on a single row. Fails closed for the caller that pairs it with a
 * write: if the list cannot be read, nothing is published.
 */
export async function mwlWorklistRemovalRequired(
  accessionNumber: string | null | undefined,
  status: string,
): Promise<boolean> {
  const acc = (accessionNumber ?? "").trim();
  if (MWL_TERMINAL_STATUSES.has((status || "").toUpperCase())) return true;
  if (!acc) return false;
  const plan = await planMwlWorklistSync([{ accessionNumber: acc, status }]);
  return plan.remove.includes(acc);
}
/**
 * The other, suppressed lines on the same order, as a suffix for this entry's
 * description — so a booked contrast still reads "MRI BRAIN + MRI CONTRAST".
 *
 * Returns "" when there is nothing to add, when the parent is itself the
 * suppressed line, or when not even one name fits an LO field beside the parent's
 * own. When only some of them fit, the ones that fit are kept: a visit booked
 * with contrast and a 40-character film-storage line must not lose the word
 * CONTRAST because the second note would have overflowed.
 */
export async function suppressedSiblingSuffix(
  orderId: number,
  testId: number | null | undefined,
  parentDescription: string,
  suppressed: readonly number[],
): Promise<string> {
  if (testId == null || suppressed.length === 0) return "";
  const others = suppressed.filter((id) => id !== testId);
  if (others.length === 0) return "";
  try {
    const rows = await db
      .select({ id: testsTable.id, name: testsTable.name })
      .from(orderTestsTable)
      .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
      .where(
        and(
          eq(orderTestsTable.orderId, orderId),
          eq(orderTestsTable.status, "active"),
          inArray(orderTestsTable.testId, others),
        ),
      );
    if (rows.length === 0) return "";
    const names = rows
      .sort((a, b) => a.id - b.id)
      .map((r) => (r.name || "").trim())
      .filter(Boolean);
    if (names.length === 0) return "";
    const kept: string[] = [];
    for (const name of names) {
      const candidate = [...kept, name].join(" + ");
      if (
        Buffer.byteLength(`${parentDescription} + ${candidate}`, "utf8") >
        MWL_DESCRIPTION_MAX_BYTES
      ) {
        break;
      }
      kept.push(name);
    }
    if (kept.length === 0) return "";
    return ` + ${kept.join(" + ")}`;
  } catch (err) {
    // Losing the note is not worth losing the entry, and never worth a throw
    // into the billing path that called this.
    logger.warn({ err, orderId }, "mwl: suppressed sibling suffix could not be built");
    return "";
  }
}
