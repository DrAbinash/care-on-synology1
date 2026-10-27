/**
 * STAGE 1 PR-A2 — who may set the AI security mode, what gets stored, and whether
 * the stored value actually changes what the server does.
 *
 * This is the test the owner's ruling asks for: "Settings must be enforced
 * server-side" and "verify that changing settings actually changes server-side
 * behavior". A unit test of the gate cannot prove either — it can only show that the
 * gate obeys the value it is handed. So this goes through the real route with real
 * sessions, reads the real row back, and then asks the real resolver what the next
 * send will be judged by. Nothing is stubbed except the HTTP layer's own bootstrap.
 *
 * It also proves the two things that must NOT be relaxed by a settings write:
 * a holder of the grantable `ai_reporting.configure` permission may configure AI
 * reporting, and may not change this one field; and a key nobody allowlisted cannot
 * be persisted by naming it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import {
  aiProviderSettingsTable,
  portalSessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { resolveAiSecurityPolicy } from "./aiSecurityPolicy";

const maybe = hasDatabaseUrl() ? describe : describe.skip;

type Actor = { token: string; userId: number; name: string };

maybe("AI security mode — route, row, and the behaviour that follows", () => {
  let app: Awaited<ReturnType<typeof import("../../testSupport/apiTestApp").createTestApp>>;
  let admin: Actor;
  let configurator: Actor;
  const marker = `vitest-a2-${randomUUID().slice(0, 8)}`;

  async function makeActor(name: string, role: string, permissions: string[]): Promise<Actor> {
    const token = `vitest-token-${randomUUID()}`;
    const label = `${marker}-${name}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: label,
        email: `${label}@vitest.invalid`,
        username: label,
        role,
        permissions: JSON.stringify(permissions),
        pin: "0000",
        isActive: true,
      })
      .returning();
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    return { token, userId: user.id, name: label };
  }

  async function globalRow(): Promise<string | null> {
    const [row] = await db
      .select({ settingsJson: aiProviderSettingsTable.settingsJson })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "__global__"))
      .limit(1);
    return row?.settingsJson ?? null;
  }

  async function storedMode(): Promise<unknown> {
    const json = await globalRow();
    if (!json) return null;
    try {
      return (JSON.parse(json) as Record<string, unknown>).aiSecurityMode;
    } catch {
      return "unparseable";
    }
  }

  beforeAll(async () => {
    const { createTestApp } = await import("../../testSupport/apiTestApp");
    app = await createTestApp();
    admin = await makeActor("admin", "admin", ["/radiology"]);
    // A non-admin who holds the permission this whole screen is built for. The mode
    // is the one field the ruling reserves to admin / super_admin.
    configurator = await makeActor("configure", "doctor", [
      "ai_reporting.use",
      "ai_reporting.configure",
    ]);
  });

  afterAll(async () => {
    for (const a of [admin, configurator]) {
      await db
        .delete(portalSessionsTable)
        .where(eq(portalSessionsTable.subjectName, a.name))
        .catch(() => undefined);
      await db.delete(usersTable).where(eq(usersTable.id, a.userId)).catch(() => undefined);
    }
    await db
      .delete(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_security_mode_changed"))
      .catch(() => undefined);
    await db
      .delete(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "__global__"))
      .catch(() => undefined);
  });

  it("POST /settings as a configure-permitted non-admin: 403, and the row untouched", async () => {
    const res = await request(app)
      .post("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${configurator.token}`)
      .send({ global: { aiSecurityMode: "development" } });
    expect(res.status).toBe(403);
    expect(String(res.body?.error ?? "")).toMatch(/administrator/i);
    expect(await storedMode()).not.toBe("development");
  });

  it("the same actor may still change an ordinary AI setting", async () => {
    const res = await request(app)
      .post("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${configurator.token}`)
      .send({ global: { anonymize: true } });
    expect(res.status).toBe(200);
    expect(await globalRow()).toContain('"anonymize":true');
  });

  it("POST /settings with an invented key: 400, and nothing new persisted", async () => {
    const before = await globalRow();
    const res = await request(app)
      .post("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ global: { aiSecurityMode: "clinical", requireNoAudit: true } });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? "")).toContain("requireNoAudit");
    expect(await globalRow()).toBe(before);
  });

  it("POST /settings with a near-miss mode: 400 rather than a typo in a security row", async () => {
    const before = await globalRow();
    for (const bad of ["develop", "DEVELOPMENTAL", "prod", 7, true]) {
      const res = await request(app)
        .post("/api/ai-reporting/settings")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ global: { aiSecurityMode: bad } });
      expect(res.status).toBe(400);
    }
    expect(await globalRow()).toBe(before);
  });

  it("an admin switches to Development and the server's next decision follows it", async () => {
    const res = await request(app)
      .post("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ global: { aiSecurityMode: "development" } });
    expect(res.status).toBe(200);
    expect(await storedMode()).toBe("development");

    // Same process, no restart, no cache: this is the proof the ruling asked for.
    const policy = await resolveAiSecurityPolicy();
    expect(policy.mode).toBe("development");
    expect(policy.requireAttestation).toBe(false);
    expect(policy.strictAudit).toBe(false);
  });

  it("the switch is recorded in the clinic's existing audit trail, old value and new", async () => {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_security_mode_changed"))
      .limit(5);
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[rows.length - 1];
    expect(last.module).toBe("settings");
    expect(last.entityType).toBe("ai_provider_settings");
    expect(last.entityId).toBe("__global__");
    expect(last.newValue).toBe("development");
    expect(["clinical", null]).toContain(last.oldValue ?? null);
    // Named who changed it, and the chain link is present (the writer is the
    // existing hash-chained one; a row without a link is a row that can be edited).
    expect(last.userId).toBeTruthy();
    expect(String(last.chainHash ?? "")).toHaveLength(64);
  });

  it("an admin switches back to Clinical and attestation is demanded again", async () => {
    const res = await request(app)
      .post("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ global: { aiSecurityMode: "clinical" } });
    expect(res.status).toBe(200);
    const policy = await resolveAiSecurityPolicy();
    expect(policy.mode).toBe("clinical");
    expect(policy.requireAttestation).toBe(true);
    expect(policy.strictAudit).toBe(true);
  });

  it("a second save in the same mode does not fake a change in the audit trail", async () => {
    const before = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_security_mode_changed"));
    await request(app)
      .post("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ global: { aiSecurityMode: "clinical" } });
    const after = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_security_mode_changed"));
    expect(after.length).toBe(before.length);
  });

  it("GET /settings reports the mode the server is actually using", async () => {
    const res = await request(app)
      .get("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body?.global?.aiSecurityMode).toBe("clinical");
  });

  it("a row carrying a mode the server has never heard of reads as Clinical", async () => {
    // Direct write, because the route now refuses to persist one. This is the
    // migration case: a database written by an older build, or by hand.
    await db
      .update(aiProviderSettingsTable)
      .set({ settingsJson: JSON.stringify({ aiSecurityMode: "yolo" }) })
      .where(eq(aiProviderSettingsTable.provider, "__global__"));
    const policy = await resolveAiSecurityPolicy();
    expect(policy.mode).toBe("clinical");
    expect(policy.requireAttestation).toBe(true);

    const res = await request(app)
      .get("/api/ai-reporting/settings")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.body?.global?.aiSecurityMode).toBe("clinical");
  });
});
