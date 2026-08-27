/**
 * HL7 v2 Integration — Foundation implementation.
 * Inbound messages arrive at POST /api/internal/hl7/inbound (INTERNAL_API_KEY auth).
 * Staff can view messages and configure settings at /api/radiology/hl7/*.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { hl7IntegrationSettingsTable, hl7MessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { requireInternalApiKey } from "../lib/internalApiKeyAuth";

export const hl7Router = Router();
export const hl7InternalRouter = Router();

// ─── GET /api/radiology/hl7/settings ─────────────────────────────────────────
hl7Router.get("/settings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [row] = await db.select().from(hl7IntegrationSettingsTable).limit(1);
  if (!row) {
    const [created] = await db.insert(hl7IntegrationSettingsTable).values({}).returning();
    res.json({ ...created, inboundEndpointSecret: created?.inboundEndpointSecret ? "••••••••" : "" });
    return;
  }
  res.json({ ...row, inboundEndpointSecret: row.inboundEndpointSecret ? "••••••••" : "" });
});

// ─── PUT /api/radiology/hl7/settings ─────────────────────────────────────────
hl7Router.put("/settings", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const {
    isEnabled, sendingFacility, receivingFacility, hl7Version,
    enabledMessageTypes, inboundEndpointSecret, notes,
  } = req.body as Partial<typeof hl7IntegrationSettingsTable.$inferInsert>;

  const [existing] = await db.select().from(hl7IntegrationSettingsTable).limit(1);
  const updates: Partial<typeof hl7IntegrationSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (isEnabled !== undefined) updates.isEnabled = isEnabled;
  if (sendingFacility !== undefined) updates.sendingFacility = sendingFacility;
  if (receivingFacility !== undefined) updates.receivingFacility = receivingFacility;
  if (hl7Version !== undefined) updates.hl7Version = hl7Version;
  if (enabledMessageTypes !== undefined) updates.enabledMessageTypes = enabledMessageTypes;
  if (notes !== undefined) updates.notes = notes;
  if (inboundEndpointSecret !== undefined && inboundEndpointSecret !== "••••••••") {
    updates.inboundEndpointSecret = inboundEndpointSecret;
  }

  let saved: typeof hl7IntegrationSettingsTable.$inferSelect | undefined;
  if (existing) {
    [saved] = await db.update(hl7IntegrationSettingsTable).set(updates).where(eq(hl7IntegrationSettingsTable.id, existing.id)).returning();
  } else {
    [saved] = await db.insert(hl7IntegrationSettingsTable).values(updates as typeof hl7IntegrationSettingsTable.$inferInsert).returning();
  }

  res.json({ ...saved, inboundEndpointSecret: saved?.inboundEndpointSecret ? "••••••••" : "" });
});

// ─── GET /api/radiology/hl7/messages ─────────────────────────────────────────
hl7Router.get("/messages", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const limit = Math.min(Number(req.query["limit"] ?? 50), 500);
  const offset = Number(req.query["offset"] ?? 0);

  const rows = await db.select().from(hl7MessagesTable)
    .orderBy(desc(hl7MessagesTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json(rows);
});

// ─── POST /api/radiology/hl7/test ────────────────────────────────────────────
hl7Router.post("/test", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [settings] = await db.select().from(hl7IntegrationSettingsTable).limit(1);
  if (!settings?.isEnabled) {
    res.json({ success: false, message: "HL7 integration is disabled. Enable it in settings." }); return;
  }

  // Insert a synthetic ACK message as a self-test
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const testMessage = `MSH|^~\\&|${settings.sendingFacility ?? "DIAGNO"}|${settings.receivingFacility ?? "TEST"}|ACK|${timestamp}||ACK^R01|TEST_${Date.now()}|P|${settings.hl7Version ?? "2.5"}|\r\nMSA|AA|TEST_${Date.now()}|Message received successfully|`;

  await db.insert(hl7MessagesTable).values({
    direction: "OUTBOUND",
    messageType: "ACK",
    sendingFacility: settings.sendingFacility ?? null,
    receivingFacility: settings.receivingFacility ?? null,
    messageControlId: `TEST_${Date.now()}`,
    status: "processed",
    rawMessage: testMessage,
    parsedJson: JSON.stringify({ type: "ACK", status: "AA", note: "Self-test from ERP" }),
    processedAt: now,
  });

  res.json({ success: true, message: "HL7 self-test ACK generated and logged successfully." });
});

// ─── POST /api/internal/hl7/inbound ─────────────────────────────────────────
// Authenticated via INTERNAL_API_KEY bearer token (same as internal radiology routes).
hl7InternalRouter.use(requireInternalApiKey);
hl7InternalRouter.post("/inbound", async (req, res): Promise<void> => {
  const [settings] = await db.select().from(hl7IntegrationSettingsTable).limit(1);
  if (!settings?.isEnabled) {
    res.status(503).json({ error: "HL7 integration is disabled" }); return;
  }

  const rawMessage = typeof req.body === "string"
    ? req.body
    : JSON.stringify(req.body);

  if (!rawMessage || rawMessage.trim().length === 0) {
    res.status(400).json({ error: "Empty message body" }); return;
  }

  // Basic HL7 v2 parsing — extract MSH segment fields
  const lines = rawMessage.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
  const mshLine = lines.find((l) => l.startsWith("MSH"));
  let messageType = "UNKNOWN";
  let messageControlId: string | null = null;
  let sendingFacility: string | null = null;
  let patientId: string | null = null;
  let accessionNumber: string | null = null;
  let parsedJson: Record<string, unknown> = {};

  if (mshLine) {
    const fields = mshLine.split("|");
    messageType = (fields[8] ?? "").split("^")[0] ?? "UNKNOWN";
    messageControlId = fields[9] ?? null;
    sendingFacility = fields[3] ?? null;

    const enabledTypes = (settings.enabledMessageTypes ?? "ADT,ORM,ORU").split(",");
    if (!enabledTypes.includes(messageType)) {
      await db.insert(hl7MessagesTable).values({
        direction: "INBOUND",
        messageType,
        sendingFacility,
        messageControlId,
        status: "ignored",
        rawMessage: rawMessage.slice(0, 10000),
        errorMessage: `Message type ${messageType} not enabled`,
      });
      res.status(200).json({ status: "ignored", messageType });
      return;
    }

    // Extract PID segment for patient ID
    const pidLine = lines.find((l) => l.startsWith("PID"));
    if (pidLine) {
      const pidFields = pidLine.split("|");
      patientId = (pidFields[3] ?? "").split("^")[0] || null;
    }

    // Extract OBR/ORC for accession number in ORM/ORU
    const obrLine = lines.find((l) => l.startsWith("OBR"));
    if (obrLine) {
      const obrFields = obrLine.split("|");
      accessionNumber = (obrFields[3] ?? "").split("^")[0] || null;
    }

    parsedJson = { messageType, messageControlId, sendingFacility, patientId, accessionNumber };
  }

  await db.insert(hl7MessagesTable).values({
    direction: "INBOUND",
    messageType,
    sendingFacility,
    receivingFacility: settings.receivingFacility ?? null,
    patientId,
    accessionNumber,
    messageControlId,
    status: "received",
    rawMessage: rawMessage.slice(0, 10000),
    parsedJson: JSON.stringify(parsedJson),
    processedAt: new Date(),
  });

  // ACK response
  const ackTimestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const ack = `MSH|^~\\&|${settings.receivingFacility ?? "ERP"}|${settings.sendingFacility ?? "SRC"}|||${ackTimestamp}||ACK^${messageType}|ACK_${Date.now()}|P|${settings.hl7Version ?? "2.5"}|\rMSA|AA|${messageControlId ?? ""}|Message received|`;

  res.status(200)
    .type("text/plain")
    .send(ack);
});
