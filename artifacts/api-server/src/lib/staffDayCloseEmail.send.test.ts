import { describe, expect, test, vi, beforeEach } from "vitest";

// Typed so `sendMail.mock.calls[0][0]` below is the real message object: an untyped `vi.fn(async () =>
// ({}))` gives a zero-length call tuple, and the recipient assertion would be reading `undefined`.
const sendMail = vi.fn(async (_message: { from: string; to: string; subject: string; html: string }) => ({}));
const getSettings = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: async () => getSettings(),
      }),
    }),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  emailSettingsTable: {},
}));

import { sendAlertEmail, sendStaffDayCloseEmail, getAllRecipients } from "../email";

const basePayload = {
  clinicName: "Care Diagnostics",
  closureDate: "2026-08-26",
  closedAt: new Date("2026-08-26T12:00:00.000Z"),
  coveredFromTs: null,
  coveredToTs: new Date("2026-08-26T12:00:00.000Z"),
  totalBilled: 1000,
  totalDue: 0,
  totalExpected: 1000,
  totalActual: 1000,
  variance: 0,
  expectedCash: 500,
  expectedUpi: 500,
  expectedCard: 0,
  expectedCheque: 0,
  expectedOther: 0,
  actualCash: 500,
  actualUpi: 500,
  actualCard: 0,
  actualCheque: 0,
  actualOther: 0,
  closureId: 1,
  printActivity: {
    dueReceived: 0,
    cancelledBillsAmount: 0,
    refundsAmount: 0,
    discountsGiven: 0,
    discountBills: [],
    billEdits: [],
    voucherEdits: [],
    expenseDetails: [],
    totalExpenses: 0,
    cashExpenses: 0,
    digitalExpenses: 0,
  },
};

