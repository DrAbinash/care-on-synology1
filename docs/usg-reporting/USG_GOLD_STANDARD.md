# CARE USG Gold Standard

**Status:** Authoritative clinical content specification for the CARE Ultrasound (USG) reporting platform.
**Scope:** 32 study types across 5 clinical categories, all delivered on the canonical
`RadiologyReportingWorkspace` via the existing Template/Protocol/Quick-Findings/Clinical-History-Chip/Copilot
infrastructure — no new reporting engine, no hardcoded React content.

## Purpose

This document is the single source of truth for what "clinically complete" means for each USG study type on the
CARE platform. Every study defined here maps 1:1 onto rows in the existing shared configuration tables
(`radiology_study_tabs`, `radiology_protocols`, `radiology_quick_findings`, `radiology_clinical_history_chips`,
`radiology_quick_measurements`) — it does not introduce any new content model. The migration that loads this
content (`migrations/zzz_add_usg_gold_standard_content.sql`) is generated directly from this document.

## How to Read Each Study Entry

Each study defines:

- **Purpose** — the clinical question the study answers.
- **Standard section order** — the report section sequence as shown to the reporting sonologist/radiologist.
- **Mandatory / optional sections** — which sections must be completed before finalize vs. which are supportive.
- **Measurements** — label, unit, normal range, whether required, and the Quick Measurement template
  (`{value}` placeholder, reused verbatim by the existing Quick Measurements engine).
- **Normal template** — the default "everything normal" Findings text.
- **Quick Findings** — one-click finding insertions; `structured: true` entries use the existing
  Structured Finding Assistant `{key}` / `[optional clause]` bracket syntax, with a `questions` array
  (`select` or `text` type — no `number` type exists in the assistant).
- **Clinical History Chips** — one-click clinical-history insertions.
- **Protocol** — the `radiology_protocols` row this study maps to (name, technique text, default recommendation).
- **Impression / Recommendation / Follow-up philosophy** — narrative authoring guidance for how Copilot and
  reporting staff should structure these sections; not machine-enforced text, but the design intent behind the
  Copilot checks below.
- **Copilot behaviour** — what the relevant Copilot module(s) check for this study (reusing the existing
  plug-in architecture — no new Copilot core behaviour).
- **Structured Finding Assistant logic** — why particular findings were modeled as structured (`{key}`-driven)
  vs. plain text.
- **Critical findings** — findings that should be treated as critical/urgent for this study type.
- **Print behaviour** — how the study renders in the printed report.

## Categories

- [General](#general) — 6 studies
- [Gynaecology](#gynaecology) — 5 studies
- [Obstetric](#obstetric) — 9 studies
- [Small Parts](#small-parts) — 5 studies
- [Doppler](#doppler) — 7 studies

---

## General

### USG Whole Abdomen

**Tab name:** Whole Abdomen

**Purpose:** Organ-by-organ survey of the liver, gallbladder, biliary tree, pancreas, spleen, kidneys, urinary bladder, and peritoneal cavity for nonspecific abdominal complaints (pain, fever, jaundice) and as a general screening study.

#### Standard Section Order

Clinical History → Technique → Findings → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Clinical History
- Technique
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Liver span | mm | Up to approximately 130-150 mm at the mid-clavicular line | Yes | `Liver span: {value} mm.` |
| CBD diameter | mm | <6 mm (up to 8-10 mm acceptable post-cholecystectomy or with advancing age) | Yes | `CBD diameter: {value} mm.` |
| Right kidney length | mm | 90-120 mm bipolar length | Yes | `Right kidney length: {value} mm.` |
| Left kidney length | mm | 90-120 mm bipolar length | Yes | `Left kidney length: {value} mm.` |
| Post-void residual (PVR) | mL | <50 mL, ideally <20 mL | Yes | `Post-void residual urine: {value} mL.` |

**Required measurements:** Liver span, CBD diameter, Right kidney length, Left kidney length, Post-void residual (PVR)

**Optional measurements:** _None_

#### Normal Template

> Liver is normal in size and echotexture with no focal lesion. Gallbladder is normal with no calculus or wall thickening. Common bile duct is not dilated. Pancreas and spleen are normal. Both kidneys are normal in size, cortical thickness, and echotexture with no calculus or hydronephrosis. Urinary bladder is normal with no calculus or wall thickening. Post-void residual urine is minimal. No free fluid in the abdomen or pelvis.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Fatty Liver Gr I | No | Liver shows mildly increased echogenicity with normal size and contour, in keeping with Grade I (mild) fatty infiltration. No focal lesion. | Grade I fatty liver. |
| Fatty Liver Gr II | No | Liver shows moderately increased echogenicity with mild posterior beam attenuation, in keeping with Grade II (moderate) fatty infiltration. No focal lesion. | Grade II fatty liver. |
| Fatty Liver Gr III | No | Liver shows markedly increased echogenicity with significant posterior beam attenuation and poor visualization of the diaphragm and intrahepatic vasculature, in keeping with Grade III (severe) fatty infiltration. No focal lesion. | Grade III fatty liver. |
| Hepatomegaly | No | Liver is enlarged in size with normal echotexture. No focal lesion. | Hepatomegaly. |
| Simple Hepatic Cyst | No | A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the liver parenchyma, showing no internal echoes, septations, or solid component. | Simple hepatic cyst. |
| Cholelithiasis | No | Gallbladder shows a mobile echogenic focus with posterior acoustic shadowing, consistent with a calculus. No pericholecystic fluid or wall thickening. | Cholelithiasis. |
| Gallbladder Polyp | Yes | Gallbladder shows a non-shadowing, immobile, echogenic polypoid lesion arising from the wall, measuring approximately {size} mm. | Gallbladder polyp ({size} mm). |
| Splenomegaly | No | Spleen is enlarged in size with normal echotexture. | Splenomegaly. |
| Ascites | Yes | Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity. | {grade} ascites. |

Structured Finding Assistant question sets for this study:

- **Gallbladder Polyp**:
  - `size` — Size (mm), type: text, optional, default: ``
- **Ascites**:
  - `grade` — Quantity, type: select, required, default: `Mild` (options: Mild, Moderate, Gross)

#### Clinical History Chips

- **Pain abdomen** — inserts: "Pain abdomen."
- **Fever** — inserts: "Fever."
- **Jaundice** — inserts: "Jaundice."

#### Protocol

- **Protocol name:** USG Whole Abdomen

- **Technique:** Real-time grey-scale ultrasound of the abdomen was performed using a curvilinear probe.

- **Default recommendation text:** Please correlate with clinical findings.

#### Impression Philosophy

Impression is a short organ-tagged summary list (one line per abnormal organ, in survey order), not a restatement of Findings; a normal study collapses to a single 'No sonographic abnormality detected in the abdomen' line.

#### Recommendation Philosophy

Default is 'Please correlate with clinical findings.'; upgraded only for a specific actionable trigger — e.g. an obstructing CBD calculus escalates to a surgical/gastroenterology referral note, and a new hepatic or renal mass escalates to a cross-sectional-imaging recommendation.

#### Follow-up Philosophy

Fatty liver grading, simple cysts, and small non-obstructing calculi close with routine review; any focal solid mass, ductal dilatation, or free fluid without a clear benign explanation is flagged for a defined short-interval follow-up or same-day clinical communication rather than routine review.

#### Copilot Behaviour

Confirms every core organ (liver, gallbladder, CBD, pancreas, spleen, both kidneys, urinary bladder) is addressed in Findings before allowing finalize; flags a jaundice-history report that omits a CBD-diameter statement; flags an Impression left as 'normal' when a calculus or mass finding was actually documented in Findings.

#### Structured Finding Assistant Logic

Ascites uses a {grade} select (Mild/Moderate/Gross) so severity is captured once and threads consistently into both Findings and Impression; Gallbladder Polyp uses a free-text {size} field since polyp size — the actionable number for the >10 mm cholecystectomy-referral threshold — doesn't fit a fixed option set.

#### Critical Findings

- Free intraperitoneal fluid in a trauma or acute-abdomen context
- Pneumoperitoneum / free air
- Portal vein thrombosis
- Impacted CBD calculus with biliary dilatation
- Ruptured or actively bleeding hepatic/splenic lesion
- Abdominal aortic aneurysm >5 cm or with mural thrombus
- New renal or hepatic mass suspicious for malignancy

#### Print Behaviour

Prints as a single-page general report in Clinical History/Technique/Findings/Impression/Recommendation order; organ-negative statements from the normal template are retained verbatim for any organ not overridden by a quick finding, so the printed Findings section always reads as a complete organ-by-organ survey rather than only listing abnormalities.


### USG KUB

**Tab name:** KUB

**Purpose:** Assessment of the kidneys, ureters, and urinary bladder (with pre- and post-void bladder evaluation) for renal colic, hematuria, urinary retention, and lower urinary tract symptoms.

#### Standard Section Order

Clinical History → Technique → Findings → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Clinical History
- Technique
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Right kidney length | mm | 90-120 mm bipolar length | Yes | `Right kidney length: {value} mm.` |
| Left kidney length | mm | 90-120 mm bipolar length | Yes | `Left kidney length: {value} mm.` |
| Post-void residual (PVR) | mL | <50 mL, ideally <20 mL | Yes | `Post-void residual urine: {value} mL.` |
| Bladder wall thickness | mm | <3 mm in a well-distended bladder | No | `Bladder wall thickness: {value} mm.` |

**Required measurements:** Right kidney length, Left kidney length, Post-void residual (PVR)

**Optional measurements:** Bladder wall thickness

#### Normal Template

> Both kidneys are normal in size, cortical thickness, and echotexture with no calculus or hydronephrosis. Ureters are not dilated. Urinary bladder is normal in outline and wall thickness with no calculus. Post-void residual urine is minimal.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Renal Calculus | Yes | An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} kidney. No upstream hydronephrosis. | {side} renal calculus. |
| Ureteric Calculus | Yes | An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} ureter at the {level} level, with upstream {side} hydroureteronephrosis. | {side} {level} ureteric calculus with hydroureteronephrosis. |
| Hydronephrosis | Yes | {side} kidney shows {grade} hydronephrosis with dilated pelvicalyceal system. | {side} {grade} hydronephrosis. |
| Simple Renal Cyst | No | A well-defined anechoic cyst with posterior acoustic enhancement is noted in the kidney, showing no internal echoes or septations. | Simple renal cyst. |
| Bladder Calculus | No | A mobile echogenic focus with posterior acoustic shadowing is noted within the urinary bladder lumen, shifting with change in patient position, consistent with a bladder calculus. | Bladder calculus. |
| Bladder Wall Thickening | No | Urinary bladder wall appears diffusely thickened. Lumen is otherwise unremarkable. | Bladder wall thickening. |
| Elevated Post-Void Residual | Yes | Post-void residual urine volume is estimated at approximately {volume} mL, which is elevated for age, in keeping with incomplete bladder emptying. | Elevated post-void residual ({volume} mL) — incomplete bladder emptying. |

Structured Finding Assistant question sets for this study:

- **Renal Calculus**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `size` — Size (mm), type: text, optional, default: ``
- **Ureteric Calculus**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `level` — Level, type: select, required, default: `distal (VUJ)` (options: proximal, mid, distal (VUJ))
  - `size` — Size (mm), type: text, optional, default: ``
- **Hydronephrosis**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `grade` — Grade, type: select, required, default: `mild` (options: mild, moderate, gross)
- **Elevated Post-Void Residual**:
  - `volume` — PVR volume (mL), type: text, required, default: ``

#### Clinical History Chips

- **Renal colic** — inserts: "Renal colic."
- **Hematuria** — inserts: "Hematuria."
- **Urinary retention** — inserts: "Urinary retention / difficulty voiding."

#### Protocol

- **Protocol name:** USG KUB

- **Technique:** Real-time grey-scale ultrasound of the kidneys, ureters, and urinary bladder was performed using a curvilinear probe with pre- and post-void bladder assessment.

- **Default recommendation text:** Please correlate with clinical findings.

#### Impression Philosophy

One line per kidney/ureter/bladder abnormality, ordered by clinical urgency (obstruction first); a fully normal study collapses to a single 'No sonographic abnormality of the kidneys, ureters, or bladder' line.

#### Recommendation Philosophy

Default is clinical correlation; escalated to 'urology referral advised' for any obstructing calculus or significant hydronephrosis, and to a repeat/CT recommendation when a ureteric calculus is suspected but the distal ureter is not adequately visualized (a common technical limitation).

#### Follow-up Philosophy

Small non-obstructing calculi and simple cysts close with routine review; any calculus with hydronephrosis, a solid renal mass, or markedly elevated PVR is flagged for urgent clinical communication rather than routine turnaround.

#### Copilot Behaviour

Confirms both kidneys, ureters (when dilated), and bladder (including PVR) are each addressed before finalize; flags a 'renal colic' history chip whose Findings omit a hydronephrosis/calculus statement for either kidney; prompts for stone size/side whenever Renal Calculus or Ureteric Calculus is used and left blank.

#### Structured Finding Assistant Logic

Renal Calculus, Ureteric Calculus, and Hydronephrosis all reuse the same {side} select already established across the content pack, and Hydronephrosis/Ureteric Calculus share the same severity/level vocabulary so laterality and severity read consistently whichever finding fires.

#### Critical Findings

- Obstructing renal or ureteric calculus with moderate-severe hydronephrosis
- Solid renal mass suspicious for malignancy
- Pyonephrosis (infected obstructed system)
- Grossly elevated post-void residual with bilateral hydroureteronephrosis suggesting bladder outlet obstruction

#### Print Behaviour

Findings always states left and right kidney status explicitly, even when normal, plus a bladder/PVR line, so a report never silently omits a side; Impression leads with the most clinically urgent finding (e.g. an obstructing calculus) ahead of incidental ones (e.g. a simple cyst).


### USG Pelvis (TA/TV)

**Tab name:** Pelvis

**Purpose:** General transabdominal (with transvaginal supplementation where indicated) pelvic scan for both sexes — uterus/ovary screening, bladder assessment, and prostate screening — distinct from the dedicated TVS/gynae workup covered elsewhere.

#### Standard Section Order

Clinical History → Technique → Findings → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Clinical History
- Technique
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Uterus length | mm | 60-80 mm in the premenopausal nulliparous adult (larger if parous) | No | `Uterus length: {value} mm.` |
| Endometrial thickness | mm | 4-8 mm proliferative phase; up to 16 mm secretory phase; <5 mm postmenopausal without HRT | No | `Endometrial thickness: {value} mm.` |
| Right ovary volume | cc | <10 cc (premenopausal) | No | `Right ovary volume: {value} cc.` |
| Left ovary volume | cc | <10 cc (premenopausal) | No | `Left ovary volume: {value} cc.` |
| Prostate volume | cc | <25-30 cc | No | `Prostate volume: {value} cc.` |

**Required measurements:** _None_

**Optional measurements:** Uterus length, Endometrial thickness, Right ovary volume, Left ovary volume, Prostate volume

#### Normal Template

> Uterus is normal in size, position, and myometrial echotexture. Endometrium is central and normal in thickness. Both ovaries are normal in size with normal follicular pattern. No adnexal mass. No free fluid in the pouch of Douglas.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Bulky Uterus | No | Uterus is bulky in size with normal myometrial echotexture. Endometrium is central and unremarkable. | Bulky uterus. |
| Endometrial Polyp | No | A well-defined echogenic endometrial lesion is noted, in keeping with an endometrial polyp. | Endometrial polyp. |
| Simple Adnexal Cyst | No | A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the adnexa, showing no internal echoes, septations, or vascularity. | Simple adnexal cyst. |
| Free Pelvic Fluid | No | A small amount of free anechoic fluid is noted in the pouch of Douglas/pelvis. | Free fluid in the pelvis — physiological unless clinically significant. |
| Benign Prostatic Hyperplasia | Yes | Prostate is enlarged in volume, measuring approximately {volume} cc, with a smooth, symmetric, predominantly heterogeneous echotexture, in keeping with benign prostatic hyperplasia. No definite focal hypoechoic lesion. | Benign prostatic hyperplasia (~{volume} cc). |

Structured Finding Assistant question sets for this study:

- **Benign Prostatic Hyperplasia**:
  - `volume` — Estimated prostate volume (cc), type: text, required, default: ``

#### Clinical History Chips

- **LUTS (urinary symptoms)** — inserts: "Lower urinary tract symptoms."
- **Pelvic pain** — inserts: "Pelvic pain."
- **Prostate screening** — inserts: "Prostate screening / PSA follow-up."

#### Protocol

- **Protocol name:** USG Pelvis (TA/TV)

- **Technique:** Real-time grey-scale ultrasound of the pelvis was performed transabdominally with a full urinary bladder, supplemented by a transvaginal scan where indicated.

- **Default recommendation text:** Please correlate with clinical findings.

#### Impression Philosophy

States the relevant organ system's status in one or two lines; a bladder- or prostate-only referral does not force an ovarian/uterine statement into the Impression, and vice versa.

#### Recommendation Philosophy

Default is clinical correlation; an indeterminate or complex adnexal/endometrial finding is escalated to 'dedicated TVS recommended for further characterization' rather than resolved on the general TA/TV study, and a significantly enlarged prostate with elevated PVR is escalated to urology referral.

#### Follow-up Philosophy

A normal general pelvis scan needs no further imaging; any finding needing morphology-based characterization (adnexal cyst features, endometrial pattern, fibroid mapping) is routed to a follow-up dedicated TVS rather than resolved here, and significant PVR/prostate findings are routed to urology.

#### Copilot Behaviour

Since this protocol serves both sexes, checks that the report states which pelvic organs were actually assessed (uterus/ovaries vs. prostate/bladder) rather than leaving an irrelevant line blank without comment; flags a bladder-referral report with no PVR/wall-thickness statement and a prostate-screening report with no volume estimate; reminds that any suspicious adnexal or endometrial finding on a general TA/TV scan should prompt referral to the dedicated TVS/gynae study rather than being over-called here.

#### Structured Finding Assistant Logic

This tab intentionally carries only one structured finding (Benign Prostatic Hyperplasia, a {volume} text field) — cycle-day-dependent or morphology-scored gynae findings (follicle counts, fibroid grading, IOTA/O-RADS scoring) are deliberately deferred to the dedicated TVS/gynae study another author covers, avoiding duplicate structured-finding rows for the same anatomy across two tabs.

#### Critical Findings

- Complex/solid adnexal mass suspicious for malignancy
- Free fluid with a positive pregnancy test raising concern for ectopic pregnancy or a ruptured cyst
- Markedly enlarged prostate with bladder outlet obstruction and a large PVR
- Postmenopausal endometrial thickening beyond the accepted threshold

#### Print Behaviour

Prints with only the sex-relevant organ block populated (uterus/ovaries or prostate) rather than a fixed template that always lists both, since this is a shared TA/TV protocol for male and female referrals alike.


### USG Appendix (Graded Compression)

**Tab name:** Appendix

**Purpose:** Targeted graded-compression ultrasound for clinically suspected acute appendicitis, assessing appendiceal diameter, wall integrity, and periappendiceal inflammatory change, and used to suggest an alternative diagnosis for right iliac fossa pain when the appendix is normal.

#### Standard Section Order

Clinical History → Technique → Findings → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Clinical History
- Technique
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Appendix diameter | mm | <6 mm outer diameter | Yes | `Appendix diameter: {value} mm.` |
| Appendiceal wall thickness | mm | <3 mm | Yes | `Appendiceal wall thickness: {value} mm.` |

**Required measurements:** Appendix diameter, Appendiceal wall thickness

**Optional measurements:** _None_

#### Normal Template

> The appendix is visualized as a blind-ending, compressible, non-inflamed tubular structure arising from the cecum, measuring less than 6 mm in outer diameter, with no wall thickening, hyperaemia, periappendiceal fat stranding, or free fluid. No mesenteric lymphadenopathy.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Appendix | No | The appendix is visualized as a blind-ending, compressible, non-inflamed tubular structure arising from the cecum, measuring less than 6 mm in outer diameter, with no wall thickening or periappendiceal fat stranding. | Normal appendix. No sonographic evidence of acute appendicitis. |
| Acute Appendicitis | Yes | A non-compressible, blind-ending tubular structure is noted in the right iliac fossa arising from the cecum, measuring {diameter} mm in outer diameter, with mural wall thickening and increased wall vascularity on colour Doppler[, with {periappendiceal}][, with {appendicolith}], in keeping with acute appendicitis. | Acute appendicitis, {diameter} mm[, with {periappendiceal}][, with {appendicolith}]. |
| Periappendiceal Abscess | No | A complex, predominantly hypoechoic collection with internal debris is noted adjacent to the cecum/appendix, in keeping with a periappendiceal or appendiceal abscess. | Periappendiceal abscess — surgical/interventional correlation advised. |
| Non-Visualized Appendix | No | The appendix could not be confidently visualized due to overlying bowel gas or body habitus; graded compression technique was used without definitive identification. | Appendix not visualized. Clinical correlation advised; appendicitis cannot be definitively excluded on this study. |
| Mesenteric Lymphadenitis | No | Multiple enlarged, hypoechoic, oval mesenteric lymph nodes are noted in the right iliac fossa, with a normal-caliber appendix. | Mesenteric lymphadenitis. Normal appendix. |

Structured Finding Assistant question sets for this study:

- **Acute Appendicitis**:
  - `diameter` — Diameter (mm), type: text, required, default: ``
  - `periappendiceal` — Periappendiceal change, type: select, optional, default: `None` (options: None, periappendiceal fat stranding, a periappendiceal free fluid collection)
  - `appendicolith` — Appendicolith, type: select, optional, default: `None` (options: None, an associated appendicolith)

#### Clinical History Chips

- **RIF pain** — inserts: "Right iliac fossa pain."
- **Suspected appendicitis** — inserts: "Clinically suspected acute appendicitis."
- **Fever with abdominal pain** — inserts: "Fever with abdominal pain."

#### Protocol

- **Protocol name:** USG Appendix

- **Technique:** Graded-compression real-time ultrasound of the right iliac fossa was performed using a high-frequency linear probe (supplemented by a curvilinear probe in larger patients), with the transducer used to gradually displace overlying bowel gas and identify the appendix arising from the cecal tip.

- **Default recommendation text:** Please correlate with clinical findings and laboratory parameters (total leukocyte count, CRP).

#### Impression Philosophy

A single, unambiguous line — either 'No sonographic evidence of acute appendicitis' or 'Acute appendicitis' with diameter and any complicating feature — deliberately avoiding a hedged Impression when a normal, well-visualized appendix is seen, since RIF-pain referrers act directly on this line.

#### Recommendation Philosophy

Default recommendation asks for clinical/laboratory correlation; escalated to a same-day surgical referral note whenever Acute Appendicitis (with or without complication) is selected, and to 'appendix not visualized — clinical correlation, consider CT if suspicion remains high' whenever the appendix isn't seen.

#### Follow-up Philosophy

A confidently normal, visualized appendix needs no further imaging; a non-visualized appendix or an equivocal (mildly enlarged, <7 mm, no secondary signs) appendix is flagged for clinical reassessment or CT rather than silently treated as normal.

#### Copilot Behaviour

Prompts for appendix diameter whenever 'Acute Appendicitis' or 'Normal Appendix' is used and it is left blank; flags an Impression that states appendicitis without a diameter measurement recorded; reminds the reporter to explicitly document whether the appendix was or was not visualized, since a non-diagnostic study needs an explicit statement rather than being left blank.

#### Structured Finding Assistant Logic

Acute Appendicitis is the one structured finding in this tab, using two bracket-optional {key} clauses (periappendiceal change, appendicolith) so a straightforward inflamed-but-uncomplicated appendix and a complicated one (fat stranding, free fluid, appendicolith) generate correctly worded Findings/Impression text from the same template without needing a second finding row.

#### Critical Findings

- Acute appendicitis with periappendiceal abscess or suspected perforation
- Free intraperitoneal fluid or air suggesting perforation
- Appendicolith with a non-compressible, dilated (>6 mm) appendix

#### Print Behaviour

Prints with an explicit single appendix-status statement always present in Findings, even for a normal study, since referring surgeons rely on that one sentence to decide urgency without opening the full report.


### USG Hernia (Abdominal Wall / Inguinal)

**Tab name:** Hernia

**Purpose:** Dynamic real-time ultrasound of an abdominal wall or groin swelling to confirm a hernia, characterize the defect and its contents, assess reducibility, and detect complications (incarceration, strangulation) using Valsalva/standing provocation.

#### Standard Section Order

Clinical History → Technique → Findings → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Clinical History
- Technique
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Defect (neck) size | mm | No defect identified in a normal abdominal wall/inguinal canal | No | `Defect (neck) size: {value} mm.` |
| Herniated content extent | mm | No protrusion beyond the fascial plane in the absence of a hernia | No | `Contents protrude approximately {value} mm beyond the defect.` |

**Required measurements:** _None_

**Optional measurements:** Defect (neck) size, Herniated content extent

#### Normal Template

> No fascial defect is demonstrated in the abdominal wall or inguinal canal on dynamic scanning with Valsalva maneuver and standing provocation. No abnormal protrusion of bowel loops or omental fat is seen.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Reducible Inguinal Hernia | Yes | A defect is noted in the {side} inguinal canal through which {contents} protrude on Valsalva maneuver/standing, with free reduction on supine positioning and gentle compression. No bowel wall thickening or free fluid is seen. | {side} reducible inguinal hernia containing {contents}. |
| Irreducible/Incarcerated Hernia | Yes | A {side} groin/abdominal wall defect contains {contents} which do not reduce with compression or on lying supine[, with {strangulationSigns}]. | {side} irreducible hernia containing {contents}[, with {strangulationSigns}] — clinical correlation for possible incarceration/strangulation advised. |
| Umbilical Hernia | Yes | A ventral abdominal wall defect is noted at the umbilicus, measuring approximately {size} mm, through which {contents} protrudes on Valsalva maneuver, reducing spontaneously in the supine relaxed position. | Umbilical hernia ({size} mm) containing {contents}. |
| Incisional Hernia | No | A defect is noted within the anterior abdominal wall musculature/fascia at the site of the previous surgical scar, through which omental fat/bowel protrudes with increased intra-abdominal pressure, reducing on relaxation. | Incisional hernia at the site of the surgical scar. |
| No Hernia Demonstrated | No | No fascial defect or abdominal wall/groin hernia is demonstrated on dynamic scanning with Valsalva maneuver and standing provocation. | No sonographic evidence of hernia at the site of clinical concern. |

Structured Finding Assistant question sets for this study:

- **Reducible Inguinal Hernia**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `contents` — Contents, type: select, required, default: `omental fat` (options: omental fat, small bowel loops, large bowel)
- **Irreducible/Incarcerated Hernia**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `contents` — Contents, type: select, required, default: `omental fat` (options: omental fat, small bowel loops, large bowel)
  - `strangulationSigns` — Strangulation signs, type: select, optional, default: `None` (options: None, bowel wall thickening, reduced peristalsis, and hyperaemia concerning for compromised bowel)
- **Umbilical Hernia**:
  - `size` — Defect size (mm), type: text, required, default: ``
  - `contents` — Contents, type: select, required, default: `omental fat` (options: omental fat, bowel)

#### Clinical History Chips

- **Groin swelling** — inserts: "Groin swelling."
- **Reducible lump on straining** — inserts: "Reducible lump on straining/coughing."
- **Post-operative bulge at scar site** — inserts: "Post-operative bulge at surgical scar site."

#### Protocol

- **Protocol name:** USG Hernia (Abdominal Wall / Inguinal)

- **Technique:** Real-time grey-scale ultrasound of the site of clinical concern was performed using a high-frequency linear probe with the patient supine and, where needed, standing, incorporating Valsalva maneuver and gentle graded compression to assess for a fascial defect, its contents, and reducibility.

- **Default recommendation text:** Please correlate with clinical examination; surgical referral advised if a hernia is confirmed.

#### Impression Philosophy

Impression always states hernia type, side, contents, and reducibility status in one line; 'no hernia demonstrated' explicitly names the alternate diagnosis (e.g. lipoma, node) when one was found, rather than a bare negative.

#### Recommendation Philosophy

Default points to elective surgical referral for a reducible hernia; escalated to urgent/same-day surgical communication for any irreducible or strangulation-suspicious finding.

#### Follow-up Philosophy

A reducible, asymptomatic hernia is closed with routine elective surgical follow-up; an irreducible hernia or any strangulation sign triggers immediate direct communication with the referring/surgical team rather than routine reporting turnaround.

#### Copilot Behaviour

Prompts for reducibility and Valsalva/standing technique documentation whenever a hernia finding is used; flags an 'irreducible' finding whose Findings text doesn't mention bowel wall/peristalsis assessment; reminds that an irreducible or tender hernia warrants same-day surgical communication, not a routine-report item.

#### Structured Finding Assistant Logic

Reducible Inguinal Hernia, Irreducible/Incarcerated Hernia, and Umbilical Hernia each reuse the same {side}/{contents} (or {size}/{contents}) question pattern already established for KUB's Renal Calculus and TVS's Fibroid Uterus, so laterality and content type stay consistent across the tab; the Irreducible finding additionally uses an optional [strangulation-sign] bracket that is dropped for a straightforward incarcerated-but-viable hernia and populated only when secondary bowel-compromise signs are actually seen.

#### Critical Findings

- Irreducible/incarcerated hernia
- Bowel wall thickening, reduced peristalsis, or free fluid within the hernia sac suggesting strangulation
- Small bowel obstruction proximal to a hernia defect

#### Print Behaviour

Prints with an explicit reducibility/Valsalva statement always present in Findings, even for a normal study, since referring surgeons rely on that single sentence to decide urgency without opening the full report.


### USG Soft Tissue

**Tab name:** Soft Tissue

**Purpose:** Generic workup of a superficial lump, bump, or swelling — characterizing a subcutaneous or intramuscular lesion, collection, node, or foreign body when a dedicated organ-specific study is not indicated.

#### Standard Section Order

Clinical History → Technique → Findings → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Clinical History
- Technique
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Lesion longest diameter | mm | Not applicable — recorded for any discrete lesion identified | No | `Lesion measures {value} mm in longest diameter.` |
| Lesion depth from skin surface | mm | Not applicable — recorded for any discrete lesion identified | No | `Lesion depth from skin surface: {value} mm.` |

**Required measurements:** _None_

**Optional measurements:** Lesion longest diameter, Lesion depth from skin surface

#### Normal Template

> The examined soft tissue region shows normal echotexture with no discrete mass, collection, or significant vascularity.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Simple Lipoma | No | A well-defined, compressible, hyperechoic subcutaneous lesion is noted, showing no significant internal vascularity, in keeping with a lipoma. | Subcutaneous lipoma. |
| Epidermal Inclusion Cyst | No | A well-defined, predominantly hypoechoic subcutaneous lesion with internal heterogeneous echoes and a punctum tract to the skin surface is noted, with posterior acoustic enhancement, in keeping with an epidermal inclusion cyst. No significant internal vascularity. | Epidermal inclusion cyst. |
| Reactive Lymph Node | No | An oval, well-defined lymph node with preserved echogenic fatty hilum and normal hilar vascularity is noted, in keeping with a reactive/benign lymph node. | Reactive lymph node. |
| Soft Tissue Foreign Body | Yes | A linear echogenic focus with posterior acoustic shadowing/reverberation, measuring approximately {size} mm, is noted within the subcutaneous soft tissue, in keeping with a retained {material} foreign body[, with {inflammation}]. | Retained {material} foreign body ({size} mm)[, with {inflammation}]. |
| Abscess Collection | No | A heterogeneous, predominantly hypoechoic collection with internal debris and peripheral hyperaemia is noted, in keeping with an abscess. | Soft tissue abscess. |
| Suspicious Solid Soft Tissue Mass | No | A solid, heterogeneous soft tissue mass with irregular margins and increased internal vascularity on colour Doppler is noted, showing none of the typical features of a lipoma, simple cyst, or abscess. | Indeterminate/suspicious solid soft tissue mass — contrast-enhanced MRI and/or biopsy advised for further characterization. |

Structured Finding Assistant question sets for this study:

- **Soft Tissue Foreign Body**:
  - `material` — Material, type: select, required, default: `wood` (options: wood, glass, metal, organic/vegetative)
  - `size` — Size (mm), type: text, optional, default: ``
  - `inflammation` — Surrounding inflammation, type: select, optional, default: `None` (options: None, surrounding hypoechoic inflammatory change)

#### Clinical History Chips

- **Palpable lump/swelling** — inserts: "Palpable lump/swelling."
- **Painful swelling** — inserts: "Painful swelling."
- **Post-traumatic swelling** — inserts: "Post-traumatic swelling."

#### Protocol

- **Protocol name:** USG Soft Tissue

- **Technique:** Real-time grey-scale and colour Doppler ultrasound of the indicated soft-tissue region was performed using a high-frequency linear probe.

- **Default recommendation text:** Please correlate with clinical findings.

#### Impression Philosophy

One line naming the most specific diagnosis the sonographic appearance supports (lipoma, abscess, cyst, foreign body, reactive node); 'indeterminate soft tissue lesion' is reserved for when none of the benign patterns fit, paired with a same-report recommendation for further work-up.

#### Recommendation Philosophy

Default is clinical correlation; an abscess triggers a drainage/aspiration recommendation, and any lesion described as solid-heterogeneous-vascular triggers a contrast-enhanced MRI and/or biopsy recommendation rather than routine follow-up.

#### Follow-up Philosophy

Lipomas, simple/epidermal cysts, and reactive nodes close with routine or no follow-up; abscesses are flagged for prompt clinical drainage; any solid, irregular, or rapidly growing lesion is flagged for cross-sectional imaging and tissue diagnosis rather than interval ultrasound alone.

#### Copilot Behaviour

Flags any described solid lesion whose Findings text doesn't note margin, vascularity, and echotexture (the three descriptors separating a benign lipoma/cyst from a lesion needing MRI/biopsy); prompts for size and depth-from-skin measurements whenever a discrete lesion finding is used; reminds to state laterality/anatomical site explicitly since Soft Tissue reports are frequently compared serially.

#### Structured Finding Assistant Logic

Soft Tissue Foreign Body is the only structured finding here, using a {material} select (reused verbatim as the sentence's noun, the same pattern as KUB's {side}) plus an optional [{inflammation}] bracket that is dropped for an isolated foreign body and populated only when surrounding inflammatory change is actually seen, avoiding two near-duplicate 'foreign body' rows for the plain vs. inflamed presentation.

#### Critical Findings

- Solid mass with irregular margins, increased vascularity, or heterogeneous echotexture suspicious for malignancy
- Abscess with impending spontaneous rupture or extensive surrounding cellulitis
- Foreign body with a sinus tract or deep extension to a joint/tendon
- Necrotizing soft tissue infection (rapidly progressive gas/fluid tracking along fascial planes)

#### Print Behaviour

Prints as a short, site-specific report with no fixed organ checklist, unlike Whole Abdomen; the clinically requested site/laterality is always carried into the printed Findings header since Soft Tissue exams are frequently repeated at multiple sites in the same visit.


---

## Gynaecology

### Transvaginal Sonography (TVS)

**Tab name:** TVS

**Purpose:** General transvaginal gynaecological survey of the uterus, endometrium, and adnexa for menstrual irregularity, pelvic pain, infertility screening, or incidental follow-up of a known pelvic finding.

#### Standard Section Order

Clinical History → Technique → Comparison with prior study → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Recommendation
- Comparison with prior study

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Uterine Length | mm | 60-80 mm nulliparous; up to 90-100 mm if parous | Yes | `Uterine length: {value} mm.` |
| Endometrial Thickness | mm | 4-8 mm proliferative; up to 14-16 mm secretory; <5 mm postmenopausal | Yes | `Endometrial thickness: {value} mm.` |
| Right Ovarian Volume | mL | 2.5-10 mL reproductive age (mean ~6-8 mL); reduced post-menopause | Yes | `Right ovarian volume: {value} mL.` |
| Left Ovarian Volume | mL | 2.5-10 mL reproductive age (mean ~6-8 mL); reduced post-menopause | Yes | `Left ovarian volume: {value} mL.` |
| Cervical Length | mm | 25-35 mm non-pregnant | No | `Cervical length: {value} mm.` |
| Antral Follicle Count (bilateral) | follicles | 10-20 total (roughly 5-10 per ovary, each 2-9 mm) suggests normal reserve | No | `Antral follicle count (both ovaries): {value}.` |

**Required measurements:** Uterine Length, Endometrial Thickness, Right Ovarian Volume, Left Ovarian Volume

**Optional measurements:** Cervical Length, Antral Follicle Count (bilateral)

#### Normal Template

> Uterus is normal in size and myometrial echotexture. Endometrium is central and normal in thickness for cycle day. Both ovaries are normal in size with a normal antral follicle count. No adnexal mass. No free fluid.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Follicle Tracking | Yes | Right ovary shows {rightCount} follicle(s), largest measuring {rightLargestMm} mm. Left ovary shows {leftCount} follicle(s), largest measuring {leftLargestMm} mm. | Follicular study as above. |
| Fibroid Uterus | Yes | A well-defined hypoechoic {location} myometrial lesion is noted, measuring approximately {size} mm, in keeping with a fibroid. | {location} fibroid. |
| Simple Ovarian Cyst | No | A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the ovary, showing no internal echoes, septations, or vascularity. | Simple ovarian cyst. |
| Endometrial Thickness Normal | No | Endometrium is central, regular, and within normal limits for the reported cycle day. | Normal endometrial thickness. |
| Endometrioma | Yes | A well-defined cystic lesion with homogeneous low-level ('ground-glass') internal echoes and no significant internal vascularity is noted in the {side} ovary, measuring approximately {size} mm, in keeping with an endometrioma. | {side} ovarian endometrioma, {size} mm. |
| Hydrosalpinx | Yes | A tubular, thin-walled, anechoic cystic structure with incomplete septations ('cogwheel' sign) is noted in the {side} adnexa, separate from the ovary, in keeping with hydrosalpinx. | {side} hydrosalpinx. |
| Adenomyosis | No | Uterus is globally bulky with heterogeneous myometrial echotexture, scattered myometrial cysts, and indistinct endo-myometrial junction, in keeping with adenomyosis. | Adenomyosis. |

Structured Finding Assistant question sets for this study:

- **Follicle Tracking**:
  - `rightCount` — Right — follicle count, type: text, optional, default: ``
  - `rightLargestMm` — Right — largest (mm), type: text, optional, default: ``
  - `leftCount` — Left — follicle count, type: text, optional, default: ``
  - `leftLargestMm` — Left — largest (mm), type: text, optional, default: ``
- **Fibroid Uterus**:
  - `location` — Location, type: select, required, default: `intramural` (options: intramural, subserosal, submucosal)
  - `size` — Size (mm), type: text, optional, default: ``
- **Endometrioma**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `size` — Size (mm), type: text, optional, default: ``
- **Hydrosalpinx**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)

#### Clinical History Chips

- **Infertility** — inserts: "Infertility workup."
- **Bleeding PV** — inserts: "Bleeding per vaginum."
- **Pelvic pain** — inserts: "Pelvic pain."

#### Protocol

- **Protocol name:** USG TVS

- **Technique:** Transvaginal ultrasound was performed with an empty urinary bladder using a high-frequency endocavitary probe.

- **Default recommendation text:** Please correlate with clinical findings and cycle day.

#### Impression Philosophy

One or two-line impression naming the dominant abnormality (fibroid/cyst/adenomyosis/endometrioma/hydrosalpinx) with laterality and size; state simply that the study is unremarkable when normal; always state endometrial thickness and pattern explicitly whenever the clinical history indicates postmenopausal bleeding.

#### Recommendation Philosophy

Correlate clinically and note the cycle-day dependency of endometrium/follicle findings; recommend a repeat scan next cycle for a simple cyst under 5 cm, and gynaecology referral (with SIS where the endometrium is implicated) for complex or large adnexal lesions or unexplained endometrial thickening.

#### Follow-up Philosophy

Simple functional cysts under 5 cm: repeat TVS after 6-8 weeks/next cycle to confirm resolution. Persistent, enlarging, or complex adnexal lesions: route to the dedicated Ovarian Lesions tab for IOTA-style characterization and gynae-onc referral. Fibroids: routine gynae follow-up unless rapidly growing or symptomatic. This is a general gynae survey — serial ovulation/IVF monitoring belongs on the dedicated Follicular Study tab, not here.

#### Copilot Behaviour

Prompt for cycle day whenever endometrium/follicles are reported; flag if only one ovary was visualized and documented; remind to state endometrial thickness explicitly whenever a postmenopausal-bleeding history is present; suggest the structured Fibroid/Endometrioma/Hydrosalpinx finding whenever free text mentions 'cyst'/'mass'/'fibroid' without size or laterality captured.

#### Structured Finding Assistant Logic

Follicle Tracking, Fibroid Uterus, Endometrioma, and Hydrosalpinx use the existing {key}/questions_json Structured Finding Assistant so laterality, size, and count are captured as discrete, reusable fields instead of free text — the same mechanism already used for these findings and for MRI's structured findings elsewhere in the platform; no new templating syntax.

#### Critical Findings

- Complex adnexal mass with solid components, thick irregular septations, or marked Doppler vascularity suspicious for malignancy
- Adnexal torsion picture (enlarged ovary, absent/reduced flow, whirlpool sign) — surgical emergency
- Ectopic-pregnancy pattern (adnexal gestational sac/ring, free fluid) in a patient with a positive pregnancy test

#### Print Behaviour

Standard single-page gynae report; Findings, Measurements table, Impression, and Recommendation print together; structured-finding placeholders are always resolved to final text before print — never printed with literal {key} tokens.


### Follicular Study

**Tab name:** Follicular Study

**Purpose:** Serial day-wise transvaginal monitoring of follicular growth and endometrial development during a natural, ovulation-induction, IUI, or IVF stimulation cycle, to time trigger, insemination, or oocyte retrieval — distinct from a one-off TVS.

#### Standard Section Order

Clinical History → Cycle Day / Protocol → Technique → Comparison with prior visit → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Cycle Day / Protocol
- Findings
- Impression

#### Optional Sections

- Comparison with prior visit
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Cycle Day | day | Day 1 = first day of menses; baseline scan typically day 2-3 | Yes | `Cycle day: {value}.` |
| Dominant Follicle Size (mm) | mm | pre-ovulatory/mature dominant follicle 18-24 mm | Yes | `Dominant follicle: {value} mm.` |
| Right Ovary Follicle Count | follicles | variable by protocol and cycle day | No | `Right ovary: {value} follicle(s) tracked.` |
| Left Ovary Follicle Count | follicles | variable by protocol and cycle day | No | `Left ovary: {value} follicle(s) tracked.` |
| Endometrial Thickness | mm | trilaminar pattern typically 7-14 mm periovulatory | Yes | `Endometrial thickness: {value} mm.` |

**Required measurements:** Cycle Day, Dominant Follicle Size (mm), Endometrial Thickness

**Optional measurements:** Right Ovary Follicle Count, Left Ovary Follicle Count

#### Normal Template

> Baseline antral follicle counts are within normal range bilaterally. A single dominant follicle is developing with appropriate day-wise growth of approximately 1-2 mm/day, currently measuring within the physiological range for cycle day. Endometrium is developing a trilaminar pattern with appropriate day-wise thickening. No evidence of premature luteinisation or follicular cyst.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Day-wise Follicular Monitoring | Yes | Cycle Day {cycleDay}: Right ovary shows {rightCount} follicle(s), dominant follicle measuring {rightDominantMm} mm. Left ovary shows {leftCount} follicle(s), dominant follicle measuring {leftDominantMm} mm. Endometrium measures {endoThicknessMm} mm, {endoPattern} pattern. | Day {cycleDay} follicular study — dominant follicle {rightDominantMm}/{leftDominantMm} mm, endometrium {endoThicknessMm} mm ({endoPattern}). |
| Mature Pre-ovulatory Follicle | Yes | A dominant pre-ovulatory follicle measuring {sizeMm} mm is noted in the {side} ovary, with a peripheral cumulus oophorus complex, in keeping with imminent ovulation. | {side} dominant follicle, {sizeMm} mm — criteria for trigger/imminent ovulation appear met; correlate with clinical protocol. |
| Trilaminar Endometrium | No | Endometrium demonstrates a triple-line (trilaminar) pattern, favourable for implantation. | Trilaminar endometrium. |
| Non-trilaminar / Thin Endometrium | No | Endometrium is homogeneously echogenic without a triple-line pattern and/or is thin for cycle day, less favourable for implantation. | Non-trilaminar / suboptimal endometrial pattern for cycle day. |
| Corpus Luteum | Yes | A thick-walled cystic structure with a crenated margin and peripheral 'ring of fire' vascularity on colour Doppler is noted in the {side} ovary, in keeping with a corpus luteum, consistent with recent ovulation. | {side} corpus luteum — sonographic evidence of recent ovulation. |
| Ovulation Not Yet Occurred | No | The previously dominant follicle persists unchanged in size and configuration with no evidence of collapse, free fluid, or corpus luteum formation, suggesting ovulation has not yet occurred. | No sonographic evidence of ovulation at this visit. |

Structured Finding Assistant question sets for this study:

- **Day-wise Follicular Monitoring**:
  - `cycleDay` — Cycle day, type: text, required, default: ``
  - `rightCount` — Right — follicle count, type: text, optional, default: ``
  - `rightDominantMm` — Right — dominant follicle (mm), type: text, optional, default: ``
  - `leftCount` — Left — follicle count, type: text, optional, default: ``
  - `leftDominantMm` — Left — dominant follicle (mm), type: text, optional, default: ``
  - `endoThicknessMm` — Endometrial thickness (mm), type: text, required, default: ``
  - `endoPattern` — Endometrial pattern, type: select, required, default: `trilaminar` (options: trilaminar, non-trilaminar)
- **Mature Pre-ovulatory Follicle**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `sizeMm` — Size (mm), type: text, required, default: ``
- **Corpus Luteum**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)

#### Clinical History Chips

- **Ovulation induction cycle** — inserts: "On ovulation induction (clomiphene/letrozole/gonadotropins) — follicular monitoring."
- **IUI cycle** — inserts: "IUI cycle — follicular monitoring for trigger timing."
- **IVF stimulation monitoring** — inserts: "On controlled ovarian stimulation for IVF — follicular monitoring."

#### Protocol

- **Protocol name:** USG Follicular Study

- **Technique:** Serial transvaginal ultrasound was performed with an empty urinary bladder using a high-frequency endocavitary probe, beginning on cycle day 2-3 (baseline) and repeated at intervals through the mid-cycle window per the treating clinician's stimulation protocol, until a dominant follicle reaches maturity or trigger criteria are met.

- **Default recommendation text:** Correlate with serum hormonal levels (E2/LH/P4) and the treating clinician's stimulation protocol. Recommend repeat follicular study at the interval advised by the treating clinician to time trigger, IUI, or oocyte retrieval.

#### Impression Philosophy

Every visit's impression states cycle day, dominant follicle size and side, and endometrial thickness/pattern in one line so the referring clinician can act on the trend without opening the full report; explicitly state whether trigger criteria (typically a dominant follicle of 18 mm or more with a trilaminar endometrium of 7-8 mm or more) appear met, without prescribing the trigger decision itself.

#### Recommendation Philosophy

The recommendation is always tied to the next scan interval (typically 48-72 hours until near-maturity, then daily) rather than a generic 'correlate clinically' line — this is a serial monitoring study, so continuity across visits is the primary clinical value.

#### Follow-up Philosophy

Each visit is compared against the immediately preceding one for growth rate; failure of any follicle to reach 10 mm by day 10, or arrested growth over two consecutive visits, should be flagged for the treating clinician to reconsider the stimulation protocol. Once a mature follicle/trigger criteria are met, or collapse consistent with ovulation is documented, the series concludes and the patient reverts to routine TVS or obstetric follow-up as clinically indicated.

#### Copilot Behaviour

Require a cycle-day entry on every visit; suggest the Day-wise Follicular Monitoring structured finding by default on this tab; flag a report saved without an endometrial thickness value; flag when the same dominant follicle size is reported on two consecutive visits without comment (possible cyst or anovulation); remind to compare against the previous visit in the same cycle when a prior study exists.

#### Structured Finding Assistant Logic

Day-wise Follicular Monitoring, Mature Pre-ovulatory Follicle, and Corpus Luteum use the {key}/questions_json mechanism so cycle day, side, count, size, and endometrial pattern are captured as discrete fields at every visit, letting the same finding template be reused unchanged across an entire cycle instead of retyping free text each time.

#### Critical Findings

- Ovarian hyperstimulation picture (markedly enlarged multicystic ovaries with ascites) in a stimulated cycle — notify treating clinician urgently
- Adnexal torsion picture in an enlarged stimulated ovary
- Suspected ectopic pregnancy in a cycle that has since achieved a positive pregnancy test

#### Print Behaviour

Each visit prints as one dated entry; when multiple visits exist for the same cycle, the workspace's existing comparison-with-prior mechanism (already shared with MRI) is used to show the growth trend rather than re-authoring a new template.


### Endometrium

**Tab name:** Endometrium

**Purpose:** Dedicated endometrial assessment for abnormal uterine bleeding (AUB) or postmenopausal bleeding workup — thickness, echogenicity/pattern, focal lesion, and Doppler vascularity — to triage toward saline infusion sonography (SIS) or endometrial sampling.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Doppler assessment → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- Recommendation
- Doppler assessment

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Endometrial Thickness | mm | premenopausal cycle-dependent 4-16 mm; postmenopausal (no HRT) under 5 mm is generally low-risk | Yes | `Endometrial thickness (double-layer): {value} mm.` |
| Endometrial Volume | mL | adjunct 3D measurement where available | No | `Endometrial volume: {value} mL.` |
| Myometrial Thickness | mm | for adenomyosis correlation; anterior/posterior wall symmetry expected | No | `Myometrial thickness (anterior/posterior): {value} mm.` |

**Required measurements:** Endometrial Thickness

**Optional measurements:** Endometrial Volume, Myometrial Thickness

#### Normal Template

> Endometrium is central, homogeneous, and measures within normal limits for the patient's age, cycle day, or menopausal status. Endo-myometrial junction is well-defined and regular. No focal endometrial lesion. No abnormal endometrial vascularity on colour Doppler.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Endometrium | No | Endometrium is central, homogeneous, and measures within normal limits for age/cycle day/menopausal status, with a well-defined echogenic interface. No focal lesion. | Normal endometrium. |
| Endometrial Polyp | Yes | A well-defined echogenic intracavitary lesion with a feeding vascular pedicle on colour Doppler is noted, measuring approximately {sizeMm} mm, in keeping with an endometrial polyp. | Endometrial polyp, {sizeMm} mm. |
| Endometrial Hyperplasia | Yes | Endometrium is diffusely thickened, measuring {thicknessMm} mm, with {pattern} echotexture, a regular endo-myometrial junction, and no discrete focal lesion, in keeping with endometrial hyperplasia. | Endometrial thickening ({thicknessMm} mm), favour endometrial hyperplasia; histopathological correlation advised. |
| Suspicious Endometrial Mass | Yes | Endometrium is markedly thickened and heterogeneous, measuring {thicknessMm} mm, with an irregular endo-myometrial junction and increased vascularity on colour Doppler, raising concern for endometrial malignancy. | Thickened, vascular, irregular endometrium ({thicknessMm} mm) — endometrial malignancy cannot be excluded; urgent histopathological correlation advised. |
| IUD In Situ | Yes | An echogenic intrauterine device is noted; position is assessed as {position} relative to the endometrial cavity and internal os. | IUD {position}. |
| Endometrial Fluid Collection | No | A thin anechoic fluid collection is noted within the endometrial cavity, with no associated solid component. | Endometrial fluid collection — correlate clinically (cervical stenosis/hematometra vs. physiological). |

Structured Finding Assistant question sets for this study:

- **Endometrial Polyp**:
  - `sizeMm` — Size (mm), type: text, optional, default: ``
- **Endometrial Hyperplasia**:
  - `thicknessMm` — Thickness (mm), type: text, required, default: ``
  - `pattern` — Echotexture, type: select, optional, default: `homogeneous` (options: homogeneous, heterogeneous)
- **Suspicious Endometrial Mass**:
  - `thicknessMm` — Thickness (mm), type: text, required, default: ``
- **IUD In Situ**:
  - `position` — Position, type: select, required, default: `well-positioned` (options: well-positioned, low-lying, malpositioned/embedded)

#### Clinical History Chips

- **Postmenopausal bleeding** — inserts: "Postmenopausal bleeding."
- **Abnormal uterine bleeding (AUB)** — inserts: "Abnormal uterine bleeding."
- **Follow-up after endometrial sampling** — inserts: "Follow-up scan after endometrial sampling/biopsy."

#### Protocol

- **Protocol name:** USG Endometrium (AUB / PMB Workup)

- **Technique:** Transvaginal ultrasound of the endometrium was performed with an empty urinary bladder using a high-frequency endocavitary probe, with colour Doppler interrogation of the endometrium and endo-myometrial junction.

- **Default recommendation text:** Please correlate with menstrual/menopausal history, cycle day, and hormone therapy status. Endometrial thickening or a focal lesion in the setting of abnormal or postmenopausal bleeding warrants saline infusion sonography (SIS) and/or endometrial sampling for histopathological correlation.

#### Impression Philosophy

The impression always states an explicit thickness in mm with menopausal-status context (for example, under 5 mm in a postmenopausal patient read as low-risk versus a numeric value with no qualitative reassurance if thickened), and separately calls out any focal lesion or abnormal vascularity rather than folding it into one generic line.

#### Recommendation Philosophy

The recommendation is stratified by thickness/lesion status: normal or thin endometrium in a postmenopausal-bleeding workup gets reassurance with routine follow-up; thickened or focal-lesion endometrium gets a specific next step (SIS to differentiate a focal lesion from diffuse hyperplasia, or direct sampling) rather than a generic 'correlate clinically' line.

#### Follow-up Philosophy

Postmenopausal bleeding with endometrium under 5 mm and no focal lesion: routine gynae follow-up, repeat scan only if bleeding recurs. Thickened, heterogeneous, or focal endometrium: recommend SIS to clarify a polyp or submucosal fibroid from diffuse hyperplasia, followed by hysteroscopic or endometrial biopsy. This tab documents that recommendation but performs no compliance workflow itself — it is not an obstetric/fetal study, so the platform's PCPNDT finalize-block does not apply here.

#### Copilot Behaviour

Flag any endometrial thickness of 5 mm or more reported alongside a postmenopausal-bleeding chip when no follow-up recommendation is present; prompt for menopausal status when endometrial thickness is entered without a cycle-day or menopause chip; suggest mentioning SIS when a focal echogenic lesion is described without a clear polyp-versus-fibroid distinction.

#### Structured Finding Assistant Logic

Endometrial Polyp, Endometrial Hyperplasia, Suspicious Endometrial Mass, and IUD In Situ use the {key}/questions_json mechanism to capture size, pattern, and position as discrete fields, keeping the malignancy-concern language in Suspicious Endometrial Mass fixed and only the measured thickness variable — reducing free-text variability in the highest-stakes finding on this tab.

#### Critical Findings

- Suspicious Endometrial Mass — thickened, heterogeneous, vascular endometrium in a postmenopausal or high-risk patient
- Endometrial thickness of 5 mm or more in a postmenopausal patient not on hormone therapy
- Pyometra / grossly distended fluid-filled cavity with debris in a febrile patient

#### Print Behaviour

Findings, Measurements (thickness shown prominently), Impression, and Recommendation print as a single focused page; a flagged critical finding's malignancy-concern language always prints in the Impression, never left only in Findings.


### Ovarian Lesions

**Tab name:** Ovarian Lesions

**Purpose:** Dedicated adnexal/ovarian mass characterization using IOTA-style descriptors (cystic/solid/mixed, septations, papillary projections, Doppler vascularity) to risk-stratify an incidentally or symptomatically detected ovarian lesion beyond the generic Simple Ovarian Cyst finding on TVS.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → IOTA/Risk Assessment → Impression → Recommendation

#### Mandatory Sections

- Findings
- Impression

#### Optional Sections

- IOTA/Risk Assessment
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Lesion Size (largest diameter) | mm | report longest diameter; simple cysts under 5 cm are generally low risk | Yes | `Lesion size: {value} mm (largest diameter).` |
| Lesion Volume | mL | adjunct measurement | No | `Lesion volume: {value} mL.` |
| Solid Component Size | mm | largest solid/papillary component if present | No | `Largest solid component: {value} mm.` |
| CA-125 | U/mL | adjunct serum marker, not sonographic; commonly correlated when available | No | `CA-125: {value} U/mL.` |

**Required measurements:** Lesion Size (largest diameter)

**Optional measurements:** Lesion Volume, Solid Component Size, CA-125

#### Normal Template

> No adnexal mass is identified. Both ovaries are normal in size and echotexture with a physiological follicular pattern. No abnormal pelvic vascularity. No free fluid.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Simple Cyst (IOTA) | Yes | A unilocular anechoic cystic lesion with a smooth thin wall, no septations, no solid component, and no internal or wall vascularity on colour Doppler (IOTA simple cyst) is noted in the {side} ovary, measuring approximately {sizeMm} mm. | {side} simple ovarian cyst, {sizeMm} mm — IOTA benign pattern. |
| Simple Septated Cyst | Yes | A cystic lesion with {septaCount} thin (under 3 mm) septation(s), no solid component, and no papillary projection is noted in the {side} ovary, measuring approximately {sizeMm} mm, with no or minimal septal vascularity on colour Doppler. | {side} septated ovarian cyst, {sizeMm} mm — favour benign. |
| Complex Multiloculated Cyst | Yes | A multiloculated cystic lesion with {wallThickness} septations and no discrete solid component is noted in the {side} ovary, measuring approximately {sizeMm} mm. | {side} multiloculated ovarian cyst, {sizeMm} mm, with {wallThickness} septations. |
| Solid or Mixed Adnexal Mass | Yes | A mixed solid-cystic mass with a solid component/papillary projection showing {vascularity} vascularity on colour Doppler is noted in the {side} adnexa, measuring approximately {sizeMm} mm. | {side} solid/mixed adnexal mass, {sizeMm} mm, {vascularity} vascularity — IOTA suspicious features; further characterization advised. |
| Dermoid (Mature Cystic Teratoma) | Yes | A well-defined lesion with a hyperechoic component showing posterior acoustic shadowing (Rokitansky nodule) and diffuse or focal fine echogenic foci ('dermoid mesh'/tip-of-the-iceberg sign), with no significant internal vascularity, is noted in the {side} ovary, measuring approximately {sizeMm} mm, in keeping with a mature cystic teratoma (dermoid). | {side} dermoid cyst (mature cystic teratoma), {sizeMm} mm. |
| Torsion Pattern | No | The affected ovary is markedly enlarged with heterogeneous stroma, peripherally displaced follicles, and absent or markedly reduced flow on colour/pulsed Doppler, with a whirlpool sign at the vascular pedicle, in keeping with ovarian torsion. | Sonographic features suggestive of ovarian torsion — surgical emergency; immediate clinical correlation and gynaecology/surgical consult advised. |

Structured Finding Assistant question sets for this study:

- **Simple Cyst (IOTA)**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `sizeMm` — Size (mm), type: text, required, default: ``
- **Simple Septated Cyst**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `sizeMm` — Size (mm), type: text, required, default: ``
  - `septaCount` — Number of septations, type: text, optional, default: ``
- **Complex Multiloculated Cyst**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `sizeMm` — Size (mm), type: text, required, default: ``
  - `wallThickness` — Septal/wall thickness, type: select, required, default: `thin` (options: thin, thick)
- **Solid or Mixed Adnexal Mass**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `sizeMm` — Size (mm), type: text, required, default: ``
  - `vascularity` — Doppler vascularity, type: select, required, default: `moderate` (options: minimal, moderate, marked)
- **Dermoid (Mature Cystic Teratoma)**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `sizeMm` — Size (mm), type: text, required, default: ``

#### Clinical History Chips

- **Incidental adnexal mass** — inserts: "Incidentally detected adnexal mass on prior imaging."
- **Suspected ovarian torsion / acute pelvic pain** — inserts: "Acute pelvic pain, rule out ovarian torsion."
- **Known ovarian cyst - follow-up** — inserts: "Known ovarian cyst — interval follow-up."

#### Protocol

- **Protocol name:** USG Ovarian/Adnexal Lesion Characterization

- **Technique:** Transvaginal ultrasound (supplemented by transabdominal views for a large or predominantly abdominal mass) was performed, with grey-scale characterization of lesion structure, wall, septations, and solid components per IOTA terminology, followed by colour and pulsed-wave Doppler interrogation of any solid or septal component.

- **Default recommendation text:** Report using IOTA simple-rules terminology (unilocular/multilocular, solid component, papillary projections, ascites, vascularity) where a lesion is present. Correlate with menopausal status, menstrual history, and CA-125/HE4/ROMA where clinically indicated; recommend gynaecology-oncology referral for any lesion with IOTA 'M' (malignant) features.

#### Impression Philosophy

The impression states laterality, size, and an explicit IOTA-flavoured benign-versus-suspicious characterization line — not just a descriptive label — so the referring clinician gets an actionable risk read without parsing the full Findings paragraph; torsion and other emergencies are stated as the very first line of the impression, unambiguously.

#### Recommendation Philosophy

A confidently benign simple cyst (IOTA 'B' features) gets routine interval follow-up; any 'M'-feature lesion (solid component, thick irregular septa/wall, papillary projection with flow, ascites) gets gynae-oncology referral and tumour-marker correlation rather than a repeat-scan recommendation; torsion gets immediate escalation language, not a routine recommendation line.

#### Follow-up Philosophy

Simple cysts under 5 cm in a reproductive-age woman: no follow-up needed, or repeat in 6-12 weeks only if symptomatic/for reassurance. Simple cysts 5-7 cm: routine interval follow-up. Over 7 cm or any complex/suspicious morphology: cross-sectional imaging (MRI) and/or surgical referral, since sonographic characterization alone has known accuracy limits for large or technically difficult lesions.

#### Copilot Behaviour

Require size, laterality, and an explicit benign/indeterminate/suspicious characterization on every entry to this tab; flag when a solid or papillary component is described without a Doppler vascularity statement; flag when lesion size exceeds 7 cm without a cross-sectional-imaging recommendation in the report; surface a prominent alert when the Torsion Pattern finding is used.

#### Structured Finding Assistant Logic

Five of the six findings on this tab — Simple Cyst (IOTA), Simple Septated Cyst, Complex Multiloculated Cyst, Solid or Mixed Adnexal Mass, and Dermoid — use the {key}/questions_json mechanism to capture side, size, and the specific IOTA descriptor (septation count, wall thickness, vascularity grade) that drives the benign-versus-suspicious language, keeping the risk-stratifying phrase consistent and auditable rather than free-typed differently by each reporting radiologist. Torsion Pattern is deliberately kept as fixed free text (an emergency gestalt pattern rather than a graded descriptor), so it carries no discrete fields.

#### Critical Findings

- Ovarian torsion pattern — surgical emergency
- Solid/mixed adnexal mass with marked vascularity, thick irregular septa, papillary projections, and/or ascites — suspicious for malignancy
- Ruptured ovarian cyst with hemoperitoneum (free complex fluid, acute pain)

#### Print Behaviour

The IOTA/Risk Assessment section prints only when populated (a lesion is present); a normal-study print omits it entirely rather than printing an empty section header.


### Infertility

**Tab name:** Infertility

**Purpose:** Baseline infertility workup scan — bilateral antral follicle count, uterine anomaly screen, tubal-factor/adnexal notes, and PCOM criteria — performed once (or at cycle baseline) rather than the serial day-wise tracking of a dedicated Follicular Study.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → PCOM Assessment → Impression → Recommendation

#### Mandatory Sections

- Findings
- Measurements
- Impression

#### Optional Sections

- PCOM Assessment
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Right Antral Follicle Count | follicles | 5-10 per ovary (each 2-9 mm) suggests normal reserve; under 5-7 suggests low reserve; 20 or more suggests PCOM range | Yes | `Right AFC: {value}.` |
| Left Antral Follicle Count | follicles | 5-10 per ovary (each 2-9 mm) suggests normal reserve; under 5-7 suggests low reserve; 20 or more suggests PCOM range | Yes | `Left AFC: {value}.` |
| Right Ovarian Volume | mL | 2.5-10 mL; PCOM often 10 mL or more | No | `Right ovarian volume: {value} mL.` |
| Left Ovarian Volume | mL | 2.5-10 mL; PCOM often 10 mL or more | No | `Left ovarian volume: {value} mL.` |
| Endometrial Thickness | mm | baseline/proliferative range 4-8 mm | Yes | `Endometrial thickness: {value} mm.` |

**Required measurements:** Right Antral Follicle Count, Left Antral Follicle Count, Endometrial Thickness

**Optional measurements:** Right Ovarian Volume, Left Ovarian Volume

#### Normal Template

> Uterus is normal in size, position, and myometrial echotexture with no congenital anomaly. Endometrium is within normal limits for cycle day. Both ovaries are normal in volume with a normal antral follicle count and no evidence of polycystic ovarian morphology. No hydrosalpinx or adnexal mass. No free fluid.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Baseline Infertility Survey - Normal | Yes | Uterus is normal in size, position, and myometrial echotexture with no congenital anomaly. Endometrium measures {endoThicknessMm} mm. Right ovary shows an antral follicle count of {rightAFC} (2-9 mm), normal volume. Left ovary shows an antral follicle count of {leftAFC} (2-9 mm), normal volume. No hydrosalpinx or adnexal mass. No free fluid. | Normal baseline infertility survey; bilateral antral follicle count within normal range (right {rightAFC}, left {leftAFC}). |
| Polycystic Ovarian Morphology (PCOM) | Yes | Right ovary shows {rightCount} peripherally arranged follicles (2-9 mm) with increased ovarian volume and stromal echogenicity. Left ovary shows {leftCount} peripherally arranged follicles (2-9 mm) with increased ovarian volume and stromal echogenicity, meeting PCOM criteria (20 or more follicles per ovary and/or ovarian volume of 10 mL or more, per current international PCOS ultrasound consensus). | Bilateral polycystic ovarian morphology (PCOM) — correlate clinically/biochemically for PCOS (Rotterdam criteria require 2 of 3: oligo/anovulation, clinical/biochemical hyperandrogenism, PCOM). |
| Diminished Ovarian Reserve Pattern | Yes | Both ovaries are reduced in volume with a low combined antral follicle count (right {rightAFC}, left {leftAFC}), in keeping with diminished ovarian reserve. | Sonographic features of diminished ovarian reserve — correlate with AMH/FSH. |
| Congenital Uterine Anomaly Suspected | Yes | The endometrial cavity/uterine fundal contour demonstrates a configuration suggestive of a {type} uterus. 3D ultrasound or MR correlation is advised for definitive subclassification. | Suspected {type} uterus — further characterization (3D USG/MRI/hysterosalpingography) advised. |
| Hydrosalpinx (Tubal Factor) | No | A dilated, tortuous, fluid-filled tubular structure with incomplete septa ('cogwheel' sign) is noted in the adnexa, separate from the ovary, in keeping with hydrosalpinx — a likely cause of tubal-factor infertility. | Hydrosalpinx — likely tubal-factor infertility; HSG/laparoscopic correlation advised. |
| Endometrium Unfavourable for Implantation | No | Endometrium is thin (under 7 mm) and/or non-trilaminar for the reported cycle day, which may be unfavourable for implantation. | Thin/non-trilaminar endometrium — correlate with cycle day and consider further endometrial receptivity workup. |

Structured Finding Assistant question sets for this study:

- **Baseline Infertility Survey - Normal**:
  - `rightAFC` — Right AFC, type: text, required, default: ``
  - `leftAFC` — Left AFC, type: text, required, default: ``
  - `endoThicknessMm` — Endometrial thickness (mm), type: text, required, default: ``
- **Polycystic Ovarian Morphology (PCOM)**:
  - `rightCount` — Right — follicle count, type: text, required, default: ``
  - `leftCount` — Left — follicle count, type: text, required, default: ``
- **Diminished Ovarian Reserve Pattern**:
  - `rightAFC` — Right AFC, type: text, required, default: ``
  - `leftAFC` — Left AFC, type: text, required, default: ``
- **Congenital Uterine Anomaly Suspected**:
  - `type` — Suspected anomaly type, type: select, required, default: `septate` (options: septate, bicornuate, arcuate, unicornuate, didelphys)

#### Clinical History Chips

- **Primary infertility** — inserts: "Primary infertility — baseline workup."
- **Secondary infertility** — inserts: "Secondary infertility — baseline workup."
- **Pre-IVF baseline workup** — inserts: "Pre-IVF baseline infertility workup."

#### Protocol

- **Protocol name:** USG Infertility Workup Scan

- **Technique:** Baseline transvaginal ultrasound was performed with an empty urinary bladder, typically on cycle day 2-3, assessing uterine morphology for congenital anomaly, bilateral antral follicle count and ovarian volume, endometrial thickness/pattern, and the adnexa for hydrosalpinx or other tubal-factor pathology. Tubal patency itself is not directly assessed by transvaginal ultrasound and requires HSG, HyCoSy, or laparoscopy where clinically indicated.

- **Default recommendation text:** Correlate with cycle day, serum AMH/FSH/LH, and partner semen analysis as part of the overall infertility workup. HSG or HyCoSy is recommended for direct tubal patency assessment, which this scan does not provide. Recommend gynaecology/reproductive-medicine referral for correlation and further management.

#### Impression Philosophy

The impression is structured around the three infertility-relevant axes every time — ovarian reserve (bilateral AFC), uterine cavity/congenital anomaly status, and tubal/adnexal factor — even when all three are normal, so the referring clinician sees the full triage at a glance rather than a single free-text line.

#### Recommendation Philosophy

The recommendation explicitly separates what this scan does and does not answer: it reports reserve, anatomy, and PCOM directly, and always states that tubal patency requires HSG/HyCoSy/laparoscopy rather than implying patency was assessed sonographically.

#### Follow-up Philosophy

A single baseline visit for most patients; escalates to serial Follicular Study monitoring only once a stimulation protocol begins — this tab and Follicular Study are deliberately kept separate (baseline characterization versus day-wise serial tracking) rather than merged. PCOM, diminished-reserve, and anomaly findings route to reproductive endocrinology; hydrosalpinx findings route to HSG and a pre-IVF salpingectomy/proximal tubal occlusion discussion with the treating gynaecologist.

#### Copilot Behaviour

Require both right and left AFC and endometrial thickness before allowing report completion; prompt for cycle day whenever AFC or endometrium is recorded; suggest the PCOM structured finding when free-text AFC values on either side are 20 or more, or ovarian volume of 10 mL or more is entered in Measurements; remind that tubal patency is not assessed by this study and should not be stated as normal/patent without HSG/HyCoSy correlation.

#### Structured Finding Assistant Logic

Baseline Infertility Survey - Normal, PCOM, Diminished Ovarian Reserve, and Congenital Uterine Anomaly Suspected all use the {key}/questions_json mechanism so AFC values, laterality, and anomaly subtype are captured as discrete fields — keeping PCOM/DOR impression phrasing standardized against the criteria stated once in the finding template rather than re-typed per report.

#### Critical Findings

- Adnexal mass with suspicious features found incidentally during infertility workup — route to the Ovarian Lesions tab and gynae-onc referral
- Hydrosalpinx (tubal-factor infertility with implantation-risk implications for IVF)
- Suspected uterine anomaly requiring further characterization before fertility treatment planning

#### Print Behaviour

Findings, Measurements (both AFCs and endometrial thickness always shown, even when normal), PCOM Assessment (only if populated), Impression, and Recommendation; the tubal-patency caveat sentence in the protocol's recommendation text always prints, not only on abnormal studies.


---

## Obstetric

### Early Pregnancy

**Tab name:** Early Pregnancy

**Purpose:** Confirms intrauterine pregnancy location, gestational sac and yolk sac morphology, embryonic/fetal number, and (when an embryo is present) cardiac activity, and screens the adnexa — the routine first-visit obstetric ultrasound in the canonical General USG Reporting Workspace, as distinct from the dedicated Early Pregnancy workflow inside the separately-preserved FetalUsgLevel4 module.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Impression
- Recommendation

#### Optional Sections

- Technique
- Measurements

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| GS (Mean Sac Diameter) | mm | Gestational sac first visible ~4.5–5 weeks GA (transvaginally); MSD (mm) + 30 = GA in days, valid roughly 2–10 mm MSD / up to ~6 weeks | Yes | `Mean sac diameter measures {value} mm.` |
| YS Diameter | mm | Normal 3–6 mm; yolk sac should be visible once MSD ≥8 mm (transvaginal); absence when MSD ≥13 mm, or diameter >7 mm, is associated with increased miscarriage risk | Yes | `Yolk sac diameter measures {value} mm.` |
| CRL | mm | Embryo first visible ~5.5–6 weeks GA; used for GA/EDD via the Robinson & Fleming formula once measurable | No | `Crown-rump length measures {value} mm.` |
| Fetal Heart Rate | bpm | 110–180 bpm depending on GA, rising to a peak around 9–10 weeks then gradually declining | No | `Fetal heart rate is {value} bpm.` |

**Required measurements:** GS (Mean Sac Diameter), YS Diameter

**Optional measurements:** CRL, Fetal Heart Rate

#### Normal Template

> A single intrauterine gestational sac is seen with a well-formed yolk sac. A single live embryo is identified with cardiac activity present. Both ovaries are normal in size and echotexture; no adnexal mass.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Intrauterine Gestational Sac | Yes | A single intrauterine gestational sac is seen in the {location}, measuring {gs} mm in mean diameter, with a well-formed yolk sac measuring {ys} mm. | Single intrauterine gestational sac, GS {gs} mm. |
| Live Embryo with Cardiac Activity | Yes | A single live embryo is identified with a crown-rump length of {crl} mm, corresponding to CRL-based gestational age. Cardiac activity is present, with a fetal heart rate of {fhr} bpm. | Single live intrauterine pregnancy, CRL {crl} mm, cardiac activity present. |
| Twin Gestation Sacs Identified | Yes | Two intrauterine gestational sacs are identified, {chorionicity}. Detailed per-fetus biometry and formal chorionicity assessment are recommended. | Twin intrauterine pregnancy, {chorionicity} — see Multiple Pregnancy protocol for detailed follow-up. |
| Corpus Luteal Cyst | Yes | A simple thin-walled cystic structure is noted in the {side} adnexa, measuring {size} mm, in keeping with a corpus luteal cyst of pregnancy. | {side} corpus luteal cyst of pregnancy, {size} mm — physiological, no follow-up required unless symptomatic. |
| Normal Adnexa | No | Both ovaries are normal in size and echotexture. No adnexal mass is identified. | No adnexal abnormality. |

Structured Finding Assistant question sets for this study:

- **Normal Intrauterine Gestational Sac**:
  - `location` — Location, type: select, optional, default: `fundal` (options: fundal, mid-cavity, lower uterine segment)
  - `gs` — GS mean diameter (mm), type: text, required, default: ``
  - `ys` — YS diameter (mm), type: text, required, default: ``
- **Live Embryo with Cardiac Activity**:
  - `crl` — CRL (mm), type: text, required, default: ``
  - `fhr` — Fetal heart rate (bpm), type: text, required, default: ``
- **Twin Gestation Sacs Identified**:
  - `chorionicity` — Chorionicity/amnionicity (provisional), type: select, required, default: `indeterminate at this stage` (options: dichorionic diamniotic, monochorionic diamniotic, monochorionic monoamniotic, indeterminate at this stage)
- **Corpus Luteal Cyst**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `size` — Size (mm), type: text, required, default: ``

#### Clinical History Chips

- **Missed period / positive pregnancy test** — inserts: "Missed period, positive urine pregnancy test — confirm intrauterine pregnancy."
- **Spotting/bleeding PV** — inserts: "Spotting/bleeding per vaginum in early pregnancy."
- **Prior early pregnancy loss** — inserts: "History of prior early pregnancy loss."

#### Protocol

- **Protocol name:** USG Early Pregnancy Scan

- **Technique:** Transabdominal and/or transvaginal ultrasound was performed to confirm intrauterine pregnancy location and number, and to assess the gestational sac, yolk sac, embryo/fetal pole, cardiac activity, and adnexa.

- **Default recommendation text:** Please correlate clinically. Routine antenatal follow-up as advised; if dating or viability cannot yet be confirmed, repeat scan in 7–10 days is recommended.

#### Impression Philosophy

State the number and location of gestational sac(s), CRL-based GA when an embryo is visible, cardiac activity status explicitly (never implied), and any adnexal finding. Avoid asserting a firm gestational age from GS alone once an embryo is measurable — CRL supersedes MSD as soon as it is obtainable.

#### Recommendation Philosophy

Routine antenatal follow-up when findings are reassuring. When cardiac activity cannot yet be assessed because the pregnancy is too early, recommend a defined short-interval repeat scan rather than an inconclusive report. Route any twin/multiple gestation sacs to the Multiple Pregnancy protocol for detailed chorionicity work-up, and any bleeding/pain presentation to the Viability protocol.

#### Follow-up Philosophy

Repeat in 7–14 days if too early to confirm cardiac activity (e.g. CRL not yet measurable, or CRL <7 mm without visible heartbeat) per standard SRU-aligned early-pregnancy criteria; otherwise follow the routine antenatal visit schedule. The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study; no separate compliance workflow needs to be described here.

#### Copilot Behaviour

Copilot should check CRL-vs-cardiac-activity discordance (flag if CRL ≥7 mm with no cardiac activity recorded), prompt the reporting physician to route any pregnancy with two or more gestational sacs to the Multiple Pregnancy protocol, and remind that mean sac diameter without a yolk sac or embryo needs restating in mm against the anembryonic-pregnancy threshold rather than left as free text.

#### Structured Finding Assistant Logic

GS/YS and CRL/FHR are captured as separate structured findings (rather than one combined template) because they are visible at different gestational windows; the twin-gestation finding uses a select for chorionicity so the same {key} substitution mechanism records the provisional impression pending the dedicated Multiple Pregnancy work-up.

#### Critical Findings

- No cardiac activity with CRL ≥7 mm (missed miscarriage per SRU criteria)
- Empty gestational sac ≥25 mm mean sac diameter without yolk sac or embryo (anembryonic pregnancy)
- Sonographic findings suspicious for ectopic pregnancy or pregnancy of unknown location
- Marked discordance between gestational sac size and stated menstrual dates

#### Print Behaviour

Standard antenatal report print; GA/EDD in the header auto-populate once a CRL (or, failing that, MSD) is entered against this visit, consistent with the platform's established-once dating model.


### Dating

**Tab name:** Dating

**Purpose:** First-trimester dating scan establishing gestational age and estimated date of delivery from crown-rump length per the Robinson & Fleming formula — the single most accurate obstetric dating parameter, ideally performed once and held fixed for the remainder of the pregnancy.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Impression
- Recommendation

#### Optional Sections

- Technique
- Measurements

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| CRL | mm | Validated dating range approximately 10–84 mm (~6 to 13+6 weeks GA); GA(days) = 8.052 × √CRL(mm) + 23.73 (Robinson & Fleming, 1975), accurate to within ±3–5 days | Yes | `Crown-rump length measures {value} mm.` |
| MSD | mm | Fallback dating parameter before an embryo is measurable; valid roughly 2–10 mm MSD (up to ~6 weeks GA); GA(days) = MSD(mm) + 30 | No | `Mean sac diameter measures {value} mm (embryo not yet visualised).` |

**Required measurements:** CRL

**Optional measurements:** MSD

#### Normal Template

> Single live intrauterine pregnancy. Crown-rump length corresponds to the established gestational age, with cardiac activity present.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| CRL-Based Dating | Yes | Crown-rump length measures {crl} mm. Based on CRL (Robinson & Fleming formula), the estimated gestational age is {ga} and the estimated date of delivery is {edd}. | Singleton intrauterine pregnancy dated by CRL at {ga}; EDD {edd}. |
| Dating Discordant from LMP | Yes | CRL-based gestational age of {gaCrl} differs from the LMP-based gestational age of {gaLmp} by more than 7 days. Per standard first-trimester dating criteria, {action}. | Dating discordance between CRL and LMP of more than 7 days; {action}. |
| Too Early to Date by CRL | No | Only a gestational sac is visualised without a definite embryonic pole; a reliable CRL cannot be obtained at this stage. | Pregnancy too early for CRL-based dating — correlate with LMP and repeat scan in 7–10 days. |
| Single Live Intrauterine Pregnancy — Consistent with Dates | No | A single live intrauterine pregnancy is confirmed, consistent with menstrual dates. | Single live intrauterine pregnancy consistent with dates. |

Structured Finding Assistant question sets for this study:

- **CRL-Based Dating**:
  - `crl` — CRL (mm), type: text, required, default: ``
  - `ga` — Gestational age (CRL-based), type: text, required, default: ``
  - `edd` — EDD, type: text, required, default: ``
- **Dating Discordant from LMP**:
  - `gaLmp` — LMP-based GA, type: text, optional, default: ``
  - `gaCrl` — CRL-based GA, type: text, optional, default: ``
  - `action` — Dating decision, type: select, required, default: `EDD is revised to the CRL-based estimate` (options: EDD is revised to the CRL-based estimate, LMP-based EDD is retained given a reliable menstrual history)

#### Clinical History Chips

- **Unsure of LMP** — inserts: "Unsure of last menstrual period — requesting ultrasound dating."
- **IVF/ART — known conception date** — inserts: "IVF/ART conception, embryo transfer date known."
- **Irregular cycles** — inserts: "Irregular menstrual cycles — LMP unreliable for dating."

#### Protocol

- **Protocol name:** USG Dating Scan (First Trimester)

- **Technique:** Transabdominal and/or transvaginal ultrasound was performed in the first trimester to obtain crown-rump length for pregnancy dating.

- **Default recommendation text:** EDD established by CRL per the Robinson & Fleming formula. Please correlate clinically. Routine antenatal follow-up as advised; NT scan recommended at 11–13+6 weeks if not already performed.

#### Impression Philosophy

State GA and EDD explicitly with the dating source named (CRL preferred over LMP whenever both are available); flag any CRL–LMP discordance greater than 7 days as requiring an explicit EDD decision rather than leaving both dates in the report unreconciled.

#### Recommendation Philosophy

Recommend the NT-scan window (11–13+6 weeks) when this dating scan occurs earlier. Once GA is established from CRL it should be held fixed and projected forward at later visits — not re-derived from second/third-trimester BPD/HC/AC/FL, which is not reliable for dating.

#### Follow-up Philosophy

If too early to obtain a reliable CRL, repeat in 7–10 days. GA established here is carried forward for the rest of the pregnancy per the established-once, projected-forward dating model; a genuine later dating measurement (a second CRL/MSD) can upgrade an LMP- or manual-based estimate once, with an explicit warning if it shifts EDD by more than 7 days. The standard obstetric PCPNDT/Form F reminder applies automatically and is not re-described here.

#### Copilot Behaviour

Copilot should flag a CRL outside the validated 10–84 mm range for verification, warn when CRL-vs-LMP discordance exceeds 7 days and prompt an explicit EDD-revision decision, and remind the reporting physician that GA once established by CRL should not be silently overwritten by biometry from a later visit.

#### Structured Finding Assistant Logic

CRL/GA/EDD are combined in one structured finding with {key} substitution for all three so the sentence is generated directly from the measured value plus the computed GA/EDD the physician transcribes; the LMP-discordance finding uses a select {action} key to record which EDD decision was actually taken.

#### Critical Findings

- CRL outside the validated 10–84 mm dating range for the stated gestational age
- No cardiac activity with CRL ≥7 mm
- CRL–LMP discordance greater than 7 days not yet reconciled with an EDD decision

#### Print Behaviour

Print header auto-populates GA-by-dates and EDD once CRL is saved on this visit; subsequent visits display GA projected forward from this dating scan rather than recalculated from later biometry.


### Viability

**Tab name:** Viability

**Purpose:** Assesses pregnancy viability in a patient presenting with first-trimester bleeding or pain — cardiac activity present/absent, gestational sac and yolk sac morphology, subchorionic hematoma, and differentiation of viable, non-viable, and pregnancy of unknown location (PUL).

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Impression
- Recommendation

#### Optional Sections

- Technique
- Measurements

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| CRL | mm | SRU criterion: non-viability if no cardiac activity is seen with CRL ≥7 mm | No | `Crown-rump length measures {value} mm.` |
| MSD | mm | SRU criterion: non-viability (anembryonic pregnancy) if mean sac diameter ≥25 mm with no embryo or yolk sac | No | `Mean sac diameter measures {value} mm.` |
| Fetal Heart Rate | bpm | 110–180 bpm when cardiac activity is present; record 0/absent explicitly rather than leaving blank when activity is not seen | No | `Fetal heart rate is {value} bpm.` |
| Subchorionic Hematoma Size | mm | No universally agreed cut-off; larger collections and those involving >50% of sac circumference carry higher miscarriage risk | No | `Subchorionic hematoma measures approximately {value} mm in maximal dimension.` |

**Required measurements:** _None_

**Optional measurements:** CRL, MSD, Fetal Heart Rate, Subchorionic Hematoma Size

#### Normal Template

> A single live intrauterine gestational sac is seen with a normal yolk sac and a live embryo showing cardiac activity. No subchorionic hematoma or adnexal abnormality is identified.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Confirmed Viable Intrauterine Pregnancy | Yes | A live intrauterine embryo is seen with a crown-rump length of {crl} mm and cardiac activity present at {fhr} bpm. | Viable intrauterine pregnancy, CRL {crl} mm. |
| Non-Viable Pregnancy | Yes | {findingType} is demonstrated, consistent with a non-viable intrauterine pregnancy per SRU diagnostic criteria. | Findings consistent with a non-viable intrauterine pregnancy. |
| Subchorionic Hematoma | Yes | A crescentic anechoic to hypoechoic collection is noted between the chorionic membrane and myometrium at the {location} aspect of the gestational sac, measuring approximately {size} mm, in keeping with a subchorionic hematoma. {viability}. | Subchorionic hematoma, {location}, {size} mm. {viability}. |
| Pregnancy of Unknown Location | Yes | No definite intrauterine or extrauterine gestational sac is identified despite a positive pregnancy test. Endometrium appears {endo}. | Pregnancy of unknown location — serial β-hCG and repeat ultrasound in 48–72 hours recommended to differentiate a very early intrauterine pregnancy, ectopic pregnancy, and complete miscarriage. |
| Too Early to Assess Viability | No | An intrauterine gestational sac is seen but is too small/early to confirm or exclude a yolk sac or embryonic pole with certainty at this visit. | Indeterminate viability at this stage — repeat ultrasound in 7–10 days recommended before a non-viability diagnosis is made. |

Structured Finding Assistant question sets for this study:

- **Confirmed Viable Intrauterine Pregnancy**:
  - `crl` — CRL (mm), type: text, required, default: ``
  - `fhr` — Fetal heart rate (bpm), type: text, required, default: ``
- **Non-Viable Pregnancy**:
  - `findingType` — Non-viability criterion met, type: select, required, default: `No cardiac activity in an embryo with CRL ≥ 7 mm` (options: No cardiac activity in an embryo with CRL ≥ 7 mm, Empty gestational sac with mean sac diameter ≥ 25 mm and no embryo or yolk sac, No embryo with cardiac activity ≥ 2 weeks after a scan showing a sac without a yolk sac, No embryo with cardiac activity ≥ 11 days after a scan showing a sac with a yolk sac)
- **Subchorionic Hematoma**:
  - `location` — Location, type: select, required, default: `marginal` (options: superior, inferior, marginal, retroplacental)
  - `size` — Size (mm), type: text, required, default: ``
  - `viability` — Embryo status, type: select, required, default: `The embryo is viable with cardiac activity present` (options: The embryo is viable with cardiac activity present, Non-viable — see separate Non-Viable Pregnancy finding)
- **Pregnancy of Unknown Location**:
  - `endo` — Endometrial appearance, type: select, required, default: `unremarkable` (options: unremarkable, thickened, showing a decidual reaction)

#### Clinical History Chips

- **Bleeding PV** — inserts: "Bleeding per vaginum in known/suspected pregnancy."
- **Pain abdomen with known pregnancy** — inserts: "Pain abdomen with known pregnancy — rule out ectopic/threatened miscarriage."
- **Prior miscarriage** — inserts: "History of prior miscarriage."

#### Protocol

- **Protocol name:** USG Viability Scan (Threatened Miscarriage)

- **Technique:** Transvaginal (with transabdominal correlation where indicated) ultrasound was performed to assess intrauterine pregnancy location, cardiac activity, gestational sac/yolk sac morphology, and for subchorionic or retroplacental hemorrhage, in a patient presenting with first-trimester bleeding or pain.

- **Default recommendation text:** Please correlate clinically. Pelvic rest as advised; repeat ultrasound in 1–2 weeks if bleeding persists or if viability/dating remains uncertain.

#### Impression Philosophy

Report viable, non-viable, and pregnancy-of-unknown-location as three mutually exclusive categories per SRU consensus criteria; always state cardiac activity status explicitly and never infer it from a prior visit's findings.

#### Recommendation Philosophy

Viable pregnancy with hematoma: conservative management/pelvic rest with an interval scan. Non-viable pregnancy: clinical correlation with the obstetric team for management options — imaging documents the criterion met, it does not itself certify fetal demise unless that criterion is unambiguously met. PUL: serial β-hCG plus a repeat scan in 48–72 hours, with ectopic pregnancy specifically excluded.

#### Follow-up Philosophy

Repeat interval is scenario-specific: 7–10 days when too early/indeterminate, 48–72 hours with serial β-hCG for PUL. Confirm an explicit SRU criterion (CRL ≥7 mm with no cardiac activity, MSD ≥25 mm with no embryo, or the interval-based criteria) before recording a non-viable impression, to avoid a false-positive miscarriage diagnosis. The standard obstetric PCPNDT/Form F reminder applies automatically and is not re-described here.

#### Copilot Behaviour

Copilot should require an explicit cardiac-activity status before allowing sign-off, cross-check the entered CRL/MSD against the SRU diagnostic thresholds before permitting a 'non-viable' impression to be finalized, and prompt for ectopic-pregnancy exclusion (adnexal mass, free fluid) whenever no intrauterine sac is recorded.

#### Structured Finding Assistant Logic

The Non-Viable Pregnancy finding uses a select {findingType} that encodes the specific SRU criterion actually met, so the impression records which objective threshold justified the diagnosis rather than a free-text guess; the hematoma finding's {viability} select cross-references the separate non-viability finding rather than duplicating its logic inline.

#### Critical Findings

- No cardiac activity meeting SRU criteria for pregnancy failure
- Sonographic findings suspicious for ectopic pregnancy (adnexal mass ± free fluid, empty uterus)
- Pregnancy of unknown location
- Large or enlarging subchorionic hematoma involving more than half the sac circumference

#### Print Behaviour

Non-viable and pregnancy-of-unknown-location impressions are flagged for mandatory clinician co-sign given the clinical sensitivity of a miscarriage or ectopic-pregnancy diagnosis, consistent with the platform's existing critical-finding gating.


### NT

**Tab name:** NT

**Purpose:** First-trimester combined-screening scan (11–13+6 weeks) measuring nuchal translucency and assessing nasal bone and other soft markers for aneuploidy and cardiac-anomaly risk.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Measurements
- Impression
- Recommendation

#### Optional Sections

- Technique

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| CRL | mm | 45–84 mm at 11–13+6 weeks (the validated NT-scan window) | Yes | `Crown-rump length measures {value} mm.` |
| NT | mm | Normal generally <3.0–3.5 mm depending on CRL; ≥3.5 mm (or ≥99th centile for CRL) is associated with increased aneuploidy and cardiac-anomaly risk | Yes | `Nuchal translucency measures {value} mm.` |
| DV PIV | index | Reference ranges vary with CRL; an elevated pulsatility index for veins or an absent/reversed a-wave is an additional soft marker for aneuploidy and cardiac defect | No | `Ductus venosus PIV is {value}.` |

**Required measurements:** CRL, NT

**Optional measurements:** DV PIV

#### Normal Template

> Single live intrauterine fetus. CRL corresponds to the established gestational age. Nuchal translucency and nasal bone are within normal limits.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| NT Measurement | Yes | Nuchal translucency measures {ntMm} mm. Nasal bone is {nasalBone}. | NT {ntMm} mm. |
| Increased Nuchal Translucency | Yes | Nuchal translucency measures {ntMm} mm, at or above the 3.5 mm threshold associated with increased aneuploidy and structural/cardiac-anomaly risk. | Increased NT ({ntMm} mm) — genetic counselling, combined or cell-free DNA screening, and a detailed cardiac and anomaly scan are recommended. |
| Ductus Venosus Doppler | Yes | Ductus venosus Doppler shows a {dv}. | Ductus venosus a-wave: {dv}. |
| Tricuspid Regurgitation | Yes | Tricuspid regurgitation is {tr} on colour/pulsed Doppler across the tricuspid valve. | Tricuspid regurgitation {tr} — an additional first-trimester soft marker for aneuploidy/cardiac anomaly risk when present. |

Structured Finding Assistant question sets for this study:

- **NT Measurement**:
  - `ntMm` — NT (mm), type: text, required, default: ``
  - `nasalBone` — Nasal bone, type: select, optional, default: `present` (options: present, absent, hypoplastic)
- **Increased Nuchal Translucency**:
  - `ntMm` — NT (mm), type: text, required, default: ``
- **Ductus Venosus Doppler**:
  - `dv` — DV a-wave, type: select, required, default: `Normal (positive a-wave)` (options: Normal (positive a-wave), Absent a-wave, Reversed a-wave)
- **Tricuspid Regurgitation**:
  - `tr` — Tricuspid regurgitation, type: select, required, default: `Absent` (options: Absent, Present)

#### Clinical History Chips

- **Routine first-trimester aneuploidy screening** — inserts: "Routine first-trimester combined screening for aneuploidy."
- **Advanced maternal age** — inserts: "Advanced maternal age."
- **Previous aneuploidy-affected pregnancy** — inserts: "Previous pregnancy affected by aneuploidy."

#### Protocol

- **Protocol name:** USG NT Scan

- **Technique:** First-trimester ultrasound was performed transabdominally between 11 and 13+6 weeks, assessing crown-rump length, nuchal translucency, and nasal bone.

- **Default recommendation text:** Combine with maternal serum biochemistry for aneuploidy risk assessment as clinically indicated.

#### Impression Philosophy

Always report NT as an absolute value in mm alongside CRL (since risk interpretation is CRL-dependent), state nasal bone status explicitly, and note additional soft markers (DV a-wave, tricuspid regurgitation) only when specifically assessed rather than implying they were checked by omission.

#### Recommendation Philosophy

Increased NT, absent nasal bone, reversed DV a-wave, or tricuspid regurgitation each independently warrant recommending combined/cell-free DNA screening and a detailed cardiac and anomaly scan; normal findings still recommend combining with maternal serum biochemistry per standard combined first-trimester screening practice.

#### Follow-up Philosophy

Detailed anomaly and fetal echocardiography follow-up is recommended when NT is increased or soft markers are present, timed to the second-trimester anomaly-scan window (18–22 weeks). The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study.

#### Copilot Behaviour

Copilot should validate CRL is within the 45–84 mm NT-scan window before allowing the NT value to be interpreted, flag NT ≥3.5 mm as a critical finding, and prompt for DV Doppler and tricuspid-valve assessment as adjunct soft markers whenever NT is borderline or increased.

#### Structured Finding Assistant Logic

The existing NT Measurement finding keeps its original {ntMm}/{nasalBone} template unchanged; the three new findings (increased NT, DV Doppler, tricuspid regurgitation) are separate structured findings rather than additional keys bolted onto the original, so each soft marker can be selected independently without forcing a re-entry of the base NT value.

#### Critical Findings

- NT ≥3.5 mm or ≥99th centile for CRL
- Absent nasal bone
- Reversed ductus venosus a-wave
- Cystic hygroma

#### Print Behaviour

NT value and CRL print together in the measurements table so risk figures downstream (serum screening software) always have both values available; NT ≥3.5 mm triggers the platform's standard critical-finding banner.


### Anomaly

**Tab name:** Anomaly

**Purpose:** Detailed second-trimester anatomical survey (Level II / TIFFA, 18–22 weeks) assessing fetal cranium, spine, cardiac views, abdominal wall, stomach, kidneys, bladder, limbs, and screening for soft markers and structural anomaly.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Measurements
- Impression
- Recommendation

#### Optional Sections

- Technique

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| BPD | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Biparietal diameter measures {value} mm.` |
| HC | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Head circumference measures {value} mm.` |
| AC | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Abdominal circumference measures {value} mm.` |
| FL | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Femur length measures {value} mm.` |
| EFW | g | Gestational-age-dependent (Hadlock formula); plotted on standard growth centile charts | Yes | `Estimated fetal weight is {value} g (Hadlock formula).` |
| AFI | cm | 5–24 cm (four-quadrant technique); <5 cm oligohydramnios, >24–25 cm polyhydramnios | Yes | `Amniotic fluid index measures {value} cm.` |
| Nuchal Fold | mm | Normal <6 mm at 15–20 weeks; a second-trimester soft marker distinct from first-trimester NT | No | `Nuchal fold thickness measures {value} mm.` |
| Cisterna Magna | mm | Normal approximately 2–10 mm; enlargement raises concern for a posterior fossa anomaly, effacement for a Chiari II/open spina bifida | No | `Cisterna magna measures {value} mm.` |
| Renal Pelvis AP Diameter | mm | Normal <4 mm in the second trimester; ≥4 mm (or ≥7 mm in the third trimester) defines mild pyelectasis warranting follow-up | No | `Renal pelvis AP diameter measures {value} mm.` |

**Required measurements:** BPD, HC, AC, FL, EFW, AFI

**Optional measurements:** Nuchal Fold, Cisterna Magna, Renal Pelvis AP Diameter

#### Normal Template

> Fetal cranium, spine, cardiac four-chamber and outflow views, abdominal wall, stomach, kidneys, bladder, and limbs are structurally normal for gestational age.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Anomaly Survey | No | Fetal cranium, spine, cardiac four-chamber and outflow views, abdominal wall, stomach, kidneys, bladder, and limbs were surveyed and appear structurally normal for gestational age. | No sonographically detectable structural anomaly. |
| Choroid Plexus Cyst | Yes | A choroid plexus cyst is noted in the {side} lateral ventricle, measuring {size} mm. | {side} choroid plexus cyst — an isolated finding is generally a normal variant; correlate with other soft markers and maternal age-adjusted risk. |
| Echogenic Intracardiac Focus | Yes | A small echogenic focus is noted within the {side} cardiac ventricle, in keeping with an echogenic intracardiac focus. | {side} echogenic intracardiac focus — an isolated finding is a common normal variant; correlate with other soft markers. |
| Renal Pelvis Dilation (Pyelectasis) | Yes | The renal pelvis of the {side} kidney measures {size} mm in antero-posterior diameter. | {side} mild pyelectasis — third-trimester follow-up ultrasound recommended to exclude progression. |
| Single Umbilical Artery | No | Only one umbilical artery is identified alongside the umbilical vein on cross-section of a free loop of cord, in keeping with a single umbilical artery. | Single umbilical artery — associated structural anomaly should be specifically excluded and a follow-up growth scan is recommended. |

Structured Finding Assistant question sets for this study:

- **Choroid Plexus Cyst**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `size` — Size (mm), type: text, required, default: ``
- **Echogenic Intracardiac Focus**:
  - `side` — Side, type: select, required, default: `left` (options: left, right, bilateral)
- **Renal Pelvis Dilation (Pyelectasis)**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `size` — Size (mm), type: text, required, default: ``

#### Clinical History Chips

- **Routine 18–22 week anomaly scan** — inserts: "Routine second-trimester anomaly scan, 18–22 weeks."
- **Abnormal maternal serum screening** — inserts: "Abnormal maternal serum aneuploidy screening result."
- **Family history of congenital anomaly** — inserts: "Family history of congenital anomaly."

#### Protocol

- **Protocol name:** USG Anomaly Scan (Level II)

- **Technique:** Detailed anatomical survey (Level II / TIFFA) was performed transabdominally between 18 and 22 weeks, assessing fetal cranium, spine, cardiac four-chamber and outflow tracts, abdominal wall, stomach, kidneys, bladder, and limbs.

- **Default recommendation text:** Please correlate clinically. Routine antenatal follow-up as advised.

#### Impression Philosophy

State the survey as normal or list each structural finding explicitly by organ system; isolated soft markers (CPC, EIF, mild pyelectasis, SUA) are reported as isolated normal-variant findings unless combined with another marker, growth abnormality, or an abnormal serum screen, in which case the combination — not any single marker alone — drives the aneuploidy-risk recommendation.

#### Recommendation Philosophy

Major structural anomalies are referred for fetal medicine/genetic counselling and, where relevant, targeted fetal echocardiography. Isolated soft markers are reported with their standard, marker-specific follow-up (e.g. third-trimester rescan for pyelectasis) rather than escalated as if they were major anomalies.

#### Follow-up Philosophy

Pyelectasis and other soft markers scheduled for a defined third-trimester rescan; any major anomaly referred promptly rather than left to the routine growth-scan interval. The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study and are not re-described here.

#### Copilot Behaviour

Copilot should confirm all mandatory survey organs/views have an explicit finding entered before allowing finalize, tally combined soft markers across the report (CPC + EIF + pyelectasis together carry different weight than any one alone) and surface that combination as a prompt, and remind the physician that a normal survey does not exclude a functional cardiac or later-onset anomaly.

#### Structured Finding Assistant Logic

Soft-marker findings (CPC, EIF, pyelectasis) each use a side select plus a size/measurement text key so the same {key} template records laterality and magnitude consistently across the survey, mirroring the side/size convention already used for thyroid and breast nodules elsewhere in the platform.

#### Critical Findings

- Any major structural anomaly detected on survey
- Multiple soft markers present in combination (increased aneuploidy risk)
- Severe oligohydramnios or polyhydramnios incidentally noted on survey
- Cardiac four-chamber or outflow-tract view abnormality

#### Print Behaviour

Organ-by-organ survey checklist prints in full even when normal, documenting that each mandatory view was obtained; any structural finding triggers the platform's standard critical-finding banner requiring physician acknowledgment before finalize.


### Growth

**Tab name:** Growth

**Purpose:** Third-trimester growth scan assessing fetal biometry against gestational age, liquor volume, placental location, presentation, and umbilical artery Doppler, to identify growth restriction or macrosomia.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Measurements
- Impression
- Recommendation

#### Optional Sections

- Technique

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| BPD | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Biparietal diameter measures {value} mm.` |
| HC | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Head circumference measures {value} mm.` |
| AC | mm | Gestational-age-dependent; the single most sensitive parameter for growth restriction/macrosomia | Yes | `Abdominal circumference measures {value} mm.` |
| FL | mm | Gestational-age-dependent; plotted on standard Hadlock biometric growth curves | Yes | `Femur length measures {value} mm.` |
| EFW | g | Gestational-age-dependent (Hadlock formula); <10th centile suggests growth restriction, >90th centile suggests macrosomia/large-for-GA | Yes | `Estimated fetal weight is {value} g (Hadlock formula).` |
| AFI | cm | 5–24 cm (four-quadrant technique); <5 cm oligohydramnios, >24–25 cm polyhydramnios | Yes | `Amniotic fluid index measures {value} cm.` |
| UA PI | index | Gestational-age-dependent, declining with advancing gestation; elevated PI/absent or reversed end-diastolic flow indicates placental insufficiency | Yes | `Umbilical artery pulsatility index is {value}.` |
| UA RI | index | Gestational-age-dependent, declining with advancing gestation; used alongside PI to characterise umbilical artery resistance | Yes | `Umbilical artery resistive index is {value}.` |
| MCA PI | index | Gestational-age-dependent, rises then plateaus in the third trimester; a reduced PI indicates brain-sparing (redistribution) | No | `Middle cerebral artery pulsatility index is {value}.` |
| CPR | ratio | Cerebroplacental ratio = MCA PI / UA PI; a reduced ratio (commonly <1.08, or below the gestational-age-specific centile) is associated with adverse perinatal outcome even when individual Doppler indices are each normal | No | `Cerebroplacental ratio (MCA PI / UA PI) is {value}.` |

**Required measurements:** BPD, HC, AC, FL, EFW, AFI, UA PI, UA RI

**Optional measurements:** MCA PI, CPR

#### Normal Template

> Fetal biometry corresponds to the established gestational age with appropriate interval growth. Liquor volume is adequate. Placenta is normally located. Umbilical artery Doppler indices are within normal limits.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Growth Appropriate for GA | No | Fetal biometry corresponds to the established gestational age. Interval growth is appropriate. | Growth appropriate for gestational age. |
| Fetal Growth Restriction | No | Fetal biometry is below the expected range for gestational age, suggestive of growth restriction. | Suspected fetal growth restriction — clinical correlation and Doppler assessment advised. |
| Large for Gestational Age | No | Estimated fetal weight is above the 90th centile for gestational age, suggestive of macrosomia/large-for-gestational-age growth. | Large for gestational age — screen for maternal glucose intolerance if not already done; correlate clinically. |
| FGR — Doppler Assessment | Yes | Fetal growth restriction is {type}. Umbilical artery PI is {uaPi} and MCA PI is {mcaPi}, giving a cerebroplacental ratio category of {category}. | {type} fetal growth restriction with {category} Doppler pattern — closer surveillance advised as per obstetric team. |
| Oligohydramnios | No | Amniotic fluid index measures less than 5 cm, in keeping with oligohydramnios. | Oligohydramnios — correlate clinically; closer antenatal surveillance advised. |
| Polyhydramnios | No | Amniotic fluid index measures greater than 24–25 cm (or single deepest pocket >8 cm), in keeping with polyhydramnios. | Polyhydramnios — correlate clinically for maternal diabetes and fetal structural/swallowing causes. |

Structured Finding Assistant question sets for this study:

- **FGR — Doppler Assessment**:
  - `type` — Pattern, type: select, required, default: `asymmetric` (options: symmetric, asymmetric)
  - `uaPi` — UA PI, type: text, optional, default: ``
  - `mcaPi` — MCA PI, type: text, optional, default: ``
  - `category` — Doppler category, type: select, required, default: `normal (no redistribution)` (options: normal (no redistribution), brain-sparing (redistribution), absent/reversed end-diastolic flow)

#### Clinical History Chips

- **Routine third-trimester growth scan** — inserts: "Routine third-trimester growth scan."
- **Suspected growth restriction/small for dates** — inserts: "Symphysio-fundal height/clinical exam suggests small for dates."
- **Gestational diabetes** — inserts: "Gestational diabetes mellitus — growth and liquor surveillance."

#### Protocol

- **Protocol name:** USG Growth Scan (3rd Trimester)

- **Technique:** Real-time obstetric ultrasound was performed transabdominally, assessing fetal biometry, liquor volume, placental location, presentation, and Doppler where indicated.

- **Default recommendation text:** Please correlate clinically. Routine antenatal follow-up as advised.

#### Impression Philosophy

Give an explicit centile-based growth category (appropriate, restricted, or large for gestational age) rather than a bare biometry recitation; when growth restriction is suspected, characterise it as symmetric or asymmetric and state the Doppler category (normal, brain-sparing, or absent/reversed end-diastolic flow), since management differs materially by category.

#### Recommendation Philosophy

Appropriate growth follows the routine antenatal schedule. Growth restriction, oligohydramnios, or an abnormal Doppler pattern is recommended for closer surveillance by the obstetric team, with the specific interval left to clinical judgement rather than dictated by the imaging report. Reduced cerebroplacental ratio is flagged even when individual UA/MCA indices are each individually normal.

#### Follow-up Philosophy

Absent or reversed umbilical artery end-diastolic flow warrants urgent same-day obstetric communication rather than routine follow-up scheduling; milder Doppler or growth abnormalities are typically rescanned in 1–2 weeks per the managing obstetrician. The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study and are not re-described here.

#### Copilot Behaviour

Copilot should compute the cerebroplacental ratio automatically from entered UA PI and MCA PI values, flag absent/reversed umbilical artery end-diastolic flow as an urgent critical finding distinct from ordinary elevated PI, and cross-check EFW centile against AC trend to catch cases where AC alone already suggests restriction before EFW is finalized.

#### Structured Finding Assistant Logic

The two original findings keep their unchanged text; the new FGR-Doppler finding adds {type}/{category} selects on top of the existing FGR concept so the Doppler characterisation is recorded as structured data rather than folded as free text into the original 'Fetal Growth Restriction' finding, which stays reusable on its own for a first-pass, pre-Doppler flag.

#### Critical Findings

- EFW below the 3rd–5th centile or severe growth restriction
- Absent or reversed umbilical artery end-diastolic flow
- Reduced cerebroplacental ratio (brain-sparing pattern)
- Oligohydramnios (AFI <5 cm) or polyhydramnios (AFI >24–25 cm)

#### Print Behaviour

Biometry and Doppler values print in a standard growth table alongside the plotted centile; absent/reversed end-diastolic flow triggers the platform's standard critical-finding banner requiring physician acknowledgment before finalize.


### BPP

**Tab name:** BPP

**Purpose:** Biophysical profile assessing fetal wellbeing via four ultrasound components (breathing, gross body movement, tone, amniotic fluid volume) plus the non-stress test, scored out of 10 (or the four ultrasound components alone, scored out of 8, when NST is not performed).

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Measurements
- Impression
- Recommendation

#### Optional Sections

- Technique

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| AFI | cm | 5–24 cm normal for the fluid component; <5 cm scores 0 for that component regardless of the other four | Yes | `Amniotic fluid index measures {value} cm.` |
| SDP | cm | Single deepest (vertical) pocket ≥2 cm scores 2 for the fluid component; <2 cm scores 0 | No | `Single deepest amniotic fluid pocket measures {value} cm.` |
| BPP Score | points | 8–10/10 reassuring (or 8/8 for a modified BPP without NST); 6/10 equivocal; ≤4/10 concerning for fetal compromise | Yes | `Biophysical profile score is {value}/10.` |

**Required measurements:** AFI, BPP Score

**Optional measurements:** SDP

#### Normal Template

> Fetal breathing movements, gross body movements, and fetal tone are all present. Amniotic fluid volume is normal. Non-stress test is reactive. Biophysical profile score: 10/10 — reassuring fetal status.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Biophysical Profile Assessment | Yes | Fetal breathing movements are {breathing}. Gross body movements are {movement}. Fetal tone is {tone}. Amniotic fluid volume is {afi}.[ Non-stress test is {nst}.] Biophysical profile score: {score}/10. | Biophysical profile score {score}/10 — reassuring fetal status. |
| Low BPP Score — Action Required | Yes | Biophysical profile score is {score}/10, raising concern for possible fetal compromise. {management}. | Low biophysical profile score ({score}/10) — {management}. |
| Isolated Oligohydramnios on BPP | No | Amniotic fluid volume is reduced (AFI <5 cm or single deepest pocket <2 cm) despite otherwise reassuring biophysical parameters. | Isolated oligohydramnios — obstetric correlation advised regardless of the overall BPP score. |
| Extended Observation for Absent Breathing/Movement | No | Fetal breathing movements and gross body movements were not observed in the initial observation window; observation was extended to 30–40 minutes per standard biophysical profile protocol before scoring. | Extended observation performed for absent breathing/movement; see the final biophysical profile score. |
| Modified BPP (AFI + NST) | Yes | A modified biophysical profile comprising amniotic fluid index and non-stress test only was performed. Amniotic fluid volume is {afi} and non-stress test is {nst}. | Modified BPP: amniotic fluid {afi}, NST {nst}. |

Structured Finding Assistant question sets for this study:

- **Biophysical Profile Assessment**:
  - `breathing` — Breathing movements, type: select, required, default: `Present` (options: Present, Absent)
  - `movement` — Gross body movements, type: select, required, default: `Present` (options: Present, Absent)
  - `tone` — Fetal tone, type: select, required, default: `Present` (options: Present, Absent)
  - `afi` — Amniotic fluid volume, type: select, required, default: `Normal` (options: Normal, Reduced)
  - `nst` — Non-stress test, type: select, optional, default: `Reactive` (options: Reactive, Non-reactive, None)
  - `score` — BPP score (/10), type: text, required, default: ``
- **Low BPP Score — Action Required**:
  - `score` — BPP score (/10), type: text, required, default: ``
  - `management` — Recommended action, type: select, required, default: `Urgent obstetric consultation and delivery planning advised` (options: Repeat BPP within 24 hours, Urgent obstetric consultation and delivery planning advised)
- **Modified BPP (AFI + NST)**:
  - `afi` — Amniotic fluid volume, type: select, required, default: `Normal` (options: Normal, Reduced, Increased)
  - `nst` — Non-stress test, type: select, required, default: `Reactive` (options: Reactive, Non-reactive)

#### Clinical History Chips

- **Reduced fetal movements** — inserts: "Maternal perception of reduced fetal movements."
- **Post-dates pregnancy** — inserts: "Post-dates pregnancy — antenatal surveillance."
- **High-risk pregnancy surveillance** — inserts: "High-risk pregnancy — routine antenatal biophysical surveillance."

#### Protocol

- **Protocol name:** USG Biophysical Profile (BPP)

- **Technique:** Real-time grey-scale ultrasound was performed over a minimum 30-minute observation period (extendable to 30–40 minutes per Manning criteria) to assess fetal breathing movements, gross body movements, fetal tone, and amniotic fluid volume, correlated with the non-stress test where performed.

- **Default recommendation text:** Please correlate clinically with the obstetric team. Routine antenatal follow-up if the score is reassuring (8–10/10); closer surveillance or delivery timing to be individualised by gestational age and clinical context for lower scores.

#### Impression Philosophy

State the numeric score out of 10 (or note explicitly if scored out of 8 as a modified BPP without NST) and list which, if any, of the five components scored 0, so the impression is auditable component-by-component rather than a bare total.

#### Recommendation Philosophy

8–10/10 is reassuring and follows routine antenatal follow-up. 6/10 is equivocal and typically prompts either a repeat within 24 hours or delivery if at/beyond term or with oligohydramnios. ≤4/10 strongly favours delivery, individualised by gestational age and clinical context — the imaging report supports, and does not dictate, the obstetric team's delivery decision.

#### Follow-up Philosophy

Extend the observation window to 30–40 minutes before scoring breathing, movement, or tone as 0, to avoid a false-positive low score from a fetal sleep cycle. Repeat interval follows the score category (routine for 8–10, 24-hour repeat or delivery consideration for 6, urgent for ≤4). The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study and are not re-described here.

#### Copilot Behaviour

Copilot should sum the four ultrasound-component scores (and NST when performed) automatically from the select answers into the total, flag any component recorded as absent for a reminder to extend observation before finalizing a low score, and surface AFI/oligohydramnios as a standalone critical flag regardless of the total score, since isolated oligohydramnios changes management even with an otherwise reassuring BPP.

#### Structured Finding Assistant Logic

Five present/absent or normal/reduced select keys map directly to the standard 2-point-per-component BPP scoring system and are summed by the reporting physician into the {score} text field; the [optional] NST clause uses the 'None' sentinel option so the sentence drops cleanly for a modified BPP performed without a non-stress test.

#### Critical Findings

- BPP score ≤4/10
- BPP score 6/10 at or beyond term, or with oligohydramnios
- Absent fetal breathing and movement persisting beyond extended (30–40 minute) observation
- Isolated oligohydramnios (AFI <5 cm or SDP <2 cm) regardless of total score

#### Print Behaviour

Score and component breakdown print as a standard five-row table; totals of 6 or below auto-flag for clinician review before finalize, consistent with other critical-finding gating already in the platform.


### Cervical Length

**Tab name:** Cervical Length

**Purpose:** Transvaginal cervical length screening for preterm birth risk, most validated between 16 and 24 weeks gestation, assessing length, funneling, and membrane status against the standard <25 mm short-cervix threshold.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Measurements
- Impression
- Recommendation

#### Optional Sections

- Technique

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Cervical Length | mm | ≥30 mm normal; 25–29 mm borderline; <25 mm short cervix — most validated at 16–24 weeks GA | Yes | `Cervical length measures {value} mm.` |
| Funnel Length | mm | Recorded when funneling is present; measured from the internal os to the apex of the funnel | No | `Funnel length measures {value} mm.` |
| Funnel Width | mm | Recorded when funneling is present; measured at the internal os across the base of the funnel | No | `Funnel width measures {value} mm.` |

**Required measurements:** Cervical Length

**Optional measurements:** Funnel Length, Funnel Width

#### Normal Template

> Transvaginal cervical length is normal (≥30 mm) with a closed internal os and no funneling.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Cervical Length Measurement | Yes | Transvaginal cervical length measures {cl} mm.[ {funneling}.] | Cervical length {cl} mm.[ {funneling}.] |
| Short Cervix (<25 mm) | No | Transvaginal cervical length measures less than 25 mm, meeting criteria for a short cervix at this gestational age. | Short cervix — increased risk of preterm birth. Obstetric correlation for vaginal progesterone or cerclage evaluation as clinically indicated. |
| Borderline Cervical Length (25–29 mm) | No | Transvaginal cervical length measures 25–29 mm, in the borderline range for this gestational age. | Borderline cervical length — interval rescan in 1–2 weeks as clinically advised. |
| Cervical Length — Post-Cerclage | Yes | Cervical length measures {cl} mm distal to a cervical cerclage suture, which is seen in situ. | Post-cerclage cervical length {cl} mm. |
| Funneling with Membrane Prolapse | No | The amniotic membranes are seen prolapsing through a dilated internal os into the proximal endocervical canal ('hourglass' membranes). | Advanced cervical funneling with membrane prolapse — urgent obstetric correlation advised. |

Structured Finding Assistant question sets for this study:

- **Cervical Length Measurement**:
  - `cl` — Cervical length (mm), type: text, required, default: ``
  - `funneling` — Funneling, type: select, optional, default: `Normal` (options: Normal, Funneling of the internal os is present, with cervical canal shortening toward the external os)
- **Cervical Length — Post-Cerclage**:
  - `cl` — Cervical length distal to cerclage (mm), type: text, required, default: ``

#### Clinical History Chips

- **History of preterm birth** — inserts: "History of prior spontaneous preterm birth."
- **Short cervix on prior scan** — inserts: "Short cervix noted on a prior scan — surveillance."
- **Routine mid-trimester screening** — inserts: "Routine mid-trimester cervical length screening."

#### Protocol

- **Protocol name:** USG Cervical Length Screening (TVS)

- **Technique:** Transvaginal ultrasound was performed with an empty maternal bladder, using gentle probe pressure, to measure cervical length in the sagittal plane over a minimum 3–5 minute observation period (with transfundal pressure applied if clinically indicated) to elicit dynamic shortening or funneling.

- **Default recommendation text:** Please correlate clinically. Routine antenatal follow-up if length is reassuring; obstetric referral for consideration of vaginal progesterone or cerclage if cervical length is short (<25 mm) or rapidly shortening.

#### Impression Philosophy

State the numeric cervical length in mm plus an explicit risk category (normal ≥30 mm, borderline 25–29 mm, short <25 mm), and always state funneling and membrane status explicitly; contextualise the threshold to the stated gestational age since the <25 mm cut-off is most validated between 16 and 24 weeks.

#### Recommendation Philosophy

Short cervix prompts obstetric referral for progesterone/cerclage evaluation per clinical context and obstetric history; borderline length is followed with a short-interval rescan rather than an immediate referral. Post-cerclage measurements are reported against the managing obstetrician's own interval rather than the general screening schedule.

#### Follow-up Philosophy

Borderline lengths are rescanned in 1–2 weeks; a short cervix is referred urgently rather than simply rescanned. The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study and are not re-described here.

#### Copilot Behaviour

Copilot should flag when the stated gestational age falls outside the 16–24 week validated screening window as a caveat on the threshold, auto-flag any cervical length <25 mm as a critical finding regardless of which quick finding was selected, and remind the reporting physician to note bladder distension or excess probe pressure as a cause of a falsely long measurement, particularly in a patient with a strong preterm-birth history.

#### Structured Finding Assistant Logic

The main measurement finding uses a {cl} text key plus a {funneling} select whose 'Normal' option drops the bracketed funneling clause entirely — the same optional-clause convention (dropped on the 'Normal'/'None' sentinel) already used elsewhere in the platform.

#### Critical Findings

- Cervical length <25 mm
- Funneling with membrane prolapse (hourglass membranes)
- Rapid interval shortening on serial scans

#### Print Behaviour

Cervical length below 25 mm triggers the platform's standard critical-finding banner and blocks quiet finalize without explicit physician acknowledgment, consistent with other critical obstetric measurements.


### Multiple Pregnancy

**Tab name:** Multiple Pregnancy

**Purpose:** Twin or multiple gestation scan determining chorionicity and amnionicity (lambda vs T-sign), individual per-fetus biometry, inter-twin growth discordance, and TTTS screening in monochorionic pregnancies.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Findings
- Measurements
- Impression
- Recommendation

#### Optional Sections

- Technique

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Twin A EFW | g | Gestational-age-dependent (Hadlock formula); plotted on standard growth centile charts for each twin individually | Yes | `Estimated fetal weight for Twin A is {value} g.` |
| Twin B EFW | g | Gestational-age-dependent (Hadlock formula); plotted on standard growth centile charts for each twin individually | Yes | `Estimated fetal weight for Twin B is {value} g.` |
| Inter-twin EFW Discordance | % | Discordance = (larger EFW − smaller EFW) / larger EFW × 100; <20% generally not significant, ≥20% is associated with adverse perinatal outcome | Yes | `Inter-twin EFW discordance is {value}%.` |
| Inter-twin Membrane Thickness | mm | A thick (>2 mm), two-layer membrane with a lambda sign supports dichorionicity; a thin, single-layer membrane with a T-sign supports monochorionicity | No | `Inter-twin dividing membrane thickness measures {value} mm.` |

**Required measurements:** Twin A EFW, Twin B EFW, Inter-twin EFW Discordance

**Optional measurements:** Inter-twin Membrane Thickness

#### Normal Template

> Twin intrauterine pregnancy with two live fetuses of concordant growth (EFW discordance <20%). Chorionicity and amnionicity are documented. Amniotic fluid volume is normal in each sac. Umbilical artery Doppler indices are within normal limits for both twins.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Dichorionic Diamniotic Twin Pregnancy | Yes | Two separate gestational sacs are identified, each with its own placenta. A thick intervening membrane demonstrating a {sign} is seen at the placental-membrane junction, in keeping with dichorionic diamniotic (DCDA) twin pregnancy. | Dichorionic diamniotic twin pregnancy. |
| Monochorionic Diamniotic Twin Pregnancy | No | A single placental mass is shared by both fetuses, with a thin intervening dividing membrane demonstrating a T-sign at the membrane-placental junction, in keeping with monochorionic diamniotic (MCDA) twin pregnancy. | Monochorionic diamniotic twin pregnancy — requires closer-interval surveillance including TTTS screening. |
| Monochorionic Monoamniotic Twin Pregnancy | No | No intervening membrane is identified between the two fetuses, which share a single amniotic sac, in keeping with monochorionic monoamniotic (MCMA) twin pregnancy. Umbilical cord entanglement should be specifically assessed with colour Doppler. | Monochorionic monoamniotic twin pregnancy — high-risk; cord entanglement assessment and closely spaced surveillance required. |
| Fetal Growth Discordance <20% | Yes | Estimated fetal weight is {efwA} g for Twin A and {efwB} g for Twin B, an inter-twin discordance of {discordancePercent}%, within the expected range. | Inter-twin EFW discordance {discordancePercent}% — not significant. |
| Fetal Growth Discordance ≥20% | Yes | Estimated fetal weight is {efwA} g for Twin A and {efwB} g for Twin B, an inter-twin discordance of {discordancePercent}%, exceeding the 20% threshold associated with adverse perinatal outcome. | Significant inter-twin growth discordance ({discordancePercent}%) — obstetric correlation and closer surveillance advised; exclude selective FGR/TTTS in monochorionic pregnancies. |
| TTTS Screening — Monochorionic Twins | Yes | In this monochorionic twin pregnancy, the donor twin's amniotic fluid (single deepest pocket) is {donorAfi} and the recipient twin's amniotic fluid is {recipientAfi}.[ Quintero staging: {stage}.] | Monochorionic twin pregnancy — TTTS screening performed.[ Quintero {stage}.] |

Structured Finding Assistant question sets for this study:

- **Dichorionic Diamniotic Twin Pregnancy**:
  - `sign` — Membrane sign, type: select, required, default: `lambda (twin peak) sign` (options: lambda (twin peak) sign, thick membrane, two separate placentas)
- **Fetal Growth Discordance <20%**:
  - `efwA` — Twin A EFW (g), type: text, required, default: ``
  - `efwB` — Twin B EFW (g), type: text, required, default: ``
  - `discordancePercent` — Discordance (%), type: text, required, default: ``
- **Fetal Growth Discordance ≥20%**:
  - `efwA` — Twin A EFW (g), type: text, required, default: ``
  - `efwB` — Twin B EFW (g), type: text, required, default: ``
  - `discordancePercent` — Discordance (%), type: text, required, default: ``
- **TTTS Screening — Monochorionic Twins**:
  - `donorAfi` — Donor twin fluid (SDP/AFI), type: text, required, default: ``
  - `recipientAfi` — Recipient twin fluid (SDP/AFI), type: text, required, default: ``
  - `stage` — Quintero stage, type: select, required, default: `None` (options: None, Stage I, Stage II, Stage III, Stage IV/V)

#### Clinical History Chips

- **Known twin/multiple pregnancy** — inserts: "Known twin/multiple pregnancy."
- **IVF/ART conception** — inserts: "IVF/ART conception."
- **Suspected TTTS** — inserts: "Suspected twin-twin transfusion syndrome — fluid discordance between sacs."

#### Protocol

- **Protocol name:** USG Multiple Pregnancy Scan

- **Technique:** Real-time obstetric ultrasound was performed transabdominally, individually labelling and biometrically assessing each fetus (Twin A, Twin B, ...), determining chorionicity and amnionicity by membrane count/thickness and the lambda vs T-sign at the placental-membrane junction (most reliably assessed in the first trimester), and assessing amniotic fluid volume in each sac, placental location(s), and umbilical artery Doppler.

- **Default recommendation text:** Please correlate clinically. Chorionicity-based surveillance interval as advised by the obstetric team (closer-interval surveillance, including TTTS screening, for monochorionic pregnancies); routine antenatal follow-up for dichorionic pregnancies.

#### Impression Philosophy

State the number of fetuses, chorionicity and amnionicity explicitly with the sign used to determine it, individual EFW and centile per twin, the discordance percentage, and — for every monochorionic pregnancy — an explicit TTTS-screening statement even when normal, since silence on TTTS status is not an acceptable substitute for stating it was assessed.

#### Recommendation Philosophy

Dichorionic pregnancies follow a routine growth-scan interval with per-twin labelling. Monochorionic diamniotic pregnancies are recommended closer-interval surveillance (commonly every two weeks per standard obstetric practice) explicitly flagged for TTTS. Monochorionic monoamniotic pregnancies are the highest-risk category and are recommended for tertiary/fetal-medicine referral.

#### Follow-up Philosophy

Chorionicity, once established — ideally in the first trimester when the lambda/T-sign is most reliable — is not re-derived later in gestation, since membrane characteristics become harder to distinguish as pregnancy advances. Discordance ≥20% or monochorionic status triggers a closer-interval follow-up recommendation rather than the routine schedule. The obstetric PCPNDT/Form F reminder and finalize-block already apply automatically to this study; a separate TTTS-specific Copilot reminder supplements it and is not itself a compliance workflow.

#### Copilot Behaviour

Copilot should require chorionicity and amnionicity to be recorded before allowing the report to finalize, auto-calculate the EFW discordance percentage from the two entered EFWs and flag ≥20% as a critical finding, and surface a TTTS-screening reminder (donor/recipient fluid assessment) specifically whenever chorionicity is recorded as monochorionic.

#### Structured Finding Assistant Logic

The {sign} select embeds the full descriptive clause for the lambda vs T-sign directly into the finding sentence, mirroring the embed-the-clause convention already used elsewhere in the platform; the TTTS finding's Quintero-stage bracket uses the 'None' sentinel option so the staging sentence drops entirely when TTTS is not present, and the growth-discordance findings are split into a below-threshold and at/above-threshold pair rather than one finding with a numeric conditional, consistent with how the Growth study already splits normal vs restricted growth into separate findings.

#### Critical Findings

- Monochorionic monoamniotic twin pregnancy
- Inter-twin EFW discordance ≥20%
- TTTS features in a monochorionic pregnancy (oligohydramnios/polyhydramnios sequence between sacs)
- Single fetal demise in a multiple pregnancy

#### Print Behaviour

Findings and measurements auto-label per fetus (Twin A/Twin B/...) in the printed layout; monochorionic pregnancies print with a standing TTTS-surveillance reminder banner in addition to the platform's standard critical-finding gating.


---

## Small Parts

### Thyroid

**Tab name:** Thyroid

**Purpose:** Grey-scale and colour Doppler evaluation of the thyroid gland for palpable swelling, incidental nodule follow-up, or thyroid function abnormality — sizing each lobe and the isthmus, characterising any nodule with TI-RADS risk stratification, and screening the central/lateral cervical nodal basins.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Technique
- Findings
- Impression

#### Optional Sections

- Measurements
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Right lobe volume | mL | < 10 mL (mildly age/region dependent) | Yes | `Right lobe volume: {value} mL.` |
| Left lobe volume | mL | < 10 mL (mildly age/region dependent) | Yes | `Left lobe volume: {value} mL.` |
| Isthmus thickness | mm | 2-6 mm | Yes | `Isthmus thickness: {value} mm.` |
| Dominant nodule size | mm | N/A — recorded only when a nodule is described | No | `Dominant nodule size: {value} mm.` |

**Required measurements:** Right lobe volume, Left lobe volume, Isthmus thickness

**Optional measurements:** Dominant nodule size

#### Normal Template

> Both thyroid lobes and the isthmus are normal in size with homogeneous echotexture, mildly hyperechoic relative to adjacent strap muscles. No discrete nodule, cystic change, or calcification is identified in either lobe. Vascularity on colour Doppler is symmetric. No significant cervical lymphadenopathy.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Thyroid Nodule | Yes | A {composition} nodule is noted in the {side} lobe, measuring approximately {size} mm, TI-RADS {tirads}. | {side} thyroid nodule, TI-RADS {tirads}. |
| Diffuse Goiter | No | Both thyroid lobes are diffusely enlarged with heterogeneous echotexture, in keeping with a diffuse goiter. No discrete nodule. | Diffuse goiter. |
| Hashimoto Thyroiditis | No | Both thyroid lobes are diffusely enlarged with heterogeneous, coarse hypoechoic echotexture and multiple thin fibrous septations giving a micronodular ('giraffe skin') pattern, with increased vascularity on colour Doppler, in keeping with chronic lymphocytic (Hashimoto) thyroiditis. | Sonographic features in keeping with Hashimoto (chronic lymphocytic) thyroiditis. |
| Thyroid Colloid Cyst | No | A well-defined anechoic to hypoechoic cystic lesion showing a few punctate echogenic foci with 'comet-tail' reverberation artifact is noted, consistent with a benign colloid nodule, TI-RADS 2. | Colloid cyst, TI-RADS 2 (benign). |
| Multinodular Goiter | No | Multiple nodules of varying size and composition are noted in both diffusely enlarged lobes, in keeping with a multinodular goiter. The dominant/most suspicious nodule is separately characterised above where applicable. | Multinodular goiter. |

Structured Finding Assistant question sets for this study:

- **Thyroid Nodule**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `composition` — Composition, type: select, optional, default: `solid` (options: solid, cystic, mixed solid-cystic)
  - `size` — Size (mm), type: text, optional, default: ``
  - `tirads` — TI-RADS category, type: select, required, default: `3` (options: 2, 3, 4, 5)

#### Clinical History Chips

- **Thyroid swelling** — inserts: "Thyroid swelling."
- **Hoarseness of voice** — inserts: "Hoarseness of voice."
- **Deranged thyroid function tests** — inserts: "Deranged thyroid function tests (TFT)."

#### Protocol

- **Protocol name:** USG Thyroid

- **Technique:** Real-time grey-scale and colour Doppler ultrasound of the thyroid and neck was performed using a high-frequency linear probe.

- **Default recommendation text:** Please correlate with clinical and biochemical findings.

#### Impression Philosophy

Lead with laterality and TI-RADS category for any nodule; state whether the gland pattern is diffuse (goiter/thyroiditis) or focal (nodule); explicitly note cervical nodal status when a TI-RADS 4/5 nodule is present.

#### Recommendation Philosophy

Base the recommendation on TI-RADS size thresholds (ACR-style): TR3 nodules ≥ 2.5 cm, TR4 ≥ 1.5 cm, and TR5 ≥ 1 cm warrant FNAC; smaller nodules in the same categories warrant follow-up ultrasound rather than immediate biopsy.

#### Follow-up Philosophy

TR3 nodules 1.5-2.5 cm and TR4 nodules 1-1.5 cm (below the FNAC threshold but above the minimum size that warrants surveillance) are followed at 1, 2, 3, and 5 years; TR5 nodules 0.5-1 cm are followed yearly for 5 years; nodules below these follow-up size thresholds, TR2 nodules, and simple/colloid cysts require no routine follow-up.

#### Copilot Behaviour

Prompt for a TI-RADS category whenever a nodule finding is used without one selected; remind to record both lobe volumes and isthmus thickness; flag a nodule ≥ 1 cm described without a corresponding FNAC/follow-up recommendation; remind to comment on cervical lymph nodes when a TI-RADS 4/5 nodule is present.

#### Structured Finding Assistant Logic

Thyroid Nodule uses the {key}/questions_json Structured Finding Assistant (side, composition, size, TI-RADS) so nodule reporting and the TI-RADS category are captured consistently; Diffuse Goiter, Hashimoto Thyroiditis, Thyroid Colloid Cyst, and Multinodular Goiter remain free-text since each describes a characteristic gland-wide or single-lesion pattern rather than a small set of per-case variables.

#### Critical Findings

- TI-RADS 5 nodule
- Nodule associated with suspicious cervical lymphadenopathy (possible nodal metastasis)
- Rapidly enlarging nodule/goiter with tracheal compression or deviation

#### Print Behaviour

The Impression leads with laterality and TI-RADS category so it is scannable on the printed report header; the Measurements block renders both lobe volumes and isthmus thickness as a compact table immediately beneath Findings.


### Breast

**Tab name:** Breast

**Purpose:** Grey-scale and colour Doppler evaluation of a palpable breast lump, screening/diagnostic breast complaint, or follow-up of a known lesion, with BI-RADS categorisation of any mass or cyst and assessment of the axilla.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Technique
- Findings
- Impression

#### Optional Sections

- Measurements
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Lesion size (largest dimension) | mm | N/A — recorded only when a mass/cyst is described | No | `Lesion size: {value} mm.` |
| Distance from nipple | cm | N/A — recorded only when a mass/cyst is described | No | `Distance from nipple: {value} cm.` |
| Axillary lymph node cortical thickness | mm | < 3 mm, uniform, with preserved fatty hilum | No | `Axillary node cortical thickness: {value} mm.` |

**Required measurements:** _None_

**Optional measurements:** Lesion size (largest dimension), Distance from nipple, Axillary lymph node cortical thickness

#### Normal Template

> Both breasts show normal fibroglandular echotexture with no discrete mass, architectural distortion, or suspicious calcification. Both axillae are normal, BI-RADS 1.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Solid Breast Lesion | Yes | A {shape} solid hypoechoic lesion is noted in the {side} breast, measuring approximately {size} mm, BI-RADS {birads}. | {side} breast lesion, BI-RADS {birads}. |
| Simple Breast Cyst | No | A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted, showing no internal echoes, septations, or mural nodularity. | Simple breast cyst, BI-RADS 2. |
| Complicated Breast Cyst | No | A cystic lesion with low-level internal echoes and mobile debris is noted, without a discrete solid mural component or internal vascularity, in keeping with a complicated cyst, BI-RADS 3. | Complicated breast cyst, BI-RADS 3. |
| Breast Abscess / Mastitis | No | A heterogeneous, predominantly hypoechoic collection with internal debris, septations, and surrounding hyperaemic, oedematous parenchyma is noted, in keeping with a breast abscess with associated mastitis. | Breast abscess with mastitis. |
| Suspicious Axillary Lymph Node | Yes | An enlarged {side} axillary lymph node is noted, measuring approximately {size} mm, showing {feature}. | {side} axillary lymphadenopathy — {feature}. |

Structured Finding Assistant question sets for this study:

- **Solid Breast Lesion**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `shape` — Shape, type: select, optional, default: `oval` (options: oval, round, irregular)
  - `size` — Size (mm), type: text, optional, default: ``
  - `birads` — BI-RADS category, type: select, required, default: `3` (options: 2, 3, 4, 5)
- **Suspicious Axillary Lymph Node**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `size` — Size (mm), type: text, optional, default: ``
  - `feature` — Morphology, type: select, optional, default: `preserved fatty hilum, uniform thin cortex (reactive)` (options: preserved fatty hilum, uniform thin cortex (reactive), eccentric cortical thickening with loss of fatty hilum (suspicious))

#### Clinical History Chips

- **Breast lump** — inserts: "Palpable breast lump."
- **Nipple discharge** — inserts: "Nipple discharge."
- **Breast pain (mastalgia)** — inserts: "Breast pain (mastalgia)."

#### Protocol

- **Protocol name:** USG Breast

- **Technique:** Real-time grey-scale and colour Doppler ultrasound of both breasts and axillae was performed using a high-frequency linear probe.

- **Default recommendation text:** Routine screening interval as clinically advised.

#### Impression Philosophy

Lead with laterality and BI-RADS category for the dominant lesion; explicitly state axillary nodal status; distinguish a simple from a complicated/complex cyst since management differs.

#### Recommendation Philosophy

BI-RADS 2 → routine screening interval; BI-RADS 3 → short-interval follow-up ultrasound, typically at 6 months; BI-RADS 4/5 → image-guided core needle biopsy.

#### Follow-up Philosophy

A BI-RADS 3 lesion is conventionally followed at 6 months, 12 months, and 24 months with unilateral (or bilateral, per protocol) ultrasound; upgrade to biopsy if it enlarges or develops suspicious features on any follow-up.

#### Copilot Behaviour

Prompt for a BI-RADS category whenever a mass/cyst finding is used without one selected; remind to state laterality and axillary status; flag a BI-RADS 4/5 finding used without a biopsy recommendation in the Recommendation section.

#### Structured Finding Assistant Logic

Solid Breast Lesion and Suspicious Axillary Lymph Node use the {key}/questions_json Structured Finding Assistant to capture side, morphology, size, and BI-RADS/nodal-feature consistently; Simple/Complicated Breast Cyst and Breast Abscess remain free-text since each is a single characteristic sonographic pattern.

#### Critical Findings

- BI-RADS 5 mass
- New solid mass with skin thickening, nipple retraction, or a suspicious axillary node
- Rapidly enlarging mass in a lactating or postpartum patient (concern for inflammatory carcinoma vs. abscess)

#### Print Behaviour

The Impression states laterality and BI-RADS category in a single scannable line per lesion; axillary findings print as a separate line beneath the primary breast finding rather than being folded into it.


### Scrotum

**Tab name:** Scrotum

**Purpose:** Grey-scale and colour Doppler evaluation of scrotal pain, swelling, palpable lesion, or infertility workup — assessing testicular size, echotexture, and vascularity, the epididymis, and excluding torsion, varicocele, or hydrocele.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Technique
- Findings
- Impression

#### Optional Sections

- Measurements
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Right testicular volume | mL | 12-19 mL (adult) | Yes | `Right testicular volume: {value} mL.` |
| Left testicular volume | mL | 12-19 mL (adult) | Yes | `Left testicular volume: {value} mL.` |
| Epididymal head size | mm | < 12 mm | No | `Epididymal head size: {value} mm.` |

**Required measurements:** Right testicular volume, Left testicular volume

**Optional measurements:** Epididymal head size

#### Normal Template

> Both testes are normal in size, outline, and echotexture with symmetric vascularity on colour Doppler. Both epididymes are normal. No hydrocele or varicocele. No testicular mass, microlithiasis, or epididymal cystic lesion.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Varicocele | Yes | Dilated, tortuous veins of the pampiniform plexus are noted in the {side} hemiscrotum, showing reversal of flow with Valsalva, in keeping with a Grade {grade} varicocele. | {side} Grade {grade} varicocele. |
| Hydrocele | No | Anechoic fluid collection is noted around the testis within the tunica vaginalis. | Hydrocele. |
| Epididymo-orchitis | No | Epididymis and testis show increased size with increased vascularity on colour Doppler, in keeping with epididymo-orchitis. | Epididymo-orchitis. |
| Testicular Microlithiasis | No | Multiple, non-shadowing echogenic foci, each less than 3 mm, are scattered diffusely throughout the testicular parenchyma bilaterally, in keeping with testicular microlithiasis. | Bilateral testicular microlithiasis. |
| Epididymal Cyst / Spermatocele | No | A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the epididymal head, showing no internal vascularity, in keeping with an epididymal cyst/spermatocele. | Epididymal cyst (spermatocele). |
| Testicular Torsion | Yes | The {side} testis is enlarged and heterogeneous in echotexture with {flow} intratesticular vascularity on colour Doppler compared with the contralateral side, and a whirlpool sign is noted at the spermatic cord — findings concerning for testicular torsion. | CRITICAL — sonographic findings concerning for {side} testicular torsion; immediate urological correlation advised. |

Structured Finding Assistant question sets for this study:

- **Varicocele**:
  - `side` — Side, type: select, required, default: `left` (options: right, left, bilateral)
  - `grade` — Grade, type: select, optional, default: `II` (options: I, II, III)
- **Testicular Torsion**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `flow` — Vascularity, type: select, required, default: `absent` (options: absent, markedly reduced)

#### Clinical History Chips

- **Scrotal swelling** — inserts: "Scrotal swelling."
- **Acute scrotal pain** — inserts: "Acute scrotal pain."
- **Infertility workup** — inserts: "Infertility workup."

#### Protocol

- **Protocol name:** USG Scrotum

- **Technique:** Real-time grey-scale and colour Doppler ultrasound of the scrotum was performed using a high-frequency linear probe.

- **Default recommendation text:** Please correlate with clinical findings.

#### Impression Philosophy

State testicular size symmetry and vascularity comparison first (especially for acute pain), then laterality/grade of any varicocele, and explicitly confirm or exclude torsion when the clinical history is acute scrotal pain.

#### Recommendation Philosophy

Suspected torsion is a surgical emergency and should be flagged for immediate urological correlation rather than routine follow-up; isolated microlithiasis needs no further imaging unless additional risk factors (cryptorchidism, infertility, personal/family history of germ cell tumour) are present, in which case periodic clinical self-examination ± surveillance ultrasound is reasonable.

#### Follow-up Philosophy

Varicocele, hydrocele, and epididymal cysts are followed clinically rather than by routine repeat ultrasound unless symptoms change; a testicular mass or torsion-concerning finding is not deferred for follow-up imaging — it is escalated immediately.

#### Copilot Behaviour

Require an explicit vascularity-comparison statement whenever the clinical history includes acute scrotal pain; remind to grade a described varicocele; flag a torsion-pattern finding used without an accompanying urgent-referral recommendation.

#### Structured Finding Assistant Logic

Varicocele and Testicular Torsion use the {key}/questions_json Structured Finding Assistant to capture side plus grade/vascularity consistently; Hydrocele, Epididymo-orchitis, Microlithiasis, and Epididymal Cyst remain free-text since each is a single characteristic sonographic pattern without a graded variable.

#### Critical Findings

- Testicular torsion (absent/reduced flow, whirlpool sign) — surgical emergency
- Testicular mass suspicious for malignancy
- Fournier's gangrene / gas within the scrotal wall

#### Print Behaviour

A CRITICAL-flagged finding (torsion) prints in its full wording at the top of the Impression, ahead of any incidental findings, so it cannot be buried under routine content.


### Neck

**Tab name:** Neck

**Purpose:** Grey-scale and colour Doppler evaluation of a palpable neck swelling, cervical lymphadenopathy, or non-thyroid neck mass — distinguishing nodal, salivary gland, and congenital (branchial cleft/thyroglossal duct) causes. Complements the Thyroid tab, which is used when the swelling is clearly thyroidal.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Technique
- Findings
- Impression

#### Optional Sections

- Measurements
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Lymph node short-axis diameter | mm | < 10 mm (level II); generally < 8 mm elsewhere | No | `Lymph node short-axis: {value} mm.` |
| Cortical thickness | mm | < 3 mm, uniform | No | `Cortical thickness: {value} mm.` |
| Submandibular gland size | mm | Approximately 30 x 15 x 15 mm, symmetric | No | `Submandibular gland size: {value} mm.` |
| Parotid gland size | mm | Approximately 50 x 30 x 15 mm, symmetric | No | `Parotid gland size: {value} mm.` |

**Required measurements:** _None_

**Optional measurements:** Lymph node short-axis diameter, Cortical thickness, Submandibular gland size, Parotid gland size

#### Normal Template

> Bilateral cervical lymph node levels I through VI show no pathologically enlarged or morphologically abnormal lymph node — a few small nodes with preserved fatty hilum are within normal limits. Both parotid and submandibular glands are normal in size and echotexture with no calculus, ductal dilatation, or focal mass. No cystic or solid neck mass is identified. Major cervical vascular structures are patent.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Reactive Cervical Lymphadenopathy | Yes | Multiple mildly enlarged, oval, {side} level {level} cervical lymph nodes are noted, up to {size} mm in short axis, each with a preserved echogenic fatty hilum and normal flattened shape — reactive in nature. | {side} level {level} reactive cervical lymphadenopathy. |
| Suspicious Cervical Lymph Node | Yes | A rounded {side} level {level} cervical lymph node is noted, measuring approximately {size} mm in short axis, with loss of the normal fatty hilum, eccentric cortical thickening, and increased peripheral/mixed vascularity on colour Doppler — suspicious for metastatic or lymphomatous involvement. | CRITICAL — {side} level {level} cervical lymph node suspicious for malignant involvement; clinical correlation ± FNAC advised. |
| Sialolithiasis | Yes | An echogenic focus with posterior acoustic shadowing is noted within the {side} {gland} gland, with mild upstream ductal dilatation, in keeping with sialolithiasis. | {side} {gland} sialolithiasis. |
| Sialadenitis | No | The gland is diffusely enlarged and hypoechoic with increased vascularity on colour Doppler, without a discrete calculus or ductal dilatation, in keeping with acute sialadenitis. | Sialadenitis. |
| Branchial Cleft Cyst | No | A well-defined, thin-walled anechoic to low-level-echo cystic lesion is noted along the anterior border of the sternocleidomastoid muscle, deep to the angle of the mandible, without significant internal vascularity, in keeping with a second branchial cleft cyst. | Branchial cleft cyst. |
| Thyroglossal Duct Cyst | No | A well-defined anechoic to hypoechoic midline cystic lesion is noted anterior to the strap muscles at the level of the hyoid bone, which moves with tongue protrusion/swallowing, in keeping with a thyroglossal duct cyst. | Thyroglossal duct cyst. |

Structured Finding Assistant question sets for this study:

- **Reactive Cervical Lymphadenopathy**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `level` — Nodal level, type: select, optional, default: `II` (options: I, II, III, IV, V, VI)
  - `size` — Size (mm, short axis), type: text, optional, default: ``
- **Suspicious Cervical Lymph Node**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `level` — Nodal level, type: select, optional, default: `III` (options: I, II, III, IV, V, VI)
  - `size` — Size (mm, short axis), type: text, optional, default: ``
- **Sialolithiasis**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `gland` — Gland, type: select, required, default: `submandibular` (options: submandibular, parotid)

#### Clinical History Chips

- **Neck swelling** — inserts: "Neck swelling."
- **Neck pain** — inserts: "Neck pain."
- **Recent sore throat / URI** — inserts: "Recent sore throat / upper respiratory tract infection."

#### Protocol

- **Protocol name:** USG Neck

- **Technique:** Real-time grey-scale and colour Doppler ultrasound of the neck was performed using a high-frequency linear probe, systematically surveying the bilateral cervical lymph node levels (I-VI) and the parotid and submandibular salivary glands.

- **Default recommendation text:** Please correlate with clinical findings; FNAC/biopsy as clinically indicated for a suspicious lymph node or mass.

#### Impression Philosophy

Distinguish nodal, salivary-glandular, and congenital cystic etiology explicitly; state laterality and nodal level for any lymph node finding; carry a suspicious morphology forward into the Impression verbatim, not paraphrased.

#### Recommendation Philosophy

A reactive node prompts clinical correlation and treatment of the underlying cause with repeat ultrasound only if it persists beyond 4-6 weeks; a suspicious node prompts FNAC/core biopsy and a search for a primary site (thyroid, oropharynx, skin) if a metastatic pattern is suspected; a congenital cystic mass prompts surgical referral, especially if infected or recurrent.

#### Follow-up Philosophy

Reactive lymphadenopathy that resolves clinically needs no imaging follow-up; a persistent or enlarging node beyond 4-6 weeks warrants repeat ultrasound with consideration of FNAC rather than open-ended observation.

#### Copilot Behaviour

Remind to state cervical lymph node level and laterality whenever a node finding is used; flag a 'suspicious' morphology (loss of hilum, rounded shape, cortical thickening) described without an explicit FNAC/biopsy recommendation; remind to consider a congenital cystic mass in a young patient with a lateral or midline neck cyst.

#### Structured Finding Assistant Logic

Reactive Cervical Lymphadenopathy, Suspicious Cervical Lymph Node, and Sialolithiasis use the {key}/questions_json Structured Finding Assistant to capture side/level/size (nodes) or side/gland (calculus) consistently; Sialadenitis, Branchial Cleft Cyst, and Thyroglossal Duct Cyst remain free-text since their sonographic description is characteristic and does not vary by a small discrete variable set.

#### Critical Findings

- Cervical lymph node suspicious for malignancy (loss of hilum, rounded shape, cortical thickening, abnormal vascularity)
- Rapidly enlarging neck mass with airway compromise
- Suppurative lymphadenitis/abscess with impending airway or vascular compromise

#### Print Behaviour

The Impression groups findings by nodal level and side so a clinician can map directly to the physical exam; a Suspicious Cervical Lymph Node's CRITICAL tag is preserved verbatim into the printed Impression rather than silently trimmed.


### MSK

**Tab name:** MSK

**Purpose:** Grey-scale, dynamic real-time, and colour Doppler evaluation of tendon, joint, ligament, and peripheral nerve pathology at the common musculoskeletal sites — shoulder/rotator cuff, knee, ankle/Achilles, and wrist/carpal tunnel — for pain, swelling, weakness, or a suspected tear or entrapment.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Clinical History
- Technique
- Findings
- Impression

#### Optional Sections

- Measurements
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Supraspinatus tendon thickness | mm | 5-6 mm, uniform | No | `Supraspinatus tendon thickness: {value} mm.` |
| Achilles tendon thickness (AP, mid-substance) | mm | < 6 mm | No | `Achilles tendon thickness: {value} mm.` |
| Median nerve cross-sectional area (carpal tunnel inlet) | mm2 | < 9-10 mm2 | No | `Median nerve CSA: {value} mm2.` |
| Joint effusion depth (maximal) | mm | < 2-3 mm at rest (e.g. knee suprapatellar recess) | No | `Maximal effusion depth: {value} mm.` |

**Required measurements:** _None_

**Optional measurements:** Supraspinatus tendon thickness, Achilles tendon thickness (AP, mid-substance), Median nerve cross-sectional area (carpal tunnel inlet), Joint effusion depth (maximal)

#### Normal Template

> The examined tendon(s) show normal thickness and fibrillar echotexture with no discontinuity, tear, or significant peritendinous fluid. The adjacent joint recess shows no pathological effusion or synovial thickening. Visualised ligaments are intact with normal fibrillar architecture. Where assessed, the peripheral nerve is normal in calibre and echotexture with no focal entrapment. No soft-tissue mass or collection is identified.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Rotator Cuff Tear | Yes | A {tearType} tear of the {side} supraspinatus tendon is noted, with a defect measuring approximately {size} mm and associated tendon retraction/discontinuity. | {side} supraspinatus {tearType} tear. |
| Supraspinatus Tendinopathy | No | The supraspinatus tendon is diffusely thickened and hypoechoic with loss of the normal fibrillar echotexture, without a discrete focal tear, in keeping with tendinopathy. | Supraspinatus tendinopathy. |
| Achilles Tendinopathy / Partial Tear | Yes | The {side} Achilles tendon is thickened and hypoechoic with loss of the normal fibrillar pattern, in keeping with {severity}. No full-thickness discontinuity is identified. | {side} Achilles {severity}. |
| Ankle Ligament Injury (ATFL) | Yes | The {side} anterior talofibular ligament (ATFL) is thickened and hypoechoic, in keeping with {grade}, with associated anterolateral ankle joint effusion. | {side} ATFL injury — {grade}. |
| Knee Joint Effusion | Yes | Anechoic fluid is noted within the {side} suprapatellar recess, {quantity} in quantity, with no significant synovial thickening or intra-articular loose body. | {side} {quantity} knee joint effusion. |
| Carpal Tunnel Syndrome | Yes | The {side} median nerve is swollen and hypoechoic at the level of the carpal tunnel inlet, measuring approximately {csa} mm2 in cross-sectional area, with flattening of the nerve at the tunnel outlet, in keeping with median nerve entrapment (carpal tunnel syndrome). | {side} carpal tunnel syndrome (median nerve entrapment). |

Structured Finding Assistant question sets for this study:

- **Rotator Cuff Tear**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `tearType` — Tear type, type: select, required, default: `full-thickness` (options: partial-thickness (articular surface), partial-thickness (bursal surface), full-thickness)
  - `size` — Defect size (mm), type: text, optional, default: ``
- **Achilles Tendinopathy / Partial Tear**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `severity` — Severity, type: select, required, default: `tendinosis (fusiform thickening, no discrete tear)` (options: tendinosis (fusiform thickening, no discrete tear), partial-thickness tear)
- **Ankle Ligament Injury (ATFL)**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `grade` — Grade, type: select, required, default: `Grade I (sprain, no discontinuity)` (options: Grade I (sprain, no discontinuity), Grade II (partial tear), Grade III (complete tear))
- **Knee Joint Effusion**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `quantity` — Quantity, type: select, required, default: `mild` (options: mild, moderate, gross)
- **Carpal Tunnel Syndrome**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `csa` — Median nerve CSA (mm2), type: text, optional, default: ``

#### Clinical History Chips

- **Shoulder pain (suspected rotator cuff injury)** — inserts: "Shoulder pain, suspected rotator cuff injury."
- **Ankle pain / sprain** — inserts: "Ankle pain following inversion sprain."
- **Wrist pain / paresthesia (suspected carpal tunnel)** — inserts: "Wrist pain with paresthesia, suspected carpal tunnel syndrome."

#### Protocol

- **Protocol name:** USG Musculoskeletal

- **Technique:** Real-time, dynamic grey-scale ultrasound (with colour Doppler where indicated) of the clinically indicated site — shoulder/rotator cuff, knee, ankle, or wrist — was performed using a high-frequency linear probe, including dynamic manoeuvres and side-to-side comparison with the contralateral limb where relevant.

- **Default recommendation text:** Please correlate with clinical examination and site-specific physical tests; MRI is recommended for further characterisation of an equivocal or full-thickness tear where clinically indicated.

#### Impression Philosophy

State the anatomical site and side first, then the specific structure (tendon/ligament/nerve/joint) and severity/grade of the abnormality; explicitly distinguish partial from full-thickness tear and grade a ligament injury, since management differs materially.

#### Recommendation Philosophy

Correlate with clinical exam and mechanism of injury; a full-thickness tendon tear or Grade III ligament tear typically merits orthopaedic referral ± MRI for surgical planning; tendinopathy and Grade I sprains are typically managed conservatively (rest, physiotherapy, NSAIDs) with clinical follow-up rather than routine repeat imaging.

#### Follow-up Philosophy

Routine imaging follow-up is not required for tendinopathy or a Grade I ligament sprain that improves clinically; a full-thickness tear, an equivocal partial tear, or persistent/worsening symptoms despite conservative management warrant MRI or orthopaedic referral rather than a repeat ultrasound alone.

#### Copilot Behaviour

Prompt for the specific tendon/ligament/nerve/joint examined and side whenever a structured MSK finding is used; remind to state partial vs. full-thickness for any tendon tear and a numeric grade for any ligament injury; flag when 'pain' is the sole clinical history with no site specified, since MSK USG requires a site-directed clinical question.

#### Structured Finding Assistant Logic

Rotator Cuff Tear, Achilles Tendinopathy/Partial Tear, Ankle Ligament Injury, Knee Joint Effusion, and Carpal Tunnel Syndrome all use the {key}/questions_json Structured Finding Assistant to capture side plus the specific severity/grade/quantity variable that drives the impression; Supraspinatus Tendinopathy remains free-text since it is a single characteristic diffuse pattern without a discrete graded variable.

#### Critical Findings

- Full-thickness rotator cuff tear with retraction
- Achilles tendon full-thickness rupture (discontinuity with gap)
- Grade III (complete) ligament tear with gross instability
- Suspected septic joint effusion (turbid fluid with clinical fever/erythema — recommend urgent aspiration)

#### Print Behaviour

The Impression states site + side + structure + severity in a single scannable line per finding (e.g. 'Right supraspinatus full-thickness tear'); Measurements print only the values actually captured for the examined site rather than a fixed universal MSK panel, since all four defined measurements are site-specific and not all apply to any one study.


---

## Doppler

### Carotid Doppler

**Tab name:** Carotid Doppler

**Purpose:** Extracranial carotid duplex evaluates the common, internal, and external carotid arteries and vertebral arteries for atherosclerotic plaque, intima-media thickness, and stenosis severity by validated velocity criteria — used in stroke/TIA workup, asymptomatic bruit evaluation, and pre-cardiac-surgery screening.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Measurements
- Impression

#### Optional Sections

- Clinical History
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| CCA IMT (Right) | mm | <0.9 mm age-adjusted (≥1.5 mm or focal thickening ≥0.5 mm/50% of surrounding IMT defines plaque) | Yes | `Right common carotid artery intima-media thickness: {value} mm.` |
| CCA IMT (Left) | mm | <0.9 mm age-adjusted (≥1.5 mm or focal thickening ≥0.5 mm/50% of surrounding IMT defines plaque) | Yes | `Left common carotid artery intima-media thickness: {value} mm.` |
| ICA PSV (Right) | cm/s | <125 cm/s | Yes | `Right internal carotid artery peak systolic velocity: {value} cm/s.` |
| ICA PSV (Left) | cm/s | <125 cm/s | Yes | `Left internal carotid artery peak systolic velocity: {value} cm/s.` |
| ICA/CCA PSV Ratio | ratio | <2.0 | No | `ICA/CCA peak systolic velocity ratio: {value}.` |

**Required measurements:** CCA IMT (Right), CCA IMT (Left), ICA PSV (Right), ICA PSV (Left)

**Optional measurements:** ICA/CCA PSV Ratio

#### Normal Template

> Both common, internal, and external carotid arteries and both vertebral arteries show normal calibre with smooth intimal surfaces and no significant atherosclerotic plaque. Carotid intima-media thickness is within normal limits bilaterally. Colour and spectral Doppler show a normal low-resistance waveform in the internal carotid arteries and a normal high-resistance waveform in the external carotid arteries, with antegrade flow in both vertebral arteries. Peak systolic velocities are within normal limits with no evidence of haemodynamically significant stenosis. No evidence of dissection or occlusion.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Carotid Study | No | Both common, internal, and external carotid arteries and both vertebral arteries show normal calibre with smooth intimal surfaces and no significant atherosclerotic plaque. Carotid intima-media thickness is within normal limits bilaterally. Peak systolic velocities are within normal limits with no evidence of haemodynamically significant stenosis. | Normal carotid Doppler study. No haemodynamically significant carotid stenosis. |
| Carotid Plaque | Yes | A {morphology} atherosclerotic plaque with a {surface} surface is noted at the {side} {location}, causing non-flow-limiting luminal narrowing with ICA peak systolic velocity within normal limits. | {side} {location} carotid plaque ({morphology}) without haemodynamically significant stenosis. |
| ICA Stenosis (Velocity-Graded) | Yes | {side} internal carotid artery shows an atherosclerotic plaque causing luminal narrowing, with ICA PSV of {psv} cm/s and an ICA/CCA ratio of {ratio}, in keeping with {grade} stenosis by velocity criteria (NASCET/SRU consensus). | {side} ICA stenosis, {grade} by velocity criteria. |
| Elevated IMT | No | Carotid intima-media thickness is diffusely increased bilaterally, without discrete focal plaque, in keeping with early atherosclerotic change. | Bilateral carotid intima-media thickening — increased cardiovascular risk marker. |
| Vertebral Artery Flow Reversal | Yes | The {side} vertebral artery shows reversed (retrograde) flow directed away from the brainstem, in keeping with subclavian steal physiology. | {side} vertebral artery flow reversal — subclavian steal. |
| Carotid Occlusion | Yes | The {side} {vessel} shows no colour or spectral flow with echogenic intraluminal material filling the lumen, in keeping with complete occlusion. | {side} {vessel} occlusion. |

Structured Finding Assistant question sets for this study:

- **Carotid Plaque**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `location` — Location, type: select, optional, default: `carotid bulb` (options: carotid bulb, proximal ICA, CCA, ECA)
  - `morphology` — Morphology, type: select, optional, default: `heterogeneous mixed` (options: homogeneous echolucent (soft), heterogeneous mixed, densely calcified)
  - `surface` — Surface, type: select, optional, default: `smooth` (options: smooth, irregular, ulcerated)
- **ICA Stenosis (Velocity-Graded)**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `grade` — Grade, type: select, required, default: `50-69%` (options: <50%, 50-69%, 70-99% (severe), near-occlusion, total occlusion)
  - `psv` — ICA PSV (cm/s), type: text, optional, default: ``
  - `ratio` — ICA/CCA Ratio, type: text, optional, default: ``
- **Vertebral Artery Flow Reversal**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
- **Carotid Occlusion**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `vessel` — Vessel, type: select, optional, default: `ICA` (options: ICA, CCA)

#### Clinical History Chips

- **Stroke/TIA** — inserts: "Acute stroke / TIA — carotid territory evaluation."
- **Carotid bruit** — inserts: "Carotid bruit on auscultation."
- **Pre-CABG screening** — inserts: "Pre-operative carotid screening prior to cardiac surgery."

#### Protocol

- **Protocol name:** USG Carotid Doppler

- **Technique:** Grey-scale, colour, and spectral Doppler ultrasound of both common, internal, and external carotid arteries and both vertebral arteries was performed using a high-frequency linear probe, with PSV/EDV sampling at the CCA, carotid bulb, and proximal ICA.

- **Default recommendation text:** Please correlate with clinical findings and cardiovascular risk factors.

#### Impression Philosophy

Stenosis grading by NASCET-derived ICA PSV/ICA-CCA ratio thresholds is the operative sentence; plaque morphology and surface character are stated as secondary risk descriptors, not as the primary grading basis.

#### Recommendation Philosophy

≥50% stenosis in a symptomatic patient or ≥70% in an asymptomatic patient is worded to prompt vascular surgery/neurology referral; ulcerated or heterogeneous plaque morphology is noted as an additional risk descriptor even below the flow-limiting threshold.

#### Follow-up Philosophy

Annual surveillance duplex is conventional for <50% plaque, 6-monthly for 50-69% stenosis, and prompt referral (not routine ultrasound follow-up) for ≥70% or symptomatic disease.

#### Copilot Behaviour

Flags when ICA PSV is stated without a paired ICA/CCA ratio or EDV — both are needed to resolve borderline 50% vs 70% grading under SRU consensus criteria — and flags when a stenosis-grade quick finding is used without a matching PSV value entered in Measurements.

#### Structured Finding Assistant Logic

ICA Stenosis, Carotid Plaque, Vertebral Artery Flow Reversal, and Carotid Occlusion use the question-tree because grade/side/morphology are categorical, mutually exclusive, and drive materially different impression sentences and follow-up intervals — free text risks an ungraded, unusable plaque description.

#### Critical Findings

- Bilateral or dominant-hemisphere severe (70-99%) ICA stenosis
- Free-floating intraluminal thrombus
- Fresh occlusion of a previously patent ICA
- Carotid dissection with intramural haematoma/flap

#### Print Behaviour

Prints with the bilateral measurement pairs (CCA IMT, ICA PSV) tabulated side-by-side R/L, plaque and stenosis quick findings grouped under Findings by vessel, and the velocity-criteria grade carried verbatim into the Impression's operative sentence.


### Venous Doppler

**Tab name:** Venous Doppler

**Purpose:** Duplex venous evaluation of the lower or upper limb for deep vein thrombosis (acute vs chronic), venous compressibility and augmentation, and superficial venous reflux in varicose vein disease.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Impression

#### Optional Sections

- Clinical History
- Measurements
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Reflux Duration (GSV) | sec | <0.5 sec (>0.5 sec = pathological reflux) | No | `Great saphenous vein reflux duration: {value} sec.` |
| Reflux Duration (SSV) | sec | <0.5 sec (>0.5 sec = pathological reflux) | No | `Small saphenous vein reflux duration: {value} sec.` |
| Common Femoral Vein Diameter | mm | 8-12 mm (non-diagnostic alone; assessed alongside compressibility) | No | `Common femoral vein diameter: {value} mm.` |

**Required measurements:** _None_

**Optional measurements:** Reflux Duration (GSV), Reflux Duration (SSV), Common Femoral Vein Diameter

#### Normal Template

> The common femoral, femoral, popliteal, and calf veins (posterior tibial and peroneal) are normal in calibre, fully compressible with the transducer, and show no intraluminal echoes. Normal phasic flow with respiration and augmentation on calf compression is demonstrated. The great and small saphenous veins are competent with no pathological reflux on Valsalva/calf compression. No evidence of deep or superficial venous thrombosis.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Venous Study | No | The common femoral, femoral, popliteal, and calf veins are normal in calibre, fully compressible, and show normal phasic flow and augmentation. The great and small saphenous veins are competent with no pathological reflux. | No evidence of deep vein thrombosis. Competent superficial venous system. |
| Acute DVT | Yes | The {side} {segment} is non-compressible and distended with echogenic intraluminal thrombus, {morphology}, in keeping with acute deep vein thrombosis. | Acute DVT involving the {side} {segment} ({morphology}). |
| Chronic DVT | Yes | The {side} {segment} shows a partially compressible, thickened, echogenic wall with recanalised flow and collateral venous channels, in keeping with chronic (post-thrombotic) changes. | Chronic post-thrombotic changes in the {side} {segment}. |
| Superficial Venous Reflux (Varicose Veins) | Yes | The {side} {vein} is dilated and tortuous with reflux duration exceeding 0.5 seconds on Valsalva and calf compression, in keeping with superficial venous incompetence. | {side} {vein} incompetence with varicose veins. |
| Superficial Thrombophlebitis | Yes | A segment of the superficial venous system in the {side} limb is non-compressible with echogenic thrombus and surrounding hyperaemia, in keeping with superficial thrombophlebitis. The deep venous system is patent. | {side} superficial thrombophlebitis. Deep veins patent. |

Structured Finding Assistant question sets for this study:

- **Acute DVT**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `segment` — Segment, type: select, required, default: `femoral vein` (options: common femoral vein, femoral vein, popliteal vein, calf veins (posterior tibial/peroneal))
  - `morphology` — Thrombus morphology, type: select, required, default: `occlusive with absent flow throughout` (options: occlusive with absent flow throughout, non-occlusive with a mobile free-floating component and preserved peripheral flow — embolisation risk)
- **Chronic DVT**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `segment` — Segment, type: select, required, default: `femoral vein` (options: common femoral vein, femoral vein, popliteal vein, calf veins (posterior tibial/peroneal))
- **Superficial Venous Reflux (Varicose Veins)**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `vein` — Vein, type: select, optional, default: `great saphenous vein` (options: great saphenous vein, small saphenous vein, perforator vein)
- **Superficial Thrombophlebitis**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)

