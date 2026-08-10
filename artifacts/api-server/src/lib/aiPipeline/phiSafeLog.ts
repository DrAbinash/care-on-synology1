/**
 * PHI-safe logging helpers — never emit full patient identifiers in ordinary logs.
 */

export function maskIdNumber(id: string | null | undefined): string {
  const s = (id || "").replace(/\s+/g, "");
  if (s.length <= 4) return s ? "****" : "";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

export function redactPhiSnippet(text: string, maxLen = 80): string {
  let t = (text || "").slice(0, maxLen);
  t = t.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "****-****-****");
  t = t.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "*****####*");
  t = t.replace(/\b[A-Z]{3}\d{7}\b/g, "***#######");
  return t;
}

export function hashIdentifier(value: string): string {
  // Simple non-crypto fingerprint for telemetry correlation (not for security)
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return `id_${(h >>> 0).toString(16)}`;
}

export function phiSafeOcrLog(parts: {
  engine?: string;
  pathUsed?: string;
  meanConfidence?: number;
  pageCount?: number;
  charCount?: number;
  warnings?: string[];
  model?: string;
  routingReason?: string;
}): Record<string, unknown> {
  return {
    engine: parts.engine,
    pathUsed: parts.pathUsed,
    meanConfidence: parts.meanConfidence,
    pageCount: parts.pageCount,
    charCount: parts.charCount,
    warnings: parts.warnings?.slice(0, 12),
    model: parts.model,
    routingReason: parts.routingReason,
    // Explicitly omit raw OCR text / names / addresses / full IDs
  };
}