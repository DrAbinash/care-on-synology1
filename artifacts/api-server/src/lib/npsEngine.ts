// Pure, DB-free NPS helpers. Unit-tested. No I/O.

export type NpsCategory = "promoter" | "passive" | "detractor";

/** Standard NPS bucketing: 9–10 promoter, 7–8 passive, 0–6 detractor. */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/** Is a raw NPS score in the valid 0–10 range (integer)? */
export function isValidNps(score: unknown): score is number {
  return typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 10;
}

/**
 * Net Promoter Score = %promoters − %detractors, rounded to an integer in
 * [-100, 100]. Empty input → 0.
 */
export function calcNps(scores: number[]): number {
  if (!scores.length) return 0;
  let promoters = 0, detractors = 0;
  for (const s of scores) {
    const c = npsCategory(s);
    if (c === "promoter") promoters++;
    else if (c === "detractor") detractors++;
  }
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

/** Full breakdown for a dashboard. */
export function npsBreakdown(scores: number[]): { nps: number; promoters: number; passives: number; detractors: number; total: number } {
  let promoters = 0, passives = 0, detractors = 0;
  for (const s of scores) {
    const c = npsCategory(s);
    if (c === "promoter") promoters++;
    else if (c === "passive") passives++;
    else detractors++;
  }
  return { nps: calcNps(scores), promoters, passives, detractors, total: scores.length };
}
