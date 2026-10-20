/**
 * Which signature block a report surface prints, chosen from configuration only.
 *
 * The `signatures` table is the clinic's own list of the people who sign reports,
 * maintained in Report Hub → Signatures: printed name, role, qualification,
 * registration number and an uploaded image. Selecting from it by matching a
 * person's NAME against a regular expression breaks the day a second radiologist is
 * added — their block would exist, be active, be correctly configured, and still
 * never print, because the match was written for one human being. So this picks
 * structurally: the active block whose Role is Radiologist, and if the clinic has
 * configured no such role, the first block in the same order the Signatures list
 * shows them (name, ascending — which is what `patient-reports.ts:1271` returns).
 *
 * Four things are kept apart here because they are four different facts on paper:
 *
 *   name              the printed person — never invented, only ever a record
 *   qualification     what that person typed in Signatures settings; the doctors
 *                     catalogue is a fallback for a block saved with the field empty,
 *                     not an override of a block that has it
 *   imageDataUrl      the hand-signed image they uploaded; absent means no image is
 *                     drawn, and nothing is drawn in its place
 *   authorization     who actually signed a report — `patient_reports.signatureId`,
 *                     resolved by the final print path and deliberately NOT decided
 *                     here. This module only ever answers "what should a preview
 *                     show", never "is this report signed".
 */

export interface SignerRecord {
  name: string;
  role: string | null;
  qualification: string | null;
  registrationNo: string | null;
  imageDataUrl: string | null;
}

export interface PrintedSigner {
  name: string;
  qualification: string | null;
  role: string | null;
  registrationNo: string | null;
  imageDataUrl: string | null;
}

/** The role string the Signatures dialog offers (ReportHub.tsx:1313-1316). */
const RADIOLOGIST_ROLE = "Radiologist";

/**
 * The block to print, or null when the clinic has configured none. Null is a real
 * answer and callers must honour it by printing no signer: a preview of an unsigned
 * draft that names a person who was never configured is an invented attribution on a
 * clinical document, which is the thing this function exists to prevent.
 */
export function pickSignerRecord(rows: readonly SignerRecord[]): SignerRecord | null {
  const ordered = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return ordered.find((r) => r.role === RADIOLOGIST_ROLE) ?? ordered[0] ?? null;
}

/**
 * The record shaped for the page. `degreeFallbackFor` is consulted only when the
 * block itself carries no qualification, so a configured value is never overwritten
 * by a name lookup elsewhere.
 */
export function printSigner(
  rows: readonly SignerRecord[],
  degreeFallbackFor?: (name: string) => string | null,
): PrintedSigner | null {
  const sig = pickSignerRecord(rows);
  if (!sig) return null;
  const configured = String(sig.qualification ?? "").trim();
  return {
    name: sig.name,
    qualification: configured || String(degreeFallbackFor?.(sig.name) ?? "").trim() || null,
    role: sig.role || null,
    registrationNo: String(sig.registrationNo ?? "").trim() || null,
    imageDataUrl: String(sig.imageDataUrl ?? "").trim() || null,
  };
}
