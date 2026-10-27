/**
 * Short-lived, file-bound access grants for stored radiology key images.
 *
 * WHY A GRANT AND NOT THE SESSION TOKEN
 * -------------------------------------
 * A viewport capture is a clinical picture: the modality can burn the patient's
 * name, UHID or accession into the raster itself, and nothing in CARE inspects
 * pixels, so the file has to be treated as PHI. It therefore cannot sit on the
 * public `/uploads` static mount. But `<img>` cannot send an Authorization
 * header, which leaves two ways to authenticate the request: put the staff
 * session token in the URL, or put a credential in the URL that is worth much
 * less once it is there.
 *
 * The session token is the wrong one. It is long-lived (hours to days, until
 * idle expiry), it unlocks the whole staff session — every clinical and billing
 * endpoint that the user's permissions allow, not one picture — and it is not
 * bound to a file. Browser history, the back/forward cache, any future access
 * log, a shoulder-surfed screenshot of a DevTools network tab and any `Referer`
 * that leaks on a page reload all become carriers of a live credential.
 *
 * So the URL carries a single-purpose grant instead:
 *  - bound to exactly one filename (a grant for `a.jpg` cannot fetch `b.jpg`);
 *  - expires in minutes (`KEY_IMAGE_GRANT_TTL_SECONDS`), not session-length;
 *  - minted only by an authenticated staff session that already passed
 *    `requireStaffPermission("/radiology")` at the route mount, so the minting
 *    call is where authentication and authorization happen;
 *  - useless anywhere else in the API — it names a file, not a user.
 *
 * The scheme is the one CARE already uses for expiring share links
 * (`whatsappShareToken.ts`): base64url JSON payload, HMAC-SHA256 over it,
 * constant-time compare, and the SAME already-deployed signing secret
 * (`SESSION_SECRET`, falling back to `JWT_SECRET`) resolved through
 * `resolveShareSecret()` — so this adds no new secret, no table, no session
 * type and no second authentication subsystem. It is a separate module only
 * because that one is day-granular and hard-restricted to report/bill kinds.
 *
 * What this does NOT claim: a grant that is still valid can be replayed by
 * anyone who sees the URL for up to `KEY_IMAGE_GRANT_TTL_SECONDS`. That is the
 * accepted trade-off for delivering PHI-bearing images to `<img>` elements, and
 * it is why the TTL is minutes and the response is `Cache-Control: private`.
 */
import crypto from "node:crypto";
import { resolveShareSecret } from "./whatsappShareToken";

/** Ten minutes: long enough to open and print a report, too short to matter in history. */
export const KEY_IMAGE_GRANT_TTL_SECONDS = 600;

export const KEY_IMAGE_GRANT_QUERY_PARAM = "kimg";

export type KeyImageGrantReason =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "file_mismatch"
  | "secret_unavailable";

export type KeyImageGrant = { token: string; expiresAt: Date; fileKey: string };

type GrantPayload = { f: string; exp: number };

function b64url(value: Buffer | string): string {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buf.toString("base64url");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function sign(body: string, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(body).digest();
}

/**
 * Mint a grant for one stored file name. Throws when no signing secret is
 * configured — the caller must fail closed rather than hand out an unverifiable
 * URL, and a missing `SESSION_SECRET` is a deployment fault, not a user one.
 */
export function mintKeyImageGrant(
  fileKey: string,
  opts?: { ttlSeconds?: number; nowMs?: number; secret?: string },
): KeyImageGrant {
  const file = String(fileKey ?? "").trim();
  if (!file) throw new Error("mintKeyImageGrant requires a file name");
  const secret = opts?.secret ?? resolveShareSecret();
  const nowMs = opts?.nowMs ?? Date.now();
  const ttl = Math.max(1, Math.floor(opts?.ttlSeconds ?? KEY_IMAGE_GRANT_TTL_SECONDS));
  const exp = Math.floor(nowMs / 1000) + ttl;
  const body = b64url(JSON.stringify({ f: file, exp } satisfies GrantPayload));
  const token = `${body}.${b64url(sign(body, secret))}`;
  return { token, expiresAt: new Date(exp * 1000), fileKey: file };
}

export type VerifyKeyImageGrantResult =
  | { ok: true; fileKey: string; expiresAt: Date }
  | { ok: false; reason: KeyImageGrantReason };

/**
 * Verify a grant against the file actually being requested. Every failure path
 * is a refusal; none of them fall through to an unauthenticated read.
 */
export function verifyKeyImageGrant(
  token: string | null | undefined,
  requestedFileKey: string,
  opts?: { nowMs?: number; secret?: string },
): VerifyKeyImageGrantResult {
  if (!token) return { ok: false, reason: "missing" };
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [body, sigB64] = token.split(".");
  if (!body || !sigB64) return { ok: false, reason: "malformed" };

  let secret: string;
  try {
    secret = opts?.secret ?? resolveShareSecret();
  } catch {
    return { ok: false, reason: "secret_unavailable" };
  }

  const expected = sign(body, secret);
  const provided = fromB64url(sigB64);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: GrantPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as GrantPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload?.f !== "string" || !Number.isFinite(payload?.exp)) {
    return { ok: false, reason: "malformed" };
  }

  const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  if (payload.exp < nowSec) return { ok: false, reason: "expired" };
  if (payload.f !== String(requestedFileKey ?? "").trim()) {
    return { ok: false, reason: "file_mismatch" };
  }
  return { ok: true, fileKey: payload.f, expiresAt: new Date(payload.exp * 1000) };
}
