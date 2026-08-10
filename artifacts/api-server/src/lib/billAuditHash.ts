/**
 * Bill anti-tamper FNV-1a hash — must stay in lockstep with
 * artifacts/diagnostic-erp/src/lib/printBill.ts (`buildBillAuditHash` /
 * `buildBillAuditToken`). Payload: BILL_NO-TIMESTAMP-TOTAL-OPERATOR_ID.
 */

export type BillAuditHashInput = {
  billNumber: string;
  createdAt?: string | Date | null;
  totalAmount: number | string;
  operatorId?: string | number | null;
};

/** Normalize bill number digits the same way the printed receipt does. */
export function normalizeBillDigits(billNumber: string): string {
  return String(billNumber).replace(/^BILL-?/i, "").replace(/-/g, "");
}

/** Build the canonical payload string hashed into the QR / printed audit token. */
export function buildBillAuditPayload(opts: BillAuditHashInput): string {
  const billNo = normalizeBillDigits(opts.billNumber);
  const ts = (() => {
    const d = opts.createdAt ? new Date(opts.createdAt) : new Date();
    if (isNaN(d.getTime())) return "0";
    return String(Math.floor(d.getTime() / 1000));
  })();
  const total = Number(opts.totalAmount || 0).toFixed(2);
  const op = String(opts.operatorId ?? "0");
  return `${billNo}-${ts}-${total}-${op}`;
}

/** 32-bit FNV-1a → uppercase 8-char hex. */
export function fnv1a32Hex(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

/** FNV-1a hash only (QR `?hash=` query param). */
export function buildBillAuditHash(opts: BillAuditHashInput): string {
  return fnv1a32Hex(buildBillAuditPayload(opts));
}

/** Full printed audit token: payload-HASH. */
export function buildBillAuditToken(opts: BillAuditHashInput): string {
  const payload = buildBillAuditPayload(opts);
  return `${payload}-${fnv1a32Hex(payload)}`;
}
