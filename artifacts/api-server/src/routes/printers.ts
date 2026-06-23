import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { printerSettingsTable } from "@workspace/db/schema";

export const printersRouter: IRouter = Router();

async function getOrCreateSettings() {
  const [row] = await db.select().from(printerSettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(printerSettingsTable).values({}).returning();
  return created;
}

printersRouter.get("/settings", async (_req, res) => {
  const s = await getOrCreateSettings();
  res.json(s);
});

printersRouter.put("/settings", async (req, res) => {
  const current = await getOrCreateSettings();
  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.billPrinter === "string") updates.billPrinter = body.billPrinter.trim();
  if (typeof body.billPrinterType === "string" && ["color", "bw"].includes(body.billPrinterType)) updates.billPrinterType = body.billPrinterType;
  if (typeof body.barcodePrinter === "string") updates.barcodePrinter = body.barcodePrinter.trim();
  // barcodeEnabled: accept both boolean and string
  if (typeof body.barcodeEnabled === "boolean") updates.barcodeEnabled = String(body.barcodeEnabled);
  else if (typeof body.barcodeEnabled === "string" && ["true", "false"].includes(body.barcodeEnabled)) updates.barcodeEnabled = body.barcodeEnabled;
  if (typeof body.tokenPrinter === "string") updates.tokenPrinter = body.tokenPrinter.trim();
  if (typeof body.tokenPrinterType === "string" && ["color", "bw"].includes(body.tokenPrinterType)) updates.tokenPrinterType = body.tokenPrinterType;
  // tokenEnabled: accept both boolean and string
  if (typeof body.tokenEnabled === "boolean") updates.tokenEnabled = String(body.tokenEnabled);
  else if (typeof body.tokenEnabled === "string" && ["true", "false"].includes(body.tokenEnabled)) updates.tokenEnabled = body.tokenEnabled;
  const [row] = await db.update(printerSettingsTable).set(updates).where(eq(printerSettingsTable.id, current.id)).returning();
  res.json(row);
});

export default printersRouter;