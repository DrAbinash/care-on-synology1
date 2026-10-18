# CARE RADIOLOGIST Open WebUI assets — preservation inventory and audit

Measured 2026-10-18 on `feature/reporting-workspace-mode-a` at `f2fd1d97`.
Every number below was produced by the scripts in `tmp/owui-*.cjs` against the
owner's three files; nothing here is inferred from filenames.

## 1. The three assets

| Asset | Path as supplied | Size | sha256 |
| --- | --- | --- | --- |
| Model export (JSON) | `Downloads/care-radiologist--report-composer-1792343779814.json` | 100,383 chars | see §2 |
| LS Spine knowledge (ZIP → 1 txt) | `Downloads/CARE MRI LS SPINE V1.2.zip` | 23,696 chars / 993 lines | — |
| Brain knowledge (ZIP → 1 txt) | `Downloads/CARE MRI BRAIN V1 (1).zip` | 43,042 chars / 1,554 lines | — |

Durable copies: `C:/Users/Admin/Documents/CARE-AI-ASSETS/openwebui-composer-2026-10-18/`
(originals + both extracted `.txt`). Working copies: `tmp/owui-assets/` (gitignored).

## 2. What the model export contains

Open WebUI exports a **model record**, not a knowledge base.

- `params.system` — the Master System Prompt V4: **32,574 chars, 1,390 lines**,
  133 headings, 30 numbered sections, ending `END OF CARE DIAGNOSTICS / RADIOLOGY
  REPORT COMPOSER MASTER SYSTEM PROMPT V4`.
- `base_model_id`: `qwen3:14b`.
- Generation parameters, complete: `temperature 0.15`, `top_p 0.85`,
  `repeat_penalty 1.05`, `think false`, `seed 42`, `max_tokens 1800`.
- `meta.capabilities`: `file_context true`, `file_upload true`,
  **`vision false`**, and everything else false. The composer model is not a
  vision model — consistent with Mode C needing a separate Qwen3-VL 8B.
- `meta.knowledge`: **4 entries** — 2 `type:"collection"` (which carry their text
  in `description`) and 2 `type:"file"` (which carry **only** `id`, `name`, `type`).

## 3. Are the JSON references duplicates, distinct sources, or attachments?

**Measured: one is a byte-identical duplicate, one is a stale truncated copy, and
both `type:"file"` entries are attachment pointers whose content the export does not carry.**

| Reference | Relationship to the ZIP | Evidence |
| --- | --- | --- |
| `CARE MRI LS SPINE V1.2` (collection) | **Duplicate.** Collection `description` and the ZIP `.txt` are identical: both 23,696 chars, sha `b1172beaea9d`. | `tmp/owui-inventory.cjs` |
| `CARE MRI BRAIN V1` (collection) | **Stale.** 38,841 chars vs the file's 43,042. Identical to char 38,717, then the collection ends with the `END OF … V1.0` footer while the file continues. It carries 57 of the file's 62 numbered sections. | `tmp/owui-brain-sections.cjs` |
| `CARE MRI BRAIN V1.txt` (file) | Pointer only — no content field. | keys are `id,name,type` |
| `CARE MRI LS SPINE RULES V1.2.txt` (file) | Pointer only — no content field. | keys are `id,name,type` |

**The five sections the JSON export loses** (present only in the ZIP):

- §58 DIAGNOSTIC SYNTHESIS — OBSERVATION TO RADIOLOGICAL DIAGNOSIS
- §59 CHRONIC ISCHEMIC FINDINGS — SYNTHESIS
- §60 CLINICAL INDICATION IS NOT THE EXAMINATION NAME
- §61 BRAIN REPORT ENDING — AVOID REDUNDANT SECTIONS
- §62 FINAL IMPRESSION PRIORITIZATION — ISCHEMIC EXAMPLE

4,325 chars — **10 % of the brain module** — and they are precisely the
diagnostic-synthesis rules the owner listed under "preserve the clinical
intelligence". This directly answers the instruction not to assume the JSON
export reproduces the retrieval environment: **it does not.** The authoritative
brain text is the ZIP; the collection Open WebUI retrieves from is an earlier
revision. Whatever the owner benchmarked as "excellent" was produced against the
57-section collection, so the §58–§62 material is either untested in Open WebUI
or was added after the collection was built — **owner decision: which brain
revision is authoritative, and should the collection be re-uploaded with §58–§62?**

