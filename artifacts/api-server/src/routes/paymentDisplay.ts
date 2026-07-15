/**
 * paymentDisplay.ts — customer-facing payment QR display feed.
 *
 * Presentation-only relay, same discipline as queueDisplaySettings.ts /
 * display.ts: this file does NOT create, verify, or mutate any payment —
 * it only republishes what Bill Desk already has (a redirectUrl/amount/
 * status it already fetched from the existing, untouched ICICI/gateway
 * routes in bills.ts) to whichever customer-facing screen is subscribed
 * for a given "counter" (billing counter key, e.g. "counter1").
 *
 * POST /api/payment-display/:counterKey/show    (staff auth) — Bill Desk
 *      calls this once a gateway payment QR is ready.
 * POST /api/payment-display/:counterKey/status   (staff auth) — Bill Desk
 *      calls this when its own status poll resolves (success/failed/expired).
 * POST /api/payment-display/:counterKey/clear    (staff auth) — Bill Desk
 *      calls this when the payment dialog closes, returning the display
 *      to its idle screen.
 * GET  /api/payment-display/:counterKey          (staff auth OR display
 *      token) — one-shot snapshot, used by the display page's initial load
 *      and as an SSE fallback.
 * GET  /api/payment-display/:counterKey/stream   (staff auth OR display
 *      token, SSE) — live push, same protocol as /api/display/queue-stream.
 *
 * counterKey lets a clinic run more than one billing counter, each with its
 * own customer-facing screen — mirrors Queue Display's :roomKey exactly.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import { paymentQrBroadcaster, type PaymentQrStatus } from "../lib/paymentQrBroadcast";

export const paymentDisplayRouter: IRouter = Router();

// Re-derive the same display token used by display.ts / queueDisplaySettings.ts
// so an unattended customer-facing tablet/monitor can read this feed without
// a staff login session — one token, shared across every display in the clinic.
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

function displayAuth(req: Request, res: Response, next: () => void): void {
  if (isDisplayTokenValid(req)) { next(); return; }
  requireStaffAuth(req as Parameters<typeof requireStaffAuth>[0], res, next);
}

function parseCounterKey(req: Request, res: Response): string | null {
  const counterKey = String(req.params.counterKey || "").trim().toLowerCase();
  if (!counterKey || !/^[a-z0-9-]+$/.test(counterKey)) {
    res.status(400).json({ error: "counterKey must contain only lowercase letters, numbers, and hyphens" });
    return null;
  }
  return counterKey;
}

paymentDisplayRouter.post("/:counterKey/show", requireStaffAuth, (req, res): void => {
  const counterKey = parseCounterKey(req, res);
  if (!counterKey) return;

  const body = req.body ?? {};
  const qrData = typeof body.qrData === "string" ? body.qrData.trim() : "";
  const txnRef = typeof body.txnRef === "string" ? body.txnRef.trim() : "";
  if (!qrData || !txnRef) {
    res.status(400).json({ error: "qrData and txnRef are required" });
    return;
  }

  paymentQrBroadcaster.show(counterKey, {
    qrData,
    txnRef,
    amount: typeof body.amount === "number" ? body.amount : Number(body.amount) || undefined,
    patientName: typeof body.patientName === "string" ? body.patientName : undefined,
    billNumber: typeof body.billNumber === "string" ? body.billNumber : undefined,
    expiryTime: typeof body.expiryTime === "string" ? body.expiryTime : undefined,
  });
  res.json({ success: true });
});

const VALID_STATUSES: PaymentQrStatus[] = ["pending", "success", "failed", "expired"];

paymentDisplayRouter.post("/:counterKey/status", requireStaffAuth, (req, res): void => {
  const counterKey = parseCounterKey(req, res);
  if (!counterKey) return;

  const status = req.body?.status as PaymentQrStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    return;
  }
  paymentQrBroadcaster.setStatus(counterKey, status);
  res.json({ success: true });
});

paymentDisplayRouter.post("/:counterKey/clear", requireStaffAuth, (req, res): void => {
  const counterKey = parseCounterKey(req, res);
  if (!counterKey) return;
  paymentQrBroadcaster.clear(counterKey);
  res.json({ success: true });
});

paymentDisplayRouter.get("/:counterKey", displayAuth as any, (req, res): void => {
  const counterKey = parseCounterKey(req, res);
  if (!counterKey) return;
  res.json(paymentQrBroadcaster.getState(counterKey));
});

paymentDisplayRouter.get("/:counterKey/stream", displayAuth as any, (req, res): void => {
  const counterKey = parseCounterKey(req, res);
  if (!counterKey) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Required so nginx (Synology reverse proxy) doesn't buffer the stream.
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Content-Encoding", "identity");
  res.flushHeaders();

  const writeCurrentState = (): void => {
    try {
      res.write(`data: ${JSON.stringify(paymentQrBroadcaster.getState(counterKey))}\n\n`);
    } catch {
      // Client already disconnected — cleanup below handles it
    }
  };

  writeCurrentState();

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* ignore */ }
  }, 25_000);

  const onUpdate = (updatedCounterKey: string): void => {
    if (updatedCounterKey !== counterKey) return;
    writeCurrentState();
  };
  paymentQrBroadcaster.on("payment-qr-update", onUpdate);

  req.on("close", () => {
    clearInterval(heartbeat);
    paymentQrBroadcaster.off("payment-qr-update", onUpdate);
  });
});

export default paymentDisplayRouter;
