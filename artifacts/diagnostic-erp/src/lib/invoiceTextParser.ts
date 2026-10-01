/**
 * Deterministic, regex-based parser turning raw OCR text (from the offline
 * Tesseract.js fallback — see PurchaseInvoiceScannerPanel.tsx) into the same
 * shape the Gemini-based /api/purchase-invoices/scan endpoint returns
 * (header fields + line items), so both paths feed the same review UI.
 *
 * This is inherently less reliable than Gemini's semantic extraction — raw
 * OCR text has no notion of "this is the vendor name" or "this is a line
 * item row", only characters and line breaks. Every field here is a
 * best-effort guess the staff reviews and can correct before saving; nothing
 * from this parser is ever auto-posted.
 *
 * Tuned and tested against REAL Tesseract.js output (not hand-typed
 * approximations) — see invoiceTextParser.test.ts's "real Tesseract output"
 * fixture, captured by actually running tesseract.js against a synthetic
 * invoice image in a throwaway sandbox.
 */

export interface ParsedLineItem {
  description: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface ParsedInvoice {
  vendor: string;
  invoiceNumber: string;
  date: string; // YYYY-MM-DD, or "" if not found
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  lineItems: ParsedLineItem[];
}

/** Matches a token that IS a number, start to end (not just contains one) —
 *  used to pick out the trailing quantity/cost/total columns of a line-item
 *  row without also matching digits embedded in the description itself
 *  (a dosage like "500mg" or packaging like "10x10" must NOT be mistaken
 *  for a standalone number). */
const STANDALONE_NUMBER_RE = /^-?[\d,]+\.?\d*$/;

function parseNumber(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Label-to-figure separator as Tesseract actually renders it on Indian bills:
 *  "Date :- 01/10/2026", "Total : - 950.00". A single optional `:` or `-`
 *  matched none of those, so no real phone scan ever yielded a date. */
const SEP = "[\\s:.\\-]*";

/** Words that sit between the label and the figure: "Total Pes Rs. 950,00",
 *  "Grand Total (INR) 14500.00". Bounded so it cannot reach across a line. */
const GAP = "[^\\d\\n]{0,24}?";

/**
 * Normalise a captured money token. Tesseract keeps the comma both as an
 * Indian thousands separator ("1,45,000") and, on bills printed with a comma
 * decimal, as the decimal point ("950,00" for ₹950). A dot in the token is
 * decisive: then commas can only be grouping.
 */
export function normaliseMoney(raw: string): number {
  const s = raw.trim();
  if (s.includes(".")) return parseNumber(s.replace(/,/g, ""));
  const commaDecimal = s.match(/^([\d,]+),(\d{2})$/);
  if (commaDecimal) return parseNumber(`${commaDecimal[1]}.${commaDecimal[2]}`);
  return parseNumber(s);
}

/**
 * Reject shapes that are not money. An 8+ digit run with no decimal is a
 * serial, phone or GSTIN — exactly what "05072000 — Total 06.08" was, where
 * the leading token is an item serial and 06.08 is not the bill total.
 */
function isMoneyShape(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return /\.\d{1,2}$/.test(raw) || digits.length <= 7;
}

/**
 * Best figure for a total-like keyword across the whole document.
 *
 * Takes the largest valid candidate rather than the first, because a scan
 * routinely contains both the real total and a stray small number next to the
 * word "Total" (a per-line total, a serial). For a bill the largest total-like
 * figure is the amount payable, and a miss is safe — staff type the number —
 * while a wrong one is prefilled into a financial field at 70% confidence.
 */
function moneyValue(lines: string[], keyword: RegExp): number {
  let best = 0;
  for (const line of lines) {
    // "(18%)" would otherwise be read as the GST amount by the gap matcher.
    const bare = line.replace(/\([^)]*\)/g, " ");
    const m = bare.match(new RegExp(`${keyword.source}${GAP}([\\d,]+(?:\\.\\d{1,2})?)`, "i"));
    if (!m) continue;
    if (!isMoneyShape(m[1])) continue;
    const value = normaliseMoney(m[1]);
    if (value > best) best = value;
  }
  return best;
}

/** Find the first line matching `re` and return its capture group 1, or "". */
function findField(lines: string[], re: RegExp): string {
  for (const line of lines) {
    const m = line.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

/** Normalize a DD-MM-YYYY / DD/MM/YYYY / YYYY-MM-DD date string to YYYY-MM-DD.
 *  Indian invoices are conventionally day-first — matches the DD-MM-YYYY
 *  convention already used elsewhere in this codebase (e.g. bank-statement
 *  CSV placeholders in Accounting.tsx). Returns "" if unparseable. */
export function normalizeInvoiceDate(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!dmy) return "";
  let [, d, m, y] = dmy;
  if (y.length === 2) y = `20${y}`;
  const day = d.padStart(2, "0");
  const month = m.padStart(2, "0");
  if (Number(day) > 31 || Number(month) > 12) return "";
  return `${y}-${month}-${day}`;
}

const LINE_ITEM_HEADER_RE = /description/i;
const LINE_ITEM_STOP_RE = /subtotal|grand\s*total|\btotal\b|\bgst\b|\btax\b/i;

function parseLineItems(lines: string[]): ParsedLineItem[] {
  const headerIdx = lines.findIndex((l) => LINE_ITEM_HEADER_RE.test(l) && /qty|quantity/i.test(l));
  if (headerIdx === -1) return [];

  const items: ParsedLineItem[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (LINE_ITEM_STOP_RE.test(line)) break;

    // Walk tokens from the end, collecting up to 3 that are standalone
    // numbers (the qty/rate/amount columns) — stop at the first token that
    // isn't purely numeric, so "10x10" (packaging) or "500mg" (dosage) stay
    // part of the description instead of being misread as data columns.
    const tokens = line.split(/\s+/);
    const trailingNumbers: number[] = [];
    let cut = tokens.length;
    for (let j = tokens.length - 1; j >= 0 && trailingNumbers.length < 3; j--) {
      if (!STANDALONE_NUMBER_RE.test(tokens[j])) break;
      trailingNumbers.unshift(parseNumber(tokens[j]));
      cut = j;
    }
    if (trailingNumbers.length === 0) continue; // not an item row (e.g. a wrapped description continuation)

    const description = tokens.slice(0, cut).join(" ").trim();
    if (!description) continue;

    if (trailingNumbers.length >= 3) {
      const [quantity, unitCost, lineTotal] = trailingNumbers.slice(-3);
      items.push({ description, quantity, unitCost, lineTotal });
    } else if (trailingNumbers.length === 2) {
      const [quantity, lineTotal] = trailingNumbers;
      items.push({ description, quantity, unitCost: quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : 0, lineTotal });
    } else {
      const amount = trailingNumbers[0];
      items.push({ description, quantity: 1, unitCost: amount, lineTotal: amount });
    }
  }
  return items;
}

/** A letterhead has to look like a name: a 4+ letter word and mostly letters.
 *  Phone scans put rules and debris first ("—mm— eT", "fra EES"), and a
 *  garbage vendor is worse than none — the form shows "Bill from <noise>"
 *  as though the document had been read. */
function looksLikeName(line: string): boolean {
  const letters = line.match(/[A-Za-z]/g)?.length ?? 0;
  return /[A-Za-z]{4}/.test(line) && letters / line.length > 0.6;
}

const DOCUMENT_TITLE_PREFIX = /^(?:tax\s+)?(?:invoice|bill|receipt|memo|cash\s+memo)\b/i;

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Vendor: the letterhead is conventionally the first line. Skip past a
  // generic document-title line ("TAX INVOICE", "INVOICE") if that's what
  // OCR happened to put first.
  const vendor = lines.find((l) => !DOCUMENT_TITLE_PREFIX.test(l) && looksLikeName(l)) ?? "";

  const invoiceNumber = findField(lines, new RegExp(`invoice\\s*(?:no\\.?|number|#)${SEP}([A-Za-z0-9][A-Za-z0-9\\-/]*)`, "i"))
    || findField(lines, new RegExp(`bill\\s*(?:no\\.?|number|#)${SEP}([A-Za-z0-9][A-Za-z0-9\\-/]*)`, "i"));

  const rawDate = findField(lines, new RegExp(`invoice\\s*date${SEP}(\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, "i"))
    || findField(lines, new RegExp(`\\bdate${SEP}(\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, "i"));
  const date = rawDate ? normalizeInvoiceDate(rawDate) : "";

  const subtotal = moneyValue(lines, /\bsubtotal\b/);
  const gstAmount = moneyValue(lines, /\bgst\b/) || moneyValue(lines, /\btax\b/);
  const totalAmount = moneyValue(lines, /\bgrand\s*total\b/)
    || moneyValue(lines, /(?:total\s+payable|amount\s+payable)/)
    || moneyValue(lines, /\btotal\b/);

  return {
    vendor,
    invoiceNumber,
    date,
    subtotal,
    gstAmount,
    totalAmount,
    lineItems: parseLineItems(lines),
  };
}
