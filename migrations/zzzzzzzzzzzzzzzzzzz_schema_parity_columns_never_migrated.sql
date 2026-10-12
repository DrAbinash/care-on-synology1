-- Close the gap between the Drizzle schema and the migration chain.
-- ==========================================================================
-- Every column below is declared in lib/db/src/schema/*.ts and written by
-- route code, but no migration ever created it. Two different symptoms, same
-- cause:
--
--   * a migration-built database (what CI's db:bootstrap and a fresh clinic
--     install get) lacks the column, so the route that SELECTs/INSERTs it
--     fails with 42703 undefined_column and the API answers HTTP 500; and
--   * purchase_invoices / purchase_invoice_line_items are missing as TABLES,
--     so supplier-invoice scan → match → post cannot run at all there.
--
-- radiology_institutional_styles and usg_extraction_settings.pipeline_enabled
-- also had no migration; they survived in the clinic only because
-- artifacts/api-server/src/index.ts ALTERs them at every boot. A startup patch
-- is not a migration: it runs after the schema-verify gate, it does not run
-- for SQL clients or for the request-level test harness, and it silently
-- diverges from whatever the schema file says. They are migrated here so both
-- paths agree.
--
-- Additive only. Nothing is dropped, renamed or restated as a different type;
-- existing rows keep their values and every added column is either nullable or
-- carries the same DEFAULT the schema declares, so a legacy row reads as the
-- schema's own default rather than as an invented value.

-- ── 1. radiology_snippets: the report-format library columns ──────────────
-- clinical_history_text is a whole-report Clinical History section (never
-- patient demographics); usage_count is the soft ranking the format picker
-- sorts by. Neither existed on a migrated database, so
-- GET /api/radiology/report-formats failed for every clinic.
ALTER TABLE radiology_snippets ADD COLUMN IF NOT EXISTS clinical_history_text TEXT;
ALTER TABLE radiology_snippets ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

-- ── 2. radiology_chocolate_findings: the ownership contract ───────────────
-- These six are what make a finding tile retirable and non-overlapping
-- (anatomical_section / conflict_group / baseline_replaces / sections_owned),
-- what dedupes a client-authored tile against the server copy (client_key), and
-- what decides whether left/right wording is legal (supports_laterality). The
-- defaults are deliberately the schema's own: '' means "no ownership declared",
-- which is how every tile written before the contract existed must read.
ALTER TABLE radiology_chocolate_findings ADD COLUMN IF NOT EXISTS client_key TEXT;
ALTER TABLE radiology_chocolate_findings ADD COLUMN IF NOT EXISTS anatomical_section TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_chocolate_findings ADD COLUMN IF NOT EXISTS conflict_group TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_chocolate_findings ADD COLUMN IF NOT EXISTS baseline_replaces TEXT NOT NULL DEFAULT '';
ALTER TABLE radiology_chocolate_findings ADD COLUMN IF NOT EXISTS supports_laterality BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE radiology_chocolate_findings ADD COLUMN IF NOT EXISTS sections_owned TEXT NOT NULL DEFAULT 'findings';

-- ── 3. radiology_institutional_styles: the presentation template ──────────
-- Same literals as the schema (radiologyReportGenerator.ts) and as the boot
-- patch, so a database that was healed by the boot path and one built only
-- from migrations end up identical.
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS subheading_style TEXT NOT NULL DEFAULT 'underlined';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS line_gap TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS font_family TEXT NOT NULL DEFAULT 'arial';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS logo_position TEXT NOT NULL DEFAULT 'left';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS signature_position TEXT NOT NULL DEFAULT 'right';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS image_placement TEXT NOT NULL DEFAULT 'inline';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS study_title_style TEXT NOT NULL DEFAULT 'underlined';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS logo_scale TEXT NOT NULL DEFAULT 'large';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS clinic_name_scale TEXT NOT NULL DEFAULT 'large';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS address_scale TEXT NOT NULL DEFAULT 'large';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS name_align TEXT NOT NULL DEFAULT 'left';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS address_align TEXT NOT NULL DEFAULT 'center';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS header_rule_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS header_rule_thickness TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE radiology_institutional_styles ADD COLUMN IF NOT EXISTS header_rule_color TEXT NOT NULL DEFAULT 'accent';

-- ── 4. usg_extraction_settings: the pipeline switch ───────────────────────
-- Nullable-with-default rather than a backfilled flag: a singleton row that
-- predates this column was created when the pipeline always ran, so TRUE is the
-- value that preserves behaviour instead of changing it.
ALTER TABLE usg_extraction_settings ADD COLUMN IF NOT EXISTS pipeline_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 5. purchase_invoices / purchase_invoice_line_items ────────────────────
-- The whole table pair is absent from the chain, so posting a scanned supplier
-- invoice — the path that fans matched lines out into inventory batches and
-- transactions — has never worked on a migrated database. Columns, nullability
-- and defaults are exactly lib/db/src/schema/purchaseInvoices.ts.
--
-- vendor_id and item_id are SET NULL on purpose: deleting a vendor or a catalog
-- item must not destroy the record of what the clinic was billed, and
-- vendor_name_raw / description_raw exist precisely to keep the invoice's own
-- words after the match is gone.
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  invoice_date DATE,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name_raw TEXT,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  source_image_url TEXT,
  ocr_confidence TEXT,
  ocr_confidence_percent INTEGER,
  notes TEXT,
  created_by TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  description_raw TEXT NOT NULL,
  match_confidence NUMERIC(5, 2),
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  lot_number TEXT,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
