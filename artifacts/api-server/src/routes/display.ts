/**
 * display.ts — Waiting-room LCD / TV queue feed
 *
 * ENHANCEMENTS IN THIS VERSION (see commit message for full rationale):
 *
 * 1. Display-token authentication
 *    Previously: requireStaffAuth only.
 *    Problem: an unattended Samsung/Android TV running 24 / 7 loses its staff
 *    Bearer token once the JWT expires, making the display go blank silently.
 *    Fix: a deterministic per-installation display token (hash of DATABASE_URL)
 *    is accepted as an alternative to staff auth on BOTH the polling and the
 *    new SSE endpoints. Staff retrieve it via GET /api/display/token (staff-auth
 *    required). No DB migration needed — the token is derived from env vars.
 *
 * 2. Server-Sent Events (GET /api/display/queue-stream)
 *    Replaces the 4-second poll for Display.tsx clients that support it.
 *    After any test-token mutation (PATCH status, POST /call in test-tokens.ts),
 *    queueBroadcaster.broadcast() is called — this endpoint pushes fresh data
 *    within milliseconds. Falls back gracefully to polling if SSE is unavailable.
 *
 * 3. floorLabel on every token in the response
 *    The tests table has a floor_label column that was always populated by
 *    generateTestTokensForOrder() but never surfaced in the TV display.
 *    Patients now see which floor to go to on the waiting-room screen.
 *
 * 4. X-Accel-Buffering: no on SSE responses
 *    Required for nginx reverse proxy (the Synology NAS config) to not buffer
 *    the SSE stream, which would make the events arrive late or not at all.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  testTokensTable, patientsTable, testsTable, clinicSettingsTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import { queueBroadcaster, type QueueUpdateEvent } from "../lib/queueBroadcast";
import { withCache, TTL } from "../lib/ttlCache";

export const displayRouter: IRouter = Router();

// ─── Display token (no-DB auth alternative for unattended TVs) ───────────────
//
// Derived from DATABASE_URL so it is:
//  • Stable across server restarts (same URL → same token)
//  • Unique per clinic installation (URL includes the DB password)
//  • Configurable: override with DISPLAY_ACCESS_TOKEN env var
//  • Safe to share in the TV URL: it's a derived hash, not the URL itself
//
// Staff retrieve the token from GET /api/display/token (staff-auth required)
// and paste it into the TV browser URL as ?displayToken=<token>.

function getDisplayToken(): string {
  if (process.env.DISPLAY_ACCESS_TOKEN) return process.env.DISPLAY_ACCESS_TOKEN;
  const seed = process.env.DATABASE_URL || process.env.PGPASSWORD || "care-diagnostics-display-default";
  return crypto.createHash("sha256").update(`display-token:${seed}`).digest("hex").slice(0, 32);
}

/**
 * Validate displayToken query param.  Returns true if auth is satisfied.
 * Call before requireStaffAuth on endpoints that TVs need to reach.
 */
