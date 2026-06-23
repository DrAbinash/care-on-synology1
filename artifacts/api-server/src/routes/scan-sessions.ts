import { Router } from "express";
import { z } from "zod/v4";
import { db, scanSessionsTable, pairedDevicesTable, scanAuditLogsTable } from "@workspace/db";
import { eq, and, gt, desc } from "drizzle-orm";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import type { Response } from "express";

export const scanSessionsRouter = Router();

const UPLOAD_BASE_DIR = join(process.cwd(), "data", "uploads");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function saveUpload(base64Data: string, patientIdOrSessionId: string, type: string): string {
  // Extract clean base64 if it has prefix (e.g. data:image/jpeg;base64,...)
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  let base64Clean = base64Data;
  if (matches && matches.length === 3) {
    base64Clean = matches[2];
  }

  const buffer = Buffer.from(base64Clean, "base64");
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  const targetDir = join(UPLOAD_BASE_DIR, "patients", year, month, patientIdOrSessionId);
  ensureDir(targetDir);
  
  const storedName = `${type}_${crypto.randomBytes(4).toString("hex")}.jpg`;
  const fullPath = join(targetDir, storedName);
  writeFileSync(fullPath, buffer);
  
  return join("patients", year, month, patientIdOrSessionId, storedName).replace(/\\/g, "/");
}

// 1. Create a scan session (Authenticated)
const CreateSessionBody = z.object({
  patientId: z.number().int().positive().optional(),
  linkedFormFId: z.number().int().positive().optional(),
  method: z.enum(["qr", "paired_phone"]).default("qr"),
});

