import { generateAiForTask, type AiQueryResult } from "@workspace/ai-providers";
import { type IdCardOcrResult } from "@workspace/integrations-gemini-ai";

/**
 * Ollama ID-card OCR — the local-network counterpart to
 * @workspace/integrations-gemini-ai's geminiOcrIdCard(). Routed through
 * generateAiForTask("id_card_ocr", ...) rather than a bespoke fetch() call,
 * so it automatically honors whatever provider/model an admin pins via the
 * Model Routing UI, and reuses OllamaProvider's existing image-as-data-URI
 * handling instead of a second hand-rolled HTTP client.
 *
 * The JSON schema requested here is intentionally the caller-specified
 * canonical shape (documentType/name/dateOfBirth/yearOfBirth/age/gender/
 * address/idNumber + per-field confidence) — NOT the older Gemini-specific
 * shape (guardianName/aadhaarNumber/single confidence). normalizeOllamaOcr()
 * below maps it onto the shared IdCardOcrResult type so Form F can consume
 * either provider's output identically.
 */

const OLLAMA_ID_CARD_OCR_PROMPT = `You are an Indian government ID document reading assistant. Examine this Aadhaar / Voter ID / Driving Licence / PAN card image and extract identity fields.

Rules:
- Aadhaar cards often show a guardian/relation line: "S/O" (son of), "D/O" (daughter of), "W/O" (wife of), or "C/O" (care of) followed by a name. When present, that IS the "name" to return — it is what a husband/father/guardian field on a compliance form needs, not the card's own primary name line. If no such relation line exists, return the card holder's own printed name instead.
- For address: return the COMPLETE residential address as one comma-separated line. Do NOT truncate.
- For dateOfBirth: return in YYYY-MM-DD format if the full date is legible; leave empty if not.
- For yearOfBirth: return just the 4-digit year if that's all that's legible (common on older/worn cards), or if dateOfBirth is fully known, still repeat the year here.
- For age: leave as null. Age is computed by the caller from dateOfBirth/yearOfBirth, not estimated by you.
- For idNumber: return the document's ID number exactly as printed (Aadhaar/Voter ID/DL/PAN number). Do not redact it yourself — the caller masks it before storage.
- If text is blurry or partially cut off, do your best guess and score that field's confidence lower accordingly rather than omitting it.
- Each confidence score is your own 0-100 self-assessment for that SPECIFIC field only: 95-100 clearly legible, 80-94 mostly legible with minor uncertainty, below 80 significant guessing involved. Fields you could not find at all should get a confidence of 0.

Return ONLY valid JSON — no markdown fences, no explanation, no extra text. Match this exact schema:

{
  "documentType": "AADHAAR|VOTER_ID|DRIVING_LICENCE|PAN|OTHER|UNKNOWN",
  "name": "",
  "dateOfBirth": "",
  "yearOfBirth": "",
  "age": null,
  "gender": "MALE|FEMALE|OTHER|UNKNOWN",
  "address": "",
  "idNumber": "",
  "confidence": {
    "name": 0,
    "dateOfBirth": 0,
    "gender": 0,
    "address": 0,
    "idNumber": 0
  }
}

Return ONLY the JSON object.`;

interface RawOllamaOcrShape {
  documentType?: string;
  name?: string;
  dateOfBirth?: string;
  yearOfBirth?: string;
  age?: number | null;
  gender?: string;
  address?: string;
  idNumber?: string;
  confidence?: {
    name?: number;
    dateOfBirth?: number;
    gender?: number;
    address?: number;
    idNumber?: number;
  };
}

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  AADHAAR: "Aadhaar",
  VOTER_ID: "VoterID",
  DRIVING_LICENCE: "DrivingLicense",
  PAN: "PAN",
  OTHER: "Other",
  UNKNOWN: "Other",
};

/**
 * Strip markdown code fences a chat model may wrap its JSON in (Ollama
 * models are more prone to this than Gemini's structured-output-tuned
 * models), then JSON.parse. Never throws — malformed/absent JSON becomes an
 * empty object so the caller always gets a well-typed (if empty) result
 * rather than an unhandled exception reaching the HTTP layer.
 */
function parseOllamaJson(raw: string): RawOllamaOcrShape {
  const trimmed = (raw ?? "").trim();
  // Handles ```json ... ```, ``` ... ```, and bare JSON with surrounding prose
  // a model sometimes adds despite instructions not to.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonText = (objectMatch ? objectMatch[0] : candidate).trim();
  try {
    const parsed = JSON.parse(jsonText);
    return typeof parsed === "object" && parsed !== null ? (parsed as RawOllamaOcrShape) : {};
  } catch {
    return {};
  }
}