function isDisplayTokenValid(req: Request): boolean {
  const provided = (req.query.displayToken as string | undefined)?.trim();
  if (!provided) return false;
  const expected = getDisplayToken();
  // Constant-time comparison to prevent timing attacks
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// Middleware: accept display token OR staff Bearer token.
function displayAuth(req: Request, res: Response, next: () => void): void {
  if (isDisplayTokenValid(req)) { next(); return; }
  requireStaffAuth(req as Parameters<typeof requireStaffAuth>[0], res, next);
}

// ─── Staff-only: return the display token so staff can build the TV URL ───────
//
// GET /api/display/token (requireStaffAuth)
// Returns { token, hint } — staff paste the token into the TV browser URL.

displayRouter.get("/token", requireStaffAuth, (_req, res): void => {
  const token = getDisplayToken();
  res.json({
    token,
    hint: `Add ?displayToken=${token} to your TV display URL to allow it to show queue data without a staff login session.`,
  });
});

// ─── Shared helper: fetch queue data for a ledger + optional department filter ─

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchQueueData(opts: {
  ledgerId: number;
  departments: string[];
  date: string;
}): Promise<object> {
  const { ledgerId, departments, date } = opts;

  // Every active TV/kiosk display polls this function every 5-10s. The
  // clinic settings row (queuePrivacyMode) changes essentially never, so
  // reading it live on every single poll was an unnecessary DB round-trip
  // multiplied by however many waiting-room screens are on the network.
  const settings = await withCache("clinic-settings:queue-privacy", TTL.SHORT, () =>
    db.select().from(clinicSettingsTable).limit(1).then((rows) => rows[0])
  );
  const privacyMode = settings?.queuePrivacyMode || "masked";

  const conds = [
    eq(testTokensTable.tokenDate, date),
    inArray(testTokensTable.status, ["waiting", "serving"]),
    ledgerId === 1
      ? or(eq(testTokensTable.ledgerId, 1), isNull(testTokensTable.ledgerId))
      : eq(testTokensTable.ledgerId, ledgerId),
  ];
  if (departments.length > 0) conds.push(inArray(testTokensTable.department, departments));

  const rows = await db
    .select({
      id: testTokensTable.id,
      tokenNo: testTokensTable.tokenNo,
      status: testTokensTable.status,
      priority: testTokensTable.priority,
      department: testTokensTable.department,
      roomNumber: testTokensTable.roomNumber,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      testName: testsTable.name,
      // floorLabel was missing from this endpoint — added now so the TV
      // can show patients which floor to go to (e.g. "Ground Floor", "1st Floor")
      floorLabel: testsTable.floorLabel,
      calledAt: testTokensTable.calledAt,
    })
    .from(testTokensTable)
    .leftJoin(patientsTable, eq(patientsTable.id, testTokensTable.patientId))
    .leftJoin(testsTable, eq(testsTable.id, testTokensTable.testId))
    .where(and(...conds))
    .orderBy(desc(testTokensTable.priority), asc(testTokensTable.tokenNo))
    .limit(200);

  const maskWord = (w: string) => {
    if (!w) return "";
    if (w.length <= 2) return w[0] + "*".repeat(w.length - 1);
    return w[0] + "*".repeat(w.length - 2) + w[w.length - 1];
  };

  const mappedRows = rows.map((r) => {
    let patientLabel = "";
    if (privacyMode === "none") {
      patientLabel = `${r.firstName || ""} ${r.lastName || ""}`.trim();
    } else if (privacyMode === "masked") {
      patientLabel = `${maskWord(r.firstName || "")} ${maskWord(r.lastName || "")}`.trim();
    } else { // "token_only"
      patientLabel = `Patient #${r.tokenNo}`;
    }
    return {
      id: r.id,
      tokenNo: r.tokenNo,
      status: r.status,
      priority: r.priority,
      department: r.department,
      roomNumber: r.roomNumber,
      floorLabel: r.floorLabel || "",
      patientLabel,
      testName: r.testName,
      calledAt: r.calledAt,
    };
  });

  // Group by department for the display UI
  const byDept: Record<string, typeof mappedRows> = {};
  for (const r of mappedRows) {
    (byDept[r.department] ??= []).push(r);
  }

  return {
    date,
    departments: Object.entries(byDept).map(([department, tokens]) => {
      const serving = tokens.find((t) => t.status === "serving");
      const waiting = tokens.filter((t) => t.status === "waiting");
      return {
        department,
        roomNumber: tokens[0]?.roomNumber ?? "",
        floorLabel: tokens[0]?.floorLabel ?? "",
        nowServing: serving ?? null,
        waiting: waiting.slice(0, 8),
        waitingCount: waiting.length,
      };
    }).sort((a, b) => a.department.localeCompare(b.department)),
  };
}

// ─── Polling endpoint: GET /api/display/queue ─────────────────────────────────
//
// Accepts: staff Bearer token OR ?displayToken=<token>
// Unchanged shape — just adds floorLabel to every token row.

displayRouter.get("/queue", displayAuth as any, async (req, res): Promise<void> => {
  const raw = req.query.ledgerId;
  const ledgerId = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(ledgerId) || ledgerId <= 0) {
    res.status(400).json({
      error: "Invalid request",
      details: [{ path: ["ledgerId"], message: "ledgerId is required and must be a positive integer" }],
    });
    return;
  }
  const date = (req.query.date as string) || todayISO();
  const departmentsRaw = (req.query.departments as string) || "";
  const departments = departmentsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const data = await fetchQueueData({ ledgerId, departments, date });
    res.json(data);
  } catch (err) {
    req.log?.error?.({ err }, "display/queue fetch error");
    res.status(500).json({ error: "Failed to fetch queue data" });
  }
});

