/**
 * Partial-word doctor search — "abi" matches "DR.ABINASH KUMAR",
 * "ms jha" matches "ABHAY SINGH MS JHAJHA".
 * Each whitespace-separated query token must appear somewhere in the
 * haystack (name, specialization, or numeric id).
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
