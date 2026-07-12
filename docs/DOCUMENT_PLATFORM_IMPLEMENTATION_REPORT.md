# DOCUMENT_PLATFORM_IMPLEMENTATION_REPORT.md

Branch: `unified-document-platform` (from `radiology-v2-phase-a-b` @ 44457c1f)
Restore point tag: `restore-point-before-document-platform`

## What was recovered / built (all verified: 295/295 tests, 0 typecheck errors, both builds pass)

1. **Expense Bill Scanner — RECOVERED.** The backend
   (`POST /api/expenses/scan-bill` → `geminiOcrBill`) existed with **zero
   frontend callers**. The "Record Expense" dialog now shows
   **"Scan Bill / Receipt with AI"**: photo/upload/drag-drop → fields
   (vendor→Paid To, date, amount, category, payment mode, description)
   auto-fill with a confidence toast → **staff reviews before saving**.
   AI vocabulary is mapped onto the form's existing category/payment lists;
   unknown values fall back to current selections. Backend untouched.
2. **New shared component `DocumentScanCapture.tsx`** — generic camera +
   upload + drag-drop capture that posts `{imageBase64, mimeType}` to any
   endpoint. No module fields baked in. This is the standard capture UI for
   all future document features (architecture doc, layer 1).
3. **Bank Statement Import — made discoverable.** The full working importer
   (parse via AI → review rows → import as ledger vouchers) lived only
   under Accounting → "Scan & Import". The **Banking page** now has an
   "Import Bank Statement (AI)" button deep-linking there; Accounting's
   tabs now honor `?tab=` (URL-controlled, additive).
4. **"Never hardcode" fix:** scan-bridge URL (`http://127.0.0.1:8766`) in
   ScanIdButton.tsx and FormF.tsx now reads `VITE_SCAN_BRIDGE_URL`
   (same default; documented in .env.example).

## Form F OCR — verification note

Form F is the reference implementation and was **not modified** (except the
URL-config fix above, behavior-identical). Static verification of the full
chain: ScanIdButton/OcrCapturePanel (camera, upload, USB bridge, mobile QR)
→ `POST /api/form-f/upload-id` → `geminiOcrIdCard` → guardian name/address
suggestions with per-stage `ocrLog` diagnostics and a `/api/form-f/ocr-status`
health endpoint. Manual test after deploy: Form F → Scan ID → upload an
Aadhaar photo → name/address auto-suggest → verify ocr-status shows Gemini OK.

## Files changed (8)

- NEW `components/DocumentScanCapture.tsx`
- `pages/Expenses.tsx` (scan button + mapping; form logic unchanged)
- `pages/Banking.tsx` (one header button)
- `pages/Accounting.tsx` (tabs URL-aware)
- `components/ScanIdButton.tsx`, `pages/FormF.tsx` (env-config URL)
- `.env.example`, docs/ (this report + audit + architecture)

## Deliberately untouched

Billing calculations, payment gateways, vouchers/ledger posting logic,
registration, permissions, Form F flow, DB schema (zero migrations),
Docker/Orthanc/OHIF.

## Deploy (Synology) — run the safety steps FIRST

```bash
# 1. DATABASE BACKUP (mandatory before any deploy)
docker exec care-db pg_dump -U erp diagnostic_erp | gzip > /volume1/backups/erp_$(date +%F).sql.gz

# 2. Note current rollback point
git rev-parse HEAD   # record this commit id

# 3. Deploy this branch
git fetch origin && git checkout unified-document-platform && git pull
docker compose build && docker compose up -d
```

## Rollback

```bash
git checkout radiology-v2-phase-a-b && docker compose build && docker compose up -d
# or revert the single commit:  git revert <commit-id>
```

## Manual configuration

- **None required for LAN use.** The one prerequisite that already existed:
  `AI_INTEGRATIONS_GEMINI_API_KEY` must be set on the server (it already is,
  since Form F OCR and WhatsApp OCR use it today).
- Optional: `VITE_SCAN_BRIDGE_URL` per workstation (only if a PC runs the
  scanner bridge on a non-default port).

## Manual test checklist (5 min)

1. Expenses → Add Expense → "Scan Bill / Receipt with AI" → photo of any
   receipt → fields fill → edit → Save → expense appears normally.
2. Banking → "Import Bank Statement (AI)" → lands on Accounting Scan &
   Import → paste CSV text or upload statement photo → rows parse → select
   accounts → import → vouchers appear (same voucher logic as before).
3. Form F ID scan still works exactly as before.
4. Billing Desk, payments, registration unaffected.

## Remaining risks

Low. The scanner requires the Gemini key to be valid (clear error surfaces
if not). AI extraction is suggestion-only — a wrong read cannot enter the
ledger without staff pressing Save. Roadmap items R1–R3 (persist originals,
reconciliation suggestions, patient document folder) await your approval.