#### Clinical History Chips

- **Calf swelling/pain** — inserts: "Unilateral calf swelling and pain — rule out DVT."
- **Post-op DVT screening** — inserts: "Post-operative deep vein thrombosis screening."
- **Varicose veins** — inserts: "Varicose veins — reflux mapping."

#### Protocol

- **Protocol name:** USG Venous Doppler

- **Technique:** Grey-scale, colour, and spectral Doppler ultrasound of the deep and superficial veins of the indicated limb was performed with graded compression at 2 cm intervals from the common femoral (or subclavian/axillary for upper limb) vein to the calf veins, with augmentation manoeuvres.

- **Default recommendation text:** Please correlate with clinical findings. Anticoagulation decisions to be individualised by the treating clinician.

#### Impression Philosophy

Compressibility is the primary diagnostic criterion for DVT — a non-compressible segment is diagnostic regardless of colour flow. Acute vs chronic distinction rests on thrombus echogenicity, vein diameter, and wall changes, and is stated explicitly because management differs.

#### Recommendation Philosophy

Acute DVT is worded to prompt same-day clinical communication given the anticoagulation and pulmonary-embolism-risk implications; chronic changes and superficial reflux carry routine follow-up language only.

#### Follow-up Philosophy

Acute DVT on anticoagulation is conventionally reimaged at around 3 months to establish a new chronic baseline; superficial reflux is followed per vascular surgery/phlebology referral, not by a routine ultrasound interval.

