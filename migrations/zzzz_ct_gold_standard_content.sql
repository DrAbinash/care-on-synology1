-- CARE CT Gold Standard — LIVE clinical content for the core CT studies.
-- Seeds the SAME tables the Reporting Workspace already reads
-- (radiology_study_tabs / radiology_protocols / radiology_quick_findings /
-- radiology_clinical_history_chips / radiology_quick_measurements), keyed by the
-- CT study_type. No reporting code. The Knowledge Pack loader assembles these
-- live for each CT pack.
--
-- Fully idempotent: every INSERT uses ON CONFLICT DO NOTHING against the same
-- unique keys the base migrations defined (study_tabs.name,
-- quick_findings/quick_measurements (study_type,label), protocols.name,
-- clinical_history_chips (study_type,display_label)).

-- ── Study tabs (CT regions; sort_order 900+ groups CT after MRI/USG) ──────────
INSERT INTO radiology_study_tabs (name, sort_order) VALUES
  ('CT Brain Plain', 900), ('CT Brain Contrast', 901), ('CT Stroke', 902), ('CT Perfusion', 903),
  ('CT Angiography Brain', 904), ('CT Orbit', 905), ('CT PNS', 906), ('CT Temporal Bone', 907),
  ('CT Neck', 908), ('CT Facial Bones', 909), ('CT Mandible', 910), ('CT Chest Plain', 911),
  ('HRCT Chest', 912), ('CT Pulmonary Angiography', 913), ('CT Abdomen Plain', 914), ('CECT Abdomen', 915),
  ('CT KUB', 916), ('CT Urography', 917), ('CT Pelvis', 918), ('CT Whole Abdomen', 919),
  ('CT Cervical Spine', 920), ('CT Dorsal Spine', 921), ('CT Lumbar Spine', 922), ('CT Whole Spine', 923),
  ('CT Trauma', 924), ('CT Oncology Follow-up', 925)
ON CONFLICT (name) DO NOTHING;

