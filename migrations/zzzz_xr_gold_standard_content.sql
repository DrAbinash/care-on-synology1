-- CARE X-Ray Gold Standard — LIVE clinical content for the core X-Ray studies.
-- Seeds the SAME tables the Reporting Workspace already reads
-- (radiology_study_tabs / radiology_protocols / radiology_quick_findings /
-- radiology_clinical_history_chips / radiology_quick_measurements), keyed by the
-- X-Ray study_type. No reporting code. The Knowledge Pack loader assembles these
-- live for each X-Ray pack.
--
-- Reporting philosophy: X-Ray is DESCRIPTIVE — measurements are seeded ONLY
-- where they are standard practice (CTR, Cobb, vertebral height, joint space,
-- stone size, prevertebral soft tissue). Descriptive packs mark "measurements"
-- not-applicable in their manifest so readiness is not penalized.
--
-- Fully idempotent: every INSERT uses ON CONFLICT DO NOTHING against the same
-- unique keys the base migrations defined (study_tabs.name,
-- quick_findings/quick_measurements (study_type,label), protocols.name,
-- clinical_history_chips (study_type,display_label)).

-- ── Study tabs (X-Ray regions; sort_order 950+ groups X-Ray after CT) ─────────
INSERT INTO radiology_study_tabs (name, sort_order) VALUES
  ('X-Ray Chest PA', 950), ('X-Ray Chest AP', 951), ('X-Ray Portable Chest', 952), ('X-Ray Chest Lateral', 953),
  ('X-Ray Ribs', 954), ('X-Ray Sternum', 955), ('X-Ray Abdomen AP', 956), ('X-Ray Erect Abdomen', 957),
  ('X-Ray KUB', 958), ('X-Ray Pelvis AP', 959), ('X-Ray Hip', 960), ('X-Ray Femur', 961),
  ('X-Ray Knee', 962), ('X-Ray Leg', 963), ('X-Ray Ankle', 964), ('X-Ray Foot', 965),
  ('X-Ray Shoulder', 966), ('X-Ray Clavicle', 967), ('X-Ray Scapula', 968), ('X-Ray Humerus', 969),
  ('X-Ray Elbow', 970), ('X-Ray Forearm', 971), ('X-Ray Wrist', 972), ('X-Ray Hand', 973),
  ('X-Ray Finger', 974), ('X-Ray Thumb', 975), ('X-Ray Cervical Spine', 976), ('X-Ray Dorsal Spine', 977),
  ('X-Ray Lumbar Spine', 978), ('X-Ray Whole Spine', 979), ('X-Ray Sacrum', 980), ('X-Ray Coccyx', 981),
  ('X-Ray Skull', 982), ('X-Ray Facial Bones', 983), ('X-Ray Nasal Bones', 984), ('X-Ray Mandible', 985),
  ('X-Ray TM Joint', 986), ('X-Ray Paranasal Sinuses', 987), ('X-Ray Mastoid', 988), ('X-Ray Soft Tissue Neck', 989)
ON CONFLICT (name) DO NOTHING;

