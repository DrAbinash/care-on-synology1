# D2 P0 Repair — Final Engineering Report

**Date:** 2026-10-10
**Engineer:** Qoder AI (implementation)
**Repo / branch:** `care-pacs` `fix/d2-p0-services-accessor` (head `d5ed941`, base `origin/main` = `59da39f`)
**PR:** https://github.com/DrAbinash/care-pacs/pull/15  (open — NOT merged)
**OHIF pin:** v3.10.0 @ `0b6e9cba7613dba1df883985d3c821a86b3ba0ff` (unchanged)
**Staging under test:** ERP `http://192.168.1.137:8091`, OHIF `:3012`, Orthanc `:8043` (isolated `d2stg` stack)

**Decision honored:** SEND BACK → narrow D2 repair. No production deploy. No C3/D3. No D2 redesign.

---

## A. Exact root cause of P0

`window.CARE_DISPLAYED_IMAGE.resolve()` returned `{"error":"services_unavailable"}` in the live staging browser while `window.services` was fully populated (41 services, back-referenced by a real `servicesManager`).

Cause is in **patch 0001**, not the resolver:

- `platform/app/src/App.tsx:38` declares `let commandsManager, extensionManager, servicesManager` **with no initializer** → `undefined` at module-evaluation.
- `App.tsx:79-81` assigns them only inside the App init path (after `appInit` resolves).
- The shipped patch appended, at module top level:
  `window.__CARE_OHIF__ = { servicesManager, extensionManager, commandsManager };`
  This is a **value copy taken at bundle-evaluation time**, before init, so `__CARE_OHIF__` permanently holds three `undefined`s. ES live-export bindings don't help — that only affects imported bindings, not a plain object literal assignment.

**Which candidate cause, demonstrated:** *premature service capture* (initialization order + bundle-time value snapshot). **Not** minification: the object existed with all three keys and undefined values (`Object.keys(__CARE_OHIF__)` = the 3 keys; each `typeof` = `undefined`), which minification cannot produce. **Not** an incorrect service-manager reference — `__CARE_OHIF__.servicesManager` and `window.services.viewportGridService.servicesManager` resolve to the same real manager once init; the snapshot was simply taken too early. **Not** a second registry issue.

`care-measurement.js:47-49` uses the **identical** `__CARE_OHIF__.servicesManager.services` lookup, so one cause disabled the entire viewer D2/measurement layer. Confirmed in-browser: pre-fix `CARE_DISPLAYED_IMAGE.resolve()` = `services_unavailable`.

## B. Exact files changed

- `ohif/enterprise/patches/v3.10.0-0001-expose-care-ohif-services.patch` — replaced the eager object snapshot with a live `Object.defineProperty(window, '__CARE_OHIF__', { configurable, enumerable, get(){ return { servicesManager, extensionManager, commandsManager }; } })`. Also normalized the file to LF (it had stray CR bytes; GNU `patch` was silently stripping them).
- `ohif/enterprise/tests/care-displayed-image-bridge.test.cjs` — **new** (15 tests).

No consumer script (`care-displayed-image.js`, `care-measurement.js`) changed; no OHIF source outside the patch changed; OHIF pin unchanged.

## C. Why the repair is safe under OHIF initialization timing

The getter reads the module-scope bindings **at access time**, not at bundle-evaluation. A D2 capture is a `postMessage`-triggered read that happens only while the radiologist is looking at a rendered image — strictly after the App init effect has assigned the managers — so the getter returns the initialized `servicesManager` whose `.services` is the live map (`window.services.viewportGridService.servicesManager` is empirically that same object; `resolveDisplayedImage` needs `viewportGridService.getActiveViewportId` and `cornerstoneViewportService.getCornerstoneViewport`, both present post-init).

Fail-closed before init is preserved: if `__CARE_OHIF__` is read before the effect runs, the getter returns `{ servicesManager: undefined }`, `services()` → `null`, and `resolveDisplayedImage(null)` → `services_unavailable`. No timeout is introduced; no undefined manager is cached; no second registry is created. Proven by: patch dry-run against pinned `App.tsx` (`patch -p1 --forward` + `git apply --check` both clean), the in-repo timing simulation (eager→undefined, getter→live), and the real staging browser (`services_unavailable` before, correct identity after installing the committed getter).

