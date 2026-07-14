/**
 * Aadhaar QR decode/parse for ID-card capture, with a strict fallback chain:
 * 1. Aadhaar QR data (this module)
 * 2. OCR (geminiOcrIdCard via /api/form-f/upload-id — unchanged, existing)
 * 3. Manual entry (existing editable form fields)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HONEST SCOPE — read before wiring this into anything:
 *
 * Aadhaar cards printed since ~2019 carry UIDAI's "Secure QR" code: a
 * zlib-deflate-compressed, digitally-signed BINARY payload (delimiter-
 * separated fields, RSA signature appended). Verifying that signature
 * requires UIDAI's public key and is out of scope here — this module does
 * NOT implement the binary Secure QR format at all. Cards printed before
 * ~2019 (still common in circulation) carry a plain-text XML QR
 * (`<PrintLetterBarcodeData ... />`), which decodes trivially with no
 * cryptography — THIS is the format actually implemented below, matching
 * the same parsing approach already used by
 * artifacts/clinic-site/src/pages/scan-mobile.tsx for the mobile capture
 * flow (generalized here for reuse in the staff ERP).
 *
 * When a scanned QR is detected but doesn't match the legacy XML shape
 * (e.g. it's the newer binary Secure QR, or some other QR entirely), this
 * module reports `format: "unsupported"` rather than guessing — the caller
 * should fall through to OCR, exactly as the priority order above states.
 * Do not represent this as "Aadhaar Secure QR support" without qualifying
 * that the binary format is unsupported.
 */
import jsQR from "jsqr";

export interface AadhaarQrFields {
  name: string;
  gender: string;
  dob: string;
  address: string;
  /** Last-4-masked by default — see maskAadhaarNumber(). Full UID is never returned from this parser. */
  uidMasked: string;
}

export type AadhaarQrDecodeResult =
  | { format: "legacy-xml"; fields: AadhaarQrFields }
  | { format: "unsupported"; rawSample: string }
  | { format: "none" };

/** Mask an Aadhaar number to only the last 4 digits, e.g. "XXXX-XXXX-1234". Never store/display the full number. */
export function maskAadhaarNumber(uid: string): string {
  const digits = uid.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX-XXXX-XXXX";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

function parseLegacyXmlFields(xml: string): AadhaarQrFields {
  const getAttr = (attr: string) => {
    const m = xml.match(new RegExp(`${attr}="([^"]*)"`));
    return m ? m[1] : "";
  };

  const name = getAttr("name");
  const genderRaw = getAttr("gender") || getAttr("gnd");
  const yob = getAttr("yob");
  const dob = getAttr("dob");
  const uid = getAttr("uid");

  const co = getAttr("co");
  const house = getAttr("house");
  const street = getAttr("street");
  const loc = getAttr("loc");
  const vtc = getAttr("vtc");
  const dist = getAttr("dist");
  const state = getAttr("state");
  const pc = getAttr("pc");

  let address = [house, street, loc, vtc, dist, state, pc].filter(Boolean).join(", ");
  if (co) address = `C/O ${co}, ${address}`;

  return {
    name,
    gender: genderRaw === "M" ? "Male" : genderRaw === "F" ? "Female" : genderRaw,
    dob: dob || (yob ? `01/01/${yob}` : ""),
    uidMasked: uid ? maskAadhaarNumber(uid) : "",
    address,
  };
}

function isLegacyAadhaarXml(text: string): boolean {
  return text.includes("PrintLetterBarcodeData") || text.trim().startsWith("<?xml");
}

/** Decode a QR code from raw image pixel data (already drawn to a canvas). Returns "none" if no QR is found at all. */
export function decodeQrFromImageData(imageData: ImageData): AadhaarQrDecodeResult {
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
  if (!code?.data) return { format: "none" };

  if (isLegacyAadhaarXml(code.data)) {
    return { format: "legacy-xml", fields: parseLegacyXmlFields(code.data) };
  }
  return { format: "unsupported", rawSample: code.data.slice(0, 40) };
}

/** Convenience wrapper: decode a QR code from an already-captured image Blob. */
export async function decodeQrFromBlob(blob: Blob): Promise<AadhaarQrDecodeResult> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { format: "none" };
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodeQrFromImageData(imageData);
}
