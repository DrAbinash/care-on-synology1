# ADR-005: Server-Side Same-Patient Validation for Linked Studies in a Combined Report (PR F design)

## Status

Proposed — **design only**. No PR F code is implemented by this document, on instruction.

## Date

2026-10-12

## Context

A radiologist can attach a second study to the open report. The attached study's findings
print as their own section, under one signature, in one PDF. The whole of the identity
guarantee today is a checkbox.

Measured at `f17562d0` (this worktree, PR E stack):

| what | where | what it actually does |
| --- | --- | --- |
| "Same patient only" | `LinkStudyDialog.tsx:39` — `if (samePatientOnly && currentPatientId != null && row.patientId !== currentPatientId) return false;` | A **client-side** list filter. It is un-tickable, it is bypassed entirely when `currentPatientId` is `null` (a study whose patient id has not resolved shows **every** row), and it never runs again after the list is drawn. |
| The link itself | `useDraftPersistence.ts:504` → `linkedStudyPayload(getState().linkedStudy)` | The linked study is serialized into the **draft payload the browser builds** (`multiStudyReport.ts:249-267`: `studyId`, `title`, `modality`, `studyDescription`, `region`, `accessionNumber`, `studyInstanceUID`). No patient field is sent, so nothing downstream can even check. |
| Finalization | `useStudyFinalize.ts:352,403,405` — `linkedForFinalize?.studyId`, `linkedStudyInstanceUID` | The client's values are forwarded as the finalize body. |
| The server | `grep -rn "linkedStudy" api-server/src lib/db/src` → **no matches** | There is no server-side reader, writer or validator of a linked study. The column does not exist; the request field is ignored. |

So the current answer to "may two studies from different patients be signed as one report?" is:
**nothing on the server prevents it**, and the client prevents it only while its own filter is
switched on and its own patient id happens to have resolved.

Two prior decisions make this worse rather than better, and both were correct in themselves:

* **#905** made the Composer's study identity server-resolved, anchored on
  `radiology_worklist.id`, precisely because client-supplied identity could not be trusted.
* **#883** binds DICOM `StudyInstanceUID` to a worklist row on exact accession only and records
  `study_uid_provenance` — which means the server *does* know, for a given study, whether it
  can prove who the patient is, and for how many studies it cannot.

The link path is the one place that still trusts the browser with an identity claim that ends
up on a signed clinical document.

## Decision

PR F adds **one server-side invariant, enforced at both write points**, and fails closed.

### The invariant

> A report may carry a linked study only if the server, from its own rows, proves that the
> open study and the linked study belong to the same patient — where "proves" means both
> studies resolve to a non-null patient identity through a source the server itself recorded,
> and those identities are equal.

`unprovable` is not `equal`. Absence of a mismatch is not a match. A missing identity on either
side is a **refusal**, not a warning.

### Resolution order for "who is this study's patient"

Reuse what exists; no new identity system.

1. `radiology_worklist.patient_id` for the row anchored by `radiology_worklist.id` (#905's
   anchor). This is the billing/registration truth.
2. If and only if the row is DICOM-bound: `dicom_studies` reached through the accession-number
   binding of #883, whose `study_uid_provenance` records how that binding was made.
3. Otherwise: unresolved → refuse.

Two studies are the same patient iff step 1 yields the same non-null `patient_id` for both.
Step 2 disagreement (worklist says patient A, DICOM says patient B) is itself a refusal with a
distinct reason — that is a data-integrity fault worth naming, not a permission question.

### Enforcement points

