/**
 * X-ray auto-link promotion — the owner's trial of a silent bill link.
 *
 * Every name±referral auto-link used to be capped to YELLOW so the Match Center
 * showed it for a person to confirm (`nameReferralLink.capNameReferralAutoScore`).
 * For X-ray the owner ruled on 7 Nov 2026 that the combination he calls
 * "name + body area + referring doctor" is strong enough to link without a human
 * step, so those rows are now written GREEN and leave the review queue.
 *
 * The promotion is deliberately narrower than the lane it sits in:
 *   - X-ray only (CR/DX). Ultrasound keeps the YELLOW cap byte-for-byte, and
 *     MR/CT never reach this lane at all (internal-radiology.ts gates them out).
 *   - Only the name lane. A row whose accession or UHID matched exactly is scored
 *     by those keys, not by a guess, and this module must not touch it.
 *   - Every leg must be *positive evidence*, not merely the absence of a
 *     contradiction: confident name, an agreeing referring doctor, the billed
 *     test name present in the arriving study description, same-day, same sex.
 *     An OCR description without a body area therefore scores nothing on that leg
 *     and stays YELLOW — the trial cannot silently downgrade to name-alone.
 *   - Uniqueness is inherited from `selectUniqueNameReferralAutoLink`: two
 *     same-name patients billed the same exam on the same day by the same
 *     referrer win equally, the gap rule refuses both, and nothing links.
 *
 * Kill switch and mode: pacs_settings `xray_name_area_referrer_auto_green`,
 * read live, so ending or widening the trial never needs a deploy:
 *   unset / "name-area"   → name + body area; the referrer is not required. THE
 *                            DEFAULT, chosen by the owner on 7 Nov 2026 after he
 *                            was shown that his three-leg rule fires on none of
 *                            his films. "true" / "referrer" gives the ruling
 *                            exactly as first given; "false" / "0" / "off" puts
 *                            every name-lane link back under a person.
 * The trial is still only live once this code is deployed, because deploying is
 * what changes the running matcher.
 *
 * MEASURED (production, 45 days to 7 Nov 2026, read-only psql):
 *   144 DX + 30 OT rows reached intake with no accession and no study_id.
 *   On the DX rows: patient name 144/144, study description 144/144, sex
 *   142/144, referring doctor 0/144. On the print forwards: referrer 2/30.
 *   So the three-leg rule as ruled fires on 0 rows of 174 until the film itself
 *   carries a referring physician — which the print-SCP can read off the header
 *   the same way it reads the exam, without ever touching PatientID or accession.
 */

import { isXrayModality } from "../clinicPeakHours";

/** Name floor for a silent link: above Lane B's 0.85 suggestion floor. */
export const XRAY_AUTO_GREEN_NAME_FLOOR = 0.9;
/** Referrer must agree, not just fail to conflict. */
export const XRAY_AUTO_GREEN_REFERRER_FLOOR = 0.85;

export const XRAY_AUTO_GREEN_SETTING_KEY = "xray_name_area_referrer_auto_green";

/** The ruling as given. Default. */
export type XrayAutoGreenMode = "referrer" | "name-area" | "off";
/** Links that reached a bill this way, so the trial is enumerable afterwards. */
export const XRAY_AUTO_GREEN_METHOD = "name-referral-xray-auto";

/**
 * Rule text as `calculateMatchScore` actually writes it (matchingEngine.ts).
 * The name and referrer legs are checked inside the mode branch because they
 * carry a similarity percentage and are the two legs the modes differ on.
 */
const REQUIRED_REASONS = [
  "Study description matches billing test name keywords",
  "Study date is within 24 hours of billing",
  "Gender matches",
] as const;

const ID_KEY_REASONS = [
  "Accession number matches exactly",
  "Patient ID / UHID matches exactly",
] as const;

/**
 * Warnings that contradict an identity claim outright. The accession warning is
 * excluded on purpose: an X-ray film carries no accession at all, so
 * "Accession number differs or is missing on one record" fires on every one of
 * them and would make the trial refuse its own subject.
 */
