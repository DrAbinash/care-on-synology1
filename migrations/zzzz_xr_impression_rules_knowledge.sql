-- CARE X-Ray Gold Standard — Copilot impression rules + Knowledge Base articles.
--
-- Two live stores, both keyed as DATA (no reporting code):
--   1. radiology_impression_rules — deterministic Copilot rules, keyed by
--      builder_type ({field, operator, value} conditions the existing impression
--      engine understands). Extremity trauma studies SHARE the xr_extremity
--      builder, so one rule set covers shoulder/elbow/wrist/hand/knee/ankle/foot
--      etc. These are the pack "Copilot Rules" as data — a rule fires only when
--      its condition matches; its generated_text is the gold-standard phrasing.
--   2. radiology_knowledge_base — X-Ray reference articles (CTR, Cobb, fracture
--      description, tube position, Ottawa rules, classification systems).
--
-- Neither table has a unique constraint, so idempotency is enforced with
-- INSERT ... SELECT ... WHERE NOT EXISTS on the natural key. Safe to re-run.
-- Named zzzz_ so it sorts AFTER every base + z* schema migration.

-- ── 1. Copilot impression rules (deterministic, per X-Ray builder_type) ──────
INSERT INTO radiology_impression_rules (rule_name, builder_type, conditions, generated_text, priority, severity, version, is_active)
SELECT v.rule_name, v.builder_type, v.conditions::jsonb, v.generated_text, v.priority, v.severity, 'v1.0', TRUE
FROM (VALUES
  -- Chest
  ('Tension pneumothorax', 'xr_chest',
   '[{"field":"pneumothorax","operator":"equals","value":"tension"}]',
   'Tension pneumothorax with mediastinal shift — a radiological emergency. Immediate clinical correlation and decompression are advised.', 'critical', 'severe'),
  ('Pneumothorax', 'xr_chest',
   '[{"field":"pneumothorax","operator":"equals","value":"present"}]',
   'Pneumothorax. Clinical correlation is advised; assess for tension and manage per protocol.', 'urgent', 'severe'),
  ('Large pleural effusion', 'xr_chest',
   '[{"field":"effusion","operator":"equals","value":"large"}]',
   'Large pleural effusion. Clinical correlation and ultrasound-guided aspiration are advised.', 'urgent', 'moderate'),
  ('Consolidation', 'xr_chest',
   '[{"field":"consolidation","operator":"equals","value":"present"}]',
   'Airspace consolidation, likely infective in the appropriate clinical setting. Clinical correlation and a follow-up radiograph after treatment are advised.', 'normal', 'moderate'),
  ('Cardiomegaly with edema', 'xr_chest',
   '[{"field":"cardiomegaly","operator":"equals","value":"present"},{"field":"edema","operator":"equals","value":"present"}]',
   'Cardiomegaly with pulmonary edema. Clinical and echocardiographic correlation are advised.', 'urgent', 'moderate'),
  ('Misplaced ET tube', 'xr_chest',
   '[{"field":"etTube","operator":"equals","value":"malpositioned"}]',
   'The endotracheal tube is malpositioned. Immediate correlation and repositioning before use are advised.', 'critical', 'severe'),
  ('Misplaced NG tube', 'xr_chest',
   '[{"field":"ngTube","operator":"equals","value":"malpositioned"}]',
   'The nasogastric tube is malpositioned; do not use until repositioned and confirmed radiographically.', 'critical', 'severe'),
  -- Abdomen
  ('Pneumoperitoneum', 'xr_abdomen',
   '[{"field":"freeAir","operator":"equals","value":"present"}]',
   'Free subdiaphragmatic gas indicating pneumoperitoneum — likely perforation. Urgent surgical correlation and CT are advised.', 'critical', 'severe'),
  ('Bowel obstruction', 'xr_abdomen',
   '[{"field":"obstruction","operator":"equals","value":"present"}]',
   'Features of bowel obstruction. Surgical correlation and CT for level and cause are advised.', 'urgent', 'severe'),
  -- KUB
  ('Radio-opaque calculus', 'xr_kub',
   '[{"field":"calculus","operator":"equals","value":"present"}]',
   'Radio-opaque urinary calculus. Ultrasound for hydronephrosis and CT KUB for confirmation are advised; urology correlation.', 'normal', 'moderate'),
  -- Pelvis / hip
  ('Neck-of-femur fracture', 'xr_pelvis',
   '[{"field":"nofFracture","operator":"equals","value":"present"}]',
   'Neck-of-femur fracture. Urgent orthopaedic referral is advised; MRI if the radiograph is normal but a fracture is clinically suspected.', 'critical', 'severe'),
  ('Pelvic ring fracture', 'xr_pelvis',
   '[{"field":"pelvicRing","operator":"equals","value":"unstable"}]',
   'Pelvic ring fracture with more than one break, indicating instability. Urgent orthopaedic correlation and CT are advised.', 'critical', 'severe'),
  -- Extremity (shared)
  ('Fracture', 'xr_extremity',
   '[{"field":"fracture","operator":"equals","value":"present"}]',
   'Fracture as described. Orthopaedic correlation is advised; CT for intra-articular or complex fractures.', 'urgent', 'moderate'),
  ('Dislocation', 'xr_extremity',
   '[{"field":"dislocation","operator":"equals","value":"present"}]',
   'Joint dislocation. Orthopaedic correlation and reduction are advised, with a post-reduction film.', 'urgent', 'severe'),
  ('Lipohaemarthrosis (occult fracture)', 'xr_extremity',
   '[{"field":"lipohaemarthrosis","operator":"equals","value":"present"}]',
   'A lipohaemarthrosis indicates an intra-articular fracture even if the fracture line is not directly visible. Orthopaedic correlation and CT are advised.', 'urgent', 'moderate'),
  ('Osteoarthritis', 'xr_extremity',
   '[{"field":"osteoarthritis","operator":"equals","value":"present"}]',
   'Osteoarthritic change. Clinical correlation and orthopaedic opinion as indicated.', 'normal', 'mild'),
  -- Cervical spine
  ('Cervical fracture / instability', 'xr_cervical_spine',
   '[{"field":"injury","operator":"equals","value":"present"}]',
   'Cervical spine injury. Maintain spinal precautions; CT cervical spine and MRI for cord/ligamentous injury are advised.', 'critical', 'severe'),
  ('Prevertebral soft-tissue widening', 'xr_cervical_spine',
   '[{"field":"prevertebral","operator":"equals","value":"widened"}]',
   'Prevertebral soft-tissue widening may indicate an occult cervical injury. CT correlation is advised.', 'urgent', 'moderate'),
  -- Dorsal spine
  ('Compression fracture', 'xr_dorsal_spine',
   '[{"field":"compression","operator":"equals","value":"present"}]',
   'Vertebral compression fracture. MRI is advised to age the fracture and assess the cord; DEXA if osteoporotic.', 'urgent', 'moderate'),
  -- Lumbar spine
  ('Spondylolisthesis', 'xr_lumbar_spine',
   '[{"field":"listhesis","operator":"equals","value":"present"}]',
   'Spondylolisthesis. MRI for canal and neural assessment and flexion-extension views for instability are advised.', 'normal', 'moderate'),
  -- Whole spine
  ('Scoliosis requiring referral', 'xr_whole_spine',
   '[{"field":"cobb","operator":"greater_than","value":25}]',
   'Scoliosis with a Cobb angle exceeding 25 degrees. Orthopaedic (scoliosis) referral and serial standing whole-spine films are advised.', 'normal', 'moderate'),
  -- Skull
  ('Depressed skull fracture', 'xr_skull',
   '[{"field":"fracture","operator":"equals","value":"depressed"}]',
   'Depressed skull fracture. CT head and neurosurgical correlation are advised.', 'critical', 'severe'),
  -- Soft tissue neck
  ('Airway foreign body / compromise', 'xr_neck',
   '[{"field":"foreignBody","operator":"equals","value":"airway"}]',
   'Radio-opaque airway foreign body. Urgent ENT / airway correlation is advised.', 'critical', 'severe'),
  ('Retropharyngeal abscess', 'xr_neck',
   '[{"field":"prevertebral","operator":"equals","value":"widened"}]',
   'Retropharyngeal soft-tissue widening raising the possibility of a collection. Urgent ENT correlation and CT neck are advised.', 'urgent', 'severe')
) AS v(rule_name, builder_type, conditions, generated_text, priority, severity)
WHERE NOT EXISTS (
  SELECT 1 FROM radiology_impression_rules r
  WHERE r.rule_name = v.rule_name AND r.builder_type = v.builder_type
);

