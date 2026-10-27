-- dicom_nodes: AE titles repeat across identical consoles — both X-ray
-- consoles announce AE FILMPLUS, distinguished by host. Node identity moves
-- from ae_title alone to (ae_title, host).
--
-- The temporary workaround row FILMPLUS2@172.16.1.91 becomes the real
-- configuration here: FILMPLUS@172.16.1.80 and FILMPLUS@172.16.1.91. The DIMSE
-- pull agent uses ae_title as the C-MOVE/C-ECHO called AE, so the synthetic
-- spelling had to go for the second console to answer.
--
-- Order matters: the composite index is created while every ae_title is still
-- globally distinct, the single-column constraint is dropped before the rename
-- (which would otherwise violate it), and the rename then satisfies the
-- composite because the hosts differ.

CREATE UNIQUE INDEX IF NOT EXISTS "dicom_nodes_ae_title_host_uq" ON "dicom_nodes" ("ae_title", "host");

ALTER TABLE dicom_nodes DROP CONSTRAINT IF EXISTS dicom_nodes_ae_title_unique;

UPDATE dicom_nodes SET ae_title = 'FILMPLUS' WHERE ae_title = 'FILMPLUS2';
