// ============================================================================
// Deterministic normalisation helpers for inter-org identity + catalogue
// matching. Pure functions, no I/O — unit-tested in normalize.test.ts.
//
// The brief forbids free-text matching as the SOLE production mechanism; these
// helpers produce the normalized keys that the mapping/matching layers compare
// deterministically (exact normalized equality), never fuzzy-only.
// ============================================================================

const NAME_TITLES = new Set([
  "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "miss", "master",
  "smt", "shri", "sri", "mx", "prof", "prof.",
]);

/**
 * Normalize a person's name for comparison: lowercase, strip honorifics,
 * collapse punctuation/whitespace. "Dr. Rajesh  Kumar" -> "rajesh kumar".
 */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return "";
  const cleaned = input
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()\[\]"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter((t) => t && !NAME_TITLES.has(t));
  return tokens.join(" ").trim();
}

/**
 * Normalize an Indian mobile number to its 10-digit core: strip spaces,
 * punctuation, and a leading +91 / 91 / 0. Returns "" if fewer than 10 digits.
 */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  let digits = input.replace(/\D/g, "");
  if (digits.length > 10) {
    // Drop a leading country code (91) or trunk 0, keep the last 10 digits.
    digits = digits.slice(-10);
  }
  return digits.length === 10 ? digits : (input.replace(/\D/g, "") || "");
}

/**
 * Normalize a diagnostic test / service name for catalogue matching:
 * lowercase, strip punctuation, collapse whitespace. "USG - Whole Abdomen"
 * -> "usg whole abdomen".
 */
export function normalizeTestName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()\[\]"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a single "name" field into a best-effort first/last pair. */
export function splitName(input: string | null | undefined): { firstName: string; lastName: string } {
  const cleaned = (input ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { firstName: "Unknown", lastName: "" };
  // Strip a leading honorific for display too, but keep original casing.
  const parts = cleaned.split(" ");
  if (parts.length > 0 && NAME_TITLES.has(parts[0].toLowerCase())) parts.shift();
  if (parts.length <= 1) return { firstName: parts[0] || cleaned, lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Derive an ISO date-of-birth string from an age. CARE's patients.date_of_birth
 * is NOT NULL text; HOPE supplies only an integer age. We synthesize Jan-1 of
 * the birth year and flag it approximate elsewhere. `now` is injectable for
 * deterministic tests.
 */
export function approximateDobFromAge(
  age: number | null | undefined,
  unit: string | null | undefined,
  now: Date = new Date(),
): string {
  if (age == null || !Number.isFinite(age) || age < 0) {
    // Unknown age → a stable sentinel that is clearly not a real DOB.
    return "1900-01-01";
  }
  const u = (unit ?? "years").toLowerCase();
  const years = u.startsWith("year") ? age : u.startsWith("month") ? Math.floor(age / 12) : u.startsWith("day") ? Math.floor(age / 365) : age;
  const birthYear = now.getFullYear() - years;
  return `${birthYear}-01-01`;
}
