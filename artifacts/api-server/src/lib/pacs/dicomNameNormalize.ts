/**
 * DICOM Person Name (PN) cleanup for Care radiology matching & display.
 *
 * MRI / Orthanc / Conquest typically send:
 *   SINGH^ABINASH^KUMAR^^^MD
 *   DR. SMITH^JOHN^^MD
 * while ERP bills store "Abinash Singh" / "Dr. John Smith".
 *
 * Matching must ignore carets, honorifics, degrees, and First/Last order.
 * Display can keep degrees cleanly at the end.
 */

/** Titles / honorifics stripped for comparison (not shown as "degrees"). */
export const NAME_TITLES = new Set([
  "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "miss", "master",
  "smt", "shri", "sri", "mx", "prof", "prof.", "sir", "lady",
]);

/**
 * Medical degrees / qualifications often stuffed into DICOM PN components
 * or trailing tokens. Stripped for match; preserved for display.
 */
export const DEGREE_TOKENS = new Set([
  "md", "mbbs", "ms", "dnb", "dm", "mch", "mchs", "m.ch", "m.ch.",
  "frcr", "frcs", "frcp", "mrcp", "mrcs", "dmr", "dmrd", "dmre",
  "dph", "phd", "bsc", "msc", "do", "dgo", "dlo", "da", "dvd",
  "fcps", "ficr", "fams", "fnb", "dip", "diploma",
  "radiologist", "consultant",
]);

function isDegreeToken(tok: string): boolean {
  const t = tok.toLowerCase().replace(/\./g, "");
  if (DEGREE_TOKENS.has(tok.toLowerCase()) || DEGREE_TOKENS.has(t)) return true;
  // Compact forms like "M.D." / "M.B.B.S."
  if (/^[a-z](\.[a-z])+\.?$/i.test(tok) && tok.replace(/\./g, "").length <= 6) return true;
  return false;
}

function isTitleToken(tok: string): boolean {
  return NAME_TITLES.has(tok.toLowerCase());
}

/** Split DICOM PN / free-text into raw tokens (carets → spaces). */
export function tokenizePersonName(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/\^+/g, " ")
    .replace(/[.,/#!$%&*;:{}=\-_`~()[\]"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Tokens used for similarity: no titles, no degrees, lowercase.
 * Order is preserved from the input (caller may also try reverse / sorted).
 */
export function nameTokensForMatch(raw: string | null | undefined): string[] {
  return tokenizePersonName(raw)
    .map((t) => t.toLowerCase())
    .filter((t) => !isTitleToken(t) && !isDegreeToken(t));
}

/**
 * Best-effort display form from DICOM PN:
 *   SINGH^ABINASH^^^MD  →  "Abinash Singh, MD"
 *   JOHN^SMITH          →  "John Smith"  (when 2 components look like Last^First)
 *
 * Heuristic: DICOM PN component 0 is Family Name, 1 is Given Name.
 * When we still have caret structure, reorder to Given Family and append degrees.
 */
export function formatDicomPersonNameForDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let given = "";
  let family = "";
  let middle = "";
  const degrees: string[] = [];

  if (trimmed.includes("^")) {
    const parts = trimmed.split("^").map((p) => p.trim());
    family = parts[0] || "";
    given = parts[1] || "";
    middle = parts[2] || "";
    // Components 3–4 are often prefix/suffix; also scan all for degrees.
    for (const p of parts) {
      for (const tok of tokenizePersonName(p)) {
        if (isDegreeToken(tok)) {
          const pretty = tok.toUpperCase().replace(/\.$/, "");
          if (!degrees.includes(pretty)) degrees.push(pretty);
        }
      }
    }
    // Drop degree-only middle
    if (middle && isDegreeToken(middle)) middle = "";
  } else {
    const toks = tokenizePersonName(trimmed);
    const nameParts: string[] = [];
    for (const tok of toks) {
      if (isDegreeToken(tok)) {
        const pretty = tok.toUpperCase().replace(/\.$/, "");
        if (!degrees.includes(pretty)) degrees.push(pretty);
      } else if (!isTitleToken(tok)) {
        nameParts.push(tok);
      }
    }
    if (nameParts.length >= 2) {
      // Ambiguous order without carets — keep as written (already space-separated).
      const core = nameParts.map(titleCaseWord).join(" ");
      return degrees.length ? `${core}, ${degrees.join(", ")}` : core;
    }
    given = nameParts[0] || "";
    family = nameParts[1] || "";
  }

  const core = [given, middle, family]
    .filter(Boolean)
    .map(titleCaseWord)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!core) {
    // Fallback: strip carets only
    return trimmed.replace(/\^+/g, " ").replace(/\s+/g, " ").trim();
  }
  return degrees.length ? `${core}, ${degrees.join(", ")}` : core;
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  if (w.length <= 2 && w === w.toUpperCase()) return w.toUpperCase(); // initials
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Compact alphanumeric key for a token list (order-sensitive).
 */
export function compactNameKey(tokens: string[]): string {
  return tokens.join("").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * All comparison keys for a person name (as-written, reversed, sorted tokens).
 * Handles MRI LAST FIRST vs ERP First Last without false NAME_MISMATCH.
 */
export function nameComparisonKeys(raw: string | null | undefined): string[] {
  const tokens = nameTokensForMatch(raw);
  if (!tokens.length) return [];
  const keys = new Set<string>();
  keys.add(compactNameKey(tokens));
  if (tokens.length >= 2) {
    keys.add(compactNameKey([...tokens].reverse()));
    keys.add(compactNameKey([...tokens].sort()));
    // First + Last only (drop middle)
    keys.add(compactNameKey([tokens[0], tokens[tokens.length - 1]]));
    keys.add(compactNameKey([tokens[tokens.length - 1], tokens[0]]));
  }
  return [...keys].filter(Boolean);
}
