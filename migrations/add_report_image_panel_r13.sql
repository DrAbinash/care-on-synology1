-- R1.3 — Enterprise image panel. Additive and idempotent.
--
-- radiology_image_references gains the key-image flag and the author of the
-- reference. A partial unique index enforces server-side duplicate
-- prevention: one reference per (draft, SOPInstanceUID, frame). Rows without
-- a SOPInstanceUID (legacy manual series/image-number rows) are exempt.

ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS is_key_image BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS created_by TEXT;

-- sop_instance_uid/frame_number are declared by add_report_presentation_r11.sql
-- (R1.1), which this file's DELETE and index below depend on. Feature
-- migrations run in plain alphabetical filename order (see
-- loadAllMigrationSql() in scripts/db-schema-verify.cjs and
-- db-patch-entrypoint.sh) — "add_report_image_panel_r13.sql" sorts BEFORE
-- "add_report_presentation_r11.sql" ("image_panel" < "presentation"
-- lexicographically) despite the r13/r11 release numbers implying the
-- opposite order. On any database where r11 has not yet run, that made this
-- file's DELETE fail with "column a.sop_instance_uid does not exist" and,
-- since the migration runner treats a feature-migration failure as fatal
-- (set -e in db-patch-entrypoint.sh), everything alphabetically after this
-- file — including r11 itself — was silently skipped for the rest of that
-- deploy. Declaring the same columns here too (IF NOT EXISTS, matching
-- r11's exact types) makes this file self-sufficient regardless of
-- execution order, consistent with the "Additive and idempotent" promise
-- already stated above.
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS study_instance_uid TEXT;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS series_instance_uid TEXT;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS sop_instance_uid TEXT;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS frame_number INTEGER;

-- Duplicates could exist from before the server-side guard (the R1.1 picker
-- only prevented them client-side). Dedupe ONLY drafts that are not yet
-- finalized — a signed/delivered report's rendered image set must never be
-- changed by a migration, even to remove a visual duplicate. Keep the
-- EARLIEST row per (draft, SOP, frame): it carries the original caption and
-- display order.
DELETE FROM radiology_image_references a
  USING radiology_image_references b
  WHERE a.id > b.id
    AND a.draft_id = b.draft_id
    AND a.sop_instance_uid IS NOT NULL
    AND a.sop_instance_uid = b.sop_instance_uid
    AND COALESCE(a.frame_number, -1) = COALESCE(b.frame_number, -1)
    AND NOT EXISTS (
      SELECT 1 FROM radiology_report_drafts d
      WHERE d.id = a.draft_id AND (d.final_report_id IS NOT NULL OR d.status = 'FINAL')
    );

-- Build the unique index only when no duplicates remain (duplicates can
-- survive the scoped DELETE above only on finalized drafts, which we must
-- not touch). If the index is skipped, duplicate prevention still holds for
-- all new work: the API route pre-checks (draft, SOP, frame) and returns 409
-- before inserting. A later clinic-approved cleanup can add the index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM radiology_image_references
    WHERE sop_instance_uid IS NOT NULL
    GROUP BY draft_id, sop_instance_uid, COALESCE(frame_number, -1)
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS rad_img_refs_draft_sop_frame_uniq
      ON radiology_image_references (draft_id, sop_instance_uid, COALESCE(frame_number, -1))
      WHERE sop_instance_uid IS NOT NULL;
  ELSE
    RAISE NOTICE 'rad_img_refs_draft_sop_frame_uniq skipped: duplicate references exist on finalized drafts';
  END IF;
END $$;
