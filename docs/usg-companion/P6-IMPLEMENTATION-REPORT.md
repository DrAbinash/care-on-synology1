# USG Companion — Phase P6 (Report return to PACS)

**Branch:** `claude/usg-companion-p6-pacs-return` (stacked on P5 `claude/usg-companion-p5-ob-doppler`).
**Flag:** `ff_radiology_usg_report_to_pacs` — **default OFF**.

P6 lets a signed USG report return to PACS **through the existing canonical
archiver** (`archiveReportToPacs`, `pacsArchive.ts`) — it does **not** create a
second pusher. It adds the missing piece: a pure, fail-closed **eligibility +
tag policy** that decides whether a study's report may go back to PACS and what
DICOM tags it carries.

## Gap map

- `archiveReportToPacs` already renders the signed report to PDF, wraps it as an
  encapsulated-PDF DICOM (SOPClass `1.2.840.10008.5.1.4.1.1.104.1`), POSTs to
  Orthanc `/tools/create-dicom`, and records per-revision archive rows + audit.
- **Missing:** a USG-specific, fail-closed gate deciding *eligibility* — it did
  not enforce "obstetric ⇒ PCPNDT-compliant", "latest version only", or "never
  fabricate a StudyInstanceUID" as a single testable policy before a push.

## Delivered (pure + unit-tested)

| Module | Capability |
|---|---|
| `usgPacsReturnPolicy.ts` | `planUsgPacsReturn(study, report, pcpndt?)` → eligibility decision + canonical encapsulated-PDF tags + a deterministic per-version idempotency key. **Fail-closed:** finalized/verified/signed only (never a draft); superseded versions never auto-returned; missing StudyInstanceUID blocks (identity never fabricated); an **obstetric study requires a COMPLIANT PCPNDT result** — missing or non-compliant blocks and surfaces the canonical Form-F errors. Tags link the report to the study as a **new report series** — never reusing/overwriting a source-image series. |

**Tests:** 10 new (`usgPacsReturnPolicy`) — all green. Full-workspace `pnpm typecheck` 0 errors; flag-registry validation (`radiologyOpsHealth`) green with the new entry.

## Non-negotiable constraints honored

- **No second pusher / store.** The policy gates the canonical `archiveReportToPacs`; all PDF/DICOM/Orthanc/DB machinery stays canonical.
- **PCPNDT stays fail-closed.** OB studies are blocked unless the canonical `checkPcpndtFormFCompliance` result (passed in by the caller) is compliant; a missing evaluation blocks. The regulatory guard never fails open.
- **AI never signs/finalizes.** This layer only *returns an already-signed* report; it cannot create or finalize one.
- **No source-image mutation.** New report series only; Orthanc mints Series/SOP UIDs.
- **Flag default OFF, `wired:false`.** No automated return runs until enabled.

## Remaining P6 integration (documented, needs live Orthanc)

1. Behind `ff_radiology_usg_report_to_pacs`: at USG finalize, run
   `checkPcpndtFormFCompliance(patientId)`, then `planUsgPacsReturn(...)`, and on
   `eligible` call `archiveReportToPacs(studyId)` (passing the policy's tags).
2. Surface `blockReasons`/`errors` in the workspace when a return is blocked.
3. Persist the idempotency key alongside the canonical archive-revision row to
   make re-push idempotent.
4. **Clinic validation needs a live Orthanc** — the CI container has no PACS, so
   end-to-end create-dicom/echo could not be exercised here (documented, not faked).

**Flag stays OFF** until validated on staging with a real Orthanc.

## Classification

**CODE COMPLETE (policy core) — ORTHANC WIRING & CLINIC VALIDATION PENDING.**