Also note §21 of the master lists **six** study-specific modules (BRAIN, LS SPINE,
CERVICAL SPINE, CT, USG, MAMMOGRAPHY) while only **two** are attached. Four are
not in this delivery at all.

## 4. PHI / secret scan

`tmp/owui-phi-scan.cjs` over all three assets: **no** emails, no key or bearer
literals, no `password=` assignments, no credential-bearing URLs, no IPs, no
DOB-shaped dates, no MRN/UHID/accession values, no patient names, and no chat
history key in the JSON. The only 10+-digit matches are the record's own
`created_at` / `updated_at` Unix timestamps. One internal identifier is present:
`user_id = 68ab90dc-15d0-4ea3-bf0e-ebd5893510cf` (an Open WebUI account UUID) —
should be dropped before any commit.

The content is rules and examples, not case data. The blocker to committing is
**publication**, not PHI: see §6.

## 5. Gap against the repo's current Mode B implementation

The repo's AI prompt is `artifacts/api-server/src/lib/reportComposer/persona/`
(17 files, 42,811 bytes total). Findings verified by reading the files:

**Present in the repo:** clinical-truth/presentation split (`master.ts:16`,
`index.ts:45,81`); non-invention prohibition (`master.ts:31`, `safety.ts:33-35`);
measurements/laterality/levels (`safety.ts:12-27`, `master.ts:23-25,34`);
no-enhancement-on-non-contrast (`master.ts:26`, `safety.ts:29-31`,
`mriBrain.ts:43-45`, `ct.ts:20-24`); bulge/protrusion/extrusion
(`mriSpineLumbar.ts:11`).

**Absent from the repo, present in the OWUI assets** (zero hits across all 17
persona files for `synthes*`, `morpholog`, `impingement`):

1. **The *permission* to synthesise.** The repo encodes only the prohibition.
   OWUI §3B/§14/§15 define supported radiological synthesis as a duty, and
   §30 STEP 2 makes it a gated step. `style.ts:23-24` actively bans the
   Conclusion section OWUI §34 provides for it.
2. **Stenosis must not be inferred from the AP canal diameter.** OWUI
   `ls-spine:486-488,538`. Not in the repo — and the repo's own YAML *contradicts
   it* (below).
3. **The contact → abutment → impingement → compression ladder** (OWUI
   `ls-spine:376-400`). The lumbar persona has one sentence (`mriSpineLumbar.ts:12`)
   and no word "impingement". Worse, `validateOutput.ts:745,748,751` treats
   `impingement` and even `contact` as *preserving* `compression` — the validator
   accepts the exact downgrade §16 prohibits.
4. **Morphology as a named conservation claim** — absent from the persona;
   survives only inside `validateOutput.ts:734-760`.
5. **Routine normal-anatomy completion.** The repo says the opposite:
   `master.ts:33`, `safety.ts:43`, `index.ts:93` "Do NOT complete anatomy".
   OWUI §5 and §30 STEP 4 require completing appropriate normal background
   anatomy while never contradicting supplied findings.
6. **"Clinical indication is not the examination name"** (brain §60) — absent.

**Three hard CONFLICTS between the YAML packs and the OWUI modules** — these are
the "one authoritative clinical definition" decisions, with file:line:

