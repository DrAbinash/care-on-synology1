/**
 * Name ± referring-doctor bill linking for clinics without MWL.
 *
 * Lane A (accession / UHID) stays authoritative when those keys exist.
 * Lane B ranks billed studies by patient name (+ referral when present),
 * same-day window, and modality — used for Match Center suggestions and
 * unique auto-link that must stay YELLOW (owner review), never GREEN.
 */
import {
  calculateMatchScore,
  nameSimilarity,
  referringDoctorSimilarity,
  type BilledTestInput,
  type DicomInput,
  type MatchResult,
} from "./matchingEngine";

/** Same floor as queue-token name match / high-confidence name points. */
export const NAME_REFERRAL_NAME_FLOOR = 0.85;
/** Partial name — suggestions only, never auto-link. */
export const NAME_REFERRAL_PARTIAL_FLOOR = 0.6;
/** Soft referring-doctor agreement when both sides have a doctor. */
export const NAME_REFERRAL_REF_SOFT = 0.7;
/** Hard doctor conflict: do not auto-link when both sides disagree this badly. */
export const NAME_REFERRAL_REF_CONFLICT = 0.5;
export const NAME_REFERRAL_SUGGEST_MIN_POINTS = 30;
/** Typical unique path: name 20 + modality 10 + date 10. */
export const NAME_REFERRAL_AUTO_MIN_POINTS = 40;
export const NAME_REFERRAL_AUTO_GAP = 15;
/** Suggestion / auto search window around DICOM study date (days). */
export const NAME_REFERRAL_SUGGEST_DAY_RADIUS = 2;
export const NAME_REFERRAL_AUTO_DAY_RADIUS = 1;

export type MatchLane = "id_keys" | "name_referral";

export type RankedBillCandidate = {
  studyId: number;
  points: number;
  score: "GREEN" | "YELLOW" | "RED";
  reasons: string[];
  warnings: string[];
  nameSimilarity: number;
  referringDoctorSimilarity: number;
  lane: MatchLane;
  /** Safe to show as a name±referral suggestion in Match Center. */
  suggestable: boolean;
  /** Eligible for unique auto-link (still capped to YELLOW after link). */
  autoLinkEligible: boolean;
};

export function classifyMatchLane(match: MatchResult): MatchLane {
  const hasIdKey = match.reasons.some(
    (r) =>
      r.includes("Accession number matches exactly") ||
      r.includes("Patient ID / UHID matches exactly") ||
      r.includes("Patient ID matches internal database ID"),
  );
  return hasIdKey ? "id_keys" : "name_referral";
}

/** DICOM YYYYMMDD / YYYY-MM-DD → YYYY-MM-DD, or null. */
export function normalizeStudyDateIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const iso = `${y}-${m}-${d}`;
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return iso;
}

export function addDaysIso(iso: string, days: number): string {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function studyDateSearchWindow(
  dicomStudyDate: string | null | undefined,
  radiusDays: number,
): { from: string; to: string } | null {
  const iso = normalizeStudyDateIso(dicomStudyDate);
  if (!iso) return null;
  return { from: addDaysIso(iso, -radiusDays), to: addDaysIso(iso, radiusDays) };
}

function hasModalityMismatch(warnings: string[]): boolean {
  return warnings.some((w) => w.startsWith("MODALITY_MISMATCH"));
}

function doctorConflict(
  dicomRef: string | null | undefined,
  billRef: string | null | undefined,
  refSim: number,
): boolean {
  return Boolean(dicomRef?.trim() && billRef?.trim() && refSim < NAME_REFERRAL_REF_CONFLICT);
}

/**
 * Score one billed study against DICOM intake and annotate Lane B flags.
 */
export function rankBillCandidate(
  dicom: DicomInput,
  bill: BilledTestInput,
): RankedBillCandidate {
  const match = calculateMatchScore(dicom, bill);
  const nameSim = nameSimilarity(dicom.patientName, bill.patientName);
  const refSim = referringDoctorSimilarity(dicom.referringDoctor, bill.referringDoctor);
  const lane = classifyMatchLane(match);
  const modalityBad = hasModalityMismatch(match.warnings);
  const conflict = doctorConflict(dicom.referringDoctor, bill.referringDoctor, refSim);

  const suggestable =
    !modalityBad &&
    nameSim >= NAME_REFERRAL_PARTIAL_FLOOR &&
    (nameSim >= NAME_REFERRAL_NAME_FLOOR ||
      refSim >= NAME_REFERRAL_REF_SOFT ||
      match.points >= NAME_REFERRAL_SUGGEST_MIN_POINTS);

  const autoLinkEligible =
    !modalityBad &&
    !conflict &&
    nameSim >= NAME_REFERRAL_NAME_FLOOR &&
    match.points >= NAME_REFERRAL_AUTO_MIN_POINTS &&
    match.score !== "RED";

  return {
    studyId: bill.id,
    points: match.points,
    score: match.score,
    reasons: match.reasons,
    warnings: match.warnings,
    nameSimilarity: nameSim,
    referringDoctorSimilarity: refSim,
    lane,
    suggestable,
    autoLinkEligible,
  };
}

export function pickNameReferralSuggestions(
  ranked: RankedBillCandidate[],
  limit = 5,
): RankedBillCandidate[] {
  return [...ranked]
    .filter((c) => c.suggestable && c.lane === "name_referral")
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.nameSimilarity !== a.nameSimilarity) return b.nameSimilarity - a.nameSimilarity;
      return b.referringDoctorSimilarity - a.referringDoctorSimilarity;
    })
    .slice(0, limit);
}

/**
 * Unique strong name±referral winner for auto-link.
 * Always treat result as YELLOW-tier method (caller persists PENDING review).
 */
export function selectUniqueNameReferralAutoLink(
  ranked: RankedBillCandidate[],
  minGap = NAME_REFERRAL_AUTO_GAP,
): RankedBillCandidate | null {
  const eligible = ranked
    .filter((c) => c.autoLinkEligible)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.nameSimilarity - a.nameSimilarity;
    });
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0]!;
  const top = eligible[0]!;
  const second = eligible[1]!;
  if (top.points - second.points >= minGap) return top;
  // Ambiguous same-name pile — owner must pick.
  return null;
}

/** Cap any auto name-referral outcome to YELLOW for Match Center review. */
export function capNameReferralAutoScore(
  score: "GREEN" | "YELLOW" | "RED",
): "GREEN" | "YELLOW" | "RED" {
  if (score === "GREEN") return "YELLOW";
  return score;
}
