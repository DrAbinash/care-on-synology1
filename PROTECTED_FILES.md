# PROTECTED FILES — Care ERP Module Boundary

**Status:** Phase 1 — labeling & enforcement only. No files have been moved.
**Why this file exists:** Care ERP is being progressively separated into a
stable **Billing/Accounts** zone and an experimental **Radiology/PACS** zone,
without creating a second ERP, without splitting the frontend, login, or
database. This file is the explicit list referenced by
`DEVELOPMENT_PRINCIPLES.md` and `CONTRIBUTING.md`'s "Prohibited
Modifications" section.

**The rule:** Any change to a file in the 🔴 **Billing / Payments** list
below requires Dr. Abinash's explicit sign-off before merging — regardless
of how small the change looks. Radiology/PACS files (🟡) can be developed
and debugged more freely since they carry no direct financial risk.
Shared/core files (🟢) are load-bearing for both zones — treat edits there
with the same caution as billing.

This is a living document. When a new billing-related or radiology-related
file is added, add it here in the same commit.

---

## 🔴 Billing / Accounts / Payments — PROTECTED, sign-off required

Touches money, statutory records, or patient billing. Bugs here mean lost
revenue, double-charging, failed reconciliation, or audit exposure.

### API routes (`artifacts/api-server/src/routes/`)
```
bills.ts
payments.ts
orders.ts
banking.ts
expenses.ts
accounting.ts
commission.ts
daily-summary.ts
my-daily-summary.ts
day-close.ts
day-close.test.ts
doctor-ledger.ts
ledgers.ts
discounts.ts
discountReasons.ts
reprintReasons.ts
gateway-webhooks.ts
gateway-webhooks.test.ts
books-sanity.ts
outsourced-labs.ts
test-tokens.ts
tokens.ts
vendors.ts
verify.ts
kiosk.ts
```

### Payment provider library (`artifacts/api-server/src/lib/payments/`)
```
PaymentEngine.ts
PaymentProvider.ts
IciciPaymentProvider.ts
IciciPaymentProvider.test.ts
HdfcPaymentProvider.ts
RazorpayPaymentProvider.ts
PayUPaymentProvider.ts
BharatPePaymentProvider.ts
PhonePePaymentProvider.ts
CashfreePaymentProvider.ts
paymentDiagnostics.ts
paymentDiagnostics.test.ts
```

### Database schema (`lib/db/src/schema/`)
```
bills.ts
banking.ts
expenses.ts
ledgers.ts
paymentLogs.ts
paymentGatewayDiagnostics.ts
aiBillingSuggestions.ts
doctorPayouts.ts
```

### Frontend pages (`artifacts/diagnostic-erp/src/pages/`)
```
Billing.tsx
BillingDesk.tsx
BillDetail.tsx
Payments.tsx
Banking.tsx
Accounting.tsx
Expenses.tsx
OutsourceLedger.tsx
OutsourceReconciliation.tsx
VerifyReceipt.tsx
PaymentQrDisplay.tsx
AiBillingSuggestions.tsx
```

---

## 🟡 Radiology / PACS / DICOM / AI Reporting — experimental, lower risk

Clinically important but carries no direct financial/billing risk. Can be
developed, refactored, and debugged more freely than the billing zone.

### API routes
```
radiology.ts
radiologyAnnotations.ts
radiologyBrainIntelligence.ts
radiologyCopilot.ts
radiologyKnowledge.ts
radiologyLesions.ts
radiologyMemory.ts
radiologyMyAnalytics.ts
radiologyOllama.ts
radiologySmartFindings.ts
radiologySnippets.ts
radiologySpineIntelligence.ts
radiologyTumorFollowup.ts
radiologyWorkflow.ts
radiology-report-generator.ts
dicom.ts
dicom-agent.ts
dicom-uploads.ts
dicomStudyManager.ts
dicomWorkflow.ts
internal-radiology.ts   # name is generic but content is 100% radiology
pacs.ts
pacsEnterprise.ts
teleradiology.ts
teleradiologyPortal.ts
smartRadiology.ts
sonologistAssistant.ts
usgAnalytics.ts
usgCriticalAlerts.ts
usgDoppler.ts
usgExtraction.ts
usgReports.ts
careUsgCompanion.ts   # CARE USG Companion (Phase 1) — study assembly + telemetry
radiologyKnowledgePacks.ts   # CARE Knowledge Pack Engine — registry/loader/validator over existing content
abnormal-findings.ts
echoCardiology.ts
fetalUsgLevel4.ts
pregnancyDashboard.ts
teachingCases.ts
risMonitoring.ts
scan-sessions.ts
report-templates.ts
reportDelivery.ts
reports.ts
structuredReportTemplates.ts
```

