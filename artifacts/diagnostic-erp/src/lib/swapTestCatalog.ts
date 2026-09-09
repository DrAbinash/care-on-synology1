/**
 * Pure helpers for the Change/Replace Test catalog picker on Bill Detail.
 * Keeps the full active catalog searchable by name or code (not a hard-coded
 * subset / non-searchable Select).
 */

export type SwapCatalogTest = {
  id: number;
  name: string;
  code?: string | null;
  price?: number | string | null;
  isActive?: boolean | null;
  category?: string | null;
};

export function filterSwapCatalogTests(
  tests: SwapCatalogTest[],
  opts: { search?: string; excludeTestId?: number | null } = {},
): SwapCatalogTest[] {
  const q = (opts.search ?? "").trim().toLowerCase();
  const exclude = opts.excludeTestId ?? null;

  return tests
    .filter((t) => t.isActive !== false)
    .filter((t) => (exclude == null ? true : t.id !== exclude))
    .filter((t) => {
      if (!q) return true;
      const name = (t.name ?? "").toLowerCase();
      const code = (t.code ?? "").toLowerCase();
      return name.includes(q) || code.includes(q);
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function formatSwapCatalogLabel(t: SwapCatalogTest): string {
  const code = t.code ? ` (${t.code})` : "";
  const price = Number(t.price ?? 0).toFixed(2);
  return `${t.name}${code} — ₹${price}`;
}