#### Copilot Behaviour

For any DVT-positive quick finding, prompts to confirm compressibility was explicitly assessed (not flow alone) and flags if the phrase 'non-compressible' is absent from the findings text despite a positive DVT impression; flags if acute/chronic character is left unstated when a thrombus finding is selected; and flags when a non-occlusive/free-floating thrombus morphology is selected to confirm the embolisation-risk language is reflected in the impression.

#### Structured Finding Assistant Logic

Acute DVT, Chronic DVT, Superficial Venous Reflux, and Superficial Thrombophlebitis use the question-tree so side, segment/vein, and (for Acute DVT) thrombus morphology are captured as discrete, unambiguous fields driving distinct impression sentences — DVT location and free-floating/embolisation risk materially change management (calf-vein-only DVT is managed differently from femoropopliteal DVT, and a free-floating thrombus changes urgency).

#### Critical Findings

- Acute proximal (femoropopliteal or common femoral) DVT
- Free-floating/non-occlusive thrombus with embolisation risk
- Bilateral extensive DVT suggesting IVC or pelvic vein obstruction

#### Print Behaviour

DVT quick findings print with the segment named explicitly in both Findings and Impression (never a bare 'DVT present'), and acute/chronic character is always carried into the Impression sentence verbatim.


### Arterial Doppler

