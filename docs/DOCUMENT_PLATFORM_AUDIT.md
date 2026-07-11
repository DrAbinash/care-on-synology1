# DOCUMENT_PLATFORM_AUDIT.md

Audit date: July 3, 2026 · Branch: `unified-document-platform` (based on `radiology-v2-phase-a-b`)
Method: full-text search across `artifacts/` and `lib/` for OCR, upload, import, and parser code; every hit traced from database → backend route → frontend UI to confirm it's actually reachable by staff.

---

## Headline finding

**You were not wrong that things were "missing" — but the AI engines were never deleted. They exist and work. What was missing was the on-screen button to reach them.** Three real, working AI extraction engines already live in `lib/integrations-gemini-ai/src/helpers.ts`: `geminiOcrIdCard` (ID card OCR — Form F), `geminiOcrBill` (bill/receipt OCR), and `geminiParseBankStatement` (bank statement parsing). All three are already wired to backend routes. Two of the three had **no working frontend button** to trigger them.

---

## 1. OCR Engines Found

| Engine | Location | Purpose | Backend wired? | Frontend wired? |
|---|---|---|---|---|
| `geminiOcrIdCard` | `lib/integrations-gemini-ai/src/helpers.ts:710` | Extract guardian name/address from ID card photo (PCPNDT Form F compliance) | ✅ `POST /api/form-f/upload-id` | ✅ `OcrCapturePanel.tsx` + `ScanIdButton.tsx`, used inside `FormF.tsx` |
| `geminiOcrBill` | `helpers.ts:294` | Extract vendor/date/amount/GST/category/payment-mode from an expense bill photo | ✅ `POST /api/expenses/scan-bill` (`expenses.ts:175`) | ❌ **Was orphaned — zero references anywhere in `Expenses.tsx`.** Fixed this session (see Implementation Report). |
| `geminiParseBankStatement` | `helpers.ts:381` | Extract date/description/debit/credit/balance/reference rows from a bank statement (text or image) | ✅ `POST /api/accounting/bank-statement/parse` + `/import` (`accounting.ts:1137,1180`) | ✅ Fully built — `BankStatementPanel` inside `Accounting.tsx`, under the **"Scan & Import"** tab. **Working, just not discoverable from the Banking page** (fixed this session — see below). |

No separate Tesseract, Google Vision, or any second OCR engine exists anywhere in the repo. **One AI OCR engine (Gemini) serves all three use cases already** — the "don't build a second engine" goal is already true today; nothing needed inventing.

## 2. Upload Infrastructure Found

A generic, reusable upload backbone **already exists** and is production-quality:

- **`lib/db/src/schema/uploadFiles.ts`** — `upload_files` table: `module`, `fileName`, `mimeType`, `sizeBytes`, `storagePath`, `checksum`, `uploadedBy`, soft-delete flag, indexed by patient/module/date. This is exactly the "document repository" the brief asked for — **it already exists, unused by most modules.**
- **`artifacts/api-server/src/routes/uploads.ts`** — `POST /api/uploads`, JSON base64, MIME-whitelisted (`SAFE_MIME_TYPES`), 25MB cap, sanitized paths, auth-gated. Ready to receive any module's documents.
- **`artifacts/api-server/src/routes/dicom-uploads.ts`** — separate streaming multipart path for large DICOM files (512MB cap, `DICOM_UPLOAD_MAX_BYTES` env-overridable) — correctly kept separate from document uploads (different size/format profile).

