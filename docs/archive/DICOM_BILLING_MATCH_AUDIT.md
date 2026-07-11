# DICOM & Billing Match Audit Report

This report documents the design, rules, and implementation of the Anti-Forgery and Mismatch-Protection system built for Radiology / PACS / Billing.

---

## 1. Existing Matching Logic Found
Before this upgrade, PACS studies auto-pulled from Conquest/Orthanc were matched against billing orders (`radiology_studies`) via a 5-tier fallback cascading logic inside `POST /api/internal/radiology/studies`:
1. **Numeric ID**: Matches raw study ID if provided.
2. **Accession Number**: Matches the unique `accessionNumber`.
3. **StudyInstanceUID**: Matches the unique study UID.
4. **Demographic Fallback 1**: Matches `patientId` + `studyDate` + lowercased `modality`.
5. **Demographic Fallback 2**: Matches `patientName` + `studyDate` + lowercased `studyDescription`.

However, the previous system lacked any match score calculations, warning flags for critical identifier differences (like name/modality mismatch), override audit logging, or safety gates blocking report finalization and delivery of unmatched/mismatched studies.

---

## 2. New Matching Engine
The new matching engine is implemented as a pure utility in [matchingEngine.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacs/matchingEngine.ts) and integrated at runtime during:
- **Intake API**: Calculates and stores scores/warnings when new studies are pushed.
- **Manual Linkings**: Recalculates scores when a user manually binds a study.
- **Candidate Queries**: Dynamically scores all available billed tests to list best matches first.

### Database Checks
At the database layer, it performs checks for:
- **`DUPLICATE_UID`**: Warns if the same StudyInstanceUID is received across multiple records.
- **`STUDY_REUSED`**: Warns if the same DICOM study is linked to multiple different bills.
- **`BILL_LINKED_TO_MULTIPLE_STUDIES`**: Warns if the same bill is linked to multiple different DICOM studies.

---

## 3. Match Score Rules
Each check computes a match point value (out of 100 max) and adds warnings for mismatches:

| Field Check | Logic | Points | Mismatch / Anti-Forgery Warn Flag |
| :--- | :--- | :--- | :--- |
| **Accession Number** | Exact Match | +50 | `Accession number differs or is missing on one record` |
| **Patient ID / UHID** | Exact Match | +30 | — |
| **Patient Name** | Fuzzy Levenshtein (>=85% = confident, >=60% = partial) | +20 (conf) / +10 (part) | `NAME_MISMATCH: Patient name differs completely` |
| **Modality** | Exact Modality Code Mapping | +10 | `MODALITY_MISMATCH: Billed for {X} but DICOM shows {Y}` |
| **Study Description** | Keyword overlap check | +10 | — |
| **Study Date** | Within 24 hours of billing | +10 | `DATE_MISMATCH: Study date differs from billing date by X days` |
| **Gender / Sex** | Exact Match | +5 | `Gender mismatch: DICOM shows {X}, billing shows {Y}` |
| **Age** | Within 5 years match | +5 | `Age mismatch: DICOM shows {X}, billing shows {Y}` |

### Classification
- **GREEN (Confident Match)**: Score >= 75 points and NO critical warnings (`NAME_MISMATCH` or `MODALITY_MISMATCH`).
- **YELLOW (Needs Review)**: Score >= 30 points and NO critical warnings.
- **RED (Mismatch / Possible Wrong Study)**: Score < 30 points or contains critical warnings (`NAME_MISMATCH`, `MODALITY_MISMATCH`, `DUPLICATE_UID`, `STUDY_REUSED`).

---

