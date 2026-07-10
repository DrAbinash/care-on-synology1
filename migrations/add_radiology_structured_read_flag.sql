-- Ticket D6 — Structured Report Read Path and Renderer Display Cutover.
--
-- Registers the D6 read-path feature flag (default OFF), consistent with the
-- add_radiology_feature_flags.sql seed convention. No schema change.
--
-- Deliberately SEPARATE from ff_radiology_structured_final (D5, the signed
-- WRITE path): reads and writes cut over independently, so operations can
-- keep signing structured reports while instantly reverting the DISPLAY
-- cutover (or vice versa). When OFF (default), every read surface — viewer
-- (GET /:id), print, PDF, public/WhatsApp PDF, email share, PACS archive —
-- serves the stored legacy body byte-identically to today. When ON, those
-- surfaces serve the D4 render of patient_reports.structured_json ONLY when
-- it is valid, hash-verified, and IDENTICAL to (or differs only by approved
-- formatting from) the stored body; anything else keeps the stored body and
-- records why. Signed reports are never mutated by the read path.

INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_structured_read', 'Serve radiology report displays (viewer/print/PDF/share/PACS) from the validated D4 render of structured_json when it matches the stored signed body; stored legacy body otherwise (Ticket D6). Default OFF = legacy display everywhere.')
ON CONFLICT (key) DO NOTHING;
