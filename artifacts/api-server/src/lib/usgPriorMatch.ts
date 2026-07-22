/**
 * usgPriorMatch — canonical prior-study matching (P4.1).
 *
 * Selects comparable prior studies using CANONICAL identifiers. Cross-patient
 * comparison is impossible by construction: a candidate is discarded unless its
 * canonical patientId equals the current study's. Pure + testable.
 */

export interface StudyRef {
  studyInstanceUID: string;
  patientId: number;                    // canonical patient id — REQUIRED
  patientCrosswalkId?: string | null;   // canonical crosswalk id, when available
  modality: string;
  studyType?: string | null;            // study description
  bodyRegion?: string | null;
  accessionNumber?: string | null;
  studyDate?: string | null;            // YYYYMMDD or ISO
  reportStatus?: string | null;         // e.g. "final" / "verified"
  pregnancyEpisodeId?: string | null;
}

export interface PriorMatchOptions {
  sameModalityOnly?: boolean;
  sameRegion?: boolean;
  finalOnly?: boolean;
  samePregnancyEpisode?: boolean;
  maxResults?: number;
}

export interface PriorMatch {
  study: StudyRef;
  score: number;
  intervalDays: number | null;   // current − prior (positive = prior is older)
  reasons: string[];
}

/** Parse YYYYMMDD or ISO into epoch ms, or null. */
export function parseStudyDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const s = d.trim();
  const ymd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) return Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]);
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

function daysBetween(aMs: number | null, bMs: number | null): number | null {
  if (aMs == null || bMs == null) return null;
  return Math.round((aMs - bMs) / 86_400_000);
}

const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
const FINAL = new Set(["final", "verified", "report_final", "delivered", "signed"]);

/**
 * Rank comparable priors for a current study. Guarantees: same canonical
 * patient only; the current study is never its own prior; priors must be at or
 * before the current date when both dates are known.
 */
export function matchPriorStudies(
  current: StudyRef,
  candidates: StudyRef[],
  opts: PriorMatchOptions = {},
): PriorMatch[] {
  const curMs = parseStudyDate(current.studyDate);
  const out: PriorMatch[] = [];

  for (const c of candidates) {
    // Hard cross-patient guard.
    if (c.patientId !== current.patientId) continue;
    if (current.patientCrosswalkId && c.patientCrosswalkId && current.patientCrosswalkId !== c.patientCrosswalkId) continue;
    if (c.studyInstanceUID === current.studyInstanceUID) continue; // not itself

    const cMs = parseStudyDate(c.studyDate);
    // A prior cannot be in the future relative to the current study.
    if (curMs != null && cMs != null && cMs > curMs) continue;

    const sameModality = norm(c.modality) === norm(current.modality);
    if (opts.sameModalityOnly && !sameModality) continue;

    const sameRegion = norm(c.bodyRegion || c.studyType) === norm(current.bodyRegion || current.studyType);
    if (opts.sameRegion && !sameRegion) continue;

    const isFinal = FINAL.has(norm(c.reportStatus));
    if (opts.finalOnly && !isFinal) continue;

    const sameEpisode = !!current.pregnancyEpisodeId && current.pregnancyEpisodeId === c.pregnancyEpisodeId;
    if (opts.samePregnancyEpisode && !sameEpisode) continue;

    const reasons: string[] = [];
    let score = 0;
    if (sameModality) { score += 3; reasons.push("same modality"); }
    if (sameRegion) { score += 3; reasons.push("same region"); }
    if (isFinal) { score += 2; reasons.push("final report"); }
    if (sameEpisode) { score += 4; reasons.push("same pregnancy episode"); }
    if (c.accessionNumber && c.accessionNumber === current.accessionNumber) { score += 1; reasons.push("same accession"); }

    out.push({ study: c, score, intervalDays: daysBetween(curMs, cMs), reasons });
  }

  // Most relevant first: score desc, then most-recent prior first.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ai = a.intervalDays ?? Number.MAX_SAFE_INTEGER;
    const bi = b.intervalDays ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });

  return typeof opts.maxResults === "number" ? out.slice(0, opts.maxResults) : out;
}