-- ── 2. Knowledge Base articles (X-Ray references) ────────────────────────────
INSERT INTO radiology_knowledge_base
  (category, title, content, classification_system, classification_grades, measurement_references, reporting_tips, tags, is_active)
SELECT v.category, v.title, v.content, v.classification_system,
       v.classification_grades::jsonb, v.measurement_references::jsonb, v.reporting_tips::jsonb, v.tags::jsonb, TRUE
FROM (VALUES
  ('Chest', 'Cardiothoracic ratio (CTR)',
   'On an erect PA chest radiograph the cardiothoracic ratio is the maximal transverse cardiac diameter divided by the maximal internal thoracic diameter. A ratio above 0.5 suggests cardiomegaly. The ratio is overestimated on AP, supine, and paediatric films and in poor inspiration, so cardiac size should not be judged on those projections.',
   NULL, '[]', '["CTR < 0.5 normal (erect PA)","CTR > 0.5 cardiomegaly"]',
   '["Measure only on an erect PA at good inspiration","Do not assess cardiac size on AP/supine films"]',
   '["chest","CTR","cardiomegaly"]'),
  ('Chest', 'ET and NG tube position',
   'The ideal endotracheal tube tip lies about 5 (+/- 2) cm above the carina with the neck neutral; too low risks endobronchial intubation, too high risks accidental extubation. A safe nasogastric tube passes in the midline, bisects the carina, crosses the diaphragm, and has its tip in the stomach at least 10 cm beyond the gastro-oesophageal junction; a tube that deviates into a bronchus or coils in the oesophagus must not be used.',
   NULL, '[]', '["ET tip 5 +/- 2 cm above the carina","NG tip in the stomach, >10 cm beyond the GOJ"]',
   '["ET tip 5 +/- 2 cm above the carina","NG tube must cross the diaphragm in the midline, tip in stomach"]',
   '["chest","ET tube","NG tube","lines","ICU"]'),
  ('Chest', 'Pneumothorax on chest radiograph',
   'A pneumothorax appears as a visceral pleural line with absent lung markings peripherally. On supine films it may show only as a deep, lucent costophrenic sulcus (deep sulcus sign). Tension is a clinical diagnosis suggested radiologically by mediastinal shift away from the affected side, ipsilateral diaphragmatic depression, and rib splaying — a decompression emergency.',
   NULL, '[]', '[]',
   '["Look for the visceral pleural line and absent peripheral markings","Deep sulcus sign on supine films","Mediastinal shift = tension"]',
   '["chest","pneumothorax","tension","emergency"]'),
  ('Abdomen', 'Bowel dilatation and obstruction (plain film)',
   'On an abdominal radiograph small-bowel dilatation is suggested above 3 cm (central loops, valvulae conniventes crossing the full width), large bowel above 6 cm, and the caecum above 9 cm. Multiple air-fluid levels in a step-ladder pattern on the erect film support mechanical obstruction; free subdiaphragmatic gas on an erect film indicates perforation.',
   NULL, '["Small bowel >3 cm","Large bowel >6 cm","Caecum >9 cm"]', '["Small bowel > 3 cm","Large bowel > 6 cm","Caecum > 9 cm"]',
   '["Correlate supine dilatation with erect air-fluid levels","Always check for free subdiaphragmatic gas"]',
   '["abdomen","obstruction","perforation","erect"]'),
  ('MSK', 'Describing a fracture',
   'A complete fracture description states: bone and location (which third / articular surface), pattern (transverse, oblique, spiral, comminuted, greenstick), displacement (of the distal fragment, in bone widths), angulation (apex direction and degrees), rotation, shortening, intra-articular extension, and whether the fracture is open or closed. Always assess the joint above and below.',
   NULL, '[]', '[]',
   '["Describe displacement of the DISTAL fragment","State intra-articular extension and open vs closed","Image the joint above and below"]',
   '["MSK","fracture","trauma","description"]'),
  ('MSK', 'Ottawa ankle and knee rules',
   'Clinical decision rules that select which acute injuries need radiographs. Ankle films are indicated for pain in the malleolar zone with bony tenderness at the posterior edge/tip of either malleolus or an inability to bear weight for four steps; foot films for midfoot-zone pain with tenderness at the navicular or base of the 5th metatarsal or inability to bear weight.',
   'Ottawa rules', '[]', '[]',
   '["Apply to acute injuries to justify radiography","Assess weight-bearing and specific bony tenderness"]',
   '["MSK","ankle","knee","Ottawa","trauma"]'),
  ('MSK', 'Weber (Danis-Weber) ankle classification',
   'Classifies lateral malleolar (distal fibular) fractures by the level relative to the tibiotalar syndesmosis: Weber A (below, usually stable), B (at the level, variable stability), C (above, usually unstable with syndesmotic injury). Assess mortise symmetry and the medial clear space for instability.',
   'Weber', '["A (below syndesmosis)","B (at syndesmosis)","C (above syndesmosis)"]', '[]',
   '["Locate the fibular fracture relative to the syndesmosis","Check mortise symmetry / medial clear space"]',
   '["MSK","ankle","Weber","fracture"]'),
  ('MSK', 'Garden classification (neck-of-femur fracture)',
   'Grades intracapsular femoral neck fractures: I (incomplete/valgus impacted), II (complete, undisplaced), III (complete, partially displaced), IV (complete, fully displaced). Displaced fractures (III-IV) carry a higher risk of avascular necrosis and often warrant arthroplasty.',
   'Garden', '["I","II","III","IV"]', '[]',
   '["State intra- vs extracapsular and Garden grade","Displaced fractures risk AVN"]',
   '["MSK","hip","Garden","NOF"]'),
  ('Spine', 'Cobb angle (scoliosis)',
   'The Cobb angle quantifies a scoliotic curve as the angle between lines drawn along the endplates of the most tilted (end) vertebrae of the curve. A curve above 10 degrees defines scoliosis; bracing is generally considered above ~25 degrees in a skeletally immature patient and surgery above ~45-50 degrees. Use the same end-vertebrae on follow-up to measure progression.',
   'Cobb', '[">10 deg scoliosis","~25 deg brace threshold","~45-50 deg surgical"]', '["> 10 deg = scoliosis","~25 deg brace","~45-50 deg surgical"]',
   '["Measure from the same end-vertebrae as prior","Report apex and convexity","State Risser grade for maturity"]',
   '["spine","scoliosis","Cobb","whole spine"]'),
  ('Spine', 'Genant grading of vertebral compression',
   'A semiquantitative grading of vertebral compression fractures by the percentage of vertebral body height loss: grade 1 (mild, 20-25%), grade 2 (moderate, 25-40%), grade 3 (severe, >40%). Anterior wedge, biconcave, and crush morphologies are distinguished.',
   'Genant', '["1 mild (20-25%)","2 moderate (25-40%)","3 severe (>40%)"]', '["1: 20-25% height loss","2: 25-40%","3: >40%"]',
   '["State the percentage height loss","Distinguish wedge / biconcave / crush"]',
   '["spine","compression fracture","Genant"]'),
  ('Spine', 'Cervical prevertebral soft tissue',
   'On a lateral cervical spine radiograph the prevertebral soft tissue should measure roughly less than 7 mm at C2 and less than 22 mm at C6 (about one-third of a vertebral body width above C4 and a full body width below). Widening can be the only sign of an occult fracture or haematoma.',
   NULL, '[]', '["< 7 mm at C2","< 22 mm at C6"]',
   '["Assess prevertebral soft tissue on a true lateral","Widening may be the only sign of injury"]',
   '["spine","cervical","prevertebral","trauma"]'),
  ('Spine', 'Meyerding grading of spondylolisthesis',
   'Grades anterior slip of one vertebral body on the one below as a percentage of the AP diameter of the inferior body: I (0-25%), II (26-50%), III (51-75%), IV (76-100%), V (spondyloptosis, >100%). Flexion-extension views assess mobility/instability.',
   'Meyerding', '["I (0-25%)","II (26-50%)","III (51-75%)","IV (76-100%)","V (>100%)"]', '[]',
   '["Grade the slip as a percentage of the inferior body","Assess mobility on flexion-extension"]',
   '["spine","spondylolisthesis","Meyerding"]'),
  ('Head & Neck', 'Soft-tissue neck: epiglottitis and croup',
   'On a lateral soft-tissue neck radiograph, a swollen epiglottis and aryepiglottic folds produce the thumb sign of acute epiglottitis (an airway emergency); on the frontal view, subglottic narrowing produces the steeple sign of croup. Retropharyngeal soft-tissue widening suggests an abscess.',
   NULL, '[]', '[]',
   '["Thumb sign = epiglottitis (do not distress the child)","Steeple sign = croup","Assess prevertebral width for abscess"]',
   '["head and neck","airway","epiglottitis","croup","foreign body"]')
) AS v(category, title, content, classification_system, classification_grades, measurement_references, reporting_tips, tags)
WHERE NOT EXISTS (
  SELECT 1 FROM radiology_knowledge_base k
  WHERE k.category = v.category AND k.title = v.title
);
