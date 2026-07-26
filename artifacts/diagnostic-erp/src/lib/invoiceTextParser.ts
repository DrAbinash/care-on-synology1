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

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Vendor: the letterhead is conventionally the first line. Skip past a
  // generic document-title line ("TAX INVOICE", "INVOICE") if that's what
  // OCR happened to put first.
  const vendor = lines.find((l) => !/^(tax\s+invoice|invoice|bill|receipt|cash\s+memo)$/i.test(l)) ?? "";

  const invoiceNumber = findField(lines, /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/i)
    || findField(lines, /bill\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/i);

  const rawDate = findField(lines, /invoice\s*date\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/i)
    || findField(lines, /\bdate\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  const date = rawDate ? normalizeInvoiceDate(rawDate) : "";

  const subtotal = parseNumber(findField(lines, /subtotal\s*[:\-]?\s*([\d,]+\.?\d*)/i));
  // "GST (18%): 810.00" — the optional "(18%)" chunk must be consumed as a
  // unit, not skipped char-by-char excluding digits, or the "18" inside it
  // gets captured as the amount instead of the real "810.00" that follows.
  const GST_RATE_PREFIX = /\s*(?:\([^)]*\))?\s*[:\-]?\s*([\d,]+\.?\d*)/;
  const gstAmount = parseNumber(
    findField(lines, new RegExp(`gst${GST_RATE_PREFIX.source}`, "i"))
    || findField(lines, new RegExp(`\\btax\\b${GST_RATE_PREFIX.source}`, "i"))
  );
  const totalAmount = parseNumber(
    findField(lines, /grand\s*total\s*[:\-]?\s*([\d,]+\.?\d*)/i)
    || findField(lines, /(?:total\s+payable|amount\s+payable)\s*[:\-]?\s*([\d,]+\.?\d*)/i)
    || findField(lines, /\btotal\b\s*[:\-]?\s*([\d,]+\.?\d*)/i)
  );

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
