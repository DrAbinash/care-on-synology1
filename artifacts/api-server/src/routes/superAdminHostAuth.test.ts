import { beforeEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";

const mockSelectChain = {
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => mockSelectChain),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  usersTable: {
    id: "id",
    name: "name",
    username: "username",
    email: "email",
    role: "role",
    isActive: "is_active",
    pin: "pin",
    remoteLoginEnabled: "remote_login_enabled",
  },
  superAdminSessionsTable: {
    token: "token",
    userId: "user_id",
    userName: "user_name",
    expiresAt: "expires_at",
    isActive: "is_active",
  },
  clinicSettingsTable: {
    id: "id",
    requireAdmin2fa: "require_admin_2fa",
  },
}));

vi.mock("../middleware/rateLimits", () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// The route calls the same usbGateFailure() every other Super Admin door calls,
// and the point of this change is that the three answers differ by sentence — so
// the tests drive the real helper through SUPER_ADMIN_USB_KEY rather than mocking
// it: a mocked gate could only ever repeat whatever the mock said, including the
// one sentence that used to cover both a missing drive and a wrong key.

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

function mockRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (code: number) => typeof res;
    json: (payload: unknown) => typeof res;
  } = {
    statusCode: 200,
    body: undefined,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

async function getLoginHandler() {
  const { superAdminHostAuthRouter } = await import("./superAdminHostAuth");
  const layer = (superAdminHostAuthRouter as unknown as {
    stack: Array<{ route?: { path?: string; stack: Array<{ handle: (req: unknown, res: unknown) => Promise<void> }> } }>;
  }).stack.find((l) => l.route?.path === "/login");
  return layer!.route!.stack[layer!.route!.stack.length - 1]!.handle;
}

describe("superAdminHostAuth strict identity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env["SUPER_ADMIN_USB_KEY"] = "usb-key";
    process.env["SUPER_ADMIN_USB_PIN"] = "9988";
    // Off by default, exactly as every deployment has it. Each 2FA case opts in.
    delete process.env["SUPER_ADMIN_REQUIRE_2FA"];
    mockSelectChain.from.mockReturnValue(mockSelectChain);
    mockSelectChain.where.mockReturnValue(mockSelectChain);
    // The route now reads clinic_settings after the PIN checks. Default to "no row",
    // which the handler treats as 2FA-off, so the identity cases above stay about
    // identity. Tests that want the flag on queue their own second result.
    mockSelectChain.limit.mockResolvedValue([]);
  });

  it("logs in with exact display name + usbPin", async () => {
    const user = {
      id: 1,
      name: "Dr Abinash Kumar",
      username: "abinash",
      email: "abinashsingh@gmail.com",
      role: "super_admin",
      isActive: true,
      pin: "x",
      remoteLoginEnabled: false,
    };
    mockSelectChain.limit.mockResolvedValueOnce([user]);

    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "Dr Abinash Kumar", usbPin: "9988" }, header: () => "usb-key" }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { userName: string }).userName).toBe("Dr Abinash Kumar");
  });

  it("rejects username alias even with valid usbPin", async () => {
    mockSelectChain.limit.mockResolvedValueOnce([]); // no row for name=abinash

    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "abinash", usbPin: "9988" }, header: () => "usb-key" }, res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects empty name even with valid usbPin", async () => {
    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "", usbPin: "9988" }, header: () => "usb-key" }, res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects numeric user id", async () => {
    mockSelectChain.limit.mockResolvedValueOnce([]);

    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "7", usbPin: "9988" }, header: () => "usb-key" }, res);
    expect(res.statusCode).toBe(401);
  });

  it("treats PIN box value matching SUPER_ADMIN_USB_PIN as usbPin auto-login", async () => {
    const user = {
      id: 1,
      name: "Dr Abinash Kumar",
      username: "abinash",
      email: "abinashsingh@gmail.com",
      role: "super_admin",
      isActive: true,
      pin: "$2a$12$notusedbecauseautologin",
      remoteLoginEnabled: false,
    };
    mockSelectChain.limit.mockResolvedValueOnce([user]);

    const handler = await getLoginHandler();
    const res = mockRes();
    // UI often sends pen-drive PIN (2321/9988) in `pin`, not `usbPin`
    await handler({ body: { name: "Dr Abinash Kumar", pin: "9988" }, header: () => "usb-key" }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { userName: string }).userName).toBe("Dr Abinash Kumar");
  });

  it("refuses a remote_login_enabled super admin who presents no pen drive", async () => {
    // This is the case the old code admitted with a warning log. The flag could
    // only be set by an UPDATE in SQL, so it was a hidden credential rather than a
    // feature — and host login is the door that hands out the super-admin session.
    const user = {
      id: 1,
      name: "Dr Abinash Kumar",
      username: "abinash",
      email: "abinashsingh@gmail.com",
      role: "super_admin",
      isActive: true,
      pin: "x",
      remoteLoginEnabled: true,
    };
    mockSelectChain.limit.mockResolvedValueOnce([user]);

    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "Dr Abinash Kumar", usbPin: "9988" }, header: (n: string) => (n === "x-sa-usb-key" ? "" : undefined) }, res);
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/USB key required/i);
  });

  it("refuses when the drive is presented but the key does not match", async () => {
    // The sentence is the whole fix: this request carries a header, so the drive is
    // in hand and the value is what is wrong. Telling it "USB key required" sends
    // the operator looking for the pen instead of at SUPER_ADMIN_USB_KEY.
    const user = {
      id: 1, name: "Dr Abinash Kumar", username: "abinash", email: "abinashsingh@gmail.com",
      role: "super_admin", isActive: true, pin: "x", remoteLoginEnabled: false,
    };
    mockSelectChain.limit.mockResolvedValueOnce([user]);

    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "Dr Abinash Kumar", usbPin: "9988" }, header: () => "not-the-key" }, res);
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/Invalid USB key/i);
  });

  it("refuses host login with 503 when the server has no secret configured", async () => {
    // An unset SUPER_ADMIN_USB_KEY used to mean "gate disabled, admit the login",
    // and docker-compose.yml forwards it as ${SUPER_ADMIN_USB_KEY:-} — so a lost
    // line in .env silently turned the pen drive into decoration.
    delete process.env["SUPER_ADMIN_USB_KEY"];
    const user = {
      id: 1, name: "Dr Abinash Kumar", username: "abinash", email: "abinashsingh@gmail.com",
      role: "super_admin", isActive: true, pin: "x", remoteLoginEnabled: false,
    };
    mockSelectChain.limit.mockResolvedValueOnce([user]);

    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "Dr Abinash Kumar", usbPin: "9988" }, header: () => "usb-key" }, res);
    expect(res.statusCode).toBe(503);
    expect(String((res.body as { error?: string }).error)).toMatch(/not configured/i);
    expect((res.body as { userName?: string }).userName).toBeUndefined();
  });

  // ── Second factor ──────────────────────────────────────────────────────────
  // The pen drive proves possession of an object that can be copied. These cases
  // pin what happens when require_admin_2fa is on, and — just as important — that
  // nothing changes while it is off, because the login form is `superadmin-ui.js`
  // read off the drive and the server has to be deployable before it grows a
  // code field.

  const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  function enrolledUser(over: Record<string, unknown> = {}) {
    return {
      id: 1,
      name: "Dr Abinash Kumar",
      username: "abinash",
      email: "abinashsingh@gmail.com",
      role: "super_admin",
      isActive: true,
      pin: "x",
      remoteLoginEnabled: false,
      totpEnabled: true,
      totpSecret: SECRET,
      totpBackupCodes: ["AAAA1111BBBB2222"],
      ...over,
    };
  }

  function queue(user: unknown) {
    mockSelectChain.limit.mockResolvedValueOnce([user]);
  }

  function codeNow(): string {
    return new OTPAuth.TOTP({
      issuer: "Care Diagnostics ERP",
      label: "abinash",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(SECRET),
    }).generate();
  }

  async function login(body: Record<string, string>) {
    const handler = await getLoginHandler();
    const res = mockRes();
    await handler({ body: { name: "Dr Abinash Kumar", usbPin: "9988", ...body }, header: () => "usb-key" }, res);
    return res;
  }

  it("asks for an authentication code when the switch is on", async () => {
    process.env["SUPER_ADMIN_REQUIRE_2FA"] = "1";
    queue(enrolledUser());
    const res = await login({});
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/Authentication code required/i);
    expect((res.body as { requiresTotp?: boolean }).requiresTotp).toBe(true);
    expect((res.body as { token?: string }).token).toBeUndefined();
  });

  it("refuses a wrong authentication code", async () => {
    process.env["SUPER_ADMIN_REQUIRE_2FA"] = "1";
    queue(enrolledUser());
    const res = await login({ totpCode: "000000" });
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/Invalid authentication code/i);
  });

  it("accepts a valid authenticator code", async () => {
    process.env["SUPER_ADMIN_REQUIRE_2FA"] = "true";
    queue(enrolledUser());
    const res = await login({ totpCode: codeNow() });
    expect(res.statusCode).toBe(200);
    expect(((res.body as { token?: string }).token ?? "").length).toBeGreaterThan(20);
  });

  it("accepts a backup code, and spends it", async () => {
    process.env["SUPER_ADMIN_REQUIRE_2FA"] = "1";
    queue(enrolledUser());
    const res = await login({ backupCode: "AAAA-1111-BBBB-2222" });
    expect(res.statusCode).toBe(200);
    const { db } = await import("@workspace/db");
    expect(db.update).toHaveBeenCalled();
  });

  it("refuses an account with no authenticator enrolled, and names the way out", async () => {
    process.env["SUPER_ADMIN_REQUIRE_2FA"] = "1";
    queue(enrolledUser({ totpEnabled: false, totpSecret: null }));
    const res = await login({ totpCode: codeNow() });
    expect(res.statusCode).toBe(403);
    expect((res.body as { requiresTotpEnrollment?: boolean }).requiresTotpEnrollment).toBe(true);
    expect(String((res.body as { error?: string }).error)).toMatch(/Settings/i);
  });

  it("changes nothing while the switch is off — the old pen-drive bundle still logs in", async () => {
    // This is the rollout safety: the server ships inert, the drive bundle is
    // updated, and only then does the operator turn the switch on.
    queue(enrolledUser());
    const res = await login({});
    expect(res.statusCode).toBe(200);
    expect((res.body as { token?: string }).token).toBeTruthy();
  });

  it("treats an explicit 0/false/off as off, not as on", async () => {
    // `SUPER_ADMIN_REQUIRE_2FA=` must not become a trap where writing "false"
    // switches the requirement on.
    for (const value of ["0", "false", "no", "off", "OFF"]) {
      process.env["SUPER_ADMIN_REQUIRE_2FA"] = value;
      queue(enrolledUser());
      const res = await login({});
      expect(res.statusCode, `value ${value}`).toBe(200);
    }
  });
});
