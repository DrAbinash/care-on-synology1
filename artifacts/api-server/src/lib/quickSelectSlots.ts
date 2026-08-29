/** Shared Billing Desk / Online Booking quick-select slot layout (tests & doctors). */

export const QUICK_SELECT_SLOT_COUNT = 12;
export const QUICK_SELECT_LEGACY_SLOT_COUNT = 8;
export const QUICK_SELECT_MAX_PAYLOAD = 400;

export const DEFAULT_QUICK_SELECT_IDS = JSON.stringify(
  Array.from({ length: QUICK_SELECT_SLOT_COUNT }, () => null),
);

export function isValidQuickSelectIds(value: string): boolean {
  if (value.length > QUICK_SELECT_MAX_PAYLOAD) return false;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return false;
    if (
      parsed.length !== QUICK_SELECT_SLOT_COUNT &&
      parsed.length !== QUICK_SELECT_LEGACY_SLOT_COUNT
    ) {
      return false;
    }
    return parsed.every(
      (v) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0),
    );
  } catch {
    return false;
  }
}

/** Pad legacy 8-slot payloads to 12 so clients always render three rows of four. */
export function normalizeQuickSelectIdsJson(value: string | null | undefined): string {
  if (!value || !isValidQuickSelectIds(value)) return DEFAULT_QUICK_SELECT_IDS;
  try {
    const parsed = JSON.parse(value) as (number | null)[];
    const out = parsed.slice(0, QUICK_SELECT_SLOT_COUNT);
    while (out.length < QUICK_SELECT_SLOT_COUNT) out.push(null);
    return JSON.stringify(out);
  } catch {
    return DEFAULT_QUICK_SELECT_IDS;
  }
}