## D. P1 verdict — NOT a defect (incorrect test expectation)

The acceptance report called `CARE_VIEWER_BRIDGE.getContext()` missing Series/SOP/frame a "P1 defect." Traced against the real D2 contract, that is **wrong**:

- `care-bridge.js` is the legacy **launch/study-level context** channel: it reads `StudyInstanceUIDs`/`SeriesInstanceUID`/`SOPInstanceUID`/`frameNumber` **from the launch URL** (`readUidsFromLocation`) and replies `care.viewer.context`. Staging launches OHIF with only `?StudyInstanceUIDs=…`, so Series/SOP/frame are correctly null — the URL only carried the study.
- The D2 image-identity channel is the **separate** responder `care-displayed-image.js`: `displayed-anchor-request` → `active-anchor` / `displayed-anchor-unavailable`, read from the rendered `imageId`, never the launch URL. Its own docstring forbids launch-URL sourcing: *"a URL says what CARE opened, not what the radiologist is looking at."*
- The ERP consumes image identity only from `active-anchor` (`ohifViewerBridge.handleCareOhifMessage` → `onActiveAnchor` → `setActiveAnchor`), never from `care.viewer.context`.

The contract does **not** require `getContext()` to carry image-level identity. Modifying it to do so would convert launch-time context into a cached clinical anchor — precisely what the brief forbids. **Legacy bridge left untouched.** Verdict: the P1 label was an incorrect test expectation, not a code defect.

## E. Staging endpoint isolation proof

Pre-fix `pacs_settings` (via `GET /api/radiology/pacs-settings`) pointed at **production/foreign** endpoints:

| key | was | now |
|---|---|---|
| `ohif_base_url` | `https://ohif.caredeoghar.com` (PROD) | `http://192.168.1.137:3012` (staging OHIF) |
| `dicom_web_base_url` | `http://172.16.1.139:8042/dicom-web` (foreign) | `http://192.168.1.137:8043/dicom-web` |
| `wado_base_url` / `wado_uri_base_url` | `http://172.16.1.139:8042/wado` | `http://192.168.1.137:8043/wado` |
| `default_viewer` | `WEASIS` | `OHIF` |
| `orthanc_http_port` | `8042` | `8043` |
| `pacs_ip` (row id 10, category `viewer`) | `172.16.1.139` | `192.168.1.137` |

Wrote via the admin API (`POST /api/radiology/pacs-settings`, staging-only, normal workflow), deleted a spurious duplicate row, and re-scanned: **CLEAN — no `caredeoghar|172.16|:8042|:3010|:8888` value remains in any of 26 rows.** Staging Orthanc confirmed live (`:8043` QIDO 200; OHIF at `:3012`; ERP at `:8091`). This is the recreated isolated staging DB (fresh bootstrap admin, empty worklist), not the clinic archive.

Caveat on the ERP container's `ORTHANC_INTERNAL_URL` (highest-priority base in the lookup resolver) — I cannot read/set container env from this box (no SSH/docker). The live capture probes below (Section G/H) confirm which Orthanc it actually reaches.

## F. Synthetic worklist creation method — BLOCKED, not bypassed

The only HTTP writer of `radiology_worklist` is `POST /api/internal/radiology/studies`, which requires `Authorization: Bearer $INTERNAL_API_KEY` and **fails closed** when the key is unset. No staff-authed worklist-create exists (verified by grep). The internal key lives in the staging container env, which this box cannot read (SSH to the NAS is refused; no docker here).

Per the instruction *"Do not bypass required study relationships merely to populate a worklist row,"* I did **not** fabricate a worklist via DB surgery or by inventing a shortcut. **Method left to the operator (paste-block on the NAS):** trigger the PACS→ERP ingest (orthanc-puller/care-erp-sync) so staging Orthanc's existing studies (`.9991.1/.2/.3`) produce genuine worklist rows, or call the internal endpoint with the staging `INTERNAL_API_KEY`. See Section Q for the unblock list.

Consequence: `verifyImageIdentityClaim` (draft path) short-circuits to `IMAGE_STUDY_UNKNOWN` whenever a draft has no study-of-record, so the draft-based positive path could not be exercised without a worklist — correctly fail-closed.

