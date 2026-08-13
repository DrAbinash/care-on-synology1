/**
 * Document OCR: Ollama (primary) → client Tesseract (secondary) →
 * Gemini (tertiary, only when a key exists and the client asks).
 */
import { generateAiForTask } from "@workspace/ai-providers";
import { geminiOcrBill, geminiOcrInvoice, geminiParseBankStatement } from "@workspace/integrations-gemini-ai";
import { getGeminiOcrApiKey, resolveOllamaVisionForOcr } from "./ocrProviderResolver";

export interface BillOcrResult {
  vendor: string;
  date: string;
  amount: number;
  gstAmount: number;
  category: string;
  description: string;
  paymentMode: string;
  confidence: "high" | "medium" | "low";
  confidencePercent: number;
  ocrProvider: "ollama" | "gemini" | "none";
  tesseractFallbackSuggested: boolean;
  geminiFallbackAvailable?: boolean;
}

export interface BankTransaction {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  reference: string;
}

export interface InvoiceLineItemOcr {
  description: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface InvoiceOcrResult {
  vendor: string;
  invoiceNumber: string;
  date: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  lineItems: InvoiceLineItemOcr[];
  confidence: "high" | "medium" | "low";
  confidencePercent: number;
  ocrProvider: "ollama" | "gemini" | "none";
  tesseractFallbackSuggested: boolean;
  geminiFallbackAvailable?: boolean;
}

function parseJsonBlob(raw: string): unknown {
  const trimmed = (raw ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonText = (arrayMatch ? arrayMatch[0] : objectMatch ? objectMatch[0] : candidate).trim();
  return JSON.parse(jsonText);
}

function clampPct(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}

const BILL_PROMPT = `You are an accounting assistant reading a bill / invoice / receipt. Extract fields and return ONLY valid JSON.

{
  "vendor": "shop / supplier name",
  "date": "YYYY-MM-DD or empty",
  "amount": number,
  "gstAmount": number,
  "category": "one of: Salaries, Rent, Utilities, Office Supplies, Medical Supplies, Lab Reagents, Equipment, Maintenance, Travel, Food, Marketing, Professional Fees, Taxes, Insurance, Miscellaneous",
  "description": "brief 1-line description",
  "paymentMode": "cash | card | upi | cheque | other",
  "confidence": "high | medium | low",
  "confidencePercent": number
}`;

const BANK_PROMPT = `You are a bank statement parser. Extract every transaction row and return ONLY a JSON array.

Each element:
{ "date": "YYYY-MM-DD", "description": "narration", "debit": number, "credit": number, "balance": number, "reference": "UTR/cheque or empty" }

Rules: skip headers and totals. Dr = debit, Cr = credit. Convert dates to YYYY-MM-DD.`;

const INVOICE_PROMPT = `You are reading a supplier tax invoice. Return ONLY valid JSON:
{
  "vendor": "",
  "invoiceNumber": "",
  "date": "YYYY-MM-DD or empty",
  "subtotal": number,
  "gstAmount": number,
  "totalAmount": number,
  "confidence": "high | medium | low",
  "confidencePercent": number,
  "lineItems": [{ "description": "", "quantity": number, "unitCost": number, "lineTotal": number }]
}`;

async function geminiMissFlags(): Promise<{ geminiFallbackAvailable: boolean }> {
  return { geminiFallbackAvailable: Boolean(await getGeminiOcrApiKey()) };
}

export async function ocrBill(
  imageBase64: string,
  mimeType: string,
  opts?: { useGeminiFallback?: boolean },
): Promise<BillOcrResult> {
  if (opts?.useGeminiFallback) {
    const apiKey = await getGeminiOcrApiKey();
    if (!apiKey) {
      return {
        vendor: "", date: "", amount: 0, gstAmount: 0, category: "Miscellaneous",
        description: "", paymentMode: "cash", confidence: "low", confidencePercent: 0,
        ocrProvider: "none", tesseractFallbackSuggested: false, geminiFallbackAvailable: false,
      };
    }
    const g = await geminiOcrBill(imageBase64, mimeType, { apiKey });
    return { ...g, ocrProvider: "gemini", tesseractFallbackSuggested: false, geminiFallbackAvailable: true };
  }
  const local = await ollamaOcrBill(imageBase64);
  if (local.tesseractFallbackSuggested) {
    return { ...local, ...(await geminiMissFlags()) };
  }
  return local;
}

export async function parseBankStatementLocal(
  input: { text: string } | { imageBase64: string; mimeType: string },
  opts?: { useGeminiFallback?: boolean },
): Promise<{ transactions: BankTransaction[]; ocrProvider: "ollama" | "gemini" | "none"; tesseractFallbackSuggested: boolean; geminiFallbackAvailable?: boolean }> {
  if (opts?.useGeminiFallback) {
    const apiKey = await getGeminiOcrApiKey();
    if (!apiKey) {
      return { transactions: [], ocrProvider: "none", tesseractFallbackSuggested: false, geminiFallbackAvailable: false };
    }
    const geminiInput = "text" in input
      ? { text: input.text }
      : { imageBase64: input.imageBase64, mimeType: input.mimeType };
    const transactions = await geminiParseBankStatement(geminiInput, { apiKey });
    return { transactions, ocrProvider: "gemini", tesseractFallbackSuggested: false, geminiFallbackAvailable: true };
  }
  const local = "text" in input
    ? await ollamaParseBankStatement({ text: input.text })
    : await ollamaParseBankStatement({ imageBase64: input.imageBase64 });
  if (local.tesseractFallbackSuggested) {
    return { ...local, ...(await geminiMissFlags()) };
  }
  return local;
}

export async function ocrInvoice(
  imageBase64: string,
  mimeType: string,
  opts?: { useGeminiFallback?: boolean },
): Promise<InvoiceOcrResult> {
  if (opts?.useGeminiFallback) {
    const apiKey = await getGeminiOcrApiKey();
    if (!apiKey) {
      return {
        vendor: "", invoiceNumber: "", date: "", subtotal: 0, gstAmount: 0, totalAmount: 0,
        lineItems: [], confidence: "low", confidencePercent: 0,
        ocrProvider: "none", tesseractFallbackSuggested: false, geminiFallbackAvailable: false,
      };
    }
    const g = await geminiOcrInvoice(imageBase64, mimeType, { apiKey });
    return { ...g, ocrProvider: "gemini", tesseractFallbackSuggested: false, geminiFallbackAvailable: true };
  }
  const local = await ollamaOcrInvoice(imageBase64);
  if (local.tesseractFallbackSuggested) {
    return { ...local, ...(await geminiMissFlags()) };
  }
  return local;
}

async function ollamaVisionJson(task: string, prompt: string, imageBase64: string, maxTokens: number): Promise<string> {
  const ollama = await resolveOllamaVisionForOcr();
  if (!ollama) {
    throw new Error("OLLAMA_UNAVAILABLE");
  }
  const result = await generateAiForTask(task, prompt, [imageBase64], {
    provider: "ollama",
    model: ollama.model,
    maxTokens,
  });
  if (!result.success || !result.text?.trim()) {
    throw new Error(result.error || "Ollama returned no text");
  }
  return result.text;
}

export async function ollamaOcrBill(imageBase64: string): Promise<BillOcrResult> {
  try {
    const raw = await ollamaVisionJson("bill_ocr", BILL_PROMPT, imageBase64, 1024);
    const parsed = parseJsonBlob(raw) as Partial<BillOcrResult>;
    const band = parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low";
    const fallback = { high: 97, medium: 87, low: 55 }[band];
    return {
      vendor: String(parsed.vendor ?? ""),
      date: String(parsed.date ?? ""),
      amount: Number(parsed.amount ?? 0) || 0,
      gstAmount: Number(parsed.gstAmount ?? 0) || 0,
      category: String(parsed.category ?? "Miscellaneous"),
      description: String(parsed.description ?? ""),
      paymentMode: String(parsed.paymentMode ?? "cash"),
      confidence: band,
      confidencePercent: clampPct(parsed.confidencePercent, fallback),
      ocrProvider: "ollama",
      tesseractFallbackSuggested: false,
    };
  } catch {
    return {
      vendor: "", date: "", amount: 0, gstAmount: 0, category: "Miscellaneous",
      description: "", paymentMode: "cash", confidence: "low", confidencePercent: 0,
      ocrProvider: "none", tesseractFallbackSuggested: true,
    };
  }
}

export async function ollamaParseBankStatement(
  input: { text: string } | { imageBase64: string },
): Promise<{ transactions: BankTransaction[]; ocrProvider: "ollama" | "none"; tesseractFallbackSuggested: boolean }> {
  if ("text" in input) {
    const fromCsv = parseBankCsvOrText(input.text);
    if (fromCsv.length > 0) {
      return { transactions: fromCsv, ocrProvider: "none", tesseractFallbackSuggested: false };
    }
    try {
      const ollama = await resolveOllamaVisionForOcr();
      if (!ollama) {
        return { transactions: fromCsv, ocrProvider: "none", tesseractFallbackSuggested: true };
      }
      const result = await generateAiForTask("bank_statement_ocr", `${BANK_PROMPT}\n\nStatement text:\n${input.text}`, [], {
        provider: "ollama",
        model: ollama.model,
        maxTokens: 4096,
      });
      if (!result.success) throw new Error(result.error || "fail");
      return {
        transactions: normalizeTxns(parseJsonBlob(result.text)),
        ocrProvider: "ollama",
        tesseractFallbackSuggested: false,
      };
    } catch {
      return { transactions: fromCsv, ocrProvider: "none", tesseractFallbackSuggested: true };
    }
  }

  try {
    const raw = await ollamaVisionJson("bank_statement_ocr", BANK_PROMPT, input.imageBase64, 4096);
    return {
      transactions: normalizeTxns(parseJsonBlob(raw)),
      ocrProvider: "ollama",
      tesseractFallbackSuggested: false,
    };
  } catch {
    return { transactions: [], ocrProvider: "none", tesseractFallbackSuggested: true };
  }
}

export async function ollamaOcrInvoice(imageBase64: string): Promise<InvoiceOcrResult> {
  try {
    const raw = await ollamaVisionJson("invoice_ocr", INVOICE_PROMPT, imageBase64, 2048);
    const parsed = parseJsonBlob(raw) as Partial<InvoiceOcrResult>;
    const band = parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low";
    const lines = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
    return {
      vendor: String(parsed.vendor ?? ""),
      invoiceNumber: String(parsed.invoiceNumber ?? ""),
      date: String(parsed.date ?? ""),
      subtotal: Number(parsed.subtotal ?? 0) || 0,
      gstAmount: Number(parsed.gstAmount ?? 0) || 0,
      totalAmount: Number(parsed.totalAmount ?? 0) || 0,
      lineItems: lines.map((li) => ({
        description: String(li.description ?? ""),
        quantity: Number(li.quantity ?? 0) || 0,
        unitCost: Number(li.unitCost ?? 0) || 0,
        lineTotal: Number(li.lineTotal ?? 0) || 0,
      })),
      confidence: band,
      confidencePercent: clampPct(parsed.confidencePercent, { high: 97, medium: 87, low: 55 }[band]),
      ocrProvider: "ollama",
      tesseractFallbackSuggested: false,
    };
  } catch {
    return {
      vendor: "", invoiceNumber: "", date: "", subtotal: 0, gstAmount: 0, totalAmount: 0,
      lineItems: [], confidence: "low", confidencePercent: 0,
      ocrProvider: "none", tesseractFallbackSuggested: true,
    };
  }
}

function normalizeTxns(raw: unknown): BankTransaction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = r as Partial<BankTransaction>;
    return {
      date: String(row.date ?? ""),
      description: String(row.description ?? ""),
      debit: Number(row.debit ?? 0) || 0,
      credit: Number(row.credit ?? 0) || 0,
      balance: Number(row.balance ?? 0) || 0,
      reference: String(row.reference ?? ""),
    };
  }).filter((t) => t.debit > 0 || t.credit > 0 || t.description);
}