-- ── Protocols ────────────────────────────────────────────────────────────────
INSERT INTO radiology_protocols (name, study_type, modality, technique_text, normal_text, recommendation_text, required_measurements, checklist_json, is_default, is_gold_standard, sort_order) VALUES
  ('CT Brain Plain', 'CT Brain Plain', 'CT',
   'Axial non-contrast CT of the brain was performed from the skull base to the vertex with contiguous sections, reviewed on brain, blood, and bone windows.',
   'No acute intracranial hemorrhage, territorial infarct, extra-axial collection, or mass lesion. Grey-white matter differentiation is preserved. Ventricles and basal cisterns are normal. No midline shift. No fracture on bone windows.',
   'Clinical correlation is advised. MRI brain is recommended if clinical suspicion for acute infarct or posterior fossa pathology persists.',
   'Midline shift,Hemorrhage volume', '["Parenchyma / grey-white differentiation","Hemorrhage (site, volume)","Infarct / mass effect","Midline shift","Ventricles / cisterns / hydrocephalus","Extra-axial collections","Bone window (fracture)"]', TRUE, TRUE, 900),
  ('CT Stroke Protocol', 'CT Stroke', 'CT',
   'Non-contrast CT brain performed as part of the acute stroke protocol, reviewed with narrow stroke windows for early ischemic change and ASPECTS scoring; hemorrhage explicitly assessed.',
   'No acute intracranial hemorrhage. No established territorial infarct. No hyperdense vessel sign. ASPECTS 10. Grey-white differentiation preserved.',
   'Urgent stroke-team correlation. CT angiography and perfusion recommended if large-vessel occlusion is suspected and the patient is within the intervention window.',
   'ASPECTS,Infarct size', '["Hemorrhage excluded","Early ischemic change / ASPECTS","Hyperdense vessel sign","Established infarct","Mass effect"]', TRUE, TRUE, 902),
  ('CT Angiography Brain', 'CT Angiography Brain', 'CT',
   'CT angiography of the intracranial circulation was performed following intravenous contrast with bolus tracking, reconstructed as axial thin sections, MIP and 3D-VR images of the circle of Willis.',
   'The intracranial arteries are normal in caliber and course with no aneurysm, significant stenosis, occlusion, or dissection. No arteriovenous malformation.',
   'Neurosurgical / neuro-interventional correlation for any aneurysm. DSA correlation as clinically indicated.',
   'Aneurysm diameter,Stenosis degree', '["Circle of Willis vessels","Aneurysm (site, neck, dome)","Stenosis / occlusion","Dissection","AVM / AV fistula"]', TRUE, TRUE, 904),
  ('CT PNS (Coronal)', 'CT PNS', 'CT',
   'Thin-section CT of the paranasal sinuses was performed with coronal and axial reconstructions on bone and soft-tissue windows.',
   'The paranasal sinuses, ostiomeatal complexes, and nasal cavities are clear and well aerated. The osteomeatal units are patent bilaterally. Nasal septum is central. No bony erosion or expansion.',
   'ENT correlation. FESS planning as clinically indicated.',
   'Mucosal thickening', '["Frontal / ethmoid / maxillary / sphenoid sinuses","Mucosal thickening vs opacification","OMC patency","Anatomical variants (concha bullosa, Haller/Onodi cell)","Bony erosion / expansion","Nasal septum / turbinates"]', TRUE, TRUE, 906),
  ('HRCT Temporal Bone', 'CT Temporal Bone', 'CT',
   'High-resolution CT of the temporal bones was performed with sub-millimetre axial sections and coronal reconstructions on a bone algorithm.',
   'The external auditory canals, middle-ear cavities, and mastoid air cells are clear. The ossicular chain is intact. The scutum, tegmen, and labyrinthine structures are normal. No bony erosion.',
   'ENT / otology correlation. Non-echo-planar DWI MRI recommended if cholesteatoma is suspected.',
   '', '["EAC / middle ear / mastoid aeration","Ossicular chain","Scutum / Prussak space","Tegmen / labyrinthine fistula","Facial nerve canal"]', TRUE, TRUE, 907),
  ('CT Chest Plain', 'CT Chest Plain', 'CT',
   'CT of the thorax was performed with contiguous sections reviewed on lung and mediastinal windows.',
   'The lungs are clear with no nodule, mass, consolidation, or interstitial abnormality. No pleural or pericardial effusion. The mediastinum is normal with no lymphadenopathy. The visualized airways are patent. No bony lesion.',
   'Fleischner Society follow-up is advised for any incidental pulmonary nodule per size and risk category. Contrast CT is recommended for further mediastinal characterization if indicated.',
   'Nodule size,Lymph node size', '["Lungs (nodule / mass / consolidation)","Interstitial pattern","Airways","Pleura / effusion","Mediastinum / nodes","Bones"]', TRUE, TRUE, 911),
  ('HRCT Chest', 'HRCT Chest', 'CT',
   'High-resolution CT of the chest was performed with thin sections at full inspiration (with expiratory and prone sequences where indicated) reviewed on lung windows.',
   'Normal lung parenchymal attenuation with no ground-glass opacity, reticulation, honeycombing, traction bronchiectasis, or nodularity. No air trapping. No significant pleural abnormality.',
   'Pulmonology / ILD-MDT correlation. Correlate with pulmonary function tests and serology. Follow-up HRCT to assess for progression as advised.',
   'Extent of fibrosis', '["Ground-glass / reticulation","Honeycombing","Traction bronchiectasis","Distribution (upper/lower, central/peripheral)","Air trapping","UIP vs non-UIP pattern"]', TRUE, TRUE, 912),
  ('CT Pulmonary Angiography', 'CT Pulmonary Angiography', 'CT',
   'CT pulmonary angiography was performed following intravenous contrast timed to the pulmonary arterial phase, reviewed on dedicated PE and lung windows.',
   'The pulmonary arteries are well opacified to the subsegmental level with no filling defect to suggest pulmonary thromboembolism. No right-heart strain (RV:LV ratio < 1). Main pulmonary artery is normal in caliber. Lungs are clear.',
   'Clinical correlation and management per pulmonary embolism protocol. Echocardiography is advised if right-heart strain is present.',
   'RV:LV ratio,Pulmonary artery diameter', '["Pulmonary arteries to subsegmental level","Filling defect (level, saddle)","RV:LV ratio / right-heart strain","Main PA diameter","Lung infarct","Incidental lung findings"]', TRUE, TRUE, 913),
  ('CECT Abdomen', 'CECT Abdomen', 'CT',
   'Contrast-enhanced CT of the abdomen was performed following intravenous contrast in the portal venous phase (with arterial and delayed phases where indicated), reviewed on soft-tissue windows with multiplanar reconstructions.',
   'The liver, spleen, pancreas, adrenals, and kidneys are normal in size and attenuation with no focal lesion. The gallbladder and biliary tree are unremarkable. The bowel loops are normal in caliber with no wall thickening or obstruction. No free fluid, free air, collection, or lymphadenopathy. The abdominal aorta and its branches are normal.',
   'Clinical correlation is advised. MRI / MRCP is recommended for further hepatobiliary or pancreatic characterization if indicated. Ultrasound correlation is advised for the gallbladder.',
   'Lesion size,Lymph node size', '["Liver (lesions, LI-RADS)","Biliary / gallbladder","Pancreas","Spleen / adrenals","Kidneys / urinary tract","Bowel (obstruction, ischemia, appendix)","Vessels (aorta, mesenteric, portal)","Nodes / free fluid / collections"]', TRUE, TRUE, 915),
  ('CT KUB (Stone Protocol)', 'CT KUB', 'CT',
   'Non-contrast CT of the kidneys, ureters, and bladder was performed with thin contiguous sections and coronal reconstructions on a stone protocol.',
   'Both kidneys are normal in size, position, and attenuation with no calculus or hydronephrosis. The ureters are non-dilated to the vesicoureteric junctions. The urinary bladder is unremarkable. No perinephric or periureteric fat stranding.',
   'Urology correlation is advised for an obstructing or large calculus. Emergency referral is recommended if there is an infected obstructed system. Follow-up KUB is advised to confirm stone passage.',
   'Stone size,Hydronephrosis grade', '["Both kidneys","Calculi (side, level, size mm, density HU)","Hydronephrosis grade","Ureters to VUJ","Urinary bladder","Perinephric / periureteric stranding"]', TRUE, TRUE, 916),
  ('CT Urography', 'CT Urography', 'CT',
   'CT urography was performed with unenhanced, nephrographic, and excretory phases (split-bolus where used) reviewed with multiplanar and MIP reconstructions of the urinary tract.',
   'The kidneys enhance and excrete symmetrically. No renal or urothelial mass, calculus, or filling defect. The pelvicalyceal systems, ureters, and bladder opacify normally with no filling defect or wall thickening.',
   'Urology correlation and cystoscopy are advised for any urothelial filling defect. Follow-up as per protocol.',
   'Lesion size', '["Renal parenchyma / masses","Pelvicalyceal system","Ureters (filling defects)","Bladder wall / lesions","Excretion symmetry"]', TRUE, TRUE, 917),
  ('CT Cervical Spine', 'CT Cervical Spine', 'CT',
   'CT of the cervical spine was performed with thin axial sections and sagittal / coronal reconstructions on bone and soft-tissue windows.',
   'Normal cervical vertebral alignment and vertebral body heights. No fracture or dislocation. The atlanto-axial and atlanto-occipital relationships are normal. The spinal canal is of normal caliber with no significant stenosis. Prevertebral soft tissues are normal.',
   'Maintain spinal precautions until clinically and radiologically cleared. MRI is recommended for suspected cord or ligamentous injury.',
   'Vertebral body height,Canal diameter', '["Alignment / listhesis","Vertebral body heights","Fracture (level, type, stability)","Retropulsion / canal compromise","Atlanto-axial relationship","Facet joints","Prevertebral soft tissue"]', TRUE, TRUE, 920),
  ('CT Lumbar Spine', 'CT Lumbar Spine', 'CT',
   'CT of the lumbar spine was performed with thin axial sections and sagittal / coronal reconstructions on bone and soft-tissue windows.',
   'Normal lumbar alignment and vertebral body heights. No fracture. No significant spinal canal or neural foraminal stenosis. The pars interarticularis are intact. No spondylolisthesis.',
   'MRI is recommended for disc, cord/cauda equina, and marrow assessment where clinically indicated.',
   'Vertebral body height,Canal diameter,Listhesis', '["Alignment / spondylolisthesis (Meyerding)","Vertebral body heights / fracture","Pars defect","Canal diameter / stenosis","Neural foramina","Facet arthropathy"]', TRUE, TRUE, 922),
  ('CT Trauma (Polytrauma)', 'CT Trauma', 'CT',
   'Contrast-enhanced whole-body trauma CT was performed per the polytrauma protocol with arterial and portal venous phases and multiplanar reconstructions.',
   'No acute intracranial injury. No cervical spine fracture. No pneumothorax, hemothorax, or aortic injury. Solid abdominal viscera are intact with no laceration, hematoma, or active extravasation. No free fluid or free air. No unstable pelvic fracture.',
   'Immediate trauma-surgery correlation is advised for any active hemorrhage or high-grade solid-organ injury. Angioembolization referral where appropriate.',
   'Laceration size,Hematoma size', '["Head / C-spine","Chest (pneumo/hemothorax, aorta)","Solid organs (AAST grade)","Active extravasation","Bowel / mesentery","Pelvis (stability, bleed)","Vascular injury"]', TRUE, TRUE, 924),
  ('CT Oncology Follow-up', 'CT Oncology Follow-up', 'CT',
   'Contrast-enhanced CT was performed for oncologic response assessment and compared with the prior study, using RECIST 1.1 methodology with the same target lesions where identifiable.',
   'Target and non-target lesions are measured and compared with the prior examination. No new lesion. Findings are assessed per RECIST 1.1.',
   'Report the RECIST 1.1 response category. Oncology / MDT correlation is advised. Compare against baseline and nadir.',
   'Target lesion sum,Largest lesion size', '["Target lesions (sum of diameters)","Non-target lesions","New lesions","Nodal short-axis","RECIST 1.1 category","Comparison vs baseline and nadir"]', TRUE, TRUE, 925)
