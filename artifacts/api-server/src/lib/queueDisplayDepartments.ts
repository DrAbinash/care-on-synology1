/**
 * Resolve which test-token departments a queue-display TV should show.
 *
 * Tokens are tagged with tests.department (e.g. "USG", "MRI", "X-Ray").
 * Each TV is configured by roomKey (e.g. "usg", "mri"). When the
 * departments column is left blank the display feed shows every department —
 * which is why MRI tokens were appearing on the USG TV.
 *
 * Canonical modality rooms (usg, mri, ct, …) also self-heal legacy rows that
 * stored foreign imaging departments without the room's own department
 * (e.g. roomKey "usg" + departments "MRI,CT"). Intentional multi-department
 * displays that include the room's own department (e.g. "USG,MRI") are kept.
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

export type DepartmentSelfHeal = {
  /** Persist + use the inferred single department instead of configured value. */
  heal: boolean;
  target: string | null;
  reason: "blank" | "legacy_foreign_only" | null;
};

/**
 * Detect legacy/accidental department config on a modality-specific TV.
 *
 * Heal when:
 *  - departments blank on a modality room (old "show everything" bug), OR
 *  - departments omit the room's own modality (e.g. usg → "MRI,CT")
 *
 * Do NOT heal when:
 *  - reception / unknown rooms (multi-dept by design when blank), OR
 *  - configured list already includes the inferred department (intentional
 *    multi-department display, e.g. "USG,MRI" on the USG TV)
 */
export function shouldSelfHealModalityRoomDepartments(
  roomKey: string,
  configured: string | null | undefined,
): DepartmentSelfHeal {
  const inferred = inferDepartmentFromRoomKey(roomKey);
  if (!inferred) {
    return { heal: false, target: null, reason: null };
  }

  const explicit = parseConfiguredDepartments(configured);
  if (explicit.length === 0) {
    return { heal: true, target: inferred, reason: "blank" };
  }

  if (explicit.includes(inferred)) {
    return { heal: false, target: null, reason: null };
  }

  // Room's own department missing — treat as legacy accidental override.
  return { heal: true, target: inferred, reason: "legacy_foreign_only" };
}

/**
 * Effective departments for queue filtering.
 * Applies legacy self-heal for modality rooms; otherwise explicit config wins;
 * blank + known roomKey falls back to inference so /queue/usg never silently
 * shows MRI/CT tokens.
 */
export function resolveQueueDisplayDepartments(
  roomKey: string,
  configured: string | null | undefined,
): string[] {
  const selfHeal = shouldSelfHealModalityRoomDepartments(roomKey, configured);
  if (selfHeal.heal && selfHeal.target) {
    return [selfHeal.target];
  }

  const explicit = parseConfiguredDepartments(configured);
  if (explicit.length > 0) return explicit;

  const inferred = inferDepartmentFromRoomKey(roomKey);
  return inferred ? [inferred] : [];
}