| # | Subject | Repo says | OWUI says | Verdict |
| --- | --- | --- | --- | --- |
| C-1 | Stenosis vs AP canal | `mri_ls_spine.yaml:197` rule `mrls.canal_stenosis.c1`: "Stated stenosis grade does not match canal AP diameter" — *requires* grade to track the diameter. `_shared_libraries.yaml:76` defines `meas.canal_ap` with **no bands at all**, so the rule cannot evaluate. | `ls-spine:486-488` "DO NOT diagnose stenosis solely because … AP canal diameter is reduced"; `:538` "Do not infer stenosis grade from AP diameter alone" | **CONFLICT + dead rule.** The checker implicitly licenses the inference the module forbids, and has no bands to compare against. |
| C-2 | Nerve-root effect | `_shared_libraries.yaml:25` `param.root_involvement: [abutting, indenting, compressing]` — three steps, no impingement. `validateOutput.ts:745,751` accepts `impingement`/`contact` as preserving `compression`. | `ls-spine:376-400` four distinct grades; `:390-398` forbids trading one for another | **CONFLICT.** Two vocabularies and a validator that treats distinct clinical grades as synonyms. |
| C-3 | Enhancement in the normal brain | `mri_brain.yaml:42` `impression_fragment: "…or abnormal enhancement."` — unconditional, attached to the `mrbr.normal_study` tile a radiologist clicks on a **plain** MRI. Persona (`mriBrain.ts:43-45`, `safety.ts:31`) forbids the model writing enhancement without contrast. | brain §19 `:539` + master §8 contrast integrity | **CONFLICT.** The deterministic path injects the statement the AI path is forbidden to produce. |

**Structural gaps — the repo cannot host the OWUI configuration as-is:**

- **No retrieval reaches the composer.** `lib/ai/embeddings.ts` and
  `/rag-search` (`routes/aiReporting.ts:2447`) exist but their only consumer is
  the admin page `AiSearchRetrieval.tsx:44`; no composer file imports either.
  The content-pack YAMLs have exactly one reader —
  `routes/radiologyContentPackTiles.ts`, which serves them as Quick Select tiles
  and has **no frontend caller** (the strip uses hardcoded
  `quick-select-tiles.data.ts`). `knowledgePackManifest.ts:29` documents itself
  as having "no dedicated live table today". So the repo is a **static prompt
  only** and cannot reproduce Open WebUI's knowledge-retrieval behaviour.
- **The context ceiling cannot hold the prompt.** `num_ctx` is clamped to 8,192
  (`voiceReportComposer/runtimeConfig.ts:58`), while Master V4 alone is 32,574
  chars and the two modules add 66,738 more. Sending them verbatim is not
  possible today; this needs a section-selection strategy, not a bigger clamp.
- **Three of six generation params are not sent.** `ollamaComposerAdapter.ts:71-84`
  sends `temperature`, `num_ctx`, `num_predict` and hardcodes `think:false`,
  `format:"json"`, `stream:false`. **`top_p`, `repeat_penalty` and `seed` appear
  nowhere in the composer path** (repo-wide grep, excluding tests/lockfile,
  returns only spec fixtures and `docs/architecture/radiology-ai/INDEPENDENT_AUDIT.md:203`
  finding F29, which already flagged this). `seed 42` missing means the
  reproducibility the owner's benchmarking depends on does not exist. `max_tokens
  1800` is not configurable either — `num_predict` is computed as
  `max(1024, ceil(input/2))` (`composerContextBudget.ts:40,72-75`).
- `persona/index.ts` has duplicated `case` labels — PROFESSIONALIZE at `:77` and
  `:108`, OBSERVATIONS at `:89`/`:120`, COMBINE at `:98`/`:129`. The second block
  is unreachable dead code.

## 6. Owner decisions needed before anything is committed

1. **Publication.** `DrAbinash/care-on-synology1` is **public** (confirmed by an
   unauthenticated `GET /repos/DrAbinash/care-on-synology1` → HTTP 200, no token
   used). Committing Master V4 plus the two modules publishes the clinic's
   composer configuration; deletion later does not un-publish it. The repo
   already tracks clinical libraries and the persona `.ts` files, so this may be
   accepted practice — but it should be a decision, not a side effect. Options:
   (a) commit all three; (b) commit only this inventory + hashes and keep the
   prompt text in the NAS/private archive; (c) move the repo to private first.
2. **Which brain revision is authoritative** — the 62-section ZIP or the
   57-section collection Open WebUI actually retrieves from (§3).
3. **The three clinical conflicts** C-1/C-2/C-3 (§5) — one ruling each.
4. **Are the missing four study modules** (cervical spine, CT, USG, mammography,
   named in master §21) coming, or is the master the only source for them?

## 7. What was not touched

No Mode A file was modified for this inventory; `git status` shows only the
gitignored `tmp/` additions. Per the owner's item 8, Mode A implementation
continues first and Modes B/C integration awaits a focused plan.
