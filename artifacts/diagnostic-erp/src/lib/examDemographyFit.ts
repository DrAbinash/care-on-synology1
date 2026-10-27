/**
 * examDemographyFit.ts — does the ordered exam fit the patient on file?
 *
 * The billing desk's classic silent errors: a prostate USG on a female
 * patient, a follicular study on a 70-yr-old, a bone-age X-ray on an adult,
 * "USG Pelvis (Female)" on a man. Each is one wrong click at registration or
 * one stale patient record — and each prints on a report nobody questions
 * until the radiologist reads the side of the page.
 *
 * This is the ONE catalog of sex-specific / age-typical exam knowledge for
 * the ERP. Deterministic string matching over the test NAME (microseconds,
 * zero model calls, no I/O). It is ADVISORY BY CONSTRUCTION: the check
 * returns warnings; only the caller decides to show them, and no save path
 * ever consults it — corrections and rare referrals must stay one click away.
 *
 * Precision rules:
 *   - WARN, never BLOCK (an odd referral is always possible);
 *   - ambiguity is silence — "cervical spine" is not the cervix, and
 *     mammography on a man is a legitimate workup, so neither warns;
 *   - one line per cart item — first matching rule speaks, never a wall;
 *   - missing sex only prompts when a sex-specific exam is in the cart.
 */

import { isSentinelDob } from "./age";

export type ExamDemographyWarningCode =
  | "sex_exam_mismatch"
  | "age_exam_mismatch"
  | "sex_missing_for_exam";

export interface ExamDemographyWarning {
  code: ExamDemographyWarningCode;
  /** The cart line item that triggered the warning. */
  testName: string;
  /** One human sentence for the amber block. */
  message: string;
}

export interface ExamDemographyPatient {
  /** "male"/"female" (ERP words) or "M"/"F" (DICOM letters). Anything else reads as unknown. */
  sex?: string | null;
  /** Stated age; strings accepted (the new-patient form keeps them as strings). */
  ageValue?: number | string | null;
  ageUnit?: string | null;
  /** `YYYY-MM-DD`; consulted only when no stated age exists. Sentinel DOB is blank. */
  dateOfBirth?: string | null;
}

type Sex = "male" | "female" | "";

const MAX_PLAUSIBLE_YEARS = 120;

const MALE_WORDS = new Set(["male", "m", "man", "boy", "gentleman"]);
const FEMALE_WORDS = new Set(["female", "f", "woman", "girl", "lady"]);

/** ERP words and DICOM letters → "male" | "female" | "" (unknown/undisclosed). */
export function normalizeSexForExamCheck(raw: string | null | undefined): Sex {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (MALE_WORDS.has(s)) return "male";
  if (FEMALE_WORDS.has(s)) return "female";
  return "";
}

/**
 * Stated age (with unit) → approximate years. A stated age is preferred over
 * the date of birth; the sentinel DOB (blank registration) is NOT an age.
 * Implausible values read as unknown — the check never argues with garbage,
 * it just declines to have an age opinion.
 */
function resolveAgeYears(patient: ExamDemographyPatient): number | null {
  const raw = patient.ageValue;
  const s = raw == null ? "" : String(raw).trim();
  if (s !== "") {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) {
      const unit = String(patient.ageUnit ?? "").trim().toLowerCase();
      const years = unit.startsWith("month") ? n / 12
        : unit.startsWith("day") ? n / 365.25
        : n; // years — also the sane default for a bare number
      return years > MAX_PLAUSIBLE_YEARS ? null : years;
    }
  }
  const dob = String(patient.dateOfBirth ?? "").trim();
  if (!dob || isSentinelDob(dob)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let y = now.getFullYear() - birth.getFullYear();
  const mo = now.getMonth() - birth.getMonth();
  if (mo < 0 || (mo === 0 && now.getDate() < birth.getDate())) y--;
  return y > 0 && y <= MAX_PLAUSIBLE_YEARS ? y : null;
}

interface ExamRule {
  /** Word-boundary, case-insensitive. One rule per clinical concept family. */
  re: RegExp;
  /** When set, the exam belongs to this sex. */
  sex?: "male" | "female";
  /** Inclusive age window (approximate years) for age-typical exams. */
  minAgeYears?: number;
  maxAgeYears?: number;
  /** "male-only" | "female-only" | "pediatric" — used in the message sentence. */
  label: string;
}

// "Cervical spine/canal/cord" is the NECK; cervix / cervical length /
// cervical biopsy is the cervix. The lookahead refuses to guess on the
// ambiguous words, so spine work never trips the female rule.
const CERVIX_RE = /\bcervix\b|\bcervical\b(?!\s*(?:spine|spinal|canal|vertebr\w*|cord|ribs?\b))/i;

// Follicular STUDY is the female workup; "follicular neoplasm/thyroid" is a
// cytology line that can belong to anyone. Guard the pathology words.
const FOLLICULAR_RE = /\bfollicul\w*\b(?!\s*(?:neoplasm|carcinoma|tumou?r|lesion|thyroid))/i;