/** Clamp a value to 0-100, defaulting to 0 (never guess a confidence). */
function clampConfidence(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/**
 * Compute age in whole years from a YYYY-MM-DD dateOfBirth, or from a bare
 * yearOfBirth when only the year is known. Never trusts a model-provided
 * age — this is deterministic arithmetic against the server clock.
 */
function computeAge(dateOfBirth: string | undefined, yearOfBirth: string | undefined): number | undefined {
  const today = new Date();
  if (dateOfBirth) {
    const d = new Date(dateOfBirth);
    if (!Number.isNaN(d.getTime())) {
      let age = today.getFullYear() - d.getFullYear();
      const beforeBirthdayThisYear =
        today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate());
      if (beforeBirthdayThisYear) age--;
      if (age >= 0 && age < 130) return age;
    }
  }
  const year = Number(yearOfBirth);
  if (Number.isFinite(year) && year > 1900 && year <= today.getFullYear()) {
    return today.getFullYear() - year;
  }
  return undefined;
}

/**
 * Redact an ID number to its last 4 characters for storage/return — same
 * privacy posture as Gemini's aadhaarNumber truncation, generalized to any
 * document type's ID number (Voter ID, DL, PAN alphanumerics included).
 */
function maskIdNumber(idNumber: string | undefined): string | undefined {
  const raw = (idNumber ?? "").trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.length <= 4) return cleaned;
  return `${"•".repeat(cleaned.length - 4)}${cleaned.slice(-4)}`;
}

function normalizeOllamaOcr(raw: RawOllamaOcrShape): IdCardOcrResult {
  const name = (raw.name ?? "").trim();
  const address = (raw.address ?? "").trim().replace(/\s+/g, " ").replace(/,\s*/g, ", ").trim();
  const dob = (raw.dateOfBirth ?? "").trim();
  const yearOfBirth = (raw.yearOfBirth ?? "").trim();
  const age = computeAge(dob, yearOfBirth);
  const genderRaw = (raw.gender ?? "").trim().toUpperCase();
  const gender = genderRaw === "MALE" ? "M" : genderRaw === "FEMALE" ? "F" : genderRaw === "OTHER" ? "Other" : undefined;
  const idNumber = maskIdNumber(raw.idNumber);

  const fieldConfidence = {
    name: clampConfidence(raw.confidence?.name),
    dateOfBirth: clampConfidence(raw.confidence?.dateOfBirth),
    gender: clampConfidence(raw.confidence?.gender),
    address: clampConfidence(raw.confidence?.address),
    idNumber: clampConfidence(raw.confidence?.idNumber),
  };
  // Overall confidence used by Form F's existing single-number tiering
  // (ocrConfidenceTier) — average of the two fields Form F actually
  // populates (name→husbandFatherName, address), not all five, so a
  // card with a crisp name/address but illegible DOB doesn't get
  // needlessly downgraded to "manual entry" for fields Form F never uses.
  const relevantScores = [fieldConfidence.name, fieldConfidence.address].filter((n) => n > 0);
  const confidencePercent = relevantScores.length > 0
    ? Math.round(relevantScores.reduce((a, b) => a + b, 0) / relevantScores.length)
    : 0;
  const confidence: IdCardOcrResult["confidence"] = confidencePercent >= 95 ? "high" : confidencePercent >= 80 ? "medium" : "low";

  return {
    guardianName: name,
    address,
    documentType: DOCUMENT_TYPE_LABEL[(raw.documentType ?? "OTHER").toUpperCase()] ?? "Other",
    confidence,
    confidencePercent,
    ocrProvider: "ollama",
    fullName: name || undefined,
    dob: dob || undefined,
    yearOfBirth: yearOfBirth || undefined,
    age,
    gender,
    idNumber,
    fieldConfidence,
  };
}

export interface OllamaOcrOptions {
  endpointUrl: string;
  model: string;
}

/**
 * Run ID-card OCR against Ollama. Throws on a hard failure (network error,
 * empty response) — callers are expected to catch this and fall back per
 * the provider-resolution policy in ocrProviderResolver.ts, exactly like
 * the existing geminiOcrIdCard() contract.
 */
export async function ollamaOcrIdCard(
  imageBase64: string,
  opts: OllamaOcrOptions,
): Promise<IdCardOcrResult> {
  const result: AiQueryResult = await generateAiForTask(
    "id_card_ocr",
    OLLAMA_ID_CARD_OCR_PROMPT,
    [imageBase64],
    {
      provider: "ollama",
      model: opts.model,
      endpointUrl: opts.endpointUrl,
      maxTokens: 1024,
    },
  );
  if (!result.success) {
    throw new Error(result.error || "Ollama OCR request failed");
  }
  const raw = parseOllamaJson(result.text);
  return normalizeOllamaOcr(raw);
}
