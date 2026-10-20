# OPEN WORK — what is not finished, and what is next

Two different lists, deliberately. §1 is **work in flight** (PRs, registers, unwired code).
§2 is the **ranked next ten**, ordered by the weighting the owner set: patient safety → clinical
workflow reliability → reporting speed → data integrity → system availability → AI reliability →
user experience → maintainability.

Baseline `origin/main` `c4462041`, measured 2026-10-20.

---

## 1. In flight

### 1.1 Open PRs — exactly one

**#1081** `feat/care-dev-isolated` — **DRAFT**, `mergeable_state: unstable` (checks pending/failing,
*not* a content conflict), head `469e928d`, 21 files +1801/−78. This is the only thing that makes the
intended Windows environment real (`CARE_DEV_ISOLATED`, `pnpm dev:isolated`, ports `8181`/`5173`,
database refusal). Until it merges, an agent on a laptop with a restored production `.env` can start
`pnpm dev` and reach the clinic's real integrations. `KNOWN_ISSUES.md` §1 calls this the most
consequential open item for the *development* environment.

### 1.2 Registers with live rows

| Register | Rows still open | Verbatim status |
|---|---|---|
| `docs/engineering/RIS-PACS-INTEGRATION-TODO.md` | RIS-007, RIS-009, RIS-011 (+ every `Deployed: no`) | RIS-007 *"CONFIRMED (code) / NOT REPRODUCIBLE live"*; RIS-009 *"PARTIAL — the Chromium multi-navigation re-probe was not re-run this session"*; RIS-011 *"TODO"* |
| `docs/CARE_ERP_PREDEPLOYMENT_GATE.md` CL-1..CL-10 | CL-1, CL-2, CL-3, CL-5, CL-6, CL-7, CL-8, CL-9, CL-10 | CL-2 *"NOT TESTED — the artifacts exist and are fresh; restorability is unproven"*; CL-9 *"FAIL — exposure, not a fault of this deploy"* |
| `docs/architecture/radiology-ai/AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` §13 | five owner decisions | *"Decisions the owner still owes before Stage 1 is implemented"* — includes which model interprets, and whether image-derived findings are provisional proposals or draft text |

### 1.3 Written but never wired

| Thing | Where | Evidence it is dead |
|---|---|---|
| Evaluation framework | `lib/ai/evaluationRunner.ts:36` `runEvaluation` | The only non-test occurrence in the repo is the definition itself |
| Night scheduler admission | `lib/ai/aiScheduler.ts:120` `admitJob` | Definition + tests only |
| Golden dataset | `lib/db/src/schema/aiEvaluation.ts:36` `ai_golden_cases` | Zero inserts anywhere (`grep -rn "ai_golden_cases" --include=*.ts`) |
| Orthanc→ERP fast path | `routes/internal-radiology.ts:1885` + `docker/orthanc/erp_notify.lua` | `PACS/orthanc/config/orthanc.json` carries **no** `LuaScripts` entry; `orthanc-webhook` appears nowhere in `care-pacs` |
| Super Admin portal dev leg | `package.json:12` filters `@workspace/super-admin-portal` | The package lives in `__super_admin_quarantine/` and matches no `pnpm-workspace.yaml` glob |
| USG workspace flag | `ff_radiology_usg_workspace` | *"still defaults OFF and gates nothing in the ERP"* (`usgWorkspaceContract.test.ts:29-32`) while the api-server rollout plan still lists it |

### 1.4 Feature work that stops short of "done"

* **Canal AP gap 4 — two stores at entry time.** Print is folded to one rule; the AI-tab box still
  writes both. Closing it needs viewer capture moved into the rail grid — an owner call about UI, not
  a defect (`docs/engineering/RIS-PACS-INTEGRATION-TODO.md` §"Remaining gaps").
* **V4 in a browser is unproven.** The local database has no dorso-lumbar reporting format, so the DL
  canvas and table never mount locally; `mriBrainCanvasPlacement.test.ts` is still a source-text
  guard over UI that renders zero elements (the `{false && (` block is deliberately disabled).
