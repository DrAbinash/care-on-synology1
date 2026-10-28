/**
 * clinicSettingsAdmin2fa.request.test.ts — "Require 2FA for admin accounts" must
 * not be switchable on behind a locked door.
 *
 * portal.ts:471 refuses staff-login with 403 for an admin whose totpEnabled is
 * false while this flag is set. The flag itself is written by the clinic settings
 * screen, which is only reachable by logging in. On 2026-10-28 the clinic's only
 * super admin saved that toggle ON while their own totp_enabled was still false
 * and could not get back into the hospital ERP; undoing it needed a manual UPDATE
 * through psql on the NAS. A source-text test would have been green the whole
 * time — the toggle was written exactly as the settings form asked.
 *
 * Only the false → true transition is refused, and these tests pin both halves of
 * that decision: the refusal that prevents the lockout, and the later save that
 * must NOT be refused once the requirement is already live.
 *
 * Runs against the shared clinic_settings row and restores what it found.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { db, clinicSettingsTable } from "@workspace/db";
import { usersTable, portalSessionsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { normalizeRole } from "../middleware/requireStaffAuth";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

let app: Express;

const marker = `vitest-2fa-${randomUUID()}`.slice(0, 28);
const userIds: number[] = [];
let token = "";
let originalRequireAdmin2fa: boolean | null = null;
/** A database built by apply-all-migrations has no clinic_settings row yet; the
 *  route creates one on first write. Tracked so the row is left as it was found. */
let createdSettingsRow = false;

async function makeAdmin(name: string, withTotp: boolean, role = "super_admin"): Promise<number> {
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `${marker}-${name}`,
      email: `${marker}-${name}@vitest.invalid`,
      username: `${marker}-${name}`,
      role,
      permissions: JSON.stringify(["/settings"]),
      pin: "0000",
      isActive: true,
      totpEnabled: withTotp,
    })
    .returning({ id: usersTable.id });
  userIds.push(user.id);
  return user.id;
}

function put(body: Record<string, unknown>) {
  return request(app).put("/api/clinic-settings").set("Authorization", `Bearer ${token}`).send(body);
}

