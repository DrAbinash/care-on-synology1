/**
 * Per-book bill numbering — allocator behaviour, no database required.
 *
 * The invariant this protects: a bill number is allocated from ITS BOOK's
 * sequence. The allocator used to be called with the literal bucket "global",
 * which is why an emptied register could never start again at 0001 — the next
 * number belonged to the installation, not to the book that prints it. These
 * tests fail the moment a global bucket, an unvalidated ledger, or the old
 * single sequence comes back.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nextDocumentCounter,
  syncBillNumberSeqForward,
  resetBillNumberSeq,
} from "./documentNumberCounters";

type CounterHandle = Parameters<typeof nextDocumentCounter>[0];

function recordingHandle(nextval = 7) {
  const count = { executeCount: 0 };
  const handle = {
    execute: async () => {
      count.executeCount += 1;
      return [{ nextval }];
    },
  };
  return { handle: handle as unknown as CounterHandle, count };
}

const root = dirname(fileURLToPath(import.meta.url));
const countersSrc = readFileSync(join(root, "documentNumberCounters.ts"), "utf8");
const billsSrc = readFileSync(join(root, "../routes/bills.ts"), "utf8");
const migrationSrc = readFileSync(
  join(root, "../../../../migrations/zzzzzz_bill_numbering_per_ledger.sql"),
  "utf8",
);
const billsSchemaSrc = readFileSync(
  join(root, "../../../../lib/db/src/schema/bills.ts"),
  "utf8",
);

describe("bill number allocation is per book", () => {
  it("allocates in one round trip and returns the sequence value", async () => {
    const { handle, count } = recordingHandle(41);
    const n = await nextDocumentCounter(handle, "bill", "12");
    expect(n).toBe(41);
    // A numbering helper that starts issuing more queries per save is the hot
    // billing-desk path regressing (see requireStaffAuth.billingSpeed.test.ts).
    expect(count.executeCount).toBe(1);
  });

  it("refuses the old global bucket instead of numbering every book as one", async () => {
    const { handle, count } = recordingHandle();
    await expect(nextDocumentCounter(handle, "bill", "global")).rejects.toThrow(/ledger/i);
    expect(count.executeCount).toBe(0);
  });

  it("rejects a ledger id that is not a positive integer", async () => {
    const { handle, count } = recordingHandle();
    for (const bucket of ["0", "-3", "1.5", "", "12; drop table bills", "NaN"]) {
      await expect(nextDocumentCounter(handle, "bill", bucket)).rejects.toThrow(/ledger/i);
    }
    // Rejected before reaching the database. The ledger id also names a sequence
    // inside SQL, so nothing unvalidated may travel.
    expect(count.executeCount).toBe(0);
  });

  it("forwards and resets one book only, and refuses a bad ledger id", async () => {
    const sync = recordingHandle();
    await syncBillNumberSeqForward(sync.handle, 12);
    expect(sync.count.executeCount).toBe(1);

    const reset = recordingHandle();
    await resetBillNumberSeq(reset.handle, 12);
    expect(reset.count.executeCount).toBe(1);

    await expect(syncBillNumberSeqForward(sync.handle, 0)).rejects.toThrow(/ledger/i);
    await expect(resetBillNumberSeq(reset.handle, Number.NaN)).rejects.toThrow(/ledger/i);
  });

  it("binds the ledger as a parameter and leaves sequence naming to SQL", () => {
    for (const call of [
      "next_bill_number_seq(${ledger})",
      "sync_bill_number_seq(${ledgerId})",
      "reset_bill_number_seq(${ledgerId})",
    ]) {
      expect(countersSrc).toContain(call);
    }
    // bill_number_seq_l<ledger> is built inside the function, never by string
    // concatenation in the app.
    expect(countersSrc).not.toContain("bill_number_seq_l${");
    expect(billsSrc).not.toContain('nextDocumentCounter(dbHandle, "bill", "global")');
    expect(countersSrc).not.toContain("nextval('bill_number_seq')");
  });
});

describe("per-book numbering migration", () => {
  it("installs the three per-book allocator functions", () => {
    for (const fn of ["next_bill_number_seq", "sync_bill_number_seq", "reset_bill_number_seq"]) {
      expect(migrationSrc).toContain(`FUNCTION ${fn}(p_ledger integer)`);
    }
  });

  it("restarts an emptied book at 0001, not 0002", () => {
    // setval(..., 1, false) is the difference between "a fresh register" and
    // "one blank page at the front of it".
    expect(migrationSrc).toContain("setval(%L, 1, false)");
  });

  it("refuses to rewind a book that still holds bills", () => {
    expect(migrationSrc).toMatch(/reset_bill_number_seq: ledger .* still has/);
  });

  it("makes uniqueness (ledger_id, bill_number) and keeps the printed format", () => {
    expect(migrationSrc).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "bills_ledger_bill_number_uidx"');
    expect(migrationSrc).toContain('ON "bills" ("ledger_id", "bill_number")');
    expect(billsSchemaSrc).toContain('uniqueIndex("bills_ledger_bill_number_uidx").on(t.ledgerId, t.billNumber)');
    // The single-column constraint that made a restart impossible is gone.
    expect(billsSchemaSrc).not.toContain('text("bill_number").notNull().unique()');
    // The printed number itself is untouched: YYYYMM + zero-padded suffix.
    expect(billsSrc).toContain('return `${yyyymm}${String(seq).padStart(4, "0")}`;');
  });

  it("puts legacy NULL-ledger bills in the default book before indexing them", () => {
    // A unique index over a nullable column enforces nothing: every NULL is
    // distinct, so ledger_id has to be backfilled and made NOT NULL first.
    expect(migrationSrc).toContain('UPDATE "bills" SET "ledger_id" = 1 WHERE "ledger_id" IS NULL');
    expect(migrationSrc).toContain('ALTER TABLE "bills" ALTER COLUMN "ledger_id" SET NOT NULL');
  });
});