-- ── Protocols (enabled studies) ──────────────────────────────────────────────
INSERT INTO radiology_protocols (name, study_type, modality, technique_text, normal_text, recommendation_text, required_measurements, checklist_json, is_default, is_gold_standard, sort_order) VALUES
  ('X-Ray Chest PA', 'X-Ray Chest PA', 'XR',
   'Erect PA view of the chest at full inspiration.',
   'The lung fields are clear with no focal consolidation, mass, or interstitial abnormality. No pleural effusion or pneumothorax. The cardiac silhouette is normal in size (cardiothoracic ratio within normal limits). The mediastinum and hila are unremarkable. The visualized bony thorax and soft tissues are normal. The diaphragm and costophrenic angles are clear.',
   'Clinical correlation is advised. A chest CT is recommended for further characterization of any suspicious or persistent finding.',
   'Cardiothoracic ratio', '["Lung fields (consolidation/mass/nodule)","Interstitial pattern","Pleura (effusion/pneumothorax)","Cardiac size / CTR","Mediastinum / hila","Bones / soft tissues","Diaphragm / costophrenic angles"]', TRUE, TRUE, 950),
  ('X-Ray Chest AP', 'X-Ray Chest AP', 'XR',
   'AP view of the chest (supine / paediatric / limited-mobility technique).',
   'Allowing for AP projection and magnification, the lung fields are clear. No large effusion or pneumothorax. The cardiac size cannot be accurately assessed on the AP projection. The mediastinum is central.',
   'An erect PA view is advised for accurate assessment of cardiac size and small effusions. Clinical correlation is advised.',
   '', '["Lung fields","Pleura","Cardiac silhouette (AP caveat)","Mediastinum","Lines / tubes if present"]', TRUE, TRUE, 951),
  ('X-Ray Portable Chest', 'X-Ray Portable Chest', 'XR',
   'Supine AP portable chest radiograph performed at the bedside.',
   'The endotracheal tube tip, if present, projects in a satisfactory position above the carina. Any nasogastric tube projects below the diaphragm with the tip in the stomach. No large effusion, pneumothorax, or new focal consolidation. Allowing for supine technique, the cardiomediastinal contour is unremarkable.',
   'Correlation for any malpositioned tube or line before use is advised. Repeat imaging after repositioning as indicated.',
   '', '["ET tube tip (5 +/- 2 cm above carina)","NG tube (below diaphragm, midline, tip in stomach)","Central line tip (cavoatrial junction)","Pneumothorax","New opacity (consolidation/collapse/effusion/edema)","Cardiomediastinal contour"]', TRUE, TRUE, 952),
  ('X-Ray Abdomen AP', 'X-Ray Abdomen AP', 'XR',
   'Supine AP view of the abdomen.',
   'The bowel gas pattern is unremarkable with no abnormally dilated loops. No abnormal calcification or radio-opaque calculus. No abnormal extraluminal gas. The visualized bony structures and soft tissues are unremarkable.',
   'An erect abdomen / erect chest is advised if perforation or obstruction is suspected. Clinical correlation is advised.',
   '', '["Bowel gas pattern / dilated loops","Calcification / calculi","Abnormal / extraluminal gas","Solid organ outlines","Bones / soft tissues"]', TRUE, TRUE, 956),
  ('X-Ray Erect Abdomen', 'X-Ray Erect Abdomen', 'XR',
   'Erect view of the abdomen (with erect chest where indicated).',
   'No abnormal air-fluid levels or dilated bowel loops to suggest obstruction. No free subdiaphragmatic gas to suggest perforation. No abnormal calcification.',
   'Surgical correlation is advised for suspected obstruction or perforation. A CT abdomen is recommended for confirmation and to establish the cause.',
   '', '["Air-fluid levels (number / step-ladder)","Free subdiaphragmatic gas","Dilated loops (small vs large bowel)","Calcification"]', TRUE, TRUE, 957),
  ('X-Ray KUB', 'X-Ray KUB', 'XR',
   'Plain radiograph of the kidneys, ureters, and bladder.',
   'No radio-opaque calculus is seen along the expected course of the urinary tract. The renal outlines, where visible, are unremarkable. No abnormal calcification.',
   'Ultrasound KUB is advised to assess for hydronephrosis. A CT KUB (stone protocol) is recommended for radiolucent calculi and accurate sizing. Urology correlation is advised.',
   'Stone size', '["Renal outlines","Radio-opaque calculi (side, level, size)","Ureteric course","Bladder region","Phlebolith vs calculus"]', TRUE, TRUE, 958),
  ('X-Ray Pelvis AP', 'X-Ray Pelvis AP', 'XR',
   'AP view of the pelvis.',
   'The pelvic ring is intact with no fracture or diastasis. Both hip joints are congruent with preserved joint spaces and intact Shenton lines. The visualized proximal femora and sacrum are unremarkable. No aggressive bony lesion.',
   'Orthopaedic correlation is advised for any fracture. A CT pelvis is recommended for acetabular or complex ring injury. MRI is advised for a clinically suspected but radiographically occult neck-of-femur fracture.',
   '', '["Pelvic ring (all break points)","Both hips / Shenton lines","Acetabula","Proximal femora","Sacrum / SI joints","Bone lesion"]', TRUE, TRUE, 959),
  ('X-Ray Hip', 'X-Ray Hip', 'XR',
   'AP and lateral views of the hip.',
   'The hip joint is congruent with a preserved joint space and an intact Shenton line. No fracture or dislocation. No features of avascular necrosis. The visualized proximal femur and acetabulum are unremarkable.',
   'Urgent orthopaedic referral is advised for any fracture or dislocation. MRI is recommended for an occult neck-of-femur fracture or early avascular necrosis.',
   '', '["Neck of femur (intra/extracapsular, displacement)","Shenton line","Joint space","AVN (crescent sign/collapse)","Acetabulum"]', TRUE, TRUE, 960),
  ('X-Ray Knee', 'X-Ray Knee', 'XR',
   'AP and lateral views of the knee (with additional views where indicated).',
   'No fracture or dislocation. The joint spaces are preserved with no significant osteoarthritic change. No joint effusion or lipohaemarthrosis. The visualized bones and soft tissues are unremarkable.',
   'Orthopaedic correlation is advised for a fracture. A CT is recommended for tibial plateau assessment and MRI for suspected internal derangement.',
   'Joint space', '["Fracture (tibial plateau / patella / Segond)","Lipohaemarthrosis (fat-fluid level)","Joint spaces / OA (compartment)","Effusion","Alignment"]', TRUE, TRUE, 962),
  ('X-Ray Ankle', 'X-Ray Ankle', 'XR',
   'AP, mortise, and lateral views of the ankle.',
   'No fracture or dislocation. The ankle mortise is congruent with a symmetric medial clear space. No talar shift. Soft tissues are unremarkable.',
   'Orthopaedic correlation is advised for an unstable or displaced fracture. A CT is recommended for a complex or intra-articular fracture.',
   '', '["Malleoli (medial/lateral/posterior)","Weber level","Mortise symmetry / medial clear space","Talar shift","Soft-tissue swelling"]', TRUE, TRUE, 964),
  ('X-Ray Shoulder', 'X-Ray Shoulder', 'XR',
   'AP and axial / Y views of the shoulder.',
   'The glenohumeral joint is congruent with no dislocation. No fracture of the proximal humerus, clavicle, or scapula. The acromioclavicular joint is unremarkable.',
   'Orthopaedic correlation and reduction are advised for a dislocation, with a post-reduction film. A CT is recommended for a complex proximal humeral fracture.',
   '', '["Glenohumeral alignment (AP + axial/Y)","Dislocation (anterior/posterior)","Hill-Sachs / Bankart","Proximal humerus / greater tuberosity","Clavicle / ACJ / scapula"]', TRUE, TRUE, 966),
  ('X-Ray Wrist', 'X-Ray Wrist', 'XR',
   'PA and lateral views of the wrist (with scaphoid views where indicated).',
   'No fracture or dislocation. Normal carpal alignment with a preserved scapholunate interval. The distal radius and ulna are intact with normal volar tilt.',
   'Orthopaedic correlation is advised for a displaced or intra-articular fracture. MRI or a repeat film is recommended for a suspected occult scaphoid fracture.',
   '', '["Distal radius (Colles/Smith, intra-articular, tilt)","Ulnar styloid","Scaphoid / carpal bones","Scapholunate interval","Carpal alignment"]', TRUE, TRUE, 972),
  ('X-Ray Hand', 'X-Ray Hand', 'XR',
   'PA, oblique, and lateral views of the hand.',
   'No fracture or dislocation. The metacarpals and phalanges are intact with normal alignment. The joint spaces are preserved with no erosion or arthritic change. Soft tissues are unremarkable.',
   'Orthopaedic / hand correlation is advised for a displaced or rotated fracture. Rheumatology correlation is advised for an inflammatory arthropathy.',
   '', '["Metacarpals / phalanges (fracture, rotation)","Intra-articular extension","Joint spaces / erosions (distribution)","Soft-tissue swelling","Chondrocalcinosis"]', TRUE, TRUE, 973),
  ('X-Ray Cervical Spine', 'X-Ray Cervical Spine', 'XR',
   'AP, lateral, and open-mouth odontoid views of the cervical spine (adequacy requires C7-T1 visualization).',
   'Normal cervical alignment with intact anterior vertebral, posterior vertebral, and spinolaminar lines. No fracture or listhesis. The odontoid and atlanto-axial relationship are normal. The prevertebral soft tissues are of normal thickness. Disc spaces are preserved.',
   'Spinal precautions should be maintained until clinically and radiologically cleared. A CT cervical spine is recommended for a suspected or inadequately-imaged fracture, and MRI for cord or ligamentous injury.',
   'Prevertebral soft tissue', '["Adequacy (C7-T1 seen)","Three lines (alignment)","Fracture (incl. odontoid)","Atlanto-axial interval","Prevertebral soft tissue","Disc spaces / degeneration"]', TRUE, TRUE, 976),
  ('X-Ray Dorsal Spine', 'X-Ray Dorsal Spine', 'XR',
   'AP and lateral views of the dorsal (thoracic) spine.',
   'Normal thoracic alignment and vertebral body heights with a normal kyphotic curve. No compression fracture. Disc spaces are preserved. No aggressive bony lesion.',
   'MRI is recommended to age a compression fracture and assess the cord. Spinal / orthopaedic correlation is advised. DEXA is advised if an osteoporotic fracture is suspected.',
   'Vertebral body height', '["Alignment / kyphosis","Vertebral body heights (compression, % loss)","Disc spaces","Pedicles","Bone lesion"]', TRUE, TRUE, 977),
  ('X-Ray Lumbar Spine', 'X-Ray Lumbar Spine', 'XR',
   'AP and lateral views of the lumbar spine (with flexion-extension views where indicated).',
   'Normal lumbar alignment and vertebral body heights. No spondylolisthesis or pars defect. Disc spaces are preserved. No compression fracture. The sacroiliac joints, where visualized, are unremarkable.',
   'MRI is recommended for radiculopathy and canal, cord/cauda, or marrow assessment. Flexion-extension views are advised for suspected instability. Spinal correlation is advised.',
   'Vertebral body height,Listhesis', '["Alignment / spondylolisthesis (Meyerding)","Pars interarticularis","Vertebral heights / compression","Disc-space narrowing","Facet arthropathy","Transitional vertebra"]', TRUE, TRUE, 978),
  ('X-Ray Whole Spine (Scoliosis)', 'X-Ray Whole Spine', 'XR',
   'Standing full-length AP and lateral views of the whole spine for scoliosis assessment.',
   'The spine is normally aligned in the coronal plane with no scoliosis. Normal sagittal contour. Vertebral body heights are maintained. No congenital vertebral anomaly.',
   'An orthopaedic (scoliosis) referral is advised for a curve exceeding 25 degrees or one that is progressing. Serial standing whole-spine films with the same technique are advised to monitor progression.',
   'Cobb angle', '["Coronal alignment / scoliosis (Cobb, apex, direction)","Sagittal contour (kyphosis/lordosis)","Coronal / sagittal balance","Vertebral anomaly","Risser grade (skeletal maturity)"]', TRUE, TRUE, 979),
  ('X-Ray Skull', 'X-Ray Skull', 'XR',
   'AP and lateral views of the skull.',
   'No fracture. Normal skull vault and sutures. No abnormal lucency or sclerosis. The visualized sinuses and sella are unremarkable.',
   'A CT head is the investigation of choice for significant head injury. Neurosurgical correlation is advised for a depressed fracture.',
   '', '["Vault fracture (linear vs depressed)","Fracture vs suture / vascular groove","Lucent / sclerotic lesion","Sutures","Sella / sinuses"]', TRUE, TRUE, 982),
  ('X-Ray Soft Tissue Neck', 'X-Ray Soft Tissue Neck', 'XR',
   'Lateral (and AP) soft-tissue view of the neck in inspiration.',
   'The airway is patent and of normal calibre. The epiglottis and aryepiglottic folds are normal. The prevertebral soft tissues are of normal thickness. No radio-opaque foreign body.',
   'Urgent ENT / airway correlation is advised for stridor or suspected epiglottitis. A CT neck is recommended for an abscess or a radiolucent foreign body.',
   'Prevertebral soft tissue', '["Airway calibre","Epiglottis (thumb sign)","Subglottis (steeple sign)","Prevertebral soft tissue (abscess)","Radio-opaque foreign body"]', TRUE, TRUE, 989)
