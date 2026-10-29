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
  webauthnCredentialsTable: {
    id: "id",
    userId: "user_id",
    credentialId: "credential_id",
    publicKey: "public_key",
    counter: "counter",
    transports: "transports",
  },
}));

vi.mock("../middleware/rateLimits", () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// The security-key ceremony. `@simplewebauthn/server` is replaced because signing a
// challenge is something only a physical authenticator can do; everything else on the
// path — which account owns the credential, which door issued the challenge, whether
// the PIN is still accepted — is this repository's own code and runs for real here.
const keyAuth = vi.hoisted(() => ({
  accept: true,
  error: "",
  newCounter: 42,
  issuedChallenge: "challenge-issued-by-begin",
}));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(async ({ rpID, allowCredentials }: {
    rpID: string;
    allowCredentials?: { id: string; transports?: unknown }[];
  }) => ({
    challenge: keyAuth.issuedChallenge,
    rpId: rpID,
    allowCredentials: (allowCredentials || []).map((c) => ({
      id: c.id,
      type: "public-key",
      transports: c.transports,
    })),
    userVerification: "required",
    timeout: 60000,
  })),
  verifyAuthenticationResponse: vi.fn(async () => {
    if (keyAuth.error) throw new Error(keyAuth.error);
    if (!keyAuth.accept) return { verified: false };
    return { verified: true, authenticationInfo: { newCounter: keyAuth.newCounter } };
  }),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

// The challenge store stays real: which door a challenge was issued for is exactly the
// property the two halves of this ceremony have to agree on. Only the two database
// helpers are replaced, because the shared select stub cannot serve an unbounded query.
const keyStore = vi.hoisted(() => ({ credentials: [] as Record<string, unknown>[] }));

vi.mock("../lib/webauthnService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/webauthnService")>();
  return {
    ...actual,
    getCredentialsForUser: vi.fn(async () => keyStore.credentials),
    updateCredentialCounter: vi.fn(async () => undefined),
  };
});

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

async function getKeyBeginHandler() {
  const { superAdminHostAuthRouter } = await import("./superAdminHostAuth");
  const layer = (superAdminHostAuthRouter as unknown as {
    stack: Array<{ route?: { path?: string; stack: Array<{ handle: (req: unknown, res: unknown) => Promise<void> }> } }>;
  }).stack.find((l) => l.route?.path === "/key-login/begin");
  return layer!.route!.stack[layer!.route!.stack.length - 1]!.handle;
}

