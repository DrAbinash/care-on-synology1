# PROJECT STATUS — CARE ERP (final handover)

Baseline: `care-on-synology1` **`origin/main` = `5ebc88f3`**, read **2026-10-21 08:29Z (13:59 IST)**.
29,705 tracked paths, 437.5 MiB, CI **3/3 green at the tip** (`Tests + migration smoke` success 07:48:37Z).
Every number below was re-derived from the tree or the GitHub API at this baseline; the command is printed
with it so you can re-check in a minute. Nothing here is taken from a PR title or a badge.

Vocabulary used throughout — these five states are **not** interchangeable:
**written in code → tested → merged to `main` → deployed to the clinic → verified by a clinician on a real
report.** Most of this project's problems are rows sitting at "merged" that people read as "done".

---

## 1. Where each area stands

| Area | Merged into `main` | In the clinic today |
|---|---|---|
| **ERP core** (worklist, billing, day close, drugs, patients) | Yes. Money-integrity and ledger concurrency fixes are on `main` and green | **No.** The deployed build predates all of it (see §2) |
| **Reporting / Composer / Quick Select** | Yes: Phase 2 regional corpus + three engine fixes (#1097), the 16-step integration journey (#1096), facet contradiction + signer authority (#1090/#1091). **Draft #1105 (Phase 3, 27 files) is open and red** | **No** |
| **AI (drafting, comparison, vision, audit)** | Yes: audit shows egress columns (#1094), an empty answer can no longer be filed as success (#1099/#1107/#1108), vision capability now trusts the server over the model name (#1098), the local-vision A/B benchmark no longer scores a timeout as a preserved measurement (#1106), and **the interactive doors can no longer be shown an arbitrary study's frames (#1109)** | **No** |
| **Printing / PDF / signing** | Yes: unsigned reports print `NOT SIGNED` instead of borrowing the workstation's signature (#1093), Word export no longer re-merges live text, a signature block belongs to its owner (#1100), and a signed report's signer display is frozen so editing the clinic style row afterwards cannot rewrite who signed it (#1103) | **No** |
| **PACS / imaging (D2, OHIF, Orthanc)** | D2 displayed-image identity and the image-picker work are merged in `care-pacs` + ERP; the `presentation_json` migration is applied only where a DB was rebuilt | **No**, and D2 has never been browser-proven on the merged tree |

**One sentence:** the software on `main` is substantially safer than the software in the clinic, and none of
that improvement is reaching patients until someone deploys.

---

## 2. Merged is not deployed — the size of the gap

`git rev-list --count --since=2026-10-12T22:30:00Z origin/main` → **132 commits**.
Last verified deploy: **2026-10-12**. The gap has grown 106 → 108 → 111 → 114 → 117 → 121 → 124 → 126 → 132
across one day of merges; each figure was correct when measured, which is why the instruction is to re-run
the command, not to remember the number.

**Deploy mechanics** (`deploy-synology.sh`, read at this baseline): `git fetch` + hard reset to
`origin/main` → `docker compose up -d --build` → **Step 4 waits up to 120 s for container
`care-db-patch-v2` to exit 0**. A non-zero exit prints the last 30 log lines and **`fail`s the script — the
deploy stops there.** `care-db-patch-v2`, not `drizzle-kit push`, is what the clinic actually runs, which is
why every schema change needs a `migrations/*.sql` file.

The NAS was not contacted for this handover (standing rule). The deployed SHA therefore stays a dated,
carried-forward fact, not a live reading.

---

## 3. Open issues that can affect a patient, a report, a signature or the day

Only these. Everything else in the corpus is either closed or cosmetic.

1. **Signature ownership is decided but not yet in force, and it is partial by design.** (#1100, `daff1400`)
   A block may now authorise a report only for its owner, refused server-side at `patient-reports.ts:2654`
   (`POST /:id/sign`), `:709` (inside `performStructuredVerify`, reached from `POST /:id/verify` at `:2739`),
   `:2771` (the same route's other branch), and in the signature manager's own `PATCH :1337` / `DELETE
   :1375`, with no administrator exemption.
   Two conditions keep it from being real today: (a) the `signatures.user_id`
   column does not exist in the clinic database until the migration runs; (b) a block whose `user_id` is
   **NULL** — every pre-existing block whose display name did not match **exactly one** account —
   **stays usable by any staff session** and is only audited as `owned: false`. The migration refuses to
   guess, which is right, but it means **the protection covers claimed blocks only, and nobody has counted
   the unclaimed ones.** That count needs one read-only query on the clinic DB.
   *State: coded, tested, merged, browser-checked by its author; not deployed, not independently verified.*
2. **A signed report's signer block is frozen as of #1103 — but the freeze is write-once.** Withdrawing and
   re-signing keeps the **first** signing's flags; a pinned `?template=` is then silently ignored; and
   `?useUpdatedStyle` still switches to live layout. These three are open owner questions named in the PR
   body, not bugs I found.
3. **`verify` is still the one signed-artifact door with no unreviewed-AI gate** (amend, sign and structured
   finalise all have one). It became reachable for real users when #1093 fixed the dialog crash, so this is
   now a live path rather than a theoretical one. Needs a ruling, then one rule in code.
4. **Draft watermark precedence.** `artifacts/diagnostic-erp/src/lib/draftAwarePrintSettings.ts:48` — any
   non-empty clinic-configured watermark **outranks** the `DRAFT` mark, so an unauthorised document can
   leave a station with no draft indication. Pinned by `draftPrintSafety.test.ts` as intended; confirm or
   overrule.
5. **Two Impression-integrity defects that #1097 found and deliberately left failing** (pinned `it.fails`,
   so CI reports them as known): **R2-6** a same-slot upgrade leaves the vacated assessment's stale
   fragments; **R2-4** an assessment tile adds over a format-owned contradicting assessment, because
   format-started studies seed no impression ledger row. Both need a ruling on the Findings↔Impression
   contract before anyone codes them.
6. **Structured Findings edits are invisible to dirty-detection, the leave warning and the local backup**
   (R-14): `artifacts/diagnostic-erp/src/lib/workspaceReportState.ts:63-71` hashes only
   `ch, t, rf, im, re, qs` — **not `findingsMap`** — and `isReportDirty` reads that same string. A clinician
   can lose structured findings on a navigation they were never warned about.
7. **Key-image fetch failures are swallowed at the reader** (R-10):
   `artifacts/api-server/src/lib/reportImages.ts:147` and `:186` both `if (!res.ok) return null;`, and
   `resolveDraftKeyImages` turns that into `src: src ?? ""` (`:254`). The page no longer stays silent, but
   the reader still cannot tell "this study has no key image" from "the image failed to load".
8. **CI clocks, not clinical code.** Two test files run against Vitest's 5,000 ms default with no declared
   timeout: `quickSelectClickOrderCensus.test.ts:174` (measured 2.3–2.9 s on this box; it timed out on
   `main` at 03:46:57Z and made trunk red for a few hours over a markdown-only merge) and
   `composerIntegrationJourney.test.ts:124`. PR **#1102** fixes the first, test-only, with no assertion
   changed; it is still open, its base (`27f53bda`) is 8 commits stale, and its CI is red — **but not on its
   own change**: the failing test is `providers.test.ts:318` (`"returns an error for an unresolvable
   hostname"`, a `.invalid` lookup) timing out at 5,000 ms. That is the third clock: the PACS **SSRF guard
   has an uncapped DNS lookup** (`providers.ts:240` → `dns.lookup` at `:248`; `tcpProbe` caps only its
   socket at `:292-294`), so a slow resolver spends the whole test budget. `providers.ts`/`providers.test.ts`
   are byte-identical between `27f53bda` and the green tip, which is what makes this intermittent rather
   than a trunk break. It is an availability question about a fail-closed control, and the file belongs to
   another owner, so it needs its own change.
9. **Draft #1105 (Composer Phase 3) is red for its own reason, not a flake:** three assertions in
   `scripts/src/generateQuickSelectFactoryBoxes.test.ts` fail together — `:71` "the newest seed revision
   carries `41e77e7f842c` but the catalogue now hashes to `ab5dc90eedb5`", `:81` the generated file header
   differs, `:87` expected 6 boxes got 7. Its base (`6fd16cda`) predates merges that moved the tile data,
   so its factory seed and migration hash are stale. Fix = regenerate the seed and re-name the migration,
   by Z.ai. It also carries a **fourth** migration (`…_quick_select_factory_boxes_r006_41e77e7f842c.sql`,
   +295).

---

## 4. Pending database migrations and what deploying requires

`git log --format='%h' c199aea2..origin/main` × `git show --name-only | grep '\.sql$'` → **three unapplied**
on `main`, none of them run in the clinic:

| Migration | Came with | What it does | Re-run safety |
|---|---|---|---|
| `zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r006_215e2a0c52d9.sql` (+286) | #1097 | Seeds Quick Select factory boxes for the regional tiles | **Not idempotent.** A bare `INSERT INTO radiology_quick_findings (…)` at `:259`, no `ON CONFLICT`, no `BEGIN/COMMIT`, against a table with five unique indexes incl. `radiology_quick_findings_factory_key_uq` → a second run should raise a unique violation, and per §2 that **halts the deploy** |
| `zzzzzzzzzzzzzzzzzzzz_signatures_owner_user_id.sql` (+60) | #1100 | Adds `signatures.user_id` + a deliberately narrow name backfill | Idempotent (`ADD COLUMN IF NOT EXISTS`, no `INSERT`). No FK, no `NOT NULL`, no default — stated reason: an FK would refuse historical reports whose signer was deleted, and a default would make every old block look owned |
| `zzz_ai_audit_success_default_false.sql` | #1108 | Flips the AI audit `success` column default to **false** | Follows the exact shape of the `anonymized` guard, which exists because #804 once changed a default in the schema and shipped no migration, so live DBs kept the old default for months |
| *(pending in Draft #1105)* `…_r006_41e77e7f842c.sql` (+295) | not merged | Superseding factory seed | Same non-idempotent shape; and it currently **conflicts in intent** with the `215e…` file above — check which revision wins before deploying twice |

**Deployment checklist, in order:** (1) read `deploy-synology.sh` Step 4 with these three files in mind and
decide the order; (2) back up first — the migration chain is append-only and never rewinds; (3) deploy;
(4) confirm `care-db-patch-v2` exited **0**, not just that the containers are up; (5) verify the running
commit identity from the served bundle, not from `build.commit` (it has lied before); (6) print **one real
signed report and one unsaved draft** from the clinic and look at them — that is the step that moves rows
from "merged" to "clinically verified", and it has not been done for any of §1.

---

## 5. Repository privacy — the legacy report corpus

The repository is **`visibility: public`** (`GET /repos/…`, re-read at this baseline). Two directories
account for **70.7% of tracked bytes and 82.7% of tracked paths**:

| Path | Files | Bytes | Last touched | Contains |
|---|---|---|---|---|
| `docs/report-formats/` | **4,990** | **281.2 MiB** | `cab0d9c1`, 2026-07-22 — unchanged since | Historical clinic report files (`.doc`/`.docx`), per modality **ct 2,016 · usg 1,962 · xray 691 · mri 320**, plus one `README.md` at the directory root. A read-only scan for structure, not content, found **4,161 files carrying a clinical header block** and **738 files sitting under name-shaped directories** |
| `.SynologyWorkingDirectory/` | 19,596 | 28.5 MiB | `5cb9956e`, the initial 2026-06-27 upload | Synology Drive Client's own signature cache. Every blob checked: opaque binary, zero/tiny, or no long printable run, no word-like sequence, no date or phone shape → **hygiene, not privacy** |

**Exposure category, stated without reproducing content:** the corpus is real clinical documentation from
this clinic. File *names* in it encode diagnoses and, in some cases, what look like patient-name
directories; bodies were **not opened** by this or any prior pass, so **no row inside them has been
classified**. Names are evidence of context, not proof of identifiers.

**Two honest limits.** (1) The four rendered PDFs in `artifacts/radiology-e2e-acceptance/reports-v2/`
(4 files, 2,522,239 B) are **unmeasured, not cleared** — PDF streams are compressed, so the printable-run
method works neither way. (2) The 15 corpus files that earlier counters kept dropping, in this directory
and in my own tooling, are **not a git quirk**: `git ls-tree` quotes non-ASCII paths by default
(`core.quotePath=true`), so a plain prefix match silently skips them. Those 15 are exactly the ones whose
names contain a typographic apostrophe or en dash inside eponymous diagnosis/procedure wording. The
corrected command is `git -c core.quotePath=false ls-tree -r -l origin/main`. Any future count that does
not set it is understated by design.

**Remediation is the owner's alone; nothing was done here.** Options, cheapest first: make the repository
private; move the corpus to a private/filtered store and keep only the derived
`radiology-findings-library.json` in the repo; untrack `.SynologyWorkingDirectory/` with `.gitignore`
(plus `git rm -r --cached`, which changes what the NAS's `git reset --hard` lays down, so it is an
owner/infra decision, not a cleanup). **Rewriting Git history is not recommended without explicit
approval** — the old commits and any clones/forks/network caches keep the files regardless, so a rewrite
alone does not undo a disclosure, and this repo's deploy path depends on `origin/main` history.

---

## 6. The five most important next actions

1. **Deploy `main`, migration-aware.** 132 commits and three schema changes are invisible in the clinic.
   Sequence it (§4), confirm `care-db-patch-v2` exit 0, then verify commit identity from the served bundle.
2. **Close the D-14 privacy decision** — public/private, retention, and which of the three remediation
   steps to take. Everything else in this document is quality; this one is exposure.
3. **Claim the signature blocks, then verify #1100 independently in a browser.** One read-only count of
   `user_id IS NULL` blocks, then a pass showing a colleague's block refused at all three doors, a retired
   block refused, "sign as me" still working, and PI-1's `NOT SIGNED` still holding.
4. **Un-stick the two open PRs.** #1102 needs only a rebase onto the current tip — its one-file change is
   not what is failing; its red is `providers.test.ts:318`, and the census timeout it fixes has since made
   `main` red once itself. #1105 needs its factory seed + migration hash regenerated (three assertions, one
   cause: base drift). Both are quick, and both currently deny people a green signal to trust.
5. **Rule on the four clinical decisions in §3** (verify-as-finalisation, watermark precedence, R2-4/R2-6,
   and R-14's findings snapshot). Each is one sentence from you followed by one small, testable change.

---

## 7. Decisions awaiting the owner

D-14 (legacy corpus) · D-10 residual (how long an unclaimed block stays usable, and whether NULL should
eventually be refused) · D-11 (is `verify` a finalisation?) · D-13 (may a configured watermark suppress
`DRAFT`?) · D-15 (is "not deployed" a policy or an accident?) · R2-4 and R2-6 (Findings↔Impression
contract) · #1103's three precedence questions · whether the PACS DNS cap goes in as its own change.
Owner-accepted and **not** re-raised here: Orthanc auth posture, DICOM replication.

---

## 8. What this document replaces (nothing was deleted)

`PROJECT_STATUS.md` is now the entry point for a status read. The ten existing files in
`docs/project-memory/` stay in place and remain the detailed record — `OWNER_DASHBOARD.md` (per-PR
evidence and CI readings), `CLINICAL_SAFETY_REGISTER.md` (the nine patient-facing failure classes),
`KNOWN_ISSUES.md` (open risks plus the verification traps), `COMPLETED_WORK.md`, `CURRENT_STATE.md`,
`AGENT_HANDOFF.md`, `OPEN_WORK.md`, `ARCHITECTURE.md`, `AUDIT_RECONCILIATION.md`, and `OWNER_VISION.md`
(the owner's own approved product statement, which is canonical and was not touched).

Nine of them carry a new five-line banner under their title marking them **detail of record** and pointing
here. That is the whole consolidation: no row, no verdict and no baseline-stamped history was removed,
because a register that only shows the latest answer loses the lesson — the duplication is what made them
read as competing current statuses, and the banner removes that, not the content. Do not delete these files
to "clean up"; they are the only place several findings' correction histories exist.

**Re-check this page in one minute:**

```
git fetch origin && git rev-parse --short=8 origin/main
git rev-list --count --since=2026-10-12T22:30:00Z origin/main        # the deploy gap
gh api repos/DrAbinash/care-on-synology1 -q .visibility              # D-14, right now
gh api "repos/DrAbinash/care-on-synology1/pulls?state=open"          # open work
git log --format='%h' $(git rev-parse origin/main) -- docs/report-formats | head -1
git -c core.quotePath=false ls-tree -r -l origin/main | wc -l        # tracked paths, correctly counted
```
