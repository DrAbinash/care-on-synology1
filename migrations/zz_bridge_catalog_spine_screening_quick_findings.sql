-- =============================================================================
-- Migration: Bridge the whole-spine-screening content pack into quick findings
-- =============================================================================
-- Brings the CARE radiology content-pack "whole spine screening" findings
-- (seeds/radiology/content-packs/v1/_screening_whole_spine.yaml — the screen.*
-- vocabulary: hemangioma, Schmorl node, Modic changes, marrow metastasis,
-- spondylodiscitis, cord demyelination) into `radiology_quick_findings` so they
-- drive the SAME region-flip mechanism the workspace uses. The catalog itself
-- cannot self-route (its schema carries no study linkage and no template-section
-- field — only a coarse morphology category), so this migration supplies the
-- routing that piping requires:
--   * study_type       ← the region the workspace resolves for each screening
--                         study ('Whole Spine' for the LS-screening template,
--                         'Cervical Spine' for the cervical-screening template).
--   * anatomical_section← a real template region label. Marrow/vertebral screen
--                         findings map to the "Screening — Vertebral Marrow"
--                         section added to both screening templates alongside
--                         this migration; the cord demyelination finding maps to
--                         "Screening — Cord Signal".
--   * finding_text / impression_text ← the pack's default_sentence /
--                         impression_fragment, with {location} normalised to the
--                         {level} property chip and free placeholders bracketed
--                         for manual fill.
--
-- Section strings are matched to template labels by the workspace's keyword
-- matcher (matchTemplateSection), so exact spelling is no longer load-bearing;
-- they are nonetheless kept aligned to the template labels here.
--
-- Only the marrow/cord screening findings NOT already covered by
-- zz_add_whole_spine_screening_quick_findings.sql are added, so there is no
-- duplication. Fully idempotent: INSERT … ON CONFLICT (study_type, label) DO
-- NOTHING; the `zz_` prefix orders it after the smart-findings column migration.
-- =============================================================================

-- ── Whole Spine (LS-with-screening template) — catalog marrow/cord screen set ──
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Whole Spine', 'Vertebral hemangioma (screen)', 'T1/T2 hyperintense lesion with coarse vertical trabeculae in the {level} vertebral body, consistent with a typical vertebral haemangioma.', 'Vertebral haemangioma at {level} — incidental.', 'Screening — Vertebral Marrow', '', 'level', 50),
  ('Whole Spine', 'Schmorl node (screen)', 'Schmorl node(s) noted at the {level} endplate(s).', '', 'Screening — Vertebral Marrow', '', 'level', 51),
  ('Whole Spine', 'Modic endplate changes (screen)', '{severity} endplate (Modic) marrow signal changes at {level}.', '', 'Screening — Vertebral Marrow', '', 'severity, level', 52),
  ('Whole Spine', 'Marrow metastasis (screen)', '[Single/Multiple] T1-hypointense marrow-replacing lesion(s) in the {level} vertebra(e), suspicious for metastatic deposit(s). [No / With] epidural extension or cord compromise.', 'Marrow lesion(s) at {level} — suspicious for metastases; contrast MRI and further evaluation advised.', 'Screening — Vertebral Marrow', '', 'level', 53),
  ('Whole Spine', 'Spondylodiscitis / infection (screen)', 'Altered marrow signal in the {level} vertebra(e) with disc-space involvement and paravertebral soft tissue, suggestive of infective spondylodiscitis (tubercular vs pyogenic).', 'Infective spondylodiscitis at {level} — tubercular vs pyogenic; dedicated contrast study and clinical correlation advised.', 'Screening — Vertebral Marrow', '', 'level', 54),
  ('Whole Spine', 'Cord demyelination (screen)', 'Screening sagittals show short-segment T2 hyperintense cord signal at {level}, which may represent a demyelinating lesion. Dedicated contrast imaging is advised.', 'Possible demyelinating cord lesion at {level} on screening — dedicated contrast MRI advised.', 'Screening — Cord Signal', '', 'level', 55)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Cervical Spine (cervical-with-screening template) — same catalog set ──────
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, anatomical_section, conflict_group, properties, sort_order) VALUES
  ('Cervical Spine', 'Vertebral hemangioma (screen)', 'T1/T2 hyperintense lesion with coarse vertical trabeculae in the {level} vertebral body, consistent with a typical vertebral haemangioma.', 'Vertebral haemangioma at {level} — incidental.', 'Screening — Vertebral Marrow', '', 'level', 50),
  ('Cervical Spine', 'Schmorl node (screen)', 'Schmorl node(s) noted at the {level} endplate(s).', '', 'Screening — Vertebral Marrow', '', 'level', 51),
  ('Cervical Spine', 'Modic endplate changes (screen)', '{severity} endplate (Modic) marrow signal changes at {level}.', '', 'Screening — Vertebral Marrow', '', 'severity, level', 52),
  ('Cervical Spine', 'Marrow metastasis (screen)', '[Single/Multiple] T1-hypointense marrow-replacing lesion(s) in the {level} vertebra(e), suspicious for metastatic deposit(s). [No / With] epidural extension or cord compromise.', 'Marrow lesion(s) at {level} — suspicious for metastases; contrast MRI and further evaluation advised.', 'Screening — Vertebral Marrow', '', 'level', 53),
  ('Cervical Spine', 'Spondylodiscitis / infection (screen)', 'Altered marrow signal in the {level} vertebra(e) with disc-space involvement and paravertebral soft tissue, suggestive of infective spondylodiscitis (tubercular vs pyogenic).', 'Infective spondylodiscitis at {level} — tubercular vs pyogenic; dedicated contrast study and clinical correlation advised.', 'Screening — Vertebral Marrow', '', 'level', 54),
  ('Cervical Spine', 'Cord demyelination (screen)', 'Screening sagittals show short-segment T2 hyperintense cord signal at {level}, which may represent a demyelinating lesion. Dedicated contrast imaging is advised.', 'Possible demyelinating cord lesion at {level} on screening — dedicated contrast MRI advised.', 'Screening — Cord Signal', '', 'level', 55)
ON CONFLICT (study_type, label) DO NOTHING;
