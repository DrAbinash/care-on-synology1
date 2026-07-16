-- =============================================================================
-- Migration: USG Gold Standard — complete study library content pack (PR C)
-- Date: 2026-07-16
-- =============================================================================
-- Purely additive CONTENT, generated directly from docs/usg-reporting/
-- USG_GOLD_STANDARD.md. Adds rows to the SAME shared tables PR B's
-- zz_add_usg_platform_content_pack.sql already populated for a 13-tab starter
-- set (radiology_study_tabs, radiology_quick_findings,
-- radiology_clinical_history_chips, radiology_protocols) plus
-- radiology_quick_measurements (Phase 3-4) — no new table, no new engine.
--
-- Expands USG study coverage from PR B's 13 broad tabs to 32 clinically
-- distinct study types across General, Gynaecology, Obstetric, Small Parts, and
-- Doppler (see the Gold Standard doc for the full clinical spec each row below
-- implements). Study tabs that already exist from PR B (Whole Abdomen, KUB,
-- Pelvis, TVS, Soft Tissue, Thyroid, Breast, Scrotum, NT, Anomaly, Growth) are
-- re-declared here too — ON CONFLICT (name) DO NOTHING makes that a no-op, so
-- listing the full 32-tab set keeps this migration a complete, self-describing
-- snapshot of the Gold Standard tab list rather than a diff someone has to
-- reconstruct by reading two migrations side by side.
--
-- The `zzz_` prefix guarantees this runs after zz_add_usg_platform_content_pack.sql
-- (alphabetical auto-discovery) and after every table/column-adding migration it
-- depends on (radiology_quick_measurements from add_radiology_smart_reporting.sql,
-- questions_json from z_add_radiology_structured_finding_questions.sql).
--
-- required_measurements (Phase 10 — content validation): each token is the exact
-- text a study's Quick Measurement template renders BEFORE the {value} placeholder
-- (e.g. template 'Liver span: {value} mm.' -> token 'Liver span'), so the existing
-- missingRequiredMeasurements substring check (RadiologyReportingWorkspace.tsx)
-- actually clears once the matching Quick Measurement is inserted into Findings —
-- no new validator, just tokens chosen to work correctly with the existing one.
--
-- Fully idempotent: every INSERT uses ON CONFLICT DO NOTHING against the same
-- unique keys the base migrations defined. Safe to run repeatedly. No existing
-- row (MRI, CT, or PR B's USG starter content) is modified.
-- =============================================================================

-- ── 1. Study tabs (Gold Standard full set) ──────────────────────────────────
INSERT INTO radiology_study_tabs (name, sort_order) VALUES
  ('Whole Abdomen', 1000),
  ('KUB', 1010),
  ('Pelvis', 1020),
  ('Appendix', 1030),
  ('Hernia', 1040),
  ('Soft Tissue', 1050),
  ('TVS', 1060),
  ('Follicular Study', 1070),
  ('Endometrium', 1080),
  ('Ovarian Lesions', 1090),
  ('Infertility', 1100),
  ('Early Pregnancy', 1110),
  ('Dating', 1120),
  ('Viability', 1130),
  ('NT', 1140),
  ('Anomaly', 1150),
  ('Growth', 1160),
  ('BPP', 1170),
  ('Cervical Length', 1180),
  ('Multiple Pregnancy', 1190),
  ('Thyroid', 1200),
  ('Breast', 1210),
  ('Scrotum', 1220),
  ('Neck', 1230),
  ('MSK', 1240),
  ('Carotid Doppler', 1250),
  ('Venous Doppler', 1260),
  ('Arterial Doppler', 1270),
  ('Renal Doppler', 1280),
  ('Hepatic Doppler', 1290),
  ('Portal Doppler', 1300),
  ('Obstetric Doppler', 1310)
ON CONFLICT (name) DO NOTHING;

-- ── 2. Clinical History chips ────────────────────────────────────────────────
INSERT INTO radiology_clinical_history_chips (study_type, display_label, inserted_text, sort_order, is_system, is_active) VALUES
  ('Whole Abdomen', 'Pain abdomen', 'Pain abdomen.', 10, TRUE, TRUE),
  ('Whole Abdomen', 'Fever', 'Fever.', 20, TRUE, TRUE),
  ('Whole Abdomen', 'Jaundice', 'Jaundice.', 30, TRUE, TRUE),
  ('KUB', 'Renal colic', 'Renal colic.', 10, TRUE, TRUE),
  ('KUB', 'Hematuria', 'Hematuria.', 20, TRUE, TRUE),
  ('KUB', 'Urinary retention', 'Urinary retention / difficulty voiding.', 30, TRUE, TRUE),
  ('Pelvis', 'LUTS (urinary symptoms)', 'Lower urinary tract symptoms.', 10, TRUE, TRUE),
  ('Pelvis', 'Pelvic pain', 'Pelvic pain.', 20, TRUE, TRUE),
  ('Pelvis', 'Prostate screening', 'Prostate screening / PSA follow-up.', 30, TRUE, TRUE),
  ('Appendix', 'RIF pain', 'Right iliac fossa pain.', 10, TRUE, TRUE),
  ('Appendix', 'Suspected appendicitis', 'Clinically suspected acute appendicitis.', 20, TRUE, TRUE),
  ('Appendix', 'Fever with abdominal pain', 'Fever with abdominal pain.', 30, TRUE, TRUE),
  ('Hernia', 'Groin swelling', 'Groin swelling.', 10, TRUE, TRUE),
  ('Hernia', 'Reducible lump on straining', 'Reducible lump on straining/coughing.', 20, TRUE, TRUE),
  ('Hernia', 'Post-operative bulge at scar site', 'Post-operative bulge at surgical scar site.', 30, TRUE, TRUE),
  ('Soft Tissue', 'Palpable lump/swelling', 'Palpable lump/swelling.', 10, TRUE, TRUE),
  ('Soft Tissue', 'Painful swelling', 'Painful swelling.', 20, TRUE, TRUE),
  ('Soft Tissue', 'Post-traumatic swelling', 'Post-traumatic swelling.', 30, TRUE, TRUE),
  ('TVS', 'Infertility', 'Infertility workup.', 10, TRUE, TRUE),
  ('TVS', 'Bleeding PV', 'Bleeding per vaginum.', 20, TRUE, TRUE),
  ('TVS', 'Pelvic pain', 'Pelvic pain.', 30, TRUE, TRUE),
  ('Follicular Study', 'Ovulation induction cycle', 'On ovulation induction (clomiphene/letrozole/gonadotropins) — follicular monitoring.', 10, TRUE, TRUE),
  ('Follicular Study', 'IUI cycle', 'IUI cycle — follicular monitoring for trigger timing.', 20, TRUE, TRUE),
  ('Follicular Study', 'IVF stimulation monitoring', 'On controlled ovarian stimulation for IVF — follicular monitoring.', 30, TRUE, TRUE),
  ('Endometrium', 'Postmenopausal bleeding', 'Postmenopausal bleeding.', 10, TRUE, TRUE),
  ('Endometrium', 'Abnormal uterine bleeding (AUB)', 'Abnormal uterine bleeding.', 20, TRUE, TRUE),
  ('Endometrium', 'Follow-up after endometrial sampling', 'Follow-up scan after endometrial sampling/biopsy.', 30, TRUE, TRUE),
  ('Ovarian Lesions', 'Incidental adnexal mass', 'Incidentally detected adnexal mass on prior imaging.', 10, TRUE, TRUE),
  ('Ovarian Lesions', 'Suspected ovarian torsion / acute pelvic pain', 'Acute pelvic pain, rule out ovarian torsion.', 20, TRUE, TRUE),
  ('Ovarian Lesions', 'Known ovarian cyst - follow-up', 'Known ovarian cyst — interval follow-up.', 30, TRUE, TRUE),
  ('Infertility', 'Primary infertility', 'Primary infertility — baseline workup.', 10, TRUE, TRUE),
  ('Infertility', 'Secondary infertility', 'Secondary infertility — baseline workup.', 20, TRUE, TRUE),
  ('Infertility', 'Pre-IVF baseline workup', 'Pre-IVF baseline infertility workup.', 30, TRUE, TRUE),
  ('Early Pregnancy', 'Missed period / positive pregnancy test', 'Missed period, positive urine pregnancy test — confirm intrauterine pregnancy.', 10, TRUE, TRUE),
  ('Early Pregnancy', 'Spotting/bleeding PV', 'Spotting/bleeding per vaginum in early pregnancy.', 20, TRUE, TRUE),
  ('Early Pregnancy', 'Prior early pregnancy loss', 'History of prior early pregnancy loss.', 30, TRUE, TRUE),
  ('Dating', 'Unsure of LMP', 'Unsure of last menstrual period — requesting ultrasound dating.', 10, TRUE, TRUE),
  ('Dating', 'IVF/ART — known conception date', 'IVF/ART conception, embryo transfer date known.', 20, TRUE, TRUE),
  ('Dating', 'Irregular cycles', 'Irregular menstrual cycles — LMP unreliable for dating.', 30, TRUE, TRUE),
  ('Viability', 'Bleeding PV', 'Bleeding per vaginum in known/suspected pregnancy.', 10, TRUE, TRUE),
  ('Viability', 'Pain abdomen with known pregnancy', 'Pain abdomen with known pregnancy — rule out ectopic/threatened miscarriage.', 20, TRUE, TRUE),
  ('Viability', 'Prior miscarriage', 'History of prior miscarriage.', 30, TRUE, TRUE),
  ('NT', 'Routine first-trimester aneuploidy screening', 'Routine first-trimester combined screening for aneuploidy.', 10, TRUE, TRUE),
  ('NT', 'Advanced maternal age', 'Advanced maternal age.', 20, TRUE, TRUE),
  ('NT', 'Previous aneuploidy-affected pregnancy', 'Previous pregnancy affected by aneuploidy.', 30, TRUE, TRUE),
  ('Anomaly', 'Routine 18–22 week anomaly scan', 'Routine second-trimester anomaly scan, 18–22 weeks.', 10, TRUE, TRUE),
  ('Anomaly', 'Abnormal maternal serum screening', 'Abnormal maternal serum aneuploidy screening result.', 20, TRUE, TRUE),
  ('Anomaly', 'Family history of congenital anomaly', 'Family history of congenital anomaly.', 30, TRUE, TRUE),
  ('Growth', 'Routine third-trimester growth scan', 'Routine third-trimester growth scan.', 10, TRUE, TRUE),
  ('Growth', 'Suspected growth restriction/small for dates', 'Symphysio-fundal height/clinical exam suggests small for dates.', 20, TRUE, TRUE),
  ('Growth', 'Gestational diabetes', 'Gestational diabetes mellitus — growth and liquor surveillance.', 30, TRUE, TRUE),
  ('BPP', 'Reduced fetal movements', 'Maternal perception of reduced fetal movements.', 10, TRUE, TRUE),
  ('BPP', 'Post-dates pregnancy', 'Post-dates pregnancy — antenatal surveillance.', 20, TRUE, TRUE),
  ('BPP', 'High-risk pregnancy surveillance', 'High-risk pregnancy — routine antenatal biophysical surveillance.', 30, TRUE, TRUE),
  ('Cervical Length', 'History of preterm birth', 'History of prior spontaneous preterm birth.', 10, TRUE, TRUE),
  ('Cervical Length', 'Short cervix on prior scan', 'Short cervix noted on a prior scan — surveillance.', 20, TRUE, TRUE),
  ('Cervical Length', 'Routine mid-trimester screening', 'Routine mid-trimester cervical length screening.', 30, TRUE, TRUE),
  ('Multiple Pregnancy', 'Known twin/multiple pregnancy', 'Known twin/multiple pregnancy.', 10, TRUE, TRUE),
  ('Multiple Pregnancy', 'IVF/ART conception', 'IVF/ART conception.', 20, TRUE, TRUE),
  ('Multiple Pregnancy', 'Suspected TTTS', 'Suspected twin-twin transfusion syndrome — fluid discordance between sacs.', 30, TRUE, TRUE),
  ('Thyroid', 'Thyroid swelling', 'Thyroid swelling.', 10, TRUE, TRUE),
  ('Thyroid', 'Hoarseness of voice', 'Hoarseness of voice.', 20, TRUE, TRUE),
  ('Thyroid', 'Deranged thyroid function tests', 'Deranged thyroid function tests (TFT).', 30, TRUE, TRUE),
  ('Breast', 'Breast lump', 'Palpable breast lump.', 10, TRUE, TRUE),
  ('Breast', 'Nipple discharge', 'Nipple discharge.', 20, TRUE, TRUE),
  ('Breast', 'Breast pain (mastalgia)', 'Breast pain (mastalgia).', 30, TRUE, TRUE),
  ('Scrotum', 'Scrotal swelling', 'Scrotal swelling.', 10, TRUE, TRUE),
  ('Scrotum', 'Acute scrotal pain', 'Acute scrotal pain.', 20, TRUE, TRUE),
  ('Scrotum', 'Infertility workup', 'Infertility workup.', 30, TRUE, TRUE),
  ('Neck', 'Neck swelling', 'Neck swelling.', 10, TRUE, TRUE),
  ('Neck', 'Neck pain', 'Neck pain.', 20, TRUE, TRUE),
  ('Neck', 'Recent sore throat / URI', 'Recent sore throat / upper respiratory tract infection.', 30, TRUE, TRUE),
  ('MSK', 'Shoulder pain (suspected rotator cuff injury)', 'Shoulder pain, suspected rotator cuff injury.', 10, TRUE, TRUE),
  ('MSK', 'Ankle pain / sprain', 'Ankle pain following inversion sprain.', 20, TRUE, TRUE),
  ('MSK', 'Wrist pain / paresthesia (suspected carpal tunnel)', 'Wrist pain with paresthesia, suspected carpal tunnel syndrome.', 30, TRUE, TRUE),
  ('Carotid Doppler', 'Stroke/TIA', 'Acute stroke / TIA — carotid territory evaluation.', 10, TRUE, TRUE),
  ('Carotid Doppler', 'Carotid bruit', 'Carotid bruit on auscultation.', 20, TRUE, TRUE),
  ('Carotid Doppler', 'Pre-CABG screening', 'Pre-operative carotid screening prior to cardiac surgery.', 30, TRUE, TRUE),
  ('Venous Doppler', 'Calf swelling/pain', 'Unilateral calf swelling and pain — rule out DVT.', 10, TRUE, TRUE),
  ('Venous Doppler', 'Post-op DVT screening', 'Post-operative deep vein thrombosis screening.', 20, TRUE, TRUE),
  ('Venous Doppler', 'Varicose veins', 'Varicose veins — reflux mapping.', 30, TRUE, TRUE),
  ('Arterial Doppler', 'Claudication', 'Intermittent claudication.', 10, TRUE, TRUE),
  ('Arterial Doppler', 'Rest pain / non-healing ulcer', 'Rest pain / non-healing ulcer — critical limb ischaemia workup.', 20, TRUE, TRUE),
  ('Arterial Doppler', 'Diminished/absent pulses', 'Diminished or absent distal pulses on clinical examination.', 30, TRUE, TRUE),
  ('Renal Doppler', 'Resistant hypertension', 'Resistant/refractory hypertension — rule out renal artery stenosis.', 10, TRUE, TRUE),
  ('Renal Doppler', 'Renal transplant surveillance', 'Renal transplant Doppler surveillance.', 20, TRUE, TRUE),
  ('Renal Doppler', 'Suspected renal vein thrombosis', 'Flank pain with nephrotic-range proteinuria — rule out renal vein thrombosis.', 30, TRUE, TRUE),
  ('Hepatic Doppler', 'Liver transplant surveillance', 'Post-liver-transplant Doppler surveillance.', 10, TRUE, TRUE),
  ('Hepatic Doppler', 'Cirrhosis / portal hypertension workup', 'Known cirrhosis — portal hypertension vascular workup.', 20, TRUE, TRUE),
  ('Hepatic Doppler', 'Suspected Budd-Chiari', 'Acute abdominal pain with hepatomegaly and ascites — rule out Budd-Chiari syndrome.', 30, TRUE, TRUE),
  ('Portal Doppler', 'Known cirrhosis', 'Known cirrhosis — portal hypertension surveillance.', 10, TRUE, TRUE),
  ('Portal Doppler', 'Variceal bleed workup', 'Upper GI bleed — variceal source workup.', 20, TRUE, TRUE),
  ('Portal Doppler', 'Pre-TIPS assessment', 'Pre-TIPS (transjugular intrahepatic portosystemic shunt) vascular assessment.', 30, TRUE, TRUE),
  ('Obstetric Doppler', 'Fetal growth restriction surveillance', 'Suspected/known fetal growth restriction — Doppler surveillance.', 10, TRUE, TRUE),
  ('Obstetric Doppler', 'Pre-eclampsia / hypertensive disorder', 'Pre-eclampsia / gestational hypertension — uteroplacental Doppler assessment.', 20, TRUE, TRUE),
  ('Obstetric Doppler', 'First-trimester pre-eclampsia screening', 'First-trimester combined pre-eclampsia risk screening — uterine artery Doppler.', 30, TRUE, TRUE)
ON CONFLICT (study_type, display_label) DO NOTHING;

-- ── 3. Quick Findings (Smart Findings library, Phase 5) ─────────────────────
-- Structured entries (questions_json non-empty) reuse the EXISTING
-- {key}/[optional] Structured Finding Assistant mechanism (Phase 6) — no new
-- engine.

-- USG Whole Abdomen (Whole Abdomen)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Whole Abdomen', 'Fatty Liver Gr I', 'Liver shows mildly increased echogenicity with normal size and contour, in keeping with Grade I (mild) fatty infiltration. No focal lesion.', 'Grade I fatty liver.', 10),
  ('Whole Abdomen', 'Fatty Liver Gr II', 'Liver shows moderately increased echogenicity with mild posterior beam attenuation, in keeping with Grade II (moderate) fatty infiltration. No focal lesion.', 'Grade II fatty liver.', 20),
  ('Whole Abdomen', 'Fatty Liver Gr III', 'Liver shows markedly increased echogenicity with significant posterior beam attenuation and poor visualization of the diaphragm and intrahepatic vasculature, in keeping with Grade III (severe) fatty infiltration. No focal lesion.', 'Grade III fatty liver.', 30),
  ('Whole Abdomen', 'Hepatomegaly', 'Liver is enlarged in size with normal echotexture. No focal lesion.', 'Hepatomegaly.', 40),
  ('Whole Abdomen', 'Simple Hepatic Cyst', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the liver parenchyma, showing no internal echoes, septations, or solid component.', 'Simple hepatic cyst.', 50),
  ('Whole Abdomen', 'Cholelithiasis', 'Gallbladder shows a mobile echogenic focus with posterior acoustic shadowing, consistent with a calculus. No pericholecystic fluid or wall thickening.', 'Cholelithiasis.', 60),
  ('Whole Abdomen', 'Splenomegaly', 'Spleen is enlarged in size with normal echotexture.', 'Splenomegaly.', 70)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Whole Abdomen', 'Gallbladder Polyp', 'Gallbladder shows a non-shadowing, immobile, echogenic polypoid lesion arising from the wall, measuring approximately {size} mm.', 'Gallbladder polyp ({size} mm).', '[{"key": "size", "label": "Size (mm)", "type": "text", "default": "", "required": false}]', 80),
  ('Whole Abdomen', 'Ascites', 'Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity.', '{grade} ascites.', '[{"key": "grade", "label": "Quantity", "type": "select", "options": ["Mild", "Moderate", "Gross"], "default": "Mild", "required": true}]', 90)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG KUB (KUB)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('KUB', 'Simple Renal Cyst', 'A well-defined anechoic cyst with posterior acoustic enhancement is noted in the kidney, showing no internal echoes or septations.', 'Simple renal cyst.', 10),
  ('KUB', 'Bladder Calculus', 'A mobile echogenic focus with posterior acoustic shadowing is noted within the urinary bladder lumen, shifting with change in patient position, consistent with a bladder calculus.', 'Bladder calculus.', 20),
  ('KUB', 'Bladder Wall Thickening', 'Urinary bladder wall appears diffusely thickened. Lumen is otherwise unremarkable.', 'Bladder wall thickening.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('KUB', 'Renal Calculus', 'An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} kidney. No upstream hydronephrosis.', '{side} renal calculus.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": ""}]', 40),
  ('KUB', 'Ureteric Calculus', 'An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} ureter at the {level} level, with upstream {side} hydroureteronephrosis.', '{side} {level} ureteric calculus with hydroureteronephrosis.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "level", "label": "Level", "type": "select", "options": ["proximal", "mid", "distal (VUJ)"], "default": "distal (VUJ)", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": ""}]', 50),
  ('KUB', 'Hydronephrosis', '{side} kidney shows {grade} hydronephrosis with dilated pelvicalyceal system.', '{side} {grade} hydronephrosis.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "grade", "label": "Grade", "type": "select", "options": ["mild", "moderate", "gross"], "default": "mild", "required": true}]', 60),
  ('KUB', 'Elevated Post-Void Residual', 'Post-void residual urine volume is estimated at approximately {volume} mL, which is elevated for age, in keeping with incomplete bladder emptying.', 'Elevated post-void residual ({volume} mL) — incomplete bladder emptying.', '[{"key": "volume", "label": "PVR volume (mL)", "type": "text", "default": "", "required": true}]', 70)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Pelvis (TA/TV) (Pelvis)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Pelvis', 'Bulky Uterus', 'Uterus is bulky in size with normal myometrial echotexture. Endometrium is central and unremarkable.', 'Bulky uterus.', 10),
  ('Pelvis', 'Endometrial Polyp', 'A well-defined echogenic endometrial lesion is noted, in keeping with an endometrial polyp.', 'Endometrial polyp.', 20),
  ('Pelvis', 'Simple Adnexal Cyst', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the adnexa, showing no internal echoes, septations, or vascularity.', 'Simple adnexal cyst.', 30),
  ('Pelvis', 'Free Pelvic Fluid', 'A small amount of free anechoic fluid is noted in the pouch of Douglas/pelvis.', 'Free fluid in the pelvis — physiological unless clinically significant.', 40)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Pelvis', 'Benign Prostatic Hyperplasia', 'Prostate is enlarged in volume, measuring approximately {volume} cc, with a smooth, symmetric, predominantly heterogeneous echotexture, in keeping with benign prostatic hyperplasia. No definite focal hypoechoic lesion.', 'Benign prostatic hyperplasia (~{volume} cc).', '[{"key": "volume", "label": "Estimated prostate volume (cc)", "type": "text", "default": "", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Appendix (Graded Compression) (Appendix)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Appendix', 'Normal Appendix', 'The appendix is visualized as a blind-ending, compressible, non-inflamed tubular structure arising from the cecum, measuring less than 6 mm in outer diameter, with no wall thickening or periappendiceal fat stranding.', 'Normal appendix. No sonographic evidence of acute appendicitis.', 10),
  ('Appendix', 'Periappendiceal Abscess', 'A complex, predominantly hypoechoic collection with internal debris is noted adjacent to the cecum/appendix, in keeping with a periappendiceal or appendiceal abscess.', 'Periappendiceal abscess — surgical/interventional correlation advised.', 20),
  ('Appendix', 'Non-Visualized Appendix', 'The appendix could not be confidently visualized due to overlying bowel gas or body habitus; graded compression technique was used without definitive identification.', 'Appendix not visualized. Clinical correlation advised; appendicitis cannot be definitively excluded on this study.', 30),
  ('Appendix', 'Mesenteric Lymphadenitis', 'Multiple enlarged, hypoechoic, oval mesenteric lymph nodes are noted in the right iliac fossa, with a normal-caliber appendix.', 'Mesenteric lymphadenitis. Normal appendix.', 40)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Appendix', 'Acute Appendicitis', 'A non-compressible, blind-ending tubular structure is noted in the right iliac fossa arising from the cecum, measuring {diameter} mm in outer diameter, with mural wall thickening and increased wall vascularity on colour Doppler[, with {periappendiceal}][, with {appendicolith}], in keeping with acute appendicitis.', 'Acute appendicitis, {diameter} mm[, with {periappendiceal}][, with {appendicolith}].', '[{"key": "diameter", "label": "Diameter (mm)", "type": "text", "default": "", "required": true}, {"key": "periappendiceal", "label": "Periappendiceal change", "type": "select", "options": ["None", "periappendiceal fat stranding", "a periappendiceal free fluid collection"], "default": "None", "required": false}, {"key": "appendicolith", "label": "Appendicolith", "type": "select", "options": ["None", "an associated appendicolith"], "default": "None", "required": false}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Hernia (Abdominal Wall / Inguinal) (Hernia)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Hernia', 'Incisional Hernia', 'A defect is noted within the anterior abdominal wall musculature/fascia at the site of the previous surgical scar, through which omental fat/bowel protrudes with increased intra-abdominal pressure, reducing on relaxation.', 'Incisional hernia at the site of the surgical scar.', 10),
  ('Hernia', 'No Hernia Demonstrated', 'No fascial defect or abdominal wall/groin hernia is demonstrated on dynamic scanning with Valsalva maneuver and standing provocation.', 'No sonographic evidence of hernia at the site of clinical concern.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Hernia', 'Reducible Inguinal Hernia', 'A defect is noted in the {side} inguinal canal through which {contents} protrude on Valsalva maneuver/standing, with free reduction on supine positioning and gentle compression. No bowel wall thickening or free fluid is seen.', '{side} reducible inguinal hernia containing {contents}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "contents", "label": "Contents", "type": "select", "options": ["omental fat", "small bowel loops", "large bowel"], "default": "omental fat", "required": true}]', 30),
  ('Hernia', 'Irreducible/Incarcerated Hernia', 'A {side} groin/abdominal wall defect contains {contents} which do not reduce with compression or on lying supine[, with {strangulationSigns}].', '{side} irreducible hernia containing {contents}[, with {strangulationSigns}] — clinical correlation for possible incarceration/strangulation advised.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "contents", "label": "Contents", "type": "select", "options": ["omental fat", "small bowel loops", "large bowel"], "default": "omental fat", "required": true}, {"key": "strangulationSigns", "label": "Strangulation signs", "type": "select", "options": ["None", "bowel wall thickening, reduced peristalsis, and hyperaemia concerning for compromised bowel"], "default": "None", "required": false}]', 40),
  ('Hernia', 'Umbilical Hernia', 'A ventral abdominal wall defect is noted at the umbilicus, measuring approximately {size} mm, through which {contents} protrudes on Valsalva maneuver, reducing spontaneously in the supine relaxed position.', 'Umbilical hernia ({size} mm) containing {contents}.', '[{"key": "size", "label": "Defect size (mm)", "type": "text", "default": "", "required": true}, {"key": "contents", "label": "Contents", "type": "select", "options": ["omental fat", "bowel"], "default": "omental fat", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Soft Tissue (Soft Tissue)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Soft Tissue', 'Simple Lipoma', 'A well-defined, compressible, hyperechoic subcutaneous lesion is noted, showing no significant internal vascularity, in keeping with a lipoma.', 'Subcutaneous lipoma.', 10),
  ('Soft Tissue', 'Epidermal Inclusion Cyst', 'A well-defined, predominantly hypoechoic subcutaneous lesion with internal heterogeneous echoes and a punctum tract to the skin surface is noted, with posterior acoustic enhancement, in keeping with an epidermal inclusion cyst. No significant internal vascularity.', 'Epidermal inclusion cyst.', 20),
  ('Soft Tissue', 'Reactive Lymph Node', 'An oval, well-defined lymph node with preserved echogenic fatty hilum and normal hilar vascularity is noted, in keeping with a reactive/benign lymph node.', 'Reactive lymph node.', 30),
  ('Soft Tissue', 'Abscess Collection', 'A heterogeneous, predominantly hypoechoic collection with internal debris and peripheral hyperaemia is noted, in keeping with an abscess.', 'Soft tissue abscess.', 40),
  ('Soft Tissue', 'Suspicious Solid Soft Tissue Mass', 'A solid, heterogeneous soft tissue mass with irregular margins and increased internal vascularity on colour Doppler is noted, showing none of the typical features of a lipoma, simple cyst, or abscess.', 'Indeterminate/suspicious solid soft tissue mass — contrast-enhanced MRI and/or biopsy advised for further characterization.', 50)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Soft Tissue', 'Soft Tissue Foreign Body', 'A linear echogenic focus with posterior acoustic shadowing/reverberation, measuring approximately {size} mm, is noted within the subcutaneous soft tissue, in keeping with a retained {material} foreign body[, with {inflammation}].', 'Retained {material} foreign body ({size} mm)[, with {inflammation}].', '[{"key": "material", "label": "Material", "type": "select", "options": ["wood", "glass", "metal", "organic/vegetative"], "default": "wood", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": ""}, {"key": "inflammation", "label": "Surrounding inflammation", "type": "select", "options": ["None", "surrounding hypoechoic inflammatory change"], "default": "None", "required": false}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Transvaginal Sonography (TVS) (TVS)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('TVS', 'Simple Ovarian Cyst', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the ovary, showing no internal echoes, septations, or vascularity.', 'Simple ovarian cyst.', 10),
  ('TVS', 'Endometrial Thickness Normal', 'Endometrium is central, regular, and within normal limits for the reported cycle day.', 'Normal endometrial thickness.', 20),
  ('TVS', 'Adenomyosis', 'Uterus is globally bulky with heterogeneous myometrial echotexture, scattered myometrial cysts, and indistinct endo-myometrial junction, in keeping with adenomyosis.', 'Adenomyosis.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('TVS', 'Follicle Tracking', 'Right ovary shows {rightCount} follicle(s), largest measuring {rightLargestMm} mm. Left ovary shows {leftCount} follicle(s), largest measuring {leftLargestMm} mm.', 'Follicular study as above.', '[{"key": "rightCount", "label": "Right — follicle count", "type": "text", "required": false}, {"key": "rightLargestMm", "label": "Right — largest (mm)", "type": "text", "required": false}, {"key": "leftCount", "label": "Left — follicle count", "type": "text", "required": false}, {"key": "leftLargestMm", "label": "Left — largest (mm)", "type": "text", "required": false}]', 40),
  ('TVS', 'Fibroid Uterus', 'A well-defined hypoechoic {location} myometrial lesion is noted, measuring approximately {size} mm, in keeping with a fibroid.', '{location} fibroid.', '[{"key": "location", "label": "Location", "type": "select", "options": ["intramural", "subserosal", "submucosal"], "default": "intramural", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "required": false}]', 50),
  ('TVS', 'Endometrioma', 'A well-defined cystic lesion with homogeneous low-level (''ground-glass'') internal echoes and no significant internal vascularity is noted in the {side} ovary, measuring approximately {size} mm, in keeping with an endometrioma.', '{side} ovarian endometrioma, {size} mm.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "required": false}]', 60),
  ('TVS', 'Hydrosalpinx', 'A tubular, thin-walled, anechoic cystic structure with incomplete septations (''cogwheel'' sign) is noted in the {side} adnexa, separate from the ovary, in keeping with hydrosalpinx.', '{side} hydrosalpinx.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}]', 70)
ON CONFLICT (study_type, label) DO NOTHING;

-- Follicular Study (Follicular Study)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Follicular Study', 'Trilaminar Endometrium', 'Endometrium demonstrates a triple-line (trilaminar) pattern, favourable for implantation.', 'Trilaminar endometrium.', 10),
  ('Follicular Study', 'Non-trilaminar / Thin Endometrium', 'Endometrium is homogeneously echogenic without a triple-line pattern and/or is thin for cycle day, less favourable for implantation.', 'Non-trilaminar / suboptimal endometrial pattern for cycle day.', 20),
  ('Follicular Study', 'Ovulation Not Yet Occurred', 'The previously dominant follicle persists unchanged in size and configuration with no evidence of collapse, free fluid, or corpus luteum formation, suggesting ovulation has not yet occurred.', 'No sonographic evidence of ovulation at this visit.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Follicular Study', 'Day-wise Follicular Monitoring', 'Cycle Day {cycleDay}: Right ovary shows {rightCount} follicle(s), dominant follicle measuring {rightDominantMm} mm. Left ovary shows {leftCount} follicle(s), dominant follicle measuring {leftDominantMm} mm. Endometrium measures {endoThicknessMm} mm, {endoPattern} pattern.', 'Day {cycleDay} follicular study — dominant follicle {rightDominantMm}/{leftDominantMm} mm, endometrium {endoThicknessMm} mm ({endoPattern}).', '[{"key": "cycleDay", "label": "Cycle day", "type": "text", "required": true}, {"key": "rightCount", "label": "Right — follicle count", "type": "text", "required": false}, {"key": "rightDominantMm", "label": "Right — dominant follicle (mm)", "type": "text", "required": false}, {"key": "leftCount", "label": "Left — follicle count", "type": "text", "required": false}, {"key": "leftDominantMm", "label": "Left — dominant follicle (mm)", "type": "text", "required": false}, {"key": "endoThicknessMm", "label": "Endometrial thickness (mm)", "type": "text", "required": true}, {"key": "endoPattern", "label": "Endometrial pattern", "type": "select", "options": ["trilaminar", "non-trilaminar"], "default": "trilaminar", "required": true}]', 40),
  ('Follicular Study', 'Mature Pre-ovulatory Follicle', 'A dominant pre-ovulatory follicle measuring {sizeMm} mm is noted in the {side} ovary, with a peripheral cumulus oophorus complex, in keeping with imminent ovulation.', '{side} dominant follicle, {sizeMm} mm — criteria for trigger/imminent ovulation appear met; correlate with clinical protocol.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": true}]', 50),
  ('Follicular Study', 'Corpus Luteum', 'A thick-walled cystic structure with a crenated margin and peripheral ''ring of fire'' vascularity on colour Doppler is noted in the {side} ovary, in keeping with a corpus luteum, consistent with recent ovulation.', '{side} corpus luteum — sonographic evidence of recent ovulation.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Endometrium (Endometrium)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Endometrium', 'Normal Endometrium', 'Endometrium is central, homogeneous, and measures within normal limits for age/cycle day/menopausal status, with a well-defined echogenic interface. No focal lesion.', 'Normal endometrium.', 10),
  ('Endometrium', 'Endometrial Fluid Collection', 'A thin anechoic fluid collection is noted within the endometrial cavity, with no associated solid component.', 'Endometrial fluid collection — correlate clinically (cervical stenosis/hematometra vs. physiological).', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Endometrium', 'Endometrial Polyp', 'A well-defined echogenic intracavitary lesion with a feeding vascular pedicle on colour Doppler is noted, measuring approximately {sizeMm} mm, in keeping with an endometrial polyp.', 'Endometrial polyp, {sizeMm} mm.', '[{"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": false}]', 30),
  ('Endometrium', 'Endometrial Hyperplasia', 'Endometrium is diffusely thickened, measuring {thicknessMm} mm, with {pattern} echotexture, a regular endo-myometrial junction, and no discrete focal lesion, in keeping with endometrial hyperplasia.', 'Endometrial thickening ({thicknessMm} mm), favour endometrial hyperplasia; histopathological correlation advised.', '[{"key": "thicknessMm", "label": "Thickness (mm)", "type": "text", "required": true}, {"key": "pattern", "label": "Echotexture", "type": "select", "options": ["homogeneous", "heterogeneous"], "default": "homogeneous", "required": false}]', 40),
  ('Endometrium', 'Suspicious Endometrial Mass', 'Endometrium is markedly thickened and heterogeneous, measuring {thicknessMm} mm, with an irregular endo-myometrial junction and increased vascularity on colour Doppler, raising concern for endometrial malignancy.', 'Thickened, vascular, irregular endometrium ({thicknessMm} mm) — endometrial malignancy cannot be excluded; urgent histopathological correlation advised.', '[{"key": "thicknessMm", "label": "Thickness (mm)", "type": "text", "required": true}]', 50),
  ('Endometrium', 'IUD In Situ', 'An echogenic intrauterine device is noted; position is assessed as {position} relative to the endometrial cavity and internal os.', 'IUD {position}.', '[{"key": "position", "label": "Position", "type": "select", "options": ["well-positioned", "low-lying", "malpositioned/embedded"], "default": "well-positioned", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Ovarian Lesions (Ovarian Lesions)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Ovarian Lesions', 'Torsion Pattern', 'The affected ovary is markedly enlarged with heterogeneous stroma, peripherally displaced follicles, and absent or markedly reduced flow on colour/pulsed Doppler, with a whirlpool sign at the vascular pedicle, in keeping with ovarian torsion.', 'Sonographic features suggestive of ovarian torsion — surgical emergency; immediate clinical correlation and gynaecology/surgical consult advised.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Ovarian Lesions', 'Simple Cyst (IOTA)', 'A unilocular anechoic cystic lesion with a smooth thin wall, no septations, no solid component, and no internal or wall vascularity on colour Doppler (IOTA simple cyst) is noted in the {side} ovary, measuring approximately {sizeMm} mm.', '{side} simple ovarian cyst, {sizeMm} mm — IOTA benign pattern.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": true}]', 20),
  ('Ovarian Lesions', 'Simple Septated Cyst', 'A cystic lesion with {septaCount} thin (under 3 mm) septation(s), no solid component, and no papillary projection is noted in the {side} ovary, measuring approximately {sizeMm} mm, with no or minimal septal vascularity on colour Doppler.', '{side} septated ovarian cyst, {sizeMm} mm — favour benign.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": true}, {"key": "septaCount", "label": "Number of septations", "type": "text", "required": false}]', 30),
  ('Ovarian Lesions', 'Complex Multiloculated Cyst', 'A multiloculated cystic lesion with {wallThickness} septations and no discrete solid component is noted in the {side} ovary, measuring approximately {sizeMm} mm.', '{side} multiloculated ovarian cyst, {sizeMm} mm, with {wallThickness} septations.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": true}, {"key": "wallThickness", "label": "Septal/wall thickness", "type": "select", "options": ["thin", "thick"], "default": "thin", "required": true}]', 40),
  ('Ovarian Lesions', 'Solid or Mixed Adnexal Mass', 'A mixed solid-cystic mass with a solid component/papillary projection showing {vascularity} vascularity on colour Doppler is noted in the {side} adnexa, measuring approximately {sizeMm} mm.', '{side} solid/mixed adnexal mass, {sizeMm} mm, {vascularity} vascularity — IOTA suspicious features; further characterization advised.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": true}, {"key": "vascularity", "label": "Doppler vascularity", "type": "select", "options": ["minimal", "moderate", "marked"], "default": "moderate", "required": true}]', 50),
  ('Ovarian Lesions', 'Dermoid (Mature Cystic Teratoma)', 'A well-defined lesion with a hyperechoic component showing posterior acoustic shadowing (Rokitansky nodule) and diffuse or focal fine echogenic foci (''dermoid mesh''/tip-of-the-iceberg sign), with no significant internal vascularity, is noted in the {side} ovary, measuring approximately {sizeMm} mm, in keeping with a mature cystic teratoma (dermoid).', '{side} dermoid cyst (mature cystic teratoma), {sizeMm} mm.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "sizeMm", "label": "Size (mm)", "type": "text", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Infertility (Infertility)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Infertility', 'Hydrosalpinx (Tubal Factor)', 'A dilated, tortuous, fluid-filled tubular structure with incomplete septa (''cogwheel'' sign) is noted in the adnexa, separate from the ovary, in keeping with hydrosalpinx — a likely cause of tubal-factor infertility.', 'Hydrosalpinx — likely tubal-factor infertility; HSG/laparoscopic correlation advised.', 10),
  ('Infertility', 'Endometrium Unfavourable for Implantation', 'Endometrium is thin (under 7 mm) and/or non-trilaminar for the reported cycle day, which may be unfavourable for implantation.', 'Thin/non-trilaminar endometrium — correlate with cycle day and consider further endometrial receptivity workup.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Infertility', 'Baseline Infertility Survey - Normal', 'Uterus is normal in size, position, and myometrial echotexture with no congenital anomaly. Endometrium measures {endoThicknessMm} mm. Right ovary shows an antral follicle count of {rightAFC} (2-9 mm), normal volume. Left ovary shows an antral follicle count of {leftAFC} (2-9 mm), normal volume. No hydrosalpinx or adnexal mass. No free fluid.', 'Normal baseline infertility survey; bilateral antral follicle count within normal range (right {rightAFC}, left {leftAFC}).', '[{"key": "rightAFC", "label": "Right AFC", "type": "text", "required": true}, {"key": "leftAFC", "label": "Left AFC", "type": "text", "required": true}, {"key": "endoThicknessMm", "label": "Endometrial thickness (mm)", "type": "text", "required": true}]', 30),
  ('Infertility', 'Polycystic Ovarian Morphology (PCOM)', 'Right ovary shows {rightCount} peripherally arranged follicles (2-9 mm) with increased ovarian volume and stromal echogenicity. Left ovary shows {leftCount} peripherally arranged follicles (2-9 mm) with increased ovarian volume and stromal echogenicity, meeting PCOM criteria (20 or more follicles per ovary and/or ovarian volume of 10 mL or more, per current international PCOS ultrasound consensus).', 'Bilateral polycystic ovarian morphology (PCOM) — correlate clinically/biochemically for PCOS (Rotterdam criteria require 2 of 3: oligo/anovulation, clinical/biochemical hyperandrogenism, PCOM).', '[{"key": "rightCount", "label": "Right — follicle count", "type": "text", "required": true}, {"key": "leftCount", "label": "Left — follicle count", "type": "text", "required": true}]', 40),
  ('Infertility', 'Diminished Ovarian Reserve Pattern', 'Both ovaries are reduced in volume with a low combined antral follicle count (right {rightAFC}, left {leftAFC}), in keeping with diminished ovarian reserve.', 'Sonographic features of diminished ovarian reserve — correlate with AMH/FSH.', '[{"key": "rightAFC", "label": "Right AFC", "type": "text", "required": true}, {"key": "leftAFC", "label": "Left AFC", "type": "text", "required": true}]', 50),
  ('Infertility', 'Congenital Uterine Anomaly Suspected', 'The endometrial cavity/uterine fundal contour demonstrates a configuration suggestive of a {type} uterus. 3D ultrasound or MR correlation is advised for definitive subclassification.', 'Suspected {type} uterus — further characterization (3D USG/MRI/hysterosalpingography) advised.', '[{"key": "type", "label": "Suspected anomaly type", "type": "select", "options": ["septate", "bicornuate", "arcuate", "unicornuate", "didelphys"], "default": "septate", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Early Pregnancy (Early Pregnancy)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Early Pregnancy', 'Normal Adnexa', 'Both ovaries are normal in size and echotexture. No adnexal mass is identified.', 'No adnexal abnormality.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Early Pregnancy', 'Normal Intrauterine Gestational Sac', 'A single intrauterine gestational sac is seen in the {location}, measuring {gs} mm in mean diameter, with a well-formed yolk sac measuring {ys} mm.', 'Single intrauterine gestational sac, GS {gs} mm.', '[{"key": "location", "label": "Location", "type": "select", "options": ["fundal", "mid-cavity", "lower uterine segment"], "default": "fundal"}, {"key": "gs", "label": "GS mean diameter (mm)", "type": "text", "default": "", "required": true}, {"key": "ys", "label": "YS diameter (mm)", "type": "text", "default": "", "required": true}]', 20),
  ('Early Pregnancy', 'Live Embryo with Cardiac Activity', 'A single live embryo is identified with a crown-rump length of {crl} mm, corresponding to CRL-based gestational age. Cardiac activity is present, with a fetal heart rate of {fhr} bpm.', 'Single live intrauterine pregnancy, CRL {crl} mm, cardiac activity present.', '[{"key": "crl", "label": "CRL (mm)", "type": "text", "default": "", "required": true}, {"key": "fhr", "label": "Fetal heart rate (bpm)", "type": "text", "default": "", "required": true}]', 30),
  ('Early Pregnancy', 'Twin Gestation Sacs Identified', 'Two intrauterine gestational sacs are identified, {chorionicity}. Detailed per-fetus biometry and formal chorionicity assessment are recommended.', 'Twin intrauterine pregnancy, {chorionicity} — see Multiple Pregnancy protocol for detailed follow-up.', '[{"key": "chorionicity", "label": "Chorionicity/amnionicity (provisional)", "type": "select", "options": ["dichorionic diamniotic", "monochorionic diamniotic", "monochorionic monoamniotic", "indeterminate at this stage"], "default": "indeterminate at this stage", "required": true}]', 40),
  ('Early Pregnancy', 'Corpus Luteal Cyst', 'A simple thin-walled cystic structure is noted in the {side} adnexa, measuring {size} mm, in keeping with a corpus luteal cyst of pregnancy.', '{side} corpus luteal cyst of pregnancy, {size} mm — physiological, no follow-up required unless symptomatic.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": "", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Dating (Dating)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Dating', 'Too Early to Date by CRL', 'Only a gestational sac is visualised without a definite embryonic pole; a reliable CRL cannot be obtained at this stage.', 'Pregnancy too early for CRL-based dating — correlate with LMP and repeat scan in 7–10 days.', 10),
  ('Dating', 'Single Live Intrauterine Pregnancy — Consistent with Dates', 'A single live intrauterine pregnancy is confirmed, consistent with menstrual dates.', 'Single live intrauterine pregnancy consistent with dates.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Dating', 'CRL-Based Dating', 'Crown-rump length measures {crl} mm. Based on CRL (Robinson & Fleming formula), the estimated gestational age is {ga} and the estimated date of delivery is {edd}.', 'Singleton intrauterine pregnancy dated by CRL at {ga}; EDD {edd}.', '[{"key": "crl", "label": "CRL (mm)", "type": "text", "default": "", "required": true}, {"key": "ga", "label": "Gestational age (CRL-based)", "type": "text", "default": "", "required": true}, {"key": "edd", "label": "EDD", "type": "text", "default": "", "required": true}]', 30),
  ('Dating', 'Dating Discordant from LMP', 'CRL-based gestational age of {gaCrl} differs from the LMP-based gestational age of {gaLmp} by more than 7 days. Per standard first-trimester dating criteria, {action}.', 'Dating discordance between CRL and LMP of more than 7 days; {action}.', '[{"key": "gaLmp", "label": "LMP-based GA", "type": "text", "default": ""}, {"key": "gaCrl", "label": "CRL-based GA", "type": "text", "default": ""}, {"key": "action", "label": "Dating decision", "type": "select", "options": ["EDD is revised to the CRL-based estimate", "LMP-based EDD is retained given a reliable menstrual history"], "default": "EDD is revised to the CRL-based estimate", "required": true}]', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Viability (Viability)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Viability', 'Too Early to Assess Viability', 'An intrauterine gestational sac is seen but is too small/early to confirm or exclude a yolk sac or embryonic pole with certainty at this visit.', 'Indeterminate viability at this stage — repeat ultrasound in 7–10 days recommended before a non-viability diagnosis is made.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Viability', 'Confirmed Viable Intrauterine Pregnancy', 'A live intrauterine embryo is seen with a crown-rump length of {crl} mm and cardiac activity present at {fhr} bpm.', 'Viable intrauterine pregnancy, CRL {crl} mm.', '[{"key": "crl", "label": "CRL (mm)", "type": "text", "default": "", "required": true}, {"key": "fhr", "label": "Fetal heart rate (bpm)", "type": "text", "default": "", "required": true}]', 20),
  ('Viability', 'Non-Viable Pregnancy', '{findingType} is demonstrated, consistent with a non-viable intrauterine pregnancy per SRU diagnostic criteria.', 'Findings consistent with a non-viable intrauterine pregnancy.', '[{"key": "findingType", "label": "Non-viability criterion met", "type": "select", "options": ["No cardiac activity in an embryo with CRL ≥ 7 mm", "Empty gestational sac with mean sac diameter ≥ 25 mm and no embryo or yolk sac", "No embryo with cardiac activity ≥ 2 weeks after a scan showing a sac without a yolk sac", "No embryo with cardiac activity ≥ 11 days after a scan showing a sac with a yolk sac"], "default": "No cardiac activity in an embryo with CRL ≥ 7 mm", "required": true}]', 30),
  ('Viability', 'Subchorionic Hematoma', 'A crescentic anechoic to hypoechoic collection is noted between the chorionic membrane and myometrium at the {location} aspect of the gestational sac, measuring approximately {size} mm, in keeping with a subchorionic hematoma. {viability}.', 'Subchorionic hematoma, {location}, {size} mm. {viability}.', '[{"key": "location", "label": "Location", "type": "select", "options": ["superior", "inferior", "marginal", "retroplacental"], "default": "marginal", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": "", "required": true}, {"key": "viability", "label": "Embryo status", "type": "select", "options": ["The embryo is viable with cardiac activity present", "Non-viable — see separate Non-Viable Pregnancy finding"], "default": "The embryo is viable with cardiac activity present", "required": true}]', 40),
  ('Viability', 'Pregnancy of Unknown Location', 'No definite intrauterine or extrauterine gestational sac is identified despite a positive pregnancy test. Endometrium appears {endo}.', 'Pregnancy of unknown location — serial β-hCG and repeat ultrasound in 48–72 hours recommended to differentiate a very early intrauterine pregnancy, ectopic pregnancy, and complete miscarriage.', '[{"key": "endo", "label": "Endometrial appearance", "type": "select", "options": ["unremarkable", "thickened", "showing a decidual reaction"], "default": "unremarkable", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- NT (NT)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('NT', 'NT Measurement', 'Nuchal translucency measures {ntMm} mm. Nasal bone is {nasalBone}.', 'NT {ntMm} mm.', '[{"key": "ntMm", "label": "NT (mm)", "type": "text", "default": "", "required": true}, {"key": "nasalBone", "label": "Nasal bone", "type": "select", "options": ["present", "absent", "hypoplastic"], "default": "present"}]', 10),
  ('NT', 'Increased Nuchal Translucency', 'Nuchal translucency measures {ntMm} mm, at or above the 3.5 mm threshold associated with increased aneuploidy and structural/cardiac-anomaly risk.', 'Increased NT ({ntMm} mm) — genetic counselling, combined or cell-free DNA screening, and a detailed cardiac and anomaly scan are recommended.', '[{"key": "ntMm", "label": "NT (mm)", "type": "text", "default": "", "required": true}]', 20),
  ('NT', 'Ductus Venosus Doppler', 'Ductus venosus Doppler shows a {dv}.', 'Ductus venosus a-wave: {dv}.', '[{"key": "dv", "label": "DV a-wave", "type": "select", "options": ["Normal (positive a-wave)", "Absent a-wave", "Reversed a-wave"], "default": "Normal (positive a-wave)", "required": true}]', 30),
  ('NT', 'Tricuspid Regurgitation', 'Tricuspid regurgitation is {tr} on colour/pulsed Doppler across the tricuspid valve.', 'Tricuspid regurgitation {tr} — an additional first-trimester soft marker for aneuploidy/cardiac anomaly risk when present.', '[{"key": "tr", "label": "Tricuspid regurgitation", "type": "select", "options": ["Absent", "Present"], "default": "Absent", "required": true}]', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Anomaly (Anomaly)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Anomaly', 'Normal Anomaly Survey', 'Fetal cranium, spine, cardiac four-chamber and outflow views, abdominal wall, stomach, kidneys, bladder, and limbs were surveyed and appear structurally normal for gestational age.', 'No sonographically detectable structural anomaly.', 10),
  ('Anomaly', 'Single Umbilical Artery', 'Only one umbilical artery is identified alongside the umbilical vein on cross-section of a free loop of cord, in keeping with a single umbilical artery.', 'Single umbilical artery — associated structural anomaly should be specifically excluded and a follow-up growth scan is recommended.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Anomaly', 'Choroid Plexus Cyst', 'A choroid plexus cyst is noted in the {side} lateral ventricle, measuring {size} mm.', '{side} choroid plexus cyst — an isolated finding is generally a normal variant; correlate with other soft markers and maternal age-adjusted risk.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": "", "required": true}]', 30),
  ('Anomaly', 'Echogenic Intracardiac Focus', 'A small echogenic focus is noted within the {side} cardiac ventricle, in keeping with an echogenic intracardiac focus.', '{side} echogenic intracardiac focus — an isolated finding is a common normal variant; correlate with other soft markers.', '[{"key": "side", "label": "Side", "type": "select", "options": ["left", "right", "bilateral"], "default": "left", "required": true}]', 40),
  ('Anomaly', 'Renal Pelvis Dilation (Pyelectasis)', 'The renal pelvis of the {side} kidney measures {size} mm in antero-posterior diameter.', '{side} mild pyelectasis — third-trimester follow-up ultrasound recommended to exclude progression.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": "", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Growth (Growth)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Growth', 'Growth Appropriate for GA', 'Fetal biometry corresponds to the established gestational age. Interval growth is appropriate.', 'Growth appropriate for gestational age.', 10),
  ('Growth', 'Fetal Growth Restriction', 'Fetal biometry is below the expected range for gestational age, suggestive of growth restriction.', 'Suspected fetal growth restriction — clinical correlation and Doppler assessment advised.', 20),
  ('Growth', 'Large for Gestational Age', 'Estimated fetal weight is above the 90th centile for gestational age, suggestive of macrosomia/large-for-gestational-age growth.', 'Large for gestational age — screen for maternal glucose intolerance if not already done; correlate clinically.', 30),
  ('Growth', 'Oligohydramnios', 'Amniotic fluid index measures less than 5 cm, in keeping with oligohydramnios.', 'Oligohydramnios — correlate clinically; closer antenatal surveillance advised.', 40),
  ('Growth', 'Polyhydramnios', 'Amniotic fluid index measures greater than 24–25 cm (or single deepest pocket >8 cm), in keeping with polyhydramnios.', 'Polyhydramnios — correlate clinically for maternal diabetes and fetal structural/swallowing causes.', 50)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Growth', 'FGR — Doppler Assessment', 'Fetal growth restriction is {type}. Umbilical artery PI is {uaPi} and MCA PI is {mcaPi}, giving a cerebroplacental ratio category of {category}.', '{type} fetal growth restriction with {category} Doppler pattern — closer surveillance advised as per obstetric team.', '[{"key": "type", "label": "Pattern", "type": "select", "options": ["symmetric", "asymmetric"], "default": "asymmetric", "required": true}, {"key": "uaPi", "label": "UA PI", "type": "text", "default": ""}, {"key": "mcaPi", "label": "MCA PI", "type": "text", "default": ""}, {"key": "category", "label": "Doppler category", "type": "select", "options": ["normal (no redistribution)", "brain-sparing (redistribution)", "absent/reversed end-diastolic flow"], "default": "normal (no redistribution)", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- BPP (BPP)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('BPP', 'Isolated Oligohydramnios on BPP', 'Amniotic fluid volume is reduced (AFI <5 cm or single deepest pocket <2 cm) despite otherwise reassuring biophysical parameters.', 'Isolated oligohydramnios — obstetric correlation advised regardless of the overall BPP score.', 10),
  ('BPP', 'Extended Observation for Absent Breathing/Movement', 'Fetal breathing movements and gross body movements were not observed in the initial observation window; observation was extended to 30–40 minutes per standard biophysical profile protocol before scoring.', 'Extended observation performed for absent breathing/movement; see the final biophysical profile score.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('BPP', 'Biophysical Profile Assessment', 'Fetal breathing movements are {breathing}. Gross body movements are {movement}. Fetal tone is {tone}. Amniotic fluid volume is {afi}.[ Non-stress test is {nst}.] Biophysical profile score: {score}/10.', 'Biophysical profile score {score}/10 — reassuring fetal status.', '[{"key": "breathing", "label": "Breathing movements", "type": "select", "options": ["Present", "Absent"], "default": "Present", "required": true}, {"key": "movement", "label": "Gross body movements", "type": "select", "options": ["Present", "Absent"], "default": "Present", "required": true}, {"key": "tone", "label": "Fetal tone", "type": "select", "options": ["Present", "Absent"], "default": "Present", "required": true}, {"key": "afi", "label": "Amniotic fluid volume", "type": "select", "options": ["Normal", "Reduced"], "default": "Normal", "required": true}, {"key": "nst", "label": "Non-stress test", "type": "select", "options": ["Reactive", "Non-reactive", "None"], "default": "Reactive"}, {"key": "score", "label": "BPP score (/10)", "type": "text", "default": "", "required": true}]', 30),
  ('BPP', 'Low BPP Score — Action Required', 'Biophysical profile score is {score}/10, raising concern for possible fetal compromise. {management}.', 'Low biophysical profile score ({score}/10) — {management}.', '[{"key": "score", "label": "BPP score (/10)", "type": "text", "default": "", "required": true}, {"key": "management", "label": "Recommended action", "type": "select", "options": ["Repeat BPP within 24 hours", "Urgent obstetric consultation and delivery planning advised"], "default": "Urgent obstetric consultation and delivery planning advised", "required": true}]', 40),
  ('BPP', 'Modified BPP (AFI + NST)', 'A modified biophysical profile comprising amniotic fluid index and non-stress test only was performed. Amniotic fluid volume is {afi} and non-stress test is {nst}.', 'Modified BPP: amniotic fluid {afi}, NST {nst}.', '[{"key": "afi", "label": "Amniotic fluid volume", "type": "select", "options": ["Normal", "Reduced", "Increased"], "default": "Normal", "required": true}, {"key": "nst", "label": "Non-stress test", "type": "select", "options": ["Reactive", "Non-reactive"], "default": "Reactive", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Cervical Length (Cervical Length)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Cervical Length', 'Short Cervix (<25 mm)', 'Transvaginal cervical length measures less than 25 mm, meeting criteria for a short cervix at this gestational age.', 'Short cervix — increased risk of preterm birth. Obstetric correlation for vaginal progesterone or cerclage evaluation as clinically indicated.', 10),
  ('Cervical Length', 'Borderline Cervical Length (25–29 mm)', 'Transvaginal cervical length measures 25–29 mm, in the borderline range for this gestational age.', 'Borderline cervical length — interval rescan in 1–2 weeks as clinically advised.', 20),
  ('Cervical Length', 'Funneling with Membrane Prolapse', 'The amniotic membranes are seen prolapsing through a dilated internal os into the proximal endocervical canal (''hourglass'' membranes).', 'Advanced cervical funneling with membrane prolapse — urgent obstetric correlation advised.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Cervical Length', 'Cervical Length Measurement', 'Transvaginal cervical length measures {cl} mm.[ {funneling}.]', 'Cervical length {cl} mm.[ {funneling}.]', '[{"key": "cl", "label": "Cervical length (mm)", "type": "text", "default": "", "required": true}, {"key": "funneling", "label": "Funneling", "type": "select", "options": ["Normal", "Funneling of the internal os is present, with cervical canal shortening toward the external os"], "default": "Normal"}]', 40),
  ('Cervical Length', 'Cervical Length — Post-Cerclage', 'Cervical length measures {cl} mm distal to a cervical cerclage suture, which is seen in situ.', 'Post-cerclage cervical length {cl} mm.', '[{"key": "cl", "label": "Cervical length distal to cerclage (mm)", "type": "text", "default": "", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Multiple Pregnancy (Multiple Pregnancy)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Multiple Pregnancy', 'Monochorionic Diamniotic Twin Pregnancy', 'A single placental mass is shared by both fetuses, with a thin intervening dividing membrane demonstrating a T-sign at the membrane-placental junction, in keeping with monochorionic diamniotic (MCDA) twin pregnancy.', 'Monochorionic diamniotic twin pregnancy — requires closer-interval surveillance including TTTS screening.', 10),
  ('Multiple Pregnancy', 'Monochorionic Monoamniotic Twin Pregnancy', 'No intervening membrane is identified between the two fetuses, which share a single amniotic sac, in keeping with monochorionic monoamniotic (MCMA) twin pregnancy. Umbilical cord entanglement should be specifically assessed with colour Doppler.', 'Monochorionic monoamniotic twin pregnancy — high-risk; cord entanglement assessment and closely spaced surveillance required.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Multiple Pregnancy', 'Dichorionic Diamniotic Twin Pregnancy', 'Two separate gestational sacs are identified, each with its own placenta. A thick intervening membrane demonstrating a {sign} is seen at the placental-membrane junction, in keeping with dichorionic diamniotic (DCDA) twin pregnancy.', 'Dichorionic diamniotic twin pregnancy.', '[{"key": "sign", "label": "Membrane sign", "type": "select", "options": ["lambda (twin peak) sign", "thick membrane, two separate placentas"], "default": "lambda (twin peak) sign", "required": true}]', 30),
  ('Multiple Pregnancy', 'Fetal Growth Discordance <20%', 'Estimated fetal weight is {efwA} g for Twin A and {efwB} g for Twin B, an inter-twin discordance of {discordancePercent}%, within the expected range.', 'Inter-twin EFW discordance {discordancePercent}% — not significant.', '[{"key": "efwA", "label": "Twin A EFW (g)", "type": "text", "default": "", "required": true}, {"key": "efwB", "label": "Twin B EFW (g)", "type": "text", "default": "", "required": true}, {"key": "discordancePercent", "label": "Discordance (%)", "type": "text", "default": "", "required": true}]', 40),
  ('Multiple Pregnancy', 'Fetal Growth Discordance ≥20%', 'Estimated fetal weight is {efwA} g for Twin A and {efwB} g for Twin B, an inter-twin discordance of {discordancePercent}%, exceeding the 20% threshold associated with adverse perinatal outcome.', 'Significant inter-twin growth discordance ({discordancePercent}%) — obstetric correlation and closer surveillance advised; exclude selective FGR/TTTS in monochorionic pregnancies.', '[{"key": "efwA", "label": "Twin A EFW (g)", "type": "text", "default": "", "required": true}, {"key": "efwB", "label": "Twin B EFW (g)", "type": "text", "default": "", "required": true}, {"key": "discordancePercent", "label": "Discordance (%)", "type": "text", "default": "", "required": true}]', 50),
  ('Multiple Pregnancy', 'TTTS Screening — Monochorionic Twins', 'In this monochorionic twin pregnancy, the donor twin''s amniotic fluid (single deepest pocket) is {donorAfi} and the recipient twin''s amniotic fluid is {recipientAfi}.[ Quintero staging: {stage}.]', 'Monochorionic twin pregnancy — TTTS screening performed.[ Quintero {stage}.]', '[{"key": "donorAfi", "label": "Donor twin fluid (SDP/AFI)", "type": "text", "default": "", "required": true}, {"key": "recipientAfi", "label": "Recipient twin fluid (SDP/AFI)", "type": "text", "default": "", "required": true}, {"key": "stage", "label": "Quintero stage", "type": "select", "options": ["None", "Stage I", "Stage II", "Stage III", "Stage IV/V"], "default": "None", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Thyroid (Thyroid)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Thyroid', 'Diffuse Goiter', 'Both thyroid lobes are diffusely enlarged with heterogeneous echotexture, in keeping with a diffuse goiter. No discrete nodule.', 'Diffuse goiter.', 10),
  ('Thyroid', 'Hashimoto Thyroiditis', 'Both thyroid lobes are diffusely enlarged with heterogeneous, coarse hypoechoic echotexture and multiple thin fibrous septations giving a micronodular (''giraffe skin'') pattern, with increased vascularity on colour Doppler, in keeping with chronic lymphocytic (Hashimoto) thyroiditis.', 'Sonographic features in keeping with Hashimoto (chronic lymphocytic) thyroiditis.', 20),
  ('Thyroid', 'Thyroid Colloid Cyst', 'A well-defined anechoic to hypoechoic cystic lesion showing a few punctate echogenic foci with ''comet-tail'' reverberation artifact is noted, consistent with a benign colloid nodule, TI-RADS 2.', 'Colloid cyst, TI-RADS 2 (benign).', 30),
  ('Thyroid', 'Multinodular Goiter', 'Multiple nodules of varying size and composition are noted in both diffusely enlarged lobes, in keeping with a multinodular goiter. The dominant/most suspicious nodule is separately characterised above where applicable.', 'Multinodular goiter.', 40)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Thyroid', 'Thyroid Nodule', 'A {composition} nodule is noted in the {side} lobe, measuring approximately {size} mm, TI-RADS {tirads}.', '{side} thyroid nodule, TI-RADS {tirads}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "composition", "label": "Composition", "type": "select", "options": ["solid", "cystic", "mixed solid-cystic"], "default": "solid"}, {"key": "size", "label": "Size (mm)", "type": "text", "default": ""}, {"key": "tirads", "label": "TI-RADS category", "type": "select", "options": ["2", "3", "4", "5"], "default": "3", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Breast (Breast)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Breast', 'Simple Breast Cyst', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted, showing no internal echoes, septations, or mural nodularity.', 'Simple breast cyst, BI-RADS 2.', 10),
  ('Breast', 'Complicated Breast Cyst', 'A cystic lesion with low-level internal echoes and mobile debris is noted, without a discrete solid mural component or internal vascularity, in keeping with a complicated cyst, BI-RADS 3.', 'Complicated breast cyst, BI-RADS 3.', 20),
  ('Breast', 'Breast Abscess / Mastitis', 'A heterogeneous, predominantly hypoechoic collection with internal debris, septations, and surrounding hyperaemic, oedematous parenchyma is noted, in keeping with a breast abscess with associated mastitis.', 'Breast abscess with mastitis.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Breast', 'Solid Breast Lesion', 'A {shape} solid hypoechoic lesion is noted in the {side} breast, measuring approximately {size} mm, BI-RADS {birads}.', '{side} breast lesion, BI-RADS {birads}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "shape", "label": "Shape", "type": "select", "options": ["oval", "round", "irregular"], "default": "oval"}, {"key": "size", "label": "Size (mm)", "type": "text", "default": ""}, {"key": "birads", "label": "BI-RADS category", "type": "select", "options": ["2", "3", "4", "5"], "default": "3", "required": true}]', 40),
  ('Breast', 'Suspicious Axillary Lymph Node', 'An enlarged {side} axillary lymph node is noted, measuring approximately {size} mm, showing {feature}.', '{side} axillary lymphadenopathy — {feature}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "size", "label": "Size (mm)", "type": "text", "default": ""}, {"key": "feature", "label": "Morphology", "type": "select", "options": ["preserved fatty hilum, uniform thin cortex (reactive)", "eccentric cortical thickening with loss of fatty hilum (suspicious)"], "default": "preserved fatty hilum, uniform thin cortex (reactive)"}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Scrotum (Scrotum)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Scrotum', 'Hydrocele', 'Anechoic fluid collection is noted around the testis within the tunica vaginalis.', 'Hydrocele.', 10),
  ('Scrotum', 'Epididymo-orchitis', 'Epididymis and testis show increased size with increased vascularity on colour Doppler, in keeping with epididymo-orchitis.', 'Epididymo-orchitis.', 20),
  ('Scrotum', 'Testicular Microlithiasis', 'Multiple, non-shadowing echogenic foci, each less than 3 mm, are scattered diffusely throughout the testicular parenchyma bilaterally, in keeping with testicular microlithiasis.', 'Bilateral testicular microlithiasis.', 30),
  ('Scrotum', 'Epididymal Cyst / Spermatocele', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the epididymal head, showing no internal vascularity, in keeping with an epididymal cyst/spermatocele.', 'Epididymal cyst (spermatocele).', 40)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Scrotum', 'Varicocele', 'Dilated, tortuous veins of the pampiniform plexus are noted in the {side} hemiscrotum, showing reversal of flow with Valsalva, in keeping with a Grade {grade} varicocele.', '{side} Grade {grade} varicocele.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "left", "required": true}, {"key": "grade", "label": "Grade", "type": "select", "options": ["I", "II", "III"], "default": "II"}]', 50),
  ('Scrotum', 'Testicular Torsion', 'The {side} testis is enlarged and heterogeneous in echotexture with {flow} intratesticular vascularity on colour Doppler compared with the contralateral side, and a whirlpool sign is noted at the spermatic cord — findings concerning for testicular torsion.', 'CRITICAL — sonographic findings concerning for {side} testicular torsion; immediate urological correlation advised.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "flow", "label": "Vascularity", "type": "select", "options": ["absent", "markedly reduced"], "default": "absent", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Neck (Neck)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Neck', 'Sialadenitis', 'The gland is diffusely enlarged and hypoechoic with increased vascularity on colour Doppler, without a discrete calculus or ductal dilatation, in keeping with acute sialadenitis.', 'Sialadenitis.', 10),
  ('Neck', 'Branchial Cleft Cyst', 'A well-defined, thin-walled anechoic to low-level-echo cystic lesion is noted along the anterior border of the sternocleidomastoid muscle, deep to the angle of the mandible, without significant internal vascularity, in keeping with a second branchial cleft cyst.', 'Branchial cleft cyst.', 20),
  ('Neck', 'Thyroglossal Duct Cyst', 'A well-defined anechoic to hypoechoic midline cystic lesion is noted anterior to the strap muscles at the level of the hyoid bone, which moves with tongue protrusion/swallowing, in keeping with a thyroglossal duct cyst.', 'Thyroglossal duct cyst.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Neck', 'Reactive Cervical Lymphadenopathy', 'Multiple mildly enlarged, oval, {side} level {level} cervical lymph nodes are noted, up to {size} mm in short axis, each with a preserved echogenic fatty hilum and normal flattened shape — reactive in nature.', '{side} level {level} reactive cervical lymphadenopathy.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "level", "label": "Nodal level", "type": "select", "options": ["I", "II", "III", "IV", "V", "VI"], "default": "II"}, {"key": "size", "label": "Size (mm, short axis)", "type": "text", "default": ""}]', 40),
  ('Neck', 'Suspicious Cervical Lymph Node', 'A rounded {side} level {level} cervical lymph node is noted, measuring approximately {size} mm in short axis, with loss of the normal fatty hilum, eccentric cortical thickening, and increased peripheral/mixed vascularity on colour Doppler — suspicious for metastatic or lymphomatous involvement.', 'CRITICAL — {side} level {level} cervical lymph node suspicious for malignant involvement; clinical correlation ± FNAC advised.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "level", "label": "Nodal level", "type": "select", "options": ["I", "II", "III", "IV", "V", "VI"], "default": "III"}, {"key": "size", "label": "Size (mm, short axis)", "type": "text", "default": ""}]', 50),
  ('Neck', 'Sialolithiasis', 'An echogenic focus with posterior acoustic shadowing is noted within the {side} {gland} gland, with mild upstream ductal dilatation, in keeping with sialolithiasis.', '{side} {gland} sialolithiasis.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "gland", "label": "Gland", "type": "select", "options": ["submandibular", "parotid"], "default": "submandibular", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- MSK (MSK)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('MSK', 'Supraspinatus Tendinopathy', 'The supraspinatus tendon is diffusely thickened and hypoechoic with loss of the normal fibrillar echotexture, without a discrete focal tear, in keeping with tendinopathy.', 'Supraspinatus tendinopathy.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('MSK', 'Rotator Cuff Tear', 'A {tearType} tear of the {side} supraspinatus tendon is noted, with a defect measuring approximately {size} mm and associated tendon retraction/discontinuity.', '{side} supraspinatus {tearType} tear.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "tearType", "label": "Tear type", "type": "select", "options": ["partial-thickness (articular surface)", "partial-thickness (bursal surface)", "full-thickness"], "default": "full-thickness", "required": true}, {"key": "size", "label": "Defect size (mm)", "type": "text", "default": ""}]', 20),
  ('MSK', 'Achilles Tendinopathy / Partial Tear', 'The {side} Achilles tendon is thickened and hypoechoic with loss of the normal fibrillar pattern, in keeping with {severity}. No full-thickness discontinuity is identified.', '{side} Achilles {severity}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "severity", "label": "Severity", "type": "select", "options": ["tendinosis (fusiform thickening, no discrete tear)", "partial-thickness tear"], "default": "tendinosis (fusiform thickening, no discrete tear)", "required": true}]', 30),
  ('MSK', 'Ankle Ligament Injury (ATFL)', 'The {side} anterior talofibular ligament (ATFL) is thickened and hypoechoic, in keeping with {grade}, with associated anterolateral ankle joint effusion.', '{side} ATFL injury — {grade}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "grade", "label": "Grade", "type": "select", "options": ["Grade I (sprain, no discontinuity)", "Grade II (partial tear)", "Grade III (complete tear)"], "default": "Grade I (sprain, no discontinuity)", "required": true}]', 40),
  ('MSK', 'Knee Joint Effusion', 'Anechoic fluid is noted within the {side} suprapatellar recess, {quantity} in quantity, with no significant synovial thickening or intra-articular loose body.', '{side} {quantity} knee joint effusion.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "quantity", "label": "Quantity", "type": "select", "options": ["mild", "moderate", "gross"], "default": "mild", "required": true}]', 50),
  ('MSK', 'Carpal Tunnel Syndrome', 'The {side} median nerve is swollen and hypoechoic at the level of the carpal tunnel inlet, measuring approximately {csa} mm2 in cross-sectional area, with flattening of the nerve at the tunnel outlet, in keeping with median nerve entrapment (carpal tunnel syndrome).', '{side} carpal tunnel syndrome (median nerve entrapment).', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "csa", "label": "Median nerve CSA (mm2)", "type": "text", "default": ""}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Carotid Doppler (Carotid Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Carotid Doppler', 'Normal Carotid Study', 'Both common, internal, and external carotid arteries and both vertebral arteries show normal calibre with smooth intimal surfaces and no significant atherosclerotic plaque. Carotid intima-media thickness is within normal limits bilaterally. Peak systolic velocities are within normal limits with no evidence of haemodynamically significant stenosis.', 'Normal carotid Doppler study. No haemodynamically significant carotid stenosis.', 10),
  ('Carotid Doppler', 'Elevated IMT', 'Carotid intima-media thickness is diffusely increased bilaterally, without discrete focal plaque, in keeping with early atherosclerotic change.', 'Bilateral carotid intima-media thickening — increased cardiovascular risk marker.', 20)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Carotid Doppler', 'Carotid Plaque', 'A {morphology} atherosclerotic plaque with a {surface} surface is noted at the {side} {location}, causing non-flow-limiting luminal narrowing with ICA peak systolic velocity within normal limits.', '{side} {location} carotid plaque ({morphology}) without haemodynamically significant stenosis.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "location", "label": "Location", "type": "select", "options": ["carotid bulb", "proximal ICA", "CCA", "ECA"], "default": "carotid bulb"}, {"key": "morphology", "label": "Morphology", "type": "select", "options": ["homogeneous echolucent (soft)", "heterogeneous mixed", "densely calcified"], "default": "heterogeneous mixed"}, {"key": "surface", "label": "Surface", "type": "select", "options": ["smooth", "irregular", "ulcerated"], "default": "smooth"}]', 30),
  ('Carotid Doppler', 'ICA Stenosis (Velocity-Graded)', '{side} internal carotid artery shows an atherosclerotic plaque causing luminal narrowing, with ICA PSV of {psv} cm/s and an ICA/CCA ratio of {ratio}, in keeping with {grade} stenosis by velocity criteria (NASCET/SRU consensus).', '{side} ICA stenosis, {grade} by velocity criteria.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "grade", "label": "Grade", "type": "select", "options": ["<50%", "50-69%", "70-99% (severe)", "near-occlusion", "total occlusion"], "default": "50-69%", "required": true}, {"key": "psv", "label": "ICA PSV (cm/s)", "type": "text", "default": ""}, {"key": "ratio", "label": "ICA/CCA Ratio", "type": "text", "default": ""}]', 40),
  ('Carotid Doppler', 'Vertebral Artery Flow Reversal', 'The {side} vertebral artery shows reversed (retrograde) flow directed away from the brainstem, in keeping with subclavian steal physiology.', '{side} vertebral artery flow reversal — subclavian steal.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}]', 50),
  ('Carotid Doppler', 'Carotid Occlusion', 'The {side} {vessel} shows no colour or spectral flow with echogenic intraluminal material filling the lumen, in keeping with complete occlusion.', '{side} {vessel} occlusion.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "vessel", "label": "Vessel", "type": "select", "options": ["ICA", "CCA"], "default": "ICA"}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Venous Doppler (Venous Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Venous Doppler', 'Normal Venous Study', 'The common femoral, femoral, popliteal, and calf veins are normal in calibre, fully compressible, and show normal phasic flow and augmentation. The great and small saphenous veins are competent with no pathological reflux.', 'No evidence of deep vein thrombosis. Competent superficial venous system.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Venous Doppler', 'Acute DVT', 'The {side} {segment} is non-compressible and distended with echogenic intraluminal thrombus, {morphology}, in keeping with acute deep vein thrombosis.', 'Acute DVT involving the {side} {segment} ({morphology}).', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "segment", "label": "Segment", "type": "select", "options": ["common femoral vein", "femoral vein", "popliteal vein", "calf veins (posterior tibial/peroneal)"], "default": "femoral vein", "required": true}, {"key": "morphology", "label": "Thrombus morphology", "type": "select", "options": ["occlusive with absent flow throughout", "non-occlusive with a mobile free-floating component and preserved peripheral flow — embolisation risk"], "default": "occlusive with absent flow throughout", "required": true}]', 20),
  ('Venous Doppler', 'Chronic DVT', 'The {side} {segment} shows a partially compressible, thickened, echogenic wall with recanalised flow and collateral venous channels, in keeping with chronic (post-thrombotic) changes.', 'Chronic post-thrombotic changes in the {side} {segment}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "segment", "label": "Segment", "type": "select", "options": ["common femoral vein", "femoral vein", "popliteal vein", "calf veins (posterior tibial/peroneal)"], "default": "femoral vein", "required": true}]', 30),
  ('Venous Doppler', 'Superficial Venous Reflux (Varicose Veins)', 'The {side} {vein} is dilated and tortuous with reflux duration exceeding 0.5 seconds on Valsalva and calf compression, in keeping with superficial venous incompetence.', '{side} {vein} incompetence with varicose veins.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "vein", "label": "Vein", "type": "select", "options": ["great saphenous vein", "small saphenous vein", "perforator vein"], "default": "great saphenous vein"}]', 40),
  ('Venous Doppler', 'Superficial Thrombophlebitis', 'A segment of the superficial venous system in the {side} limb is non-compressible with echogenic thrombus and surrounding hyperaemia, in keeping with superficial thrombophlebitis. The deep venous system is patent.', '{side} superficial thrombophlebitis. Deep veins patent.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}]', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Arterial Doppler (Arterial Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Arterial Doppler', 'Normal Arterial Study', 'The common femoral, superficial femoral, popliteal, and infrapopliteal arteries are normal in calibre with a normal triphasic waveform and no significant plaque or stenosis. Ankle-brachial index is within normal limits.', 'Normal peripheral arterial Doppler study. No haemodynamically significant stenosis. ABI within normal limits.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Arterial Doppler', 'Arterial Stenosis', 'The {side} {vessel} shows an atherosclerotic plaque with focal velocity elevation and post-stenotic turbulence, in keeping with {grade} stenosis.', '{side} {vessel} stenosis, {grade}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "vessel", "label": "Vessel", "type": "select", "options": ["common femoral artery", "superficial femoral artery", "popliteal artery", "anterior tibial artery", "posterior tibial artery", "peroneal artery"], "default": "superficial femoral artery", "required": true}, {"key": "grade", "label": "Grade", "type": "select", "options": ["<50%", "50-75%", "76-99% (severe)"], "default": "50-75%", "required": true}]', 20),
  ('Arterial Doppler', 'Arterial Occlusion', 'The {side} {vessel} shows no colour or spectral flow throughout a segment measuring approximately {length} cm, {collaterals}, in keeping with occlusion.', '{side} {vessel} occlusion, approximately {length} cm in length — {collaterals}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "vessel", "label": "Vessel", "type": "select", "options": ["common femoral artery", "superficial femoral artery", "popliteal artery", "anterior tibial artery", "posterior tibial artery", "peroneal artery"], "default": "superficial femoral artery", "required": true}, {"key": "length", "label": "Occlusion length (cm)", "type": "text", "default": ""}, {"key": "collaterals", "label": "Distal reconstitution", "type": "select", "options": ["with reconstitution distally via collaterals (subacute/chronic)", "without distal reconstitution (acute — urgent, limb-threatening)"], "default": "with reconstitution distally via collaterals (subacute/chronic)", "required": true}]', 30),
  ('Arterial Doppler', 'Monophasic Waveform', 'The {side} {vessel} shows a dampened monophasic waveform with loss of the normal triphasic pattern, in keeping with proximal inflow disease.', 'Monophasic {side} {vessel} waveform — proximal inflow disease.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "vessel", "label": "Vessel", "type": "select", "options": ["common femoral artery", "superficial femoral artery", "popliteal artery"], "default": "common femoral artery"}]', 40),
  ('Arterial Doppler', 'Pseudoaneurysm', 'A well-defined anechoic sac is noted adjacent to the {side} {vessel} with a visible neck showing to-and-fro (''yin-yang'') flow on colour Doppler, in keeping with a pseudoaneurysm.', '{side} {vessel} pseudoaneurysm.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "vessel", "label": "Vessel", "type": "select", "options": ["common femoral artery", "superficial femoral artery", "popliteal artery"], "default": "common femoral artery"}]', 50),
  ('Arterial Doppler', 'Popliteal Artery Aneurysm', 'The {side} popliteal artery is aneurysmally dilated, measuring approximately {size} mm in AP diameter, with mural thrombus.', '{side} popliteal artery aneurysm, {size} mm.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "size", "label": "AP diameter (mm)", "type": "text", "default": ""}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Renal Doppler (Renal Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Renal Doppler', 'Normal Renal Doppler', 'Both main renal arteries show a normal low-resistance waveform with PSV and renal-aortic ratio within normal limits. Intrarenal arteries show a normal waveform with resistive index within normal limits. Both renal veins are patent.', 'No sonographic evidence of renal artery stenosis. Renal veins patent.', 10)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Renal Doppler', 'Renal Artery Stenosis', 'The {side} main renal artery shows elevated peak systolic velocity with a renal-aortic ratio ≥3.5 and post-stenotic turbulence, in keeping with {grade} renal artery stenosis.', '{side} renal artery stenosis, {grade}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}, {"key": "grade", "label": "Grade", "type": "select", "options": ["<60%", "≥60%", "severe/near-occlusive"], "default": "≥60%", "required": true}]', 20),
  ('Renal Doppler', 'Tardus Parvus Waveform', 'Intrarenal arcuate and interlobar arteries on the {side} show a delayed systolic upstroke (prolonged acceleration time) and rounded (tardus-parvus) waveform, in keeping with a haemodynamically significant proximal renal artery stenosis.', '{side} intrarenal tardus-parvus waveform, suggesting proximal renal artery stenosis.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}]', 30),
  ('Renal Doppler', 'Elevated Intrarenal Resistive Index', 'The {side} kidney shows an elevated intrarenal resistive index exceeding 0.80, in keeping with chronic parenchymal disease.', '{side} elevated intrarenal resistive index — chronic renal parenchymal disease.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left", "bilateral"], "default": "right", "required": true}]', 40),
  ('Renal Doppler', 'Renal Vein Thrombosis', 'The {side} renal vein is distended and non-compressible with echogenic intraluminal thrombus and absent flow on colour Doppler, in keeping with renal vein thrombosis.', '{side} renal vein thrombosis.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}]', 50),
  ('Renal Doppler', 'Renal Artery Occlusion', 'No colour or spectral flow is demonstrated in the {side} main renal artery. The corresponding kidney is {kidney}, in keeping with {chronicity} renal artery occlusion.', '{side} renal artery occlusion — {chronicity}, kidney {kidney}.', '[{"key": "side", "label": "Side", "type": "select", "options": ["right", "left"], "default": "right", "required": true}, {"key": "chronicity", "label": "Chronicity", "type": "select", "options": ["acute", "chronic"], "default": "chronic", "required": true}, {"key": "kidney", "label": "Kidney appearance", "type": "select", "options": ["viable and normal in size (non-atrophic)", "small and atrophic"], "default": "small and atrophic", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Hepatic Doppler (Hepatic Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Hepatic Doppler', 'Normal Hepatic Vascular Doppler', 'The portal veins are patent with normal hepatopetal flow. The hepatic artery shows a normal low-resistance waveform with resistive index within normal limits. All three hepatic veins are patent with a normal triphasic waveform.', 'Normal hepatic arterial, portal venous, and hepatic venous Doppler.', 10),
  ('Hepatic Doppler', 'Hepatic Artery Thrombosis', 'No colour or spectral arterial flow is demonstrated in the expected course of the hepatic artery at the porta hepatis or intrahepatically, in keeping with hepatic artery thrombosis.', 'Hepatic artery thrombosis — urgent correlation with the transplant/surgical team advised.', 20),
  ('Hepatic Doppler', 'Hepatic Artery Pseudoaneurysm', 'A well-defined anechoic sac is noted adjacent to the hepatic artery at the porta hepatis with to-and-fro (''yin-yang'') flow on colour Doppler, in keeping with a pseudoaneurysm.', 'Hepatic artery pseudoaneurysm — urgent correlation advised.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Hepatic Doppler', 'Hepatic Artery Stenosis (Post-Transplant)', 'The hepatic artery at the {location} shows focal velocity elevation exceeding 200 cm/s with post-stenotic turbulence and a tardus-parvus waveform in the intrahepatic branches, in keeping with hepatic artery stenosis.', 'Hepatic artery stenosis at the {location} — correlate urgently with the transplant team.', '[{"key": "location", "label": "Location", "type": "select", "options": ["anastomotic site", "proximal to the anastomosis"], "default": "anastomotic site", "required": true}]', 40),
  ('Hepatic Doppler', 'Portal Vein Thrombosis', 'The portal vein shows echogenic intraluminal material with {extent} loss of colour flow, with {vascularity} on spectral interrogation of the thrombus, in keeping with portal vein thrombosis[ with {cavernoma} periportal cavernomatous collateral formation, indicating chronicity].', '{extent} portal vein thrombosis ({vascularity})[ with {cavernoma} cavernomatous transformation].', '[{"key": "extent", "label": "Extent", "type": "select", "options": ["partial (non-occlusive)", "complete (occlusive)"], "default": "partial (non-occlusive)", "required": true}, {"key": "vascularity", "label": "Thrombus vascularity", "type": "select", "options": ["bland (no internal arterial signal — non-tumoral)", "tumoral/arterialised (internal arterial waveform — suspicious for HCC invasion)"], "default": "bland (no internal arterial signal — non-tumoral)", "required": true}, {"key": "cavernoma", "label": "Cavernomatous transformation", "type": "select", "options": ["None", "associated"], "default": "None"}]', 50),
  ('Hepatic Doppler', 'Budd-Chiari (Hepatic Vein Obstruction)', 'The hepatic veins show {pattern}, with a plump, heterogeneous caudate lobe and intrahepatic venous collaterals, in keeping with hepatic venous outflow obstruction (Budd-Chiari pattern).', 'Hepatic venous outflow obstruction (Budd-Chiari pattern).', '[{"key": "pattern", "label": "Pattern", "type": "select", "options": ["absent/non-visualised hepatic vein flow", "flat/monophasic hepatic vein waveform with intrahepatic collaterals"], "default": "absent/non-visualised hepatic vein flow", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Portal Doppler (Portal Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Portal Doppler', 'Normal Portal Doppler', 'The main portal vein is normal in calibre with normal hepatopetal flow at normal velocity. The splenic and superior mesenteric veins are normal with hepatopetal flow. The spleen is normal in size. No portosystemic collaterals or ascites.', 'No sonographic evidence of portal hypertension.', 10),
  ('Portal Doppler', 'Portal Vein Cavernoma / Chronic Occlusion', 'The main portal vein is not visualised as a discrete vessel and is replaced by a tangle of serpiginous collateral venous channels at the porta hepatis, in keeping with cavernomatous transformation of a chronically occluded portal vein.', 'Portal vein cavernoma — chronic portal vein occlusion.', 20),
  ('Portal Doppler', 'Hepatofugal Portal Flow', 'The main portal vein shows reversed (hepatofugal) flow directed away from the liver on spectral and colour Doppler.', 'Hepatofugal portal venous flow — advanced portal hypertension.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Portal Doppler', 'Portal Hypertension', 'The main portal vein is dilated measuring more than 13 mm with {flow} flow. The spleen is {spleen}. Portosystemic collaterals are noted (see below).', 'Sonographic features of portal hypertension with {flow} portal venous flow.', '[{"key": "flow", "label": "Flow pattern", "type": "select", "options": ["reduced hepatopetal", "biphasic (to-and-fro)", "reversed (hepatofugal)"], "default": "reduced hepatopetal", "required": true}, {"key": "spleen", "label": "Spleen", "type": "select", "options": ["mildly enlarged", "moderately enlarged", "markedly enlarged"], "default": "mildly enlarged"}]', 40),
  ('Portal Doppler', 'Portal Vein Thrombosis', 'The portal vein shows echogenic intraluminal material causing {extent} luminal occlusion, with {vascularity} on spectral interrogation of the thrombus.', '{extent} portal vein thrombosis ({vascularity}) — correlate with liver imaging for underlying HCC given the cirrhotic/surveillance context.', '[{"key": "extent", "label": "Extent", "type": "select", "options": ["partial (non-occlusive)", "complete (occlusive)"], "default": "partial (non-occlusive)", "required": true}, {"key": "vascularity", "label": "Thrombus vascularity", "type": "select", "options": ["bland (no internal arterial signal — non-tumoral)", "tumoral/arterialised (internal arterial waveform — suspicious for HCC invasion)"], "default": "bland (no internal arterial signal — non-tumoral)", "required": true}]', 50),
  ('Portal Doppler', 'Gastro-oesophageal / Portosystemic Varices', 'Dilated, tortuous, low-velocity venous channels are noted at the {location} region, in keeping with portosystemic collateral (varices) formation.', '{location} portosystemic varices.', '[{"key": "location", "label": "Location", "type": "select", "options": ["peri-splenic/splenorenal", "gastro-oesophageal/left gastric (coronary)", "peri-umbilical (recanalised paraumbilical vein)", "perigallbladder"], "default": "peri-splenic/splenorenal", "required": true}]', 60),
  ('Portal Doppler', 'Ascites (Portal Hypertension-Related)', 'Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity, in the setting of the above portal venous findings.', '{grade} ascites in the setting of portal hypertension.', '[{"key": "grade", "label": "Quantity", "type": "select", "options": ["Mild", "Moderate", "Gross"], "default": "Mild", "required": true}]', 70)
ON CONFLICT (study_type, label) DO NOTHING;

-- Obstetric Doppler (Obstetric Doppler)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, sort_order) VALUES
  ('Obstetric Doppler', 'Normal Obstetric Doppler', 'Umbilical artery Doppler shows forward end-diastolic flow with pulsatility index within normal limits for gestational age. MCA PI and cerebroplacental ratio are within normal limits. Bilateral uterine artery Doppler shows no notching.', 'Normal umbilical, cerebral, uterine artery, and ductus venosus Doppler for gestational age.', 10),
  ('Obstetric Doppler', 'Brain-Sparing (Redistribution)', 'Middle cerebral artery Doppler shows a reduced pulsatility index below the 5th centile for gestational age with a cerebroplacental ratio below 1.0, in keeping with fetal cerebral blood flow redistribution (brain-sparing effect).', 'Fetal brain-sparing (cerebral redistribution) — reduced cerebroplacental ratio.', 20),
  ('Obstetric Doppler', 'Elevated Umbilical Artery PI', 'Umbilical artery Doppler shows a pulsatility index above the 95th centile for gestational age with preserved forward end-diastolic flow, in keeping with increased placental vascular resistance.', 'Elevated umbilical artery PI — increased placental resistance; correlate with growth parameters and surveillance schedule.', 30)
ON CONFLICT (study_type, label) DO NOTHING;
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, questions_json, sort_order) VALUES
  ('Obstetric Doppler', 'Absent/Reversed End-Diastolic Umbilical Flow', 'Umbilical artery Doppler shows {pattern}, indicating significantly increased placental vascular resistance.', 'Umbilical artery {pattern} — high-risk finding requiring urgent obstetric correlation and delivery-timing discussion.', '[{"key": "pattern", "label": "Pattern", "type": "select", "options": ["absent end-diastolic flow (AEDF)", "reversed end-diastolic flow (REDF)"], "default": "absent end-diastolic flow (AEDF)", "required": true}]', 40),
  ('Obstetric Doppler', 'Bilateral Uterine Artery Notching', 'Both uterine arteries show a persistent early diastolic notch with {pi}, in keeping with impaired trophoblastic invasion / increased utero-placental resistance.', 'Bilateral uterine artery notching with {pi} — increased risk of pre-eclampsia/fetal growth restriction.', '[{"key": "pi", "label": "Pulsatility index", "type": "select", "options": ["normal PI", "elevated PI (>95th centile)"], "default": "elevated PI (>95th centile)", "required": true}]', 50),
  ('Obstetric Doppler', 'Abnormal Ductus Venosus Waveform', 'Ductus venosus Doppler shows a {pattern}, in keeping with worsening fetal cardiovascular compromise.', 'Ductus venosus {pattern} — significant finding requiring urgent obstetric correlation.', '[{"key": "pattern", "label": "Pattern", "type": "select", "options": ["reduced/absent a-wave", "reversed a-wave"], "default": "reduced/absent a-wave", "required": true}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── 4. Measurement library (Phase 3-4) ───────────────────────────────────────
-- USG Whole Abdomen (Whole Abdomen)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Whole Abdomen', 'Liver span', 'Liver span: {value} mm.', 'mm', 10),
  ('Whole Abdomen', 'CBD diameter', 'CBD diameter: {value} mm.', 'mm', 20),
  ('Whole Abdomen', 'Right kidney length', 'Right kidney length: {value} mm.', 'mm', 30),
  ('Whole Abdomen', 'Left kidney length', 'Left kidney length: {value} mm.', 'mm', 40),
  ('Whole Abdomen', 'Post-void residual (PVR)', 'Post-void residual urine: {value} mL.', 'mL', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG KUB (KUB)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('KUB', 'Right kidney length', 'Right kidney length: {value} mm.', 'mm', 10),
  ('KUB', 'Left kidney length', 'Left kidney length: {value} mm.', 'mm', 20),
  ('KUB', 'Post-void residual (PVR)', 'Post-void residual urine: {value} mL.', 'mL', 30),
  ('KUB', 'Bladder wall thickness', 'Bladder wall thickness: {value} mm.', 'mm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Pelvis (TA/TV) (Pelvis)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Pelvis', 'Uterus length', 'Uterus length: {value} mm.', 'mm', 10),
  ('Pelvis', 'Endometrial thickness', 'Endometrial thickness: {value} mm.', 'mm', 20),
  ('Pelvis', 'Right ovary volume', 'Right ovary volume: {value} cc.', 'cc', 30),
  ('Pelvis', 'Left ovary volume', 'Left ovary volume: {value} cc.', 'cc', 40),
  ('Pelvis', 'Prostate volume', 'Prostate volume: {value} cc.', 'cc', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Appendix (Graded Compression) (Appendix)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Appendix', 'Appendix diameter', 'Appendix diameter: {value} mm.', 'mm', 10),
  ('Appendix', 'Appendiceal wall thickness', 'Appendiceal wall thickness: {value} mm.', 'mm', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Hernia (Abdominal Wall / Inguinal) (Hernia)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Hernia', 'Defect (neck) size', 'Defect (neck) size: {value} mm.', 'mm', 10),
  ('Hernia', 'Herniated content extent', 'Contents protrude approximately {value} mm beyond the defect.', 'mm', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- USG Soft Tissue (Soft Tissue)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Soft Tissue', 'Lesion longest diameter', 'Lesion measures {value} mm in longest diameter.', 'mm', 10),
  ('Soft Tissue', 'Lesion depth from skin surface', 'Lesion depth from skin surface: {value} mm.', 'mm', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- Transvaginal Sonography (TVS) (TVS)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('TVS', 'Uterine Length', 'Uterine length: {value} mm.', 'mm', 10),
  ('TVS', 'Endometrial Thickness', 'Endometrial thickness: {value} mm.', 'mm', 20),
  ('TVS', 'Right Ovarian Volume', 'Right ovarian volume: {value} mL.', 'mL', 30),
  ('TVS', 'Left Ovarian Volume', 'Left ovarian volume: {value} mL.', 'mL', 40),
  ('TVS', 'Cervical Length', 'Cervical length: {value} mm.', 'mm', 50),
  ('TVS', 'Antral Follicle Count (bilateral)', 'Antral follicle count (both ovaries): {value}.', 'follicles', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- Follicular Study (Follicular Study)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Follicular Study', 'Cycle Day', 'Cycle day: {value}.', 'day', 10),
  ('Follicular Study', 'Dominant Follicle Size (mm)', 'Dominant follicle: {value} mm.', 'mm', 20),
  ('Follicular Study', 'Right Ovary Follicle Count', 'Right ovary: {value} follicle(s) tracked.', 'follicles', 30),
  ('Follicular Study', 'Left Ovary Follicle Count', 'Left ovary: {value} follicle(s) tracked.', 'follicles', 40),
  ('Follicular Study', 'Endometrial Thickness', 'Endometrial thickness: {value} mm.', 'mm', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Endometrium (Endometrium)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Endometrium', 'Endometrial Thickness', 'Endometrial thickness (double-layer): {value} mm.', 'mm', 10),
  ('Endometrium', 'Endometrial Volume', 'Endometrial volume: {value} mL.', 'mL', 20),
  ('Endometrium', 'Myometrial Thickness', 'Myometrial thickness (anterior/posterior): {value} mm.', 'mm', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Ovarian Lesions (Ovarian Lesions)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Ovarian Lesions', 'Lesion Size (largest diameter)', 'Lesion size: {value} mm (largest diameter).', 'mm', 10),
  ('Ovarian Lesions', 'Lesion Volume', 'Lesion volume: {value} mL.', 'mL', 20),
  ('Ovarian Lesions', 'Solid Component Size', 'Largest solid component: {value} mm.', 'mm', 30),
  ('Ovarian Lesions', 'CA-125', 'CA-125: {value} U/mL.', 'U/mL', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Infertility (Infertility)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Infertility', 'Right Antral Follicle Count', 'Right AFC: {value}.', 'follicles', 10),
  ('Infertility', 'Left Antral Follicle Count', 'Left AFC: {value}.', 'follicles', 20),
  ('Infertility', 'Right Ovarian Volume', 'Right ovarian volume: {value} mL.', 'mL', 30),
  ('Infertility', 'Left Ovarian Volume', 'Left ovarian volume: {value} mL.', 'mL', 40),
  ('Infertility', 'Endometrial Thickness', 'Endometrial thickness: {value} mm.', 'mm', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Early Pregnancy (Early Pregnancy)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Early Pregnancy', 'GS (Mean Sac Diameter)', 'Mean sac diameter measures {value} mm.', 'mm', 10),
  ('Early Pregnancy', 'YS Diameter', 'Yolk sac diameter measures {value} mm.', 'mm', 20),
  ('Early Pregnancy', 'CRL', 'Crown-rump length measures {value} mm.', 'mm', 30),
  ('Early Pregnancy', 'Fetal Heart Rate', 'Fetal heart rate is {value} bpm.', 'bpm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Dating (Dating)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Dating', 'CRL', 'Crown-rump length measures {value} mm.', 'mm', 10),
  ('Dating', 'MSD', 'Mean sac diameter measures {value} mm (embryo not yet visualised).', 'mm', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- Viability (Viability)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Viability', 'CRL', 'Crown-rump length measures {value} mm.', 'mm', 10),
  ('Viability', 'MSD', 'Mean sac diameter measures {value} mm.', 'mm', 20),
  ('Viability', 'Fetal Heart Rate', 'Fetal heart rate is {value} bpm.', 'bpm', 30),
  ('Viability', 'Subchorionic Hematoma Size', 'Subchorionic hematoma measures approximately {value} mm in maximal dimension.', 'mm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- NT (NT)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('NT', 'CRL', 'Crown-rump length measures {value} mm.', 'mm', 10),
  ('NT', 'NT', 'Nuchal translucency measures {value} mm.', 'mm', 20),
  ('NT', 'DV PIV', 'Ductus venosus PIV is {value}.', 'index', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Anomaly (Anomaly)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Anomaly', 'BPD', 'Biparietal diameter measures {value} mm.', 'mm', 10),
  ('Anomaly', 'HC', 'Head circumference measures {value} mm.', 'mm', 20),
  ('Anomaly', 'AC', 'Abdominal circumference measures {value} mm.', 'mm', 30),
  ('Anomaly', 'FL', 'Femur length measures {value} mm.', 'mm', 40),
  ('Anomaly', 'EFW', 'Estimated fetal weight is {value} g (Hadlock formula).', 'g', 50),
  ('Anomaly', 'AFI', 'Amniotic fluid index measures {value} cm.', 'cm', 60),
  ('Anomaly', 'Nuchal Fold', 'Nuchal fold thickness measures {value} mm.', 'mm', 70),
  ('Anomaly', 'Cisterna Magna', 'Cisterna magna measures {value} mm.', 'mm', 80),
  ('Anomaly', 'Renal Pelvis AP Diameter', 'Renal pelvis AP diameter measures {value} mm.', 'mm', 90)
ON CONFLICT (study_type, label) DO NOTHING;

-- Growth (Growth)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Growth', 'BPD', 'Biparietal diameter measures {value} mm.', 'mm', 10),
  ('Growth', 'HC', 'Head circumference measures {value} mm.', 'mm', 20),
  ('Growth', 'AC', 'Abdominal circumference measures {value} mm.', 'mm', 30),
  ('Growth', 'FL', 'Femur length measures {value} mm.', 'mm', 40),
  ('Growth', 'EFW', 'Estimated fetal weight is {value} g (Hadlock formula).', 'g', 50),
  ('Growth', 'AFI', 'Amniotic fluid index measures {value} cm.', 'cm', 60),
  ('Growth', 'UA PI', 'Umbilical artery pulsatility index is {value}.', 'index', 70),
  ('Growth', 'UA RI', 'Umbilical artery resistive index is {value}.', 'index', 80),
  ('Growth', 'MCA PI', 'Middle cerebral artery pulsatility index is {value}.', 'index', 90),
  ('Growth', 'CPR', 'Cerebroplacental ratio (MCA PI / UA PI) is {value}.', 'ratio', 100)
ON CONFLICT (study_type, label) DO NOTHING;

-- BPP (BPP)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('BPP', 'AFI', 'Amniotic fluid index measures {value} cm.', 'cm', 10),
  ('BPP', 'SDP', 'Single deepest amniotic fluid pocket measures {value} cm.', 'cm', 20),
  ('BPP', 'BPP Score', 'Biophysical profile score is {value}/10.', 'points', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Cervical Length (Cervical Length)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Cervical Length', 'Cervical Length', 'Cervical length measures {value} mm.', 'mm', 10),
  ('Cervical Length', 'Funnel Length', 'Funnel length measures {value} mm.', 'mm', 20),
  ('Cervical Length', 'Funnel Width', 'Funnel width measures {value} mm.', 'mm', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Multiple Pregnancy (Multiple Pregnancy)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Multiple Pregnancy', 'Twin A EFW', 'Estimated fetal weight for Twin A is {value} g.', 'g', 10),
  ('Multiple Pregnancy', 'Twin B EFW', 'Estimated fetal weight for Twin B is {value} g.', 'g', 20),
  ('Multiple Pregnancy', 'Inter-twin EFW Discordance', 'Inter-twin EFW discordance is {value}%.', '%', 30),
  ('Multiple Pregnancy', 'Inter-twin Membrane Thickness', 'Inter-twin dividing membrane thickness measures {value} mm.', 'mm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Thyroid (Thyroid)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Thyroid', 'Right lobe volume', 'Right lobe volume: {value} mL.', 'mL', 10),
  ('Thyroid', 'Left lobe volume', 'Left lobe volume: {value} mL.', 'mL', 20),
  ('Thyroid', 'Isthmus thickness', 'Isthmus thickness: {value} mm.', 'mm', 30),
  ('Thyroid', 'Dominant nodule size', 'Dominant nodule size: {value} mm.', 'mm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Breast (Breast)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Breast', 'Lesion size (largest dimension)', 'Lesion size: {value} mm.', 'mm', 10),
  ('Breast', 'Distance from nipple', 'Distance from nipple: {value} cm.', 'cm', 20),
  ('Breast', 'Axillary lymph node cortical thickness', 'Axillary node cortical thickness: {value} mm.', 'mm', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Scrotum (Scrotum)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Scrotum', 'Right testicular volume', 'Right testicular volume: {value} mL.', 'mL', 10),
  ('Scrotum', 'Left testicular volume', 'Left testicular volume: {value} mL.', 'mL', 20),
  ('Scrotum', 'Epididymal head size', 'Epididymal head size: {value} mm.', 'mm', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Neck (Neck)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Neck', 'Lymph node short-axis diameter', 'Lymph node short-axis: {value} mm.', 'mm', 10),
  ('Neck', 'Cortical thickness', 'Cortical thickness: {value} mm.', 'mm', 20),
  ('Neck', 'Submandibular gland size', 'Submandibular gland size: {value} mm.', 'mm', 30),
  ('Neck', 'Parotid gland size', 'Parotid gland size: {value} mm.', 'mm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- MSK (MSK)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('MSK', 'Supraspinatus tendon thickness', 'Supraspinatus tendon thickness: {value} mm.', 'mm', 10),
  ('MSK', 'Achilles tendon thickness (AP, mid-substance)', 'Achilles tendon thickness: {value} mm.', 'mm', 20),
  ('MSK', 'Median nerve cross-sectional area (carpal tunnel inlet)', 'Median nerve CSA: {value} mm2.', 'mm2', 30),
  ('MSK', 'Joint effusion depth (maximal)', 'Maximal effusion depth: {value} mm.', 'mm', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Carotid Doppler (Carotid Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Carotid Doppler', 'CCA IMT (Right)', 'Right common carotid artery intima-media thickness: {value} mm.', 'mm', 10),
  ('Carotid Doppler', 'CCA IMT (Left)', 'Left common carotid artery intima-media thickness: {value} mm.', 'mm', 20),
  ('Carotid Doppler', 'ICA PSV (Right)', 'Right internal carotid artery peak systolic velocity: {value} cm/s.', 'cm/s', 30),
  ('Carotid Doppler', 'ICA PSV (Left)', 'Left internal carotid artery peak systolic velocity: {value} cm/s.', 'cm/s', 40),
  ('Carotid Doppler', 'ICA/CCA PSV Ratio', 'ICA/CCA peak systolic velocity ratio: {value}.', 'ratio', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Venous Doppler (Venous Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Venous Doppler', 'Reflux Duration (GSV)', 'Great saphenous vein reflux duration: {value} sec.', 'sec', 10),
  ('Venous Doppler', 'Reflux Duration (SSV)', 'Small saphenous vein reflux duration: {value} sec.', 'sec', 20),
  ('Venous Doppler', 'Common Femoral Vein Diameter', 'Common femoral vein diameter: {value} mm.', 'mm', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Arterial Doppler (Arterial Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Arterial Doppler', 'PSV (Stenosis Site)', 'Peak systolic velocity at the stenosis site: {value} cm/s.', 'cm/s', 10),
  ('Arterial Doppler', 'ABI - Right', 'Right ankle-brachial index: {value}.', 'ratio', 20),
  ('Arterial Doppler', 'ABI - Left', 'Left ankle-brachial index: {value}.', 'ratio', 30),
  ('Arterial Doppler', 'Velocity Ratio (Stenosis/Proximal)', 'Velocity ratio across the stenosis: {value}.', 'ratio', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Renal Doppler (Renal Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Renal Doppler', 'Main Renal Artery PSV (Right)', 'Right main renal artery peak systolic velocity: {value} cm/s.', 'cm/s', 10),
  ('Renal Doppler', 'Main Renal Artery PSV (Left)', 'Left main renal artery peak systolic velocity: {value} cm/s.', 'cm/s', 20),
  ('Renal Doppler', 'Renal-Aortic Ratio (RAR)', 'Renal-aortic ratio: {value}.', 'ratio', 30),
  ('Renal Doppler', 'Intrarenal Resistive Index', 'Intrarenal resistive index: {value}.', 'ratio', 40),
  ('Renal Doppler', 'Intrarenal Acceleration Time', 'Intrarenal acceleration time: {value} ms.', 'ms', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Hepatic Doppler (Hepatic Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Hepatic Doppler', 'Hepatic Artery RI', 'Hepatic artery resistive index: {value}.', 'ratio', 10),
  ('Hepatic Doppler', 'Portal Vein Velocity', 'Main portal vein velocity: {value} cm/s.', 'cm/s', 20),
  ('Hepatic Doppler', 'Portal Vein Diameter', 'Main portal vein diameter: {value} mm.', 'mm', 30),
  ('Hepatic Doppler', 'Hepatic Artery PSV', 'Hepatic artery peak systolic velocity: {value} cm/s.', 'cm/s', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Portal Doppler (Portal Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Portal Doppler', 'Portal Vein Diameter', 'Main portal vein diameter: {value} mm.', 'mm', 10),
  ('Portal Doppler', 'Portal Vein Velocity', 'Main portal vein velocity: {value} cm/s.', 'cm/s', 20),
  ('Portal Doppler', 'Congestion Index', 'Portal vein congestion index: {value} cm·s.', 'cm·s', 30),
  ('Portal Doppler', 'Splenic Vein Diameter', 'Splenic vein diameter: {value} mm.', 'mm', 40),
  ('Portal Doppler', 'Splenic Length', 'Splenic length: {value} cm.', 'cm', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Obstetric Doppler (Obstetric Doppler)
INSERT INTO radiology_quick_measurements (study_type, label, template_text, unit, sort_order) VALUES
  ('Obstetric Doppler', 'Umbilical Artery PI', 'Umbilical artery pulsatility index: {value}.', 'ratio', 10),
  ('Obstetric Doppler', 'Umbilical Artery S/D Ratio', 'Umbilical artery systolic/diastolic ratio: {value}.', 'ratio', 20),
  ('Obstetric Doppler', 'MCA PI', 'Middle cerebral artery pulsatility index: {value}.', 'ratio', 30),
  ('Obstetric Doppler', 'Cerebroplacental Ratio (CPR)', 'Cerebroplacental ratio: {value}.', 'ratio', 40),
  ('Obstetric Doppler', 'Uterine Artery PI (Mean)', 'Mean uterine artery pulsatility index: {value}.', 'ratio', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── 5. Protocol Engine (Phase 3-4) ───────────────────────────────────────────
-- 5a. New protocols (21) — study types PR B did not yet cover
INSERT INTO radiology_protocols (name, study_type, modality, technique_text, normal_text, recommendation_text, required_measurements, is_default, sort_order) VALUES
  ('USG Appendix', 'Appendix', 'USG', 'Graded-compression real-time ultrasound of the right iliac fossa was performed using a high-frequency linear probe (supplemented by a curvilinear probe in larger patients), with the transducer used to gradually displace overlying bowel gas and identify the appendix arising from the cecal tip.', 'The appendix is visualized as a blind-ending, compressible, non-inflamed tubular structure arising from the cecum, measuring less than 6 mm in outer diameter, with no wall thickening, hyperaemia, periappendiceal fat stranding, or free fluid. No mesenteric lymphadenopathy.', 'Please correlate with clinical findings and laboratory parameters (total leukocyte count, CRP).', 'Appendix diameter,Appendiceal wall thickness', TRUE, 200),
  ('USG Hernia (Abdominal Wall / Inguinal)', 'Hernia', 'USG', 'Real-time grey-scale ultrasound of the site of clinical concern was performed using a high-frequency linear probe with the patient supine and, where needed, standing, incorporating Valsalva maneuver and gentle graded compression to assess for a fascial defect, its contents, and reducibility.', 'No fascial defect is demonstrated in the abdominal wall or inguinal canal on dynamic scanning with Valsalva maneuver and standing provocation. No abnormal protrusion of bowel loops or omental fat is seen.', 'Please correlate with clinical examination; surgical referral advised if a hernia is confirmed.', '', TRUE, 210),
  ('USG Follicular Study', 'Follicular Study', 'USG', 'Serial transvaginal ultrasound was performed with an empty urinary bladder using a high-frequency endocavitary probe, beginning on cycle day 2-3 (baseline) and repeated at intervals through the mid-cycle window per the treating clinician''s stimulation protocol, until a dominant follicle reaches maturity or trigger criteria are met.', 'Baseline antral follicle counts are within normal range bilaterally. A single dominant follicle is developing with appropriate day-wise growth of approximately 1-2 mm/day, currently measuring within the physiological range for cycle day. Endometrium is developing a trilaminar pattern with appropriate day-wise thickening. No evidence of premature luteinisation or follicular cyst.', 'Correlate with serum hormonal levels (E2/LH/P4) and the treating clinician''s stimulation protocol. Recommend repeat follicular study at the interval advised by the treating clinician to time trigger, IUI, or oocyte retrieval.', 'Cycle day,Dominant follicle,Endometrial thickness', TRUE, 220),
  ('USG Endometrium (AUB / PMB Workup)', 'Endometrium', 'USG', 'Transvaginal ultrasound of the endometrium was performed with an empty urinary bladder using a high-frequency endocavitary probe, with colour Doppler interrogation of the endometrium and endo-myometrial junction.', 'Endometrium is central, homogeneous, and measures within normal limits for the patient''s age, cycle day, or menopausal status. Endo-myometrial junction is well-defined and regular. No focal endometrial lesion. No abnormal endometrial vascularity on colour Doppler.', 'Please correlate with menstrual/menopausal history, cycle day, and hormone therapy status. Endometrial thickening or a focal lesion in the setting of abnormal or postmenopausal bleeding warrants saline infusion sonography (SIS) and/or endometrial sampling for histopathological correlation.', 'Endometrial thickness (double-layer)', TRUE, 230),
  ('USG Ovarian/Adnexal Lesion Characterization', 'Ovarian Lesions', 'USG', 'Transvaginal ultrasound (supplemented by transabdominal views for a large or predominantly abdominal mass) was performed, with grey-scale characterization of lesion structure, wall, septations, and solid components per IOTA terminology, followed by colour and pulsed-wave Doppler interrogation of any solid or septal component.', 'No adnexal mass is identified. Both ovaries are normal in size and echotexture with a physiological follicular pattern. No abnormal pelvic vascularity. No free fluid.', 'Report using IOTA simple-rules terminology (unilocular/multilocular, solid component, papillary projections, ascites, vascularity) where a lesion is present. Correlate with menopausal status, menstrual history, and CA-125/HE4/ROMA where clinically indicated; recommend gynaecology-oncology referral for any lesion with IOTA ''M'' (malignant) features.', 'Lesion size', TRUE, 240),
  ('USG Infertility Workup Scan', 'Infertility', 'USG', 'Baseline transvaginal ultrasound was performed with an empty urinary bladder, typically on cycle day 2-3, assessing uterine morphology for congenital anomaly, bilateral antral follicle count and ovarian volume, endometrial thickness/pattern, and the adnexa for hydrosalpinx or other tubal-factor pathology. Tubal patency itself is not directly assessed by transvaginal ultrasound and requires HSG, HyCoSy, or laparoscopy where clinically indicated.', 'Uterus is normal in size, position, and myometrial echotexture with no congenital anomaly. Endometrium is within normal limits for cycle day. Both ovaries are normal in volume with a normal antral follicle count and no evidence of polycystic ovarian morphology. No hydrosalpinx or adnexal mass. No free fluid.', 'Correlate with cycle day, serum AMH/FSH/LH, and partner semen analysis as part of the overall infertility workup. HSG or HyCoSy is recommended for direct tubal patency assessment, which this scan does not provide. Recommend gynaecology/reproductive-medicine referral for correlation and further management.', 'Right AFC,Left AFC,Endometrial thickness', TRUE, 250),
  ('USG Early Pregnancy Scan', 'Early Pregnancy', 'USG', 'Transabdominal and/or transvaginal ultrasound was performed to confirm intrauterine pregnancy location and number, and to assess the gestational sac, yolk sac, embryo/fetal pole, cardiac activity, and adnexa.', 'A single intrauterine gestational sac is seen with a well-formed yolk sac. A single live embryo is identified with cardiac activity present. Both ovaries are normal in size and echotexture; no adnexal mass.', 'Please correlate clinically. Routine antenatal follow-up as advised; if dating or viability cannot yet be confirmed, repeat scan in 7–10 days is recommended.', 'Mean sac diameter measures,Yolk sac diameter measures', TRUE, 260),
  ('USG Dating Scan (First Trimester)', 'Dating', 'USG', 'Transabdominal and/or transvaginal ultrasound was performed in the first trimester to obtain crown-rump length for pregnancy dating.', 'Single live intrauterine pregnancy. Crown-rump length corresponds to the established gestational age, with cardiac activity present.', 'EDD established by CRL per the Robinson & Fleming formula. Please correlate clinically. Routine antenatal follow-up as advised; NT scan recommended at 11–13+6 weeks if not already performed.', 'Crown-rump length measures', TRUE, 270),
  ('USG Viability Scan (Threatened Miscarriage)', 'Viability', 'USG', 'Transvaginal (with transabdominal correlation where indicated) ultrasound was performed to assess intrauterine pregnancy location, cardiac activity, gestational sac/yolk sac morphology, and for subchorionic or retroplacental hemorrhage, in a patient presenting with first-trimester bleeding or pain.', 'A single live intrauterine gestational sac is seen with a normal yolk sac and a live embryo showing cardiac activity. No subchorionic hematoma or adnexal abnormality is identified.', 'Please correlate clinically. Pelvic rest as advised; repeat ultrasound in 1–2 weeks if bleeding persists or if viability/dating remains uncertain.', '', TRUE, 280),
  ('USG Biophysical Profile (BPP)', 'BPP', 'USG', 'Real-time grey-scale ultrasound was performed over a minimum 30-minute observation period (extendable to 30–40 minutes per Manning criteria) to assess fetal breathing movements, gross body movements, fetal tone, and amniotic fluid volume, correlated with the non-stress test where performed.', 'Fetal breathing movements, gross body movements, and fetal tone are all present. Amniotic fluid volume is normal. Non-stress test is reactive. Biophysical profile score: 10/10 — reassuring fetal status.', 'Please correlate clinically with the obstetric team. Routine antenatal follow-up if the score is reassuring (8–10/10); closer surveillance or delivery timing to be individualised by gestational age and clinical context for lower scores.', 'Amniotic fluid index measures,Biophysical profile score is', TRUE, 290),
  ('USG Cervical Length Screening (TVS)', 'Cervical Length', 'USG', 'Transvaginal ultrasound was performed with an empty maternal bladder, using gentle probe pressure, to measure cervical length in the sagittal plane over a minimum 3–5 minute observation period (with transfundal pressure applied if clinically indicated) to elicit dynamic shortening or funneling.', 'Transvaginal cervical length is normal (≥30 mm) with a closed internal os and no funneling.', 'Please correlate clinically. Routine antenatal follow-up if length is reassuring; obstetric referral for consideration of vaginal progesterone or cerclage if cervical length is short (<25 mm) or rapidly shortening.', 'Cervical length measures', TRUE, 300),
  ('USG Multiple Pregnancy Scan', 'Multiple Pregnancy', 'USG', 'Real-time obstetric ultrasound was performed transabdominally, individually labelling and biometrically assessing each fetus (Twin A, Twin B, ...), determining chorionicity and amnionicity by membrane count/thickness and the lambda vs T-sign at the placental-membrane junction (most reliably assessed in the first trimester), and assessing amniotic fluid volume in each sac, placental location(s), and umbilical artery Doppler.', 'Twin intrauterine pregnancy with two live fetuses of concordant growth (EFW discordance <20%). Chorionicity and amnionicity are documented. Amniotic fluid volume is normal in each sac. Umbilical artery Doppler indices are within normal limits for both twins.', 'Please correlate clinically. Chorionicity-based surveillance interval as advised by the obstetric team (closer-interval surveillance, including TTTS screening, for monochorionic pregnancies); routine antenatal follow-up for dichorionic pregnancies.', 'Estimated fetal weight for Twin A is,Estimated fetal weight for Twin B is,Inter-twin EFW discordance is', TRUE, 310),
  ('USG Neck', 'Neck', 'USG', 'Real-time grey-scale and colour Doppler ultrasound of the neck was performed using a high-frequency linear probe, systematically surveying the bilateral cervical lymph node levels (I-VI) and the parotid and submandibular salivary glands.', 'Bilateral cervical lymph node levels I through VI show no pathologically enlarged or morphologically abnormal lymph node — a few small nodes with preserved fatty hilum are within normal limits. Both parotid and submandibular glands are normal in size and echotexture with no calculus, ductal dilatation, or focal mass. No cystic or solid neck mass is identified. Major cervical vascular structures are patent.', 'Please correlate with clinical findings; FNAC/biopsy as clinically indicated for a suspicious lymph node or mass.', '', TRUE, 320),
  ('USG Musculoskeletal', 'MSK', 'USG', 'Real-time, dynamic grey-scale ultrasound (with colour Doppler where indicated) of the clinically indicated site — shoulder/rotator cuff, knee, ankle, or wrist — was performed using a high-frequency linear probe, including dynamic manoeuvres and side-to-side comparison with the contralateral limb where relevant.', 'The examined tendon(s) show normal thickness and fibrillar echotexture with no discontinuity, tear, or significant peritendinous fluid. The adjacent joint recess shows no pathological effusion or synovial thickening. Visualised ligaments are intact with normal fibrillar architecture. Where assessed, the peripheral nerve is normal in calibre and echotexture with no focal entrapment. No soft-tissue mass or collection is identified.', 'Please correlate with clinical examination and site-specific physical tests; MRI is recommended for further characterisation of an equivocal or full-thickness tear where clinically indicated.', '', TRUE, 330),
  ('USG Carotid Doppler', 'Carotid Doppler', 'USG', 'Grey-scale, colour, and spectral Doppler ultrasound of both common, internal, and external carotid arteries and both vertebral arteries was performed using a high-frequency linear probe, with PSV/EDV sampling at the CCA, carotid bulb, and proximal ICA.', 'Both common, internal, and external carotid arteries and both vertebral arteries show normal calibre with smooth intimal surfaces and no significant atherosclerotic plaque. Carotid intima-media thickness is within normal limits bilaterally. Colour and spectral Doppler show a normal low-resistance waveform in the internal carotid arteries and a normal high-resistance waveform in the external carotid arteries, with antegrade flow in both vertebral arteries. Peak systolic velocities are within normal limits with no evidence of haemodynamically significant stenosis. No evidence of dissection or occlusion.', 'Please correlate with clinical findings and cardiovascular risk factors.', 'Right common carotid artery intima-media thickness,Left common carotid artery intima-media thickness,Right internal carotid artery peak systolic velocity,Left internal carotid artery peak systolic velocity', TRUE, 340),
  ('USG Venous Doppler', 'Venous Doppler', 'USG', 'Grey-scale, colour, and spectral Doppler ultrasound of the deep and superficial veins of the indicated limb was performed with graded compression at 2 cm intervals from the common femoral (or subclavian/axillary for upper limb) vein to the calf veins, with augmentation manoeuvres.', 'The common femoral, femoral, popliteal, and calf veins (posterior tibial and peroneal) are normal in calibre, fully compressible with the transducer, and show no intraluminal echoes. Normal phasic flow with respiration and augmentation on calf compression is demonstrated. The great and small saphenous veins are competent with no pathological reflux on Valsalva/calf compression. No evidence of deep or superficial venous thrombosis.', 'Please correlate with clinical findings. Anticoagulation decisions to be individualised by the treating clinician.', '', TRUE, 350),
  ('USG Arterial Doppler', 'Arterial Doppler', 'USG', 'Grey-scale, colour, and spectral Doppler ultrasound of the indicated limb arterial tree was performed from the common femoral (or subclavian/axillary for upper limb) artery to the pedal/digital vessels, with ankle-brachial index measured using a hand-held Doppler probe and sphygmomanometer.', 'The common femoral, superficial femoral, popliteal, and infrapopliteal (anterior tibial, posterior tibial, peroneal) arteries are normal in calibre with a normal triphasic waveform and no significant atherosclerotic plaque or stenosis throughout. Ankle-brachial index is within normal limits bilaterally. No evidence of haemodynamically significant peripheral arterial disease.', 'Please correlate with clinical findings and pulse examination.', 'Right ankle-brachial index,Left ankle-brachial index', TRUE, 360),
  ('USG Renal Doppler', 'Renal Doppler', 'USG', 'Grey-scale, colour, and spectral Doppler ultrasound of both kidneys, main renal arteries, renal veins, and intrarenal vasculature was performed using a curvilinear probe, with the aorta sampled for the renal-aortic ratio.', 'Both main renal arteries arise normally from the aorta and show a normal low-resistance waveform with peak systolic velocity within normal limits and a renal-aortic ratio less than 3.5, with no evidence of significant renal artery stenosis. Intrarenal arteries show normal tardus-parvus-free waveforms with resistive index within normal limits. Both renal veins and the IVC are patent with normal flow.', 'Please correlate with clinical findings, blood pressure control, and renal function.', 'Right main renal artery peak systolic velocity,Left main renal artery peak systolic velocity,Renal-aortic ratio', TRUE, 370),
  ('USG Hepatic Doppler', 'Hepatic Doppler', 'USG', 'Grey-scale, colour, and spectral Doppler ultrasound of the hepatic artery (at the porta hepatis and intrahepatically), main/right/left portal veins, all three hepatic veins, and the IVC was performed using a curvilinear probe.', 'The main, right, and left portal veins are patent with normal hepatopetal (toward the liver) flow at normal velocity. The hepatic artery shows a normal low-resistance waveform with a brisk systolic upstroke and resistive index within normal limits. All three hepatic veins are patent with a normal triphasic waveform. The IVC is patent. No intrahepatic or extrahepatic biliary dilatation.', 'Please correlate with clinical findings, liver function tests, and transplant team status if applicable.', 'Hepatic artery resistive index,Main portal vein velocity', TRUE, 380),
  ('USG Portal Doppler', 'Portal Doppler', 'USG', 'Grey-scale, colour, and spectral Doppler ultrasound of the portal, splenic, and superior mesenteric veins was performed using a curvilinear probe, with the spleen and liver surveyed and the peritoneal cavity assessed for free fluid.', 'The main portal vein is normal in calibre with normal hepatopetal flow at normal velocity, showing normal respiratory phasicity. The splenic and superior mesenteric veins are normal in calibre with hepatopetal flow. The spleen is normal in size. No portosystemic collaterals or varices are identified. No ascites.', 'Please correlate with clinical findings, liver function, and endoscopic variceal surveillance status.', 'Main portal vein diameter,Main portal vein velocity', TRUE, 390),
  ('USG Obstetric Doppler', 'Obstetric Doppler', 'USG', 'Colour and pulsed-wave spectral Doppler of the umbilical artery (free loop), fetal middle cerebral artery, bilateral uterine arteries, and ductus venosus (when indicated) was performed in accordance with ISUOG Doppler guidelines, with all measurements taken during fetal apnoea and absent fetal breathing/body movement.', 'Umbilical artery Doppler shows a normal waveform with forward end-diastolic flow and pulsatility index within the normal range for gestational age. Fetal middle cerebral artery Doppler shows pulsatility index within normal limits with no evidence of brain-sparing. The cerebroplacental ratio is within normal limits. Bilateral uterine artery Doppler shows a normal waveform with no notching and pulsatility index within the normal range. Ductus venosus shows a normal triphasic waveform with forward flow in all cardiac phases.', 'Please correlate with clinical findings, growth biometry, and blood pressure status. Findings to be interpreted in conjunction with the growth/anomaly scan of the same pregnancy where performed.', 'Umbilical artery pulsatility index,Middle cerebral artery pulsatility index,Cerebroplacental ratio', TRUE, 400)
ON CONFLICT (name) DO NOTHING;

-- 5b. required_measurements correction on PR B's 11 pre-existing protocols
--     (see comment block above — bug-fix only, no other column touched)
UPDATE radiology_protocols SET required_measurements = 'Liver span,CBD diameter,Right kidney length,Left kidney length,Post-void residual urine' WHERE name = 'USG Whole Abdomen';
UPDATE radiology_protocols SET required_measurements = 'Right kidney length,Left kidney length,Post-void residual urine' WHERE name = 'USG KUB';
UPDATE radiology_protocols SET required_measurements = '' WHERE name = 'USG Pelvis (TA/TV)';
UPDATE radiology_protocols SET required_measurements = '' WHERE name = 'USG Soft Tissue';
UPDATE radiology_protocols SET required_measurements = 'Uterine length,Endometrial thickness,Right ovarian volume,Left ovarian volume' WHERE name = 'USG TVS';
UPDATE radiology_protocols SET required_measurements = 'Crown-rump length measures,Nuchal translucency measures' WHERE name = 'USG NT Scan';
UPDATE radiology_protocols SET required_measurements = 'Biparietal diameter measures,Head circumference measures,Abdominal circumference measures,Femur length measures,Estimated fetal weight is,Amniotic fluid index measures' WHERE name = 'USG Anomaly Scan (Level II)';
UPDATE radiology_protocols SET required_measurements = 'Biparietal diameter measures,Head circumference measures,Abdominal circumference measures,Femur length measures,Estimated fetal weight is,Amniotic fluid index measures,Umbilical artery pulsatility index is,Umbilical artery resistive index is' WHERE name = 'USG Growth Scan (3rd Trimester)';
UPDATE radiology_protocols SET required_measurements = 'Right lobe volume,Left lobe volume,Isthmus thickness' WHERE name = 'USG Thyroid';
UPDATE radiology_protocols SET required_measurements = '' WHERE name = 'USG Breast';
UPDATE radiology_protocols SET required_measurements = 'Right testicular volume,Left testicular volume' WHERE name = 'USG Scrotum';

