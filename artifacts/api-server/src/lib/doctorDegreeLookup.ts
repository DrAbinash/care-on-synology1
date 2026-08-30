/**
 * Settings → Doctors master helpers for report print (REF. BY + signature degree).
 */

function nameKey(raw: string): string {
  return raw.toLowerCase().replace(/^dr\.?\s*/i, "").replace(/[^a-z]/g, "");
}

function stripDegreeTokens(raw: string): string {
  return String(raw ?? "").replace(/\b(md|mbbs|ms|mch|m\.ch|dnb|dm|frcr|frcs|frcp|mrcp|dmrd|fcps)\b/gi, " ");
}

export type DoctorDegreeRow = { name: string; degree?: string | null };

/** Unique name match → Settings → Doctors.degree (full string, not re-parsed). */
export function resolveDoctorDegreeFromRows(
  name: string,
  doctors: DoctorDegreeRow[] | null | undefined,
): string {
  const key = nameKey(stripDegreeTokens(name));
  if (!key || key.length < 3 || !doctors?.length) return "";
  const matches = doctors.filter((d) => {
    const k = nameKey(stripDegreeTokens(d.name));
    return k && (k === key || k.startsWith(key) || key.startsWith(k) || k.includes(key) || key.includes(k));
  });
  // Prefer exact, then unique fuzzy.
  const exact = matches.filter((d) => nameKey(stripDegreeTokens(d.name)) === key);
  const pool = exact.length === 1 ? exact : matches.length === 1 ? matches : [];
  if (pool.length !== 1) return "";
  return String(pool[0]!.degree ?? "").replace(/\s+/g, " ").trim();
}

/** Append Settings → Doctors.degree onto a referring-doctor display string. */
export function enrichReferringDoctorWithDegree(
  current: string,
  doctors: DoctorDegreeRow[] | null | undefined,
): string {
  const cur = String(current ?? "").trim();
  if (!cur || !doctors?.length) return cur;
  const degree = resolveDoctorDegreeFromRows(cur, doctors);
  if (!degree) return cur;
  const hay = cur.toLowerCase();
  if (hay.includes(degree.toLowerCase())) return cur;
  const tokens = degree.split(/[\s,;/]+/).filter((t) => t.length > 1);
  if (tokens.length > 0 && tokens.every((t) => hay.includes(t.toLowerCase()))) return cur;
  return `${cur.replace(/,?\s*$/, "")}, ${degree}`;
}

/** Collapse "A d e t a i l e d" → "Adetailed" (spaced-out letter storage). */
export function collapseSpacedOutLetters(raw: string): string {
  return String(raw ?? "")
    .split("\n")
    .map((line) =>
      line
        .split(/ {2,}/)
        .map((chunk) => {
          const t = chunk.trim();
          if (!t) return "";
          const m = /^(?:[A-Za-z0-9]\s)+[A-Za-z0-9]([.,;:!?]*)$/.exec(t);
          if (m) {
            const punct = m[1] ?? "";
            return t.slice(0, t.length - punct.length).replace(/\s+/g, "") + punct;
          }
          return chunk;
        })
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}