describe.skipIf(!hasDatabaseUrl())("PUT /api/clinic-settings — admin 2FA cannot be enabled into a lockout", () => {
  beforeAll(async () => {
    app = await createTestApp();
    let [row] = await db.select().from(clinicSettingsTable).limit(1);
    if (!row) {
      const [created] = await db.insert(clinicSettingsTable).values({}).returning();
      row = created;
      createdSettingsRow = true;
    }
    originalRequireAdmin2fa = row.requireAdmin2fa;

    const adminId = await makeAdmin("no-totp", false);
    token = `${marker}-session`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: adminId,
      subjectName: `${marker}-no-totp`,
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  afterAll(async () => {
    // Put the shared row back exactly as found — deleted if this suite created it.
    const [row] = await db.select({ id: clinicSettingsTable.id }).from(clinicSettingsTable).limit(1);
    if (row) {
      if (createdSettingsRow) await db.delete(clinicSettingsTable).where(eq(clinicSettingsTable.id, row.id));
      else if (originalRequireAdmin2fa !== null) {
        await db
          .update(clinicSettingsTable)
          .set({ requireAdmin2fa: originalRequireAdmin2fa })
          .where(eq(clinicSettingsTable.id, row.id));
      }
    }
    await restoreEnrolments();
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  /** The suite writes the precondition itself instead of inheriting whatever the
   *  last test left in the shared row. */
  async function setFlag(value: boolean): Promise<void> {
    const [row] = await db.select({ id: clinicSettingsTable.id }).from(clinicSettingsTable).limit(1);
    await db.update(clinicSettingsTable).set({ requireAdmin2fa: value }).where(eq(clinicSettingsTable.id, row.id));
  }

  async function readFlag(): Promise<boolean> {
    const [row] = await db.select({ v: clinicSettingsTable.requireAdmin2fa }).from(clinicSettingsTable).limit(1);
    return row.v;
  }

  /**
   * Enrol every active admin in the database, not just this suite's fixture.
   *
   * The guard's predicate is over the whole users table, and CI runs ~90 request
   * suites against ONE database: any admin another suite leaves without TOTP would
   * decide these assertions instead of the code under test. Previous values are
   * recorded and put back in afterAll, so this neither inherits nor leaks state.
   */
  const priorTotp: Array<{ id: number; totpEnabled: boolean }> = [];
  async function enrolEveryActiveAdmin(): Promise<void> {
    const rows = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive, totpEnabled: usersTable.totpEnabled })
      .from(usersTable);
    const need = rows.filter((u) => u.isActive && !u.totpEnabled && ["admin", "super_admin"].includes(normalizeRole(u.role ?? "")));
    for (const u of need) priorTotp.push({ id: u.id, totpEnabled: u.totpEnabled });
    if (need.length) await db.update(usersTable).set({ totpEnabled: true }).where(inArray(usersTable.id, need.map((u) => u.id)));
  }

  async function restoreEnrolments(): Promise<void> {
    for (const u of priorTotp) await db.update(usersTable).set({ totpEnabled: u.totpEnabled }).where(eq(usersTable.id, u.id));
    priorTotp.length = 0;
  }

  test("refuses to turn the requirement on while an active admin has no TOTP", async () => {
    // Enrol everyone, then un-enrol exactly this suite's admin: CI shares one
    // database across ~90 request suites, and the refusal sentence carries a count.
    await enrolEveryActiveAdmin();
    await db.update(usersTable).set({ totpEnabled: false }).where(eq(usersTable.id, userIds[0]));
    await setFlag(false);

    const res = await put({ requireAdmin2fa: true });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.accountsWithoutTotp)).toBe(true);
    expect(res.body.accountsWithoutTotp).toContain(`${marker}-no-totp`);
    // The sentence must name what to do, not just that something was refused.
    expect(String(res.body.error)).toMatch(/TOTP/i);
    expect(String(res.body.error)).toMatch(/Security settings/i);
    // Singular wording, since one account is the common case: "1 … account still has".
    expect(String(res.body.error)).toMatch(/1 active admin account still has no TOTP/);
    expect(await readFlag(), "the refused flag must not have reached the row").toBe(false);
  });

  test("two unenrolled admins read in the plural and name both", async () => {
    const secondId = await makeAdmin("second-no-totp", false);
    await setFlag(false);

    const res = await put({ requireAdmin2fa: true });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/2 active admin accounts still have no TOTP/);
    expect(res.body.accountsWithoutTotp).toContain(`${marker}-no-totp`);
    expect(res.body.accountsWithoutTotp).toContain(`${marker}-second-no-totp`);

    await db.update(usersTable).set({ totpEnabled: true }).where(eq(usersTable.id, secondId));
  });

  test("still saves the other fields in that same request — the refusal is a refusal, not a partial write", async () => {
    await setFlag(false);
    const tagline = `${marker}-not-written`;

    const res = await put({ requireAdmin2fa: true, tagline });

    expect(res.status).toBe(400);
    expect(await readFlag()).toBe(false);
    const [after] = await db.select({ tagline: clinicSettingsTable.tagline }).from(clinicSettingsTable).limit(1);
    // Everything or nothing: the bundled save must not land half-applied.
    expect(after.tagline).not.toBe(tagline);
  });

  test("allows the switch once every active admin has TOTP", async () => {
    await enrolEveryActiveAdmin();
    await setFlag(false);

    const res = await put({ requireAdmin2fa: true });
    expect(res.status).toBe(200);
    expect(await readFlag()).toBe(true);
  });

  test("a deactivated admin with no TOTP does not hold the switch shut", async () => {
    const goneId = await makeAdmin("left-the-clinic", false);
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, goneId));
    await enrolEveryActiveAdmin();
    await setFlag(false);

    const res = await put({ requireAdmin2fa: true });
    expect(res.status).toBe(200);
    expect(res.body.accountsWithoutTotp).toBeUndefined();
  });

  test("an admin whose role is stored with different capitalisation still counts", async () => {
    // portal.ts:471 compares the NORMALISED role, and requireStaffAuth normalises
    // "Super Admin"/"superadmin" to super_admin. A SQL `role IN ('admin',
    // 'super_admin')` would miss this row, refuse the wrong set of accounts, and
    // let the lockout through — the same door the guard exists to close.
    await enrolEveryActiveAdmin();
    const oddId = await makeAdmin("mixed-case-role", false, "Super Admin");
    await setFlag(false);

    const res = await put({ requireAdmin2fa: true });
    expect(res.status).toBe(400);
    expect(res.body.accountsWithoutTotp).toContain(`${marker}-mixed-case-role`);

    await db.update(usersTable).set({ totpEnabled: true }).where(eq(usersTable.id, oddId));
    expect((await put({ requireAdmin2fa: true })).status).toBe(200);
  });

  test("a later save is not blocked once the requirement is already live", async () => {    // The narrowness is deliberate: this request did not create the condition, and
    // refusing every settings save afterwards would block unrelated clinic changes
    // (and, ironically, the very save that would turn the requirement back off).
    await setFlag(true);
    const anAdmin = userIds[0];
    await db.update(usersTable).set({ totpEnabled: false }).where(eq(usersTable.id, anAdmin));

    const res = await put({ requireAdmin2fa: true });
    expect(res.status).toBe(200);

    // Leave the fixture as the next run would expect it.
    await db.update(usersTable).set({ totpEnabled: true }).where(eq(usersTable.id, anAdmin));
  });
});
