/**
 * Heuristic parser for raw Tesseract.js output from Indian government ID
 * cards (Aadhaar / Voter / PAN / DL). Used when Form F's AI OCR path
 * (Ollama, then Gemini) fails — same role invoiceTextParser plays for
 * purchase-invoice offline scan.
 *
 * Best-effort only: staff must still verify fields before save. Never
 * auto-commits into Form F.
 */

export interface ParsedIdCardText {
  guardianName: string;
  address: string;
  documentType: string;
  dob: string;
  gender: string;
  idNumber: string;
  confidence: "low" | "medium";
  confidencePercent: number;
}

const ADDRESS_LABEL_RE = /(?:address|village|vtc|dist(?:rict)?|state|pin(?:code)?)\b/i;
const DOB_RE = /\b(?:dob|date\s*of\s*birth|yob)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4})\b/i;
const GENDER_RE = /\b(?:sex|gender)\s*[:\-]?\s*(male|female|m|f)\b/i;
const AADHAAR_RE = /\b(\d{4}\s?\d{4}\s?\d{4})\b/;
const VOTER_RE = /\b([A-Z]{3}\d{7})\b/;
const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/;

function cleanName(raw: string): string {
  return raw
    .replace(/^(?:father|husband|guardian|name|s\/o|w\/o|d\/o)\s*[:\-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDocumentType(text: string): string {
  if (/aadhaar|uidai|unique\s+identification/i.test(text)) return "Aadhaar";
  if (/election|elector|voter/i.test(text)) return "Voter ID";
  if (/\bpan\b|income\s+tax/i.test(text)) return "PAN";
  if (/driving|licence|license|rto/i.test(text)) return "Driving License";
  return "Other";
}

function normalizeDob(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return "";
  let [, d, mo, y] = m;
  if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
  return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function normalizeGender(raw: string): string {
  const g = raw.trim().toLowerCase();
  if (g === "m" || g === "male") return "male";
  if (g === "f" || g === "female") return "female";
  return "";
}

/**
 * Parse raw OCR text into the subset of IdCardOcr fields Form F cares about
 * (guardian/husband name + address + a few extras).
 */
export function parseIdCardText(rawText: string): ParsedIdCardText {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2);

  let guardianName = "";
  // Prefer father/husband/guardian labels over a bare "Name:" line (which is
  // usually the card holder's own name on Aadhaar).
  const preferredNameRes = [
    /(?:father|husband|guardian)['’]?\s*(?:s\s*)?name\s*[:\-]?\s*(.+)$/i,
    /(?:father|husband)\s+name\s*[:\-]?\s*(.+)$/i,
    /(?:s\/o|w\/o|d\/o|c\/o|so|wo|do|co)\s*[:\-]?\s*(.+)$/i,
  ];
  for (const re of preferredNameRes) {
    for (const line of lines) {
      const m = line.match(re);
      if (m?.[1]) {
        const cleaned = cleanName(m[1]);
        if (cleaned.length >= 2) {
          guardianName = cleaned;
          break;
        }
      }
    }
    if (guardianName) break;
  }
  if (!guardianName) {
    for (const line of lines) {
      const m = line.match(/^name\s*[:\-]\s*(.+)$/i);
      if (m?.[1]) {
        const cleaned = cleanName(m[1]);
        if (cleaned.length >= 2) {
          guardianName = cleaned;
          break;
        }
      }
    }
  }
  // Fallback: first line that looks like a person's name (2–4 Capitalized words)
  if (!guardianName) {
    const nameish = lines.find((l) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(l));
    if (nameish) guardianName = nameish;
  }

  let address = "";
  const addrIdx = lines.findIndex((l) => ADDRESS_LABEL_RE.test(l));
  if (addrIdx >= 0) {
    const chunk = [lines[addrIdx].replace(/^.*?(?:address)\s*[:\-]?\s*/i, ""), ...lines.slice(addrIdx + 1, addrIdx + 4)]
      .map((l) => l.trim())
      .filter(Boolean);
    address = chunk.join(", ").replace(/\s+,/g, ",").trim();
  }

  const dobMatch = rawText.match(DOB_RE);
  const genderMatch = rawText.match(GENDER_RE);
  const aadhaar = rawText.match(AADHAAR_RE)?.[1]?.replace(/\s/g, "") ?? "";
  const voter = rawText.match(VOTER_RE)?.[1] ?? "";
  const pan = rawText.match(PAN_RE)?.[1] ?? "";
  const idNumber = aadhaar || voter || pan;

  const foundCount = [guardianName, address, idNumber].filter(Boolean).length;
  const confidence: "low" | "medium" = foundCount >= 2 ? "medium" : "low";
  // Cap below the Form F auto-fill threshold (95) so Tesseract never
  // silently overwrites form fields — staff must click "Use this".
  const confidencePercent = foundCount >= 2 ? 70 : foundCount === 1 ? 45 : 20;

  return {
    guardianName,
    address,
    documentType: detectDocumentType(rawText),
    dob: dobMatch ? normalizeDob(dobMatch[1]) : "",
    gender: genderMatch ? normalizeGender(genderMatch[1]) : "",
    idNumber,
    confidence,
    confidencePercent,
  };
}