**Tab name:** Arterial Doppler

**Purpose:** Duplex evaluation of the limb peripheral arterial tree for stenosis/occlusion in peripheral arterial disease workup — waveform morphology, segmental PSV, and ankle-brachial index (ABI) to localise and grade disease.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Measurements
- Impression

#### Optional Sections

- Clinical History
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| PSV (Stenosis Site) | cm/s | graded by ratio to the proximal segment (<2.0 normal) | No | `Peak systolic velocity at the stenosis site: {value} cm/s.` |
| ABI - Right | ratio | 1.00-1.40 normal (0.91-0.99 borderline; ≤0.90 PAD; >1.40 non-compressible/calcified) | Yes | `Right ankle-brachial index: {value}.` |
| ABI - Left | ratio | 1.00-1.40 normal (0.91-0.99 borderline; ≤0.90 PAD; >1.40 non-compressible/calcified) | Yes | `Left ankle-brachial index: {value}.` |
| Velocity Ratio (Stenosis/Proximal) | ratio | <2.0 normal; ≥2.0 suggests ≥50% stenosis | No | `Velocity ratio across the stenosis: {value}.` |

**Required measurements:** ABI - Right, ABI - Left

**Optional measurements:** PSV (Stenosis Site), Velocity Ratio (Stenosis/Proximal)

