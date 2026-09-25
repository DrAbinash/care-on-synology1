/**
 * WhatsApp Delivery v2 API — Lane 1 only (wa.me / Click-to-Chat).
 * No Meta/Cloud API calls. Every send is staff-initiated.
 */
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  clinicSettingsTable,
  patientsTable,
  billsTable,
  paymentsTable,
  patientReportsTable,
  waDeliveryQueueTable,
  waDeliveryAuditTable,
  onlineBookingsTable,
  orderTestsTable,
  testsTable,
} from "@workspace/db";
import { requireStaffAuth, requireStaffSubPermission } from "../middleware/requireStaffAuth";
import { mintShareToken, verifyShareToken } from "../lib/whatsappShareToken";

export const whatsappDeliveryRouter = Router();
export const publicShareRouter = Router();

const PHI_SAFE_MESSAGE_HINT =
  "Messages carry clinic name + link + expiry only (no diagnosis, no amounts).";

function staffName(req: unknown): string {
  const s = (req as { staffSession?: { name?: string; username?: string } | null } | null)?.staffSession;
  return s?.name || s?.username || "staff";
}

function publicOrigin(req: { protocol?: string; get?: (h: string) => string | undefined; headers?: Record<string, unknown> }): string {
  const xfProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = xfProto || req.protocol || "https";
  const host = req.get?.("x-forwarded-host") || req.get?.("host") || "localhost";
  return `${proto}://${host}`;
}

function sharePageUrl(origin: string, kind: "bill" | "report", token: string): string {
  // ERP is served under /erp in production; share pages are public SPA routes.
  const base = origin.replace(/\/$/, "");
  return `${base}/erp/share/${kind}/${encodeURIComponent(token)}`;
}

async function getClinicRow() {
  const [row] = await db
    .select({
      name: clinicSettingsTable.name,
      whatsappDeliveryRouting: clinicSettingsTable.whatsappDeliveryRouting,
      whatsappAutoOfferAfterPrint: clinicSettingsTable.whatsappAutoOfferAfterPrint,
      whatsappClicktochatNumber: clinicSettingsTable.whatsappClicktochatNumber,
      whatsappRememberStationChoice: clinicSettingsTable.whatsappRememberStationChoice,
    })
    .from(clinicSettingsTable)
    .limit(1);
  return row ?? null;
}

function maskPhone(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 4) return "****";
  return `****${d.slice(-4)}`;
}

async function writeAudit(row: {
  actor: string;
  kind: string;
  recordId: string;
  maskedPhone: string;
  tokenExpiry?: Date | null;
  channel?: string;
  consentOverride?: boolean;
  notes?: string;
}) {
  await db.insert(waDeliveryAuditTable).values({
    actor: row.actor,
    kind: row.kind,
    recordId: row.recordId,
    maskedPhone: row.maskedPhone,
    tokenExpiry: row.tokenExpiry ?? null,
    channel: row.channel ?? "wa-me",
    consentOverride: row.consentOverride ?? false,
    notes: row.notes ?? "",
  });
}

/** Delivery settings snapshot (also on clinic-settings GET). */
whatsappDeliveryRouter.get("/settings", requireStaffAuth, async (_req, res) => {
  const clinic = await getClinicRow();
  res.json({
    whatsappDeliveryRouting: clinic?.whatsappDeliveryRouting ?? "patient_only",
    whatsappAutoOfferAfterPrint: clinic?.whatsappAutoOfferAfterPrint ?? true,
    whatsappClicktochatNumber: clinic?.whatsappClicktochatNumber ?? "",
    whatsappRememberStationChoice: clinic?.whatsappRememberStationChoice ?? true,
    clinicName: clinic?.name ?? "Care Diagnostics",
    hint: PHI_SAFE_MESSAGE_HINT,
  });
});

