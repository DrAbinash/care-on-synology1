# UNIFIED_DOCUMENT_PLATFORM_ARCHITECTURE.md

Branch: `unified-document-platform` · July 3, 2026

## Principle

One shared engine per layer; module-specific logic stays in each module.
Nothing here is a parallel implementation — every layer below **already
existed** in the codebase and is now formally the standard.

## The four layers

```
┌──────────────────────────────────────────────────────────────┐
│ 1. CAPTURE (shared)                                          │
│    DocumentScanCapture.tsx  — camera / upload / drag-drop    │
│    scan-bridge/             — USB flatbed/ADF scanners       │
│      (per-workstation; VITE_SCAN_BRIDGE_URL, default         │
│       http://127.0.0.1:8766)                                 │
├──────────────────────────────────────────────────────────────┤
│ 2. AI EXTRACTION (shared — ONE engine, Gemini)               │
│    lib/integrations-gemini-ai/src/helpers.ts                 │
│      geminiOcrIdCard        → Form F ID cards                │
│      geminiOcrBill          → expense bills / receipts       │
│      geminiParseBankStatement → bank statements (text/image) │
│    Env: AI_INTEGRATIONS_GEMINI_API_KEY (+ optional BASE_URL) │
├──────────────────────────────────────────────────────────────┤
│ 3. MODULE PARSERS / ENDPOINTS (per module — thin)            │
│    /api/form-f/upload-id            (Form F)                 │
│    /api/expenses/scan-bill          (Expenses)               │
│    /api/accounting/bank-statement/parse + /import (Ledger)   │
│    Each maps the AI JSON onto its own form/tables. Field     │
│    mapping lives HERE, never inside the capture component.   │
├──────────────────────────────────────────────────────────────┤
│ 4. STORAGE (shared, ready)                                   │
│    upload_files table + POST /api/uploads (uploads.ts)       │
│    MIME-whitelisted, 25 MB, sanitized paths, soft delete,    │
│    indexed by patient/module/date. DICOM stays on its own    │
│    streaming path (/api/dicom-uploads, 512 MB).              │
└──────────────────────────────────────────────────────────────┘
```

## Rules for any FUTURE document feature

1. **Never add a second OCR engine.** Add a new `gemini*` helper (or a new
   prompt) in `lib/integrations-gemini-ai` and a thin module endpoint.
2. **Never fork the capture UI.** Use `DocumentScanCapture` with your
   endpoint; pass module-specific mapping in `onResult`.
3. **Persist originals via `upload_files`** (module tag, patient link) so
   every document is findable later — do not invent per-module file tables.
4. **Config via env/admin settings only** (see .env.example).
5. **AI output is a suggestion** — staff always review before saving
   (already the pattern in all three modules).

## Current module status

| Module | Capture | AI | Persist original | Notes |
|---|---|---|---|---|
| Form F ID | ✅ ScanIdButton/OcrCapturePanel + bridge | ✅ | partial | Reference implementation — untouched |
| Expense bills | ✅ DocumentScanCapture (recovered) | ✅ | ⏳ next phase | UI recovered this session |
| Bank statements | ✅ Accounting → Scan & Import | ✅ | ⏳ next phase | Now discoverable from Banking |

## Roadmap (needs owner approval — not implemented)

- **R1. Persist originals:** on successful scan, also POST the image to
  `/api/uploads` (module `expense_bills` / `bank_statements`) and store the
  returned id on the expense/voucher. Additive column each — one small
  approved migration.
- **R2. Reconciliation matching:** cross-check imported bank rows against
  patient receipts / vendor payments / refunds by amount+date window,
  surfacing "probable match" suggestions. Read-only suggestions first;
  never auto-posts. Touches no existing financial formula.
- **R3. Patient document folder:** per-patient tab listing all
  `upload_files` rows (reports, ID cards, consents) — the table already
  supports it.
