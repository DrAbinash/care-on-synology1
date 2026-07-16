-- =============================================================================
-- Migration: USG Platform Consolidation — content pack (PR B)
-- Date: 2026-07-16
-- =============================================================================
-- Purely additive CONTENT, not a new engine. This migration adds rows to the
-- existing shared tables that already power the Reporting Workspace for MRI/CT
-- (radiology_study_tabs, radiology_quick_findings, radiology_clinical_history_
-- chips, radiology_protocols) — the same tables `add_radiology_quick_findings.sql`,
-- `add_radiology_protocols.sql`, and `z_add_radiology_clinical_history_and_
-- protocol_default.sql` already seeded for MRI. Nothing here creates a new
-- table, a new engine, or a second Smart Findings / Template / Protocol system
-- (see docs/usg-reporting/platform-consolidation-pr-b.md, Hard Rules).
--
-- Per docs/usg-reporting-audit's own inventory, zero USG rows existed in any of
-- these tables before this migration — every USG study type was entirely
-- absent from the Quick Select / Protocol / Clinical History layer (only
-- FetalUsgLevel4.tsx and the standalone usgReportTemplates.ts catalog had USG
-- content, neither of which uses these tables). This is a REPRESENTATIVE
-- starter set for the study types named in the PR spec (§7, §9, §10) — not an
-- exhaustive clinical content library. See the deliverables doc for what's
-- intentionally deferred.
--
-- The `zz_` prefix guarantees this runs after every `add_*`/`z_*` migration
-- (alphabetical auto-discovery, see z_add_radiology_clinical_history_and_
-- protocol_default.sql's own header) — in particular after
-- add_radiology_quick_findings.sql (base tables),
-- add_radiology_protocols.sql (radiology_protocols),
-- z_add_radiology_clinical_history_and_protocol_default.sql (chips table +
-- is_default column), and z_add_radiology_structured_finding_questions.sql
-- (questions_json column) — all of which this migration depends on.
--
-- Fully idempotent: every INSERT uses ON CONFLICT DO NOTHING against the same
-- unique keys the base migrations defined. Safe to run repeatedly. No existing
-- row (MRI or otherwise) is modified.
--
-- `anatomical_section` is deliberately left blank on every USG finding below:
-- that column only has a live effect when it matches a DB-backed
-- structured_report_templates section label, and per doc 05 no USG study type
-- has a DB-backed structured template today (usgReportTemplates.ts is a
-- separate, hardcoded catalog) — setting it to a guessed value would silently
-- do nothing today and could collide unpredictably if a real USG structured
-- template is added later. Findings insert into free-text Findings as normal.
-- =============================================================================

-- ── 1. Study tabs ─────────────────────────────────────────────────────────────
INSERT INTO radiology_study_tabs (name, sort_order) VALUES
  ('Whole Abdomen', 200),
  ('KUB',           210),
  ('Pelvis',        220),
  ('TVS',           230),
  ('Obstetric',     240),
  ('Growth',        250),
  ('Anomaly',       260),
  ('NT',            270),
  ('Thyroid',       280),
  ('Breast',        290),
  ('Scrotum',       300),
  ('Doppler',       310),
  ('Soft Tissue',   320)
ON CONFLICT (name) DO NOTHING;

-- ── 2. Clinical History chips (PR spec §9) ───────────────────────────────────
INSERT INTO radiology_clinical_history_chips (study_type, display_label, inserted_text, sort_order, is_system, is_active) VALUES
  ('Whole Abdomen', 'Pain abdomen', 'Pain abdomen.', 10, TRUE, TRUE),
  ('Whole Abdomen', 'Fever',        'Fever.', 20, TRUE, TRUE),
  ('Whole Abdomen', 'Jaundice',     'Jaundice.', 30, TRUE, TRUE),
  ('KUB',           'Renal colic',  'Renal colic.', 10, TRUE, TRUE),
  ('KUB',           'Hematuria',    'Hematuria.', 20, TRUE, TRUE),
  ('TVS',           'Infertility',  'Infertility workup.', 10, TRUE, TRUE),
  ('TVS',           'Bleeding PV',  'Bleeding per vaginum.', 20, TRUE, TRUE),
  ('Obstetric',     'Pregnancy',    'Known pregnancy — routine obstetric scan.', 10, TRUE, TRUE),
  ('Obstetric',     'Bleeding PV',  'Bleeding per vaginum.', 20, TRUE, TRUE),
  ('Thyroid',       'Thyroid swelling', 'Thyroid swelling.', 10, TRUE, TRUE),
  ('Breast',        'Breast lump',  'Palpable breast lump.', 10, TRUE, TRUE),
  ('Scrotum',       'Scrotal swelling', 'Scrotal swelling.', 10, TRUE, TRUE)
ON CONFLICT (study_type, display_label) DO NOTHING;

-- ── 3. Quick Findings ─────────────────────────────────────────────────────────
-- (study_type, label, finding_text, impression_text, category, tags, sort_order)
-- questions_json defaults to '[]' (immediate insert) except the structured
-- examples below, which reuse the EXISTING {key}/[optional] Structured Finding
-- Assistant mechanism (doc 04's "best-suited existing mechanism for USG" —
-- no new engine).

-- Whole Abdomen
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Whole Abdomen', 'Fatty Liver Gr I',  'Liver shows mildly increased echogenicity with normal size and contour, in keeping with Grade I (mild) fatty infiltration. No focal lesion.', 'Grade I fatty liver.', 'Liver', 10),
  ('Whole Abdomen', 'Fatty Liver Gr II', 'Liver shows moderately increased echogenicity with mild posterior beam attenuation, in keeping with Grade II (moderate) fatty infiltration. No focal lesion.', 'Grade II fatty liver.', 'Liver', 20),
  ('Whole Abdomen', 'Hepatomegaly',      'Liver is enlarged in size with normal echotexture. No focal lesion.', 'Hepatomegaly.', 'Liver', 30),
  ('Whole Abdomen', 'Cholelithiasis',    'Gallbladder shows a mobile echogenic focus with posterior acoustic shadowing, consistent with a calculus. No pericholecystic fluid or wall thickening.', 'Cholelithiasis.', 'Gallbladder', 40),
  ('Whole Abdomen', 'Splenomegaly',      'Spleen is enlarged in size with normal echotexture.', 'Splenomegaly.', 'Spleen', 50)
ON CONFLICT (study_type, label) DO NOTHING;

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('Whole Abdomen', 'Ascites', 'Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity.', '{grade} ascites.', 'Free fluid',
   '[{"key":"grade","label":"Quantity","type":"select","options":["Mild","Moderate","Gross"],"default":"Mild","required":true,"sortOrder":1}]', 60)
ON CONFLICT (study_type, label) DO NOTHING;

-- KUB
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('KUB', 'Renal Calculus', 'An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} kidney. No upstream hydronephrosis.', '{side} renal calculus.', 'Kidney',
   '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"right","required":true,"sortOrder":1},{"key":"size","label":"Size (mm)","type":"text","default":"","sortOrder":2}]', 10),
  ('KUB', 'Hydronephrosis', '{side} kidney shows {grade} hydronephrosis with dilated pelvicalyceal system.', '{side} {grade} hydronephrosis.', 'Kidney',
   '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"right","required":true,"sortOrder":1},{"key":"grade","label":"Grade","type":"select","options":["mild","moderate","gross"],"default":"mild","required":true,"sortOrder":2}]', 20)
ON CONFLICT (study_type, label) DO NOTHING;

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('KUB', 'Simple Renal Cyst',      'A well-defined anechoic cyst with posterior acoustic enhancement is noted in the kidney, showing no internal echoes or septations.', 'Simple renal cyst.', 'Kidney', 30),
  ('KUB', 'Bladder Wall Thickening', 'Urinary bladder wall appears diffusely thickened. Lumen is otherwise unremarkable.', 'Bladder wall thickening.', 'Bladder', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Pelvis
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Pelvis', 'Bulky Uterus',        'Uterus is bulky in size with normal myometrial echotexture. Endometrium is central and unremarkable.', 'Bulky uterus.', 'Uterus', 10),
  ('Pelvis', 'Endometrial Polyp',   'A well-defined echogenic endometrial lesion is noted, in keeping with an endometrial polyp.', 'Endometrial polyp.', 'Uterus', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- TVS (Transvaginal Sonography)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('TVS', 'Follicle Tracking', 'Right ovary shows {rightCount} follicle(s), largest measuring {rightLargestMm} mm. Left ovary shows {leftCount} follicle(s), largest measuring {leftLargestMm} mm.', 'Follicular study as above.', 'Ovaries',
   '[{"key":"rightCount","label":"Right — follicle count","type":"text","default":"","sortOrder":1},{"key":"rightLargestMm","label":"Right — largest (mm)","type":"text","default":"","sortOrder":2},{"key":"leftCount","label":"Left — follicle count","type":"text","default":"","sortOrder":3},{"key":"leftLargestMm","label":"Left — largest (mm)","type":"text","default":"","sortOrder":4}]', 10),
  ('TVS', 'Fibroid Uterus', 'A well-defined hypoechoic {location} myometrial lesion is noted, measuring approximately {size} mm, in keeping with a fibroid.', '{location} fibroid.', 'Uterus',
   '[{"key":"location","label":"Location","type":"select","options":["intramural","subserosal","submucosal"],"default":"intramural","required":true,"sortOrder":1},{"key":"size","label":"Size (mm)","type":"text","default":"","sortOrder":2}]', 20)
ON CONFLICT (study_type, label) DO NOTHING;

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('TVS', 'Simple Ovarian Cyst', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the ovary, showing no internal echoes, septations, or vascularity.', 'Simple ovarian cyst.', 'Ovaries', 30),
  ('TVS', 'Endometrial Thickness Normal', 'Endometrium is central, regular, and within normal limits for the reported cycle day.', 'Normal endometrial thickness.', 'Uterus', 40)
ON CONFLICT (study_type, label) DO NOTHING;

-- Obstetric
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Obstetric', 'Single Live IU Pregnancy', 'Single live intrauterine gestation is noted, with cardiac activity present.', 'Single live intrauterine pregnancy.', 'Fetus', 10),
  ('Obstetric', 'Oligohydramnios',   'Amniotic fluid volume is reduced for gestational age.', 'Oligohydramnios.', 'Liquor', 20),
  ('Obstetric', 'Polyhydramnios',    'Amniotic fluid volume is increased for gestational age.', 'Polyhydramnios.', 'Liquor', 30),
  ('Obstetric', 'Cephalic Presentation', 'Fetus is in cephalic presentation.', 'Cephalic presentation.', 'Presentation', 40),
  ('Obstetric', 'Breech Presentation',   'Fetus is in breech presentation.', 'Breech presentation.', 'Presentation', 50)
ON CONFLICT (study_type, label) DO NOTHING;

-- Growth
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Growth', 'Growth Appropriate for GA', 'Fetal biometry corresponds to the established gestational age. Interval growth is appropriate.', 'Growth appropriate for gestational age.', 'Biometry', 10),
  ('Growth', 'Fetal Growth Restriction',  'Fetal biometry is below the expected range for gestational age, suggestive of growth restriction.', 'Suspected fetal growth restriction — clinical correlation and Doppler assessment advised.', 'Biometry', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- Anomaly
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Anomaly', 'Normal Anomaly Survey', 'Fetal cranium, spine, cardiac four-chamber and outflow views, abdominal wall, stomach, kidneys, bladder, and limbs were surveyed and appear structurally normal for gestational age.', 'No sonographically detectable structural anomaly.', 'Survey', 10)
ON CONFLICT (study_type, label) DO NOTHING;

-- NT (Nuchal Translucency)
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('NT', 'NT Measurement', 'Nuchal translucency measures {ntMm} mm. Nasal bone is {nasalBone}.', 'NT {ntMm} mm.', 'NT',
   '[{"key":"ntMm","label":"NT (mm)","type":"text","default":"","required":true,"sortOrder":1},{"key":"nasalBone","label":"Nasal bone","type":"select","options":["present","absent","hypoplastic"],"default":"present","sortOrder":2}]', 10)
ON CONFLICT (study_type, label) DO NOTHING;

-- Thyroid
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('Thyroid', 'Thyroid Nodule', 'A {composition} nodule is noted in the {side} lobe, measuring approximately {size} mm, TI-RADS {tirads}.', '{side} thyroid nodule, TI-RADS {tirads}.', 'Thyroid',
   '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"right","required":true,"sortOrder":1},{"key":"composition","label":"Composition","type":"select","options":["solid","cystic","mixed solid-cystic"],"default":"solid","sortOrder":2},{"key":"size","label":"Size (mm)","type":"text","default":"","sortOrder":3},{"key":"tirads","label":"TI-RADS category","type":"select","options":["2","3","4","5"],"default":"3","required":true,"sortOrder":4}]', 10)
ON CONFLICT (study_type, label) DO NOTHING;

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Thyroid', 'Diffuse Goiter', 'Both thyroid lobes are diffusely enlarged with heterogeneous echotexture, in keeping with a diffuse goiter. No discrete nodule.', 'Diffuse goiter.', 'Thyroid', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- Breast
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('Breast', 'Solid Breast Lesion', 'A {shape} solid hypoechoic lesion is noted in the {side} breast, measuring approximately {size} mm, BI-RADS {birads}.', '{side} breast lesion, BI-RADS {birads}.', 'Breast',
   '[{"key":"side","label":"Side","type":"select","options":["right","left"],"default":"right","required":true,"sortOrder":1},{"key":"shape","label":"Shape","type":"select","options":["oval","round","irregular"],"default":"oval","sortOrder":2},{"key":"size","label":"Size (mm)","type":"text","default":"","sortOrder":3},{"key":"birads","label":"BI-RADS category","type":"select","options":["2","3","4","5"],"default":"3","required":true,"sortOrder":4}]', 10)
ON CONFLICT (study_type, label) DO NOTHING;

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Breast', 'Simple Breast Cyst', 'A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted, showing no internal echoes, septations, or mural nodularity.', 'Simple breast cyst, BI-RADS 2.', 'Breast', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- Scrotum
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, questions_json, sort_order) VALUES
  ('Scrotum', 'Varicocele', 'Dilated, tortuous veins of the pampiniform plexus are noted in the {side} hemiscrotum, showing reversal of flow with Valsalva, in keeping with a Grade {grade} varicocele.', '{side} Grade {grade} varicocele.', 'Scrotum',
   '[{"key":"side","label":"Side","type":"select","options":["right","left","bilateral"],"default":"left","required":true,"sortOrder":1},{"key":"grade","label":"Grade","type":"select","options":["I","II","III"],"default":"II","sortOrder":2}]', 10)
ON CONFLICT (study_type, label) DO NOTHING;

INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Scrotum', 'Hydrocele',            'Anechoic fluid collection is noted around the testis within the tunica vaginalis.', 'Hydrocele.', 'Scrotum', 20),
  ('Scrotum', 'Epididymo-orchitis',   'Epididymis and testis show increased size with increased vascularity on colour Doppler, in keeping with epididymo-orchitis.', 'Epididymo-orchitis.', 'Scrotum', 30)
ON CONFLICT (study_type, label) DO NOTHING;

-- Doppler
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Doppler', 'Normal Arterial Waveform', 'Arterial waveform shows a normal triphasic pattern with age-appropriate PSV and no evidence of significant stenosis.', 'Normal arterial Doppler study.', 'Arterial', 10),
  ('Doppler', 'DVT Present',           'The vein is non-compressible with echogenic intraluminal thrombus and absent flow on colour Doppler, in keeping with deep vein thrombosis.', 'Deep vein thrombosis.', 'Venous', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- Soft Tissue
INSERT INTO radiology_quick_findings (study_type, label, finding_text, impression_text, category, sort_order) VALUES
  ('Soft Tissue', 'Simple Lipoma',    'A well-defined, compressible, hyperechoic subcutaneous lesion is noted, showing no significant internal vascularity, in keeping with a lipoma.', 'Subcutaneous lipoma.', 'Soft Tissue', 10),
  ('Soft Tissue', 'Abscess Collection', 'A heterogeneous, predominantly hypoechoic collection with internal debris and peripheral hyperaemia is noted, in keeping with an abscess.', 'Soft tissue abscess.', 'Soft Tissue', 20)
ON CONFLICT (study_type, label) DO NOTHING;

-- ── 4. Protocol Engine (PR spec §10) ─────────────────────────────────────────
-- (name, study_type, modality, technique_text, normal_text, recommendation_text, required_measurements, sort_order)
INSERT INTO radiology_protocols (name, study_type, modality, technique_text, normal_text, recommendation_text, required_measurements, is_default, sort_order) VALUES
  ('USG Whole Abdomen', 'Whole Abdomen', 'USG',
   'Real-time grey-scale ultrasound of the abdomen was performed using a curvilinear probe.',
   'Liver is normal in size and echotexture with no focal lesion. Gallbladder is normal with no calculus or wall thickening. Common bile duct is not dilated. Pancreas and spleen are normal. Both kidneys are normal in size, cortical thickness, and echotexture with no calculus or hydronephrosis. Urinary bladder is normal with no calculus or wall thickening. No free fluid in the abdomen or pelvis.',
   'Please correlate with clinical findings.',
   'liver_span,cbd_diameter,right_kidney_length,left_kidney_length,pvr', TRUE, 10),
  ('USG KUB', 'KUB', 'USG',
   'Real-time grey-scale ultrasound of the kidneys, ureters, and urinary bladder was performed using a curvilinear probe with pre- and post-void bladder assessment.',
   'Both kidneys are normal in size, cortical thickness, and echotexture with no calculus or hydronephrosis. Ureters are not dilated. Urinary bladder is normal in outline and wall thickness with no calculus. Post-void residual urine is minimal.',
   'Please correlate with clinical findings.',
   'right_kidney_length,left_kidney_length,pvr', TRUE, 20),
  ('USG Pelvis (TA/TV)', 'Pelvis', 'USG',
   'Real-time grey-scale ultrasound of the pelvis was performed transabdominally with a full urinary bladder, supplemented by a transvaginal scan where indicated.',
   'Uterus is normal in size, position, and myometrial echotexture. Endometrium is central and normal in thickness. Both ovaries are normal in size with normal follicular pattern. No adnexal mass. No free fluid in the pouch of Douglas.',
   'Please correlate with clinical findings.',
   'uterus_length,endometrial_thickness,right_ovary_volume,left_ovary_volume', TRUE, 30),
  ('USG TVS', 'TVS', 'USG',
   'Transvaginal ultrasound was performed with an empty urinary bladder using a high-frequency endocavitary probe.',
   'Uterus is normal in size and myometrial echotexture. Endometrium is central and normal in thickness for cycle day. Both ovaries are normal in size with a normal antral follicle count. No adnexal mass. No free fluid.',
   'Please correlate with clinical findings and cycle day.',
   'uterus_length,endometrial_thickness,right_ovary_volume,left_ovary_volume', TRUE, 40),
  ('USG Obstetric Growth Scan', 'Obstetric', 'USG',
   'Real-time obstetric ultrasound was performed transabdominally, assessing fetal biometry, liquor volume, placental location, and Doppler where indicated.',
   'Single live intrauterine fetus in cephalic presentation. Fetal biometry corresponds to the established gestational age with appropriate interval growth. Liquor volume is adequate. Placenta is normally located, away from the internal os. No gross structural anomaly identified on the current survey.',
   'Please correlate clinically. Routine antenatal follow-up as advised.',
   'bpd,hc,ac,fl,efw,afi', TRUE, 50),
  ('USG Anomaly Scan (Level II)', 'Anomaly', 'USG',
   'Detailed anatomical survey (Level II / TIFFA) was performed transabdominally between 18 and 22 weeks, assessing fetal cranium, spine, cardiac four-chamber and outflow tracts, abdominal wall, stomach, kidneys, bladder, and limbs.',
   'Fetal cranium, spine, cardiac four-chamber and outflow views, abdominal wall, stomach, kidneys, bladder, and limbs are structurally normal for gestational age.',
   'Please correlate clinically. Routine antenatal follow-up as advised.',
   'bpd,hc,ac,fl,efw,afi', TRUE, 60),
  ('USG Growth Scan (3rd Trimester)', 'Growth', 'USG',
   'Real-time obstetric ultrasound was performed transabdominally, assessing fetal biometry, liquor volume, placental location, presentation, and Doppler where indicated.',
   'Fetal biometry corresponds to the established gestational age with appropriate interval growth. Liquor volume is adequate. Placenta is normally located. Umbilical artery Doppler indices are within normal limits.',
   'Please correlate clinically. Routine antenatal follow-up as advised.',
   'bpd,hc,ac,fl,efw,afi,ua_pi,ua_ri', TRUE, 70),
  ('USG NT Scan', 'NT', 'USG',
   'First-trimester ultrasound was performed transabdominally between 11 and 13+6 weeks, assessing crown-rump length, nuchal translucency, and nasal bone.',
   'Single live intrauterine fetus. CRL corresponds to the established gestational age. Nuchal translucency and nasal bone are within normal limits.',
   'Combine with maternal serum biochemistry for aneuploidy risk assessment as clinically indicated.',
   'crl,nt', TRUE, 80),
  ('USG Thyroid', 'Thyroid', 'USG',
   'Real-time grey-scale and colour Doppler ultrasound of the thyroid and neck was performed using a high-frequency linear probe.',
   'Both thyroid lobes and the isthmus are normal in size with homogeneous echotexture. No discrete nodule. No significant cervical lymphadenopathy.',
   'Please correlate with clinical and biochemical findings.',
   '', TRUE, 90),
  ('USG Breast', 'Breast', 'USG',
   'Real-time grey-scale and colour Doppler ultrasound of both breasts and axillae was performed using a high-frequency linear probe.',
   'Both breasts show normal fibroglandular echotexture with no discrete mass, architectural distortion, or suspicious calcification. Both axillae are normal, BI-RADS 1.',
   'Routine screening interval as clinically advised.',
   '', TRUE, 100),
  ('USG Scrotum', 'Scrotum', 'USG',
   'Real-time grey-scale and colour Doppler ultrasound of the scrotum was performed using a high-frequency linear probe.',
   'Both testes are normal in size, outline, and echotexture with symmetric vascularity on colour Doppler. Both epididymes are normal. No hydrocele or varicocele.',
   'Please correlate with clinical findings.',
   '', TRUE, 110),
  ('USG Doppler (Vascular)', 'Doppler', 'USG',
   'Grey-scale, colour, and spectral Doppler ultrasound of the indicated vessel(s) was performed.',
   'Normal arterial waveform with triphasic pattern and no evidence of significant stenosis. Veins are compressible with normal augmentation and no evidence of thrombus.',
   'Please correlate with clinical findings.',
   'psv,edv,ri', TRUE, 120),
  ('USG Soft Tissue', 'Soft Tissue', 'USG',
   'Real-time grey-scale and colour Doppler ultrasound of the indicated soft-tissue region was performed using a high-frequency linear probe.',
   'The examined soft tissue region shows normal echotexture with no discrete mass, collection, or significant vascularity.',
   'Please correlate with clinical findings.',
   '', TRUE, 130)
ON CONFLICT (name) DO NOTHING;
