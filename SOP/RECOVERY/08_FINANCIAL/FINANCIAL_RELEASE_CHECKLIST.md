# Financial Release Checklist
## Care Diagnostics ERP Production Governance

This release checklist must be fully executed in a staging environment prior to releasing any billing/accounting patches to the production environment.

---

## 🚀 Pre-Release Verification Steps

### Step 1: Automated Regression Suite
- [ ] Run the test suite and confirm all tests pass:
  ```bash
  pnpm test
  ```
- [ ] Run typechecks and confirm clean build:
  ```bash
  pnpm run build
  ```

### Step 2: Accounting & Voucher Integrity
- [ ] Trigger a test payment and verify that a matching Receipts Voucher (RV) is generated.
- [ ] Trigger a test refund and verify that a matching Payment Voucher (PV) is generated.
- [ ] Verify that double-entry lines sum to exactly zero (Debits = Credits).

### Step 3: Daily Summary Matches Accounting
- [ ] Open the **My Daily Summary** page and verify that the cash reconciliation section balances.
- [ ] Validate that the outstanding dues figure on the dashboard matches the SQL aggregate:
  ```sql
  SELECT SUM(balance_amount::numeric) FROM bills WHERE status IN ('pending', 'partial');
  ```

### Step 4: Tally Export Verification
- [ ] Run a trial Tally XML export and verify that the schema generates valid XML conforming to integration guidelines.

---

## 📝 Release Approval
*   **Staging Auditor**:
*   **Super Admin Sign-off**:
*   **Release Version**:
*   **Deploy Date**:
