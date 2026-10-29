/**
 * Host-side Super Admin login that works BEFORE the USB plugin is loaded.
 * Registered ahead of the plugin gate so `/super-admin/login` never returns
 * "Super Admin plugin is not loaded."
 *
 * Intentionally STRICT (same bar as the original plugin login):
 *   - Exact display-name match only (case-insensitive trim)
 *   - No username / email / numeric-id aliases
 *   - No "wrong name + usbPin → still log in" fallback
 *   - Name is always required, even when usbPin is present
 *
 * usbPin only skips the database PIN check after the name has already matched
 * a super_admin row.
 *
 * When SUPER_ADMIN_REQUIRE_2FA is set, a valid authenticator code (or a single
 * use backup code) is required as well — see the block in /login for why that
 * step is its own switch rather than the ERP's require_admin_2fa flag.
 *
 * A FIDO2 security key can carry the whole secret half of this login:
 * POST /super-admin/key-login/begin hands out a challenge for the account's own
 * credentials, and the signed assertion comes back on the /login request. With
 * SUPER_ADMIN_REQUIRE_KEY set, that assertion is the only way in and no PIN is
 * accepted. The pen drive is still required, because the drive is where the
 * portal's own interface is read from.
 */
import { Router, type IRouter, type Request } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod/v4";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { db } from "@workspace/db";
import { usersTable, superAdminSessionsTable, webauthnCredentialsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { loginLimiter } from "../middleware/rateLimits";
import { hasTotpFactor, verifyTotpFactor } from "../lib/totpFactor";
import { usbGateFailure } from "../middleware/requireSuperAdminUsb";
import {
  consumeChallenge,
  getCredentialsForUser,
  rpFromReq,
  storeChallenge,
  updateCredentialCounter,
} from "../lib/webauthnService";
import { logger } from "../lib/logger";

export const superAdminHostAuthRouter: IRouter = Router();

const optionalPin = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    return s.length > 0 ? s : undefined;
  });

const LoginBody = z.object({
  name: z.string().trim().min(1, "Name is required"),
  pin: optionalPin,
  usbPin: optionalPin,
  totpCode: optionalPin,
  backupCode: optionalPin,
  webauthnChallenge: optionalPin,
  // The signed assertion, in the JSON shape WebAuthn hands the browser:
  // { response: { id, authenticatorData, clientDataJSON, signature, userHandle } }.
  keyAssertion: z.unknown().optional(),
}).refine((data) => {
  // Without usbPin, the database PIN (or pen-drive PIN typed into the PIN box) is required.
  // A security-key assertion counts as the secret instead — see verifySecurityKeyAssertion.
  if (!data.usbPin && !data.keyAssertion) return Boolean(data.pin?.length);
  return true;
}, { message: "PIN is required when usbPin is not provided", path: ["pin"] });

function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function isBcryptHash(value: string): boolean {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

async function verifyPin(plain: string, stored: string): Promise<boolean> {
  if (isBcryptHash(stored)) return bcrypt.compare(plain, stored);
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getUsbPinEnv(): string | null {
  const v = process.env["SUPER_ADMIN_USB_PIN"];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function isUsbPinEnforced(): boolean {
  return getUsbPinEnv() !== null;
}

/**
 * Opt-in second factor for the Super Admin login. Anything other than an empty
 * value counts as on, so `1`/`true`/`yes` all work and an absent line — the
 * state of every deployment today — keeps the door as it was.
 */
function isSuperAdmin2FaRequired(): boolean {
  const v = process.env["SUPER_ADMIN_REQUIRE_2FA"];
  return typeof v === "string" && v.trim().length > 0 && !/^(0|false|no|off)$/i.test(v.trim());
}

function usbPinMatches(presented: string): boolean {
  const expected = getUsbPinEnv();
  if (!expected) return false;
  const pinBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  if (pinBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(pinBuf, expectedBuf);
}

/**
 * Opt-in: the security key replaces the PIN half of this login. Kept separate from
 * `SUPER_ADMIN_REQUIRE_2FA` because they answer different questions — one asks for a
 * code from an app, this one asks for a tap on a FIDO2 stick and stops accepting any
 * PIN. Both may be on: key, then code.
 *
 * Emptying the line reverses it, and unlike a database flag it is not behind the
 * login it would lock out, so a mistake here is recoverable on the server.
 */
function isSuperAdminKeyRequired(): boolean {
  const v = process.env["SUPER_ADMIN_REQUIRE_KEY"];
  return typeof v === "string" && v.trim().length > 0 && !/^(0|false|no|off)$/i.test(v.trim());
}

/**
 * One sentence for every refusal that means "that name cannot sign in with a key":
 * unknown account, not a super admin, no credential enrolled. This endpoint answers
 * before any PIN is typed, so it must not confirm which display names exist.
 */
const NO_KEY_MESSAGE = "No security key can be used for that account.";

type KeyCheck =
  | { ok: true; credentialRowId: number }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * POST /super-admin/key-login/begin hands out a challenge for this account's own
 * credentials; the browser signs it and the assertion comes back on the ordinary
 * /login request (the sign-in form itself is the bundle read off the pen drive, so
 * it is not rebuilt for this). Verification happens there, in
 * verifySecurityKeyAssertion().
 *
 * The path is deliberately NOT under /login: the host page wraps window.fetch and
 * matches that prefix to recognise a sign-in, so a "/login-key" name would make the
 * challenge request look like a login attempt to its own shim.
 */
superAdminHostAuthRouter.post("/key-login/begin", loginLimiter, async (req, res): Promise<void> => {
  const gateFailure = usbGateFailure(req);
  if (gateFailure) {
    res.status(gateFailure.status).json(gateFailure.body);
    return;
  }

  const name = String((req.body as { name?: unknown } | undefined)?.name ?? "").trim();
  let user: { id: number; role: string } | undefined;
  if (name) {
    [user] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable)
      .where(and(sql`lower(${usersTable.name}) = lower(${name})`, eq(usersTable.isActive, true)))
      .limit(1);
  }
  if (!user || user.role !== "super_admin") {
    res.status(401).json({ error: NO_KEY_MESSAGE });
    return;
  }

  const credentials = await getCredentialsForUser(user.id);
  if (!credentials.length) {
    res.status(401).json({ error: NO_KEY_MESSAGE });
    return;
  }

  const { rpID } = rpFromReq(req);
  const opts = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? (JSON.parse(c.transports) as Array<"usb" | "nfc" | "ble" | "internal" | "hybrid">) : undefined,
    })),
  });
  storeChallenge(opts.challenge, user.id, "super_admin_login");
  res.json(opts);
});

