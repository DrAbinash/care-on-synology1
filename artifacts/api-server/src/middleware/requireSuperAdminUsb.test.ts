/**
 * The pen-drive gate fails closed.
 *
 * Two things used to open it silently, and both were true/false switches nobody
 * operated on purpose:
 *
 *  - `SUPER_ADMIN_USB_KEY` unset was read as "the operator chose not to configure
 *    a gate", logged ONE warning (per process, so a busy server says it once and
 *    then stays quiet), and let every super-admin request through with no key at
 *    all. docker-compose.yml forwards the secret as `${SUPER_ADMIN_USB_KEY:-}`, so
 *    a lost or empty line in `.env` produces exactly that state — no error, no
 *    failed deploy, no log the operator would notice, and `/api/super-admin/*`
 *    open to anyone on the network, including the endpoint that mounts arbitrary
 *    Node code from the drive.
 *  - `users.remote_login_enabled` excused the drive in requireSuperAdmin and in
 *    host login. No route, portal screen or script in this repository ever wrote
 *    it, so the only way to obtain the exemption was an UPDATE in SQL.
 *
 * These are unit tests of the real functions with a fake request: they must not
 * need a database, because a rule about refusing is worth proving even where no
 * Postgres exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const KEY = "0".repeat(64);

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

function fakeReq(headers: Record<string, string>): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe("requireSuperAdminUsb — no configured secret means no access", () => {
  beforeEach(() => {
    delete process.env["SUPER_ADMIN_USB_KEY"];
  });

  it("refuses the request instead of calling next()", async () => {
    const { requireSuperAdminUsb } = await import("../middleware/requireSuperAdminUsb");
    const res = fakeRes();
    let calledNext = false;
    requireSuperAdminUsb(fakeReq({ "x-sa-usb-key": KEY }), res as unknown as Response, () => { calledNext = true; });

    expect(calledNext, "an unconfigured server must not admit anyone").toBe(false);
    expect(res.statusCode).toBe(503);
    expect(String((res.body as { error?: string }).error)).toMatch(/not configured/i);
  });

  it("treats an empty or whitespace-only value as unconfigured", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = "   ";
    const { requireSuperAdminUsb } = await import("../middleware/requireSuperAdminUsb");
    const res = fakeRes();
    let calledNext = false;
    requireSuperAdminUsb(fakeReq({ "x-sa-usb-key": "   " }), res as unknown as Response, () => { calledNext = true; });
    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it("isValidUsbKey() is false with no secret, so nothing that delegates to it can pass", async () => {
    const { isValidUsbKey, isUsbGateEnforced } = await import("../middleware/requireSuperAdminUsb");
    expect(isUsbGateEnforced()).toBe(false);
    expect(isValidUsbKey(KEY)).toBe(false);
    expect(isValidUsbKey("")).toBe(false);
  });
});

describe("requireSuperAdminUsb — with a configured secret", () => {
  beforeEach(() => {
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
  });

  it("admits the exact key and refuses a near miss", async () => {
    const { requireSuperAdminUsb } = await import("../middleware/requireSuperAdminUsb");

    let admitted = false;
    const okRes = fakeRes();
    requireSuperAdminUsb(fakeReq({ "x-sa-usb-key": KEY }), okRes as unknown as Response, () => { admitted = true; });
    expect(admitted).toBe(true);

    for (const presented of ["", KEY.slice(0, 63), KEY + "x", "1".repeat(64)]) {
      let passed = false;
      const res = fakeRes();
      requireSuperAdminUsb(fakeReq({ "x-sa-usb-key": presented }), res as unknown as Response, () => { passed = true; });
      expect(passed, `"${presented}" must not be admitted`).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });

  it("trims the header, matching how the key file is read off the drive", async () => {
    const { requireSuperAdminUsb } = await import("../middleware/requireSuperAdminUsb");
    let admitted = false;
    requireSuperAdminUsb(fakeReq({ "x-sa-usb-key": ` ${KEY}\n` }), fakeRes() as unknown as Response, () => { admitted = true; });
    expect(admitted).toBe(true);
  });
});

describe("commission visibility inherits the fail-closed rule", () => {
  /**
   * Commission rates live on otherwise ordinary staff rows (doctors,
   * clinic_settings), so these routes cannot be moved behind the pen-drive
   * middleware — they ask hasCommissionAccess() instead. That helper is
   * isValidUsbKey(), which used to answer true when no secret was configured: a
   * lost .env line exposed referral commission to every staff screen.
   */
  beforeEach(() => {
    delete process.env["SUPER_ADMIN_USB_KEY"];
  });

  it("hides commission fields when the server cannot verify a drive", async () => {
    const { hasCommissionAccess, stripFields, CLINIC_COMMISSION_FIELDS } = await import("../middleware/commissionVisibility");
    expect(hasCommissionAccess(fakeReq({ "x-sa-usb-key": KEY }))).toBe(false);
    expect(hasCommissionAccess({} as Request)).toBe(false);

    const stripped = stripFields({ name: "Care", commissionDiscountMode: "PERCENT" }, CLINIC_COMMISSION_FIELDS) as Record<string, unknown>;
    expect(stripped.commissionDiscountMode).toBeUndefined();
    expect(stripped.name).toBe("Care");
  });

  it("still admits the real key when one is configured", async () => {
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
    const { hasCommissionAccess } = await import("../middleware/commissionVisibility");
    expect(hasCommissionAccess(fakeReq({ "x-sa-usb-key": KEY }))).toBe(true);
  });

  it("reads the header from a plain headers bag, as the unit-driven routes pass", async () => {
    // These routes are also driven with a bare { body } object that has no
    // header() method; the fallback must not become an allow.
    process.env["SUPER_ADMIN_USB_KEY"] = KEY;
    const { hasCommissionAccess } = await import("../middleware/commissionVisibility");
    const bagLike = { headers: { "x-sa-usb-key": KEY } } as unknown as Request;
    expect(hasCommissionAccess(bagLike)).toBe(true);
    expect(hasCommissionAccess({ headers: {}, body: {} } as unknown as Request)).toBe(false);
  });
});