## G. Real-browser capture result (viewer half) — PASS with the committed fix

In live staging OHIF (`:3012`, study `.9991.3`, CINE series), with the exact code of the committed getter installed:

- **Before fix** (shipped eager-snapshot bundle): `CARE_DISPLAYED_IMAGE.resolve()` → `{"error":"services_unavailable"}` — P0 reproduced.
- **After fix** (live accessor): `resolve()` → `ok:true`, parsed `{studyInstanceUID:1.2.826.0.1.3680043.9.9991.3, seriesInstanceUID:…3.1, sopInstanceUID:…30101, frameNumber:1, frameNumberSource:"wadors-frames-segment"}`, viewportId `default`.
- The responder's outgoing envelope (what CARE receives), PHI-free:
  `{"source":"care-ohif","type":"active-anchor","version":1,"studyInstanceUID":"…3","seriesInstanceUID":"…3.1","sopInstanceUID":"…30101","frameNumber":1,"viewer":"ohif","requestId":"cap-1","seriesDescription":"CINE D2STG 8F"}`.

This proves the **viewer** half of "OHIF → CARE" for real. The single-session click-through (workspace → iframe → capture → DB) additionally needs (i) the staging `care-ohif` **rebuilt** from `d5ed941` (the running bundle is still the snapshot form; rebuild requires NAS docker) and (ii) a worklist row (Section F). Those are operator-side and are listed in Q.

## H. Server ownership verification result — live FAIL-CLOSED; a new defect found

Driving the live staging API against live staging Orthanc (`/api/radiology-annotations`, whose `verifyInstanceChain` asks the PACS directly with no worklist binding), all five claims returned **HTTP 201 `warningCode: IMAGE_PACS_UNREACHABLE`** and stored **null** Series/SOP/frame (study uid kept from the claim; identity deliberately not persisted). That is the D2 safety rule working — an unverifiable claim is never a durable identity.

But the reason it can *only* fail-closed here is a **separate defect (D2-P0b), not the P0**: `createOrthancInstanceLookup` builds `…/dicom-web/studies/{S}/series/{SE}/instances/{SOP-UID}` with header `Accept: application/dicom+json, application/json`. Orthanc **1.13.0** rejects that path/Accept:
- path-style `/instances/{SOP-UID}` → **400** (`This WADO-RS plugin cannot generate the following content type…`) — even with a single clean `application/dicom+json`.
- series-level `/series/{SE-uid}` → **400**.
- QIDO **with filter** `/studies/{S}/series/{SE}/instances?00080018={SOP-UID}` → **200** (returns metadata, `NumberOfFrames=[8]`).
- frames retrieve `/…/instances/{id}/frames/1` → 200 (what OHIF uses to render).

So Orthanc keys the retrieve/QIDO-single path by its **internal ID**, not the SOP UID, and the ERP's helper assumes the SOP-UID path. Against the clinic's real Orthanc, **server-side ownership verification can never return "verified"** — every capture lands "unverifiable," identity nulled. The request-level suite `radiologyImageIdentity.request.test.ts` passes only because its `MockDicomWeb` serves the path-style the ERP builds; this is a mock/production divergence (exactly the class my testing notes warn about). **D2-P0b is ERP-side and was deliberately left OUT of this PR** (out of P0 scope; "no unrelated changes in a PR"; "keep the smallest fix"). It must be fixed separately (use the QIDO `?00080018=`/`?0020000E=` filters, or map SOP→Orthanc id) and its mock made to match Orthanc's real negotiation.

## I. Persisted Study/Series/SOP/frame values (actual, inspected)

Live staging rows created during these proofs (isolated staging DB):
- draft id=2 (patient 990001, no study-of-record → drives `IMAGE_STUDY_UNKNOWN`).
- `radiology_image_references` ids 1-5 and `radiology_annotations` ids 1-5: each stored `study_instance_uid` = the claim, and `series_instance_uid`/`sop_instance_uid`/`frame_number` = **NULL** (fail-closed on the unverifiable PACS, Section H). These are the honest persisted values for the live path.

