import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `POST /api/dashboard/my-daily-summary/send-email` is the one leg of the
 * SummaryExport toolbar that leaves the building, and four pages reach it
 * (My Daily Summary, Dashboard, Dues and now the Billing register). Until this
 * file it had no test at all: the route took an address and an HTML body from
 * the browser and handed both to SMTP under nothing but a session check.
 *
 * The allowlist is derived from the SAME settings the operator already edits
 * (admin_email + extra_recipients), so `getAllRecipients` is deliberately left
 * real here — stubbing it would test the mock instead of the rule.
 */
vi.mock("@workspace/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock("../email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../email")>();
  return { ...actual, getTransporter: vi.fn(), getEmailSettings: vi.fn() };
});

import { myDailySummaryRouter } from "./my-daily-summary";
import { getEmailSettings, getTransporter } from "../email";

const sendMail = vi.fn(async () => ({ messageId: "<test@local>" }));

function sendEmailHandler() {
  const layer = myDailySummaryRouter.stack.find((l) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const route = (l as any).route;
    return route && route.path === "/send-email" && !!route.methods?.post;
  });
  expect(layer?.route, "route POST /send-email").toBeTruthy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return layer!.route!.stack.at(-1)!.handle as any;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

async function post(body: unknown) {
  vi.mocked(getTransporter).mockResolvedValue({ sendMail } as never);
  const res = fakeRes();
  await sendEmailHandler()({ body, staffSession: { role: "super_admin", subjectName: "Owner" }, log: { warn: vi.fn(), error: vi.fn() } }, res);
  return res;
}

function settings(adminEmail: string, extraRecipients: unknown[] = []) {
  return {
    adminEmail,
    extraRecipients: JSON.stringify(extraRecipients),
    fromName: "CARE",
    fromAddress: "care@example.test",
    smtpHost: "smtp.example.test",
    smtpUser: "care@example.test",
  };
}

const BODY = { subject: "Daily Summary", htmlBody: "<h1>collections</h1>" };

// The repo's vitest config sets no `clearMocks`, so this single transport stub
// would otherwise accumulate calls across the file and every count assertion
// would be a fiction after the first test.
beforeEach(() => sendMail.mockClear());

describe("send-summary-email recipient allowlist", () => {
  test("sends to the configured admin email", async () => {
    vi.mocked(getEmailSettings).mockResolvedValue(settings("owner@clinic.test") as never);
    const res = await post({ to: "owner@clinic.test", ...BODY });
    expect(res.statusCode).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe("owner@clinic.test");
  });

  test("sends to an extra recipient from Settings", async () => {
    vi.mocked(getEmailSettings).mockResolvedValue(settings("owner@clinic.test", ["accounts@clinic.test"]) as never);
    const res = await post({ to: "accounts@clinic.test", ...BODY });
    expect(res.statusCode).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test("matching is case-insensitive, so a capitalised address is not a new door", async () => {
    vi.mocked(getEmailSettings).mockResolvedValue(settings("Owner@Clinic.test") as never);
    const res = await post({ to: "owner@clinic.test", ...BODY });
    expect(res.statusCode).toBe(200);
  });

  test("refuses an unconfigured address and never opens the SMTP session", async () => {
    sendMail.mockClear();
    vi.mocked(getEmailSettings).mockResolvedValue(settings("owner@clinic.test") as never);
    const res = await post({ to: "someone.else@gmail.com", ...BODY });
    expect(res.statusCode).toBe(403);
    // The whole point of the gate: nothing may reach nodemailer.
    expect(sendMail).not.toHaveBeenCalled();
    expect((res.body as { error: string }).error).toContain("not an allowed recipient");
  });

  test("the refusal names where the operator fixes it", async () => {
    vi.mocked(getEmailSettings).mockResolvedValue(settings("owner@clinic.test") as never);
    const res = await post({ to: "doctor@elsewhere.test", ...BODY });
    expect((res.body as { error: string }).error).toMatch(/Settings → Email/);
  });

  test("a comma-separated list cannot smuggle an unlisted address past the gate", async () => {
    sendMail.mockClear();
    vi.mocked(getEmailSettings).mockResolvedValue(settings("owner@clinic.test") as never);
    const res = await post({ to: "owner@clinic.test, stranger@gmail.com", ...BODY });
    expect(res.statusCode).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("an empty recipient list refuses rather than falling back to a blank To:", async () => {
    sendMail.mockClear();
    vi.mocked(getEmailSettings).mockResolvedValue(settings("") as never);
    const res = await post({ to: "owner@clinic.test", ...BODY });
    expect(res.statusCode).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
