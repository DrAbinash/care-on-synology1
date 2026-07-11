-- R1.3 — Enterprise image panel. Additive and idempotent.
--
-- radiology_image_references gains the key-image flag and the author of the
-- reference. A partial unique index enforces server-side duplicate
-- prevention: one reference per (draft, SOPInstanceUID, frame). Rows without
-- a SOPInstanceUID (legacy manual series/image-number rows) are exempt.

ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS is_key_image BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS radiology_image_references ADD COLUMN IF NOT EXISTS created_by TEXT;

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