ON CONFLICT (name) DO NOTHING;

-- ── Quick findings (with structured questionsJson + suggests for Companion) ───
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, recommendation_text, suggests, conflict_group, questions_json, sort_order) VALUES
  ('CT Brain Plain', 'Intracranial Hemorrhage', 'An acute intraparenchymal hemorrhage is noted in the {location}, measuring approximately {volume} ml (ABC/2). {mass_effect}', 'Acute {location} intracranial hemorrhage.', 'Immediate neurosurgical correlation. Follow-up CT to assess for expansion.', 'Midline Shift, Intraventricular Extension, Hydrocephalus', '', '[{"key":"location","label":"Location","type":"text","default":""},{"key":"volume","label":"Volume (ml, ABC/2)","type":"text","default":""},{"key":"mass_effect","label":"Mass effect","type":"select","options":["No significant mass effect.","With surrounding edema and mass effect."],"default":"No significant mass effect."}]', 10),
  ('CT Brain Plain', 'Acute Infarct', 'Loss of grey-white differentiation with hypodensity in the {territory} vascular territory, in keeping with an acute infarct. ASPECTS {aspects}.', 'Acute {territory} territory infarct.', 'Urgent stroke-team correlation. MRI DWI for confirmation and extent.', 'Midline Shift, Hemorrhagic Transformation', '', '[{"key":"territory","label":"Territory","type":"select","options":["right MCA","left MCA","right ACA","left ACA","right PCA","left PCA","posterior fossa"],"default":"right MCA"},{"key":"aspects","label":"ASPECTS","type":"text","default":""}]', 20),
  ('CT Brain Plain', 'Midline Shift', 'There is midline shift of {shift} mm to the {side}.', 'Midline shift of {shift} mm.', 'Immediate neurosurgical correlation.', '', '', '[{"key":"shift","label":"Shift (mm)","type":"text","default":""},{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right"}]', 30),
  ('CT Brain Plain', 'Hydrocephalus', 'Dilatation of the {ventricles} with features suggesting {type} hydrocephalus.', '{type} hydrocephalus.', 'Neurosurgical correlation.', '', '', '[{"key":"ventricles","label":"Ventricles","type":"text","default":"lateral and third ventricles"},{"key":"type","label":"Type","type":"select","options":["obstructive","communicating"],"default":"obstructive"}]', 40),
  ('CT Brain Plain', 'Normal Study', 'No acute intracranial abnormality. Preserved grey-white differentiation, normal ventricles and cisterns, no midline shift or hemorrhage.', 'No acute intracranial abnormality.', 'Clinical correlation.', '', '', '[]', 90),
  ('CT KUB', 'Renal Calculus', 'A calculus is noted in the {side} {location}, measuring {size} mm with density of {hu} HU.', '{side} {location} calculus ({size} mm).', 'Urology correlation. Follow-up to confirm passage.', 'Hydronephrosis, Ureteric Calculus', '', '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"right"},{"key":"location","label":"Location","type":"select","options":["upper calyx","interpolar calyx","lower calyx","renal pelvis"],"default":"renal pelvis"},{"key":"size","label":"Size (mm)","type":"text","default":""},{"key":"hu","label":"Density (HU)","type":"text","default":""}]', 10),
  ('CT KUB', 'Ureteric Calculus', 'A calculus is noted in the {side} {level} ureter, measuring {size} mm, with upstream {side} hydroureteronephrosis.', '{side} {level} ureteric calculus with obstruction.', 'Urology correlation. Emergency referral if infected obstruction.', 'Hydronephrosis', '', '[{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right"},{"key":"level","label":"Level","type":"select","options":["proximal","mid","distal (VUJ)"],"default":"distal (VUJ)"},{"key":"size","label":"Size (mm)","type":"text","default":""}]', 20),
  ('CT KUB', 'Hydronephrosis', 'The {side} pelvicalyceal system is dilated, consistent with {grade} hydronephrosis.', '{side} {grade} hydronephrosis.', 'Correlate with renal function; urology referral if obstructing.', '', '', '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"right"},{"key":"grade","label":"Grade","type":"select","options":["mild","moderate","gross"],"default":"mild"}]', 30),
  ('CT KUB', 'Normal Study', 'Both kidneys are normal with no calculus or hydronephrosis. Ureters are non-dilated. Bladder is unremarkable.', 'No renal or ureteric calculus. No hydronephrosis.', 'Clinical correlation.', '', '', '[]', 90),
  ('HRCT Chest', 'UIP Pattern', 'Basal and subpleural predominant reticulation with honeycombing and traction bronchiectasis, in keeping with a UIP pattern.', 'UIP pattern — correlate for idiopathic pulmonary fibrosis.', 'ILD-MDT correlation. PFTs and serology.', 'Honeycombing, Traction Bronchiectasis', 'ild_pattern', '[]', 10),
  ('HRCT Chest', 'Honeycombing', 'Clustered subpleural cystic air spaces with shared walls, in keeping with honeycombing, most marked in the {zone} zones.', 'Honeycombing ({zone} predominant).', 'ILD-MDT correlation.', '', '', '[{"key":"zone","label":"Zone","type":"select","options":["lower","upper","mid"],"default":"lower"}]', 20),
  ('HRCT Chest', 'Ground-glass Opacities', 'Patchy ground-glass opacities are noted in a {distribution} distribution.', 'Ground-glass opacities.', 'Correlate clinically; consider active inflammation/infection.', '', 'ild_pattern', '[{"key":"distribution","label":"Distribution","type":"text","default":"bilateral"}]', 30),
  ('HRCT Chest', 'Bronchiectasis', 'Bronchial dilatation with lack of tapering, in keeping with {type} bronchiectasis in the {zone} zones.', '{type} bronchiectasis.', 'Correlate clinically; sputum culture as indicated.', '', '', '[{"key":"type","label":"Type","type":"select","options":["traction","cylindrical","varicose","cystic"],"default":"cylindrical"},{"key":"zone","label":"Zone","type":"text","default":"lower"}]', 40),
  ('CECT Abdomen', 'Acute Appendicitis', 'The appendix is dilated to {diameter} mm with wall thickening and periappendiceal fat stranding. {appendicolith} {collection}', 'Acute appendicitis.', 'Surgical correlation.', '', '', '[{"key":"diameter","label":"Diameter (mm)","type":"text","default":""},{"key":"appendicolith","label":"Appendicolith","type":"select","options":["No appendicolith.","An appendicolith is present."],"default":"No appendicolith."},{"key":"collection","label":"Collection","type":"select","options":["No periappendiceal collection.","With a periappendiceal collection."],"default":"No periappendiceal collection."}]', 10),
  ('CECT Abdomen', 'Liver Lesion', 'A lesion is noted in segment {segment} of the liver, measuring {size} mm, showing {enhancement}.', 'Segment {segment} hepatic lesion ({size} mm).', 'MRI / MRCP for characterization. LI-RADS categorization if at-risk.', '', '', '[{"key":"segment","label":"Segment","type":"text","default":""},{"key":"size","label":"Size (mm)","type":"text","default":""},{"key":"enhancement","label":"Enhancement","type":"select","options":["arterial hyperenhancement with washout","peripheral discontinuous nodular enhancement","no significant enhancement"],"default":"no significant enhancement"}]', 20),
  ('CECT Abdomen', 'Bowel Obstruction', 'Dilated {bowel} loops with a transition point in the {location}. {ischemia}', '{bowel} obstruction.', 'Surgical correlation.', '', '', '[{"key":"bowel","label":"Bowel","type":"select","options":["small bowel","large bowel"],"default":"small bowel"},{"key":"location","label":"Transition point","type":"text","default":""},{"key":"ischemia","label":"Ischemia","type":"select","options":["No features of ischemia.","With features suggesting ischemia."],"default":"No features of ischemia."}]', 30),
  ('CT Pulmonary Angiography', 'Pulmonary Embolism', 'A filling defect is noted in the {level} pulmonary artery/arteries. {saddle} RV:LV ratio {rvlv}.', 'Pulmonary thromboembolism ({level}).', 'Anticoagulation per protocol. Echocardiography if right-heart strain.', '', '', '[{"key":"level","label":"Level","type":"select","options":["main","right main","left main","lobar","segmental","subsegmental"],"default":"segmental"},{"key":"saddle","label":"Saddle","type":"select","options":["","A saddle embolus is present."],"default":""},{"key":"rvlv","label":"RV:LV ratio","type":"text","default":""}]', 10),
  ('CT Cervical Spine', 'Vertebral Fracture', 'A fracture is noted involving the {level} vertebra with {height_loss}% body-height loss{retropulsion}. The injury is considered {stability}.', '{level} vertebral fracture ({stability}).', 'Spine-surgery correlation. MRI for cord/ligamentous injury.', '', '', '[{"key":"level","label":"Level","type":"text","default":""},{"key":"height_loss","label":"Height loss (%)","type":"text","default":""},{"key":"retropulsion","label":"Retropulsion","type":"select","options":[""," with retropulsion and canal compromise"],"default":""},{"key":"stability","label":"Stability","type":"select","options":["stable","unstable"],"default":"stable"}]', 10)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Clinical history chips ───────────────────────────────────────────────────