describe("sendStaffDayCloseEmail", () => {
  beforeEach(() => {
    sendMail.mockClear();
    getSettings.mockReset();
    getSettings.mockResolvedValue([{
      smtpHost: "smtp.test",
      smtpPort: "587",
      smtpUser: "user",
      smtpPassword: "pass",
      smtpSecure: false,
      fromAddress: "erp@test.com",
      fromName: "ERP",
      adminEmail: "admin@test.com",
      extraRecipients: "[]",
      staffDayCloseEmailEnabled: true,
    }]);
  });

  test("sends a separate email per staff close (Vijay, then Sanjeev)", async () => {
    await sendStaffDayCloseEmail({ ...basePayload, staffName: "Vijay", closureId: 10, drawerStatus: "balanced" });
    await sendStaffDayCloseEmail({ ...basePayload, staffName: "Sanjeev", closureId: 11, drawerStatus: "balanced" });

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      subject: expect.stringContaining("Vijay"),
      html: expect.stringContaining("Vijay"),
    }));
    expect(sendMail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      subject: expect.stringContaining("Sanjeev"),
      html: expect.stringContaining("Sanjeev"),
    }));
  });

  test("skips when staff day-close email toggle is off", async () => {
    getSettings.mockResolvedValue([{
      smtpHost: "smtp.test",
      smtpPort: "587",
      smtpUser: "user",
      smtpPassword: "pass",
      smtpSecure: false,
      fromAddress: "erp@test.com",
      fromName: "ERP",
      adminEmail: "admin@test.com",
      extraRecipients: "[]",
      staffDayCloseEmailEnabled: false,
    }]);

    await sendStaffDayCloseEmail({ ...basePayload, staffName: "Vijay" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("sends when staffDayCloseEmailEnabled is undefined (default on)", async () => {
    getSettings.mockResolvedValue([{
      smtpHost: "smtp.test",
      smtpPort: "587",
      smtpUser: "user",
      smtpPassword: "pass",
      smtpSecure: false,
      fromAddress: "erp@test.com",
      fromName: "ERP",
      adminEmail: "admin@test.com",
      extraRecipients: "[]",
    }]);
    const result = await sendStaffDayCloseEmail({ ...basePayload, staffName: "Vijay" });
    expect(result).toEqual({ sent: true, to: ["admin@test.com"] });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test("returns skip reason when SMTP is missing instead of silently no-op", async () => {
    getSettings.mockResolvedValue([{
      smtpHost: "",
      smtpPort: "587",
      smtpUser: "",
      smtpPassword: "",
      smtpSecure: false,
      fromAddress: "erp@test.com",
      fromName: "ERP",
      adminEmail: "admin@test.com",
      extraRecipients: "[]",
      staffDayCloseEmailEnabled: true,
    }]);
    const result = await sendStaffDayCloseEmail({ ...basePayload, staffName: "Vijay" });
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.reason).toMatch(/SMTP/i);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("getAllRecipients accepts JSON array or comma-separated extras", () => {
    expect(getAllRecipients({ adminEmail: "a@x.com", extraRecipients: '["b@x.com"]' })).toEqual(["a@x.com", "b@x.com"]);
    expect(getAllRecipients({ adminEmail: "a@x.com", extraRecipients: "b@x.com, c@x.com" })).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

// The backup alert path (lib/backupAlerts.ts) has no mailer of its own: it reuses `sendAlertEmail`,
// the function the PACS watchdog already uses. Two properties the owner asked for live here rather
// than in the alert layer, so they are pinned at the door the mail actually leaves through.
describe("sendAlertEmail — the recipients and the outcome the backup alerts depend on", () => {
  test("reaches admin_email PLUS the admin-configured extra recipients", async () => {
    // It used to go to `admin_email` alone, while the dedicated backup/summary senders honoured
    // both — so a clinic that subscribed a second address to backup alerts never received them,
    // and had no way to tell the difference from a backup that had actually succeeded.
    getSettings.mockResolvedValue([{
      smtpHost: "smtp.test",
      smtpPort: "587",
      smtpUser: "user",
      smtpPassword: "pass",
      smtpSecure: false,
      fromAddress: "erp@test.com",
      fromName: "ERP",
      adminEmail: "admin@test.com",
      extraRecipients: '["it@clinic.test","oncall@clinic.test"]',
    }]);

    const res = await sendAlertEmail({ subject: "Backup failed: Nightly DB", html: "<p>x</p>" });

    expect(res).toEqual({ ok: true, to: ["admin@test.com", "it@clinic.test", "oncall@clinic.test"], error: null });
    expect(String(sendMail.mock.calls[0]![0].to)).toBe("admin@test.com,it@clinic.test,oncall@clinic.test");
  });

  test("reports an undeliverable alert instead of swallowing it", async () => {
    // "An email delivery failure must not interrupt the backup process" is only safe if the failure
    // is still visible somewhere: the caller records it and retries, rather than believing the
    // clinic was told.
    getSettings.mockResolvedValue([{
      smtpHost: "smtp.test", smtpPort: "587", smtpUser: "user", smtpPassword: "pass", smtpSecure: false,
      fromAddress: "erp@test.com", fromName: "ERP", adminEmail: "admin@test.com", extraRecipients: "[]",
    }]);
    sendMail.mockRejectedValueOnce(new Error("452 too many recipients"));

    const res = await sendAlertEmail({ subject: "s", html: "h" });
    expect(res).toEqual({ ok: false, to: ["admin@test.com"], error: "452 too many recipients" });
  });

  test("says why nothing was sent when SMTP or the admin address is not configured", async () => {
    getSettings.mockResolvedValue([{
      smtpHost: "", smtpPort: "587", smtpUser: "", smtpPassword: "", smtpSecure: false,
      fromAddress: "erp@test.com", fromName: "ERP", adminEmail: "admin@test.com", extraRecipients: "[]",
    }]);
    expect(await sendAlertEmail({ subject: "s", html: "h" }))
      .toEqual({ ok: false, to: [], error: "SMTP transport not configured" });

    getSettings.mockResolvedValue([{
      smtpHost: "smtp.test", smtpPort: "587", smtpUser: "user", smtpPassword: "pass", smtpSecure: false,
      fromAddress: "erp@test.com", fromName: "ERP", adminEmail: "", extraRecipients: "[]",
    }]);
    expect(await sendAlertEmail({ subject: "s", html: "h" }))
      .toEqual({ ok: false, to: [], error: "email_settings has no admin_email" });
  });
});
