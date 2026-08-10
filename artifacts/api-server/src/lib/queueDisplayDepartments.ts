/**
 * Resolve which test-token departments a queue-display TV should show.
 *
 * Tokens are tagged with tests.department (e.g. "USG", "MRI", "X-Ray").
 * Each TV is configured by roomKey (e.g. "usg", "mri"). When the
 * departments column is left blank the display feed shows every department —
 * which is why MRI tokens were appearing on the USG TV.
 */

/** Longest-prefix-first so "x-ray" wins over "x". */
const ROOM_KEY_PREFIX_TO_DEPARTMENT: ReadonlyArray<[prefix: string, department: string]> = [
  ["x-ray", "X-Ray"],
  ["xray", "X-Ray"],
  ["cardiology", "Cardiology"],
  ["pathology", "Pathology"],
  ["pulmonology", "Pulmonology"],
  ["endoscopy", "Endoscopy"],
  ["procedure", "Procedure"],
  ["usg", "USG"],
  ["echo", "USG"],
  ["mri", "MRI"],
  ["ct", "CT"],
  ["ecg", "Cardiology"],
];

export function normalizeQueueDisplayRoomKey(roomKey: string): string {
  return roomKey.toLowerCase().replace(/-?room$/, "").trim();
}

/** Infer the token department for a TV room key, or null when unknown (e.g. reception). */
export function inferDepartmentFromRoomKey(roomKey: string): string | null {
  const key = normalizeQueueDisplayRoomKey(roomKey);
  if (!key || key === "reception") return null;

  for (const [prefix, department] of ROOM_KEY_PREFIX_TO_DEPARTMENT) {
    if (key === prefix || key.startsWith(`${prefix}-`) || key.startsWith(`${prefix}_`)) {
      return department;
    }
  }
  return null;
}

/** Parse configured comma-separated departments from queue_display_settings. */
export function parseConfiguredDepartments(configured: string | null | undefined): string[] {
  return (configured ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Effective departments for queue filtering.
 * Explicit config wins; otherwise infer from roomKey so /queue/usg never
 * silently shows MRI/CT tokens.
 */
export function resolveQueueDisplayDepartments(
  roomKey: string,
  configured: string | null | undefined,
): string[] {
  const explicit = parseConfiguredDepartments(configured);
  if (explicit.length > 0) return explicit;
  const inferred = inferDepartmentFromRoomKey(roomKey);
  return inferred ? [inferred] : [];
}
