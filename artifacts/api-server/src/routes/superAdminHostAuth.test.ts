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
    process.env["SUPER_ADMIN_USB_PIN"] = "9988";
    mockSelectChain.from.mockReturnValue(mockSelectChain);
    mockSelectChain.where.mockReturnValue(mockSelectChain);
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
});
