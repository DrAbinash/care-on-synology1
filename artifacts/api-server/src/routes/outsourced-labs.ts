import { Router } from "express";
import { db } from "@workspace/db";
import {
  outsourcedLabsTable,
  outsourceRateCardsTable,
  outsourcePriceGroupsTable,
  outsourceDispatchBatchesTable,
  outsourceOrdersTable,
  outsourceReportsTable,
  outsourceVendorLedgerTable,
  outsourceVendorInvoicesTable,
  outsourceVendorInvoiceItemsTable,
  outsourcePaymentsTable,
  doctorCommissionRulesTable,
  outsourceAuditLogsTable,
  patientsTable,
  billsTable
} from "@workspace/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { z } from "zod/v4";

export const outsourcedLabsRouter = Router();

const createLabSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
  costType: z.enum(["percent_of_patient_bill", "fixed_per_test", "custom_per_test"]).optional(),
  costPercent: z.number().min(0).max(100).optional(),
  costFixed: z.number().min(0).optional(),
  paymentCycle: z.string().optional(),
  defaultTdsPercent: z.number().optional(),
  defaultPaymentMode: z.string().optional(),
});

const updateLabSchema = createLabSchema.partial();

// ─── LAB MASTER ROUTES ────────────────────────────────────────────────────────

outsourcedLabsRouter.get("/", async (_req, res) => {
  const labs = await db
    .select()
    .from(outsourcedLabsTable)
    .orderBy(desc(outsourcedLabsTable.createdAt));
  res.json(labs);
});

outsourcedLabsRouter.post("/", async (req, res) => {
  const parsed = createLabSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const [lab] = await db
    .insert(outsourcedLabsTable)
    .values({
      ...parsed.data,
      isActive: parsed.data.isActive ?? true,
      costPercent: parsed.data.costPercent != null ? String(parsed.data.costPercent) : undefined,
      costFixed: parsed.data.costFixed != null ? String(parsed.data.costFixed) : undefined,
    })
    .returning();
  res.status(201).json(lab);
});

outsourcedLabsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [lab] = await db.select().from(outsourcedLabsTable).where(eq(outsourcedLabsTable.id, id));
  if (!lab) {
    res.status(404).json({ error: "Lab not found" });
    return;
  }
  res.json(lab);
});

outsourcedLabsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateLabSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const [updated] = await db
    .update(outsourcedLabsTable)
    .set({
      ...parsed.data,
      costPercent: parsed.data.costPercent != null ? String(parsed.data.costPercent) : undefined,
      costFixed: parsed.data.costFixed != null ? String(parsed.data.costFixed) : undefined,
    })
    .where(eq(outsourcedLabsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Lab not found" });
    return;
  }
  res.json(updated);
});

// ─── RATE CARDS ROUTES ────────────────────────────────────────────────────────

outsourcedLabsRouter.get("/:labId/rate-cards", async (req, res) => {
  const labId = Number(req.params.labId);
  const cards = await db
    .select()
    .from(outsourceRateCardsTable)
    .where(and(eq(outsourceRateCardsTable.labId, labId), eq(outsourceRateCardsTable.isActive, true)))
    .orderBy(outsourceRateCardsTable.testName);
  res.json(cards);
});

// Preview rate card import (detect diffs)
outsourcedLabsRouter.post("/:labId/rate-cards/import", async (req, res) => {
  const labId = Number(req.params.labId);
  const rows = req.body.rows; // Array of { labTestCode, testName, mrp, partnerCost, commissionPercent }
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }

  // Fetch existing rates
  const currentRates = await db
    .select()
    .from(outsourceRateCardsTable)
    .where(and(eq(outsourceRateCardsTable.labId, labId), eq(outsourceRateCardsTable.isActive, true)));

  const existingMap = new Map(currentRates.map((r) => [r.labTestCode, r]));

  const newItems: typeof rows = [];
  const costChanges: any[] = [];
  const duplicates: string[] = [];
  const seenCodes = new Set<string>();

  rows.forEach((row) => {
    if (seenCodes.has(row.labTestCode)) {
      duplicates.push(row.labTestCode);
      return;
    }
    seenCodes.add(row.labTestCode);

    const existing = existingMap.get(row.labTestCode);
    if (!existing) {
      newItems.push(row);
    } else {
      const existingCost = Number(existing.partnerCost);
      const newCost = Number(row.partnerCost);
      if (Math.abs(existingCost - newCost) > 0.01) {
        costChanges.push({
          ...row,
          oldCost: existingCost,
          newCost: newCost,
        });
      }
    }
  });

  res.json({
    newItems,
    costChanges,
    duplicates,
  });
});