### PACS library (`artifacts/api-server/src/lib/pacs/`)
```
matchingEngine.ts
pacsConfig.ts
providers.ts
providers.test.ts
```

### Database schema
```
aiDicomFindings.ts
dicom.ts
dicomAgent.ts
dicomPulledStudies.ts
dicomRoutingRules.ts
dicomStudies.ts
enterpriseRadiology.ts
pacsSettings.ts
radiologistLearningSettings.ts
radiology.ts
radiologyAiReviewAudits.ts
radiologyAnnotations.ts
radiologyKnowledge.ts
radiologyLesions.ts
radiologyMemory.ts
radiologyOrganIntelligence.ts
radiologyReportGenerator.ts
radiologyScheduledProcedures.ts
radiologyShareLinks.ts
radiologySmartFindings.ts
radiologySnippets.ts
radiologyWorkflow.ts
radiologyWorklist.ts
smartRadiology.ts
teleradiologyUsers.ts
usgCompanion.ts   # CARE USG Companion (Phase 1) — companion_runs telemetry
knowledgePacks.ts   # CARE Knowledge Pack Engine — knowledge_packs registry
```

### Frontend pages
```
Radiology.tsx
RadiologyAdvancedTools.tsx
RadiologyCommandCenter.tsx
RadiologyLegacy.tsx
RadiologyOperationsDashboard.tsx
RadiologyProductivity.tsx
RadiologyReportEditor.tsx
RadiologyReportGenerator.tsx
RadiologyReportUnified.tsx
RadiologyReportingWorkspace.tsx
RadiologySettings.tsx
RadiologySettingsCenter.tsx
RadiologyStyleSettings.tsx
RadiologyWorklist.tsx
RadiologistCockpit.tsx
RadiologistQueue.tsx
RadiologistTools.tsx
AiDicomFindings.tsx
DicomAgentDashboard.tsx
DicomNodes.tsx
DicomQueryRetrieve.tsx
DicomStudyWorklist.tsx
DicomViewer.tsx
OutsourceWorklist.tsx
PACS.tsx
PacsArchiveLifecycle.tsx
PacsDashboard.tsx
PacsLogs.tsx
PacsSettings.tsx
PacsWatchdogDashboard.tsx
TeleradiologyPortal.tsx
UsgWorklist.tsx
```

### Frontend MRI Brain reporting (`artifacts/diagnostic-erp/src/`)
```
lib/mriBrainSequences.ts          # technique → performed-sequence context + statement rules
lib/mriBrainAtoms.ts              # BrainAtomSpec → ledger patch atoms (one bundle id per group)
lib/mriBrainNormalAtoms.ts        # protocol-aware NORMAL baseline atoms
lib/mriBrainLesion.ts             # shared lesion characterization + MRS atoms
lib/mriBrainMeasures.ts           # ABC/2, Fazekas, herniation, Knosp, midline shift
lib/mriBrainSubMasters.ts         # 13 clinical sub-master palettes (tiles / presets)
lib/mriBrainContradictions.ts     # normal-vs-abnormal + sequence-aware warnings
components/radiology/reporting-canvas/MriBrainCanvas.tsx
```

### Frontend X-ray Chest reporting (`artifacts/diagnostic-erp/src/`)
```
lib/xrayChestViews.ts             # technique → performed view/adequacy + projection statement rules
lib/xrayChestAtoms.ts             # ChestAtomSpec → ledger patch atoms (one bundle id per group)
lib/xrayChestNormalAtoms.ts       # projection-aware NORMAL baseline atoms
lib/xrayChestMeasures.ts          # CTR, pneumothorax / effusion size bands, tension signs
lib/xrayChestLesions.ts           # descriptive nodule / mass characterisation
lib/xrayChestDevices.ts           # lines, tubes and devices — position + complication
lib/xrayChestComparison.ts        # dated-prior interval statements (reuses radiologyComparison)
lib/xrayChestSubMasters.ts        # 16 clinical sub-master palettes (tiles / presets)
lib/xrayChestContradictions.ts    # normal-vs-abnormal + projection-aware warnings
components/radiology/reporting-canvas/XrayChestCanvas.tsx
```