## 4. Files Changed
1. **Database Schema**:
   - [radiologyWorklist.ts](file:///c:/Users/abina/caredeoghar--antigravity/lib/db/src/schema/radiologyWorklist.ts): Added match attributes (`matchScore`, `matchPoints`, `matchReasons`, `matchWarnings`, `matchDecision`, `matchApprovedBy`, `matchApprovedAt`, `matchOverrideReason`).
2. **Backend**:
   - [index.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/index.ts): Startup migrations to dynamically add matching columns on startup.
   - [matchingEngine.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacs/matchingEngine.ts): Pure score computation helper.
   - [internal-radiology.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/internal-radiology.ts): Orchestrates `runMatchingEngineForWorklist` during intake.
   - [radiology.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/radiology.ts): Endpoints for worklist, candidates, manual link, match decision, and report finalization block.
   - [reportDelivery.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/reportDelivery.ts): Enforces safety checks blocking WhatsApp/Email delivery.
   - [barcode-resolver.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/barcode-resolver.ts): Enforces safety checks blocking barcode delivery.
3. **Frontend**:
   - [MyCollection.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/MyCollection.tsx): Match center dashboard.
   - [App.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/App.tsx): Registered new router route.
   - [Layout.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/components/Layout.tsx): Sidebar link.

---

## 5. UI Changes in My Collection
The **DICOM Match Center** (`/radiology/my-collection`) features:
1. **Intake Worklist Panel**: Filterable sidebar list of all incoming PACS studies with color-coded score badges.
2. **Side-by-Side Comparison Grid**: Displays the pushed DICOM tags next to the billed test orders.
3. **Decision Factor Highlights**: Lists positive match points and red-alert warn banners for name/modality mismatch.
4. **Viewer Integrations**: One-click OHIF launcher and Weasis launcher.
5. **Manual Link Modal**: Interactive search query for billed tests with candidate scoring preview.
6. **Approve Match / Reject Match / Override Approval**: Manual overrides prompting for justification which unlocks finalization.

---

## 6. Audit Trail Added
Every manual intervention is logged in the append-only `radiology_audit_log` database table:
- **`MANUAL_LINK`**: Logs `studyId`, `accessionNumber`, and `oldLinkedStudyId`.
- **`MATCH_APPROVED` / `MATCH_REJECTED`**: Logs `overrideReason`, `matchScore`, and `matchPoints`.
All logs capture the username of the actor (`(req as any).staffSession?.subjectName`) and timestamp.

---

## 7. Manual Test Plan
1. **Positive Test (Green Match)**:
   - Create a bill for patient "Rahul Sharma" (Modality: CT, Accession: CT-101).
   - Push a mock DICOM study with patient name "Rahul Sharma", Modality "CT", and Accession "CT-101".
   - Verify that the study is graded `GREEN` and can be signed and delivered immediately.
2. **Negative Test (Red Modality Mismatch)**:
   - Create a bill for patient "Priya Patel" (Modality: MRI).
   - Push a mock DICOM study with modality "CT" or "XRAY".
   - Verify that the study receives a `RED` status with a `MODALITY_MISMATCH` flag, and finalizing/delivering reports is blocked.
3. **Negative Test (Red Name Mismatch)**:
   - Push a DICOM study with name "Amit Kumar" for a bill belonging to "Sumit Singh".
   - Verify that it receives `RED` with a `NAME_MISMATCH` flag.
4. **Override Test**:
   - For a `RED` mismatched study, click "Approve Override" in Match Center, enter "Typo in patient registration verified", and approve.
   - Verify that report finalization and report delivery are immediately unblocked.

---

## 8. Example Cases

### Green Case (Confident Match)
- **Billed Test**: Rahul Kumar (UHID: 10423), CT Brain, Modality: CT, Acc: ACC-20260625-CT-001
- **DICOM study**: Rahul Kumar, CT Brain, Modality: CT, Acc: ACC-20260625-CT-001
- **Score**: 100 points (`GREEN`)
- **Status**: Instantly reporting-ready.

### Yellow Case (Needs Review)
- **Billed Test**: Abinash Sharma (UHID: 10455), MRI Spine, Modality: MRI, Acc: ACC-20260625-MR-005
- **DICOM study**: Abinash C Sharma, MRI Spine, Modality: MRI, Acc: ACC-20260625-MR-005
- **Score**: 90 points (`YELLOW`) - Name similarity is 88%.
- **Status**: Warning flag shown but allowed.

### Red Case (Mismatch Blocked)
- **Billed Test**: Surbhi Gupta (UHID: 10499), CT Abdomen, Modality: CT, Acc: ACC-20260625-CT-009
- **DICOM study**: Surbhi Gupta, MRI Brain, Modality: MR, Acc: ACC-20260625-MR-009
- **Score**: 50 points (`RED`) - Modality Mismatch warning.
- **Status**: Blocked from finalization and delivery until overridden.

---

## 9. Rollback Plan
To rollback this system to the previous behavior:
1. Revert the route files (`internal-radiology.ts`, `radiology.ts`, `reportDelivery.ts`, `barcode-resolver.ts`) using git command:
   ```bash
   git restore artifacts/api-server/src/routes/
   ```
2. Remove frontend changes:
   ```bash
   git restore artifacts/diagnostic-erp/src/App.tsx artifacts/diagnostic-erp/src/components/Layout.tsx
   rm artifacts/diagnostic-erp/src/pages/MyCollection.tsx
   ```
3. Database columns can remain as they are nullable/defaulted, or can be dropped via a database migration.
