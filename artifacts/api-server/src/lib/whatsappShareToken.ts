/**
 * Signed expiring share tokens for WhatsApp Delivery v2.
 * HMAC-SHA256 with SESSION_SECRET (install secret). No DB row required.
 * Payload: kind + recordId + exp (unix seconds). PHI-free URL fragment.
 */
import crypto from "node:crypto";

export type ShareKind = "report" | "bill";

export type ShareTokenPayload = {
  kind: ShareKind;
  recordId: number;
  exp: number; // unix seconds
};

const DEFAULT_TTL_DAYS = 7;

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function resolveShareSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    (env.SESSION_SECRET && env.SESSION_SECRET.trim())
    || (env.JWT_SECRET && env.JWT_SECRET.trim())
    || "";
  if (!secret) {
    throw new Error("SESSION_SECRET (or JWT_SECRET) must be set to mint share tokens");
  }
  return secret;
}

export function mintShareToken(
  kind: ShareKind,
  recordId: number,
  opts?: { ttlDays?: number; nowMs?: number; secret?: string },
): { token: string; expiresAt: Date; expiryDays: number } {
  const days = Math.max(1, opts?.ttlDays ?? DEFAULT_TTL_DAYS);
  const nowMs = opts?.nowMs ?? Date.now();
  const exp = Math.floor(nowMs / 1000) + days * 24 * 60 * 60;
  const payload: ShareTokenPayload = { kind, recordId: Number(recordId), exp };
  const body = b64url(JSON.stringify(payload));
  const secret = opts?.secret ?? resolveShareSecret();
  const sig = crypto.createHmac("sha256", secret).update(body).digest();
  return {
    token: `${body}.${b64url(sig)}`,
    expiresAt: new Date(exp * 1000),
    expiryDays: days,
  };
}

export type VerifyShareResult =
  | { ok: true; payload: ShareTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "kind_mismatch" };

export function verifyShareToken(
  token: string | null | undefined,
  opts?: { expectKind?: ShareKind; nowMs?: number; secret?: string },
): VerifyShareResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [body, sigB64] = token.split(".");
  if (!body || !sigB64) return { ok: false, reason: "malformed" };

  let secret: string;
  try {
    secret = opts?.secret ?? resolveShareSecret();
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: ShareTokenPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as ShareTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.kind !== "report" && payload.kind !== "bill") {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(payload.recordId) || payload.recordId <= 0) {
    return { ok: false, reason: "malformed" };
  }
  if (opts?.expectKind && payload.kind !== opts.expectKind) {
    return { ok: false, reason: "kind_mismatch" };
  }
  const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSec) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
