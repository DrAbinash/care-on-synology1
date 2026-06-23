import { Router } from "express";
import { db } from "@workspace/db";
import { emailSettingsTable } from "@workspace/db/schema";
import { sendDailySummaryEmail, sendBillEditEmail } from "../email";
import { resolveAndCheckHost } from "../lib/pacs/providers";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

const router = Router();

// Defense-in-depth: enforce staff authentication at the router level.
// These endpoints read/write SMTP credentials and can trigger outbound
// email/network connections — they must never be reachable without a
// valid staff session.
router.use(requireStaffAuth);

router.get("/", async (_req, res) => {
  const [settings] = await db.select().from(emailSettingsTable).limit(1);
  if (!settings) {
    res.json(null);
    return;
  }
  res.json({ ...settings, smtpPassword: settings.smtpPassword ? "••••••••" : "" });
});

router.post("/", async (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpSecure, fromAddress, fromName,
    adminEmail, extraRecipients, billEditEnabled, dailySummaryEnabled, dailySummaryTime } = req.body;

  if (smtpHost) {
    const check = await resolveAndCheckHost(String(smtpHost));
    if (!check.ok) {
      res.status(400).json({ error: `Invalid SMTP host: ${check.error}` });
      return;
    }
  }

  const [existing] = await db.select().from(emailSettingsTable).limit(1);

  const data = {
    smtpHost: smtpHost ?? "",
    smtpPort: String(smtpPort ?? 587),
    smtpUser: smtpUser ?? "",
    smtpPassword: smtpPassword && smtpPassword !== "••••••••"
      ? smtpPassword
      : (existing?.smtpPassword ?? ""),
    smtpSecure: smtpSecure ?? false,
    fromAddress: fromAddress ?? "",
    fromName: fromName ?? "Care Diagnostics ERP",
    adminEmail: adminEmail ?? "",
    extraRecipients: JSON.stringify(Array.isArray(extraRecipients) ? extraRecipients : []),
    billEditEnabled: billEditEnabled ?? true,
    dailySummaryEnabled: dailySummaryEnabled ?? true,
    dailySummaryTime: dailySummaryTime ?? "17:00",
  };

  let saved;
  if (existing) {
    [saved] = await db.update(emailSettingsTable).set(data).returning();
  } else {
    [saved] = await db.insert(emailSettingsTable).values(data).returning();
  }

  res.json({ ...saved, smtpPassword: saved.smtpPassword ? "••••••••" : "" });
});

router.post("/test", async (_req, res) => {
  try {
    await sendBillEditEmail({
      billNumber: "BILL-TEST-0001",
      patientName: "Test Patient",
      editedBy: "System Test",
      reason: "This is a test email from Care Diagnostics ERP",
      changes: [
        { field: "Status", from: "pending", to: "paid" },
        { field: "Discount", from: "0.00", to: "100.00" },
      ],
    });
    res.json({ ok: true, message: "Test email sent successfully" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message: msg });
  }
});

router.post("/send-summary", async (_req, res) => {
  try {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    await sendDailySummaryEmail({
      date: today,
      totalRevenue: 0,
      totalBills: 0,
      paidBills: 0,
      pendingBills: 0,
      totalPayments: 0,
      billsEdited: 0,
    });
    res.json({ ok: true, message: "Daily summary sent" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message: msg });
  }
});

export default router;
