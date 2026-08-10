-- CT / XR quick-select content fill (radiology workspace analysis item 9).
-- Additive seeds for common CT / XR normals and acute findings that were thin
-- relative to the gold-standard packs. Safe to re-run (NOT EXISTS guards).

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, recommendation_text, suggests, conflict_group, questions_json, sort_order)
SELECT v.study_type, v.label, v.finding_text, v.impression_text, v.recommendation_text, v.suggests, v.conflict_group, v.questions_json, v.sort_order
FROM (VALUES
  ('CT Brain Plain', 'No acute infarct', 'No acute territorial infarct, intracranial haemorrhage, or mass effect. Grey-white differentiation is preserved. Ventricles and basal cisterns are normal.', 'No acute intracranial abnormality on non-contrast CT.', 'Clinical correlation. MRI if early ischemia still suspected.', '', 'acute_stroke', '[]', 10),
  ('CT Brain Plain', 'Acute MCA infarct', 'Hypodensity in the {side} MCA territory with loss of grey-white differentiation{swelling}.', 'Acute {side} MCA territory infarct.', 'Stroke pathway / neurology review. Consider CTA / perfusion as per protocol.', 'Mass effect', 'acute_stroke', '[{"key":"side","label":"Side","type":"select","options":["left","right"],"default":"left"},{"key":"swelling","label":"Swelling","type":"select","options":[""," with mild mass effect"," with significant mass effect"],"default":""}]', 20),
  ('CT Brain Plain', 'ICH', 'Acute intraparenchymal haemorrhage in the {location} measuring approximately {size} cm{ivh}.', 'Acute ICH ({location}).', 'Neurosurgery / stroke team notification as per critical pathway.', 'Mass effect', 'bleed', '[{"key":"location","label":"Location","type":"text","default":"basal ganglia"},{"key":"size","label":"Size (cm)","type":"text","default":"2"},{"key":"ivh","label":"IVH","type":"select","options":[""," with intraventricular extension"],"default":""}]', 30),
  ('CECT Abdomen', 'Appendicitis', 'The appendix is dilated ({diameter} mm) with mural thickening and periappendiceal fat stranding{abscess}.', 'Acute appendicitis.', 'Surgical correlation.', '', 'acute_abd', '[{"key":"diameter","label":"Diameter (mm)","type":"text","default":"10"},{"key":"abscess","label":"Collection","type":"select","options":[""," with periappendiceal collection"],"default":""}]', 10),
  ('CECT Abdomen', 'Cholecystitis', 'Gallbladder wall thickening with pericholecystic fluid and fat stranding. Stones {stones}.', 'Acute cholecystitis.', 'Surgical / GI correlation.', '', 'biliary', '[{"key":"stones","label":"Stones","type":"select","options":["present","not clearly seen"],"default":"present"}]', 20),
  ('CECT Abdomen', 'Normal study', 'No acute abdominal pathology. Solid organs, bowel, and vasculature appear unremarkable within the limits of this study.', 'No acute CT abnormality.', 'Clinical correlation.', '', '', '[]', 5),
  ('CT Chest Plain', 'Normal chest CT', 'Lungs are clear. No suspicious nodule, consolidation, or pleural effusion. Mediastinum and hila are unremarkable.', 'Normal non-contrast chest CT.', 'Clinical correlation.', '', '', '[]', 5),
  ('X-Ray Chest PA', 'Normal chest', 'The heart size is within normal limits. Lungs are clear. Costophrenic angles are sharp. No focal consolidation, collapse, or pleural effusion.', 'Normal chest radiograph.', 'Clinical correlation.', '', 'chest_opacity', '[]', 5),
  ('X-Ray Knee AP/Lat', 'OA knee', 'Degenerative changes in the {side} knee with joint-space narrowing ({compartment}), osteophytes, and subchondral sclerosis.', '{side} knee osteoarthritis ({compartment}).', 'Orthopaedic correlation.', '', 'msk_knee', '[{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right"},{"key":"compartment","label":"Compartment","type":"select","options":["medial","lateral","patellofemoral","tricompartmental"],"default":"medial"}]', 10),
  ('X-Ray Knee AP/Lat', 'Normal knee', 'Alignment is maintained. Joint spaces are preserved. No fracture, dislocation, or significant effusion.', 'Normal knee radiographs.', 'Clinical correlation.', '', 'msk_knee', '[]', 5),
  ('X-Ray Lumbar Spine', 'Degenerative lumbar', 'Lumbar spondylosis with disc-space narrowing at {levels} and marginal osteophytes. No acute fracture.', 'Lumbar degenerative disc disease ({levels}).', 'Clinical correlation. MRI if radiculopathy persists.', '', 'spine', '[{"key":"levels","label":"Levels","type":"text","default":"L4-L5 / L5-S1"}]', 10),
  ('X-Ray Lumbar Spine', 'Normal lumbar spine', 'Vertebral heights and alignment are maintained. Disc spaces are preserved. No acute fracture or destructive lesion.', 'Normal lumbar spine radiographs.', 'Clinical correlation.', '', 'spine', '[]', 5)
) AS v(study_type, label, finding_text, impression_text, recommendation_text, suggests, conflict_group, questions_json, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM radiology_quick_findings q
  WHERE q.study_type = v.study_type AND q.label = v.label
);

INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order)
SELECT v.study_type, v.label, v.template_text, v.unit, v.sort_order
FROM (VALUES
  ('X-Ray Knee AP/Lat', 'Joint space', 'Medial joint space {value} mm.', 'mm', 10),
  ('X-Ray Lumbar Spine', 'Canal diameter', 'AP canal diameter {value} mm.', 'mm', 10)
) AS v(study_type, label, template_text, unit, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM radiology_quick_measurements m
  WHERE m.study_type = v.study_type AND m.label = v.label
);
