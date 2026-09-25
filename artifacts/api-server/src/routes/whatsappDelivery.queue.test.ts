/**
 * WhatsApp Delivery v2 — queue lifecycle (create → send → sent + audit).
 * Runs against real DB when DATABASE_URL is set; otherwise skipped.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { createHash } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("whatsapp delivery queue lifecycle", () => {
  let db: typeof import("@workspace/db").db;
  let waDeliveryQueueTable: typeof import("@workspace/db").waDeliveryQueueTable;
  let waDeliveryAuditTable: typeof import("@workspace/db").waDeliveryAuditTable;
  let eq: typeof import("drizzle-orm").eq;

  beforeAll(async () => {
    ({ db, waDeliveryQueueTable, waDeliveryAuditTable } = await import("@workspace/db"));
    ({ eq } = await import("drizzle-orm"));
  });

  it("create → send → sent + audit row", async () => {
    const marker = `wa-q-${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}`;
    const [row] = await db
      .insert(waDeliveryQueueTable)
      .values({
        kind: "booking",
        status: "pending",
        patientPhone: "9876543210",
        prefilledMessage: `Hello test ${marker}`,
        recordId: marker,
        bookingRef: marker,
        patientName: "Test Patient",
        source: "test",
        createdByName: "vitest",
      })
      .returning();

    expect(row.status).toBe("pending");

    const [updated] = await db
      .update(waDeliveryQueueTable)
      .set({
        status: "sent",
        sentByName: "vitest",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(waDeliveryQueueTable.id, row.id))
      .returning();

    expect(updated.status).toBe("sent");
    expect(updated.sentByName).toBe("vitest");

    const [audit] = await db
      .insert(waDeliveryAuditTable)
      .values({
        actor: "vitest",
        kind: "booking",
        recordId: marker,
        maskedPhone: "****3210",
        channel: "wa-me",
        notes: `queue:${row.id}`,
      })
      .returning();

    expect(audit.maskedPhone).toBe("****3210");
    expect(audit.kind).toBe("booking");

    // cleanup
    await db.delete(waDeliveryAuditTable).where(eq(waDeliveryAuditTable.id, audit.id));
    await db.delete(waDeliveryQueueTable).where(eq(waDeliveryQueueTable.id, row.id));
  });
});