#### Normal Template

> The common femoral, superficial femoral, popliteal, and infrapopliteal (anterior tibial, posterior tibial, peroneal) arteries are normal in calibre with a normal triphasic waveform and no significant atherosclerotic plaque or stenosis throughout. Ankle-brachial index is within normal limits bilaterally. No evidence of haemodynamically significant peripheral arterial disease.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Arterial Study | No | The common femoral, superficial femoral, popliteal, and infrapopliteal arteries are normal in calibre with a normal triphasic waveform and no significant plaque or stenosis. Ankle-brachial index is within normal limits. | Normal peripheral arterial Doppler study. No haemodynamically significant stenosis. ABI within normal limits. |
| Arterial Stenosis | Yes | The {side} {vessel} shows an atherosclerotic plaque with focal velocity elevation and post-stenotic turbulence, in keeping with {grade} stenosis. | {side} {vessel} stenosis, {grade}. |
| Arterial Occlusion | Yes | The {side} {vessel} shows no colour or spectral flow throughout a segment measuring approximately {length} cm, {collaterals}, in keeping with occlusion. | {side} {vessel} occlusion, approximately {length} cm in length — {collaterals}. |
| Monophasic Waveform | Yes | The {side} {vessel} shows a dampened monophasic waveform with loss of the normal triphasic pattern, in keeping with proximal inflow disease. | Monophasic {side} {vessel} waveform — proximal inflow disease. |
| Pseudoaneurysm | Yes | A well-defined anechoic sac is noted adjacent to the {side} {vessel} with a visible neck showing to-and-fro ('yin-yang') flow on colour Doppler, in keeping with a pseudoaneurysm. | {side} {vessel} pseudoaneurysm. |
| Popliteal Artery Aneurysm | Yes | The {side} popliteal artery is aneurysmally dilated, measuring approximately {size} mm in AP diameter, with mural thrombus. | {side} popliteal artery aneurysm, {size} mm. |

