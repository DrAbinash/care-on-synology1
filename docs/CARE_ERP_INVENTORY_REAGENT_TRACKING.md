# CARE ERP — Reagent / Consumable Batch, Expiry & Auto‑Reorder

*Additive extension to the existing inventory module. Nothing changes for
existing items until you opt them in; the new tables are empty until a batch is
received.*

## Why

The base inventory module tracks a single running `current_stock` per item with
stock‑in / stock‑out / adjust transactions. That is fine for bulk consumables
but a diagnostic lab also carries **reagents and kits** that:

- arrive in **lots**, each with its **own expiry date** and cost;
- must be consumed **first‑expiry‑first‑out (FEFO)** — and an **expired** lot
  must never be dispensed;
- need to be **reordered automatically** when stock falls to a reorder point.

This extension adds lot/expiry tracking, FEFO consumption, an expiry report and
a reorder‑suggestion workflow — without disturbing the existing item‑level
stock accounting (the item's `current_stock` stays the authoritative total).

## What was added

### Schema (migration `migrations/add_inventory_reagent_expiry_reorder.sql`)

New columns on `inventory_items` (all additive, safe defaults):

| Column | Meaning |
| --- | --- |
| `track_expiry` (bool, default `false`) | Item is a reagent whose lots carry expiry. |
| `reorder_point` (numeric, null) | Reorder when stock falls to/below this. Falls back to `min_stock` when null. |
| `reorder_quantity` (numeric, null) | How much to reorder. When null, top up to `2 × reorder_point`. |
| `auto_reorder_enabled` (bool, default `false`) | Include the item in the reorder scan. |
| `storage_temp` (text, null) | e.g. `2–8 °C`, `−20 °C` — informational. |
| `open_stability_days` (int, null) | Days a lot is usable once opened — informational. |

New table `inventory_batches` — one row per received lot: `lot_number`,
`expiry_date`, `qty_received`, `qty_remaining`, `unit_cost`, `vendor_id`,
`invoice_number`, `received_at`, `opened_at`, `status`
(`active | depleted | expired | quarantined`).

New table `inventory_reorder_requests` — reorder suggestions / draft POs:
`item_id`, `current_stock`, `reorder_point`, `suggested_qty`,
`preferred_vendor_id`, `status` (`suggested | ordered | received | cancelled`),
`source` (`auto | manual`). A **partial unique index** keeps at most one *open*
(`suggested`/`ordered`) request per item, so re‑scanning never duplicates.

The migration is idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT
EXISTS`) and passes `scripts/check-migration-order.cjs`.

### FEFO / expiry / reorder rules — `src/lib/inventoryReagentLogic.ts`

Pure, DB‑free, unit‑tested (`inventoryReagentLogic.test.ts`, 9 cases):

- **`fefoAllocate(batches, qty)`** — allocates across active batches in
  ascending expiry order; a lot with **no expiry** is consumed **last**; an
  **expired** lot is **never** consumed and is returned in `skippedExpired` so
  the caller can quarantine it. Reports `shortfall` if usable stock is short.
- **`classifyExpiry(batches, asOf, nearDays)`** — splits active lots into
  already‑expired vs expiring within *N* days.
- **`needsReorder(item, stock)` / `suggestedReorderQty(item, stock)`** — the
  reorder‑point rule and top‑up quantity.

## API

All endpoints are mounted under `/api/inventory` behind the **same staff auth +
`/inventory` permission** as the rest of the module.

| Method & path | Purpose |
| --- | --- |
| `GET /api/inventory/batches?itemId=` | List an item's lots (newest first). |
| `POST /api/inventory/batches` | **Receive a lot** — creates the batch, an `in` transaction, bumps `current_stock`, and closes any open reorder request for the item. Atomic. |
| `POST /api/inventory/items/:id/consume-fefo` | Deduct a quantity FEFO. Expired lots are skipped; on shortfall nothing is consumed and `409` returns `shortfall` + `quarantineExpiredBatchIds`. |
| `GET /api/inventory/expiry-report?days=90` | Expired + expiring‑within‑N‑days lots, joined to item names. |
| `PATCH /api/inventory/items/:id/reorder-config` | Set `track_expiry`, `reorder_point`, `reorder_quantity`, `auto_reorder_enabled`, `storage_temp`, `open_stability_days`. |
| `POST /api/inventory/reorder/scan` | Create `suggested` requests for every active `auto_reorder_enabled` item at/below its reorder point. Idempotent. |
| `GET /api/inventory/reorder/requests?status=` | List reorder requests (joined to item + preferred vendor). |
| `POST /api/inventory/reorder/requests/:id/order` | `suggested → ordered`. |
| `POST /api/inventory/reorder/requests/:id/receive` | `suggested`/`ordered` → `received`. |
| `POST /api/inventory/reorder/requests/:id/cancel` | `suggested`/`ordered` → `cancelled`. |

## How to activate (per item)

1. Mark the reagent and set its thresholds:
   ```http
   PATCH /api/inventory/items/42/reorder-config
   { "trackExpiry": true, "reorderPoint": 20, "reorderQuantity": 100,
     "autoReorderEnabled": true, "storageTemp": "2–8 °C" }
   ```
2. Receive lots as they arrive:
   ```http
   POST /api/inventory/batches
   { "itemId": 42, "lotNumber": "L2409A", "expiryDate": "2026-03-31",
     "quantity": 100, "unitCost": 12.5, "vendorId": 7, "invoiceNumber": "INV-8891" }
   ```
3. Consume against tests/runs FEFO:
   ```http
   POST /api/inventory/items/42/consume-fefo
   { "quantity": 5, "reason": "CBC run", "reference": "ORD-2026-0001" }
   ```
4. Watch expiry: `GET /api/inventory/expiry-report?days=60`.
5. Reorder: run `POST /api/inventory/reorder/scan` (e.g. from a daily job),
   review `GET /api/inventory/reorder/requests?status=suggested`, mark items
   `order`ed with the vendor, and `receive` closes the loop when the next
   `POST /batches` lands.

## Notes & guarantees

- **No item auto‑orders anything.** The scan only creates *suggestions*; a human
  reviews and marks them ordered. This is deliberate for a clinical setting.
- **Item `current_stock` stays authoritative.** Batch `qty_remaining` across
  active lots should reconcile to it; receiving/consuming keep both in step in a
  single transaction.
- **Backwards compatible.** Items with no reorder config and no batches behave
  exactly as before; existing stock‑in/out routes are untouched.
