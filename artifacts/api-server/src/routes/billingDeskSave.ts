/**
 * POST /api/billing/save — one-shot order+bill for the billing desk.
 *
 * Collapses the desk's two serial HTTP round-trips (POST /orders then
 * POST /bills?fast=1) into a single request while reusing the existing
 * create handlers (same validation, locks, idempotency, fast-mode fan-out).
 */
import { Router, type Response } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { createOrderHandler } from "./orders";
import { createBillHandler } from "./bills";

export const billingDeskSaveRouter = Router();

type Captured = { statusCode: number; body: unknown };

function captureResponse(): { res: Response; get: () => Captured } {
  const captured: Captured = { statusCode: 200, body: undefined };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(data: unknown) {
      captured.body = data;
      return this;
    },
  };
  return { res: res as unknown as Response, get: () => captured };
}

billingDeskSaveRouter.post("/save", async (req: StaffAuthRequest, res) => {
  const payload = (req.body?.data ?? req.body ?? {}) as Record<string, unknown>;
  let orderId: number | undefined;
  let orderNumber: string | undefined;

  try {
    const orderBody = {
      patientId: payload.patientId,
      doctorId: payload.doctorId,
      notes: payload.notes,
      tests: payload.tests,
      testIds: payload.testIds,
      clientRef: payload.clientRef,
      // Not in CreateOrderBody Zod schema — read from raw body in createOrderHandler
      // so VIP surcharge line prices pass the non-admin price ceiling.
      isVip: payload.isVip,
      packageIds: payload.packageIds,
    };

    const orderCap = captureResponse();
    const orderReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
      body: orderBody,
    }) as StaffAuthRequest;
    await createOrderHandler(orderReq, orderCap.res);
    const orderOut = orderCap.get();

    if (orderOut.statusCode >= 400 || !orderOut.body || typeof orderOut.body !== "object") {
      res.status(orderOut.statusCode || 500).json(orderOut.body ?? { error: "Order create failed" });
      return;
    }

    const order = orderOut.body as { id?: number; orderNumber?: string };
    if (!Number.isFinite(order.id)) {
      res.status(500).json({ error: "Order create returned no id" });
      return;
    }
    orderId = order.id;
    orderNumber = order.orderNumber;

    const billBody = {
      orderId: order.id,
      clientRef: payload.clientRef,
      discount: payload.discount,
      dueDate: payload.dueDate,
      discountReason: payload.discountReason,
      discountReasonNote: payload.discountReasonNote,
      payments: payload.payments,
      isVip: payload.isVip,
      dicomFields: payload.dicomFields,
    };

    // Desk always used ?fast=1; default on unless explicitly disabled.
    // IMPORTANT: do NOT Object.assign({ query }) onto the Express request.
    // In Express 5 / Node IncomingMessage, `req.query` is a getter-only
    // property — assign throws:
    //   TypeError: Cannot set property query of #<IncomingMessage> which has only a getter
    // That was the Save & Print 500 on caredeoghar (billingDeskSave.ts).
    const fastOff = req.query.fast === "0" || req.query.fast === "false";
    const billCap = captureResponse();
    const billReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
      body: billBody,
    }) as StaffAuthRequest;
    Object.defineProperty(billReq, "query", {
      value: { ...(req.query as Record<string, unknown>), fast: fastOff ? "0" : "1" },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    await createBillHandler(billReq, billCap.res);
    const billOut = billCap.get();

    if (billOut.statusCode >= 400) {
      res.status(billOut.statusCode).json(
        typeof billOut.body === "object" && billOut.body
          ? { ...(billOut.body as object), orderId: order.id, orderNumber: order.orderNumber }
          : billOut.body,
      );
      return;
    }

    const bill =
      typeof billOut.body === "object" && billOut.body
        ? { ...(billOut.body as object), orderId: order.id, orderNumber: order.orderNumber }
        : billOut.body;
    res.status(billOut.statusCode || 201).json(bill);
  } catch (err) {
    // Handlers normally use res.status().json(); a thrown error (pool timeout,
    // unexpected 23505, payment-insert failure) previously became a generic
    // Express 500 with no orderId — desk could not recover the orphan order.
    const message = err instanceof Error ? err.message : "Billing save failed";
    req.log?.error?.({ err, orderId, clientRef: payload.clientRef }, "POST /api/billing/save threw");
    res.status(500).json({
      error: message,
      orderId,
      orderNumber,
      clientRef: payload.clientRef ?? null,
    });
  }
});

export default billingDeskSaveRouter;