* **Composer durable Apply** — two-phase design with three columns, four things open.
* **Findings caret-reveal deferral** (#1031) — deferred until the acceptance battery can see it.
* **Critical-result comms** sit behind a default-OFF toggle (#843): shipped, not enabled.

### 1.5 CI integrity on `main` — smallest useful repair

`Tests + migration smoke` is **failing on the tip of `main`** (`c4462041`, run `39319802877`) on one
assertion: `aiReporting.imageEgress.request.test.ts` TEST 15 at `:965` compares two local-model arms as
an **ordered** list
(`expect(localChats.map(c => c.model)).toEqual([LOCAL_VISION_MODEL, SECOND_LOCAL_MODEL])`) and the
executor answered them in the opposite order. Everything else in the run passes (1127 files). The same
suite was **green at #1080's own head** `76fe43b0`, and `80a09df4`'s test job was **cancelled**, so
`main` has had no completed green test run since `6a31307f`.

That ordering is the decision to make: either arm order is meaningful and must be deterministic (then
the executor needs pinning and the `armIndex` assertion at `:960` is the weaker half of the proof), or
it is not (then the assertion should compare as a multiset, since "each model was called, and each got
both pictures" is the clinical invariant the test states in its own comment). Pick one, then show the
mutation that proves it — a red that every later PR inherits is how a real regression gets waved
through.

---

## 2. The next ten priorities

**Urgent** = a patient or the record is exposed until it is done. **Optional** = worth doing, not
dangerous to delay.

### URGENT

**1. Deploy `main` and prove the identity of what got deployed.**
Rank driver: *patient safety*. The merged P0 fixes for wrong-patient/wrong-exam identity (#1040,
#1042, #1044, #1058, #1047) are **not running**; the clinic is on a 2026-10-12 build whose commit
identity is unproven (the last recorded check showed `/api/health` reporting `2d51e8d7` while the
checkout was `46d36612` — refuted in `docs/CARE_ERP_PREDEPLOYMENT_GATE.md:357`).
Concrete shape: run `deploy-synology.sh` (a human decision, a clinic-outage window), then
`node scripts/verify-deployed-identity.mjs` **inside the api container**, not on the host.
This is the only item that makes the other nine visible to patients.

**2. Bind a backup to the deploy and produce one restore proof.**
Rank driver: *patient safety via recoverability*. CL-3: `deploy-synology.sh` takes **no** backup and
its own steps are `git reset --hard` → `compose down --remove-orphans` → `up -d --build`
(`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:721`). CL-2: **no restore has ever been proven**,
`public.backup_verification` has 0 rows. Item 1 without item 2 is an unguarded write to the only
copy of the clinic's records.

**3. Publish the uploads volume in the backup set.**
Rank driver: *data integrity*. Frozen key images live on disk
(`data/uploads/radiology-key-images`, volume `uploads_data`, `lib/frozenKeyImages.ts:33`) and drive
print/PDF when present (`:1-14`). A database-only restore silently loses every image in every signed
report. `scripts/verify-uploads-restore.mjs` exists; its verdict has never been recorded on the NAS.

**4. Merge or close #1081 so local development cannot reach the clinic.**
Rank driver: *data integrity*. A restored production snapshot carries real integration targets
(partner callbacks, SMTP, Orthanc at the NAS IP, WhatsApp config) and the API's boot path starts
consumers, pollers, warmers and reconcilers that read them. Today the only protection is an operator
remembering to unset `.env`. The refusal is the design: **refuse to start** unless `DATABASE_URL` is
the approved development database.

**5. Close the LAN exposure on the PACS box (CL-9).**
Rank driver: *system availability / confidentiality*. As recorded: `care-orthanc` **8042 and 5680**,
`care-ohif` 3010, `care-web` 8888 and the HOPE app 7080 are published on `0.0.0.0`; port 5680 is
`"5680:4242"` in `care-pacs/docker-compose.yml:70`, so *any device on the clinic LAN can C-STORE into
the production index unauthenticated* and read the whole DICOMweb query surface at 8042. `care-db` is
correctly loopback-only, which proves the fix is a two-line change of the same kind. Owner decision
on the publication/firewall surface; **this is a configuration change on shared infrastructure and
must not be done by an agent.**

**6. Resolve the callback address disagreement, then observe one HOPE delivery.**
Rank driver: *clinical workflow reliability*. CL-6 says the outbox has never had a row, while
`care.env`/README and `NAS_OVERNIGHT_ENV_PATCH.env` name two different hosts, one of which TCP-times
out. Fixing the retry logic (#995-#999) is invisible until a delivery is *seen* in
`integration_delivery_attempts`.

### OPTIONAL

**7. Give the deployed build a browser acceptance pass, and version the staging tree (CL-10).**
Rank driver: *reporting speed + trust in the evidence*. Staging runs beside production from
`/volume1/docker/care-d2-staging/care-erp`, **which is not a git repository**, so acceptance results
cannot be tied to a SHA, and `d2stg-orthanc` uses the unpinned `orthancteam/orthanc:latest`. Either
version the tree or stop presenting its verdicts as production evidence.

**8. Take up the five owner decisions in `AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` §13, then wire the
evaluation loop.**
Rank driver: *AI reliability*. Vision model choice is currently a name in settings
(`qwen3-vl:8b` is recorded as the default that returned empty twice); `runEvaluation`, `admitJob` and
`ai_golden_cases` exist with no caller (§1.3). Without a golden set, "the AI is getting better" is
unfalsifiable.

**9. Fix the documentation that contradicts the code, then make the corpus navigable.**
Rank driver: *maintainability*, but it is also the reason agents keep shipping stale claims. `KNOWN_ISSUES.md`
§2 lists seven verified cases, including a retention table that contradicts its own correction banner
14 lines above, and a checklist row that still marks the unwired evaluation framework ✅. Secondary:
`docs/` holds 278 `.md` files among 5,618, `Antigravity/` holds 101 more, there is no root `README.md`,
and this repo has **99 git worktrees**.

**10. Adopt the repository's own verification discipline as a PR gate.**
Rank driver: *maintainability + trust*. `grounding-check.cjs` already fails the build on 105
architecture claims; extend the same machine-checked treatment to the retention/egress claims that
are wrong today, keep preferring `*.request.test.ts` over source-text greps (`AGENTS.md:34` records a
green grep-test that shipped an HTTP 500 route), and record for every merged clinical PR which of
CI / local / browser / rendered-artifact actually ran.

### Deliberately not on this list

* **Do not automate NAS failover** — the standby plan says so explicitly
  (`docs/CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md:355`).
* **Do not re-raise the two owner-accepted risks** (Orthanc auth posture, DICOM replication) — they
  are recorded as accepted decisions, not defects.
* **No `db:push` against any real database**; schema changes go through `migrations/*.sql` and the
  `care-db-patch-v2` → `care-schema-verify` chain.
* **No port 80 assumption on Windows.** The emergency overlay defaults to host 8080 precisely to
  avoid elevation (`deploy/windows-emergency/docker-compose.windows.yml:5,12`).
