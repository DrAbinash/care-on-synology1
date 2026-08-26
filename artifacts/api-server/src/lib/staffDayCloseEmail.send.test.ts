import { describe, expect, test, vi, beforeEach } from "vitest";

const sendMail = vi.fn(async () => ({}));
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

import { sendStaffDayCloseEmail } from "../email";

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
});