Structured Finding Assistant question sets for this study:

- **Arterial Stenosis**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `vessel` — Vessel, type: select, required, default: `superficial femoral artery` (options: common femoral artery, superficial femoral artery, popliteal artery, anterior tibial artery, posterior tibial artery, peroneal artery)
  - `grade` — Grade, type: select, required, default: `50-75%` (options: <50%, 50-75%, 76-99% (severe))
- **Arterial Occlusion**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `vessel` — Vessel, type: select, required, default: `superficial femoral artery` (options: common femoral artery, superficial femoral artery, popliteal artery, anterior tibial artery, posterior tibial artery, peroneal artery)
  - `length` — Occlusion length (cm), type: text, optional, default: ``
  - `collaterals` — Distal reconstitution, type: select, required, default: `with reconstitution distally via collaterals (subacute/chronic)` (options: with reconstitution distally via collaterals (subacute/chronic), without distal reconstitution (acute — urgent, limb-threatening))
- **Monophasic Waveform**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `vessel` — Vessel, type: select, optional, default: `common femoral artery` (options: common femoral artery, superficial femoral artery, popliteal artery)
- **Pseudoaneurysm**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `vessel` — Vessel, type: select, optional, default: `common femoral artery` (options: common femoral artery, superficial femoral artery, popliteal artery)
- **Popliteal Artery Aneurysm**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `size` — AP diameter (mm), type: text, optional, default: ``

#### Clinical History Chips

- **Claudication** — inserts: "Intermittent claudication."
- **Rest pain / non-healing ulcer** — inserts: "Rest pain / non-healing ulcer — critical limb ischaemia workup."
- **Diminished/absent pulses** — inserts: "Diminished or absent distal pulses on clinical examination."

#### Protocol

- **Protocol name:** USG Arterial Doppler

- **Technique:** Grey-scale, colour, and spectral Doppler ultrasound of the indicated limb arterial tree was performed from the common femoral (or subclavian/axillary for upper limb) artery to the pedal/digital vessels, with ankle-brachial index measured using a hand-held Doppler probe and sphygmomanometer.

- **Default recommendation text:** Please correlate with clinical findings and pulse examination.

#### Impression Philosophy

Waveform morphology (tri-/bi-/monophasic) and PSV velocity-ratio grading are combined — a monophasic waveform without a discrete stenosis site points to proximal inflow disease, while a focal velocity ratio ≥2.0 localises a culprit stenosis — both are stated because they answer different clinical questions (severity vs location).

#### Recommendation Philosophy

ABI ≤0.90, or a severe (76-99%) stenosis/occlusion with rest pain or tissue loss, is worded to prompt vascular surgery referral; an occlusion without distal collateral reconstitution is worded to prompt same-day/emergent referral given the acute-limb-ischaemia risk; ABI >1.40 (non-compressible, calcified vessels typical of diabetes/renal disease) is flagged as an unreliable index requiring toe-brachial index or CT angiography correlation.

#### Follow-up Philosophy

Stable claudicants with moderate disease are conventionally followed clinically with interval ABI; a new occlusion (especially without collateral reconstitution), pseudoaneurysm, or aneurysm is escalated rather than scheduled for routine surveillance.

#### Copilot Behaviour

Flags when a stenosis/occlusion quick finding is used without an ABI recorded in Measurements, flags when ABI exceeds 1.40 without a note on vessel calcification/non-compressibility (a known pitfall producing a spuriously normal-or-high ABI), and flags when an Occlusion finding is entered without distal collateral reconstitution selected, given its association with acute limb ischaemia requiring urgent escalation.

#### Structured Finding Assistant Logic

Arterial Stenosis, Occlusion, Monophasic Waveform, Pseudoaneurysm, and Popliteal Aneurysm use the question-tree because vessel/side/grade (and, for Occlusion, distal collateral reconstitution/acuity) are categorical and each combination drives a distinct, clinically load-bearing impression sentence that free text risks leaving incomplete, e.g. a stenosis without a stated grade or an occlusion without a stated acuity.

#### Critical Findings

- Acute limb ischaemia (abrupt occlusion with no collateral reconstitution)
- Expanding or ruptured pseudoaneurysm
- Popliteal aneurysm with mural thrombus at risk of distal embolisation
- ABI ≤0.40 (severe ischaemia)

#### Print Behaviour

ABI prints bilaterally as a paired R/L line directly under Measurements; any stenosis/occlusion finding carries its graded severity into the Impression's first sentence.


### Renal Doppler

**Tab name:** Renal Doppler

**Purpose:** Doppler evaluation of the main renal arteries and veins for renovascular hypertension (renal artery stenosis), renal vein/IVC thrombosis, and intrarenal resistive index in native or transplant kidney dysfunction.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Measurements
- Impression

#### Optional Sections

- Clinical History
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Main Renal Artery PSV (Right) | cm/s | <180 cm/s (renal artery stenosis suggested above this) | Yes | `Right main renal artery peak systolic velocity: {value} cm/s.` |
| Main Renal Artery PSV (Left) | cm/s | <180 cm/s (renal artery stenosis suggested above this) | Yes | `Left main renal artery peak systolic velocity: {value} cm/s.` |
| Renal-Aortic Ratio (RAR) | ratio | <3.5 (≥3.5 suggests ≥60% stenosis) | Yes | `Renal-aortic ratio: {value}.` |
| Intrarenal Resistive Index | ratio | 0.55-0.70 (>0.80 = elevated, poor prognostic marker) | No | `Intrarenal resistive index: {value}.` |
| Intrarenal Acceleration Time | ms | <70-100 ms (delayed/tardus-parvus suggests proximal stenosis) | No | `Intrarenal acceleration time: {value} ms.` |

**Required measurements:** Main Renal Artery PSV (Right), Main Renal Artery PSV (Left), Renal-Aortic Ratio (RAR)

**Optional measurements:** Intrarenal Resistive Index, Intrarenal Acceleration Time

#### Normal Template

> Both main renal arteries arise normally from the aorta and show a normal low-resistance waveform with peak systolic velocity within normal limits and a renal-aortic ratio less than 3.5, with no evidence of significant renal artery stenosis. Intrarenal arteries show normal tardus-parvus-free waveforms with resistive index within normal limits. Both renal veins and the IVC are patent with normal flow.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Renal Doppler | No | Both main renal arteries show a normal low-resistance waveform with PSV and renal-aortic ratio within normal limits. Intrarenal arteries show a normal waveform with resistive index within normal limits. Both renal veins are patent. | No sonographic evidence of renal artery stenosis. Renal veins patent. |
| Renal Artery Stenosis | Yes | The {side} main renal artery shows elevated peak systolic velocity with a renal-aortic ratio ≥3.5 and post-stenotic turbulence, in keeping with {grade} renal artery stenosis. | {side} renal artery stenosis, {grade}. |
| Tardus Parvus Waveform | Yes | Intrarenal arcuate and interlobar arteries on the {side} show a delayed systolic upstroke (prolonged acceleration time) and rounded (tardus-parvus) waveform, in keeping with a haemodynamically significant proximal renal artery stenosis. | {side} intrarenal tardus-parvus waveform, suggesting proximal renal artery stenosis. |
| Elevated Intrarenal Resistive Index | Yes | The {side} kidney shows an elevated intrarenal resistive index exceeding 0.80, in keeping with chronic parenchymal disease. | {side} elevated intrarenal resistive index — chronic renal parenchymal disease. |
| Renal Vein Thrombosis | Yes | The {side} renal vein is distended and non-compressible with echogenic intraluminal thrombus and absent flow on colour Doppler, in keeping with renal vein thrombosis. | {side} renal vein thrombosis. |
| Renal Artery Occlusion | Yes | No colour or spectral flow is demonstrated in the {side} main renal artery. The corresponding kidney is {kidney}, in keeping with {chronicity} renal artery occlusion. | {side} renal artery occlusion — {chronicity}, kidney {kidney}. |

Structured Finding Assistant question sets for this study:

- **Renal Artery Stenosis**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
  - `grade` — Grade, type: select, required, default: `≥60%` (options: <60%, ≥60%, severe/near-occlusive)
- **Tardus Parvus Waveform**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
- **Elevated Intrarenal Resistive Index**:
  - `side` — Side, type: select, required, default: `right` (options: right, left, bilateral)