/** Mint a signed share URL for bill or report (7-day default). */
whatsappDeliveryRouter.post("/share-token", requireStaffAuth, async (req, res) => {
  const kind = String(req.body?.kind || "");
  const recordId = Number(req.body?.recordId);
  if ((kind !== "bill" && kind !== "report") || !Number.isFinite(recordId) || recordId <= 0) {
    res.status(400).json({ error: "kind must be bill|report and recordId a positive number" });
    return;
  }
  if (kind === "bill") {
    const [bill] = await db.select({ id: billsTable.id, status: billsTable.status }).from(billsTable).where(eq(billsTable.id, recordId)).limit(1);
    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    if (bill.status === "cancelled") {
      res.status(400).json({ error: "Cancelled bills cannot be shared" });
      return;
    }
  } else {
    const [report] = await db.select({ id: patientReportsTable.id }).from(patientReportsTable).where(eq(patientReportsTable.id, recordId)).limit(1);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
  }
  try {
    const minted = mintShareToken(kind, recordId, { ttlDays: 7 });
    const origin = publicOrigin(req);
    const url = sharePageUrl(origin, kind, minted.token);
    res.json({
      token: minted.token,
      url,
      expiresAt: minted.expiresAt.toISOString(),
      expiryDays: minted.expiryDays,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to mint token" });
  }
});

/** Record a Lane-1 send / consent override (staff click). */
whatsappDeliveryRouter.post("/audit", requireStaffAuth, async (req, res) => {
  const kind = String(req.body?.kind || "").trim();
  const recordId = String(req.body?.recordId ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  const channel = String(req.body?.channel || "wa-me").trim();
  const consentOverride = Boolean(req.body?.consentOverride);
  const tokenExpiryRaw = req.body?.tokenExpiry;
  if (!kind || !recordId) {
    res.status(400).json({ error: "kind and recordId required" });
    return;
  }
  const tokenExpiry = tokenExpiryRaw ? new Date(String(tokenExpiryRaw)) : null;
  await writeAudit({
    actor: staffName(req),
    kind: consentOverride ? "override" : kind,
    recordId,
    maskedPhone: maskPhone(phone),
    tokenExpiry: tokenExpiry && !Number.isNaN(tokenExpiry.getTime()) ? tokenExpiry : null,
    channel,
    consentOverride,
    notes: String(req.body?.notes || "").slice(0, 500),
  });
  res.json({ ok: true });
});

/** Owner-only audit list (Settings → Audit). */
whatsappDeliveryRouter.get(
  "/audit",
  requireStaffAuth,
  requireStaffSubPermission("/settings", "security"),
  async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await db
      .select()
      .from(waDeliveryAuditTable)
      .orderBy(desc(waDeliveryAuditTable.createdAt))
      .limit(limit);
    res.json({
      rows: rows.map((r: typeof waDeliveryAuditTable.$inferSelect) => ({
        id: r.id,
        actor: r.actor,
        kind: r.kind,
        recordId: r.recordId,
        maskedPhone: r.maskedPhone,
        tokenExpiry: r.tokenExpiry?.toISOString() ?? null,
        channel: r.channel,
        consentOverride: r.consentOverride,
        notes: r.notes,
        ts: r.createdAt.toISOString(),
      })),
    });
  },
);

/** Front-desk delivery queue. */
whatsappDeliveryRouter.get("/queue", requireStaffAuth, async (req, res) => {
  const status = String(req.query.status || "pending");
  const rows = await db
    .select()
    .from(waDeliveryQueueTable)
    .where(eq(waDeliveryQueueTable.status, status))
    .orderBy(desc(waDeliveryQueueTable.createdAt))
    .limit(100);
  const clinic = await getClinicRow();
  res.json({
    rows,
    clicktochatNumber: clinic?.whatsappClicktochatNumber ?? "",
    clinicName: clinic?.name ?? "Care Diagnostics",
  });
});

whatsappDeliveryRouter.post("/queue", requireStaffAuth, async (req, res) => {
  const kind = String(req.body?.kind || "booking").trim();
  const patientPhone = String(req.body?.patientPhone || "").trim();
  const prefilledMessage = String(req.body?.prefilledMessage || "").trim();
  const recordId = String(req.body?.recordId || req.body?.bookingRef || "").trim();
  const patientName = String(req.body?.patientName || "").trim();
  const bookingRef = String(req.body?.bookingRef || "").trim();
  const source = String(req.body?.source || "staff").trim();
  if (!prefilledMessage) {
    res.status(400).json({ error: "prefilledMessage required" });
    return;
  }
  const [row] = await db
    .insert(waDeliveryQueueTable)
    .values({
      kind,
      status: "pending",
      patientPhone,
      doctorPhone: String(req.body?.doctorPhone || "").trim(),
      prefilledMessage,
      recordId,
      patientName,
      bookingRef,
      source,
      createdByName: staffName(req),
    })
    .returning();
  res.status(201).json(row);
});

/** Mark queue row sent after staff opens wa.me (one click). */
whatsappDeliveryRouter.post("/queue/:id/send", requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(waDeliveryQueueTable).where(eq(waDeliveryQueueTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Queue row not found" });
    return;
  }
  if (row.status === "sent") {
    res.json({ ok: true, row, alreadySent: true });
    return;
  }
  const [updated] = await db
    .update(waDeliveryQueueTable)
    .set({
      status: "sent",
      sentByName: staffName(req),
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(waDeliveryQueueTable.id, id))
    .returning();
  await writeAudit({
    actor: staffName(req),
    kind: row.kind,
    recordId: row.recordId || row.bookingRef || String(row.id),
    maskedPhone: maskPhone(row.patientPhone),
    channel: "wa-me",
    notes: `queue:${row.id}`,
  });
  res.json({ ok: true, row: updated });
});

/** Public enqueue from online booking confirm (no staff session). */
whatsappDeliveryRouter.post("/public/enqueue-booking", async (req, res) => {
  const bookingRef = String(req.body?.bookingRef || "").trim();
  const patientPhone = String(req.body?.patientPhone || "").trim();
  const patientName = String(req.body?.patientName || "").trim();
  const prefilledMessage = String(req.body?.prefilledMessage || "").trim();
  const whatsappConsent = Boolean(req.body?.whatsappConsent);
  if (!bookingRef || !prefilledMessage) {
    res.status(400).json({ error: "bookingRef and prefilledMessage required" });
    return;
  }
  const [booking] = await db
    .select({ id: onlineBookingsTable.id, bookingRef: onlineBookingsTable.bookingRef })
    .from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.bookingRef, bookingRef))
    .limit(1);
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const [row] = await db
    .insert(waDeliveryQueueTable)
    .values({
      kind: "booking",
      status: "pending",
      patientPhone,
      prefilledMessage,
      recordId: bookingRef,
      patientName,
      bookingRef,
      source: "online_booking",
      createdByName: "online_booking",
    })
    .returning();

  // Persist consent onto linked patient when present.
  if (whatsappConsent && patientPhone) {
    const digits = patientPhone.replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      await db
        .update(patientsTable)
        .set({
          whatsappConsent: true,
          whatsappConsentedBy: "online_booking",
          whatsappConsentedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(patientsTable.phone, patientPhone));
    }
  }

  const clinic = await getClinicRow();
  const clinicNum = (clinic?.whatsappClicktochatNumber || "").replace(/\D/g, "");
  const clickToChat = clinicNum
    ? `https://wa.me/${clinicNum.startsWith("91") || clinicNum.length > 10 ? clinicNum : `91${clinicNum}`}?text=${encodeURIComponent(prefilledMessage)}`
    : null;

  res.status(201).json({ ok: true, queueId: row.id, clickToChat });
});

/** Chatbot handoff — create queue row + return Click-to-Chat link. */
whatsappDeliveryRouter.post("/public/chatbot-handoff", async (req, res) => {
  const patientPhone = String(req.body?.patientPhone || "").trim();
  const patientName = String(req.body?.patientName || "").trim();
  const message = String(req.body?.message || "").trim()
    || `Hello, I need help from Care Diagnostics${patientName ? ` (I am ${patientName})` : ""}.`;
  const bookingRef = String(req.body?.bookingRef || "").trim();
  const [row] = await db
    .insert(waDeliveryQueueTable)
    .values({
      kind: "chatbot_handoff",
      status: "pending",
      patientPhone,
      prefilledMessage: message,
      recordId: bookingRef || `handoff-${Date.now()}`,
      patientName,
      bookingRef,
      source: "chatbot",
      createdByName: "chatbot",
    })
    .returning();
  const clinic = await getClinicRow();
  const clinicNum = (clinic?.whatsappClicktochatNumber || "").replace(/\D/g, "");
  const normalized = clinicNum
    ? (clinicNum.length === 10 ? `91${clinicNum}` : clinicNum)
    : "";
  const clickToChat = normalized
    ? `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
    : null;
  res.status(201).json({
    ok: true,
    queueId: row.id,
    clickToChat,
    transcript: clickToChat
      ? `Continue on WhatsApp: ${clickToChat}`
      : "WhatsApp Click-to-Chat is not configured (set clinic whatsapp_clicktochat_number).",
  });
});

// ── Public share pages (read-only) ──────────────────────────────────────────

function expiredPagePayload() {
  return { ok: false as const, error: "Link expired", message: "This share link has expired or is invalid." };
}

publicShareRouter.get("/bill/:token", async (req, res) => {
  const verified = verifyShareToken(req.params.token, { expectKind: "bill" });
  if (!verified.ok) {
    res.status(410).json(expiredPagePayload());
    return;
  }
  const billId = verified.payload.recordId;
  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1);
  if (!bill || bill.status === "cancelled") {
    res.status(410).json(expiredPagePayload());
    return;
  }
  const [patient] = await db
    .select({
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      patientId: patientsTable.patientId,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, bill.patientId))
    .limit(1);
  const tests = await db
    .select({
      name: testsTable.name,
      price: orderTestsTable.price,
      status: orderTestsTable.status,
    })
    .from(orderTestsTable)
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(eq(orderTestsTable.orderId, bill.orderId));
  const items = tests.filter((t: { status?: string | null }) => (t.status ?? "active") !== "cancelled");
  const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.billId, billId));
  const clinic = await getClinicRow();
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.json({
    ok: true,
    kind: "bill",
    expiresAt: new Date(verified.payload.exp * 1000).toISOString(),
    clinicName: clinic?.name ?? "Care Diagnostics",
    bill: {
      billNumber: bill.billNumber,
      status: bill.status,
      totalAmount: bill.totalAmount,
      paidAmount: bill.paidAmount,
      balanceAmount: bill.balanceAmount,
      createdAt: bill.createdAt,
      patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : "",
      patientId: patient?.patientId ?? "",
      items: items.map((it: { name?: string | null; price?: string | number | null }) => ({
        name: it.name || "Item",
        quantity: 1,
        amount: it.price,
      })),
      payments: payments.map((p: typeof paymentsTable.$inferSelect) => ({
        amount: p.amount,
        method: p.method,
        createdAt: p.createdAt,
      })),
    },
  });
});

publicShareRouter.get("/report/:token", async (req, res) => {
  const verified = verifyShareToken(req.params.token, { expectKind: "report" });
  if (!verified.ok) {
    res.status(410).json(expiredPagePayload());
    return;
  }
  const reportId = verified.payload.recordId;
  const [report] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId)).limit(1);
  if (!report) {
    res.status(410).json(expiredPagePayload());
    return;
  }
  const clinic = await getClinicRow();
  const [patient] = await db
    .select({ firstName: patientsTable.firstName, lastName: patientsTable.lastName })
    .from(patientsTable)
    .where(eq(patientsTable.id, report.patientId))
    .limit(1);
  // PHI-minimal public view: identity + status only, no findings/impression body.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.json({
    ok: true,
    kind: "report",
    expiresAt: new Date(verified.payload.exp * 1000).toISOString(),
    clinicName: clinic?.name ?? "Care Diagnostics",
    report: {
      reportNumber: report.reportNumber,
      status: report.status,
      title: report.title,
      patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : "",
      verifiedAt: report.verifiedAt,
      hasPdf: Boolean(report.publicToken),
      pdfPath: report.publicToken ? `/api/p/r/${report.publicToken}/pdf` : null,
    },
  });
});