// Commit rate card import
outsourcedLabsRouter.post("/:labId/rate-cards/save", async (req, res) => {
  const labId = Number(req.params.labId);
  const rows = req.body.rows;
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }

  // Deactivate old rates
  await db
    .update(outsourceRateCardsTable)
    .set({ isActive: false })
    .where(eq(outsourceRateCardsTable.labId, labId));

  // Insert new rate cards
  if (rows.length > 0) {
    await db.insert(outsourceRateCardsTable).values(
      rows.map((r) => ({
        labId,
        labTestCode: r.labTestCode,
        testName: r.testName,
        department: r.department || "Pathology",
        mrp: String(r.mrp),
        partnerCost: String(r.partnerCost),
        commissionPercent: r.commissionPercent ? String(r.commissionPercent) : "0.00",
        isActive: true,
      }))
    );
  }

  res.json({ success: true, count: rows.length });
});

// ─── WORKLIST & DISPATCH ROUTES ───────────────────────────────────────────────

outsourcedLabsRouter.get("/orders/worklist", async (_req, res) => {
  const orders = await db
    .select({
      id: outsourceOrdersTable.id,
      status: outsourceOrdersTable.status,
      barcode: outsourceOrdersTable.barcode,
      sampleType: outsourceOrdersTable.sampleType,
      patientCharge: outsourceOrdersTable.patientCharge,
      outsourceCost: outsourceOrdersTable.outsourceCost,
      expectedReportTime: outsourceOrdersTable.expectedReportTime,
      createdAt: outsourceOrdersTable.createdAt,
      billNumber: billsTable.billNumber,
      patientName: sql<string>`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
      patientPhone: patientsTable.phone,
      labName: outsourcedLabsTable.name,
      testName: outsourceRateCardsTable.testName,
      labTestCode: outsourceRateCardsTable.labTestCode,
    })
    .from(outsourceOrdersTable)
    .innerJoin(billsTable, eq(outsourceOrdersTable.billId, billsTable.id))
    .innerJoin(patientsTable, eq(outsourceOrdersTable.patientId, patientsTable.id))
    .innerJoin(outsourceRateCardsTable, eq(outsourceOrdersTable.rateCardId, outsourceRateCardsTable.id))
    .innerJoin(outsourcedLabsTable, eq(outsourceRateCardsTable.labId, outsourcedLabsTable.id))
    .orderBy(desc(outsourceOrdersTable.createdAt));

  res.json(orders);
});

outsourcedLabsRouter.patch("/orders/worklist/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!status) {
    res.status(400).json({ error: "status is required" });
    return;
  }

  const [updated] = await db
    .update(outsourceOrdersTable)
    .set({
      status,
      actualReportReceivedTime: status === "report_received" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(outsourceOrdersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(updated);
});

// Associate uploaded report PDF path with outsource order
outsourcedLabsRouter.post("/orders/:orderId/reports", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ error: "filePath is required" });
    return;
  }
  const [report] = await db
    .insert(outsourceReportsTable)
    .values({
      orderId,
      filePath,
    })
    .returning();

  await db
    .update(outsourceOrdersTable)
    .set({
      status: "report_received",
      actualReportReceivedTime: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(outsourceOrdersTable.id, orderId));

  res.status(201).json(report);
});

// Create Sample Dispatch Batch
outsourcedLabsRouter.post("/dispatch/batch", async (req, res) => {
  const { labId, courierName, trackingDetails, remarks, orderIds } = req.body;
  if (!labId || !Array.isArray(orderIds) || orderIds.length === 0) {
    res.status(400).json({ error: "labId and non-empty orderIds are required" });
    return;
  }

  // Create dispatch batch
  const batchNumber = `DISP-${Date.now()}`;
  const [batch] = await db
    .insert(outsourceDispatchBatchesTable)
    .values({
      batchNumber,
      labId,
      courierName,
      trackingDetails,
      remarks,
    })
    .returning();

  // Link outsource orders to this batch
  await db
    .update(outsourceOrdersTable)
    .set({
      dispatchBatchId: batch.id,
      status: "sent_to_lab",
    })
    .where(sql`id IN ${orderIds}`);

  res.status(201).json(batch);
});

// ─── LEDGER & SETTLEMENTS ─────────────────────────────────────────────────────

outsourcedLabsRouter.get("/:labId/ledger", async (req, res) => {
  const labId = Number(req.params.labId);
  const ledger = await db
    .select()
    .from(outsourceVendorLedgerTable)
    .where(eq(outsourceVendorLedgerTable.labId, labId))
    .orderBy(desc(outsourceVendorLedgerTable.transactionDate));
  res.json(ledger);
});

outsourcedLabsRouter.post("/settlements/approve", async (req, res) => {
  const { labId, amountPaid, tdsDeducted, paymentMode, utrChequeNumber, remarks, dateRange } = req.body;
  if (!labId || !amountPaid) {
    res.status(400).json({ error: "labId and amountPaid are required" });
    return;
  }

  // Get current ledger balance
  const [lastTx] = await db
    .select()
    .from(outsourceVendorLedgerTable)
    .where(eq(outsourceVendorLedgerTable.labId, labId))
    .orderBy(desc(outsourceVendorLedgerTable.transactionDate))
    .limit(1);

  const prevBalance = lastTx ? Number(lastTx.runningBalance) : 0;
  const netAmount = Number(amountPaid) + Number(tdsDeducted ?? 0);
  const runningBalance = prevBalance - netAmount;

  // Insert payment record
  const [payment] = await db
    .insert(outsourcePaymentsTable)
    .values({
      labId,
      amountPaid: String(amountPaid),
      tdsDeducted: String(tdsDeducted ?? 0),
      paymentMode,
      utrChequeNumber,
      remarks,
    })
    .returning();

  // Write transaction to ledger
  await db
    .insert(outsourceVendorLedgerTable)
    .values({
      labId,
      transactionType: "payment",
      referenceId: String(payment.id),
      debitAmount: String(amountPaid),
      tdsDeducted: String(tdsDeducted ?? 0),
      runningBalance: String(runningBalance),
      remarks: remarks || `Payment Settlement - UTR ${utrChequeNumber}`,
    });

  res.status(201).json(payment);
});

// ─── RECONCILIATION ROUTE ──────────────────────────────────────────────────────

outsourcedLabsRouter.post("/:labId/invoices/reconcile", async (req, res) => {
  const labId = Number(req.params.labId);
  const rows = req.body.rows; // Array of { patientName, labTestCode, labCost }
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }

  // Fetch recent outsource orders for this lab
  const orders = await db
    .select({
      id: outsourceOrdersTable.id,
      patientName: sql<string>`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
      labTestCode: outsourceRateCardsTable.labTestCode,
      outsourceCost: outsourceOrdersTable.outsourceCost,
    })
    .from(outsourceOrdersTable)
    .innerJoin(patientsTable, eq(outsourceOrdersTable.patientId, patientsTable.id))
    .innerJoin(outsourceRateCardsTable, eq(outsourceOrdersTable.rateCardId, outsourceRateCardsTable.id))
    .where(eq(outsourceRateCardsTable.labId, labId));

  const erpMap = new Map<string, typeof orders[0]>();
  orders.forEach((o) => {
    // Key: PatientName_TestCode
    const key = `${o.patientName.toLowerCase().trim()}_${o.labTestCode.toLowerCase().trim()}`;
    erpMap.set(key, o);
  });

  const reconciliationResults = rows.map((row) => {
    const key = `${row.patientName.toLowerCase().trim()}_${row.labTestCode.toLowerCase().trim()}`;
    const matched = erpMap.get(key);

    let status = "missing_erp";
    let linkedOrderId: number | null = null;
    let erpCost: number | null = null;

    if (matched) {
      linkedOrderId = matched.id;
      erpCost = Number(matched.outsourceCost);
      const vendorCost = Number(row.labCost);
      if (Math.abs(erpCost - vendorCost) < 0.01) {
        status = "matched";
      } else {
        status = "cost_mismatch";
      }
    }

    return {
      ...row,
      reconciliationStatus: status,
      linkedOrderId,
      erpCost,
    };
  });

  res.json({ results: reconciliationResults });
});

// ─── DASHBOARD / PROFITABILITY REPORT ──────────────────────────────────────────

outsourcedLabsRouter.get("/dashboard/profitability", async (_req, res) => {
  const data = await db
    .select({
      labName: outsourcedLabsTable.name,
      patientCharge: sql<number>`sum(${outsourceOrdersTable.patientCharge})`,
      outsourceCost: sql<number>`sum(${outsourceOrdersTable.outsourceCost})`,
      netHospitalProfit: sql<number>`sum(${outsourceOrdersTable.netHospitalProfit})`,
      orderCount: sql<number>`count(${outsourceOrdersTable.id})`,
    })
    .from(outsourceOrdersTable)
    .innerJoin(outsourceRateCardsTable, eq(outsourceOrdersTable.rateCardId, outsourceRateCardsTable.id))
    .innerJoin(outsourcedLabsTable, eq(outsourceRateCardsTable.labId, outsourcedLabsTable.id))
    .groupBy(outsourcedLabsTable.name);

  res.json(data);
});
