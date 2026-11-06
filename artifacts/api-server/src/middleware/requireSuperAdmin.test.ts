/**
 * requireSuperAdmin — the pen drive is not optional, and a database column is not
 * a second key.
 *
 * The middleware used to look up `users.remote_login_enabled` when a request
 * arrived without the drive, and let a super_admin with that flag through with a
 * warning log. No route, portal screen or script in this repository ever wrote the
 * column, so the exemption could only be earned by an UPDATE in SQL — which makes
 * it a hidden credential, not a feature. It is gone, and these tests hold the door
 * from both sides: the flag must not help, and a legitimate drive+token request
 * must still work exactly as before.
 *
 * The database is scripted, not real: what is under test is which check the
 * middleware applies and in what order, and every assertion is on the response it
 * sends or the next() it refuses to call. The token validation path itself is
 * unchanged, and asserted here so the delegation cannot silently drop it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Request, Response, NextFunction } from "express";

const scripted = vi.hoisted(() => ({ rows: [] as unknown[][], env: {} as Record<string, string | undefined> }));

function makeChain(): unknown {
  const rows = scripted.rows.shift() ?? [];
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  chain.then = (onFulfilled?: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@workspace/db", () => ({ db: { select: () => makeChain(), insert: () => makeChain(), update: () => makeChain() } }));
vi.mock("@workspace/db/schema", () => ({
  superAdminSessionsTable: { token: "token", userId: "user_id", userName: "user_name", expiresAt: "expires_at", isActive: "is_active" },
  usersTable: { id: "id", name: "name", role: "role", isActive: "is_active", remoteLoginEnabled: "remote_login_enabled" },
  portalSessionsTable: { token: "token" },
  clinicSettingsTable: { id: "id", sessionIdleTimeoutMinutes: "session_idle_timeout_minutes" },
}));
vi.mock("../lib/ttlCache", () => ({ getCached: () => undefined, setCached: () => undefined, invalidateCached: () => undefined }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => a,
  and: (...a: unknown[]) => a,
  gt: (...a: unknown[]) => a,
  sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
}));

const KEY = "a".repeat(64);

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

function reqOf(headers: Record<string, string>): Request {
  return {
    header: (n: string) => headers[n.toLowerCase()],
    path: "/api/super-admin/referral-commission",
  } as unknown as Request;
}

async function loadMiddleware() {
  const { requireSuperAdmin } = await import("../middleware/requireSuperAdmin");
  return requireSuperAdmin;
}

/** Run the middleware and report whether it admitted the request. */
async function run(req: Request): Promise<{ admitted: boolean; res: ReturnType<typeof fakeRes> }> {
  const middleware = await loadMiddleware();
  const res = fakeRes();
  let admitted = false;
  const next: NextFunction = ((...args: unknown[]) => {
    // next(err) means the token validation threw — surface it as a failure, not admission.
    if (args.length > 0 && args[0]) throw args[0];
    admitted = true;
  }) as NextFunction;
  await middleware(req, res as unknown as Response, next);
  return { admitted, res };
}

const liveSession = [{ token: "sa-token", userId: 7, userName: "Dr Abinash Kumar", expiresAt: new Date(Date.now() + 3600_000), isActive: true }];
const superAdminRow = [{ id: 7, name: "Dr Abinash Kumar", role: "super_admin", isActive: true, remoteLoginEnabled: true }];

describe("requireSuperAdmin — remote_login_enabled excuses nothing", () => {
  beforeEach(() => {
    scripted.rows.length = 0;
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
  });

  it("refuses a flagged super_admin who presents a valid session token but no drive", async () => {
    // The exact shape the old code let through: session row, then user row with
    // remote_login_enabled = true.
    scripted.rows.push(liveSession, superAdminRow);
    const { admitted, res } = await run(reqOf({ "x-sa-token": "sa-token" }));

    expect(admitted, "the bypass must not survive").toBe(false);
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/USB key required/i);
  });

  it("still admits drive + valid token + active super_admin", async () => {
    scripted.rows.push(liveSession, superAdminRow);
    const { admitted, res } = await run(reqOf({ "x-sa-token": "sa-token", "x-sa-usb-key": KEY }));

    expect(admitted).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("keeps every token failure it had before the change", async () => {
    const cases: Array<{ name: string; headers: Record<string, string>; rows: unknown[][]; error: RegExp }> = [
      { name: "no token at all", headers: { "x-sa-usb-key": KEY }, rows: [], error: /token required/i },
      { name: "wrong drive key", headers: { "x-sa-token": "sa-token", "x-sa-usb-key": "b".repeat(64) }, rows: [], error: /Invalid USB key/i },
      { name: "expired session", headers: { "x-sa-token": "sa-token", "x-sa-usb-key": KEY }, rows: [[{ ...liveSession[0], expiresAt: new Date(Date.now() - 1000) }], superAdminRow], error: /expired/i },
      { name: "deactivated account", headers: { "x-sa-token": "sa-token", "x-sa-usb-key": KEY }, rows: [liveSession, [{ ...superAdminRow[0], isActive: false }]], error: /no longer valid/i },
      { name: "not a super admin", headers: { "x-sa-token": "sa-token", "x-sa-usb-key": KEY }, rows: [liveSession, [{ ...superAdminRow[0], role: "admin" }]], error: /no longer valid/i },
      { name: "unknown session", headers: { "x-sa-token": "sa-token", "x-sa-usb-key": KEY }, rows: [[]], error: /Invalid super admin session/i },
    ];

    for (const c of cases) {
      scripted.rows.length = 0;
      for (const r of c.rows) scripted.rows.push(r);
      const { admitted, res } = await run(reqOf(c.headers));
      expect(admitted, c.name).toBe(false);
      expect(String((res.body as { error?: string }).error), c.name).match(c.error);
    }
  });

  it("refuses with 503 when the server has no secret configured, before touching the database", async () => {
    delete process.env["SUPER_ADMIN_USB_KEY"];
    scripted.rows.push(liveSession, superAdminRow);
    const { admitted, res } = await run(reqOf({ "x-sa-token": "sa-token", "x-sa-usb-key": KEY }));

    expect(admitted).toBe(false);
    expect(res.statusCode).toBe(503);
    // Nothing was popped: the middleware never reached its session lookup.
    expect(scripted.rows.length).toBe(2);
  });
});

describe("requireSuperAdmin — the retired column stays retired", () => {
  it("no longer references remoteLoginEnabled at all", () => {
    // A fence, not the proof: the behaviour tests above are the proof. This one
    // only fails loudly if someone re-adds the read while rewriting the middleware.
    const src = readFileSync(resolve(__dirname, "requireSuperAdmin.ts"), "utf8");
    expect(src).not.toMatch(/remoteLoginEnabled/);
  });
});