**Currently consumers of `upload_files`:** website asset uploads, some radiology report attachments. **Not yet used by:** Form F, Expenses, Bank statements (they store images inline as base64 or don't persist the original at all in some cases — see gaps below).

## 3. Import / Parser Infrastructure Found

- **CSV/Excel:** `xlsx` (SheetJS) is already a dependency of `diagnostic-erp` (`package.json:89`). Used today for exports (e.g., Banking's CSV download). Not yet used for *imports* anywhere — the bank statement importer instead sends CSV/pasted text through the AI parser (`geminiParseBankStatement`), which is actually more robust for real-world bank statement formats (inconsistent columns, merged headers) than a rigid CSV-column mapper would be. **Recommendation: keep it this way** — do not add a second, rigid CSV importer alongside the AI one.
- **Bank statement reconciliation:** `accounting.ts` bank-statement import creates real ledger vouchers (`payment`/`receipt` type, auto-numbered `PV-YYYYMM-####` / `RV-YYYYMM-####`), linked to a chosen bank account and contra account. This is a genuine, working import → ledger pipeline. It does **not** yet cross-check against patient receipts/billing/refunds for automatic matching (see Gaps).

## 4. Physical Scanner Bridge (separate from AI OCR)

- **`scan-bridge/`** — a real, well-documented local Node.js service (`README.md`) that bridges USB flatbed/ADF scanners (WIA on Windows, SANE on Linux, or folder-watch) to the browser via a localhost HTTP bridge (`http://127.0.0.1:8766`), used today only by Form F's ID card scanning (`ScanIdButton.tsx`, `FormF.tsx`). This is **infrastructure, not OCR** — it captures an image; the image is then sent to `geminiOcrIdCard`. This bridge could power *any* future module's "scan with USB scanner" button with zero new code — it's already generic.
- **Finding:** the bridge URL was hardcoded (`"http://127.0.0.1:8766"`) in two files, violating the project's "never hardcode" rule (loopback address, not a LAN IP, but still should be configurable). **Fixed this session** — now reads `VITE_SCAN_BRIDGE_URL` with the same default.

## 5. Reusable UI Components Found

- **`OcrCapturePanel.tsx`** (614 lines) — camera + upload + scan-bridge trigger + OCR result display, but **hardcoded to Form F's result shape** (`guardianName`, `address`). Genuinely good component, just not generic.
- **`ScanIdButton.tsx`** (576 lines) — modal orchestrating bridge/mobile/manual capture modes, also Form-F-specific (`linkedFormFId` prop, ID-card-shaped result).
- **Neither was reusable as-is** for Expenses or Bank without forking. Rather than fork them (which the brief explicitly forbids — "no duplicate OCR implementations"), this session added **one new generic component**, `DocumentScanCapture.tsx`, that captures an image and posts it to *any* endpoint the caller specifies, returning the raw JSON. It intentionally does not know about ID cards, bills, or bank statements — that logic stays in each module, exactly matching the brief's "module-specific parsers, shared capture engine" architecture. See `UNIFIED_DOCUMENT_PLATFORM_ARCHITECTURE.md`.

## 6. Hidden / Disabled / Orphaned Items Found

| Item | Status | Action |
|---|---|---|
| `geminiOcrBill` on Expenses page | Backend live, frontend orphaned | ✅ Fixed — button added, wired to existing endpoint |
| Bank Statement Import (`Accounting.tsx` "Scan & Import" tab) | Fully built, working, but only reachable if staff happens to open Accounting and notices the tab; **Banking page (where staff would naturally look) had no link to it at all** | ✅ Fixed — added a button on the Banking page header linking directly to the tab (deep-link via `?tab=scan-import`, which required making Accounting's tabs URL-aware — small, safe, additive change) |
| Hardcoded scan-bridge URL | Minor "never hardcode" violation | ✅ Fixed — env-overridable |
| `upload_files` table | Built but underused | Documented as the target backbone in the architecture doc; not force-migrated onto existing modules this session (see "What was deliberately NOT changed" below) |
| Second, unused CSV import path | Not found | N/A — no duplicate import mechanism exists to eliminate |
| Feature flags disabling OCR/upload | Not found | The `hideDeprecatedNav` / `ownerOnly` flags from Radiology V2 do not touch any document/OCR feature |

## 7. What was deliberately NOT changed this session

Per the brief's own safety rules ("prefer restoring over rewriting," "refactor only after confirming existing functionality is preserved," "do not modify billing calculations, payment gateway logic, financial formulas, or reconciliation formulas"):

- **Form F's OCR flow is completely untouched** — `OcrCapturePanel.tsx`, `ScanIdButton.tsx`, and `form-f.ts` were read but not modified (except the one hardcoded-URL fix, which changes no behavior — same default value).
- **No new database tables or columns.** The existing `upload_files`, `expenses`, and accounting tables are unchanged.
- **No changes to voucher creation, ledger posting, or any financial formula.** The bank-statement importer's voucher-creation logic in `accounting.ts` was read but not modified.
- **Automatic cross-module reconciliation** (bank ↔ patient receipts ↔ refunds ↔ vendor payments) described in the brief does **not** exist yet in any form — this is genuinely new work, correctly scoped to a future phase (see architecture doc's roadmap), not silently skipped.

---

*This audit is based on static code analysis of the repository at commit `44457c1f` plus the changes described in `IMPLEMENTATION_REPORT.md`. No database was queried live (no DB connection available in this environment).*
