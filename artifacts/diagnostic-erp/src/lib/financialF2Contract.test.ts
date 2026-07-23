/**
 * financialF2Contract.test.ts — F2 wiring contracts (source-level).
 *
 * Pins the capture-time-voucher + sync-hardening changes so the desk-payment
 * doubling and prepay double-voucher can't silently return.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const REPO = resolve(HERE, "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

const autoVoucher = read(resolve(REPO, "artifacts/api-server/src/lib/auto-voucher.ts"));
const selfReg = read(resolve(REPO, "artifacts/api-server/src/services/self-registration.ts"));
const accounting = read(resolve(REPO, "artifacts/api-server/src/routes/accounting.ts"));
const booksSanity = read(resolve(REPO, "artifacts/api-server/src/routes/books-sanity.ts"));
const accountingPage = read(resolve(ERP_SRC, "pages/Accounting.tsx"));

describe("auto-voucher keeps Tally reference, adds payment linkage + idempotency", () => {
  it("reference is still the bill number (Tally unchanged); payment_id is written and idempotency-checked", () => {
    expect(autoVoucher).toContain("reference: billNumber");
    expect(autoVoucher).toContain("paymentId: paymentId ?? null");
    expect(autoVoucher).toContain("eq(vouchersTable.paymentId, paymentId)");
  });
});

describe("prepaid self-registration payments are vouchered at capture", () => {
  it("self-registration returns the payment id and vouchers it via payment_id", () => {
    expect(selfReg).toContain(".returning({ id: paymentsTable.id })");
    expect(selfReg).toContain("autoVoucherForPayment(");
    expect(selfReg).toContain("paymentId,");
  });
});

describe("sync-billing is hardened", () => {
  it("admin-gated, dedups by payment_id + amount, skips non-positive & superseded, supports dryRun, IST-dated", () => {
    expect(accounting).toContain('router.post("/sync-billing", requireAdminRole');
    expect(accounting).toContain("vouchedPaymentIds");
    expect(accounting).toContain("receiptPool");
    expect(accounting).toContain('p.settlementStatus === "superseded"');
    expect(accounting).toContain("Number(p.amount) <= 0");
    expect(accounting).toContain("dryRun");
    expect(accounting).toContain("dateToISTString(p.createdAt)");
    // the old disjoint PAY-<id> reference keying is gone:
    expect(accounting).not.toContain("const ref = `PAY-${p.id}`");
  });
});

describe("Accounting page no longer auto-runs the backfill", () => {
  it("mount effect only seeds accounts; the button dry-runs then confirms", () => {
    // No sync-billing call inside the mount effect (only setup-defaults):
    const effectStart = accountingPage.indexOf("setupDone.current = true");
    const effectEnd = accountingPage.indexOf("const invalidateBooks");
    const effect = accountingPage.slice(effectStart, effectEnd);
    expect(effect).not.toContain("sync-billing");
    expect(effect).toContain("setup-defaults");
    // The explicit button previews first:
    expect(accountingPage).toContain('"/api/accounting/sync-billing", { dryRun: true }');
    expect(accountingPage).toContain("window.confirm");
  });
});

describe("books-sanity surfaces voucher gaps", () => {
  it("has payments-without-voucher and orphan-voucher checks", () => {
    expect(booksSanity).toContain("Payments without an accounting voucher");
    expect(booksSanity).toContain("Vouchers linked to a missing payment");
  });
});
