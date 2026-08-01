/**
 * Partial-word doctor search — "abi" matches "DR.ABINASH KUMAR",
 * "ms jha" matches "ABHAY SINGH MS JHAJHA".
 */
export function doctorMatchesQuery(
  doctor: { id: number; name: string; specialization?: string | null },
  query: string,
): boolean {
  const tokens = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = [
    doctor.name,
    doctor.specialization ?? "",
    String(doctor.id),
    `#${doctor.id}`,
  ]
    .join(" ")
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

/** Normalize labels for commission rule ↔ test name fallback matching. */
export function normalizeLabel(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
