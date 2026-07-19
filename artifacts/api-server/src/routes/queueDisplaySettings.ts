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
import { displayCommandBroadcaster, type DisplayCommand } from "../lib/displayCommandBroadcast";

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

function serialize(row: typeof queueDisplaySettingsTable.$inferSelect) {
  let instructionItems: InstructionItem[];
  try {
    instructionItems = JSON.parse(row.instructionItems);
    if (!Array.isArray(instructionItems)) instructionItems = DEFAULT_INSTRUCTION_ITEMS;
  } catch {
    instructionItems = DEFAULT_INSTRUCTION_ITEMS;
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
    ledgerId: row.ledgerId,
    departments: row.departments,
  };
}

async function getOrCreate(roomKey: string) {
  const rows = await db.select().from(queueDisplaySettingsTable).where(eq(queueDisplaySettingsTable.roomKey, roomKey)).limit(1);
  if (rows[0]) return rows[0];
  const roomTitle = roomKey.toUpperCase().replace(/[-_]/g, " ") + (roomKey.toLowerCase().endsWith("room") ? "" : " ROOM");
  const [created] = await db.insert(queueDisplaySettingsTable).values({ roomKey, roomTitle }).returning();
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
    res.json(rows.map((r: typeof queueDisplaySettingsTable.$inferSelect) => ({ roomKey: r.roomKey, roomTitle: r.roomTitle, displayName: r.displayName })));
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
  "departments",
] as const;

const BOOL_FIELDS = [
  "showLogo", "showDisplayName", "showLocation", "showRoomTitle", "showNowServing",
  "showNextPatients", "showQrBooking", "showAnnouncement", "showPhone", "showWebsite",
  "showSlogan", "kioskWakeLock", "kioskAutoFullscreen", "kioskAutoReload", "kioskPreventExit",
] as const;

const LAYOUT_ORIENTATIONS = ["portrait", "landscape"] as const;
const DISPLAY_COMMANDS: readonly DisplayCommand[] = ["reload"] as const;

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
    await getOrCreate(roomKey); // ensure row exists
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