/**
 * A signed challenge from the account's own security key counts as the secret that
 * proves he is standing there — which is what the PIN was supposed to be, and is not:
 * `SUPER_ADMIN_USB_PIN` is one shared four-digit value that skips the personal PIN,
 * and a copy of it is in this repository. A FIDO2 credential is a public key, so
 * nothing stored here can be replayed to sign in.
 */
async function verifySecurityKeyAssertion(
  req: Request,
  user: { id: number },
  challenge: string | undefined,
  assertion: unknown,
): Promise<KeyCheck> {
  if (!challenge || !assertion) {
    return { ok: false, status: 400, body: { error: "Incomplete security key response. Tap the key again.", requiresKey: true } };
  }
  const consumed = consumeChallenge(challenge, "super_admin_login");
  if (!consumed || consumed.userId !== user.id) {
    return { ok: false, status: 401, body: { error: "That security key request has expired. Tap the key again.", requiresKey: true } };
  }

  const raw = assertion as { id?: string; response?: Record<string, unknown> };
  const credentialId = raw.id;
  if (!credentialId) {
    return { ok: false, status: 400, body: { error: "The security key sent no credential id.", requiresKey: true } };
  }

  const cred = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.credentialId, credentialId))
    .limit(1)
    .then((rows) => rows[0]);
  // Same sentence whether the credential does not exist or belongs to somebody else:
  // this must not become a way to ask whether a given key id is enrolled.
  if (!cred || cred.userId !== user.id) {
    return { ok: false, status: 401, body: { error: NO_KEY_MESSAGE, requiresKey: true } };
  }

  const { rpID, origin } = rpFromReq(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")),
        counter: cred.counter,
      },
    });
  } catch (e) {
    return { ok: false, status: 401, body: { error: e instanceof Error ? e.message : "The security key signature was not accepted.", requiresKey: true } };
  }
  if (!verification.verified) {
    return { ok: false, status: 401, body: { error: "The security key signature was not accepted.", requiresKey: true } };
  }

  await updateCredentialCounter(cred.id, verification.authenticationInfo?.newCounter ?? cred.counter);
  return { ok: true, credentialRowId: cred.id };
}

