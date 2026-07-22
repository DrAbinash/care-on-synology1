import { Router } from "express";
import { db } from "@workspace/db";
import { emailSettingsTable } from "@workspace/db/schema";
import { getTransporter, getAllRecipients } from "../email";
import { resolveAndCheckHost } from "../lib/pacs/providers";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import { runDailySummary } from "../cron";

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
    adminEmail, extraRecipients, billEditEnabled, dailySummaryEnabled, dailySummaryTimes } = req.body;

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
    dailySummaryTimes: JSON.stringify(
      (() => {
        // "HH:MM" strings, in IST, up to 3 per day; falls back to the
        // previous single-time default if none/invalid were provided.
        const valid = (Array.isArray(dailySummaryTimes) ? dailySummaryTimes : [])
          .filter((t: unknown): t is string => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t))
          .slice(0, 3);
        return valid.length > 0 ? valid : ["17:00"];
      })(),
    ),
  };

  let saved;
  if (existing) {
    [saved] = await db.update(emailSettingsTable).set(data).returning();
  } else {
    [saved] = await db.insert(emailSettingsTable).values(data).returning();
  }

  res.json({ ...saved, smtpPassword: saved.smtpPassword ? "••••••••" : "" });
});

// Sends a standalone SMTP connectivity test. Deliberately NOT gated by the
// bill-edit/daily-summary toggles: the whole point of the button is to verify
// the SMTP credentials and recipient list actually work, regardless of which
// automated emails are switched on.
router.post("/test", async (_req, res) => {
  try {
    const [settings] = await db.select().from(emailSettingsTable).limit(1);
    if (!settings || !settings.smtpHost || !settings.smtpUser) {
      res.status(400).json({ ok: false, message: "Configure and save the SMTP host and user first." });
      return;
    }
    const transport = await getTransporter();
    if (!transport) {
      res.status(400).json({ ok: false, message: "SMTP transport could not be created. Check host/port/credentials." });
      return;
    }
    const recipients = getAllRecipients(settings);
    if (recipients.length === 0) {
      res.status(400).json({ ok: false, message: "Add an admin email (and/or extra recipients) first." });
      return;
    }
    await transport.sendMail({
      from: `"${settings.fromName}" <${settings.fromAddress}>`,
      to: recipients.join(", "),
      subject: "[Test] Care Diagnostics ERP — Email settings verified",
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#1e40af;margin:0 0 12px">Email settings are working ✓</h2>
        <p style="color:#374151">This is a test message from Care Diagnostics ERP. If you received it, your SMTP configuration and recipient list are correct.</p>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Sent ${new Date().toLocaleString("en-IN")}</p>
      </div>`,
    });
    res.json({ ok: true, message: `Test email sent to ${recipients.join(", ")}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message: msg });
  }
});

// Manually send today's daily summary now (bypasses the scheduled-send toggle
// via `force`) so an admin can preview the report on demand. Reuses the same
// enriched aggregation as the scheduled send (cron.ts's fireDailySummary) so
// the manual preview and the real scheduled email never drift apart. Does
// NOT stamp dailySummaryLastSentSlots, so it never blocks the scheduled send.
router.post("/send-summary", async (_req, res) => {
  try {
    const [settings] = await db.select().from(emailSettingsTable).limit(1);
    if (!settings || getAllRecipients(settings).length === 0) {
      res.status(400).json({ ok: false, message: "Add an admin email (and/or extra recipients) first." });
      return;
    }
    if (!(await getTransporter())) {
      res.status(400).json({ ok: false, message: "Configure and save the SMTP server first." });
      return;
    }

    await runDailySummary(true);
    res.json({ ok: true, message: "Daily summary sent." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message: msg });
  }
});

export default router;