const EXAM_RULES: readonly ExamRule[] = [
  // ── Male-only anatomy ──
  { re: /\bprostate\b/i, sex: "male", minAgeYears: 30, label: "male-only" },
  { re: /\bscrot(?:al|um)\b/i, sex: "male", label: "male-only" },
  { re: /\btestis\b|\btestes\b|\btesticular\b/i, sex: "male", label: "male-only" },
  { re: /\bepididym\w*\b/i, sex: "male", label: "male-only" },
  { re: /\bvaricocele\b/i, sex: "male", label: "male-only" },
  { re: /\bhydrocele\b/i, sex: "male", label: "male-only" },
  { re: /\bpeni(?:s|le)\b/i, sex: "male", label: "male-only" },
  { re: /\bseminal\b/i, sex: "male", label: "male-only" },
  { re: /\bsemen\b|\bsperm\w*\b/i, sex: "male", label: "male-only" },
  { re: /\btransrectal\b|\btrus\b/i, sex: "male", label: "male-only" },
  // Explicit variant in the name itself ("USG Pelvis (Male)", "Male Infertility Profile").
  // \bmale\b cannot match inside "female" — no word boundary before the m.
  { re: /\bmale\b/i, sex: "male", label: "male-only" },

  // ── Female-only anatomy / studies ──
  { re: /\buter(?:us|ine)\b/i, sex: "female", label: "female-only" },
  { re: /\bovar(?:y|ian)\b/i, sex: "female", label: "female-only" },
  { re: /\bendometr\w*\b/i, sex: "female", label: "female-only" },
  { re: CERVIX_RE, sex: "female", label: "female-only" },
  { re: /\bhydrosalpinx\b/i, sex: "female", label: "female-only" },
  { re: /\bhsg\b|hysterosalpingograph/i, sex: "female", minAgeYears: 10, maxAgeYears: 60, label: "female-only" },
  { re: /\bhysteroscop\w*\b/i, sex: "female", label: "female-only" },
  { re: FOLLICULAR_RE, sex: "female", minAgeYears: 10, maxAgeYears: 60, label: "female-only" },
  { re: /\bpregnan\w*\b/i, sex: "female", minAgeYears: 10, maxAgeYears: 60, label: "female-only" },
  { re: /\bobstetric\w*\b/i, sex: "female", minAgeYears: 10, maxAgeYears: 60, label: "female-only" },
  { re: /\bf(?:o|e)tus\b|\bf(?:o|e)tal\b/i, sex: "female", minAgeYears: 10, maxAgeYears: 60, label: "female-only" },
  { re: /\b(?:lscs|caesarean|cesarean)\b/i, sex: "female", minAgeYears: 10, maxAgeYears: 60, label: "female-only" },
  { re: /\btransvaginal\b|\btvs\b/i, sex: "female", label: "female-only" },
  { re: /\bpap\b|\bpapanicolaou\b/i, sex: "female", label: "female-only" },
  { re: /\b(?:iucd|iud)\b/i, sex: "female", label: "female-only" },
  // Explicit variant ("USG Pelvis (Female)", "Female Infertility Profile").
  { re: /\bfemale\b/i, sex: "female", label: "female-only" },

  // ── Age-typical, either sex ──
  { re: /\bbone\s*age\b/i, maxAgeYears: 18, label: "pediatric" },
];

function formatYears(years: number): string {
  return String(Math.round(years * 10) / 10);
}

function ageRangeText(rule: ExamRule): string {
  if (rule.minAgeYears != null && rule.maxAgeYears != null) {
    return `${rule.minAgeYears}–${rule.maxAgeYears}`;
  }
  return rule.minAgeYears != null ? `${rule.minAgeYears}+` : `up to ${rule.maxAgeYears}`;
}

function evaluateRule(
  testName: string,
  rule: ExamRule,
  sex: Sex,
  ageYears: number | null,
): ExamDemographyWarning | null {
  if (rule.sex) {
    if (!sex) {
      return {
        code: "sex_missing_for_exam",
        testName,
        message: `Sex not recorded for this patient — confirm before billing "${testName}" (a ${rule.label} exam).`,
      };
    }
    if (sex !== rule.sex) {
      return {
        code: "sex_exam_mismatch",
        testName,
        message: `"${testName}" is a ${rule.label} exam — patient is recorded ${sex}. Verify patient or exam.`,
      };
    }
  }
  if ((rule.minAgeYears != null || rule.maxAgeYears != null) && ageYears != null) {
    const tooYoung = rule.minAgeYears != null && ageYears < rule.minAgeYears;
    const tooOld = rule.maxAgeYears != null && ageYears > rule.maxAgeYears;
    if (tooYoung || tooOld) {
      return {
        code: "age_exam_mismatch",
        testName,
        message: `"${testName}" is typical for ages ${ageRangeText(rule)} yrs — patient is ${formatYears(ageYears)} yrs. Verify age or exam.`,
      };
    }
  }
  return null;
}

/**
 * Screen a cart of test names against the patient on file. Returns at most
 * one warning per line item (first matching rule wins): the cashier sees a
 * short list, never a wall. Pure function — render as an advisory, never a gate.
 */
export function checkExamDemographyFit(
  testNames: readonly (string | null | undefined)[],
  patient: ExamDemographyPatient | null | undefined,
): ExamDemographyWarning[] {
  if (!patient) return [];
  const sex = normalizeSexForExamCheck(patient.sex);
  const ageYears = resolveAgeYears(patient);
  const out: ExamDemographyWarning[] = [];
  for (const rawName of testNames) {
    const testName = String(rawName ?? "").trim();
    if (!testName) continue;
    for (const rule of EXAM_RULES) {
      if (!rule.re.test(testName)) continue;
      const warning = evaluateRule(testName, rule, sex, ageYears);
      if (warning) out.push(warning);
      break; // one line per cart item, whichever rule matched first
    }
  }
  return out;
}
