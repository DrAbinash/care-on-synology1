/** Shared Billing Desk / Online Booking quick-select slot layout (tests & doctors). */

export const QUICK_SELECT_SLOT_COUNT = 12;

/** Three rows of four on sm+; two columns on narrow screens. */
export const QUICK_SELECT_GRID_CLASS = "grid grid-cols-2 sm:grid-cols-4 gap-1.5";

export function parseQuickSelectIds(raw: string | undefined | null): (number | null)[] {
  try {
    const arr = JSON.parse(raw ?? "[]");
    const out: (number | null)[] = Array.isArray(arr)
      ? arr.slice(0, QUICK_SELECT_SLOT_COUNT).map((v: unknown) => (typeof v === "number" ? v : null))
      : [];
    while (out.length < QUICK_SELECT_SLOT_COUNT) out.push(null);
    return out;
  } catch {
    return Array.from({ length: QUICK_SELECT_SLOT_COUNT }, () => null);
  }
}

export function emptyQuickSelectIds(): (number | null)[] {
  return Array.from({ length: QUICK_SELECT_SLOT_COUNT }, () => null);
}
