/**
 * Identity keys for DICOM intake, with no database in sight so the safety rule
 * is the part under test. `dicomPatientCreator.ts` fetches; this decides.
 */

/**
 * Words that are not a name. The patient master holds placeholder rows created
 * by an older build for every unseen scanner id — first_name "Unknown", UHID
 * copied from the machine — so a scan that also failed to record a name would
 * otherwise match one of them and inherit a stranger's identity.
 */
const IDENTITY_STOP_WORDS = new Set(["unknown"]);

/** Tokens for identity comparison; null when there is nothing to compare. */
function nameTokens(raw: string | null | undefined): Set<string> | null {
  const toks = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return toks.length ? new Set(toks) : null;
}

/**
 * Same words, any order. Consoles flatten `Last^First` and reception types
 * `First Last`, so order is not evidence of a different person. Word counts
 * must match, which is what keeps `Reena` from claiming `Reena Kumari`.
 */
export function nameSetsAgree(
  dicomName: string | null | undefined,
  patientName: string | null | undefined,
): boolean {
  const a = nameTokens(dicomName);
  const b = nameTokens(patientName);
  if (!a || !b || a.size !== b.size) return false;
  for (const t of a) {
    if (IDENTITY_STOP_WORDS.has(t) || !b.has(t)) return false;
  }
  return true;
}

type IdentityRow = { firstName: string; lastName: string };

/**
 * A number that resolves to two patients, or to one patient whose name
 * contradicts the scan, identifies nobody.
 *
 * The name check is not decoration. Measured on this clinic's unlinked rows:
 * of the 1,725 whose scanner number resolves to one patient, 715 also agree on
 * the name and 712 of those were billed that same day; of the 1,010 that
 * disagree on the name only 202 were billed that day. So the disagreeing
 * matches are overwhelmingly other people's numbers landing on a real UHID by
 * coincidence — linking on the number alone would have reported scans under a
 * stranger's name roughly 800 times.
 */
export function pickUhidMatchedPatient<T extends IdentityRow>(
  rows: T[],
  dicomName: string | null | undefined,
): T | null {
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  return nameSetsAgree(dicomName, `${row.firstName} ${row.lastName}`) ? row : null;
}

/**
 * The UHIDs a scanner may be sending us for one patient.
 *
 * Consoles take the UHID off the requisition and often cannot carry the "P-"
 * prefix, so the number that arrives as `12332` is our `P-12332`. Every
 * spelling is offered as a candidate rather than normalising one side, so the
 * lookup stays on the unique `patients.patient_id` index.
 */
export function uhidLookupCandidates(raw: string | null | undefined): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  const out = new Set<string>([trimmed]);
  const bare = trimmed.replace(/^P-/i, "");
  if (!bare) return [...out];
  out.add(bare);
  out.add(`P-${bare}`);
  if (/^[0-9]+$/.test(bare)) {
    const digits = bare.replace(/^0+/, "") || "0";
    out.add(digits);
    out.add(`P-${digits}`);
    out.add(`P-${digits.padStart(5, "0")}`);
  }
  return [...out];
}