| point | behaviour |
| --- | --- |
| `POST` draft save with a linked study | Re-resolve both studies server-side. On mismatch or missing identity → **409**, the linked section is dropped from what is stored, and the refusal reason is returned in the body. The rest of the draft still saves: a refused link must not cost the radiologist the report they typed (this is #862's rule — a refused thing is not a failed thing). |
| Finalize / sign | Same check, **hard failure**: 409 and no signature written. A combined report across two patients must not be signable under any circumstances. |
| Print / PDF / export | The renderer keeps rendering whatever is stored; validation lives at the write, not in the renderer, so no second copy of the rule appears in the print path. |
| The link dialog | Stays as it is (a convenience filter). Its `samePatientOnly` toggle stops being a safety control and is documented as a list filter, which is all it ever was. |

### Refusal voice

The 409 uses `announceSignedMutationRefusal`'s established shape (PR #855–#863): the *code* in
`error`, the human sentence in the label, one sentence that names what was refused and why, and
no dead-end promise. Accepted strings, to be read on a screen before they ship:

* mismatch → **"Not the same patient"** / "The study you attached belongs to a different
  patient. Nothing was linked; your report is unchanged."
* unresolved → **"Cannot confirm the patient"** / "CARE cannot prove who this attached study
  belongs to, so it cannot be combined. Check the accession number or the DICOM link."

The third trap PR #863 caught applies here: the message must not promise a correction path that
does not exist. The action offered is *unlink*, which the dialog already does.

### What PR F does not do

* **No new identity system, no new matching.** Patient resolution is #905's anchor plus #883's
  accession binding, in that order.
* **No demographic fuzzy matching** (name + DOB + gender) as an automatic permission. It may be
  surfaced as a *hint* in the dialog later; it must never satisfy the invariant, because the
  failure mode is a silently-wrong merge of two patients' reports.
* **No schema change to add a `linked_study_id` column in the first PR.** If the draft's JSON
  payload is validated at write time, the invariant holds without a migration. A real column is
  the right end state (a link that only exists inside a JSON blob cannot be indexed, audited or
  cascade-checked when a patient merge happens), and it is deliberately deferred so the safety
  property lands before the modelling argument does. When it lands it needs a
  `migrations/*.sql` file — `care-db-patch-v2` is the only thing that touches the clinic's
  database, and a `db:push` step is not it.
* **No UI for combining reports** beyond today's dialog; PR E's task list already covers the
  surfaces.
* **No relaxation of entity scoping.** HH/HM scoping rules are unaffected by an
  admin-role check being added to a route.

## Consequences

* The unsafe path closes at the only place that can close it. Today's guarantee is a checkbox
  in the browser of the person doing the merging.
* Fail-closed means a clinic with poor accession hygiene will see refusals on studies it
  currently combines happily. That is the correct direction — but it needs the rollout below,
  not a flag-day.
* A draft that was saved *before* PR F with a mismatched link is not touched by validation at
  save. It is caught at finalize, which is where the signature happens, and a report already
  signed cannot be re-opened by this rule (the signed-mutation boundary already refuses content
  writes; PR F does not add a withdrawal path).
* Validation at save costs two indexed lookups per draft write that carries a link. It runs on
  the same request path that already resolves the study, so no new round trip.

## Rollout

1. Land the resolver + the finalize check behind `ff_radiology_linked_study_validation`
   **default OFF**, and log what it *would* refuse for a week of real use. The count is the
   evidence that decides whether "fail closed" is safe for this clinic today.
2. Turn it on for finalize first (that is where the signature is), leave save in log-only.
3. Enforce at save once the log shows the unresolved population is understood, with the
   operator-facing page already named.
4. Add the real `linked_study` column + migration once the rule has proven itself, and move the
   JSON payload into it.

A feature flag here is defensible only because the flag's OFF state is today's behaviour, not a
weaker one. Anything that *weakens* a check behind a flag is out of scope.

## Verification plan (the tests PR F must pass)

Red first, against the real router over supertest (`*.request.test.ts`, scratch Postgres on
5445, marker-scoped fixtures that clean up after themselves):

1. same patient, link attached → save 2xx, finalize 2xx, print contains both sections.
2. **different patients → save 409 with the named reason, draft body still saved, linked
   section absent.**
3. **different patients → finalize 409 and no signature row written.**
4. open study's `patient_id` null → both endpoints refuse (fail closed, not "no mismatch").
5. linked study's `patient_id` null → same.
6. worklist patient ≠ DICOM-bound patient on the same study → refuse with the
   identity-integrity reason.
7. a link crafted in the request body (never chosen in the dialog) → still refused: the check
   reads the server's rows, not the payload's claim. This is the test the UI filter can never
   pass, and the reason the ADR exists.
8. withdrawal/unlink → the report returns to single-study and finalizes.
9. mutation proofs: delete the finalize check → 3 must fail; make the resolver fall back to the
   payload's own `patientId` → 7 must fail; invert the null handling to "allow when unknown" →
   4 and 5 must fail.

## Future review

* When patient merge/reconciliation is implemented, every linked-study row must be re-validated
  afterwards; the invariant is per-write, not permanent.
* If #883's `study_uid_provenance` is ever backfilled, step 2 of the resolution order gets
  stronger and the unresolved-refusal rate should be re-measured — that rate is the number to
  watch before enabling enforcement at save.