const CRITICAL_WARNING_PREFIXES = [
  "MODALITY_MISMATCH",
  "NAME_MISMATCH",
  "DATE_MISMATCH",
  "DUPLICATE_UID",
  "STUDY_REUSED",
  "BILL_LINKED_TO_MULTIPLE_STUDIES",
  "Gender mismatch",
  "Age mismatch",
  "Referring doctor name differs",
  "Patient name differs slightly",
] as const;

export type XrayAutoGreenEvidence = {
  modality: string | null | undefined;
  reasons: readonly string[];
  warnings: readonly string[];
  nameSimilarity: number;
  referringDoctorSimilarity: number;
};

function hasReason(reasons: readonly string[], entry: string): boolean {
  return reasons.some((r) => r === entry || r.startsWith(`${entry} (`));
}

/**
 * True when the arriving study and the billed test prove the same patient, the
 * same exam and the same referrer, on the same day, of the same sex.
 *
 * `name-area` mode drops only the referrer agreement — every other leg stays,
 * including the conflict veto in `warnings`, so a film that names a doctor who
 * disagrees with the bill's is still refused rather than linked quietly.
 *
 * Pure: no database, no clock. Callers persist what this returns, so the same
 * evidence must produce the same answer on every lane that asks.
 */
export function qualifiesForXrayAutoGreen(
  e: XrayAutoGreenEvidence,
  mode: XrayAutoGreenMode = "referrer",
): boolean {
  if (mode === "off") return false;
  if (!isXrayModality(e.modality)) return false;
  if (!Number.isFinite(e.nameSimilarity) || e.nameSimilarity < XRAY_AUTO_GREEN_NAME_FLOOR) {
    return false;
  }
  const reasons = e.reasons;
  // Lane A already proved identity with a work key; this module only speaks for
  // the name lane, and must not become a second authority over a keyed link.
  for (const idKey of ID_KEY_REASONS) {
    if (hasReason(reasons, idKey)) return false;
  }
  if (!reasons.some((r) => r.startsWith("Patient name matches confidently"))) return false;
  if (mode === "referrer") {
    if (!Number.isFinite(e.referringDoctorSimilarity)
      || e.referringDoctorSimilarity < XRAY_AUTO_GREEN_REFERRER_FLOOR) {
      return false;
    }
    if (!reasons.some((r) => r.startsWith("Referring doctor matches"))) return false;
  }
  for (const required of REQUIRED_REASONS) {
    if (!hasReason(reasons, required)) return false;
  }
  return !e.warnings.some((w) =>
    CRITICAL_WARNING_PREFIXES.some((bad) => w.startsWith(bad)),
  );
}

/**
 * Live mode. Unset means `name-area`, because that is the mode the owner chose
 * on 7 Nov 2026 when shown the films: his three-leg rule is available as
 * `true`, and `false` puts every link back under a person. Defaulting to the
 * mode he picked is what makes the trial actually run on the day this deploys —
 * a default that links nothing would need someone to know the key exists.
 *
 * `@workspace/db` is imported lazily so the rule above stays testable on a
 * machine with no database — its module scope throws without DATABASE_URL.
 */
export async function readXrayAutoGreenMode(): Promise<XrayAutoGreenMode> {
  try {
    const { db } = await import("@workspace/db");
    const { pacsSettingsTable } = await import("@workspace/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, XRAY_AUTO_GREEN_SETTING_KEY))
      .limit(1);
    const raw = (row?.value ?? "").trim().toLowerCase();
    if (raw === "false" || raw === "0" || raw === "off") return "off";
    if (raw === "true" || raw === "referrer" || raw === "1") return "referrer";
    return "name-area";
  } catch {
    // A settings read must not decide an identity: if the database cannot answer,
    // the conservative behaviour is the human-reviewed one, not the silent link.
    return "off";
  }
}