scanSessionsRouter.post("/create", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  try {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { patientId, linkedFormFId, method } = parsed.data;
    const staffId = req.staffSession?.id;
    const username = req.staffSession?.subjectName;

    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    // Find paired device if method is paired_phone
    let pairedDeviceId: string | null = null;
    if (method === "paired_phone" && staffId) {
      const devices = await db
        .select()
        .from(pairedDevicesTable)
        .where(and(eq(pairedDevicesTable.staffId, staffId), eq(pairedDevicesTable.isActive, true)))
        .orderBy(desc(pairedDevicesTable.id))
        .limit(1);
      
      if (devices.length > 0) {
        pairedDeviceId = devices[0].deviceId;
      } else {
        res.status(400).json({ error: "No paired device found for this staff member." });
        return;
      }
    }

    const [session] = await db
      .insert(scanSessionsTable)
      .values({
        sessionToken: token,
        status: "pending",
        staffId: staffId || null,
        pairedDeviceId: pairedDeviceId,
        createdAt: new Date(),
        expiresAt,
      })
      .returning();

    // Log the action
    await db.insert(scanAuditLogsTable).values({
      userId: staffId || null,
      username: username || "unknown",
      method,
      deviceId: pairedDeviceId,
      linkedPatientId: patientId || null,
      linkedFormFId: linkedFormFId || null,
      status: "pending",
      details: `Created scanning session. Token: ${token}`,
      createdAt: new Date(),
    });

    res.status(201).json({
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      pairedDeviceId,
    });
  } catch (err) {
    logger.error({ err }, "Failed to create scan session");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. Poll session status (Public / Token Authorized)
scanSessionsRouter.get("/status/:token", async (req: any, res: any) => {
  try {
    const { token } = req.params;
    const sessions = await db
      .select()
      .from(scanSessionsTable)
      .where(eq(scanSessionsTable.sessionToken, token))
      .limit(1);

    if (sessions.length === 0) {
      res.status(404).json({ error: "Scan session not found" });
      return;
    }

    const session = sessions[0];
    const now = new Date();

    if (session.expiresAt < now && session.status === "pending") {
      // Auto expire session
      await db
        .update(scanSessionsTable)
        .set({ status: "expired" })
        .where(eq(scanSessionsTable.id, session.id));
      
      res.json({ ...session, status: "expired" });
      return;
    }

    res.json(session);
  } catch (err) {
    logger.error({ err }, "Failed to fetch scan session status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. Upload images to session (Public / Token Authorized)
const UploadImagesBody = z.object({
  frontImage: z.string().optional(),
  backImage: z.string().optional(),
  ocrResult: z.any().optional(),
  qrData: z.any().optional(),
  patientId: z.number().int().positive().optional(),
  linkedFormFId: z.number().int().positive().optional(),
});

scanSessionsRouter.post("/upload/:token", async (req: any, res: any) => {
  try {
    const { token } = req.params;
    const parsed = UploadImagesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const sessions = await db
      .select()
      .from(scanSessionsTable)
      .where(eq(scanSessionsTable.sessionToken, token))
      .limit(1);

    if (sessions.length === 0) {
      res.status(404).json({ error: "Scan session not found" });
      return;
    }

    const session = sessions[0];
    if (session.status === "expired" || session.expiresAt < new Date()) {
      res.status(410).json({ error: "Scan session has expired" });
      return;
    }

    const { frontImage, backImage, ocrResult, qrData, patientId, linkedFormFId } = parsed.data;

    // Folder identification
    const folderId = patientId ? String(patientId) : session.sessionToken;

    let frontImageUrl: string | null = null;
    let backImageUrl: string | null = null;

    if (frontImage) {
      frontImageUrl = saveUpload(frontImage, folderId, "front");
    }
    if (backImage) {
      backImageUrl = saveUpload(backImage, folderId, "back");
    }

    await db
      .update(scanSessionsTable)
      .set({
        status: "completed",
        frontImageUrl: frontImageUrl || session.frontImageUrl,
        backImageUrl: backImageUrl || session.backImageUrl,
        ocrResult: ocrResult ? JSON.stringify(ocrResult) : session.ocrResult,
        qrData: qrData ? JSON.stringify(qrData) : session.qrData,
      })
      .where(eq(scanSessionsTable.id, session.id));

    // Log the successful upload in audit logs
    await db.insert(scanAuditLogsTable).values({
      userId: session.staffId,
      username: "mobile_client",
      method: session.pairedDeviceId ? "paired_phone" : "qr",
      deviceId: session.pairedDeviceId,
      linkedPatientId: patientId || null,
      linkedFormFId: linkedFormFId || null,
      status: "success",
      details: `Uploaded scanned files to session. Front: ${frontImageUrl ? "Yes" : "No"}, Back: ${backImageUrl ? "Yes" : "No"}.`,
      createdAt: new Date(),
    });

    res.json({ success: true, frontImageUrl, backImageUrl });
  } catch (err) {
    logger.error({ err }, "Failed to upload images to session");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. Pair a phone (Public/Token Auth or Authenticated Staff)
const PairPhoneBody = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  sessionToken: z.string().optional(),
});

scanSessionsRouter.post("/pair", async (req: any, res: any) => {
  try {
    const parsed = PairPhoneBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { deviceId, deviceName, sessionToken } = parsed.data;
    let staffId = req.staffSession?.id;
    let username = req.staffSession?.subjectName;

    // If no active staff session, try authenticating using the sessionToken
    if (!staffId && sessionToken) {
      const sessions = await db
        .select()
        .from(scanSessionsTable)
        .where(eq(scanSessionsTable.sessionToken, sessionToken))
        .limit(1);

      if (sessions.length > 0 && sessions[0].expiresAt > new Date()) {
        staffId = sessions[0].staffId;
        username = `paired_via_token_${sessions[0].sessionToken.substring(0, 6)}`;
      }
    }

    if (!staffId) {
      res.status(401).json({ error: "Unauthorized. Please login or provide a valid scan session token." });
      return;
    }


    // Set other devices for this staff member to inactive
    await db
      .update(pairedDevicesTable)
      .set({ isActive: false })
      .where(eq(pairedDevicesTable.staffId, staffId));

    // Upsert paired device
    const existing = await db
      .select()
      .from(pairedDevicesTable)
      .where(eq(pairedDevicesTable.deviceId, deviceId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(pairedDevicesTable)
        .set({
          deviceName,
          staffId,
          isActive: true,
        })
        .where(eq(pairedDevicesTable.deviceId, deviceId));
    } else {
      await db.insert(pairedDevicesTable).values({
        deviceId,
        deviceName,
        staffId,
        isActive: true,
        createdAt: new Date(),
      });
    }

    // Log the pairing action
    await db.insert(scanAuditLogsTable).values({
      userId: staffId,
      username: username || "unknown",
      method: "paired_phone",
      deviceId,
      status: "success",
      details: `Paired device: ${deviceName} (ID: ${deviceId})`,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to pair device");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 5. Get paired phone details (Authenticated)
scanSessionsRouter.get("/paired-phone", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  try {
    const staffId = req.staffSession?.id;
    if (!staffId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const devices = await db
      .select()
      .from(pairedDevicesTable)
      .where(and(eq(pairedDevicesTable.staffId, staffId), eq(pairedDevicesTable.isActive, true)))
      .orderBy(desc(pairedDevicesTable.id))
      .limit(1);

    if (devices.length === 0) {
      res.json({ paired: false });
      return;
    }

    res.json({ paired: true, device: devices[0] });
  } catch (err) {
    logger.error({ err }, "Failed to fetch paired phone details");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 6. Mobile client polling (Public / Device ID based)
scanSessionsRouter.get("/mobile-poll/:deviceId", async (req: any, res: any) => {
  try {
    const { deviceId } = req.params;
    
    // Find the newest pending session for this device that is not expired
    const sessions = await db
      .select()
      .from(scanSessionsTable)
      .where(
        and(
          eq(scanSessionsTable.pairedDeviceId, deviceId),
          eq(scanSessionsTable.status, "pending"),
          gt(scanSessionsTable.expiresAt, new Date())
        )
      )
      .orderBy(desc(scanSessionsTable.id))
      .limit(1);

    if (sessions.length === 0) {
      res.json({ pending: false });
      return;
    }

    res.json({
      pending: true,
      sessionToken: sessions[0].sessionToken,
    });
  } catch (err) {
    logger.error({ err }, "Failed during mobile client polling");
    res.status(500).json({ error: "Internal server error" });
  }
});