- **Renal Vein Thrombosis**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
- **Renal Artery Occlusion**:
  - `side` — Side, type: select, required, default: `right` (options: right, left)
  - `chronicity` — Chronicity, type: select, required, default: `chronic` (options: acute, chronic)
  - `kidney` — Kidney appearance, type: select, required, default: `small and atrophic` (options: viable and normal in size (non-atrophic), small and atrophic)

#### Clinical History Chips

- **Resistant hypertension** — inserts: "Resistant/refractory hypertension — rule out renal artery stenosis."
- **Renal transplant surveillance** — inserts: "Renal transplant Doppler surveillance."
- **Suspected renal vein thrombosis** — inserts: "Flank pain with nephrotic-range proteinuria — rule out renal vein thrombosis."

#### Protocol

- **Protocol name:** USG Renal Doppler

- **Technique:** Grey-scale, colour, and spectral Doppler ultrasound of both kidneys, main renal arteries, renal veins, and intrarenal vasculature was performed using a curvilinear probe, with the aorta sampled for the renal-aortic ratio.

- **Default recommendation text:** Please correlate with clinical findings, blood pressure control, and renal function.

#### Impression Philosophy

Direct main-renal-artery velocity criteria (PSV, RAR) are the primary grading tool; when direct visualisation is technically limited (common with obesity or overlying bowel gas), the indirect intrarenal tardus-parvus sign is stated explicitly as a surrogate rather than left as an unexplained gap.

#### Recommendation Philosophy

≥60% stenosis in a patient with resistant hypertension or unexplained renal function decline is worded to prompt CT/MR angiography or Doppler-directed intervention correlation; bilateral severe stenosis or stenosis in a solitary kidney is flagged urgently given the risk of flash pulmonary oedema and progressive renal failure; a new occlusion with a viable (non-atrophic) kidney is likewise flagged urgently given the salvageable-kidney window, distinct from a chronic occlusion with an atrophic kidney which does not carry the same urgency.

#### Follow-up Philosophy

Renal transplant Doppler is followed per the transplant unit's own surveillance schedule; native-kidney renal artery stenosis surveillance interval is individualised with the treating nephrologist/vascular team, not fixed by this report.

#### Copilot Behaviour

Flags when a main renal artery PSV is entered without a paired renal-aortic ratio (the RAR needs the aortic PSV to compute), and reminds that a technically limited direct study should document whether the intrarenal tardus-parvus surrogate sign was assessed before calling the study normal.

#### Structured Finding Assistant Logic

Renal Artery Stenosis, Tardus Parvus Waveform, Elevated Resistive Index, Renal Vein Thrombosis, and Renal Artery Occlusion use the question-tree so laterality, severity grade, and (for Occlusion) acuity/kidney viability are captured discretely — renal Doppler findings are almost always asymmetric and management (unilateral vs bilateral, native vs solitary kidney, acute-viable vs chronic-atrophic) hinges on which side, how severe, and how acute.

#### Critical Findings

- Bilateral severe renal artery stenosis or stenosis in a solitary functioning kidney
- Acute renal vein thrombosis
- New renal artery occlusion with a viable (non-atrophic) kidney

#### Print Behaviour

PSV and RAR print as paired bilateral rows in Measurements; any stenosis/occlusion finding states laterality and grade explicitly in the Impression's operative sentence, never a bare 'renal artery disease'.


### Hepatic Doppler

**Tab name:** Hepatic Doppler

**Purpose:** Doppler assessment of the hepatic artery, hepatic veins, and portal vein — used in liver transplant surveillance (donor/recipient vascular complication screening) and in the vascular workup of cirrhosis, Budd-Chiari syndrome, and hepatic vein outflow obstruction.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Measurements
- Impression

#### Optional Sections

- Clinical History
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Hepatic Artery RI | ratio | 0.55-0.70 (transplant: rising trend or RI <0.5 with tardus-parvus suggests stenosis) | Yes | `Hepatic artery resistive index: {value}.` |
| Portal Vein Velocity | cm/s | 15-30 cm/s, hepatopetal | Yes | `Main portal vein velocity: {value} cm/s.` |
| Portal Vein Diameter | mm | <13 mm | No | `Main portal vein diameter: {value} mm.` |
| Hepatic Artery PSV | cm/s | trended serially rather than judged against a single absolute cut-off | No | `Hepatic artery peak systolic velocity: {value} cm/s.` |

**Required measurements:** Hepatic Artery RI, Portal Vein Velocity

**Optional measurements:** Portal Vein Diameter, Hepatic Artery PSV

#### Normal Template

> The main, right, and left portal veins are patent with normal hepatopetal (toward the liver) flow at normal velocity. The hepatic artery shows a normal low-resistance waveform with a brisk systolic upstroke and resistive index within normal limits. All three hepatic veins are patent with a normal triphasic waveform. The IVC is patent. No intrahepatic or extrahepatic biliary dilatation.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Hepatic Vascular Doppler | No | The portal veins are patent with normal hepatopetal flow. The hepatic artery shows a normal low-resistance waveform with resistive index within normal limits. All three hepatic veins are patent with a normal triphasic waveform. | Normal hepatic arterial, portal venous, and hepatic venous Doppler. |
| Hepatic Artery Stenosis (Post-Transplant) | Yes | The hepatic artery at the {location} shows focal velocity elevation exceeding 200 cm/s with post-stenotic turbulence and a tardus-parvus waveform in the intrahepatic branches, in keeping with hepatic artery stenosis. | Hepatic artery stenosis at the {location} — correlate urgently with the transplant team. |
| Hepatic Artery Thrombosis | No | No colour or spectral arterial flow is demonstrated in the expected course of the hepatic artery at the porta hepatis or intrahepatically, in keeping with hepatic artery thrombosis. | Hepatic artery thrombosis — urgent correlation with the transplant/surgical team advised. |
| Portal Vein Thrombosis | Yes | The portal vein shows echogenic intraluminal material with {extent} loss of colour flow, with {vascularity} on spectral interrogation of the thrombus, in keeping with portal vein thrombosis[ with {cavernoma} periportal cavernomatous collateral formation, indicating chronicity]. | {extent} portal vein thrombosis ({vascularity})[ with {cavernoma} cavernomatous transformation]. |
| Budd-Chiari (Hepatic Vein Obstruction) | Yes | The hepatic veins show {pattern}, with a plump, heterogeneous caudate lobe and intrahepatic venous collaterals, in keeping with hepatic venous outflow obstruction (Budd-Chiari pattern). | Hepatic venous outflow obstruction (Budd-Chiari pattern). |
| Hepatic Artery Pseudoaneurysm | No | A well-defined anechoic sac is noted adjacent to the hepatic artery at the porta hepatis with to-and-fro ('yin-yang') flow on colour Doppler, in keeping with a pseudoaneurysm. | Hepatic artery pseudoaneurysm — urgent correlation advised. |

Structured Finding Assistant question sets for this study:

- **Hepatic Artery Stenosis (Post-Transplant)**:
  - `location` — Location, type: select, required, default: `anastomotic site` (options: anastomotic site, proximal to the anastomosis)
- **Portal Vein Thrombosis**:
  - `extent` — Extent, type: select, required, default: `partial (non-occlusive)` (options: partial (non-occlusive), complete (occlusive))
  - `vascularity` — Thrombus vascularity, type: select, required, default: `bland (no internal arterial signal — non-tumoral)` (options: bland (no internal arterial signal — non-tumoral), tumoral/arterialised (internal arterial waveform — suspicious for HCC invasion))
  - `cavernoma` — Cavernomatous transformation, type: select, optional, default: `None` (options: None, associated)
- **Budd-Chiari (Hepatic Vein Obstruction)**:
  - `pattern` — Pattern, type: select, required, default: `absent/non-visualised hepatic vein flow` (options: absent/non-visualised hepatic vein flow, flat/monophasic hepatic vein waveform with intrahepatic collaterals)

#### Clinical History Chips

- **Liver transplant surveillance** — inserts: "Post-liver-transplant Doppler surveillance."
- **Cirrhosis / portal hypertension workup** — inserts: "Known cirrhosis — portal hypertension vascular workup."
- **Suspected Budd-Chiari** — inserts: "Acute abdominal pain with hepatomegaly and ascites — rule out Budd-Chiari syndrome."

#### Protocol

- **Protocol name:** USG Hepatic Doppler

- **Technique:** Grey-scale, colour, and spectral Doppler ultrasound of the hepatic artery (at the porta hepatis and intrahepatically), main/right/left portal veins, all three hepatic veins, and the IVC was performed using a curvilinear probe.

- **Default recommendation text:** Please correlate with clinical findings, liver function tests, and transplant team status if applicable.

#### Impression Philosophy

In post-transplant studies the hepatic artery is graded first and most urgently (thrombosis is a surgical emergency), followed by portal and hepatic venous patency; in non-transplant cirrhosis workup, portal vein direction/patency and hepatic vein waveform (for Budd-Chiari) take precedence.

#### Recommendation Philosophy

Any absent hepatic artery flow or new hepatic artery stenosis in a transplant recipient is worded as an urgent same-day communication to the transplant/surgical team; portal vein thrombosis distinguishes bland (non-tumoral) from tumour thrombus by absence of arterial signal within the thrombus, and this distinction is stated explicitly, especially in a cirrhotic/HCC-surveillance context.

#### Follow-up Philosophy

Post-transplant Doppler follows the transplant unit's fixed surveillance schedule; cirrhosis-related portal or hepatic vein findings are followed per hepatology at an interval individualised to Child-Pugh status, not fixed by this report.

#### Copilot Behaviour

In a post-transplant context, prompts to confirm the hepatic artery RI trend (a rising RI across serial studies is the classic pre-thrombosis warning) is documented rather than a single isolated value, and flags a portal vein thrombosis finding entered without an explicit note on whether arterial (tumour) vascularity within the thrombus was assessed.

#### Structured Finding Assistant Logic

Hepatic Artery Stenosis (Post-Transplant), Portal Vein Thrombosis, and Budd-Chiari use the question-tree because anastomotic-vs-proximal location, thrombus extent/vascularity/chronicity, and hepatic-vein waveform pattern are each categorical and drive a distinct, clinically load-bearing impression; Hepatic Artery Thrombosis/Pseudoaneurysm are left free-text/single-click since they are binary presence findings with no meaningful sub-grading.

#### Critical Findings

- Hepatic artery thrombosis in a transplant recipient
- New/worsening hepatic artery stenosis in a transplant recipient
- Acute Budd-Chiari pattern
- Occlusive portal vein thrombosis with tumour (arterialised) thrombus

#### Print Behaviour

Hepatic artery RI prints with prior-study values alongside where available since trend matters more than a single value in transplant surveillance; portal vein flow direction (hepatopetal/hepatofugal) is always stated explicitly in the printed Findings, never left implicit.


### Portal Doppler

**Tab name:** Portal Doppler

**Purpose:** Portal-hypertension-focused Doppler assessment of the portal venous system — portal vein diameter, flow direction and velocity, congestion index, splenic and superior mesenteric vein assessment, and portosystemic collaterals/varices — for staging and surveillance of cirrhotic portal hypertension.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Measurements
- Impression

#### Optional Sections

- Clinical History
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Portal Vein Diameter | mm | <13 mm (>13 mm suggests portal hypertension) | Yes | `Main portal vein diameter: {value} mm.` |
| Portal Vein Velocity | cm/s | 15-30 cm/s (reduced or reversed in portal hypertension) | Yes | `Main portal vein velocity: {value} cm/s.` |
| Congestion Index | cm·s | <0.1 (portal vein cross-sectional area / mean velocity; elevated in portal hypertension) | No | `Portal vein congestion index: {value} cm·s.` |
| Splenic Vein Diameter | mm | <10 mm | No | `Splenic vein diameter: {value} mm.` |
| Splenic Length | cm | <13 cm | No | `Splenic length: {value} cm.` |

**Required measurements:** Portal Vein Diameter, Portal Vein Velocity

**Optional measurements:** Congestion Index, Splenic Vein Diameter, Splenic Length

#### Normal Template

> The main portal vein is normal in calibre with normal hepatopetal flow at normal velocity, showing normal respiratory phasicity. The splenic and superior mesenteric veins are normal in calibre with hepatopetal flow. The spleen is normal in size. No portosystemic collaterals or varices are identified. No ascites.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Portal Doppler | No | The main portal vein is normal in calibre with normal hepatopetal flow at normal velocity. The splenic and superior mesenteric veins are normal with hepatopetal flow. The spleen is normal in size. No portosystemic collaterals or ascites. | No sonographic evidence of portal hypertension. |
| Portal Hypertension | Yes | The main portal vein is dilated measuring more than 13 mm with {flow} flow. The spleen is {spleen}. Portosystemic collaterals are noted (see below). | Sonographic features of portal hypertension with {flow} portal venous flow. |
| Portal Vein Thrombosis | Yes | The portal vein shows echogenic intraluminal material causing {extent} luminal occlusion, with {vascularity} on spectral interrogation of the thrombus. | {extent} portal vein thrombosis ({vascularity}) — correlate with liver imaging for underlying HCC given the cirrhotic/surveillance context. |
| Portal Vein Cavernoma / Chronic Occlusion | No | The main portal vein is not visualised as a discrete vessel and is replaced by a tangle of serpiginous collateral venous channels at the porta hepatis, in keeping with cavernomatous transformation of a chronically occluded portal vein. | Portal vein cavernoma — chronic portal vein occlusion. |
| Gastro-oesophageal / Portosystemic Varices | Yes | Dilated, tortuous, low-velocity venous channels are noted at the {location} region, in keeping with portosystemic collateral (varices) formation. | {location} portosystemic varices. |
| Hepatofugal Portal Flow | No | The main portal vein shows reversed (hepatofugal) flow directed away from the liver on spectral and colour Doppler. | Hepatofugal portal venous flow — advanced portal hypertension. |
| Ascites (Portal Hypertension-Related) | Yes | Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity, in the setting of the above portal venous findings. | {grade} ascites in the setting of portal hypertension. |

Structured Finding Assistant question sets for this study:

- **Portal Hypertension**:
  - `flow` — Flow pattern, type: select, required, default: `reduced hepatopetal` (options: reduced hepatopetal, biphasic (to-and-fro), reversed (hepatofugal))
  - `spleen` — Spleen, type: select, optional, default: `mildly enlarged` (options: mildly enlarged, moderately enlarged, markedly enlarged)
- **Portal Vein Thrombosis**:
  - `extent` — Extent, type: select, required, default: `partial (non-occlusive)` (options: partial (non-occlusive), complete (occlusive))
  - `vascularity` — Thrombus vascularity, type: select, required, default: `bland (no internal arterial signal — non-tumoral)` (options: bland (no internal arterial signal — non-tumoral), tumoral/arterialised (internal arterial waveform — suspicious for HCC invasion))
- **Gastro-oesophageal / Portosystemic Varices**:
  - `location` — Location, type: select, required, default: `peri-splenic/splenorenal` (options: peri-splenic/splenorenal, gastro-oesophageal/left gastric (coronary), peri-umbilical (recanalised paraumbilical vein), perigallbladder)
- **Ascites (Portal Hypertension-Related)**:
  - `grade` — Quantity, type: select, required, default: `Mild` (options: Mild, Moderate, Gross)

#### Clinical History Chips

- **Known cirrhosis** — inserts: "Known cirrhosis — portal hypertension surveillance."
- **Variceal bleed workup** — inserts: "Upper GI bleed — variceal source workup."
- **Pre-TIPS assessment** — inserts: "Pre-TIPS (transjugular intrahepatic portosystemic shunt) vascular assessment."

#### Protocol

- **Protocol name:** USG Portal Doppler

- **Technique:** Grey-scale, colour, and spectral Doppler ultrasound of the portal, splenic, and superior mesenteric veins was performed using a curvilinear probe, with the spleen and liver surveyed and the peritoneal cavity assessed for free fluid.

- **Default recommendation text:** Please correlate with clinical findings, liver function, and endoscopic variceal surveillance status.

#### Impression Philosophy

Flow direction (hepatopetal vs biphasic vs hepatofugal) is the single most clinically load-bearing descriptor and is always stated explicitly, because it directly tracks portal hypertension severity and TIPS candidacy; collateral/varix location is documented by name — not just 'collaterals present' — because it correlates with bleeding risk and endoscopic correlation.

#### Recommendation Philosophy

New hepatofugal flow, new large-volume ascites, or newly identified gastro-oesophageal varices in a patient without recent endoscopy are worded to prompt hepatology/endoscopy correlation; portal vein thrombosis in a cirrhotic is worded to note whether it appears bland or tumoral (arterialised), given the HCC surveillance context.

#### Follow-up Philosophy

Surveillance interval for known cirrhotics is set by the hepatology programme (typically paired with 6-monthly HCC surveillance ultrasound), not fixed by this Doppler protocol alone.

#### Copilot Behaviour

Flags when a portal hypertension quick finding is used without portal vein velocity/diameter recorded in Measurements, reminds to state flow direction explicitly (hepatopetal/hepatofugal/biphasic) whenever the word 'portal' appears in findings without an accompanying direction descriptor, and flags a portal vein thrombosis finding entered without an explicit note on thrombus vascularity (bland vs tumoral/arterialised), consistent with this study's HCC-surveillance relevance in cirrhotic patients.

#### Structured Finding Assistant Logic

Portal Hypertension, Portal Vein Thrombosis, Portosystemic Varices, and Ascites use the question-tree because flow character, thrombus extent/vascularity, collateral location, and fluid grade are categorical and each choice changes the impression sentence materially; Cavernoma and Hepatofugal Flow are left as single-click free-text findings since they are binary, unambiguous patterns.

#### Critical Findings

- New hepatofugal (reversed) portal flow
- Occlusive portal vein thrombosis with arterialised (tumoral) thrombus
- Large-volume new ascites in a known cirrhotic
- Extensive gastro-oesophageal varices in a patient without recent endoscopic surveillance

#### Print Behaviour

Portal vein diameter and velocity print together as a paired Measurements row; flow direction is always carried into the Impression's first sentence, and any varix/collateral finding lists its anatomical location by name.


### Obstetric Doppler

**Tab name:** Obstetric Doppler

**Purpose:** Fetal and uteroplacental Doppler assessment — umbilical artery, fetal middle cerebral artery, cerebroplacental ratio, uterine artery, and ductus venosus — used for surveillance of fetal growth restriction, pre-eclampsia risk, and fetal wellbeing, reported via the canonical Reporting Workspace as distinct from FetalUsgLevel4's own dedicated Doppler fields.

#### Standard Section Order

Clinical History → Technique → Findings → Measurements → Impression → Recommendation

#### Mandatory Sections

- Technique
- Findings
- Measurements
- Impression

#### Optional Sections

- Clinical History
- Recommendation

#### Measurements

| Label | Unit | Normal Range | Required | Quick-Measurement Template |
|---|---|---|---|---|
| Umbilical Artery PI | ratio | gestational-age-dependent centile chart (typically <95th centile; falls with advancing GA) | Yes | `Umbilical artery pulsatility index: {value}.` |
| Umbilical Artery S/D Ratio | ratio | <3.0 after 30 weeks (gestational-age-dependent) | No | `Umbilical artery systolic/diastolic ratio: {value}.` |
| MCA PI | ratio | gestational-age-dependent centile chart (<5th centile = brain-sparing) | Yes | `Middle cerebral artery pulsatility index: {value}.` |
| Cerebroplacental Ratio (CPR) | ratio | >1.0 (MCA PI / UA PI; <1.0 suggests redistribution; gestational-age-dependent centile cut-offs are more precise) | Yes | `Cerebroplacental ratio: {value}.` |
| Uterine Artery PI (Mean) | ratio | gestational-age-dependent centile chart (>95th centile = abnormal) | No | `Mean uterine artery pulsatility index: {value}.` |

**Required measurements:** Umbilical Artery PI, MCA PI, Cerebroplacental Ratio (CPR)

**Optional measurements:** Umbilical Artery S/D Ratio, Uterine Artery PI (Mean)

#### Normal Template

> Umbilical artery Doppler shows a normal waveform with forward end-diastolic flow and pulsatility index within the normal range for gestational age. Fetal middle cerebral artery Doppler shows pulsatility index within normal limits with no evidence of brain-sparing. The cerebroplacental ratio is within normal limits. Bilateral uterine artery Doppler shows a normal waveform with no notching and pulsatility index within the normal range. Ductus venosus shows a normal triphasic waveform with forward flow in all cardiac phases.

#### Quick Findings

| Label | Structured | Finding Text | Impression Text |
|---|---|---|---|
| Normal Obstetric Doppler | No | Umbilical artery Doppler shows forward end-diastolic flow with pulsatility index within normal limits for gestational age. MCA PI and cerebroplacental ratio are within normal limits. Bilateral uterine artery Doppler shows no notching. | Normal umbilical, cerebral, uterine artery, and ductus venosus Doppler for gestational age. |
| Absent/Reversed End-Diastolic Umbilical Flow | Yes | Umbilical artery Doppler shows {pattern}, indicating significantly increased placental vascular resistance. | Umbilical artery {pattern} — high-risk finding requiring urgent obstetric correlation and delivery-timing discussion. |
| Brain-Sparing (Redistribution) | No | Middle cerebral artery Doppler shows a reduced pulsatility index below the 5th centile for gestational age with a cerebroplacental ratio below 1.0, in keeping with fetal cerebral blood flow redistribution (brain-sparing effect). | Fetal brain-sparing (cerebral redistribution) — reduced cerebroplacental ratio. |
| Bilateral Uterine Artery Notching | Yes | Both uterine arteries show a persistent early diastolic notch with {pi}, in keeping with impaired trophoblastic invasion / increased utero-placental resistance. | Bilateral uterine artery notching with {pi} — increased risk of pre-eclampsia/fetal growth restriction. |
| Abnormal Ductus Venosus Waveform | Yes | Ductus venosus Doppler shows a {pattern}, in keeping with worsening fetal cardiovascular compromise. | Ductus venosus {pattern} — significant finding requiring urgent obstetric correlation. |
| Elevated Umbilical Artery PI | No | Umbilical artery Doppler shows a pulsatility index above the 95th centile for gestational age with preserved forward end-diastolic flow, in keeping with increased placental vascular resistance. | Elevated umbilical artery PI — increased placental resistance; correlate with growth parameters and surveillance schedule. |

Structured Finding Assistant question sets for this study:

- **Absent/Reversed End-Diastolic Umbilical Flow**:
  - `pattern` — Pattern, type: select, required, default: `absent end-diastolic flow (AEDF)` (options: absent end-diastolic flow (AEDF), reversed end-diastolic flow (REDF))
- **Bilateral Uterine Artery Notching**:
  - `pi` — Pulsatility index, type: select, required, default: `elevated PI (>95th centile)` (options: normal PI, elevated PI (>95th centile))
- **Abnormal Ductus Venosus Waveform**:
  - `pattern` — Pattern, type: select, required, default: `reduced/absent a-wave` (options: reduced/absent a-wave, reversed a-wave)

#### Clinical History Chips

- **Fetal growth restriction surveillance** — inserts: "Suspected/known fetal growth restriction — Doppler surveillance."
- **Pre-eclampsia / hypertensive disorder** — inserts: "Pre-eclampsia / gestational hypertension — uteroplacental Doppler assessment."
- **First-trimester pre-eclampsia screening** — inserts: "First-trimester combined pre-eclampsia risk screening — uterine artery Doppler."

#### Protocol

- **Protocol name:** USG Obstetric Doppler

- **Technique:** Colour and pulsed-wave spectral Doppler of the umbilical artery (free loop), fetal middle cerebral artery, bilateral uterine arteries, and ductus venosus (when indicated) was performed in accordance with ISUOG Doppler guidelines, with all measurements taken during fetal apnoea and absent fetal breathing/body movement.

- **Default recommendation text:** Please correlate with clinical findings, growth biometry, and blood pressure status. Findings to be interpreted in conjunction with the growth/anomaly scan of the same pregnancy where performed.

#### Impression Philosophy

Findings are staged by severity of fetal cardiovascular compromise — normal, then redistribution (brain-sparing/reduced CPR), then absent/reversed umbilical end-diastolic flow, then ductus venosus abnormality — because this progression is the standard clinical framework for growth-restriction surveillance and directly informs delivery timing.

#### Recommendation Philosophy

Absent/reversed umbilical end-diastolic flow or an abnormal ductus venosus waveform is worded to prompt same-day obstetric correlation given the association with imminent fetal compromise; isolated elevated uterine artery PI/notching or a reduced CPR alone is worded as a surveillance-escalation flag rather than an emergency.

#### Follow-up Philosophy

Surveillance interval (weekly, twice-weekly, or more frequent with additional biophysical parameters) is set by the treating obstetric team based on the severity tier reached, not fixed by this protocol; as with all obstetric/fetal studies on this platform, the existing PCPNDT/Form F compliance workflow and finalize gating apply and are not re-described here.

#### Copilot Behaviour

Flags when an umbilical artery PI/S-D value is entered without a paired MCA PI, since the cerebroplacental ratio needs both to compute, and flags when 'notching' appears in the findings text without a corresponding uterine artery PI value recorded; reminds that any AEDF/REDF or ductus venosus abnormality warrants same-day communication per departmental critical-results policy — advisory only, layered on top of the existing obstetric Copilot reminder and finalize gate rather than replacing them.

#### Structured Finding Assistant Logic

Absent/Reversed Umbilical Flow, Bilateral Uterine Artery Notching, and Abnormal Ductus Venosus Waveform use the question-tree because the specific pattern (absent vs reversed; notching with normal vs elevated PI; reduced vs reversed a-wave) changes the severity tier and therefore the recommended escalation — a free-text 'abnormal Doppler' would lose that clinically essential distinction.

#### Critical Findings

- Reversed end-diastolic umbilical artery flow
- Reversed ductus venosus a-wave
- Absent end-diastolic umbilical flow with a reduced cerebroplacental ratio
- Bilateral uterine artery notching with severe early-onset growth restriction

#### Print Behaviour

Umbilical PI, MCA PI, and CPR always print together as a linked triplet in Measurements (never CPR alone without its two source values); any AEDF/REDF or ductus venosus finding is bolded/flagged for urgent review consistent with the platform's existing critical-finding highlighting, and the pregnancy's existing obstetric finalize-gate/PCPNDT workflow governs finalize regardless of Doppler content.


---