ON CONFLICT (name) DO NOTHING;

-- ── Quick findings (with structured questionsJson + suggests for Companion) ───
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, recommendation_text, suggests, conflict_group, questions_json, sort_order) VALUES
  -- Chest PA
  ('X-Ray Chest PA', 'Consolidation', 'There is {distribution} airspace opacification in the {zone}{air_bronchogram}.', '{zone} consolidation.', 'Clinical correlation. Follow-up radiograph after treatment to confirm resolution.', 'Pleural Effusion', 'chest_opacity', '[{"key":"distribution","label":"Distribution","type":"select","options":["lobar","patchy","diffuse"],"default":"patchy"},{"key":"zone","label":"Zone","type":"select","options":["right upper zone","right mid zone","right lower zone","left upper zone","left mid zone","left lower zone","bilateral"],"default":"right lower zone"},{"key":"air_bronchogram","label":"Air bronchogram","type":"select","options":[""," with air bronchograms"],"default":""}]', 10),
  ('X-Ray Chest PA', 'Pleural Effusion', 'There is a {side} pleural effusion with blunting of the costophrenic angle{size}.', '{side} pleural effusion.', 'Clinical correlation. Ultrasound is advised for volume estimation and to guide aspiration if indicated.', '', '', '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"right"},{"key":"size","label":"Size","type":"select","options":[" (small)"," (moderate)"," (large, with mediastinal shift)"],"default":" (small)"}]', 20),
  ('X-Ray Chest PA', 'Pneumothorax', 'There is a {side} pneumothorax{size}.{tension}', '{side} pneumothorax.', 'Clinical correlation. Emergency referral if tension physiology.', '', '', '[{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right"},{"key":"size","label":"Size","type":"select","options":[" (small)"," (moderate)"," (large)"],"default":" (small)"},{"key":"tension","label":"Tension","type":"select","options":["","  There is mediastinal shift to the opposite side, suggesting tension — emergency."],"default":""}]', 30),
  ('X-Ray Chest PA', 'Cardiomegaly', 'The cardiac silhouette is enlarged with a cardiothoracic ratio of {ctr}.{edema}', 'Cardiomegaly.', 'Clinical and echocardiographic correlation.', 'Pulmonary Edema', '', '[{"key":"ctr","label":"CTR","type":"text","default":""},{"key":"edema","label":"Pulmonary edema","type":"select","options":["","  There is upper-lobe blood diversion and interstitial edema."],"default":""}]', 40),
  ('X-Ray Chest PA', 'Pulmonary Edema', 'There is upper-lobe blood diversion with interstitial septal (Kerley B) lines and {severity}.', 'Features of pulmonary edema.', 'Clinical correlation and treatment; follow-up radiograph.', '', '', '[{"key":"severity","label":"Severity","type":"select","options":["perihilar haze","bilateral airspace (alveolar) edema","associated pleural effusions"],"default":"perihilar haze"}]', 50),
  ('X-Ray Chest PA', 'Lung Nodule', 'A {margin} nodule measuring approximately {size} mm is noted in the {zone}.', 'Pulmonary nodule ({size} mm).', 'Chest CT is advised for characterization; Fleischner Society follow-up per size and risk.', '', '', '[{"key":"margin","label":"Margin","type":"select","options":["well-defined","ill-defined","spiculated"],"default":"well-defined"},{"key":"size","label":"Size (mm)","type":"text","default":""},{"key":"zone","label":"Zone","type":"text","default":""}]', 60),
  ('X-Ray Chest PA', 'Normal Study', 'The lungs are clear. No effusion or pneumothorax. Normal cardiac size and mediastinum.', 'No significant abnormality.', 'Clinical correlation.', '', '', '[]', 90),
  -- Portable Chest — tubes/lines
  ('X-Ray Portable Chest', 'ET Tube Position', 'The endotracheal tube tip projects {position}.', 'ET tube {position}.', 'Reposition and repeat film if malpositioned before use.', '', 'et_tube', '[{"key":"position","label":"Position","type":"select","options":["in a satisfactory position, approximately 5 cm above the carina","low, at/near the carina — recommend withdrawal","in the right main bronchus — recommend withdrawal","high — correlate clinically"],"default":"in a satisfactory position, approximately 5 cm above the carina"}]', 10),
  ('X-Ray Portable Chest', 'NG Tube Position', 'The nasogastric tube {position}.', 'NG tube {position}.', 'Do not use a malpositioned NG tube; reposition and confirm.', '', 'ng_tube', '[{"key":"position","label":"Position","type":"select","options":["passes below the diaphragm in the midline with the tip in the stomach — satisfactory","tip is at the gastro-oesophageal junction — advance","is coiled in the oesophagus — reposition","projects over the bronchial tree — remove immediately"],"default":"passes below the diaphragm in the midline with the tip in the stomach — satisfactory"}]', 20),
  ('X-Ray Portable Chest', 'Central Line Position', 'The central venous catheter tip projects {position}.{ptx}', 'Central line {position}.', 'Correlate before use; exclude post-insertion pneumothorax.', '', '', '[{"key":"position","label":"Position","type":"select","options":["at the cavoatrial junction — satisfactory","in the right atrium — recommend withdrawal","in the internal jugular / azygos — reposition"],"default":"at the cavoatrial junction — satisfactory"},{"key":"ptx","label":"Pneumothorax","type":"select","options":[""," No post-insertion pneumothorax."," There is a post-insertion pneumothorax."],"default":""}]', 30),
  -- Erect Abdomen
  ('X-Ray Erect Abdomen', 'Bowel Obstruction', 'There are dilated {bowel} loops with multiple air-fluid levels{ladder}, suggesting {bowel} obstruction.', '{bowel} obstruction.', 'Surgical correlation. CT abdomen for level and cause.', '', '', '[{"key":"bowel","label":"Bowel","type":"select","options":["small bowel","large bowel"],"default":"small bowel"},{"key":"ladder","label":"Pattern","type":"select","options":[""," in a step-ladder pattern"],"default":""}]', 10),
  ('X-Ray Erect Abdomen', 'Pneumoperitoneum', 'There is free subdiaphragmatic gas{side}, in keeping with pneumoperitoneum.', 'Pneumoperitoneum — likely perforation.', 'Urgent surgical correlation. CT abdomen to confirm and localize.', '', '', '[{"key":"side","label":"Side","type":"select","options":[" under the right hemidiaphragm"," bilaterally"],"default":" under the right hemidiaphragm"}]', 20),
  -- KUB
  ('X-Ray KUB', 'Radio-opaque Calculus', 'A radio-opaque calculus measuring {size} mm projects over the {side} {location}.', '{side} {location} calculus ({size} mm).', 'Ultrasound for hydronephrosis; CT KUB for confirmation. Urology correlation.', '', '', '[{"key":"size","label":"Size (mm)","type":"text","default":""},{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right"},{"key":"location","label":"Location","type":"select","options":["renal region","line of the ureter","VUJ region","bladder region"],"default":"renal region"}]', 10),
  ('X-Ray KUB', 'Normal Study', 'No radio-opaque calculus along the urinary tract. Renal outlines unremarkable.', 'No radio-opaque calculus.', 'Radiolucent stones require CT; ultrasound for hydronephrosis if clinically indicated.', '', '', '[]', 90),
  -- Pelvis / Hip
  ('X-Ray Pelvis AP', 'Neck of Femur Fracture', 'There is a fracture of the {side} femoral neck, which is {displacement}. The injury is {capsule}.', '{side} neck-of-femur fracture.', 'Urgent orthopaedic referral. MRI if radiographically occult but clinically suspected.', '', '', '[{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right"},{"key":"displacement","label":"Displacement","type":"select","options":["undisplaced","displaced"],"default":"displaced"},{"key":"capsule","label":"Capsule","type":"select","options":["intracapsular","extracapsular (intertrochanteric)"],"default":"intracapsular"}]', 10),
  ('X-Ray Pelvis AP', 'Normal Study', 'The pelvic ring is intact. Both hips are congruent with intact Shenton lines. No fracture.', 'No fracture or dislocation.', 'Clinical correlation.', '', '', '[]', 90),
  -- Knee
  ('X-Ray Knee', 'Fracture', 'There is a fracture involving the {site}, which is {intraartic}.{effusion}', '{site} fracture.', 'Orthopaedic correlation. CT for tibial plateau assessment.', '', 'knee_finding', '[{"key":"site","label":"Site","type":"select","options":["tibial plateau","patella","distal femur","proximal fibula"],"default":"tibial plateau"},{"key":"intraartic","label":"Articular","type":"select","options":["extra-articular","intra-articular"],"default":"intra-articular"},{"key":"effusion","label":"Lipohaemarthrosis","type":"select","options":[""," A lipohaemarthrosis is present, indicating an intra-articular fracture."],"default":""}]', 10),
  ('X-Ray Knee', 'Osteoarthritis', 'There is {severity} osteoarthritis, most marked in the {compartment} compartment, with joint-space narrowing and osteophytes.', '{severity} knee osteoarthritis.', 'Clinical correlation; orthopaedic opinion as indicated.', '', 'knee_finding', '[{"key":"severity","label":"Severity","type":"select","options":["mild","moderate","severe"],"default":"moderate"},{"key":"compartment","label":"Compartment","type":"select","options":["medial","lateral","patellofemoral","all"],"default":"medial"}]', 20),
  -- Shoulder
  ('X-Ray Shoulder', 'Dislocation', 'There is {type} glenohumeral dislocation.{lesion}', '{type} shoulder dislocation.', 'Orthopaedic correlation and reduction; post-reduction film.', '', '', '[{"key":"type","label":"Type","type":"select","options":["anterior","posterior"],"default":"anterior"},{"key":"lesion","label":"Associated","type":"select","options":[""," A Hill-Sachs / bony Bankart lesion is noted."],"default":""}]', 10),
  -- Wrist
  ('X-Ray Wrist', 'Distal Radius Fracture', 'There is a {type} fracture of the distal radius, which is {intraartic}, with {tilt}.', 'Distal radius fracture ({type}).', 'Orthopaedic correlation for displaced/intra-articular fracture.', '', '', '[{"key":"type","label":"Type","type":"select","options":["Colles","Smith","undisplaced"],"default":"Colles"},{"key":"intraartic","label":"Articular","type":"select","options":["extra-articular","intra-articular"],"default":"extra-articular"},{"key":"tilt","label":"Tilt","type":"select","options":["dorsal angulation","volar angulation","preserved volar tilt"],"default":"dorsal angulation"}]', 10),
  -- Cervical spine
  ('X-Ray Cervical Spine', 'Fracture / Malalignment', 'There is {abnormality} at the {level} level.{prevert}', 'Cervical spine injury at {level}.', 'Maintain precautions. CT cervical spine; MRI for cord/ligamentous injury.', '', '', '[{"key":"abnormality","label":"Abnormality","type":"select","options":["a fracture","anterolisthesis","loss of normal alignment","an odontoid fracture"],"default":"a fracture"},{"key":"level","label":"Level","type":"text","default":""},{"key":"prevert","label":"Prevertebral","type":"select","options":[""," There is associated prevertebral soft-tissue widening."],"default":""}]', 10),
  ('X-Ray Cervical Spine', 'Degenerative Changes', 'There are degenerative changes at {level} with disc-space narrowing and osteophytes.', 'Cervical spondylosis.', 'Clinical correlation; MRI if radiculopathy or myelopathy.', '', '', '[{"key":"level","label":"Level","type":"text","default":"C5-C6"}]', 20),
  -- Dorsal spine
  ('X-Ray Dorsal Spine', 'Compression Fracture', 'There is {wedge} of the {level} vertebral body with approximately {loss}% height loss.', '{level} compression fracture.', 'MRI to age the fracture and assess the cord. DEXA if osteoporotic.', '', '', '[{"key":"wedge","label":"Type","type":"select","options":["anterior wedging","biconcave collapse","vertebra plana"],"default":"anterior wedging"},{"key":"level","label":"Level","type":"text","default":""},{"key":"loss","label":"Height loss (%)","type":"text","default":""}]', 10),
  -- Lumbar spine
  ('X-Ray Lumbar Spine', 'Spondylolisthesis', 'There is grade {grade} (Meyerding) {direction} of {level}{pars}.', 'Grade {grade} spondylolisthesis at {level}.', 'MRI for canal and neural assessment; flexion-extension for instability.', '', '', '[{"key":"grade","label":"Grade","type":"select","options":["I","II","III","IV"],"default":"I"},{"key":"direction","label":"Direction","type":"select","options":["anterolisthesis","retrolisthesis"],"default":"anterolisthesis"},{"key":"level","label":"Level","type":"text","default":"L5-S1"},{"key":"pars","label":"Pars","type":"select","options":[""," with a pars interarticularis defect"],"default":""}]', 10),
  ('X-Ray Lumbar Spine', 'Degenerative Changes', 'There is disc-space narrowing at {level} with marginal osteophytes and facet arthropathy.', 'Lumbar spondylosis.', 'Clinical correlation; MRI if radiculopathy.', '', '', '[{"key":"level","label":"Level","type":"text","default":"L4-L5"}]', 20),
  -- Whole spine
  ('X-Ray Whole Spine', 'Scoliosis', 'There is a {direction}-convex {region} scoliosis with an apex at {apex} and a Cobb angle of {cobb} degrees.', '{region} scoliosis (Cobb {cobb} deg).', 'Orthopaedic (scoliosis) referral if > 25 deg or progressing. Serial standing films.', '', '', '[{"key":"direction","label":"Convexity","type":"select","options":["right","left"],"default":"right"},{"key":"region","label":"Region","type":"select","options":["thoracic","thoracolumbar","lumbar"],"default":"thoracic"},{"key":"apex","label":"Apex level","type":"text","default":""},{"key":"cobb","label":"Cobb angle (deg)","type":"text","default":""}]', 10),
  -- Skull
  ('X-Ray Skull', 'Fracture', 'There is a {type} fracture of the {region}.', '{type} skull fracture.', 'CT head is advised. Neurosurgical correlation for a depressed fracture.', '', '', '[{"key":"type","label":"Type","type":"select","options":["linear","depressed"],"default":"linear"},{"key":"region","label":"Region","type":"text","default":""}]', 10),
  -- Soft tissue neck
  ('X-Ray Soft Tissue Neck', 'Foreign Body', 'A radio-opaque foreign body is seen at the {level}, projecting over the {tract}.', 'Radio-opaque foreign body at {level}.', 'Urgent ENT correlation. CT for a radiolucent foreign body.', '', '', '[{"key":"level","label":"Level","type":"text","default":""},{"key":"tract","label":"Tract","type":"select","options":["airway","oesophagus","uncertain"],"default":"oesophagus"}]', 10),
  ('X-Ray Soft Tissue Neck', 'Retropharyngeal Widening', 'The prevertebral (retropharyngeal) soft tissues are widened, raising the possibility of a retropharyngeal collection.', 'Retropharyngeal soft-tissue widening.', 'Urgent ENT correlation. CT neck to confirm an abscess.', '', '', '[]', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── Clinical history chips ───────────────────────────────────────────────────
INSERT INTO radiology_clinical_history_chips (study_type, display_label, inserted_text, sort_order, is_system, is_active) VALUES
  ('X-Ray Chest PA', 'Cough / fever', 'Cough and fever.', 10, TRUE, TRUE),
  ('X-Ray Chest PA', 'Breathlessness', 'Breathlessness.', 20, TRUE, TRUE),
  ('X-Ray Chest PA', 'Chest pain', 'Chest pain.', 30, TRUE, TRUE),
  ('X-Ray Chest PA', 'Pre-operative', 'Routine pre-operative evaluation.', 40, TRUE, TRUE),
  ('X-Ray Portable Chest', 'Post tube / line', 'Post ET tube / line placement — check position.', 10, TRUE, TRUE),
  ('X-Ray Portable Chest', 'ICU monitoring', 'ICU patient — interval monitoring.', 20, TRUE, TRUE),
  ('X-Ray Erect Abdomen', 'Acute abdomen', 'Acute abdominal pain.', 10, TRUE, TRUE),
  ('X-Ray Erect Abdomen', 'Distension / obstruction', 'Abdominal distension — query obstruction.', 20, TRUE, TRUE),
  ('X-Ray KUB', 'Renal colic', 'Renal colic / flank pain.', 10, TRUE, TRUE),
  ('X-Ray Pelvis AP', 'Fall / trauma', 'Fall — query hip / pelvic fracture.', 10, TRUE, TRUE),
  ('X-Ray Hip', 'Hip pain', 'Hip pain / difficulty weight-bearing.', 10, TRUE, TRUE),
  ('X-Ray Knee', 'Knee trauma', 'Knee injury / trauma.', 10, TRUE, TRUE),
  ('X-Ray Knee', 'Knee pain (OA)', 'Chronic knee pain — query osteoarthritis.', 20, TRUE, TRUE),
  ('X-Ray Ankle', 'Ankle trauma', 'Ankle injury (Ottawa positive).', 10, TRUE, TRUE),
  ('X-Ray Shoulder', 'Shoulder trauma', 'Shoulder injury — query dislocation / fracture.', 10, TRUE, TRUE),
  ('X-Ray Wrist', 'Wrist trauma', 'Fall on outstretched hand — query fracture.', 10, TRUE, TRUE),
  ('X-Ray Hand', 'Hand trauma', 'Hand injury.', 10, TRUE, TRUE),
  ('X-Ray Cervical Spine', 'Neck trauma', 'Neck trauma — query cervical spine injury.', 10, TRUE, TRUE),
  ('X-Ray Lumbar Spine', 'Low back pain', 'Low back pain.', 10, TRUE, TRUE),
  ('X-Ray Dorsal Spine', 'Back pain / osteoporosis', 'Back pain — query compression fracture.', 10, TRUE, TRUE),
  ('X-Ray Whole Spine', 'Scoliosis screening', 'Scoliosis assessment.', 10, TRUE, TRUE),
  ('X-Ray Soft Tissue Neck', 'Stridor / foreign body', 'Stridor / suspected foreign body.', 10, TRUE, TRUE)
ON CONFLICT (study_type, display_label) DO NOTHING;

-- ── Quick measurements (ONLY where clinically standard for X-Ray) ─────────────
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('X-Ray Chest PA', 'Cardiothoracic ratio', 'Cardiothoracic ratio {value}.', '', 10),
  ('X-Ray Chest AP', 'Cardiothoracic ratio', 'Cardiothoracic ratio {value} (AP — overestimates).', '', 10),
  ('X-Ray Portable Chest', 'ET tube to carina', 'ET tube tip {value} cm above the carina.', 'cm', 10),
  ('X-Ray KUB', 'Stone size', 'Calculus measures {value} mm.', 'mm', 10),
  ('X-Ray Knee', 'Joint space', 'Medial joint space measures {value} mm.', 'mm', 10),
  ('X-Ray Cervical Spine', 'Prevertebral soft tissue', 'Prevertebral soft tissue {value} mm.', 'mm', 10),
  ('X-Ray Dorsal Spine', 'Vertebral height loss', 'Vertebral body height loss {value}%.', '%', 10),
  ('X-Ray Lumbar Spine', 'Listhesis', 'Anterolisthesis {value}% of the vertebral body width.', '%', 10),
  ('X-Ray Whole Spine', 'Cobb angle', 'Cobb angle {value} degrees.', 'deg', 10),
  ('X-Ray Soft Tissue Neck', 'Prevertebral soft tissue', 'Prevertebral soft tissue {value} mm.', 'mm', 10)
ON CONFLICT (study_type, label) DO NOTHING;
