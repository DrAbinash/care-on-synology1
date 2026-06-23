// Tiny RFC-4180-ish CSV utilities shared by the catalog pages (Tests,
// Doctors, …). Kept small on purpose — we don't need the full
// papaparse feature surface for the simple flat tables the ERP
// imports/exports.

/**
 * Build a CSV string from row objects. Headers control both the column
 * order AND which fields are included.
 *
 * - Always uses \r\n line endings (Excel-friendly).
 * - Always prefixes a UTF-8 BOM so Excel opens it as UTF-8.
 * - Quotes any cell that contains comma, quote, or newline.
 */
export function buildCsv<T extends Record<string, unknown>>(headers: string[], rows: T[]): string {
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => headers.map((h) => escape(r[h])).join(",")).join("\r\n");
  return "\ufeff" + headers.join(",") + "\r\n" + body;
}

/** Trigger a browser download of the given CSV text. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parse a CSV string into row objects keyed by the header row. Uses a
 * small state machine so quoted fields with commas / embedded quotes /
 * newlines all work correctly.
 *
 * - Strips a leading UTF-8 BOM if present.
 * - Skips fully-empty trailing lines.
 * - Header names are trimmed.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { cur.push(field); field = ""; continue; }
    if (c === "\r") { continue; }
    if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; continue; }
    field += c;
  }
  // Trailing field (no terminating newline).
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((cell) => cell.trim().length > 0))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
      return obj;
    });
}
