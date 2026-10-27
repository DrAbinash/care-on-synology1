# CARE RADIOLOGIST — clinical AI knowledge assets

Preserved from the clinical owner's working Open WebUI model
`care-radiologist--report-composer` (**CARE RADIOLOGIST- REPORT COMPOSER**), committed
under the owner's authorization of 2026-10-18. These are the configuration and
knowledge that produced the reporting quality CARE ERP is being built to reproduce.

**This directory is knowledge, not an engine.** No application code reads it. It must
not grow into a second clinical rule set: deterministic reporting stays in Mode A plus
`seeds/radiology/content-packs/`, and the Quick Select catalogue stays in
`radiology_quick_findings`. Mode B consumes these assets through the existing AI
provider abstraction in `artifacts/api-server/src/lib/reportComposer/`.

## Files

| Path | Role |
| --- | --- |
| `master-system-prompt-v4.md` | Master System Prompt V4 — 32,574 chars, 1,390 lines, 30 numbered sections. The single authoritative copy. |
| `mri-brain-v1.md` | **Authoritative** MRI Brain module — the complete **62-section** revision. |
| `mri-ls-spine-v1.2.md` | MRI LS Spine reporting module V1.2. |
| `model-configuration.json` | Non-secret model config: base model, sampling parameters, capability flags, knowledge-attachment metadata. |
| `benchmarks/mri-brain-v1-openwebui-57-sections.md` | **Benchmark only.** The 57-section revision Open WebUI was actually retrieving. Not an active knowledge source. |
| `originals/` | The three files exactly as supplied, unmodified — the provenance trail. |
| `SHA256SUMS` | Integrity record for every file here. |

Verify: `sha256sum -c SHA256SUMS` from this directory.

## Why a benchmark copy is kept

The export was measured rather than trusted, and it is **not** a faithful copy of the
knowledge environment:

- **LS Spine** — the export's collection text is **byte-identical** to the supplied
  ZIP. One revision, agreed.
- **Brain** — the export's collection text is a **stale prefix**: identical to the ZIP
  up to character 38,717, then it ends with the module footer while the ZIP continues.
  It has **57 of the 62** numbered sections. The five the export loses are §58
  DIAGNOSTIC SYNTHESIS — OBSERVATION TO RADIOLOGICAL DIAGNOSIS, §59 CHRONIC ISCHEMIC
  FINDINGS — SYNTHESIS, §60 CLINICAL INDICATION IS NOT THE EXAMINATION NAME, §61 BRAIN
  REPORT ENDING — AVOID REDUNDANT SECTIONS, §62 FINAL IMPRESSION PRIORITIZATION —
  ISCHEMIC EXAMPLE (4,213 bytes, ~10 % of the module) — i.e. precisely the
  diagnostic-synthesis material.

The consequence is recorded here because it changes how any comparison must be read:
**the outputs benchmarked as excellent came from the 57-section revision.** §58–§62 are
authoritative by the owner's ruling but not yet clinically exercised. A comparison of
CARE ERP output against "existing Open WebUI output" has to state which revision it
used, or it is not reproducible.

The 57-section file is kept so that difference stays checkable. It is not a second
knowledge source and no code should load it.

Two `type: "file"` entries in the export carry only `id`, `name` and `type` — **no
content**. Their text lived in the Open WebUI database. Retrieval behaviour (chunking,
embeddings, how many chunks were injected) is **not represented anywhere in this
directory and cannot be recovered from it**; reproducing it is an engineering task, not
a file copy.

Master §21 names **six** study-specific modules — brain, LS spine, cervical spine, CT,
USG, mammography. Two are present here; the other four have no asset.

## Clinical authority

The owner's principle, preserved verbatim rather than paraphrased: **radiologist
observations are clinical truth; AI wording is presentation.** Synthesis supported by
the supplied observations is permitted; unsupported pathological assumption is
prohibited. Measurements, laterality, anatomical levels, morphology, signal
characteristics and diagnostic certainty are preserved exactly. Routine normal anatomy
is completed without contradicting supplied abnormalities. Enhancement is not inferred
on non-contrast studies. Spinal stenosis is not inferred from the AP canal diameter
alone. Bulge / protrusion / extrusion / sequestration stay distinct, as do nerve-root
contact / impingement / compression.

Three places where CARE ERP's own clinical packs currently **contradict** these modules
are registered as **C-1, C-2, C-3** in
`docs/architecture/radiology-ai/CARE-RADIOLOGIST-OWUI-ASSET-INVENTORY.md`, with the
file:line evidence for each. They need clinical rulings before either side is treated
as authoritative; until then nothing here is wired into a runtime path.

## What must be fixed before Mode B can consume this

Measured, with evidence in the inventory document:

1. **Nothing retrieves.** No file under `reportComposer/` imports the embedding or RAG
   code — the composer is a static prompt today.
2. **The context ceiling.** `num_ctx` is clamped to 8,192
   (`voiceReportComposer/runtimeConfig.ts:58`) against a 32,574-character master plus
   66,792 characters of modules. This needs section selection, not a bigger clamp.
3. **Three sampling parameters are never sent.**
   `providers/ollamaComposerAdapter.ts:71-84` sends `temperature`, `num_ctx`,
   `num_predict` only — `top_p`, `repeat_penalty` and **`seed`** are absent, so the
   `seed 42` determinism these results rely on does not exist. Already flagged
   independently as finding F29 in
   `docs/architecture/radiology-ai/INDEPENDENT_AUDIT.md`.

Open WebUI stays the environment for prompt development, knowledge testing, model
comparison and clinical benchmarking. CARE ERP calls Ollama through its own provider
infrastructure; Open WebUI is not a production dependency, and LiteLLM is not
mandatory.

## Integrity policy for this directory

- One authoritative copy per module. A derived file stores size + hash + a pointer,
  never a re-typed passage — checked, not assumed.
- Originals are never edited. Corrections happen in the authoritative file, and the
  superseded text moves to `benchmarks/` with its provenance stated.
- No credentials. The export's `user_id` (an Open WebUI account identifier) is
  deliberately excluded from every derived file.