INSERT INTO radiology_clinical_history_chips (study_type, display_label, inserted_text, sort_order, is_system, is_active) VALUES
  ('CT Brain Plain', 'Trauma / head injury', 'History of head injury.', 10, TRUE, TRUE),
  ('CT Brain Plain', 'Altered sensorium', 'Altered sensorium.', 20, TRUE, TRUE),
  ('CT Brain Plain', 'Seizure', 'Seizure.', 30, TRUE, TRUE),
  ('CT Brain Plain', 'Headache', 'Headache.', 40, TRUE, TRUE),
  ('CT Stroke', 'Acute focal deficit', 'Acute onset focal neurological deficit.', 10, TRUE, TRUE),
  ('CT Stroke', 'Time of onset', 'Symptom onset at ___ (last known well).', 20, TRUE, TRUE),
  ('CT KUB', 'Renal colic', 'Acute flank pain / renal colic.', 10, TRUE, TRUE),
  ('CT KUB', 'Hematuria', 'Hematuria.', 20, TRUE, TRUE),
  ('CT KUB', 'Known calculus', 'Known urolithiasis, follow-up.', 30, TRUE, TRUE),
  ('HRCT Chest', 'Breathlessness', 'Progressive breathlessness.', 10, TRUE, TRUE),
  ('HRCT Chest', 'Chronic cough', 'Chronic cough.', 20, TRUE, TRUE),
  ('HRCT Chest', 'Known ILD', 'Known interstitial lung disease, follow-up.', 30, TRUE, TRUE),
  ('CT Pulmonary Angiography', 'Suspected PE', 'Suspected pulmonary embolism (dyspnea / chest pain).', 10, TRUE, TRUE),
  ('CECT Abdomen', 'Pain abdomen', 'Pain abdomen.', 10, TRUE, TRUE),
  ('CECT Abdomen', 'Suspected appendicitis', 'Right iliac fossa pain, suspected appendicitis.', 20, TRUE, TRUE),
  ('CT Chest Plain', 'Lung nodule follow-up', 'Pulmonary nodule follow-up.', 10, TRUE, TRUE),
  ('CT Cervical Spine', 'Neck trauma', 'Neck trauma / cervical spine injury.', 10, TRUE, TRUE),
  ('CT Trauma', 'Polytrauma', 'Polytrauma / road traffic accident.', 10, TRUE, TRUE),
  ('CT Oncology Follow-up', 'Response assessment', 'Known malignancy, on treatment — response assessment.', 10, TRUE, TRUE)