describe("superAdminHostAuth strict identity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // mockClear leaves queued one-shot results in place, and this stub serves every
    // select the route makes. A value one test never reached would be handed to the
    // next test's user lookup — a super admin row appearing as a credential row, and
    // a green suite reading a verdict that has nothing to do with the code under it.
    mockSelectChain.from.mockReset();
    mockSelectChain.where.mockReset();
    mockSelectChain.limit.mockReset();
    process.env["SUPER_ADMIN_USB_KEY"] = "usb-key";
    process.env["SUPER_ADMIN_USB_PIN"] = "9988";
    // Off by default, exactly as every deployment has it. Each 2FA case opts in.
    delete process.env["SUPER_ADMIN_REQUIRE_2FA"];
    delete process.env["SUPER_ADMIN_REQUIRE_KEY"];
    keyAuth.accept = true;
    keyAuth.error = "";
    keyAuth.newCounter = 42;
    keyStore.credentials = [];
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

  // ── Security key ─────────────────────────────────────────────────────────────
  // The pen drive's second half is `SUPER_ADMIN_USB_PIN`: one four-digit value,
  // shared by every super admin, that skips the personal PIN — and a copy of it is
  // committed in this repository. These cases pin the alternative: a challenge this
  // server issued, signed by a credential that belongs to this account, carries the
  // whole secret, and nothing about it can be replayed from a file.

  function saUser(over: Record<string, unknown> = {}) {
    return {
      id: 1,
      name: "Dr Abinash Kumar",
      username: "abinash",
      email: "abinashsingh@gmail.com",
      role: "super_admin",
      isActive: true,
      pin: "x",
      remoteLoginEnabled: false,
      ...over,
    };
  }

  const credentialRow = (over: Record<string, unknown> = {}) => ({
    id: 7,
    userId: 1,
    credentialId: "cred-7",
    publicKey: "aGVsbG8",
    counter: 41,
    transports: null,
    ...over,
  });

  function assertionFor(id = "cred-7") {
    return {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: "b2hMPQ",
        clientDataJSON: "eyJjaGFsbGVuZ2UiOiJ4In0",
        signature: "MEUCIQ",
        userHandle: null,
      },
    };
  }

  async function beginKey(name = "Dr Abinash Kumar", header = "usb-key") {
    const handler = await getKeyBeginHandler();
    const res = mockRes();
    // Headers because the route derives the WebAuthn rpId and origin from them: a
    // challenge is only worth anything if it is bound to the site it was asked for.
    await handler(
      { body: { name }, headers: { host: "caredeoghar.com", "x-forwarded-proto": "https" }, header: () => header },
      res,
    );
    return res;
  }

  async function loginWith(body: Record<string, unknown>, header = "usb-key") {
    const handler = await getLoginHandler();
    const res = mockRes();
    await handler(
      {
        body: { name: "Dr Abinash Kumar", ...body },
        headers: { host: "caredeoghar.com", "x-forwarded-proto": "https" },
        header: () => header,
      },
      res,
    );
    return res;
  }

  it("hands out a challenge listing only that account's own keys", async () => {
    queue(saUser());
    keyStore.credentials = [credentialRow(), credentialRow({ id: 8, credentialId: "cred-8" })];
    const res = await beginKey();
    expect(res.statusCode).toBe(200);
    const body = res.body as { challenge: string; allowCredentials: { id: string }[] };
    expect(body.challenge).toBe(keyAuth.issuedChallenge);
    expect(body.allowCredentials.map((c) => c.id)).toEqual(["cred-7", "cred-8"]);
  });

  it("answers one sentence for an unknown name, a non-super-admin and an account with no key", async () => {
    // This request happens before any PIN is typed, so it must not confirm which
    // display names exist — names are printed on every referral report.
    queue(saUser());
    keyStore.credentials = [];
    const noKey = await beginKey();
    expect(noKey.statusCode).toBe(401);

    queue(saUser({ role: "doctor" }));
    const notSuper = await beginKey();
    expect(notSuper.statusCode).toBe(401);

    queue([]);
    const unknown = await beginKey("Someone Else");
    expect(unknown.statusCode).toBe(401);

    const sentences = new Set([noKey, notSuper, unknown].map((r) => String((r.body as { error?: string }).error)));
    expect(sentences.size).toBe(1);
    expect([...sentences][0]).toMatch(/No security key can be used/i);
  });

  it("will not even start a key sign-in for a caller holding no pen drive", async () => {
    // The drive is what the portal's own interface is read from, and an unthrottled
    // anonymous door that maps which accounts hold keys is not an improvement on the
    // login it feeds.
    const res = await beginKey("Dr Abinash Kumar", "");
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/USB key required/i);
  });

  it("logs in with a signed challenge and no PIN at all", async () => {
    // The ruling: the key stands alone. Nothing here asks for a PIN, and the PIN
    // columns are never read.
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    await beginKey();

    mockSelectChain.limit.mockResolvedValueOnce([saUser()]).mockResolvedValueOnce([credentialRow()]);
    const res = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(res.statusCode).toBe(200);
    expect(((res.body as { token?: string }).token ?? "").length).toBeGreaterThan(20);

    // The two properties a WebAuthn verifier must never be allowed to skip: the
    // signature is tied to this site, and the human proved they were there.
    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: "https://caredeoghar.com",
      expectedRPID: "caredeoghar.com",
      requireUserVerification: true,
    }));
  });

  it("refuses a challenge that another account asked for", async () => {
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    await beginKey();

    // The name typed at Sign in resolves to a different account than the one that
    // asked for the challenge, so the signature is not proof of anything here.
    mockSelectChain.limit
      .mockResolvedValueOnce([saUser({ id: 2 })])
      .mockResolvedValueOnce([credentialRow()]);
    const res = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/expired/i);
    expect((res.body as { token?: string }).token).toBeUndefined();
  });

  it("refuses a credential that belongs to somebody else, with the sentence it uses for nobody", async () => {
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    await beginKey();

    mockSelectChain.limit
      .mockResolvedValueOnce([saUser()])
      .mockResolvedValueOnce([credentialRow({ userId: 99 })]);
    const res = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(res.statusCode).toBe(401);
    expect(String((res.body as { error?: string }).error)).toMatch(/No security key can be used/i);
  });

  it("refuses an assertion the key did not sign, and one the library rejects", async () => {
    keyAuth.accept = false;
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    await beginKey();
    mockSelectChain.limit.mockResolvedValueOnce([saUser()]).mockResolvedValueOnce([credentialRow()]);
    const unverified = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(unverified.statusCode).toBe(401);
    expect((unverified.body as { token?: string }).token).toBeUndefined();

    keyAuth.error = "signature verification failed";
    queue(saUser());
    await beginKey();
    mockSelectChain.limit.mockResolvedValueOnce([saUser()]).mockResolvedValueOnce([credentialRow()]);
    const thrown = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(thrown.statusCode).toBe(401);
    expect((thrown.body as { token?: string }).token).toBeUndefined();
  });

  it("spends the challenge: the same signature cannot be presented twice", async () => {
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    await beginKey();
    mockSelectChain.limit.mockResolvedValueOnce([saUser()]).mockResolvedValueOnce([credentialRow()]);
    const first = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(first.statusCode).toBe(200);

    mockSelectChain.limit.mockResolvedValueOnce([saUser()]).mockResolvedValueOnce([credentialRow()]);
    const replay = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(replay.statusCode).toBe(401);
    expect(String((replay.body as { error?: string }).error)).toMatch(/expired/i);
  });

  it("refuses every PIN-based login once SUPER_ADMIN_REQUIRE_KEY is on, and names the way in", async () => {
    process.env["SUPER_ADMIN_REQUIRE_KEY"] = "1";
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    // The usbPin that used to be enough on its own is now refused.
    const res = await login({ usbPin: "9988" });
    expect(res.statusCode).toBe(401);
    expect((res.body as { requiresKey?: boolean }).requiresKey).toBe(true);
    expect((res.body as { token?: string }).token).toBeUndefined();
  });

  it("refuses with 403 and the enrolment sentence when the switch is on but no key exists", async () => {
    // The lockout guardrail: this is the state that would otherwise leave him
    // outside his own server with no hint of what to do about it.
    process.env["SUPER_ADMIN_REQUIRE_KEY"] = "true";
    queue(saUser());
    keyStore.credentials = [];
    const res = await login({ usbPin: "9988" });
    expect(res.statusCode).toBe(403);
    expect((res.body as { requiresKeyEnrollment?: boolean }).requiresKeyEnrollment).toBe(true);
    expect(String((res.body as { error?: string }).error)).toMatch(/Settings/i);
  });

  it("still accepts the key when the switch is on, and treats 0/false/off as off", async () => {
    process.env["SUPER_ADMIN_REQUIRE_KEY"] = "1";
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    await beginKey();
    mockSelectChain.limit.mockResolvedValueOnce([saUser()]).mockResolvedValueOnce([credentialRow()]);
    const res = await loginWith({ webauthnChallenge: keyAuth.issuedChallenge, keyAssertion: assertionFor() });
    expect(res.statusCode).toBe(200);

    for (const value of ["", "0", "false", "no", "off", "OFF"]) {
      if (value) process.env["SUPER_ADMIN_REQUIRE_KEY"] = value;
      else delete process.env["SUPER_ADMIN_REQUIRE_KEY"];
      queue(saUser());
      const pinPath = await login({ usbPin: "9988" });
      expect(pinPath.statusCode, `value ${value}`).toBe(200);
    }
  });

  it("keeps the pen-drive gate in front of the key door, so an unset secret closes both", async () => {
    delete process.env["SUPER_ADMIN_USB_KEY"];
    queue(saUser());
    keyStore.credentials = [credentialRow()];
    const begun = await beginKey();
    expect(begun.statusCode).toBe(503);
  });
});
