-- CARE CT Gold Standard — Copilot impression rules + Knowledge Base articles.
--
-- Two live stores, both keyed as DATA (no reporting code):
--   1. radiology_impression_rules — deterministic Copilot rules, keyed by
--      builder_type, using the {field, operator, value} condition shape the
--      existing impression engine understands (radiologySmartEngine.ts /
--      /api/radiology/smart/impression-rules). These are the pack "Copilot
--      Rules" as data — they never hallucinate; a rule fires only when its
--      condition matches, and its generated_text is the gold-standard phrasing.
--   2. radiology_knowledge_base — reference articles (classification systems,
--      measurement references, reporting tips) the Knowledge Base panel and the
--      pack "Knowledge Base" section surface.
--
-- Neither table has a unique constraint, so idempotency is enforced with
-- INSERT ... SELECT ... WHERE NOT EXISTS on the natural key
-- ((rule_name, builder_type) and (category, title) respectively). Safe to
-- re-run. Named zzzz_ so it sorts AFTER every base + z* schema migration that
-- creates these tables/columns (feature migrations run alphabetically).

-- ── 1. Copilot impression rules (deterministic, per CT builder_type) ─────────
INSERT INTO radiology_impression_rules (rule_name, builder_type, conditions, generated_text, priority, severity, version, is_active)
SELECT v.rule_name, v.builder_type, v.conditions::jsonb, v.generated_text, v.priority, v.severity, 'v1.0', TRUE
FROM (VALUES
  -- CT Brain
  ('Acute intracranial hemorrhage', 'ct_brain',
   '[{"field":"hemorrhage","operator":"equals","value":"present"}]',
   'Acute intracranial hemorrhage. Immediate neurosurgical correlation is advised; a follow-up CT is recommended to assess for expansion.', 'critical', 'severe'),
  ('Acute infarct', 'ct_brain',
   '[{"field":"infarct","operator":"equals","value":"acute"}]',
   'Acute infarct. Urgent stroke-team correlation is advised; MRI with DWI is recommended for confirmation and to define extent.', 'urgent', 'severe'),
  ('Midline shift / mass effect', 'ct_brain',
   '[{"field":"massEffect","operator":"equals","value":"present"}]',
   'Mass effect with midline shift. Immediate neurosurgical correlation is advised.', 'critical', 'severe'),
  ('Hydrocephalus', 'ct_brain',
   '[{"field":"hydrocephalus","operator":"equals","value":"present"}]',
   'Features of hydrocephalus. Neurosurgical correlation is advised.', 'urgent', 'moderate'),
  -- CT Stroke
  ('Large-vessel occlusion territory', 'ct_stroke',
   '[{"field":"aspects","operator":"less_than","value":6}]',
   'Extensive early ischemic change (ASPECTS < 6). Urgent stroke-team correlation; CT angiography and perfusion are advised to assess for large-vessel occlusion within the intervention window.', 'urgent', 'severe'),
  ('Hemorrhage excluded before thrombolysis', 'ct_stroke',
   '[{"field":"hemorrhage","operator":"equals","value":"absent"}]',
   'No intracranial hemorrhage identified. If clinically eligible and within the therapeutic window, thrombolysis may be considered per protocol.', 'normal', 'moderate'),
  -- CT KUB
  ('Obstructing ureteric calculus', 'ct_kub',
   '[{"field":"uretericCalculus","operator":"equals","value":"present"},{"field":"hydronephrosis","operator":"equals","value":"present"}]',
   'Obstructing ureteric calculus with upstream hydronephrosis. Urology correlation is advised; emergency referral is recommended if there are features of an infected obstructed system.', 'urgent', 'severe'),
  ('Large renal calculus', 'ct_kub',
   '[{"field":"stoneSize","operator":"greater_than","value":6}]',
   'Renal calculus larger than 6 mm — spontaneous passage is less likely and urology correlation is advised.', 'normal', 'moderate'),
  -- HRCT Chest
  ('UIP pattern', 'ct_hrct',
   '[{"field":"pattern","operator":"equals","value":"uip"}]',
   'Imaging features are in keeping with a UIP pattern. ILD-MDT correlation with pulmonary function tests and serology is advised.', 'normal', 'moderate'),
  ('Acute exacerbation of ILD', 'ct_hrct',
   '[{"field":"newGroundGlass","operator":"equals","value":"present"}]',
   'New widespread ground-glass opacity superimposed on background fibrosis raises the possibility of an acute exacerbation or superimposed infection. Urgent clinical correlation is advised.', 'urgent', 'severe'),
  -- CECT Abdomen
  ('Acute appendicitis', 'ct_abdomen',
   '[{"field":"appendixDiameter","operator":"greater_than","value":6}]',
   'Features are in keeping with acute appendicitis. Surgical correlation is advised.', 'urgent', 'moderate'),
  ('Bowel ischemia / closed loop', 'ct_abdomen',
   '[{"field":"ischemia","operator":"equals","value":"present"}]',
   'Features suggesting bowel ischemia. Immediate surgical correlation is advised.', 'critical', 'severe'),
  ('LI-RADS at-risk hepatic lesion', 'ct_abdomen',
   '[{"field":"liverLesion","operator":"equals","value":"present"}]',
   'Hepatic lesion in an at-risk liver — categorize per LI-RADS. MRI / MRCP is advised for further characterization.', 'normal', 'moderate'),
  -- CTPA
  ('Central pulmonary embolism', 'ct_pulmonary_angiography',
   '[{"field":"peLevel","operator":"includes","value":["main","saddle","lobar"]}]',
   'Central pulmonary thromboembolism. Anticoagulation per protocol is advised; assess for right-heart strain (RV:LV ratio) and consider echocardiography.', 'critical', 'severe'),
  ('Right-heart strain', 'ct_pulmonary_angiography',
   '[{"field":"rvlvRatio","operator":"greater_than","value":1}]',
   'Right-heart strain (RV:LV ratio > 1). Urgent clinical correlation and echocardiography are advised.', 'urgent', 'severe'),
  -- CT Cervical Spine
  ('Unstable cervical fracture', 'ct_cervical_spine',
   '[{"field":"stability","operator":"equals","value":"unstable"}]',
   'Unstable cervical spine fracture. Maintain spinal precautions; urgent spine-surgery / neurosurgical correlation and MRI for cord and ligamentous injury are advised.', 'critical', 'severe'),
  -- CT Trauma
  ('Active contrast extravasation', 'ct_trauma',
   '[{"field":"extravasation","operator":"equals","value":"present"}]',
   'Active contrast extravasation indicating ongoing hemorrhage. Immediate trauma-surgery activation and consideration of angioembolization are advised.', 'critical', 'severe'),
  ('High-grade solid-organ injury', 'ct_trauma',
   '[{"field":"aastGrade","operator":"greater_equal","value":4}]',
   'High-grade solid-organ injury (AAST grade IV or higher). Immediate trauma-surgery correlation is advised.', 'critical', 'severe'),
  -- CT PNS
  ('Complicated sinusitis', 'ct_pns',
   '[{"field":"bonyErosion","operator":"equals","value":"present"}]',
   'Bony erosion with possible orbital or intracranial extension. Urgent ENT correlation is advised; MRI is recommended if fungal or neoplastic disease is suspected.', 'urgent', 'severe'),
  -- CT Temporal Bone
  ('Cholesteatoma with ossicular erosion', 'ct_temporal_bone',
   '[{"field":"ossicularErosion","operator":"equals","value":"present"}]',
   'Middle-ear soft tissue with ossicular erosion, suspicious for cholesteatoma. ENT / otology correlation and non-echo-planar DWI MRI are advised.', 'urgent', 'moderate'),
  -- CT Oncology Follow-up
  ('RECIST progressive disease', 'ct_oncology_followup',
   '[{"field":"recist","operator":"equals","value":"pd"}]',
   'Progressive disease by RECIST 1.1 (target-lesion sum increased by 20% or a new lesion). Oncology / MDT correlation is advised.', 'urgent', 'moderate')
) AS v(rule_name, builder_type, conditions, generated_text, priority, severity)
WHERE NOT EXISTS (
  SELECT 1 FROM radiology_impression_rules r
  WHERE r.rule_name = v.rule_name AND r.builder_type = v.builder_type
);

