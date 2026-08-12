# Radiology End-to-End Acceptance

Manual hardware acceptance checklist for Care Diagnostics radiology workflow:

**Billing → ERP study → MWL (.wl) → Orthanc C-FIND → modality → PACS intake → reporting**

Automated Vitest coverage lives in:

- `artifacts/api-server/src/lib/pacs/radiologyE2eAcceptance.test.ts`
- Related: MWL writer, deployment status, modality bucket, USG modality, queue display departments, reporting workspace normalization

**Settings UI:** Settings → Radiology → **MWL** tab (`/settings/radiology?tab=mwl`, `data-testid="settings-radiology-mwl"`) shows a read-only Acceptance Tests panel with infrastructure counts. It never creates fake patients or bills.

**Safety:** Do not run these cards against production patients. Use dedicated TEST^… patients. Do not deploy from this checklist.

---

## Card 1 — MRI Brain

| Field | Value |
| --- | --- |
| Test patient (DICOM PN) | `TEST^MRI^BRAIN` |
| Patient ID / UHID | Record after billing: _______________ |
| Accession | Record after billing: _______________ |
| Modality | `MR` (billing department MRI) |
| Scheduled procedure description | `MRI Brain` |
| StudyInstanceUID (MWL) | Deterministic from accession (Orthanc housekeeper); clinical link remains accession |
| ERP study status | `scheduled` → after successful .wl publish: scheduled procedure `SENT_TO_MWL` |
| .wl presence | `{accession}.wl` under Orthanc worklists dir |
| Orthanc visibility | Worklists plugin serves item on C-FIND |
| Modality visibility | MRI console shows patient; select without retyping demographics |
| Reporting workspace | After scan + intake: patient nested object; no crash on `patient.id` |

**Expected chain**

1. Billing Desk → select **MRI Brain** → complete bill  
2. ERP creates `radiology_studies` (modality `MR`) + accession `ACC-YYYYMMDD-MR-NNN`  
3. `publishRadiologyStudyToMwl()` upserts `radiology_scheduled_procedures`  
4. `writeWorklistFile()` → dump2dcm → dcmdump UID check → atomic rename → `SENT_TO_MWL`  
5. MRI C-FIND → select `TEST^MRI^BRAIN` → scan  
6. Orthanc store → ERP intake matches by accession → reporting workspace  

**PASS □** **FAIL □** Notes: _______________

---

## Card 2 — MRI Whole Spine

| Field | Value |
| --- | --- |
| Test patient (DICOM PN) | `TEST^MRI^WHOLESPINE` |
| Patient ID / UHID | _______________ |
| Accession | _______________ (must be unique vs Card 1) |
| Modality | `MR` |
| Scheduled procedure description | `MRI Whole Spine` (full string — no truncation) |
| StudyInstanceUID (MWL) | From accession; must not collide with Card 1 |
| ERP status | `SENT_TO_MWL` only after successful publish |
| .wl presence | Present for this accession only (one study — no accidental split) |
| Orthanc / modality | Description readable as Whole Spine |
| Reporting | Normalized patient; correct study description |

**Expected chain:** Same pipeline as MRI Brain. Specifically verify description survives, modality bucketing stays MRI, accession unique, no split into unrelated studies.

**PASS □** **FAIL □** Notes: _______________

---

## Card 3 — USG Whole Abdomen

| Field | Value |
| --- | --- |
| Test patient (DICOM PN) | `TEST^USG^ABDOMEN` |
| Patient ID / UHID | _______________ |
| Accession | `ACC-YYYYMMDD-US-NNN` |
| Modality | `US` (billing department USG; aliases USG/US/ULTRASOUND) |
| Scheduled procedure description | `USG Whole Abdomen` |
| Obstetric classification | Non-obstetric (must not force Form F path) |
| ERP status | Study + MWL as above |
| .wl / MWL | Present; demographics on worklist |
| USG operator / auto queue | Patient selectable **without retyping** demographics |
| Reporting | Appears under US filter; accession available for matching |

**Expected chain**

1. Billing → **USG Whole Abdomen**  
2. `test_token.department = USG`  
3. **`/queue/usg` displays this token**  
4. MWL / operator selects patient → scan / complete → reporting  

### USG TV queue invariant (must verify on this card)

| Action | Expected on `/queue/usg` |
| --- | --- |
| Billing USG → `test_token.department=USG` | **MUST display** |
| Billing MRI → `test_token.department=MRI` | **MUST NOT display** |

Call Next remains keyed off the token’s own department (unchanged). Legacy settings with accidental `MRI,CT` on the USG room self-heal to **USG only**; intentional multi-dept must include `USG` (e.g. `USG,MRI`).

**PASS □** **FAIL □** Notes: _______________

---

## Card 4 — Cancellation / Void

| Field | Value |
| --- | --- |
| Test patient | Any Card 1–3 style TEST patient |
| Accession | _______________ |
| Before cancel | Active MWL (`SCHEDULED` / `SENT_TO_MWL`); `.wl` present; modality can C-FIND |
| Cancel action | Bill cancel **or** study status → cancelled **or** cancel-test |
| After cancel | `radiology_scheduled_procedures` = `CANCELLED` |
| .wl | Removed / excluded from active sync |
| Modality | Exam **no longer** on worklist |
| USG queue | No orphan waiting/serving token for that order_test |
| ERP study | `cancelled` |

**Expected chain:** Create → confirm visible → cancel → confirm removed from MWL, .wl, modality, and TV queue.

**PASS □** **FAIL □** Notes: _______________

---

## Failure-safety spot checks (optional, staging only)

| Check | Expected |
| --- | --- |
| dump2dcm missing/fail | No live `.wl`; status stays `SCHEDULED` (not `SENT_TO_MWL`) |
| Empty/invalid UIDs in dump | Refuse write |
| EXDEV (staging ≠ live FS) | Atomic rename fails closed — **no copy fallback** |
| Orthanc unreachable | MWL deployment verdict **not** green |

---

## Sign-off

| Role | Name | Date | Result |
| --- | --- | --- | --- |
| Technologist | | | |
| Radiologist | | | |
| IT / PACS | | | |

**No production data, Orthanc storage paths, live MWL files outside the test accessions, or modality AE configuration should be modified except as required to run these TEST patients.**
