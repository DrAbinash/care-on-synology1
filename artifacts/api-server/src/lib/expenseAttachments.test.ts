/**
 * Expense supporting-document attachments — focused integration tests (real DB).
 * Documentary only: must not change bill/paid/due/vouchers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@workspace/db";
import {
  expenseAttachmentsTable,
  expensePaymentsTable,
  expensesTable,
  vouchersTable,
} from "@workspace/db/schema";
import { eq, like, or } from "drizzle-orm";
import { createExpenseV2, voidExpense } from "./expenseV2Service";
import {
  attachFromReceiptDataUrl,
  createExpenseAttachment,
  findDuplicateExpenseAttachments,
  hashFileBuffer,
  listExpenseAttachments,
  softDeleteExpenseAttachment,
} from "./expenseAttachments";

const hasDb = Boolean(process.env.DATABASE_URL);
const MARKER = `att-exp-${Date.now().toString(36)}`;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_PDF = Buffer.from("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: expensesTable.id, expenseId: expensesTable.expenseId })
    .from(expensesTable)
    .where(like(expensesTable.description, `%${MARKER}%`));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  for (const id of ids) {
    await db.delete(expenseAttachmentsTable).where(eq(expenseAttachmentsTable.expenseId, id));
    await db.delete(expensePaymentsTable).where(eq(expensePaymentsTable.expenseId, id));
  }
  for (const r of rows) {
    await db
      .delete(vouchersTable)
      .where(or(like(vouchersTable.reference, `%${r.expenseId}%`), like(vouchersTable.narration, `%${r.expenseId}%`)))
      .catch(() => undefined);
  }
  for (const id of ids) {
    await db.delete(expensesTable).where(eq(expensesTable.id, id));
  }
}

describe.skipIf(!hasDb)("expenseAttachments — documentary only", () => {
  beforeAll(async () => {
    await cleanup();
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("1. expense saves with no attachment", async () => {
    const { money } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} no attachment`,
      billAmount: 1000,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    expect(money.billAmount).toBe(1000);
    expect(money.totalPaid).toBe(0);
  });

  it("2. expense can save with image attachment", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} with png`,
      billAmount: 500,
      initialPaymentAmount: 500,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    const { attachment } = await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PNG,
      mimeType: "image/png",
      originalFilename: "bill.png",
      source: "MANUAL_UPLOAD",
      documentType: "bill",
      uploadedBy: "Tester",
      attachAnyway: true,
    });
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.contentHash).toBe(hashFileBuffer(TINY_PNG));
    const abs = join(process.cwd(), "data", "uploads", attachment.storagePath);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).equals(TINY_PNG)).toBe(true);
  });

  it("3. expense can save with PDF attachment", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} with pdf`,
      billAmount: 700,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    const { attachment } = await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PDF,
      mimeType: "application/pdf",
      originalFilename: "invoice.pdf",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.sizeBytes).toBe(TINY_PDF.byteLength);
  });

  it("4. attachment can be added to an existing expense", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} attach later`,
      billAmount: 2000,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    expect(await listExpenseAttachments(expense.id)).toHaveLength(0);
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PNG,
      mimeType: "image/png",
      originalFilename: "later.png",
      source: "CAMERA",
      attachAnyway: true,
    });
    expect(await listExpenseAttachments(expense.id)).toHaveLength(1);
  });

  it("5. multiple attachments per expense", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} multi att`,
      billAmount: 3000,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    const png2 = Buffer.from(TINY_PNG);
    png2[png2.length - 8] ^= 0x01;
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PNG,
      mimeType: "image/png",
      originalFilename: "page1.png",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: png2,
      mimeType: "image/png",
      originalFilename: "page2.png",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PDF,
      mimeType: "application/pdf",
      originalFilename: "receipt.pdf",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    expect(await listExpenseAttachments(expense.id)).toHaveLength(3);
  });

  it("6. AI-scanned bill links without a second upload", async () => {
    const dataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} ai scan link`,
      billAmount: 900,
      initialPaymentAmount: 900,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
      receiptImageUrl: dataUrl,
    });
    const linked = await attachFromReceiptDataUrl({
      expensePk: expense.id,
      receiptImageUrl: dataUrl,
      uploadedBy: "Tester",
      attachAnyway: true,
    });
    expect(linked.attachment.source).toBe("AI_SCAN");
    expect(linked.attachment.contentHash).toBe(hashFileBuffer(TINY_PNG));
    expect((await listExpenseAttachments(expense.id)).length).toBeGreaterThanOrEqual(1);
  });

  it("7+9. exact duplicate content detected (different filename)", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} dup detect`,
      billAmount: 100,
      initialPaymentAmount: 100,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PDF,
      mimeType: "application/pdf",
      originalFilename: "a.pdf",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    const dups = await findDuplicateExpenseAttachments(hashFileBuffer(TINY_PDF));
    expect(dups.length).toBeGreaterThan(0);

    await expect(
      createExpenseAttachment({
        expensePk: expense.id,
        buffer: TINY_PDF,
        mimeType: "application/pdf",
        originalFilename: "totally-different-name.pdf",
        source: "MANUAL_UPLOAD",
        attachAnyway: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("8. same filename but different contents allowed", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} same name diff content`,
      billAmount: 100,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    const other = Buffer.from("%PDF-1.1\n%% different body\n%%EOF\n", "utf8");
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PDF,
      mimeType: "application/pdf",
      originalFilename: "same.pdf",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    const second = await createExpenseAttachment({
      expensePk: expense.id,
      buffer: other,
      mimeType: "application/pdf",
      originalFilename: "same.pdf",
      source: "MANUAL_UPLOAD",
      attachAnyway: false,
    });
    expect(second.attachment.contentHash).not.toBe(hashFileBuffer(TINY_PDF));
  });

  it("10. unauthorized file type rejected", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} bad type`,
      billAmount: 50,
      initialPaymentAmount: 50,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    await expect(
      createExpenseAttachment({
        expensePk: expense.id,
        buffer: Buffer.from("MZ executable"),
        mimeType: "application/x-msdownload",
        originalFilename: "evil.exe",
        source: "MANUAL_UPLOAD",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("11. oversized file rejected", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} oversized`,
      billAmount: 50,
      initialPaymentAmount: 0,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    const big = Buffer.concat([
      TINY_PDF,
      Buffer.alloc(15 * 1024 * 1024 + 1 - TINY_PDF.byteLength, 0x20),
    ]);
    await expect(
      createExpenseAttachment({
        expensePk: expense.id,
        buffer: big,
        mimeType: "application/pdf",
        originalFilename: "huge.pdf",
        source: "MANUAL_UPLOAD",
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("12. void retains attachments", async () => {
    const { expense } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} void keeps att`,
      billAmount: 400,
      initialPaymentAmount: 400,
      expenseDate: "2026-09-12",
      paymentMode: "cash",
      createdBy: "Tester",
    });
    await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PNG,
      mimeType: "image/png",
      originalFilename: "keep.png",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    await voidExpense({
      expensePk: expense.id,
      reason: "test void retain attachment",
      voidedBy: "Tester",
    });
    const atts = await listExpenseAttachments(expense.id);
    expect(atts).toHaveLength(1);
    const abs = join(process.cwd(), "data", "uploads", atts[0]!.storagePath);
    expect(existsSync(abs)).toBe(true);
  });

  it("13. add/remove document does not change financial state", async () => {
    const { expense, money } = await createExpenseV2({
      category: "miscellaneous",
      description: `${MARKER} money unchanged`,
      billAmount: 50000,
      initialPaymentAmount: 20000,
      expenseDate: "2026-09-12",
      paymentMode: "upi",
      createdBy: "Tester",
    });
    const before = {
      bill: money.billAmount,
      paid: money.totalPaid,
      due: money.balanceDue,
      status: money.paymentStatus,
    };
    const { attachment } = await createExpenseAttachment({
      expensePk: expense.id,
      buffer: TINY_PNG,
      mimeType: "image/png",
      originalFilename: "doc.png",
      source: "MANUAL_UPLOAD",
      attachAnyway: true,
    });
    await softDeleteExpenseAttachment({
      expensePk: expense.id,
      attachmentId: attachment.id,
      deletedBy: "Tester",
    });
    const [fresh] = await db.select().from(expensesTable).where(eq(expensesTable.id, expense.id)).limit(1);
    expect(Number(fresh!.billAmount ?? fresh!.amount)).toBe(before.bill);
    expect((fresh!.paymentStatus || "").toUpperCase()).toBe(before.status);
    const pays = await db
      .select()
      .from(expensePaymentsTable)
      .where(eq(expensePaymentsTable.expenseId, expense.id));
    const paidSum = pays.filter((p) => !p.reversedAt).reduce((s, p) => s + Number(p.amount), 0);
    expect(paidSum).toBe(before.paid);
    expect(before.due).toBe(before.bill - before.paid);
  });

  it("content hash is SHA-256 of raw bytes (not filename)", () => {
    const h1 = hashFileBuffer(TINY_PNG);
    const h2 = createHash("sha256").update(TINY_PNG).digest("hex");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
