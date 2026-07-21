-- =============================================================================
-- Migration: Quick findings for the whole-spine-screening structured templates
-- =============================================================================
-- Wires the Smart Findings region-flip for the two structured templates added
-- alongside this migration:
--   * "MRI LS Spine with Whole Spine Screening"       (study region: Whole Spine)
--   * "MRI Cervical Spine with Whole Spine Screening" (study region: Cervical Spine)
--
-- The reporting workspace flips a template region from its baseline normal to a
-- finding's text when a quick finding is picked whose `anatomical_section`
-- EXACTLY matches a template `findingsItems[].label`, AND whose `study_type`
-- equals the study region the workspace resolves (matchStudyRegion: longest
-- active study-tab name that is a substring of "<modality> <studyDescription>").
--
--   * A "… whole spine screening" LS study resolves to region "Whole Spine"
--     (the "Whole Spine" tab out-scores "LS Spine"), so its findings are seeded
--     under study_type = 'Whole Spine' and cover BOTH the per-level lumbar
--     sections and the "Screening — …" sections of the LS-screening template.
--   * A cervical whole-spine-screening study resolves to region "Cervical Spine"
--     (already the widest matching tab). The cervical-screening template reuses
--     the EXISTING cervical section labels for its detailed part (so the
--     existing 'Cervical Spine' findings already flip those regions); this
--     migration only adds findings for its NEW sections (craniovertebral
--     junction, C7-D1, and the "Screening — …" sections).
--
-- `anatomical_section` strings below are copied CHARACTER-FOR-CHARACTER from the
-- template findingsItems labels (em-dash "—" included) — any mismatch would make
-- the finding fall into the "Additional Observations" catch-all instead of
-- flipping its region.
--
-- The `zz_` prefix orders this AFTER z_add_radiology_smart_findings_engine.sql
-- (which adds anatomical_section / conflict_group) and its fix migration.
--
-- Fully idempotent: INSERT … ON CONFLICT (study_type, label) DO NOTHING. Safe to
-- run repeatedly; admin edits to any pre-existing row are never overwritten.
-- =============================================================================

-- ── Whole Spine — lumbar detail (aligned to the LS-screening template) ────────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Whole Spine', 'L1-L2 disc bulge', 'Diffuse posterior disc bulge at L1-L2 indenting the anterior thecal sac.', 'L1-L2 disc bulge.', 'L1-L2', 'l1l2', '', 10),
  ('Whole Spine', 'L2-L3 disc bulge', 'Diffuse posterior disc bulge at L2-L3 indenting the anterior thecal sac.', 'L2-L3 disc bulge.', 'L2-L3', 'l2l3', '', 11),
  ('Whole Spine', 'L3-L4 disc bulge', 'Diffuse posterior disc bulge at L3-L4 indenting the anterior thecal sac, with mild bilateral neural foraminal narrowing.', 'L3-L4 disc bulge.', 'L3-L4', 'l3l4', '', 12),
  ('Whole Spine', 'L4-L5 disc bulge', 'Diffuse posterior disc bulge at L4-L5 indenting the anterior thecal sac, with mild bilateral neural foraminal narrowing.', 'L4-L5 disc bulge.', 'L4-L5', 'l4l5', '', 13),
  ('Whole Spine', 'L4-L5 disc herniation', 'Posterior disc herniation at L4-L5 causing {severity} {side} neural foraminal narrowing and traversing nerve root compression.', '{severity} L4-L5 disc herniation with {side} nerve root compression.', 'L4-L5', 'l4l5', 'severity, side', 14),
  ('Whole Spine', 'L5-S1 disc bulge', 'Diffuse posterior disc bulge at L5-S1 indenting the anterior thecal sac.', 'L5-S1 disc bulge.', 'L5-S1', 'l5s1', '', 15),
  ('Whole Spine', 'L5-S1 disc herniation', 'Posterior disc herniation at L5-S1 causing {severity} {side} neural foraminal narrowing and nerve root compression.', '{severity} L5-S1 disc herniation with {side} nerve root compression.', 'L5-S1', 'l5s1', 'severity, side', 16),
  ('Whole Spine', 'Loss of lumbar lordosis', 'Straightening of the normal lumbar lordosis, likely positional or due to muscle spasm.', 'Loss of lumbar lordosis.', 'Alignment & Curvature', '', '', 17),
  ('Whole Spine', 'Lumbar spondylolisthesis', 'Anterolisthesis at {level} noted.', 'Spondylolisthesis at {level}.', 'Alignment & Curvature', '', 'level', 18),
  ('Whole Spine', 'Lumbar scoliosis', 'Levoscoliosis/dextroscoliosis of the lumbar spine noted.', 'Lumbar scoliosis.', 'Alignment & Curvature', '', '', 19),
  ('Whole Spine', 'Lumbar Modic changes', 'Modic type II endplate marrow signal change noted at {level}.', 'Modic changes at {level}.', 'Lumbar Vertebral Bodies', '', 'level', 20),
  ('Whole Spine', 'Lumbar compression fracture', 'Wedge compression of the {level} vertebral body with loss of height.', 'Compression fracture of {level}.', 'Lumbar Vertebral Bodies', '', 'level', 21),
  ('Whole Spine', 'Low-lying conus', 'The conus medullaris terminates below the L2 level, consistent with a low-lying conus.', 'Low-lying conus medullaris.', 'Conus & Cauda Equina', '', '', 22),
  ('Whole Spine', 'Cauda equina compression', 'Crowding/compression of the cauda equina nerve roots noted at {level}.', 'Cauda equina compression at {level}.', 'Conus & Cauda Equina', '', 'level', 23)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Whole Spine — screening sections (aligned to the LS-screening template) ───
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Whole Spine', 'Chiari I malformation (screening)', 'The cerebellar tonsils are low-lying, herniating below the foramen magnum, consistent with a Chiari I malformation.', 'Chiari I malformation — dedicated brain/CV junction imaging advised.', 'Screening — Craniovertebral Junction', '', '', 30),
  ('Whole Spine', 'Cervical disc herniation (screening)', 'Screening sagittals show a disc herniation in the cervical spine at {level}. Dedicated cervical spine imaging is advised for characterisation.', 'Cervical disc herniation on screening — dedicated cervical imaging advised.', 'Screening — Cervical Spine', '', 'level', 31),
  ('Whole Spine', 'Cervical canal stenosis (screening)', 'Screening sagittals show canal narrowing in the cervical spine. Dedicated cervical spine imaging is advised.', 'Cervical canal stenosis on screening — dedicated cervical imaging advised.', 'Screening — Cervical Spine', '', '', 32),
  ('Whole Spine', 'Dorsal disc herniation (screening)', 'Screening sagittals show a disc herniation in the dorsal spine at {level}. Dedicated dorsal spine imaging is advised for characterisation.', 'Dorsal disc herniation on screening — dedicated dorsal imaging advised.', 'Screening — Dorsal Spine', '', 'level', 33),
  ('Whole Spine', 'Dorsal compression fracture (screening)', 'Screening sagittals show a wedge compression of a dorsal vertebral body. Dedicated dorsal spine imaging is advised.', 'Dorsal compression fracture on screening — dedicated dorsal imaging advised.', 'Screening — Dorsal Spine', '', '', 34),
  ('Whole Spine', 'Cord signal abnormality (screening)', 'Screening sagittals show a focal T2 hyperintense signal within the spinal cord at {level}. Dedicated regional imaging is advised.', 'Cord signal abnormality on screening — dedicated imaging advised.', 'Screening — Cord Signal', '', 'level', 35),
  ('Whole Spine', 'Syrinx (screening)', 'A fluid-signal cavity is noted within the spinal cord on screening sagittals, consistent with a syrinx. Dedicated imaging is advised.', 'Cord syrinx on screening — dedicated imaging advised.', 'Screening — Cord Signal', '', '', 36),
  ('Whole Spine', 'Sacral lesion (screening)', 'Screening sagittals show a focal marrow lesion in the sacrum. Dedicated sacral imaging is advised.', 'Sacral marrow lesion on screening — dedicated imaging advised.', 'Screening — Sacrum & SI Joints', '', '', 37),
  ('Whole Spine', 'Sacroiliitis (screening)', 'Subchondral marrow oedema across the sacroiliac joints on screening, suggestive of sacroiliitis. Dedicated SI joint imaging advised.', 'Features suggestive of sacroiliitis on screening.', 'Screening — Sacrum & SI Joints', '', '', 38)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Cervical Spine — NEW sections for the cervical whole-spine-screening template ─