The intended *verified* persistence (study/series/sop kept, single-frame default dropped to null, multi-frame frame kept, out-of-range/foreign → refused) is specified and asserted deterministically by `radiologyImageIdentity.request.test.ts` (positive control keeps `study/series/sop/frameNumber`; single-frame `frameNumber`→null; `D2-R8b` keeps frame 17 of a 60-frame instance; `D2-R5/R6/I1/R8c` return 409). It could not be demonstrated as a live verified row because of D2-P0b + no worklist (F) — see Q.

## J. Multiframe result

Orthanc confirms the CINE instance `…30101` has `NumberOfFrames=8`. Frame handling matches the D2 frame rule everywhere exercised:
- Viewer (real browser): frame 1/8 baseline correct; frame navigation to 5/8 and last frame 8/8 correctly reflected `frameNumber` in the resolved identity (this session + prior T2/T7).
- Adapter logic (unit): a frame is reported **only** when the imageId names one; a frame-less WADO-RS slice yields **no** `frameNumber` (never fabricated to 1). `care-displayed-image-bridge.test.cjs` asserts both.
- Server: `decideFrame` keeps a real frame for a multi-frame instance and nulls a claimed frame-1 on a single-frame instance — encoded by `radiologyImageIdentity.request.test.ts` `D2-R8a/R8b/R8d`. Live verified value not obtainable here (D2-P0b).

## K. Cross-study refusal result

- Viewer: by design it reports whatever is on screen (it does not judge study ownership); refusal of a wrong study is a server-side concern.
- Server refusal (foreign study / SOP not in the study / SOP not in the claimed series → 409): **NOT verified live** — the live Orthanc path returns "unreachable" (D2-P0b) before the mismatch logic can produce a 409. My live cross-study POST (study `.1` + a `.3` chain) therefore returned `IMAGE_PACS_UNREACHABLE`, not the intended 409. The deterministic refusal is asserted by `radiologyImageIdentity.request.test.ts` (`D2-I1`, `D2-R5`, `D2-R6a/b`, `D2-R6c/d`) and `IMAGE_SOP_NOT_IN_STUDY`/`IMAGE_STUDY_MISMATCH`/`IMAGE_FRAME_OUT_OF_RANGE` codes exist in `lib/imageIdentity.ts`. Marked **NOT TESTED (live)** with cause.
- Viewer security refusals (unallowlisted origin; non-parent/opener sender → no reply) **are** tested and pass (`care-displayed-image-bridge.test.cjs`, and live in the prior acceptance session).

## L. Observation text preservation

The refusal path `onActiveAnchorUnavailable` (`useOhifViewerBridge.ts`, D2-I6) only shows a toast and deliberately **leaves the previous anchor and report text untouched** ("nothing here touches report text"). Not exercised live (no workspace, Section F). Deterministic behavior documented in code; the D2 refusal is a no-write by construction (the responder carries no identity on a refusal). Marked **NOT TESTED (live)**.

## M. Regression tests