ON CONFLICT (study_type, display_label) DO NOTHING;

-- ── Quick measurements ───────────────────────────────────────────────────────
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('CT Brain Plain', 'Midline shift', 'Midline shift of {value} mm.', 'mm', 10),
  ('CT Brain Plain', 'Hemorrhage volume', 'Hemorrhage volume approximately {value} ml (ABC/2).', 'ml', 20),
  ('CT Brain Plain', 'Ventricle (bicaudate index)', 'Bicaudate index {value}.', '', 30),
  ('CT KUB', 'Stone size', 'Calculus measures {value} mm.', 'mm', 10),
  ('CT KUB', 'Stone density', 'Calculus density {value} HU.', 'HU', 20),
  ('HRCT Chest', 'Nodule size', 'Nodule measures {value} mm.', 'mm', 10),
  ('CT Chest Plain', 'Nodule size', 'Nodule measures {value} mm.', 'mm', 10),
  ('CT Chest Plain', 'Lymph node (short axis)', 'Largest node measures {value} mm in short axis.', 'mm', 20),
  ('CT Pulmonary Angiography', 'RV:LV ratio', 'RV:LV ratio {value}.', '', 10),
  ('CT Pulmonary Angiography', 'Main PA diameter', 'Main pulmonary artery {value} mm.', 'mm', 20),
  ('CECT Abdomen', 'Appendix diameter', 'Appendix measures {value} mm in diameter.', 'mm', 10),
  ('CECT Abdomen', 'Lesion size', 'Lesion measures {value} mm.', 'mm', 20),
  ('CT Angiography Brain', 'Aneurysm size', 'Aneurysm measures {value} mm.', 'mm', 10),
  ('CT Cervical Spine', 'Canal diameter', 'AP spinal canal diameter {value} mm.', 'mm', 10),
  ('CT Cervical Spine', 'Vertebral height loss', 'Vertebral body height loss {value}%.', '%', 20),
  ('CT Lumbar Spine', 'Canal diameter', 'AP spinal canal diameter {value} mm.', 'mm', 10),
  ('CT Oncology Follow-up', 'Target lesion sum', 'Sum of target lesion diameters {value} mm.', 'mm', 10)
ON CONFLICT (study_type, label) DO NOTHING;
