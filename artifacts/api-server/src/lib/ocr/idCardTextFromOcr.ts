/**
 * Map Paddle OCR + deterministic parse into IdCardOcrResult for Form F compatibility.
 */

import type { IdCardOcrResult } from "@workspace/integrations-gemini-ai";

export interface IdFieldsFromText {
  guardianName: string;
  address: string;
  documentType: string;
  dob: string;
  gender: string;
  idNumber: string;
  confidencePercent: number;
}

/** Server-side port of diagnostic-erp idCardTextParser heuristics (keep in sync). */
export function parseIdCardTextServer(rawText: string): IdFieldsFromText {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2);

  let guardianName = "";
  const preferredNameRes = [
    /(?:father|husband|guardian)['']?\s*(?:s\s*)?name\s*[:\-]?\s*(.+)$/i,
    /(?:father|husband)\s+name\s*[:\-]?\s*(.+)$/i,
    /(?:s\/o|w\/o|d\/o|c\/o|so|wo|do|co)\s*[:\-]?\s*(.+)$/i,
  ];
  for (const re of preferredNameRes) {
    for (const line of lines) {
      const m = line.match(re);
      if (m?.[1]) {
        guardianName = m[1]
          .replace(/^(?:father|husband|guardian|name|s\/o|w\/o|d\/o)\s*[:\-]?\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();
        if (guardianName) break;
      }
    }
    if (guardianName) break;
  }
  if (!guardianName) {
    for (const line of lines) {
      const m = line.match(/^name\s*[:\-]?\s*(.+)$/i);
      if (m?.[1]) {
        guardianName = m[1].replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  let address = "";
  const addrIdx = lines.findIndex((l) => /(?:address|village|vtc|dist(?:rict)?|state|pin(?:code)?)\b/i.test(l));
  if (addrIdx >= 0) {
    address = lines
      .slice(addrIdx, addrIdx + 4)
      .join(", ")
      .replace(/^(?:address)\s*[:\-]?\s*/i, "")
      .trim();
  }

  let documentType = "Other";
  const joined = lines.join(" ");
  if (/aadhaar|uidai|unique\s+identification/i.test(joined)) documentType = "Aadhaar";
  else if (/election|elector|voter/i.test(joined)) documentType = "Voter ID";
  else if (/\bpan\b|income\s+tax/i.test(joined)) documentType = "PAN";
  else if (/driving|licence|license|rto/i.test(joined)) documentType = "Driving License";

  let dob = "";
  const dobM = joined.match(/\b(?:dob|date\s*of\s*birth|yob)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4})\b/i);
  if (dobM?.[1]) {
    const s = dobM[1];
    if (/^\d{4}$/.test(s)) dob = `${s}-01-01`;
    else {
      const p = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (p) {
        let [, d, mo, y] = p;
        if (y!.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
        dob = `${y!.padStart(4, "0")}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      }
    }
  }

  let gender = "";
  const gM = joined.match(/\b(?:sex|gender)\s*[:\-]?\s*(male|female|m|f)\b/i);
  if (gM?.[1]) {
    const g = gM[1].toLowerCase();
    gender = g === "m" || g === "male" ? "male" : g === "f" || g === "female" ? "female" : "";
  }

  let idNumber = "";
  const aadhaar = joined.match(/\b(\d{4}\s?\d{4}\s?\d{4})\b/);
  const voter = joined.match(/\b([A-Z]{3}\d{7})\b/);
  const pan = joined.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  if (aadhaar) idNumber = aadhaar[1]!.replace(/\s/g, "");
  else if (voter) idNumber = voter[1]!;
  else if (pan) idNumber = pan[1]!;

  const filled = [guardianName, address, dob, gender, idNumber].filter(Boolean).length;
  const confidencePercent = filled >= 4 ? 88 : filled >= 2 ? 72 : filled >= 1 ? 55 : 20;

  return { guardianName, address, documentType, dob, gender, idNumber, confidencePercent };
}

export function idFieldsToOcrResult(fields: IdFieldsFromText, extras?: {
  ocrProvider?: string;
  meanConfidence?: number;
}): IdCardOcrResult {
  const pct = extras?.meanConfidence != null
    ? Math.round(extras.meanConfidence * 100)
    : fields.confidencePercent;
  const band = pct >= 85 ? "high" : pct >= 70 ? "medium" : "low";
  return {
    guardianName: fields.guardianName,
    address: fields.address,
    documentType: fields.documentType,
    confidence: band,
    confidencePercent: pct,
    ocrProvider: extras?.ocrProvider ?? "paddle",
    dob: fields.dob || undefined,
    gender: fields.gender || undefined,
    idNumber: fields.idNumber || undefined,
    fieldConfidence: {
      name: fields.guardianName ? pct : 0,
      address: fields.address ? Math.max(0, pct - 5) : 0,
      dob: fields.dob ? pct : 0,
      gender: fields.gender ? pct : 0,
      idNumber: fields.idNumber ? pct : 0,
    },
  } as IdCardOcrResult;
}