### Frontend X-ray Cervical Spine reporting (`artifacts/diagnostic-erp/src/`)
```
lib/xrayCervicalViews.ts          # technique → performed views, adequacy, inferior limit + the odontoid / foraminal / dynamic gates
lib/xrayCervicalLevels.ts         # cervical level vocabulary (C1-T1, C2-3…C7-T1), T↔D tolerance, numbering consistency
lib/xrayCervicalAtoms.ts          # CervicalAtomSpec → ledger patch atoms, normalized level in the slot key
lib/xrayCervicalNormalAtoms.ts    # coverage-aware NORMAL baseline (never certifies unseen anatomy)
lib/xrayCervicalMeasures.ts       # prevertebral / ADI / translation / angulation / Cobb with level + view + provenance
lib/xrayCervicalDynamic.ts        # flexion-extension entries, derived change, radiologist-selected instability
lib/xrayCervicalHardware.ts       # ACDF / posterior construct, continuity, lucency graded, never overstated
lib/xrayCervicalSubMasters.ts     # 10 clinical sub-master palettes (tiles / presets) + capability gates
lib/xrayCervicalContradictions.ts # normal-vs-abnormal, view-gated and level-consistency warnings
components/radiology/reporting-canvas/XrayCervicalCanvas.tsx
```

### Frontend X-ray Lumbosacral Spine reporting (`artifacts/diagnostic-erp/src/`)
```
lib/xrayLsViews.ts                # technique → performed views, adequacy, coverage + the pars / dynamic / junction / SI gates
lib/xrayLsLevels.ts               # lumbosacral level vocabulary (T12–S1), transitional junction, level-consistency issues
lib/xrayLsNumbering.ts            # numbering basis (standard / LSTV / designated L5 / manual), label derivation + prose round-trip
lib/xrayLsAtoms.ts                # LsAtomSpec → ledger patch atoms, normalized level in the slot key
lib/xrayLsNormalAtoms.ts          # coverage-aware NORMAL baseline (never certifies unseen anatomy)
lib/xrayLsMeasures.ts             # translation / Cobb / angulation / height loss with level + view + provenance
lib/xrayLsDynamic.ts              # flexion-extension entries, derived change, radiologist-selected instability
lib/xrayLsHardware.ts             # instrumentation, continuity, lucency graded, never overstated
lib/xrayLsSubMasters.ts           # 12 clinical sub-master palettes (tiles / presets) + numbering and view gates
lib/xrayLsContradictions.ts       # normal-vs-abnormal, view-gated and level/numbering-consistency warnings
components/radiology/reporting-canvas/XrayLsSpineCanvas.tsx
```

---

## 🟢 Shared / Core — load-bearing for both zones, treat like billing

Auth, users, patients, settings, and infrastructure that both zones depend
on. A bug here can silently break both Billing and Radiology at once.

```
# Auth & identity
webauthn.ts
bridge.ts                 # biometric/attendance challenge auth
role-permissions.ts
users.ts
staff.ts

# Core clinical/business entities
patients.ts
doctors.ts
branches.ts
departments.ts
locations.ts
machines.ts
printers.ts
clinicSettings.ts
hr-forms.ts

# Offline sync — ⚠️ touches patients, orders, bills, AND payments together.
# Treat as billing-adjacent: do not let radiology-focused changes modify it.
sync.ts

# Integrations used by both zones
hl7.ts
barcode-resolver.ts
whatsapp.ts
waChatbot.ts
website.ts
website.test.ts
public-booking.ts
online-bookings.ts
receptionCommandCenter.ts
display.ts
queueDisplaySettings.ts
paymentDisplay.ts         # presentation-only relay for the customer-facing
                           # payment QR screen — does not create, verify, or
                           # mutate payments; only republishes what bills.ts
                           # already computed. Same discipline as display.ts.

# Generic AI infrastructure — used by AiBillingSuggestions (billing) AND
# radiology AI reporting. Do not fork per-module; keep as one shared layer.
ai.ts
aiModelRoutes.ts
aiPromptLibrary.ts
aiPromptTemplates.ts
aiComparison.ts

# System/ops
audit-logs.ts
backup.ts
backupReplication.ts
internal-backup.ts
internal-cron.ts
system.ts
system-health.ts
health.ts

# Frontend shell — must never diverge between zones
components/Layout.tsx
App.tsx
components/ui/*
```

---

## What Phase 1 does and does not change

**Does:**
- Documents the boundary explicitly (this file)
- Marks route registrations by zone in `routes/index.ts` for reviewer visibility
- Gives CONTRIBUTING.md / DEVELOPMENT_PRINCIPLES.md a concrete list to point to

**Does not (yet):**
- Move any file
- Change any import path
- Change `docker-compose.yml` or create a second build target
- Touch the database schema
- Change the frontend shell, sidebar, or login

Real Docker-level separation (rebuilding Radiology without rebuilding
Billing) requires splitting the single `api` build target into two images —
that is Phase 2+ and should only happen once the route/folder boundary above
has held for a while without violations.

---

*Last updated: alongside the Queue Display (TV) feature work.*