// ─── SSE endpoint: GET /api/display/queue-stream ─────────────────────────────
//
// PROTOCOL: Server-Sent Events (text/event-stream)
//   • On subscribe: immediately sends current queue data as the first event.
//   • On any queue mutation (PATCH status, POST /call in test-tokens.ts):
//     queueBroadcaster.broadcast(ledgerId) fires → this handler re-fetches
//     and pushes new data within milliseconds.
//   • Every 25 s: a `: heartbeat` comment keeps the connection alive through
//     nginx, load balancers, and hotel/hospital WiFi proxies that time out
//     idle connections.
//   • On client disconnect (TV closed / refresh): cleanup removes listener
//     and clears the heartbeat timer — no memory leak.
//
// NGINX / REVERSE PROXY: X-Accel-Buffering: no is REQUIRED so nginx does not
// buffer the stream. Without it events arrive in batches after buffering delay.
// Already set in headers below.
//
// AUTH: same as polling endpoint — staff Bearer token OR ?displayToken=<token>.

displayRouter.get("/queue-stream", displayAuth as any, async (req, res): Promise<void> => {
  const raw = req.query.ledgerId;
  const ledgerId = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(ledgerId) || ledgerId <= 0) {
    res.status(400).json({ error: "ledgerId is required and must be a positive integer" });
    return;
  }
  const date = (req.query.date as string) || todayISO();
  const departmentsRaw = (req.query.departments as string) || "";
  const departments = departmentsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // CRITICAL: tell nginx not to buffer this stream
  res.setHeader("X-Accel-Buffering", "no");
  // Disable compression (gzip interferes with streaming)
  res.setHeader("Content-Encoding", "identity");
  res.flushHeaders();

  const writeEvent = (data: object): void => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Client already disconnected — cleanup below handles it
    }
  };

  // ── Send initial data immediately so the TV doesn't show a blank screen ──
  try {
    const initial = await fetchQueueData({ ledgerId, departments, date });
    writeEvent(initial);
  } catch (err) {
    req.log?.error?.({ err }, "display/queue-stream initial fetch error");
    // Don't close — keep the connection so the client stays and retries
  }

  // ── Heartbeat: keep connection alive through proxies ──────────────────────
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* ignore */ }
  }, 25_000);

  // ── Broadcast handler: push new data when queue mutates ──────────────────
  const onUpdate = async (evt: QueueUpdateEvent): Promise<void> => {
    // Only re-fetch for the relevant ledger (undefined = all ledgers)
    if (evt.ledgerId !== undefined && evt.ledgerId !== ledgerId) return;
    try {
      const fresh = await fetchQueueData({ ledgerId, departments, date: todayISO() });
      writeEvent(fresh);
    } catch (err) {
      req.log?.error?.({ err }, "display/queue-stream broadcast fetch error");
    }
  };
  queueBroadcaster.on("queue-update", onUpdate);

  // ── Cleanup on client disconnect ──────────────────────────────────────────
  req.on("close", () => {
    clearInterval(heartbeat);
    queueBroadcaster.off("queue-update", onUpdate);
  });
});

export default displayRouter;
