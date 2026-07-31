import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("../middleware/rateLimits", () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/requireSuperAdminUsb", () => ({
  getUsbKeyHeader: () => "usb-key",
  isUsbGateEnforced: () => true,
  isValidUsbKey: () => true,
}));

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
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

describe("superAdminHostAuth login identity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env["SUPER_ADMIN_USB_PIN"] = "9988";
    process.env["BOOTSTRAP_ADMIN_NAME"] = "Dr Abinash Kumar";
    mockSelectChain.from.mockReturnValue(mockSelectChain);
    mockSelectChain.where.mockReturnValue(mockSelectChain);
  });

  it("logs in with usbPin when name is empty by resolving sole super_admin", async () => {
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
    // findByIdentity("") → null; resolveUsbPin → sole super_admin query
    mockSelectChain.limit
      .mockResolvedValueOnce([]) // preferred name empty → null path skipped inside resolve; bootstrap find
      .mockResolvedValueOnce([user]) // bootstrap name hit
      .mockResolvedValueOnce([user]); // not used if bootstrap hits

    // Actually resolveUsbPinSuperAdmin with preferredName undefined:
    // findSuperAdminByIdentity(undefined) → null
    // findSuperAdminByIdentity(bootstrap) → user
    mockSelectChain.limit.mockReset();
    mockSelectChain.limit
      .mockResolvedValueOnce([]) // preferred empty
      .mockResolvedValueOnce([user]); // bootstrap

    const { superAdminHostAuthRouter } = await import("./superAdminHostAuth");
    const layer = (superAdminHostAuthRouter as any).stack.find((l: any) => l.route?.path === "/login");
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    const req: any = {
      body: { name: "", usbPin: "9988" },
      header: () => "usb-key",
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.userName).toBe("Dr Abinash Kumar");
    expect(res.body.token).toBeTruthy();
  });

  it("accepts username abinash with usbPin", async () => {
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

    const { superAdminHostAuthRouter } = await import("./superAdminHostAuth");
    const layer = (superAdminHostAuthRouter as any).stack.find((l: any) => l.route?.path === "/login");
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    const req: any = {
      body: { name: "abinash", usbPin: "9988" },
      header: () => "usb-key",
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.userName).toBe("Dr Abinash Kumar");
  });

  it("accepts numeric user id (legacy index association)", async () => {
    const user = {
      id: 7,
      name: "Dr Abinash Kumar",
      username: "abinash",
      email: "abinashsingh@gmail.com",
      role: "super_admin",
      isActive: true,
      pin: "x",
      remoteLoginEnabled: false,
    };
    mockSelectChain.limit.mockResolvedValueOnce([user]);

    const { superAdminHostAuthRouter } = await import("./superAdminHostAuth");
    const layer = (superAdminHostAuthRouter as any).stack.find((l: any) => l.route?.path === "/login");
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    const req: any = {
      body: { name: "7", usbPin: "9988" },
      header: () => "usb-key",
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.userName).toBe("Dr Abinash Kumar");
  });
});