/** Deterministic CSV / pasted-statement parse — no LLM. */
export function parseBankCsvOrText(text: string): BankTransaction[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rows: BankTransaction[] = [];
  for (const line of lines) {
    if (/^date\b/i.test(line)) continue;
    if (/opening\s*balance/i.test(line) && !/\d/.test(line)) continue;
    const parts = line.includes("\t") ? line.split("\t") : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const cells = parts.map((c) => c.replace(/^"|"$/g, "").trim());
    const dateCell = cells.find((c) => /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(c) || /^\d{4}-\d{2}-\d{2}$/.test(c));
    if (!dateCell) continue;
    const nums = cells
      .map((c) => Number(c.replace(/[,₹]/g, "")))
      .filter((n) => Number.isFinite(n) && n !== 0);
    const desc = cells.find((c) => /[A-Za-z]{3,}/.test(c) && c !== dateCell) ?? "";
    const ref = cells.find((c) => /UTR|NEFT|IMPS|CHQ|CHEQUE|\d{6,}/i.test(c) && c !== dateCell) ?? "";
    let debit = 0, credit = 0, balance = 0;
    if (nums.length >= 3) {
      debit = nums[0]; credit = nums[1]; balance = nums[2];
      if (debit > 0 && credit > 0 && nums.length === 3) {
        // withdrawal, deposit, balance — keep as-is
      }
    } else if (nums.length === 2) {
      balance = nums[1];
      if (/cr|credit|deposit|salary/i.test(line)) credit = nums[0];
      else debit = nums[0];
    } else if (nums.length === 1) {
      if (/cr|credit|deposit/i.test(line)) credit = nums[0];
      else debit = nums[0];
    }
    rows.push({
      date: normalizeDate(dateCell),
      description: desc,
      debit, credit, balance, reference: ref,
    });
  }
  return rows.filter((t) => t.debit > 0 || t.credit > 0);
}

export function normalizeDate(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!dmy) return raw;
  let [, d, m, y] = dmy;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
