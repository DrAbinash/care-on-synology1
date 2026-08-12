/**
 * queueDisplaySettings.ts — Admin API for configurable TV / kiosk queue
 * display screens (USG Room, X-Ray Room, Reception, etc.)
 *
 * Enhancement, not a parallel system: this route only manages *presentation*
 * settings (branding, cards shown, QR image, instruction rows, footer). All
 * live token / queue data continues to come from the existing, already
 * production-hardened /api/display/queue and /api/display/queue-stream
 * endpoints (SSE, display-token auth, department grouping, privacy masking).
 * See display.ts — nothing there was touched.
 *
 * GET  /api/settings/queue-display/:roomKey   (staff auth OR display token —
 *      the public TV page needs to read settings without a staff session)
 * PATCH /api/settings/queue-display/:roomKey  (staff auth required — this is
 *      an admin write, unlike the read-only display feed)
 *
 * roomKey examples: "usg", "xray", "reception". A new row is auto-created
 * with sane defaults the first time a given roomKey is requested, so no
 * manual seeding is required to add a new display in the future.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { queueDisplaySettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import multer from "multer";
import { displayCommandBroadcaster, type DisplayCommand } from "../lib/displayCommandBroadcast";
import { displayHeartbeatTracker } from "../lib/displayHeartbeatTracker";
import { buildPingMessage } from "../lib/queueDisplayPingScheduler";
import {
  inferDepartmentFromRoomKey,
  resolveQueueDisplayDepartments,
  shouldSelfHealModalityRoomDepartments,
} from "../lib/queueDisplayDepartments";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";

export const queueDisplaySettingsRouter: IRouter = Router();

// Re-derive the same display token used by display.ts so the public TV page
// (which has no staff login) can also read its own settings. Kept in sync by
// using the identical env var / seed — no new secret to manage.
function getDisplayToken(): string {
  if (process.env.DISPLAY_ACCESS_TOKEN) return process.env.DISPLAY_ACCESS_TOKEN;
  const seed = process.env.DATABASE_URL || process.env.PGPASSWORD || "care-diagnostics-display-default";
  return crypto.createHash("sha256").update(`display-token:${seed}`).digest("hex").slice(0, 32);
}

function isDisplayTokenValid(req: Request): boolean {
  const provided = (req.query.displayToken as string | undefined)?.trim();
  if (!provided) return false;
  const expected = getDisplayToken();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// GET is allowed either by staff session OR a valid display token, so the
// unattended TV can fetch its own settings just like it fetches queue data.
function readAuth(req: Request, res: Response, next: () => void): void {
  if (isDisplayTokenValid(req)) { next(); return; }
  requireStaffAuth(req as Parameters<typeof requireStaffAuth>[0], res, next);
}

const DEFAULT_INSTRUCTION_ITEMS = [
  { id: "1", icon: "👤", text: "Please keep your token ready", color: "#fbbf24", enabled: true },
  { id: "2", icon: "🧑‍🤝‍🧑", text: "One attendant per patient", color: "#60a5fa", enabled: true },
  { id: "3", icon: "🔇", text: "Silence your mobile phone", color: "#4ade80", enabled: true },
];

type InstructionItem = { id: string; icon: string; text: string; color: string; enabled: boolean };
type MediaItem = { id: string; type: "image" | "video"; url: string; durationSeconds: number; enabled: boolean };

function serialize(row: typeof queueDisplaySettingsTable.$inferSelect) {
  let instructionItems: InstructionItem[];
  try {
    instructionItems = JSON.parse(row.instructionItems);
    if (!Array.isArray(instructionItems)) instructionItems = DEFAULT_INSTRUCTION_ITEMS;
  } catch {
    instructionItems = DEFAULT_INSTRUCTION_ITEMS;
  }
  let mediaItems: MediaItem[];
  try {
    mediaItems = JSON.parse(row.mediaItems);
    if (!Array.isArray(mediaItems)) mediaItems = [];
  } catch {
    mediaItems = [];
  }
  return {
    id: row.id,
    roomKey: row.roomKey,
    displayName: row.displayName,
    location: row.location,
    logoUrl: row.logoUrl,
    showLogo: row.showLogo,
    showDisplayName: row.showDisplayName,
    showLocation: row.showLocation,
    roomTitle: row.roomTitle,
    showRoomTitle: row.showRoomTitle,
    showNowServing: row.showNowServing,
    showNextPatients: row.showNextPatients,
    nextPatientCount: row.nextPatientCount,
    showQrBooking: row.showQrBooking,
    qrImageUrl: row.qrImageUrl,
    qrHeading: row.qrHeading,
    qrSubheading: row.qrSubheading,
    qrDescription: row.qrDescription,
    qrButtonText: row.qrButtonText,
    instructionItems,
    showAnnouncement: row.showAnnouncement,
    announcementText: row.announcementText,
    phone: row.phone,
    showPhone: row.showPhone,
    website: row.website,
    showWebsite: row.showWebsite,
    slogan: row.slogan,
    showSlogan: row.showSlogan,
    themeMode: row.themeMode,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    accentColor: row.accentColor,
    backgroundColor: row.backgroundColor,
    cardBackgroundColor: row.cardBackgroundColor,
    textColor: row.textColor,
    layoutOrientation: row.layoutOrientation,
    kioskWakeLock: row.kioskWakeLock,
    kioskAutoFullscreen: row.kioskAutoFullscreen,
    kioskAutoReload: row.kioskAutoReload,
    kioskPreventExit: row.kioskPreventExit,
    showWaitEstimate: row.showWaitEstimate,
    voiceAnnouncementEnabled: row.voiceAnnouncementEnabled,
    language: row.language,
    patientPingEnabled: row.patientPingEnabled,
    patientPingTokensBefore: row.patientPingTokensBefore,
    showMedia: row.showMedia,
    mediaItems,
    mediaIntervalMinutes: row.mediaIntervalMinutes,
    mediaDurationSeconds: row.mediaDurationSeconds,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    quietHoursDimPercent: row.quietHoursDimPercent,
    staffAlertEnabled: row.staffAlertEnabled,
    staffAlertPhone: row.staffAlertPhone,
    staffAlertAfterMinutes: row.staffAlertAfterMinutes,
    ledgerId: row.ledgerId,
    // Effective filter — blank DB value + roomKey "usg" must not mean "every department".
    departments: resolveQueueDisplayDepartments(row.roomKey, row.departments).join(","),
  };
}

async function getOrCreate(roomKey: string) {
  const rows = await db.select().from(queueDisplaySettingsTable).where(eq(queueDisplaySettingsTable.roomKey, roomKey)).limit(1);
  if (rows[0]) {
    // Self-heal legacy modality-room rows:
    //  - blank departments (old "show everything" bug), OR
    //  - foreign-only imaging list that omits the room's own dept
    //    (e.g. roomKey "usg" + departments "MRI,CT")
    const heal = shouldSelfHealModalityRoomDepartments(roomKey, rows[0].departments);
    if (heal.heal && heal.target) {
      const [healed] = await db
        .update(queueDisplaySettingsTable)
        .set({ departments: heal.target, updatedAt: new Date() })
        .where(eq(queueDisplaySettingsTable.id, rows[0].id))
        .returning();
      if (healed) return healed;
    }
    return rows[0];
  }
  const roomTitle = roomKey.toUpperCase().replace(/[-_]/g, " ") + (roomKey.toLowerCase().endsWith("room") ? "" : " ROOM");
  const inferred = inferDepartmentFromRoomKey(roomKey);
  const [created] = await db.insert(queueDisplaySettingsTable).values({
    roomKey,
    roomTitle,
    ...(inferred ? { departments: inferred } : {}),
  }).returning();
  return created;
}

// ─── GET /api/settings/queue-display — list all configured displays ──────
//
// Powers the admin UI's room picker so doctors can see/add MRI, CT, X-Ray,
// USG, Reception, etc. without any code change. Staff auth only (admin list,
// not needed by the unattended TV — the TV only ever knows its own roomKey).

queueDisplaySettingsRouter.get("/", requireStaffAuth, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(queueDisplaySettingsTable).orderBy(queueDisplaySettingsTable.roomKey);
    res.json(rows.map((r: typeof queueDisplaySettingsTable.$inferSelect) => ({
      roomKey: r.roomKey,
      roomTitle: r.roomTitle,
      displayName: r.displayName,
      lastSeenAt: displayHeartbeatTracker.getLastSeen(r.roomKey),
      online: displayHeartbeatTracker.isOnline(r.roomKey),
      staffAlertEnabled: r.staffAlertEnabled,
    })));
  } catch (err) {
    req.log?.error?.({ err }, "queue-display-settings LIST error");
    res.status(500).json({ error: "Failed to list queue displays" });
  }
});

// ─── GET /api/settings/queue-display/:roomKey ─────────────────────────────

queueDisplaySettingsRouter.get("/:roomKey", readAuth as any, async (req, res): Promise<void> => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  if (!roomKey || !/^[a-z0-9-]+$/.test(roomKey)) {
    res.status(400).json({ error: "roomKey must contain only lowercase letters, numbers, and hyphens" });
    return;
  }
  try {
    const row = await getOrCreate(roomKey);
    displayHeartbeatTracker.touch(roomKey);
    res.json(serialize(row));
  } catch (err) {
    req.log?.error?.({ err }, "queue-display-settings GET error");
    res.status(500).json({ error: "Failed to load queue display settings" });
  }
});

// ─── PATCH /api/settings/queue-display/:roomKey (staff auth required) ─────

const TEXT_FIELDS = [
  "displayName", "location", "logoUrl", "roomTitle", "qrImageUrl", "qrHeading",
  "qrSubheading", "qrDescription", "qrButtonText", "announcementText", "phone",
  "website", "slogan", "themeMode", "primaryColor", "secondaryColor", "accentColor",
  "backgroundColor", "cardBackgroundColor", "textColor",
  "staffAlertPhone",
  "departments",
] as const;

const BOOL_FIELDS = [
  "showLogo", "showDisplayName", "showLocation", "showRoomTitle", "showNowServing",
  "showNextPatients", "showQrBooking", "showAnnouncement", "showPhone", "showWebsite",
  "showSlogan", "kioskWakeLock", "kioskAutoFullscreen", "kioskAutoReload", "kioskPreventExit",
  "showWaitEstimate", "voiceAnnouncementEnabled", "patientPingEnabled", "showMedia",
  "quietHoursEnabled", "staffAlertEnabled",
] as const;

const LAYOUT_ORIENTATIONS = ["portrait", "landscape"] as const;
const LANGUAGES = ["en", "hi"] as const;
const MEDIA_TYPES = ["image", "video"] as const;
const DISPLAY_COMMANDS: readonly DisplayCommand[] = ["reload"] as const;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateIntRange(body: Record<string, unknown>, field: string, min: number, max: number): number | undefined {
  if (body[field] === undefined) return undefined;
  const n = Number(body[field]);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

queueDisplaySettingsRouter.patch("/:roomKey", requireStaffAuth, async (req, res): Promise<void> => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  if (!roomKey || !/^[a-z0-9-]+$/.test(roomKey)) {
    res.status(400).json({ error: "roomKey must contain only lowercase letters, numbers, and hyphens" });
    return;
  }

  const body = req.body ?? {};
  const update: Record<string, unknown> = {};

  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "string") {
        res.status(400).json({ error: `${f} must be a string` });
        return;
      }
      if (body[f].length > 2_000_000) {
        res.status(413).json({ error: `${f} is too large` });
        return;
      }
      update[f] = body[f];
    }
  }

  for (const f of BOOL_FIELDS) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "boolean") {
        res.status(400).json({ error: `${f} must be a boolean` });
        return;
      }
      update[f] = body[f];
    }
  }

  if (body.nextPatientCount !== undefined) {
    const n = Number(body.nextPatientCount);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      res.status(400).json({ error: "nextPatientCount must be an integer between 1 and 20" });
      return;
    }
    update.nextPatientCount = n;
  }

  if (body.layoutOrientation !== undefined) {
    if (!LAYOUT_ORIENTATIONS.includes(body.layoutOrientation)) {
      res.status(400).json({ error: `layoutOrientation must be one of: ${LAYOUT_ORIENTATIONS.join(", ")}` });
      return;
    }
    update.layoutOrientation = body.layoutOrientation;
  }

  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) {
      res.status(400).json({ error: `language must be one of: ${LANGUAGES.join(", ")}` });
      return;
    }
    update.language = body.language;
  }

  for (const [field, start, end] of [
    ["patientPingTokensBefore", 1, 10],
    ["mediaIntervalMinutes", 1, 60],
    ["mediaDurationSeconds", 5, 300],
    ["quietHoursDimPercent", 0, 90],
    ["staffAlertAfterMinutes", 1, 120],
  ] as const) {
    try {
      const n = validateIntRange(body, field, start, end);
      if (n !== undefined) update[field] = n;
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }

  for (const f of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "string" || (body[f] !== "" && !HHMM_RE.test(body[f]))) {
        res.status(400).json({ error: `${f} must be "" or a 24h "HH:MM" time` });
        return;
      }
      update[f] = body[f];
    }
  }

  if (body.mediaItems !== undefined) {
    if (!Array.isArray(body.mediaItems)) {
      res.status(400).json({ error: "mediaItems must be an array" });
      return;
    }
    if (body.mediaItems.length > 20) {
      res.status(400).json({ error: "mediaItems supports at most 20 entries" });
      return;
    }
    const valid = body.mediaItems.every((it: unknown) =>
      it && typeof it === "object" &&
      typeof (it as any).id === "string" &&
      MEDIA_TYPES.includes((it as any).type) &&
      typeof (it as any).url === "string" && (it as any).url.length > 0 &&
      Number.isInteger((it as any).durationSeconds) && (it as any).durationSeconds >= 3 && (it as any).durationSeconds <= 300 &&
      typeof (it as any).enabled === "boolean",
    );
    if (!valid) {
      res.status(400).json({ error: "Each media item needs id, type ('image'|'video'), url, durationSeconds (3-300) and enabled (boolean)" });
      return;
    }
    update.mediaItems = JSON.stringify(body.mediaItems);
  }

  if (body.ledgerId !== undefined) {
    const n = Number(body.ledgerId);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "ledgerId must be a positive integer" });
      return;
    }
    update.ledgerId = n;
  }

  if (body.instructionItems !== undefined) {
    if (!Array.isArray(body.instructionItems)) {
      res.status(400).json({ error: "instructionItems must be an array" });
      return;
    }
    if (body.instructionItems.length > 12) {
      res.status(400).json({ error: "instructionItems supports at most 12 entries" });
      return;
    }
    const valid = body.instructionItems.every((it: unknown) =>
      it && typeof it === "object" &&
      typeof (it as any).id === "string" &&
      typeof (it as any).icon === "string" &&
      typeof (it as any).text === "string" &&
      typeof (it as any).color === "string" &&
      typeof (it as any).enabled === "boolean",
    );
    if (!valid) {
      res.status(400).json({ error: "Each instruction item needs id, icon, text, color (string) and enabled (boolean)" });
      return;
    }
    update.instructionItems = JSON.stringify(body.instructionItems);
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  update.updatedAt = new Date();

  try {
    const existing = await getOrCreate(roomKey); // ensure row exists
    // Persist inferred departments on admin save — blank must not mean "every
    // department" on modality-specific TVs (e.g. roomKey "usg" → USG only).
    // Also reject legacy foreign-only lists (e.g. "MRI,CT" on usg) unless the
    // room's own department is included (intentional multi-dept).
    const candidate = update.departments !== undefined
      ? String(update.departments)
      : existing.departments;
    const heal = shouldSelfHealModalityRoomDepartments(roomKey, candidate);
    if (heal.heal && heal.target) {
      update.departments = heal.target;
    }
    const [saved] = await db
      .update(queueDisplaySettingsTable)
      .set(update)
      .where(eq(queueDisplaySettingsTable.roomKey, roomKey))
      .returning();
    res.json(serialize(saved));
  } catch (err) {
    req.log?.error?.({ err }, "queue-display-settings PATCH error");
    res.status(500).json({ error: "Failed to save queue display settings" });
  }
});

// ─── GET /api/settings/queue-display/:roomKey/stream (readAuth) ──────────
// Remote-admin channel: pushes commands (e.g. "reload") from the ERP's
// Remote Control panel to the unattended TV over SSE. Same auth model as
// the settings GET — the TV has no staff session, so a valid displayToken
// is accepted alongside a staff session.

queueDisplaySettingsRouter.get("/:roomKey/stream", readAuth as any, (req, res): void => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":ok\n\n");
  displayHeartbeatTracker.touch(roomKey);

  const heartbeat = setInterval(() => res.write(":hb\n\n"), 25_000);

  const handler = (evt: { roomKey: string; command: DisplayCommand; ts: number }) => {
    if (evt.roomKey !== roomKey) return;
    res.write(`data: ${JSON.stringify({ command: evt.command, ts: evt.ts })}\n\n`);
  };
  displayCommandBroadcaster.on("display-command", handler);

  req.on("close", () => {
    clearInterval(heartbeat);
    displayCommandBroadcaster.off("display-command", handler);
  });
});

// ─── POST /api/settings/queue-display/:roomKey/command (staff auth) ──────
// Sends a one-off remote command (currently just "reload") to whichever TV
// is subscribed to this room's stream. Fire-and-forget — there is no ack
// from the TV, matching the rest of this table's "presentation only, no
// new business logic" scope.

queueDisplaySettingsRouter.post("/:roomKey/command", requireStaffAuth, (req, res): void => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  const command = req.body?.command;
  if (!DISPLAY_COMMANDS.includes(command)) {
    res.status(400).json({ error: `command must be one of: ${DISPLAY_COMMANDS.join(", ")}` });
    return;
  }
  displayCommandBroadcaster.send(roomKey, command);
  res.json({ success: true });
});

// ─── POST /api/settings/queue-display/:roomKey/test-ping (staff auth) ────
// Sends the SAME "you're almost up" message the real scheduler would send
// (see lib/queueDisplayPingScheduler.ts's shared buildPingMessage), to a
// phone number the admin supplies, so a room can be verified end-to-end
// before Patient Notifications is switched on for real patients. Reports
// whether WHATSAPP_PROVIDER is actually configured to a real provider: the
// mock provider always reports success, so without this an admin could
// enable patient pings believing they work when nothing is really being
// sent.

queueDisplaySettingsRouter.post("/:roomKey/test-ping", requireStaffAuth, async (req, res): Promise<void> => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  if (!roomKey || !/^[a-z0-9-]+$/.test(roomKey)) {
    res.status(400).json({ error: "roomKey must contain only lowercase letters, numbers, and hyphens" });
    return;
  }
  const phone = String(req.body?.phone || "").trim();
  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }

  try {
    const room = await getOrCreate(roomKey);
    const service = getWhatsAppService();
    const normalizedPhone = service.normalizePhone(phone);
    const text = `[TEST MESSAGE] ${buildPingMessage({
      roomTitle: room.roomTitle, roomKey: room.roomKey, tokenLabel: "TEST",
    })}`;
    const result = await service.sendText(normalizedPhone, text);
    const provider = (process.env.WHATSAPP_PROVIDER || "mock").toLowerCase();
    res.json({
      success: result.ok,
      error: result.error,
      provider,
      usedMockProvider: provider === "mock",
      message: text,
    });
  } catch (err) {
    req.log?.error?.({ err }, "queue-display-settings TEST-PING error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send test ping" });
  }
});

// ─── POST /api/settings/queue-display/:roomKey/heartbeat (readAuth) ──────
// The kiosk hook pings this every ~30s so the "Displays" overview page can
// show accurate online/last-seen status per room and the staff-offline
// alert scheduler (cron.ts) knows when a TV has actually gone dark.

queueDisplaySettingsRouter.post("/:roomKey/heartbeat", readAuth as any, (req, res): void => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  displayHeartbeatTracker.touch(roomKey);
  displayHeartbeatTracker.clearAlert(roomKey);
  res.json({ ok: true });
});

// ─── POST /api/settings/queue-display/:roomKey/clone (staff auth) ────────
// Copies every presentation field from an existing room into this one —
// lets an admin stand up a new room (MRI, CT, X-Ray...) starting from a
// room that's already dialed in, instead of re-entering every field.

queueDisplaySettingsRouter.post("/:roomKey/clone", requireStaffAuth, async (req, res): Promise<void> => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  const fromRoomKey = String(req.body?.fromRoomKey || "").trim().toLowerCase();
  if (!roomKey || !/^[a-z0-9-]+$/.test(roomKey)) {
    res.status(400).json({ error: "roomKey must contain only lowercase letters, numbers, and hyphens" });
    return;
  }
  if (!fromRoomKey) {
    res.status(400).json({ error: "fromRoomKey is required" });
    return;
  }
  try {
    const [source] = await db.select().from(queueDisplaySettingsTable).where(eq(queueDisplaySettingsTable.roomKey, fromRoomKey)).limit(1);
    if (!source) {
      res.status(404).json({ error: `No display settings found for room "${fromRoomKey}"` });
      return;
    }
    const { id, roomKey: _rk, createdAt, updatedAt, ...cloneable } = source;
    await getOrCreate(roomKey); // ensure the target row exists
    const [saved] = await db
      .update(queueDisplaySettingsTable)
      .set({ ...cloneable, updatedAt: new Date() })
      .where(eq(queueDisplaySettingsTable.roomKey, roomKey))
      .returning();
    res.json(serialize(saved));
  } catch (err) {
    req.log?.error?.({ err }, "queue-display-settings CLONE error");
    res.status(500).json({ error: "Failed to clone queue display settings" });
  }
});

// ─── Media uploads (branding / video interstitial) ────────────────────────
// Same pattern as website.ts's /photos endpoint: multer memory storage →
// write to data/uploads/queue-display → served via the existing /uploads
// static mount in app.ts. Video allowed (unlike the photos endpoint) since
// this is a full-screen branding break, not a small site image.

const MEDIA_UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "queue-display");

const MEDIA_MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (MEDIA_MIME_TO_EXT[file.mimetype]) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB — enough for a short branding clip
});

queueDisplaySettingsRouter.post("/:roomKey/media", requireStaffAuth, mediaUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file" }); return; }
  const ext = MEDIA_MIME_TO_EXT[req.file.mimetype];
  if (!ext) { res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}` }); return; }
  try {
    await fs.mkdir(MEDIA_UPLOAD_DIR, { recursive: true });
    const fileName = `${crypto.randomUUID()}${ext}`;
    await fs.writeFile(path.join(MEDIA_UPLOAD_DIR, fileName), req.file.buffer);
    res.status(201).json({
      url: `/uploads/queue-display/${fileName}`,
      type: req.file.mimetype.startsWith("video/") ? "video" : "image",
    });
  } catch (err) {
    req.log.error({ err }, "Queue display media upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── DELETE /api/settings/queue-display/:roomKey/media (staff auth) ──────
// Best-effort disk cleanup for a media file no longer referenced by any
// room's mediaItems. The admin UI removes the entry from mediaItems via
// PATCH first, then calls this to reclaim disk space.

queueDisplaySettingsRouter.delete("/:roomKey/media", requireStaffAuth, async (req, res): Promise<void> => {
  const url = String(req.body?.url || req.query?.url || "");
  if (!url.startsWith("/uploads/queue-display/")) {
    res.status(400).json({ error: "url must be an /uploads/queue-display/ path" });
    return;
  }
  const localPath = path.join(MEDIA_UPLOAD_DIR, path.basename(url));
  await fs.unlink(localPath).catch(() => {});
  res.json({ ok: true });
});

// ─── DELETE /api/settings/queue-display/:roomKey (staff auth required) ────
// Removes a display's settings row. Does not touch test_tokens or any queue
// data — purely deletes presentation config for that TV.

queueDisplaySettingsRouter.delete("/:roomKey", requireStaffAuth, async (req, res): Promise<void> => {
  const roomKey = String(req.params.roomKey || "").trim().toLowerCase();
  if (!roomKey) {
    res.status(400).json({ error: "roomKey is required" });
    return;
  }
  try {
    await db.delete(queueDisplaySettingsTable).where(eq(queueDisplaySettingsTable.roomKey, roomKey));
    res.json({ success: true });
  } catch (err) {
    req.log?.error?.({ err }, "queue-display-settings DELETE error");
    res.status(500).json({ error: "Failed to delete queue display settings" });
  }
});

export default queueDisplaySettingsRouter;
