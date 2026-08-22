import { nameSimilarity } from "./matchingEngine";

export type QueueTokenCandidate = {
  id: number;
  status: string;
  ledgerId: number | null;
  department: string;
  tokenNo: number;
  patientFirstName: string | null;
  patientLastName: string | null;
};

/** Same 0.85 floor as billing match engine name scoring. */
export const QUEUE_TOKEN_NAME_MATCH_THRESHOLD = 0.85;

/**
 * Pick the best waiting/serving token whose billed patient name matches DICOM PN.
 * Prefers serving, then lowest token number.
 */
export function pickTokenCandidateByDicomName(
  dicomPatientName: string,
  candidates: QueueTokenCandidate[],
): QueueTokenCandidate | undefined {
  const dicom = (dicomPatientName ?? "").trim();
  if (!dicom) return undefined;

  const matched = candidates.filter((c) => {
    const erpName = `${c.patientFirstName ?? ""} ${c.patientLastName ?? ""}`.trim();
    if (!erpName) return false;
    return nameSimilarity(dicom, erpName) >= QUEUE_TOKEN_NAME_MATCH_THRESHOLD;
  });
  if (!matched.length) return undefined;

  matched.sort((a, b) => {
    const sa = a.status === "serving" ? 0 : 1;
    const sb = b.status === "serving" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.tokenNo - b.tokenNo;
  });
  return matched[0];
}