-- The detailed cervical sections ('Alignment & Curvature', 'C2-C3 to C6-C7',
-- 'Vertebral Bodies', 'Spinal Cord') are already covered by the existing
-- 'Cervical Spine' findings, which the cervical-screening template reuses.
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Cervical Spine', 'Chiari I malformation', 'The cerebellar tonsils are low-lying, herniating below the foramen magnum, consistent with a Chiari I malformation.', 'Chiari I malformation — dedicated brain/CV junction imaging advised.', 'Craniovertebral Junction', '', '', 40),
  ('Cervical Spine', 'C7-D1 disc bulge', 'Posterior disc bulge at C7-D1 indenting the thecal sac.', 'C7-D1 disc bulge.', 'C7-D1', '', '', 41),
  ('Cervical Spine', 'Dorsal lesion (screening)', 'Screening sagittals show an abnormality in the dorsal spine at {level}. Dedicated dorsal spine imaging is advised for characterisation.', 'Dorsal spine abnormality on screening — dedicated dorsal imaging advised.', 'Screening — Dorsal Spine', '', 'level', 42),
  ('Cervical Spine', 'Lumbar disc herniation (screening)', 'Screening sagittals show a disc herniation in the lumbosacral spine at {level}. Dedicated LS spine imaging is advised for characterisation.', 'Lumbar disc herniation on screening — dedicated LS imaging advised.', 'Screening — Lumbosacral Spine', '', 'level', 43),
  ('Cervical Spine', 'Cord signal abnormality (screening)', 'Screening sagittals show a focal T2 hyperintense signal within the spinal cord at {level}. Dedicated regional imaging is advised.', 'Cord signal abnormality on screening — dedicated imaging advised.', 'Screening — Cord Signal', '', 'level', 44),
  ('Cervical Spine', 'Syrinx (screening)', 'A fluid-signal cavity is noted within the spinal cord on screening sagittals, consistent with a syrinx. Dedicated imaging is advised.', 'Cord syrinx on screening — dedicated imaging advised.', 'Screening — Cord Signal', '', '', 45),
  ('Cervical Spine', 'Sacral lesion (screening)', 'Screening sagittals show a focal marrow lesion in the sacrum. Dedicated sacral imaging is advised.', 'Sacral marrow lesion on screening — dedicated imaging advised.', 'Screening — Sacrum', '', '', 46)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Study tabs so the two screening regions surface their quick-select panels ──
-- 'Whole Spine' already exists (seeded in add_radiology_quick_findings.sql). No
-- new tab is required for either region; this block is intentionally omitted.