-- ── 2. Knowledge Base articles (CT classification systems + references) ──────
INSERT INTO radiology_knowledge_base
  (category, title, content, classification_system, classification_grades, measurement_references, reporting_tips, tags, is_active)
SELECT v.category, v.title, v.content, v.classification_system,
       v.classification_grades::jsonb, v.measurement_references::jsonb, v.reporting_tips::jsonb, v.tags::jsonb, TRUE
FROM (VALUES
  ('Brain', 'ASPECTS (Alberta Stroke Program Early CT Score)',
   'A 10-point topographic score for early ischemic change in the anterior (MCA) circulation on non-contrast CT. One point is subtracted from 10 for each involved region (caudate, lentiform, insula, internal capsule, M1-M6). A score of ≥ 6 generally favours a better outcome after reperfusion therapy; < 6 indicates a large established core.',
   'ASPECTS', '["10 = normal","7-9 = limited early ischemia","<6 = large ischemic core"]',
   '["Score each of the 10 anterior-circulation regions","Report the total score for anterior-circulation stroke"]',
   '["Compare with the contralateral hemisphere","Use narrow stroke windows"]',
   '["stroke","CT brain","ASPECTS","infarct"]'),
  ('Brain', 'Intracerebral hemorrhage volume (ABC/2)',
   'A rapid bedside estimate of ellipsoid hematoma volume: volume (ml) = (A × B × C) / 2, where A and B are the largest perpendicular diameters on the slice of maximal hemorrhage and C is the number of slices with hemorrhage multiplied by slice thickness (cm). Volume > 30 ml carries a worse prognosis.',
   NULL, '[]',
   '["A × B × C / 2 in cm gives ml","Report volume for any parenchymal hemorrhage"]',
   '["State midline shift in mm","Note intraventricular extension and hydrocephalus"]',
   '["hemorrhage","ABC/2","CT brain","volume"]'),
  ('Chest', 'Fleischner Society 2017 pulmonary nodule guidelines',
   'Management recommendations for incidentally detected pulmonary nodules based on size, morphology (solid vs subsolid), number, and patient risk. Solid nodules < 6 mm in low-risk patients need no routine follow-up; larger or subsolid nodules require interval CT surveillance or tissue sampling depending on category.',
   'Fleischner 2017', '["Solid <6mm","Solid 6-8mm","Solid >8mm","Subsolid <6mm","Subsolid >=6mm"]',
   '["Report the largest nodule size in mm","Classify solid vs part-solid vs ground-glass"]',
   '["State size, morphology, and Fleischner category","Give the recommended follow-up interval"]',
   '["chest","nodule","Fleischner","follow-up"]'),
  ('Chest', 'UIP pattern (Fleischner / ATS-ERS)',
   'The usual interstitial pattern is defined by subpleural, basal-predominant reticulation with honeycombing (± traction bronchiectasis) and an absence of features suggesting an alternative diagnosis. HRCT patterns are categorized as UIP, probable UIP, indeterminate for UIP, or an alternative diagnosis, which guides the need for biopsy in suspected IPF.',
   'UIP (ATS/ERS)', '["UIP","Probable UIP","Indeterminate for UIP","Alternative diagnosis"]',
   '["Assess distribution (basal, subpleural)","Look for honeycombing and traction bronchiectasis"]',
   '["State the pattern category explicitly","Comment on honeycombing and traction bronchiectasis"]',
   '["HRCT","ILD","UIP","fibrosis"]'),
  ('Chest', 'Pulmonary embolism — RV strain (CTPA)',
   'On CT pulmonary angiography, right-ventricular strain is suggested by an RV:LV short-axis diameter ratio > 1.0, interventricular septal bowing, and contrast reflux into the IVC/hepatic veins. It identifies higher-risk (submassive) PE and prompts echocardiographic and clinical correlation.',
   NULL, '[]',
   '["Measure RV and LV maximal short-axis diameters on axial images","RV:LV > 1 indicates strain","Main PA > 29 mm suggests pulmonary hypertension"]',
   '["State the most proximal level of embolus","Report the RV:LV ratio"]',
   '["CTPA","pulmonary embolism","RV strain"]'),
  ('Abdomen', 'LI-RADS (CT/MRI, HCC risk)',
   'The Liver Imaging Reporting and Data System categorizes observations in at-risk patients (cirrhosis, chronic HBV) from LR-1 (definitely benign) to LR-5 (definitely HCC), plus LR-M (probably malignant, non-HCC-specific) and LR-TIV (tumour in vein). Major features include size, arterial-phase hyperenhancement, washout, capsule, and threshold growth.',
   'LI-RADS', '["LR-1","LR-2","LR-3","LR-4","LR-5","LR-M","LR-TIV"]',
   '["Measure the observation in mm","Assess APHE, washout, capsule, threshold growth"]',
   '["Apply only to at-risk patients","State the LI-RADS category"]',
   '["abdomen","liver","LI-RADS","HCC"]'),
  ('Abdomen', 'Bosniak classification of renal cysts',
   'A CT/MRI classification of cystic renal masses (I, II, IIF, III, IV) by wall/septal thickness, calcification, and enhancement that stratifies malignant risk and guides follow-up versus surgery. Category IIF warrants surveillance; III and IV are surgical.',
   'Bosniak', '["I","II","IIF","III","IV"]',
   '["Assess septal number/thickness and enhancement","Measure wall thickness"]',
   '["State the Bosniak category","Recommend surveillance for IIF, surgery for III/IV"]',
   '["abdomen","renal cyst","Bosniak"]'),
  ('Abdomen', 'CT severity index (acute pancreatitis)',
   'The modified CT severity index combines pancreatic inflammation, necrosis, and extrapancreatic complications into a 0–10 score that correlates with morbidity. Necrosis and organized collections are key prognostic features.',
   'Modified CTSI', '["0-2 mild","4-6 moderate","8-10 severe"]',
   '["Grade peripancreatic inflammation and collections","Estimate percentage of necrosis"]',
   '["State the presence and extent of necrosis","Report collections and their maturity"]',
   '["abdomen","pancreatitis","CTSI"]'),
  ('Abdomen', 'Urolithiasis on CT KUB',
   'Non-contrast CT is the reference standard for urolithiasis. Report each calculus by side, level (calyx / renal pelvis / PUJ / mid-ureter / VUJ), size in mm, and density in HU, together with the presence and grade of hydronephrosis and secondary signs (perinephric stranding, rim sign). Stones > 6 mm are less likely to pass spontaneously.',
   NULL, '["Hydronephrosis: mild / moderate / gross"]',
   '["Size in mm and density in HU per calculus","Grade hydronephrosis","State hydroureter level"]',
   '["Report each stone by side, level, size, density","State perinephric stranding"]',
   '["abdomen","KUB","calculus","hydronephrosis"]'),
  ('Spine', 'AO Spine / SLIC (cervical trauma)',
   'The AO Spine and Subaxial Injury Classification (SLIC) systems grade cervical spine injuries by morphology, disco-ligamentous integrity, and neurology to guide operative versus non-operative management. Increasing scores indicate greater instability.',
   'AO Spine / SLIC', '["Compression","Burst","Distraction","Translation/rotation"]',
   '["Assess vertebral body height loss and retropulsion","Report canal compromise in mm"]',
   '["State fracture stability","Recommend MRI for cord and ligamentous injury"]',
   '["spine","trauma","AO Spine","SLIC"]'),
  ('Spine', 'Meyerding grading of spondylolisthesis',
   'Grades anterior slip of one vertebral body on the one below as a percentage of the AP diameter of the inferior body: Grade I (0–25%), II (26–50%), III (51–75%), IV (76–100%), V (spondyloptosis, > 100%).',
   'Meyerding', '["I (0-25%)","II (26-50%)","III (51-75%)","IV (76-100%)","V (>100%)"]',
   '["Measure slip as a percentage of the inferior body AP diameter","Report the AP canal diameter"]',
   '["State the level and Meyerding grade","Note any pars defect"]',
   '["spine","spondylolisthesis","Meyerding"]'),
  ('Abdomen', 'RECIST 1.1 (oncologic response)',
   'Response Evaluation Criteria in Solid Tumours: select up to 5 target lesions (max 2 per organ, ≥ 10 mm; nodes ≥ 15 mm short axis), sum their longest diameters, and categorize response as complete (CR), partial (PR, ≥ 30% decrease), stable (SD), or progressive disease (PD, ≥ 20% increase over nadir or a new lesion).',
   'RECIST 1.1', '["CR","PR","SD","PD"]',
   '["Sum longest diameters of target lesions","Nodes measured by short axis"]',
   '["Use the same target lesions as prior","Compare against baseline AND nadir","State the response category"]',
   '["abdomen","oncology","RECIST","follow-up"]'),
  ('Head & Neck', 'Lund-Mackay staging (paranasal sinuses)',
   'A CT scoring system for chronic rhinosinusitis: each sinus group (maxillary, anterior ethmoid, posterior ethmoid, sphenoid, frontal) and each ostiomeatal complex is scored per side (0 = clear, 1 = partial, 2 = complete opacification; OMC 0 or 2), for a maximum of 24.',
   'Lund-Mackay', '["0 = clear","1 = partial opacification","2 = complete opacification"]',
   '["Score each sinus group per side","Score OMC as 0 or 2"]',
   '["Comment on OMC patency before FESS","Note anatomical variants (concha bullosa, Haller/Onodi cell)"]',
   '["head and neck","PNS","Lund-Mackay","sinusitis"]'),
  ('Abdomen', 'AAST solid-organ injury scale',
   'The American Association for the Surgery of Trauma organ injury scale grades hepatic, splenic, and renal injuries from I to V by laceration depth, hematoma size, and vascular involvement. Active contrast extravasation and high grades (IV–V) favour angioembolization or surgery.',
   'AAST', '["I","II","III","IV","V"]',
   '["Measure laceration depth and hematoma size","Identify active extravasation"]',
   '["Grade each injured organ by AAST","Explicitly state active extravasation"]',
   '["abdomen","trauma","AAST","laceration"]')
) AS v(category, title, content, classification_system, classification_grades, measurement_references, reporting_tips, tags)
WHERE NOT EXISTS (
  SELECT 1 FROM radiology_knowledge_base k
  WHERE k.category = v.category AND k.title = v.title
);