- Existing D2 viewer tests preserved and green: `care-displayed-image-adapter.test.cjs` (18), `care-security.test.cjs` (25), `care-measurement-adapter.test.cjs` (10), `care-hanging-protocols.test.cjs` (8), `stack-wheel-scroll.test.cjs` (11), `index-html-injection.test.cjs` (22).
- New P0 bridge suite (15). PACS deterministic total: **109 pass**.
- `static-validate.cjs`: OK (frozen pin, D2 guard rules, injector). Only `nginx-dicomweb-path.test.cjs` fails — it spawns a **Python** mock Orthanc (no Python on this box); pre-existing/environmental, unrelated to the change (my diff touches neither nginx nor Python).
- ERP D2 identity logic: not modified by this PR; its `radiologyImageIdentity.request.test.ts` remains the owning regression gate (and is where D2-P0b's mock divergence must be corrected).

## N. Mutation results

Proved the gate can fail, then restored:
- **Premature-capture (M1):** temporarily wrote the original eager `window.__CARE_OHIF__ = { … }` back into patch 0001 → the shape-guard describe **failed** (2/2: no getter + eager assignment present). Restored the getter form; re-ran **15/15 green**; patch CR bytes = 0.
- **Frame fabrication (M2, standing guard):** `static-validate.cjs` asserts `doesNotMatch(/frameNumber…||1/)` on comment-stripped adapter code, and the bridge test asserts a frame-less imageId produces **no** `frameNumber`; `buildUnavailableAnchor`/adapter refuse rather than default to 1.
- **Missing service / viewport-0 / stale cache (M3-M5):** asserted directly in `care-displayed-image-bridge.test.cjs` — `servicesManager` undefined → `services_unavailable`; `getActiveViewportId()` null → `no_active_viewport` (never viewport 0); two requests with a changed live viewport → different `frameNumber` (no cache).
- **Bypassed ownership verification (M6, live):** every unverifiable/unknown claim stored NULL identity (Section H/I) — the client/DB never accepts an unverified DICOM identity.

## O. CI results

`care-pacs` has **no GitHub Actions workflow** (confirmed: no `.github/` on `origin/main`). Its real build gate is the Dockerfile, which applies `v3.10.0-*.patch` with `patch -p1 --forward` and **fails the build if a patch doesn't apply**. I reproduced that gate locally: the edited patch applies cleanly to pinned `App.tsx` (`patch -p1 --dry-run` and `git apply --check` both pass; file is LF, no CR-strip warning). Quality gates run here: PACS `node --test` = 109 deterministic pass (+1 environmental Python-only), `static-validate` OK. PR #15 checks reflect this repo's CI reality (none automated) — see P.

## P. PR

- **care-pacs PR #15:** https://github.com/DrAbinash/care-pacs/pull/15 — open, `fix/d2-p0-services-accessor` → `main`. NOT merged, NOT deployed.
- ERP side: no code change (P0 is viewer-side; P1 needs none). Staging config + synthetic rows are environment-only, not a PR. D2-P0b is a **separate** defect to be opened in `care-on-synology1` (owner decision) — deliberately not folded into #15.

## Q. Recommendation

**PR #15 (the P0 repair): READY TO MERGE** — root cause proven in-browser, smallest change, existing tests preserved, mutation proof green, applies cleanly under the pinned-build gate, no PHI/registry/timeout.

**D2 overall: SEND BACK** — the acceptance bar ("a successful real-browser OHIF → CARE → database capture") is **NOT met**, blocked by three things, only one of which is fixed:
1. ✅ P0 viewer exposure — fixed in #15.
2. ❌ **D2-P0b (new, blocking, ERP-side):** Orthanc 1.13.0 rejects the identity lookup's path-style `/…/instances/{SOP-UID}` (400); ownership verification can never return "verified" against the clinic's real Orthanc — captures silently null the identity. Fix in `lib/imageIdentity.ts`/`studyImageFetch.ts` (QIDO `?00080018=` / `?0020000E=` filters or SOP→Orthanc-id mapping) and make `radiologyImageIdentity.request.test.ts`'s mock match real Orthanc negotiation so the divergence can't hide again.
3. ❌ Environment/operator prerequisites: rebuild the staging `care-ohif` image from `d5ed941`; seed a legitimate worklist for a study present in staging Orthanc; both need NAS actions (no SSH/docker from this box).

**PILOT: NOT READY TO PILOT.** Until #15 is merged AND built into the viewer AND D2-P0b is fixed AND a real-browser capture is shown persisting a **verified** Study/Series/SOP/frame against the clinic's real Orthanc, D2 must not reach a patient.

**Operator unblock list (NAS paste-blocks, in order):**
1. Merge #15 after review; on the staging host rebuild `care-ohif` from `fix/d2-p0-services-accessor` (or `main` post-merge) and recreate the staging OHIF container.
2. Seed a genuine worklist: run the orthanc-puller/care-erp-sync against staging Orthanc `:8043` (studies `.9991.1/.2/.3` already exist), or `POST /api/internal/radiology/studies` with the staging `INTERNAL_API_KEY`.
3. Open D2-P0b: patch the ERP Orthanc instance lookup to Orthanc's real QIDO contract; verify live with `/api/radiology-annotations` returning `verified` (not `IMAGE_PACS_UNREACHABLE`) and a persisted `sop_instance_uid`.
4. Then re-run the full real-browser capture and inspect the persisted row.