superAdminHostAuthRouter.post("/login", loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: first, details: parsed.error.issues });
    return;
  }
  let { name, pin, usbPin, totpCode, backupCode, webauthnChallenge, keyAssertion } = parsed.data;

  // Pen-drive PIN typed into the PIN box (common after auto-login UI failure)
  // must count as usbPin auto-login — 2321 is SUPER_ADMIN_USB_PIN, not the DB PIN.
  if (!usbPin && pin && isUsbPinEnforced() && usbPinMatches(pin)) {
    usbPin = pin;
  }

  // STRICT: exact display name only.
  const [user] = await db.select().from(usersTable)
    .where(and(sql`lower(${usersTable.name}) = lower(${name})`, eq(usersTable.isActive, true)))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied — not a super admin" });
    return;
  }

  // The pen drive must be present for a host login, with no exception. Two things
  // used to excuse it here: remote_login_enabled — a column nothing in the
  // application could ever set, so the only way to earn it was a direct SQL UPDATE
  // — and an unset SUPER_ADMIN_USB_KEY, which docker-compose.yml forwards as an
  // empty string and the old code read as "gate is off". Either one turned the
  // physical key into theatre; a server that cannot verify the drive now refuses,
  // and says why.
  //
  // This is the same helper every other Super Admin door calls, so the three
  // answers are the same three sentences. The route used to test the header itself
  // and answer "USB key required" for a wrong key as well as a missing one, which
  // sends an operator looking for the drive when the drive is in their pocket and
  // the environment is what changed — the exact confusion during a key rotation.
  const gateFailure = usbGateFailure(req);
  if (gateFailure) {
    res.status(gateFailure.status).json(gateFailure.body);
    return;
  }

  // ── Security key ──────────────────────────────────────────────────────────────
  // Verified before the PIN branches, so SUPER_ADMIN_REQUIRE_KEY can refuse every
  // PIN-based way in. A tap on the stick is what stands in for the secret here: the
  // alternative is `SUPER_ADMIN_USB_PIN`, one shared four-digit value that skips the
  // personal PIN entirely and sits in this repository as a committed line.
  let keyVerified = false;
  if (webauthnChallenge || keyAssertion) {
    const check = await verifySecurityKeyAssertion(req, user, webauthnChallenge, keyAssertion);
    if (!check.ok) {
      res.status(check.status).json(check.body);
      return;
    }
    keyVerified = true;
  }

  if (isSuperAdminKeyRequired() && !keyVerified) {
    // The way out has to be named, because on this switch the PIN no longer opens
    // anything and the screen that enrols a key is inside the ERP, not here.
    const enrolled = await getCredentialsForUser(user.id);
    if (!enrolled.length) {
      res.status(403).json({
        error:
          "Super Admin login requires a security key, and none is enrolled for this account. Sign in to the ERP with your PIN and open Settings → Security to register one.",
        requiresKeyEnrollment: true,
      });
      return;
    }
    res.status(401).json({ error: "Sign in with your security key.", requiresKey: true });
    return;
  }

  // usbPin (or PIN box matching SUPER_ADMIN_USB_PIN) skips the DB PIN check.
  let autoLogin = keyVerified;
  if (!autoLogin && isUsbPinEnforced() && usbPin && usbPinMatches(usbPin)) {
    autoLogin = true;
    logger.info({ userId: user.id, userName: user.name }, "Auto-login via usbPin (host auth)");
  }

  if (!autoLogin) {
    if (!pin || !pin.length) {
      res.status(401).json({ error: "PIN is required" });
      return;
    }
    if (!user.pin) {
      res.status(401).json({ error: "No PIN configured for this user" });
      return;
    }
    const matches = await verifyPin(pin, user.pin);
    if (!matches) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (!isBcryptHash(user.pin)) {
      const hashed = await bcrypt.hash(pin, 12);
      await db.update(usersTable).set({ pin: hashed }).where(eq(usersTable.id, user.id));
    }
  }

  // ── Second factor ─────────────────────────────────────────────────────────
  // Until now this route was the one door in the product that minted a full
  // 8-hour Super Admin session from possession of an object (the pen drive) plus
  // a secret, with nothing proving the holder was present at that moment.
  //
  // The switch is its own environment variable rather than the ERP's
  // `clinic_settings.require_admin_2fa`, and that choice is deliberate. That
  // setting is a database value toggled in the clinic's own Settings screen and
  // governs the counter's admin login; reusing it would couple two unrelated
  // decisions and would start enforcing here the instant this deployed, on every
  // deployment, including one whose paired pen drive predates the code field.
  // Default-off means the server can be deployed first and the operator turns it
  // on after pairing an authenticator — and emptying the line reverses it.
  let factorUsed: "totp" | "backup" | "none" = "none";
  if (isSuperAdmin2FaRequired()) {
    const label = user.username || user.email || "";
    if (!hasTotpFactor({ id: user.id, label, totpEnabled: user.totpEnabled, totpSecret: user.totpSecret })) {
      res.status(403).json({
        error:
          "Super Admin login requires two-factor authentication. Enrol an authenticator app by signing in to the ERP as this account and opening Settings → Security, then sign in here again.",
        requiresTotpEnrollment: true,
      });
      return;
    }
    const factor = await verifyTotpFactor(
      {
        id: user.id,
        label,
        totpEnabled: user.totpEnabled,
        totpSecret: user.totpSecret,
        totpBackupCodes: user.totpBackupCodes,
      },
      { code: totpCode, backupCode },
    );
    if (!factor.ok) {
      // Same 401 shape either way, but `requiresTotp` is what the caller keys on
      // to decide it must ask for a code rather than report a bad PIN.
      res.status(401).json({
        error: factor.error === "missing"
          ? "Authentication code required"
          : "Invalid authentication code",
        requiresTotp: true,
      });
      return;
    }
    factorUsed = factor.via;
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

  await db.insert(superAdminSessionsTable).values({
    token,
    userId: user.id,
    userName: user.name,
    expiresAt,
    isActive: true,
  });

  // Never the code, the PIN, or the key — only which factor carried the login.
  logger.info(
    {
      userId: user.id,
      userName: user.name,
      factor: factorUsed,
      keyLogin: keyVerified,
      twoFactorRequired: isSuperAdmin2FaRequired(),
      keyRequired: isSuperAdminKeyRequired(),
    },
    "Super Admin host session issued",
  );

  res.json({ token, userName: user.name, expiresAt: expiresAt.toISOString() });
});
