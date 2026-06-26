# Financial Code Review Checklist
## Care Diagnostics ERP Production Governance

This checklist must be filled out and checked off by at least one Senior Reviewer or the Lead Developer before merging any change that touches a financially critical module.

---

## 🔍 Pre-Merge Checklist

- [ ] **No Invariant Violation**: The patch preserves the core balance invariant: `balance = max(0, total - paid - refund)`.
- [ ] **No Historical Mutation**: Total amounts and historical payments/vouchers are immutable. No updates alter past records.
- [ ] **No Orphan Records**: Every payment insertion is linked to a valid `bill_id`.
- [ ] **No Duplicate Vouchers**: The patch does not cause multiple journal/payment/receipt vouchers to be spawned for a single event.
- [ ] **No Duplicate Payments**: Re-verify webhook idempotency and check-before-insert safeguards on gateway endpoints.
- [ ] **No Balance Mismatch**: Drizzle update schemas correctly sync both the `paid_amount` and `balance_amount` in the same transaction block.
- [ ] **No Reconciliation Mismatch**: Match confidence algorithms and auto-close triggers do not mismatch when refund details are present.
- [ ] **No Database Locking**: Complex aggregate queries use index scans and do not trigger table/row locks on the `bills` or `payments` tables during high-volume periods.
- [ ] **Strict Decimal Rounding**: Computations utilize `Math.round(val * 100) / 100` or numeric precision matching the database scaled schema (e.g. `numeric(10,2)`). Floating point precision drift is prevented.

---

## 👥 Review Sign-off
*   **Reviewer Name**:
*   **Signature / Date**:
*   **Merge Target Hash**:
