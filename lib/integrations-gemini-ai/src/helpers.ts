const GEMINI_MODEL = "gemini-2.5-flash";

export interface GeminiGenerateOptions {
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
}

/**
 * Send a single text prompt to the Gemini generateContent endpoint and return
 * the trimmed text of the first candidate's first part.  Returns an empty
 * string when the model produces no output.
 *
 * Throws if the HTTP response is not ok.
 */
export async function geminiGenerate(
  prompt: string,
  options: GeminiGenerateOptions = {}
): Promise<string> {
  const baseUrl =
    options.baseUrl ??
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ??
    "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";
  const maxTokens = options.maxTokens ?? 512;

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export interface ClinicalNotePatient {
  firstName: string;
  lastName: string;
  patientId: string;
  gender: string;
  dateOfBirth: string;
  bloodGroup?: string | null;
}

/**
 * Build the prompt sent to Gemini for clinical note generation.
 * Separated from the route handler so it can be unit-tested independently.
 */
export function buildClinicalNotePrompt(
  patient: ClinicalNotePatient,
  testHistory: string
): string {
  return `You are a clinical documentation assistant for a diagnostic center.

Patient: ${patient.firstName} ${patient.lastName}
ID: ${patient.patientId}
Gender: ${patient.gender}
Date of Birth: ${patient.dateOfBirth}
Blood Group: ${patient.bloodGroup ?? "Not specified"}

Recent Diagnostic Tests:
${testHistory || "No tests recorded yet"}

Please generate a concise professional clinical summary note (3-4 sentences) suitable for a referring physician. Include patient demographics, recent test profile, and any notable patterns. Use formal medical language.`;
}

export interface BillingInsightsMetrics {
  fromLabel: string;
  toLabel: string;
  totalBills: number;
  totalRevenue: number;
  paidCount: number;
  pendingCount: number;
  partialCount: number;
  totalDiscount: number;
  collectionRate: string;
  avgBill: string;
}

/**
 * Build the prompt sent to Gemini for billing insights analysis.
 * Separated from the route handler so it can be unit-tested independently.
 */
export function buildBillingInsightsPrompt(
  metrics: BillingInsightsMetrics
): string {
  return `You are a healthcare financial analyst. Analyze this diagnostic center billing data and provide 3-5 actionable business insights.

Period: ${metrics.fromLabel} to ${metrics.toLabel}

Key Metrics:
- Total Bills: ${metrics.totalBills}
- Total Revenue Collected: ₹${metrics.totalRevenue.toLocaleString("en-IN")}
- Paid Bills: ${metrics.paidCount} (${metrics.collectionRate}% collection rate)
- Pending Bills: ${metrics.pendingCount}
- Partial Payments: ${metrics.partialCount}
- Total Discounts Given: ₹${metrics.totalDiscount.toLocaleString("en-IN")}
- Average Bill Amount: ₹${metrics.avgBill}

Provide insights as a numbered list. Be specific, practical, and mention specific numbers where relevant. Focus on collection efficiency, revenue optimization, and discount management. Keep each insight to 1-2 sentences.`;
}

// ---------------------------------------------------------------------------
// Radiology helpers
// ---------------------------------------------------------------------------

/** Modality code → human-readable name used in radiology prompts. */
export const MODALITY_NAMES: Record<string, string> = {
  MR: "MRI",
  CT: "CT",
  CR: "X-Ray",
  US: "Ultrasound",
  MG: "Mammography",
  BMD: "DEXA bone density",
  OT: "Imaging study",
};

export interface GeminiTranscribeOptions {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Send a multimodal (text instruction + inline audio) request to Gemini for
 * verbatim transcription of a radiologist's dictation.
 * Returns trimmed transcript text, or an empty string when the model produces
 * no output.  Throws if the HTTP response is not ok.
 */
export async function geminiTranscribe(
  audioBase64: string,
  mimeType: string,
  options: GeminiTranscribeOptions = {}
): Promise<string> {
  const baseUrl =
    options.baseUrl ??
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ??
    "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const transcribePrompt =
    "Transcribe the radiologist's dictation verbatim. Return only the spoken text — no headings, no commentary, no timestamps. Preserve medical terminology exactly as spoken.";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: transcribePrompt },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini transcription error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

export interface RadiologyFindingsInput {
  modality: string;
  testName: string;
  clinicalHistory: string;
  dictation: string;
}

/**
 * Build the prompt sent to Gemini for generating the FINDINGS section of a
 * radiology report.  Separated from the route handler so it can be tested.
 */
export function buildRadiologyFindingsPrompt(input: RadiologyFindingsInput): string {
  const modalityName = MODALITY_NAMES[input.modality] ?? input.modality ?? "Imaging";
  return `You are a senior radiologist drafting the FINDINGS section of a ${modalityName} report.

Study: ${input.testName || modalityName}
Clinical history: ${input.clinicalHistory || "(none provided)"}
Radiologist dictation / observations: ${input.dictation || "(none provided — produce a clean structured template the radiologist can fill in)"}

Write a professional FINDINGS section organised by anatomical region in short clear paragraphs.
- Use formal medical language and standard radiology phrasing.
- Quantify measurements where the dictation gives numbers (mm, cm).
- Use "No abnormality" or "Within normal limits" where the dictation is silent or explicitly normal — do NOT invent pathology.
- Do NOT include the IMPRESSION section. Do NOT include patient demographics. Do NOT include any disclaimer.
- Output only the findings narrative, ready to paste into the report.`;
}

export interface RadiologyImpressionInput {
  findings: string;
  modality: string;
  testName: string;
}

/**
 * Build the prompt sent to Gemini for generating the IMPRESSION bullet list
 * from an existing FINDINGS narrative.  Separated from the route handler so
 * it can be tested.
 */
export function buildRadiologyImpressionPrompt(input: RadiologyImpressionInput): string {
  const modalityName = MODALITY_NAMES[input.modality] ?? input.modality ?? "imaging study";
  return `You are a senior radiologist. Read the FINDINGS below from a ${modalityName} ${input.testName ? `(${input.testName}) ` : ""}and write a concise IMPRESSION.

FINDINGS:
${input.findings}

Rules:
- 1 to 4 numbered bullet points.
- Each bullet ≤ 25 words, plain medical language.
- Order by clinical significance (most important first).
- Suggest follow-up imaging or clinical correlation only if findings warrant it.
- Output only the numbered impression list. No heading, no preamble, no disclaimer.`;
}

// ---------------------------------------------------------------------------
// Patient message prompt builder
// ---------------------------------------------------------------------------

export type PatientMessageType = "followup" | "results" | "payment";

export interface PatientMessagePatient {
  firstName: string;
  lastName: string;
}

const PATIENT_MESSAGE_PURPOSES: Record<PatientMessageType, string> = {
  followup: "a follow-up reminder to come in for their scheduled tests",
  results: "a notification that their test results are ready for collection",
  payment: "a gentle payment reminder for outstanding dues",
};

/**
 * Build the prompt sent to Gemini for drafting a patient SMS/WhatsApp message.
 * Separated from the route handler so it can be unit-tested independently.
 */
export function buildPatientMessagePrompt(
  patient: PatientMessagePatient,
  messageType: PatientMessageType
): string {
  const purpose = PATIENT_MESSAGE_PURPOSES[messageType] ?? PATIENT_MESSAGE_PURPOSES.followup;
  return `Draft a short, professional and warm SMS/WhatsApp message (max 60 words) for a diagnostic center to send a patient.

Patient Name: ${patient.firstName} ${patient.lastName}
Center Name: Care Diagnostics

Message purpose: ${purpose}

Keep it brief, friendly, and professional. Include the center name. Do not include any placeholder brackets.`;
}

// ---------------------------------------------------------------------------
// Multimodal OCR — bill / receipt scanning
// ---------------------------------------------------------------------------

export interface BillOcrResult {
  vendor: string;
  date: string;           // YYYY-MM-DD or empty
  amount: number;         // total payable
  gstAmount: number;
  category: string;       // best-guess expense category
  description: string;    // concise line-item summary
  paymentMode: string;    // cash | card | upi | cheque | other
  confidence: "high" | "medium" | "low";
  /** Numeric 0-100 self-assessed confidence, same tiering convention as
   * IdCardOcrResult.confidencePercent — always populated (falls back to a
   * fixed mapping from the qualitative confidence band if the model didn't
   * return a valid number). */
  confidencePercent: number;
}

/**
 * Send a bill/receipt image to Gemini Vision and extract key expense fields.
 * Returns a BillOcrResult; numeric fields default to 0 on parse failure.
 */
export async function geminiOcrBill(
  imageBase64: string,
  mimeType: string,
  options: GeminiGenerateOptions = {}
): Promise<BillOcrResult> {
  const baseUrl =
    options.baseUrl ?? process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";

  const prompt = `You are an accounting assistant reading a bill / invoice / receipt (image or PDF — if multi-page, use the page(s) showing the total payable; if several distinct receipts appear, extract only the first one). Extract the following fields and return ONLY valid JSON — no markdown fences, no explanation.

JSON schema:
{
  "vendor": "string — shop / supplier name",
  "date": "string — date in YYYY-MM-DD format, empty string if not found",
  "amount": number — total payable amount (after tax, inclusive of GST),
  "gstAmount": number — GST / tax portion only (0 if not shown),
  "category": "string — one of: Salaries, Rent, Utilities, Office Supplies, Medical Supplies, Lab Reagents, Equipment, Maintenance, Travel, Food, Marketing, Professional Fees, Taxes, Insurance, Miscellaneous",
  "description": "string — brief 1-line description of what was purchased",
  "paymentMode": "string — one of: cash, card, upi, cheque, other",
  "confidence": "string — one of: high, medium, low — your confidence in the extracted data",
  "confidencePercent": "number — your own 0-100 numeric confidence self-assessment: 95-100 if every field is clearly legible, 80-94 if mostly legible with minor uncertainty, below 80 if you had to guess significant portions"
}

Return ONLY the JSON object.`;

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini OCR error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

  let parsed: Partial<BillOcrResult> = {};
  try {
    // Strip markdown fences if the model wraps them anyway
    const clean = raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    parsed = JSON.parse(clean) as Partial<BillOcrResult>;
  } catch { /* fall through to defaults */ }

  const billConfidence = parsed.confidence ?? "low";
  const billFallback: Record<BillOcrResult["confidence"], number> = { high: 97, medium: 87, low: 55 };
  const billRawPercent = Number(parsed.confidencePercent);
  const billConfidencePercent = Number.isFinite(billRawPercent)
    ? Math.max(0, Math.min(100, Math.round(billRawPercent)))
    : billFallback[billConfidence];

  return {
    vendor: parsed.vendor ?? "",
    date: parsed.date ?? "",
    amount: Number(parsed.amount ?? 0),
    gstAmount: Number(parsed.gstAmount ?? 0),
    category: parsed.category ?? "Miscellaneous",
    description: parsed.description ?? "",
    paymentMode: parsed.paymentMode ?? "cash",
    confidence: billConfidence,
    confidencePercent: billConfidencePercent,
  };
}

// ---------------------------------------------------------------------------
// Multimodal OCR — supplier/vendor invoice parsing (header + line items)
// ---------------------------------------------------------------------------

export interface InvoiceLineItemOcr {
  description: string; // raw line text as printed, e.g. "Paracetamol 500mg Tab 10x10"
  quantity: number;
  unitCost: number;    // cost per unit, excluding GST
  lineTotal: number;   // quantity * unitCost, or as printed if the invoice shows it directly
}

export interface InvoiceOcrResult {
  vendor: string;
  invoiceNumber: string;
  date: string;          // YYYY-MM-DD or empty
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  lineItems: InvoiceLineItemOcr[];
  confidence: "high" | "medium" | "low";
  confidencePercent: number;
}

/**
 * Send a supplier/vendor invoice (image or PDF) to Gemini Vision and extract
 * the header fields plus every line item. Line items are NOT matched to the
 * inventory catalog here — that's a separate, catalog-aware fuzzy-match pass
 * (see invoiceLineMatching.ts in api-server) run after this returns, so this
 * function stays a pure "what does the invoice say" extraction with no DB
 * dependency, same separation as the ID-card OCR / QR-decode split.
 */
export async function geminiOcrInvoice(
  imageBase64: string,
  mimeType: string,
  options: GeminiGenerateOptions = {}
): Promise<InvoiceOcrResult> {
  const baseUrl =
    options.baseUrl ?? process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";

  const prompt = `You are an accounting assistant reading a supplier/vendor invoice (image or PDF — if multi-page, use the page(s) containing the invoice header and its line items; if several distinct invoices appear, extract only the first one). Extract the following and return ONLY valid JSON — no markdown fences, no explanation.

JSON schema:
{
  "vendor": "string — supplier/company name issuing the invoice",
  "invoiceNumber": "string — the invoice/bill number as printed, empty string if not found",
  "date": "string — invoice date in YYYY-MM-DD format, empty string if not found",
  "subtotal": number — sum of line items before tax (0 if not shown separately),
  "gstAmount": number — GST/tax portion only (0 if not shown),
  "totalAmount": number — grand total payable (after tax),
  "lineItems": [
    {
      "description": "string — the item/product/medicine name exactly as printed, including dosage/pack size if shown",
      "quantity": number,
      "unitCost": number — cost per unit before tax,
      "lineTotal": number — this line's total (quantity * unitCost, or as printed)
    }
  ],
  "confidence": "string — one of: high, medium, low — your confidence in the extracted data",
  "confidencePercent": "number — your own 0-100 numeric confidence self-assessment: 95-100 if every field including all line items is clearly legible, 80-94 if mostly legible with minor uncertainty, below 80 if you had to guess significant portions"
}

Rules:
- List every line item on the invoice, in the order printed. Do not summarize or merge distinct items.
- If a line's total isn't printed, compute it as quantity * unitCost.
- Skip summary/subtotal/tax rows themselves — those go into subtotal/gstAmount/totalAmount, not lineItems.
- Return ONLY the JSON object.`;

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
      // Invoices can carry many line items — a receipt/bill's 1024-token cap
      // (geminiOcrBill) is too tight for a multi-item invoice's JSON array.
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini invoice OCR error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

  let parsed: Partial<InvoiceOcrResult> = {};
  try {
    const clean = raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    parsed = JSON.parse(clean) as Partial<InvoiceOcrResult>;
  } catch { /* fall through to defaults */ }

  const invoiceConfidence = parsed.confidence ?? "low";
  const invoiceFallback: Record<InvoiceOcrResult["confidence"], number> = { high: 97, medium: 87, low: 55 };
  const invoiceRawPercent = Number(parsed.confidencePercent);
  const invoiceConfidencePercent = Number.isFinite(invoiceRawPercent)
    ? Math.max(0, Math.min(100, Math.round(invoiceRawPercent)))
    : invoiceFallback[invoiceConfidence];

  const lineItems = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map((l) => ({
        description: l?.description ?? "",
        quantity: Number(l?.quantity ?? 0),
        unitCost: Number(l?.unitCost ?? 0),
        lineTotal: Number(l?.lineTotal ?? 0),
      })).filter((l) => l.description.trim().length > 0)
    : [];

  return {
    vendor: parsed.vendor ?? "",
    invoiceNumber: parsed.invoiceNumber ?? "",
    date: parsed.date ?? "",
    subtotal: Number(parsed.subtotal ?? 0),
    gstAmount: Number(parsed.gstAmount ?? 0),
    totalAmount: Number(parsed.totalAmount ?? 0),
    lineItems,
    confidence: invoiceConfidence,
    confidencePercent: invoiceConfidencePercent,
  };
}

// ---------------------------------------------------------------------------
// Multimodal OCR — bank statement parsing
// ---------------------------------------------------------------------------

export interface BankTransaction {
  date: string;          // YYYY-MM-DD
  description: string;
  debit: number;         // amount going out (positive number, 0 if credit)
  credit: number;        // amount coming in (positive number, 0 if debit)
  balance: number;       // running balance after this row (0 if not shown)
  reference: string;     // cheque no / UTR / ref
}

/**
 * Parse a bank statement from plain CSV/text or from an image.
 * Pass either `text` (raw CSV or copied text) or `imageBase64 + mimeType`.
 */
export async function geminiParseBankStatement(
  input: { text: string } | { imageBase64: string; mimeType: string },
  options: GeminiGenerateOptions = {}
): Promise<BankTransaction[]> {
  const baseUrl =
    options.baseUrl ?? process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";

  const prompt = `You are a bank statement parser. Extract every transaction row and return ONLY a JSON array — no markdown fences, no explanation.

Each element must follow this schema:
{
  "date": "YYYY-MM-DD",
  "description": "narration / merchant name",
  "debit": number (amount withdrawn/paid, positive, 0 if this row is a credit),
  "credit": number (amount deposited/received, positive, 0 if this row is a debit),
  "balance": number (running balance after this row, 0 if not shown),
  "reference": "cheque number / UTR / transaction ID if present, else empty string"
}

Rules:
- Parse every data row; skip header rows and totals rows.
- For Indian formats: Dr = debit, Cr = credit.
- Dates may be in various formats — convert all to YYYY-MM-DD.
- Return ONLY the JSON array.`;

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const parts: unknown[] =
    "text" in input
      ? [{ text: prompt }, { text: input.text }]
      : [{ text: prompt }, { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } }];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini bank statement error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";

  try {
    const clean = raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    const arr = JSON.parse(clean) as Partial<BankTransaction>[];
    return arr.map((r) => ({
      date: r.date ?? "",
      description: r.description ?? "",
      debit: Number(r.debit ?? 0),
      credit: Number(r.credit ?? 0),
      balance: Number(r.balance ?? 0),
      reference: r.reference ?? "",
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// High-level generators — combine prompt building + Gemini call
// ---------------------------------------------------------------------------

/**
 * Generate a professional clinical summary note for a patient.
 * Builds the prompt from patient demographics + test history, then calls
 * Gemini and returns the model's response text.
 */
export async function generateClinicalNote(
  patient: ClinicalNotePatient,
  testHistory: string,
  options?: GeminiGenerateOptions
): Promise<string> {
  const prompt = buildClinicalNotePrompt(patient, testHistory);
  return geminiGenerate(prompt, options);
}

/**
 * Generate billing insights for a given period.
 * Builds the prompt from pre-computed metrics, then calls Gemini and returns
 * the model's numbered insights list.
 */
export async function generateBillingInsights(
  metrics: BillingInsightsMetrics,
  options?: GeminiGenerateOptions
): Promise<string> {
  const prompt = buildBillingInsightsPrompt(metrics);
  return geminiGenerate(prompt, options);
}

/**
 * Draft a short patient SMS/WhatsApp message via Gemini.
 * Caps output at 200 tokens to match the route's usage and keep messages brief.
 */
export async function generatePatientMessage(
  patient: PatientMessagePatient,
  messageType: PatientMessageType,
  options?: GeminiGenerateOptions
): Promise<string> {
  const prompt = buildPatientMessagePrompt(patient, messageType);
  return geminiGenerate(prompt, { ...options, maxTokens: 200 });
}

// ---------------------------------------------------------------------------
// USG Auto-Measurement OCR — extract burned-in ultrasound measurements
// ---------------------------------------------------------------------------

export interface UsgMeasurementJson {
  bpd: string;
  hc: string;
  ac: string;
  fl: string;
  crl: string;
  efw: string;
  ga: string;
  edd: string;
  fhr: string;
  uterusSize: string;
  endometrium: string;
  rightOvary: string;
  leftOvary: string;
  liverSize: string;
  spleenSize: string;
  rightKidney: string;
  leftKidney: string;
  cbd: string;
  gbWall: string;
  prostateVolume: string;
  placentaPosition: string;
  liquorAfi: string;
  fetalPresentation: string;
  follicles: string;
  adnexalLesion: string;
  extraMeasurements: Record<string, string>;
  overallConfidence: "high" | "medium" | "low";
  perFieldConfidence: Record<string, "high" | "medium" | "low">;
  rawText: string;
}

const USG_OCR_PROMPT = `You are a medical ultrasound image analysis assistant specialized in reading GE ultrasound machines.
Analyze this ultrasound image and extract ALL visible measurement values burned into the image.

Return ONLY a valid JSON object — no markdown fences, no explanation, no extra text.

JSON schema (use empty string "" for any field not visible):
{
  "bpd": "Biparietal Diameter e.g. '8.2 cm'",
  "hc": "Head Circumference e.g. '28.5 cm'",
  "ac": "Abdominal Circumference e.g. '25.0 cm'",
  "fl": "Femur Length e.g. '5.8 cm'",
  "crl": "Crown-Rump Length e.g. '3.2 cm'",
  "efw": "Estimated Fetal Weight e.g. '1850 g'",
  "ga": "Gestational Age e.g. '28W 3D'",
  "edd": "Estimated Due Date e.g. '15/10/2025'",
  "fhr": "Fetal Heart Rate e.g. '148 bpm'",
  "uterusSize": "Uterus dimensions e.g. '8.5 x 4.2 x 3.8 cm'",
  "endometrium": "Endometrial thickness e.g. '8 mm'",
  "rightOvary": "Right ovary e.g. '2.8 x 1.9 cm'",
  "leftOvary": "Left ovary e.g. '2.6 x 1.7 cm'",
  "liverSize": "Liver span e.g. '13.5 cm'",
  "spleenSize": "Spleen size e.g. '10.2 cm'",
  "rightKidney": "Right kidney e.g. '10.8 x 4.5 cm'",
  "leftKidney": "Left kidney e.g. '11.0 x 4.8 cm'",
  "cbd": "Common Bile Duct e.g. '4 mm'",
  "gbWall": "Gallbladder wall e.g. '3 mm'",
  "prostateVolume": "Prostate volume e.g. '32 cc'",
  "placentaPosition": "e.g. 'Posterior' or 'Anterior'",
  "liquorAfi": "AFI / liquor index e.g. '12.5 cm'",
  "fetalPresentation": "e.g. 'Cephalic' or 'Breech'",
  "follicles": "follicle count/size or empty",
  "adnexalLesion": "adnexal lesion description or empty",
  "extraMeasurements": { "label": "value" for any other visible labeled measurements },
  "overallConfidence": "high | medium | low",
  "perFieldConfidence": { "fieldName": "high | medium | low" for each populated field },
  "rawText": "all text visible in the image concatenated as a single string"
}`;

const EMPTY_USG_JSON: UsgMeasurementJson = {
  bpd: "", hc: "", ac: "", fl: "", crl: "", efw: "", ga: "", edd: "", fhr: "",
  uterusSize: "", endometrium: "", rightOvary: "", leftOvary: "",
  liverSize: "", spleenSize: "", rightKidney: "", leftKidney: "",
  cbd: "", gbWall: "", prostateVolume: "", placentaPosition: "",
  liquorAfi: "", fetalPresentation: "", follicles: "", adnexalLesion: "",
  extraMeasurements: {}, overallConfidence: "low", perFieldConfidence: {}, rawText: "",
};

/**
 * Send an ultrasound image frame to Gemini Vision and extract all visible measurements.
 * imageBase64 must be a base-64 encoded PNG/JPEG (not a data-URI).
 */
export async function geminiUsgOcr(
  imageBase64: string,
  mimeType: string,
  options: GeminiGenerateOptions = {}
): Promise<UsgMeasurementJson> {
  const baseUrl = options.baseUrl ?? process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: USG_OCR_PROMPT },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.05 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini USG OCR error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

  try {
    const clean = raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(clean) as Partial<UsgMeasurementJson>;
    return { ...EMPTY_USG_JSON, ...parsed };
  } catch {
    return { ...EMPTY_USG_JSON, rawText: raw };
  }
}

/**
 * Normalize raw text (from DICOM tags, SR, or failed image OCR) into structured
 * USG measurements by prompting Gemini with the text content directly.
 */
export async function geminiNormalizeMeasurements(
  rawText: string,
  options: GeminiGenerateOptions = {}
): Promise<UsgMeasurementJson> {
  const prompt = `You are a medical data normalization assistant.
Below is raw text extracted from an ultrasound report or DICOM structured report.
Parse it and fill this JSON schema (empty string if not found):

Raw text:
${rawText.slice(0, 4000)}

Return ONLY valid JSON matching this schema:
{
  "bpd":"","hc":"","ac":"","fl":"","crl":"","efw":"","ga":"","edd":"","fhr":"",
  "uterusSize":"","endometrium":"","rightOvary":"","leftOvary":"",
  "liverSize":"","spleenSize":"","rightKidney":"","leftKidney":"",
  "cbd":"","gbWall":"","prostateVolume":"","placentaPosition":"",
  "liquorAfi":"","fetalPresentation":"","follicles":"","adnexalLesion":"",
  "extraMeasurements":{},"overallConfidence":"medium","perFieldConfidence":{},"rawText":""
}`;

  const text = await geminiGenerate(prompt, options);
  try {
    const clean = text.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(clean) as Partial<UsgMeasurementJson>;
    return { ...EMPTY_USG_JSON, ...parsed, rawText };
  } catch {
    return { ...EMPTY_USG_JSON, rawText };
  }
}

// ---------------------------------------------------------------------------
// ID Card OCR — extract guardian name and address from Aadhaar / identity card
// ---------------------------------------------------------------------------

export interface IdCardOcrResult {
  guardianName: string;
  address: string;
  documentType: string;
  confidence: "high" | "medium" | "low";
  /** Numeric 0-100 self-assessed confidence — see the confidence-tiering
   * doc comment on runIdCardOcrPipeline in artifacts/api-server/src/lib/ocr/idCardPipeline.ts.
   * Always populated (normalized from the qualitative `confidence` field if
   * the model doesn't return a number), so callers can rely on it existing. */
  confidencePercent: number;
  /** Optional extras extracted when the model finds them. */
  fullName?: string;
  dob?: string;
  gender?: string;
  aadhaarNumber?: string;
  rawText?: string;
  /** Which OCR provider actually produced this result — "gemini" or
   * "ollama". Absent on results from code paths that predate the
   * provider-abstraction fix (treat as "gemini" for backward compat). */
  ocrProvider?: "gemini" | "ollama";
  /** Year of birth, when the model could only read a partial/approximate
   * DOB (common on worn/blurry cards) or the document only prints a year. */
  yearOfBirth?: string;
  /** Age computed server-side from dob/yearOfBirth when possible — never
   * asked of the model directly, since "today minus DOB" is exact math the
   * model would otherwise approximate unreliably. */
  age?: number;
  /** Generic ID number (Aadhaar/Voter/DL/PAN), already redacted to a
   * privacy-safe form — see maskIdNumber() in idCardOcrOllama.ts. Prefer
   * this over the Aadhaar-specific `aadhaarNumber` field for new code. */
  idNumber?: string;
  /** Per-field 0-100 self-assessed confidence, when the provider returns
   * one (currently Ollama only — Gemini's prompt asks for a single overall
   * confidence instead, see `confidencePercent`). */
  fieldConfidence?: {
    name?: number;
    dateOfBirth?: number;
    gender?: number;
    address?: number;
    idNumber?: number;
  };
}

const ID_CARD_OCR_PROMPT = `You are an Indian government ID document reading assistant. Examine this Aadhaar / Voter ID / Passport / Ration card / PAN / Driving License image and extract as many fields as possible.

Rules:
- Aadhaar cards often show: name, DOB, gender, Aadhaar number, address, and father's/husband's name. Some Aadhaar cards show "S/O" (son of), "D/O" (daughter of), "W/O" (wife of), or "C/O" (care of) followed by the guardian name.
- Voter ID (EPIC) cards show: name, father's name, age, gender, and address.
- Passports show: name, father's name, address, date of birth.
- Ration cards show: head of family name, address, and member names.
- If the card has both front and back visible in the same image, read both sides.
- If text is blurry or partially cut off, do your best guess and mark confidence as "medium" or "low".
- For guardianName: return the husband's name, father's name, or head of family name — whichever is explicitly shown. Use the field labeled "Father's Name", "Husband's Name", "S/O", "D/O", "W/O", or "C/O".
- For address: return the COMPLETE residential address as one comma-separated line. Do NOT truncate.
- For confidence: use "high" if text is fully legible, "medium" if some text is blurry or partially obscured, "low" if most text is unreadable.
- For confidencePercent: give your own numeric self-assessment 0-100 of how confident you are in the extracted fields overall — roughly: 95-100 if every field you extracted is clearly, unambiguously legible; 80-94 if mostly legible with minor uncertainty on one or two fields; below 80 if you had to guess at significant portions of the text. This should be consistent with (but more granular than) the "confidence" field above.

Return ONLY valid JSON — no markdown fences, no explanation, no extra text.

JSON schema:
{
  "guardianName": "string — husband's or father's full name as shown. If neither is shown, use guardian / head of family / S/O / D/O / W/O / C/O name. Empty string if not found.",
  "address": "string — complete residential address, comma-separated, one line. Empty string if not found.",
  "documentType": "string — one of: Aadhaar, VoterID, Passport, RationCard, PAN, DrivingLicense, Other",
  "confidence": "string — one of: high, medium, low",
  "confidencePercent": "number — your own 0-100 numeric confidence self-assessment, see the rule above",
  "fullName": "string — the card holder's own name if visible. Empty string if not found.",
  "dob": "string — date of birth if shown. Empty string if not found.",
  "gender": "string — M/F/Other if shown. Empty string if not found.",
  "aadhaarNumber": "string — last 4 digits only for privacy, or empty string if not found.",
  "rawText": "string — all readable text from the image concatenated as a single string, in the order it appears."
}

Return ONLY the JSON object.`;

/**
 * Send an Aadhaar / identity card image to Gemini Vision and extract
 * the guardian/husband/father name and full address. Returns a structured
 * result with confidence level. Also extracts extra fields when available.
 */
export async function geminiOcrIdCard(
  imageBase64: string,
  mimeType: string,
  options: GeminiGenerateOptions = {}
): Promise<IdCardOcrResult> {
  const baseUrl =
    options.baseUrl ?? process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const apiKey = options.apiKey ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "";

  const url = `${baseUrl}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: ID_CARD_OCR_PROMPT },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 1536, temperature: 0.05 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ID Card OCR error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "{}";

  let parsed: Partial<IdCardOcrResult> = {};
  try {
    const clean = raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    parsed = JSON.parse(clean) as Partial<IdCardOcrResult>;
  } catch { /* fall through to defaults */ }

  // Normalize guardian name: remove common prefixes like "S/O", "D/O", "W/O", "C/O"
  let guardianName = (parsed.guardianName ?? "").trim();
  if (guardianName) {
    guardianName = guardianName.replace(/^\s*(S\/O|D\/O|W\/O|C\/O|s\/o|d\/o|w\/o|c\/o)[\s:,-]+/i, "").trim();
  }

  // Normalize address: collapse multiple spaces, ensure commas
  let address = (parsed.address ?? "").trim();
  if (address) {
    address = address.replace(/\s+/g, " ").replace(/,\s*/g, ", ").trim();
  }

  // Sanitize aadhaar number to last 4 digits only
  let aadhaarNumber = (parsed.aadhaarNumber ?? "").trim();
  if (aadhaarNumber) {
    const digits = aadhaarNumber.replace(/\D/g, "");
    aadhaarNumber = digits.slice(-4);
  }

  const confidence = (parsed.confidence as IdCardOcrResult["confidence"]) ?? "low";

  // Numeric confidence is never left unset — if the model didn't return a
  // valid confidencePercent (older prompt version, malformed JSON, or a
  // non-numeric value), fall back to a fixed mapping from the qualitative
  // confidence band so the caller's tiering logic always has a number to
  // compare against. These fallback values intentionally sit mid-band, not
  // at the boundary, so a model that DOES return a number isn't silently
  // overridden — only used when confidencePercent is genuinely absent/invalid.
  const QUALITATIVE_FALLBACK: Record<IdCardOcrResult["confidence"], number> = { high: 97, medium: 87, low: 55 };
  const rawPercent = Number(parsed.confidencePercent);
  const confidencePercent = Number.isFinite(rawPercent)
    ? Math.max(0, Math.min(100, Math.round(rawPercent)))
    : QUALITATIVE_FALLBACK[confidence];

  return {
    guardianName,
    address,
    documentType: parsed.documentType ?? "Other",
    confidence,
    confidencePercent,
    ocrProvider: "gemini",
    fullName: (parsed.fullName ?? "").trim() || undefined,
    dob: (parsed.dob ?? "").trim() || undefined,
    gender: (parsed.gender ?? "").trim() || undefined,
    aadhaarNumber: aadhaarNumber || undefined,
    rawText: (parsed.rawText ?? "").trim() || undefined,
  };
}
