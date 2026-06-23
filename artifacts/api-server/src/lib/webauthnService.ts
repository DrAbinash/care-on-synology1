/**
 * webauthnService.ts
 * FIDO2 / WebAuthn staff authentication service.
 * Registration + authentication flow for YubiKey / security-key / platform authenticator.
 */
import { db } from "@workspace/db";
import { webauthnCredentialsTable, usersTable, portalSessionsTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import crypto from "node:crypto";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const challengeStore = new Map<string, { expiresAt: number; userId?: number }>();
function gc() {
  const now = Date.now();
  for (const [k, v] of challengeStore) if (v.expiresAt < now) challengeStore.delete(k);
}

export function storeChallenge(challenge: string, userId?: number) {
  gc();
  challengeStore.set(challenge, { expiresAt: Date.now() + CHALLENGE_TTL_MS, userId });
}

export function consumeChallenge(challenge: string): { userId?: number } | null {
  const entry = challengeStore.get(challenge);
  if (!entry || entry.expiresAt < Date.now()) return null;
  challengeStore.delete(challenge);
  return { userId: entry.userId };
}

export async function getCredentialsForUser(userId: number) {
  return db.select().from(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, userId));
}

export async function getCredentialById(credentialId: string) {
  const [row] = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.credentialId, credentialId));
  return row ?? null;
}

export async function saveCredential(
  userId: number,
  credentialId: string,
  publicKey: string,
  counter: number,
  deviceName?: string,
  transports?: string[],
) {
  const [row] = await db
    .insert(webauthnCredentialsTable)
    .values({
      userId,
      credentialId,
      publicKey,
      counter,
      deviceName: deviceName ?? null,
      transports: transports ? JSON.stringify(transports) : null,
    })
    .onConflictDoUpdate({
      target: webauthnCredentialsTable.credentialId,
      set: { publicKey, counter, lastUsedAt: new Date(), updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function deleteCredential(credId: number) {
  await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.id, credId));
}

export async function updateCredentialCounter(credId: number, counter: number) {
  await db
    .update(webauthnCredentialsTable)
    .set({ counter, lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(webauthnCredentialsTable.id, credId));
}

export async function createWebAuthnSession(userId: number, userName: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  await db.insert(portalSessionsTable).values({
    token,
    subjectId: userId,
    subjectName: userName,
    scope: "staff",
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return token;
}

export function rpFromReq(req: { headers: Record<string, unknown> }): { rpID: string; origin: string } {
  const fwdHost = String(req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost");
  const proto = String(req.headers["x-forwarded-proto"] ?? "https");
  const host = fwdHost.split(",")[0].trim();
  const rpID = host.split(":")[0];
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}
