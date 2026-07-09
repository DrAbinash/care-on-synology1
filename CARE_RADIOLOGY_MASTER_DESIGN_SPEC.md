# CARE ERP Radiology — Master Design Specification

**Status:** Single authoritative design document for the CARE ERP Radiology Platform.
**Date:** 2026-07-09
**Scope:** Product, UX, AI interaction, clinical knowledge, and seed-content design. No application code, no SQL, no API design, no architecture — the architecture and implementation roadmap are frozen and governed elsewhere.

**Consolidates and supersedes** the design content of:
1. `RADIOLOGY_WORKSTATION_UX_REVIEW.md` (UX review & workflow redesign)
2. `AI_RADIOLOGIST_EXPERIENCE_SPEC.md` (AI interaction model)
3. `RADIOLOGY_KNOWLEDGE_CATALOG.md` (clinical knowledge catalog)
4. `RADIOLOGY_KNOWLEDGE_SEED_SPEC.md` Parts 1–2 & 7 (seed conventions, shared libraries, engineering notes)

**Normative data annex.** The per-study seed blocks (`RADIOLOGY_KNOWLEDGE_SEED_SPEC.md` §3) and the three registers (§4 Top-100 tiles, §5 Top-50 combos, §6 Top-100 aliases) remain the normative machine-convertible data annex of this specification, governed by the conventions in §15 of this document. They are data, not design; everything needed to *understand* them is here.

### Terminology reconciliation log

Where the four source documents used differing terms, this specification fixes the canonical vocabulary. These resolutions are binding:

| Canonical term | Supersedes | Notes |
|---|---|---|
| **Reporting Workspace** | "Cockpit", "Command Center", "RCC", "Reporting Workspace" | One reporting surface (§3.4). Legacy names remain as search synonyms only. |
| **Quick Select** | "Chocolate Box" | Legacy name kept as a synonym; never used in UI copy. |
| **Stage Rail** | "right AI panel", "tools panel", "8-tab strip" | The single adaptive right rail (§3.5); the 8-tab strip is retired. |
| **Margin card** | "AI card", "copilot card" | The one card anatomy for all AI offers (§12.3). |
| **Ghost text** | "inline draft", "ghost draft" | Dimmed provisional inline text (§12.2). |
| **Gutter mark** | "lint", "quality flag" | Three glyphs: ✕ contradiction, △ inconsistency, ◌ completeness (§13.3). |
| **Confidence bands** | any percentage display | Exactly: *Routine / Worth a look / Attention* (§12.5). |
| **Priorities** | mixed "P0–P3" and "Must/Should/Future" | **Must/Should/Future** = capability tier (what must exist). **P0–P3** = build order (when). Mapping in §17.1. |
| **Keyboard aliases** | minor variants across docs | The seed spec (annex) alias tables are authoritative; grammar in §11.2. |
| **Reporting hanging protocol** | "workspace hanging", "hanging posture" | Per user × modality workspace preset (§9.5). |

---

## 1. Vision

CARE Radiology serves radiologists reporting MRI, CT, USG, Doppler, mammography, X-ray and Echo for 8–12 hours a day in Indian diagnostic centers. Three convictions define the platform:

1. **The loop is the product.** From sit-down to stand-up, reporting should feel like one continuous gesture: the next study is already open, priors already compared, the sentence about to be written is one keystroke away, errors surface themselves while writing, signing is a heartbeat. We do not optimize screens; we optimize the loop that runs through them.
2. **The AI assists; it never replaces.** The radiologist is the sole author of every report. The AI is a brilliant, tireless junior colleague who reads everything, forgets nothing, speaks only when useful, shows its sources when asked, and never touches the pen. Its value is measured by what the radiologist *stops noticing* — boilerplate, thresholds, prior-hunting, escalation logistics.
3. **Knowledge is seeded, not scattered.** One clinical catalog — shared parameters, severities, recommendations, critical registry — powers Quick Select, structured reporting, the AI Copilot, search, the impression builder, and analytics. One vocabulary everywhere; every phrase earns its place by daily use.

**Headline targets** (measured per release; details in §4.6 and §17):

| Metric | Target |
|---|---|
| Median sign-to-sign time | −30% vs baseline (routine study 8–10 min) |
| Clicks per signed study | ≤ 8 median; 0 on the green path |
| Studies signed with zero mouse contact | ≥ 40% |
| Non-critical interruptions during dictation | 0 — enforced as a bug class |
| Laterality/placeholder/divergence errors reaching sign | < 10% (→ addendum rate for these classes → 0) |
| Critical finding written → communication documented | median < 5 min |
| Speed gains at accuracy cost | defined as failure (discrepancy rate must not rise) |

---

## 2. Product Principles

Thirteen principles govern every design decision below. P1–P5 are experience principles, P6–P10 are AI laws (expanded in §4.1), P11–P13 are knowledge principles.

- **P1 — Protect the input loop.** Typing and dictation latency outrank every other rendering concern. Nothing may steal focus from the editor. Layout never shifts under the eye. ("Never lose a sentence" — §13.9.)
- **P2 — One grammar everywhere.** One reporting surface, one card anatomy, one alias grammar, one severity ladder. Sameness is speed; muscle memory must compound across studies, modalities, and years.
- **P3 — Keyboard-first, mouse-optional.** Every reporting-loop action has a keystroke; the mouse is an alternative, never a requirement.
- **P4 — Fast when clean, deliberate when risky.** The green path signs in one gesture; gates appear only for unresolved critical issues, and then as jump-links, not walls.
- **P5 — Interruption budget.** Three notification channels (interrupt / edge-glow / ledger); only confirmed critical findings may interrupt; open-mic time silences everything else.
- **P6 — Offer, never act.** AI output is a proposal in provisional styling; it never inserts, deletes, scrolls, or moves the cursor without an explicit gesture.
- **P7 — Silence is a first-class output.** No suggestion below the usefulness threshold renders. An AI that mostly stays quiet is an AI whose interruptions get read.
- **P8 — Every claim is traceable.** Suggestions that cannot cite a source do not render. Explainability is a gate, not a garnish.
- **P9 — Corrections outrank the model.** Accepts, skips, edits, and dismissals are the highest-value signal; the product visibly honors them — but personalization never touches safety behavior (§13.8).
- **P10 — Reversible, always.** Every injection — tile, macro, AI accept, voice utterance — is one atomic undo step.
- **P11 — Reference, never copy.** Findings bind to shared libraries by key. If a value list is being copied into an entry, the design is wrong.
- **P12 — Safety scales bind management.** BI-RADS-class assessments are structurally inseparable from their management lines; no path yields a category without its action.
- **P13 — Keys are forever.** `id_key`s are immutable API. Content wording is practice-editable; identity is not. Retire and add; never rename (§16.4).

---

## 3. UX — the workstation experience

### 3.1 The user and the five budgets

A radiologist signing 60–120 studies/day. Every avoidable click ≈ 1 s; every tab switch ≈ 2 s plus a re-orientation glance; every "where is that button?" ≈ 5 s plus a piece of working memory that was holding a finding. All UX decisions are judged against five per-study budgets:

| Budget | Baseline (pre-redesign) | Target |
|---|---|---|
| Clicks to signed report | 25–40 | ≤ 8 (0 green path) |
| Keyboard-only completion | impossible | 100% of the loop |
| Long saccades (report ↔ far panel) | 15–25 | ≤ 6 |
| Interruptions per study | 3–6 | ≤ 1, never during dictation |
| Time to signed report | 18–20 min | 8–10 min routine |

### 3.2 What the platform already does right (protected assets)

- One-click workspace entry from the worklist; one-gesture sign for QA-clean studies (the fast/deliberate asymmetry of P4).
- Quick Select tiles injecting complete finding + impression pairs; pinning; search.
- `/macro` text expansion — the embryo of the keyboard-first design.
- AI output discipline: "Requires review" badging, never auto-finalized (hardened into §13).
- Stability posture: debounced quality checks, panel error boundaries, paginated worklists.
- Dark-by-default reading surfaces (matured into a luminance system, §3.8).
- Deep modality intelligence: protocol QA, auto-calculating measurement sets, stroke-protocol time discipline.

### 3.3 The Zero-Click Read Loop (flagship workflow)

The unit of work changes from "open a study" to "run my list":

1. Radiologist opens the Reporting Workspace once per session; the worklist becomes a queue editor (reorder, claim, defer), not a launchpad.
2. The system serves the **next best study**: critical flags → time-critical protocols → AI-flagged urgency → oldest-in-queue, with a two-word rationale shown ("Critical · CT Head") so ordering is never blind.
3. While study *N* is read, study *N+1* is **pre-staged**: lock acquired, priors fetched and delta-briefed (§12.7), modality template and Quick Select tab pre-selected, viewer preloading.
4. **Sign advances the loop.** PDF/PACS/notify pipeline runs in the background; the next study appears in under a second; a quiet edge-glow later confirms delivery. No archiving spinners in the flow.
5. **Park, don't abandon.** One action sends an ambiguous study to a personal parking lane with a mandatory one-line breadcrumb ("await clinical history"); the breadcrumb re-presents when the study is re-served.

### 3.4 One reporting surface

The Reporting Workspace is the single canonical surface. Legacy parallel surfaces (Cockpit, Command Center, standalone reporting pages) forward into it; their unique panels are absorbed as stage modules; legacy pages leave navigation. Acceptance test: a radiologist trained once finds every control in the same place on every study, every modality, forever.

### 3.5 Canonical layout (single-monitor baseline)

```
┌──────────────────────────────────────────────────────────────────────┐
│ IDENTITY BAND  ● Patient · age/sex · study · accession · QA state     │
├────────────┬──────────────────────────────────────┬──────────────────┤
│ CONTEXT    │            REPORT CANVAS             │  STAGE RAIL      │
│ RAIL (L)   │  Clinical indication (1 line, fixed) │  (R, adaptive)   │
│ Queue      │  ─ Findings ───────────────────────  │  Orient: priors  │
│  now/next/ │   editor · ghost text · gutter marks │  Observe: tiles  │
│  parked    │  ─ Impression ─────────────────────  │  Measure: fields │
│ Prior      │   ghost draft offered here           │  Conclude: AI    │
│ timeline   │  [ stage dots: O·O·M·C·V ]           │  Verify: lint    │
├────────────┴──────────────────────────────────────┴──────────────────┤
│ COMMAND LINE  /            mic ● push-to-talk        Sign (⏎ path)   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Report canvas is the fixed center of gravity** — it never moves, resizes, or scrolls because of anything a panel does. Layout stability *is* fatigue reduction.
- **Left context rail** (read-mostly, stable): queue (now/next/parked) and the **prior timeline** — a chronological strip of the patient's imaging with one-line conclusions.
- **Right Stage Rail** is the only adaptive region; it follows the reading stages (§9.2) and hosts all AI margin cards. Change appears in exactly one predictable place.
- **Bottom command line** is the universal access path (§7.3, §11); mic state and the sign affordance sit beside it.
- Tabs are demoted to a "More tools" overflow (full measurement sets, preferences admin, quality detail).

### 3.6 Notification design

Three channels, strictly tiered (P5):

1. **Interrupt** (rare, earned): critical result on *your* patient, stroke-protocol arrival, reassignment. Full-attention banner, mandatory acknowledge, may sound in the room. Startling *because* rare.
2. **Edge glow** (ambient): background completions — report delivered, prior fetched, AI draft ready. A 2-second soft pulse on the relevant screen edge; hover/peek reveals detail; never steals focus or covers the report.
3. **Ledger** (pull): everything else, accumulated in a panel opened between studies (`F9`). Nothing in the ledger animates.

During dictation or within 5 s of active typing, channels 2–3 are silent by rule.

### 3.7 Error-prevention posture (summary; full rules in §13)

Quality moves from the sign-off gate into the writing surface: live gutter marks for contradictions and gaps, an ambient per-patient color-fingerprinted identity band across report and viewer windows, a shrinking-but-stricter sign gate listing only unresolved critical items as jump-links, and atomic undo on every injection.

### 3.8 Reading-room ergonomics

- **Managed luminance, not fixed dark.** Dark by default plus a 3-step session luminance control (dim room / normal / bright office) preserving contrast ratios, with schedule-aware evening dimming. The report surface sits near the viewer's mid-grey so the report↔images saccade doesn't force pupil re-adaptation.
- **Sound with intent.** Optional quiet earcons for exactly two events (sign-confirmed, critical-interrupt); default off in shared rooms.
- **Hands-free where hands are busy.** Pedal / dictaphone-button / key push-to-talk are one identical input (§12.6).
- **Micro-recovery.** After ~90 min continuous signing, the *between-studies* moment (never mid-study) offers a dismissible 20-second pause card; session-drift stats live in My Analytics. No gamification, no streak-shaming.
- **Session continuity.** Re-auth, network-profile changes, and updates never occur mid-report; draft state survives crash, tab-close, and roaming ("never lose a sentence", §13.9).

### 3.9 Density, typography, accessibility

- One report typeface, generous line-height; section headers differ by weight/position, never color alone; canvas line length ≈ 75 characters.
- Saturated color is reserved for meaning: critical, warning, AI-provisional, dictation-provisional. Type on a 4-step user scale, persisted per user.
- WCAG-conformant contrast in every luminance step; all controls focusable and keyboard-reachable (P3 doubles as the accessibility guarantee); dictation is a first-class input for radiologists who cannot or prefer not to type; tooltips always show keystrokes.

---

## 4. AI Interaction Model

### 4.1 The eight AI laws

(These are P6–P10 made operational, plus three enforcement rules.)

1. **Offer, never act** — proposals only, in provisional styling; explicit gesture required (`Tab`, `Enter`, voice "accept").
2. **Silence is a first-class output** — no empty panels, no "no suggestions found" noise.
3. **Provisional until touched** — accepted AI text stays marked until the radiologist edits, dwells on, or confirms it; nothing AI-originated reaches sign-off unreviewed.
4. **Honest, calibrated, three-band confidence** — *Routine / Worth a look / Attention*; raw scores one click deep and in the audit trail; never percentages in the reading eye.
5. **Every claim is traceable** — one gesture answers "why do you say that?" with highlighted sources.
6. **Corrections outrank the model** — and train suppression visibly.
7. **Interruption budget applies** — only confirmed-pattern critical findings may interrupt; nothing AI-related fires during open mic except critical escalation.
8. **Reversible, always** — one acceptance = one atomic undo step.

### 4.2 The four surfaces

All AI features present through exactly four surfaces — one learned grammar, not twenty:

| Surface | Content | Gesture |
|---|---|---|
| **Ghost text** (inline, dimmed) | Draft findings, impression drafts, refinements | `Tab` accept sentence / `Shift+Tab` skip / type over |
| **Margin cards** (Stage Rail) | Differentials, recommendations, comparisons, literature | `Enter` insert / `E` explain / `X` dismiss |
| **Gutter marks** (left of line) | Errors, inconsistencies, completeness gaps | `F8` cycle / `Enter` jump / fix or dismiss-with-reason |
| **Interrupt banner** (rare) | Critical finding escalation only | Mandatory acknowledge |

### 4.3 Feature map

Twenty features, each defined by its surface, priority, and load-bearing safety rule. (Full interaction rationale was consolidated from the AI Experience Specification; the decisions preserved here are binding.)

| # | Feature | Surface | Priority | Load-bearing rule |
|---|---|---|---|---|
| 1 | **Copilot panel** — one home; states Quiet / Offering / Asked; ≤3 cards; engine footer | Stage Rail | Must | Quiet state prevents manufactured content |
| 2 | **Findings suggestions** — ghost sentences at the insertion point, origin-ticked (⌗ measurement / ↺ prior / ◉ image) | Ghost | Must | Ungroundable findings get no ghost |
| 3 | **Differential diagnosis** — explicit `/differential` or ambient card; discriminator-led list; "not suggesting" line exposes exclusions | Card | Should | No probabilities beside diagnoses; bands only |
| 4 | **Missed finding detection** — report-level completeness (indication, checklist, unaddressed measurements/priors) as ◌ gutter marks; image-level nudges (Future) localize, never diagnose, and appear at sign-off only | Gutter (+card) | Must / Future | Image nudges say *where to look*, never what it is |
| 5 | **Impression refinement** — significance-ordered ghost draft in the user's style; `/polish` returns a tracked-changes diff, never a block rewrite | Ghost | Must | Refiner may not add findings, soften certainty, or change laterality/measurements |
| 6 | **Recommendation generation** — guideline-anchored cards with version chip; ambiguity shown as explicit variants | Card | Should | Never free-styles management; anchor always named & versioned |
| 7 | **Structured finding assistance** — structure harvested from prose into a field strip; gaps jump-linked; mandatory fields gate sign as before | Rail strip | Should | Prose remains the authoritative report |
| 8 | **Measurement interpretation** — reference band + prior-trend dots rendered on the field; interpretation ghost offered | Inline on field | Should | Bands sourced/versioned; radiologist decides if it's a finding |
| 9 | **Confidence display** — three bands; `E` reveals score, drivers, and *what would change it* | Chips everywhere | Must | No green, no percentages — palette is a review-behavior instrument |
| 10 | **Explainability** — evidence view highlights actual sources in place; second press shows model/version/prompt lineage | `E` on anything | Must | Generated-prose justifications banned; sources only |
| 11 | **Literature support** — explicit-only `/literature`; ≤3 retrieved-and-linked entries, evidence-ranked, dated | Card | Future | Unverifiable citations never render |
| 12 | **Prior report comparison** — three-line delta brief (unchanged/changed/new-resolved) on open; comparison ghosts dual-sourced | Rail + ghost | Must | Every delta one keystroke from both originals |
| 13 | **Follow-up comparison** — radiologist-curated lesion registry; sparkline story per tracked lesion; unaddressed lesions raise ◌ | Rail rows | Should | Lesion identity linking is an explicit human act |
| 14 | **Voice dictation assistance** — PTT into the focused section; domain normalization with heard-vs-rendered inspectable; ten voice verbs; agentic voice Future | Editor stream | Must / Future | Semantic corrections stay provisional; "sign" hits the same gate as the keystroke |
| 15 | **Error prevention** — continuous lint as gutter marks; deterministic checks exhaustive; dismiss requires a reason | Gutter | Must | Blocking tier reserved for internal falsity (§13.3) |
| 16 | **Critical finding escalation** — priority card on the radiologist's *own written finding*; one keystroke launches the critical-results workflow with auto-documentation; pre-read image flags (Future) re-order the queue only with a labeled reason | Interrupt/card | Must | The human made the diagnosis; AI recognizes category and carries logistics |
| 17 | **Learning from corrections** — invisible signal capture; monthly "Your copilot" digest; plain-language "teach" rules, inspectable and deletable | Digest/ledger | Should | Personalization firewalled from safety behavior |
| 18 | **Prompt history** — searchable per-radiologist history; any ask re-runnable or pinnable as a named command-line action | `/history` | Should | Pinning changes access speed, never review requirements |
| 19 | **AI audit trail** — every suggestion (incl. rejected) recorded with band, sources, model version, disposition; "report provenance" view shades AI-originated spans | Passive | Must | Recording unconditional; cannot be disabled per study |
| 20 | **Medico-legal safeguards** — authorship gate, disclosure policy applied verbatim, explicit degradation banner, standing refusals | Structural | Must | Sign-off impossible while provisional spans remain (§13.1) |

### 4.4 Sequencing: the trust chassis ships first

No assistive content feature launches before its chassis: **one home (1), honest confidence (9), inspectable evidence (10), unconditional audit (19), authorship gate (20)**. Then the authoring core (2, 5, 15, 4, 12, 16, 14), then the Should tier, then Future items gated on capability maturity — not desire (§17).

### 4.5 Multi-provider posture

Multiple AI engines (local-first default, cloud providers under feature flags) answer through the same four surfaces with the same card anatomy. The radiologist expresses intent; routing is invisible; the answering engine is always disclosed in the card/panel footer.

### 4.6 AI success measures

Ghost acceptance > 70% sentence-accept on routine studies by month 3 with edit-after-accept falling; dismissed-then-addended < 2%; quarterly calibration audit per band; ≥ 90% of laterality/placeholder/divergence errors caught pre-sign; escalation latency median < 5 min; zero non-critical interruptions during open mic; quarterly 3-question trust pulse ("helps me / slows me / I trust its silence") trending up.

---

## 5. Knowledge System

### 5.1 Entry anatomy — the atomic unit

Every **finding entry** carries up to six attachable elements:

| Element | Meaning |
|---|---|
| Finding text | Sentence(s) injected into Findings, with `{parameter}` slots |
| Parameters | Slot values bound **by reference** to the shared libraries (§6, §8) |
| Impression fragment | The one-line conclusion the Impression Builder assembles from |
| Recommendation | Optional, always a `rec.*` code — never free text |
| Criticality tag | `none` / `significant` / `critical` (links a `crit.*` registry entry) |
| Synonyms | Search/dictation aliases resolving to this entry |

A **Quick Select tile** = one entry with sensible defaults pre-filled. A **combo tile** fires an ordered set of entries in one gesture. A **normal template** is the study's one-keystroke full-normal.

### 5.2 One catalog, seven consumers

The same entries power Quick Select (tiles), Structured Reporting (harvested field strip, §4.3-7), the AI Copilot (its *entire suggestion vocabulary* is the active catalog — it may propose free-text it has seen repeatedly as *draft* entries for the content editor, never as live suggestions), Search (synonym thesaurus), the Impression Builder (fragments, assembled worst-first), the Parameter Library, and Analytics (clean cross-modality queries because severities and parameters are shared, not copied).

### 5.3 The analytics loop

Quarterly content review driven by usage: tiles never fired → retire candidates; free-text sentences typed repeatedly → tile candidates; recommendations frequently deleted → wording review. The catalog is a living phrasebook, pruned and grown by evidence (§16.6).

---

## 6. Shared Libraries (canonical definitions)

Defined once, bound everywhere by key (P11). The parameter library has its own section (§8); the remaining nine libraries follow. *(These definitions supersede the copies in the annex's Part 2; the annex's per-study blocks bind to these keys.)*

### 6.1 Severity library (`sev.*`)

```yaml
sev.global:      [mild, moderate, severe]
sev.hydro:       [mild, moderate, gross]          # hydronephrosis, hydrocephalus
sev.ascites:     [mild, moderate, gross]
sev.effusion:    [mild, moderate, massive]
sev.ptx:         [minimal, moderate, complete, tension]
sev.fazekas:     [Fazekas I, II, III]
sev.fatty_liver: [Grade I, II, III]
sev.mrd:         [Grade I, II, III]               # medical renal disease
sev.prostate:    [Grade I (20-40 g), II (40-60 g), III (>60 g)]  # derives from volume
sev.modic:       [Type I, II, III]
sev.meyerding:   [Grade I, II, III, IV]           # derives from listhesis mm/%
sev.canal:       [mild, moderate, severe]         # canal/foraminal stenosis
sev.stenosis_pct:["<50%", "50-70%", ">70%", occlusion]
sev.extent_lung: [mild (<25%), moderate (25-50%), extensive (>50%)]
sev.abi:         [">=0.9 normal", "0.5-0.89 claudication", "<0.5 critical ischemia"]
sev.acr_density: [a, b, c, d]                     # c/d auto-append dense-breast rider
sev.birads:      ["0","1","2","3","4a","4b","4c","5","6"]
                 # mandatory_management: true — category structurally bound to its
                 # management line (§13.6); category 5 links crit.birads5
```

### 6.2 Laterality library (`lat.*`)

`lat.rl` [right, left] · `lat.rlb` [right, left, bilateral, bilateral R>L, bilateral L>R] · `lat.mid` [+ midline].

### 6.3 Anatomy/location library (`loc.*`)

Brain sites & vascular territories · lumbar and cervical level grids (vertebrae, discs, roots) with the **root map rule** (traversing = lower vertebra of the disc level, exiting = upper; drives lint §13.4) · lung zones (CXR) and lobes (CT) · liver lobes/segments · renal calculus site ladder (calyces → pelvis → PUJ → ureter thirds → VUJ) · breast locator (side + quadrant + clock + depth + distance-from-nipple) · lower-limb venous and arterial segment sets · simplified node stations · uterus/adnexa sites. Full value lists: annex §2.4.

### 6.4 Measurement unit library (`meas.*`)

Units: mm, cm, ml, g, %, ratio, seconds, degrees, HU, weeks. ~30 named fields with normal-limit flags and **auto-calc** where derived: Evans index, ABC/2 hematoma volume (ml), midline shift (critical ≥ 5 mm), CTR (> 0.50 PA), prostate volume (L×W×H×0.52 → grade), PVR %, Meyerding from translation, nodule average diameter (feeds Fleischner), CT severity score (lobe-wise sum /25), ABI (→ bands), reflux duration (significant > 0.5 s superficial / > 1.0 s deep). Full definitions: annex §2.5. Interpretation rendering rule: the band/flag renders *on the field* (§4.3-8), never in a separate panel.

### 6.5 Recommendation code library (`rec.*`)

~40 coded, practice-editable lines: `rec.clincorr`, follow-ups (`fup_usg6w/3m/6m/cxr2w`, `repeat_ncct24h`), specialist referrals (`spec_uro/neuro/nsx/ortho/pulmo/gyn/onc/surg/vasc/breast`), further imaging (`cect/cemri/mrcp/ctkub/hrct/mra_mrv/cta/petct`), labs (`lab_lft/rft/urine/sputum`), `biopsy`, `physio`, `echo_corr`, `pft`, `usg_corr`, `screening_spine`, `dexa`. Two are **templated with runtime slots**: `rec.fleischner` (interval filled by AI from nodule size + risk, radiologist confirms) and `rec.urgent` (specialist + communication timestamp filled by the escalation workflow). Full text: annex §2.6. Rule: findings reference codes; free-text advice is a lint finding.

### 6.6 Critical finding registry (`crit.*`)

Practice-editable, centrally governed (§16.2). Thirteen v1 entries — intracranial hemorrhage (all types), midline shift ≥ 5 mm, large-territory infarct, diffuse cerebral edema, acute cord compression, acute femoro-popliteal DVT, tension/complete pneumothorax, massive effusion with shift, free gas under diaphragm, pyonephrosis, BI-RADS 5, critical limb ischemia, aortic emergency. Each entry: linked finding keys (+ optional condition), specialist routing, and the escalation behavior of §13.5. Full table: annex §2.7.

### 6.7 Synonym library

Global thesaurus merged from per-finding synonyms plus cross-cutting Indian reporting vocabulary: Koch's ⇄ pulmonary tuberculosis, PIVD ⇄ disc protrusion/extrusion, NAD, SOL, SVID, HUN, PCS, MLS, PTX, LAP, FL/HM/SM, CMD, PVR, ET, POD, DOC, TIB, GGO, CTSS, stone ⇄ calculus, `#` ⇄ fracture, b/l ⇄ bilateral. Search and dictation resolve all synonyms to canonical entries. Full list: annex §2.8.

### 6.8 Keyboard alias library

Grammar and validation rules in §11.2; the authoritative per-study alias tables are annex §6 (Top-100) and the per-finding `keyboard_aliases` fields.

### 6.9 Normal study library (`tpl.normal.*`)

Eleven full-normal templates (one per study; venous and arterial Doppler separately), each the study's #1 tile, plus per-region normal lines used by the completeness engine — which fills unaddressed regions **on radiologist confirmation only**, never silently. Full texts: annex §2.10. Global macro `/nad` = "No significant abnormality detected."

---

## 7. Quick Select

### 7.1 Tile anatomy and behavior

A tile fires one finding entry: finding text + impression fragment injected at the insertion point, parameters editable inline afterward (tab-through slots). Pinned tiles float top-left; default render is capped (~24) with search and mnemonics reaching the whole catalog, so the cap is a display choice, not a ceiling. Every injection is one atomic undo step (P10).

### 7.2 Keyboard-native tiles

The Quick Select hotkey overlays each visible tile with a stable 2-character mnemonic; typing it fires the tile and returns focus to the editor. Pinned tiles get single characters. A routine lumbar-spine normal-variant report is ~6 keystrokes of findings selection with zero mouse contact.

### 7.3 One command surface

The command line (`/` in the editor, `Ctrl+K` anywhere) is the unified access path across **tiles + macros + templates + AI actions + measurement fields + priors**, frequency-ranked from usage analytics. The visual grid remains for browsing and training; the command line serves the expert who knows what they want. This is the pattern that made the legacy 8-tab strip unnecessary.

### 7.4 Signature group patterns

Reused across studies (one grammar, per-modality vocabulary):

- **Level × Morphology grid** (spine): disc rows × bulge/protrusion/extrusion columns; one tap = level-tagged sentence with zone/severity slots.
- **Segment map** (Doppler): a tappable limb diagram; tap segment → pick state (normal/thrombus/reflux); the map paints as dictation fills it.
- **Pattern wall** (HRCT): tap pattern (GGO/TIB/mosaic/…) → lobe grid.
- **Zone grid** (CXR): tap zone → pick pattern.
- **Organ tabs** (USG): tabs mirror the organ checklist; each holds its normal line + top entries.
- **Builder chains** (mammography): shape → margin → density → locator slot-chains; the **BI-RADS bar** injects assessment + bound management as one unit.

### 7.5 Combo tiles

Ordered member lists fired in one gesture, with `optional` and `alt` (choose-one) members and shared slots (e.g., one laterality across calculus + hydronephrosis). The 50 seeded combos (annex §5) encode the highest-volume Indian reporting patterns: "FL Gr {n}, rest NAD", "PIVD classic L4-5", "renal colic classic", "old Koch's stable", "SDH emergency".

### 7.6 Ranking and growth

Annex §4's Top-100 order is the v1 default pin/sort weight; per-user analytics re-rank after go-live. New tiles enter via the governance loop (§16.6) — including AI-proposed candidates from repeatedly typed free text, which enter as *drafts* for the content editor.

---

## 8. Parameter Library (`param.*`)

The canonical slot-value sets findings bind to (P11). Highlights (full list: annex §2.1):

```yaml
param.size / count / course / change / margin / enhancement    # universal descriptors
param.echotexture / ct_density / mr_signal / edema             # modality descriptors
param.disc_morphology: [diffuse bulge, protrusion, extrusion, sequestration]
param.disc_zone:       [central, R/L paracentral, R/L foraminal, extraforaminal]
param.root_involvement:[abutting, indenting, compressing]
param.cord_ladder:     [indenting thecal sac, abutting cord, indenting cord,
                        compressing cord with signal change]   # ordered — the cervical severity spine
param.waveform / thrombus_age                                  # Doppler
param.calc_morphology (benign→suspicious ladder) / calc_distribution / mass_shape   # mammo
param.nodule_character / lung_distribution / bronchiectasis_type                    # chest
param.fibroid_site / gb_status / cmd / tube_position                                # USG & ICU
```

Binding rules: parameters are referenced by key; ordered sets (`cord_ladder`, margin ladders, `calc_morphology`) must preserve order because lint and impression assembly depend on position; extending a set appends — never reorders (§16.4).

---

## 9. Reporting Workflow

### 9.1 The loop, end to end

Session opens → next best study serves (§3.3) → the workspace hangs itself (§9.5) → the radiologist reads and reports through five stages (§9.2) → green-path sign (`Ctrl+Enter`) or gated sign (§13.2) → pipeline runs in background → next study appears pre-staged. Park (`Ctrl+P`, breadcrumb mandatory) and skip (`Ctrl+→`) are the only exits that don't sign.

### 9.2 Stage-aware workspace

The Stage Rail foregrounds the radiologist's own sequence — stages are suggestions, never walls; everything stays reachable via the command line:

| Stage | Rail foregrounds |
|---|---|
| **Orient** (study opens) | Clinical indication, safety flags, protocol-QA verdict, **prior delta brief** (§12.7) |
| **Observe** (writing findings) | Quick Select tiles for this study type, macros; structure harvested quietly (§4.3-7) |
| **Measure** (a measurable finding appears) | The relevant measurement fields surface beside the sentence, bands and trend dots on-field |
| **Conclude** (cursor enters Impression) | Ghost impression draft; differential and recommendation cards one keystroke away |
| **Verify & sign** (report complete) | Lint summary as jump-links; then the sign action |

### 9.3 Impression assembly

The Impression Builder assembles from `impression_fragment`s, ordered worst-first (critical > significant > rest), grouping multi-level/multi-organ disease into single lines ("multi-level DDD, worst at L4-5"; "{FL grade} fatty liver. Rest of the visualized organs are unremarkable."). The assembled draft is offered as ghost text — never inserted (P6).

### 9.4 Sign-off

- **Green path:** no unresolved critical lint → `Ctrl+Enter` signs instantly; PDF, PACS archive, referrer email, patient SMS run in background; edge-glow confirms.
- **Gated path:** unresolved critical items (✕ marks, unmet mandatory fields, unreviewed provisional spans) render as a keyboard-navigable jump-list — a to-do, not a scolding modal.
- Signing attests authorship (§13.1) and is the event the audit trail freezes on (§12.10).

### 9.5 Reporting hanging protocols

Per user × modality × study type, the workspace hangs its whole posture: Quick Select tab, template, measurement set, rail modules, viewer layout request. Learned from behavior ("you always open spine measurements on lumbar MRI — hang it by default?"), pinnable/unpinnable in My Prefs. PACS hangs pixels; we hang the reporting posture.

### 9.6 One grammar across modalities

The loop is identical for MRI, CT, USG, Doppler, mammography, X-ray, Echo — only the hanging content changes (MRI hangs protocol QA + measurement sets; USG hangs the organ checklist; mammography hangs the composition strip + BI-RADS bar with gated sign; X-ray hangs the two-line rapid template). Switching modalities mid-list costs zero relearning.

---

## 10. Viewer Workflow

### 10.1 The paired-window covenant

The report window and viewer window behave as one workstation on any hardware:

- **Study-follow:** when the loop advances, the viewer follows automatically — no re-launch, no click.
- **Shared identity band:** both windows show the same patient band with the same per-patient accent color; a mismatch is visible pre-attentively before any words are read (§13.4).
- **Focus etiquette:** `F2` flips focus; signing never yanks focus; the viewer never raises itself.
- **Arrangement memory:** window layout per monitor-fingerprint restores every session.

### 10.2 Silent-resilient launch

Network-profile probing (LAN/VPN/public) runs continuously in the background from session start; by first study, the healthy route and working viewer are known. The diagnostic dialog survives only for hard failure, in plain language with one recommended action pre-focused ("Images can't load on this network — try the alternate viewer / retry / report without images"). Radiologists should go weeks without thinking about networks.

### 10.3 Multi-monitor tiers

| Tier | Setup | Behavior |
|---|---|---|
| **Reference** (reading room) | Diagnostic display + report display, mic/pedal | Viewer owns the diagnostic display; canonical layout (§3.5) owns the other; identity bands aligned along the shared bezel for a minimal cross-check saccade |
| **Standard** (office) | 2 commodity monitors | Same split, offered once on detection, then remembered |
| **Roaming** (laptop/on-call) | Single screen | `F2` overlay mode: viewer full-screen with a collapsible report drawer (dictation + command line); full canvas on return |

Deliberately excluded: 4-monitor sprawl and detachable floating panels — per-user layout drift and hunt-time cost more than they return. Two windows, strong covenant, zero configuration.

---

## 11. Keyboard Workflow

### 11.1 The canonical keymap

Every reporting-loop action has a keystroke (P3); all bindings user-remappable; `?` overlays the map; tooltips always show keys.

| Intent | Default | Intent | Default |
|---|---|---|---|
| Command line | `/` or `Ctrl+K` | Accept / skip ghost sentence | `Tab` / `Shift+Tab` |
| Quick Select mnemonic overlay | `Ctrl+Q` | Push-to-talk | hold `Ctrl+Space` (= pedal/dictaphone) |
| Next / prev report section | `Ctrl+↓` / `Ctrl+↑` | Cycle lint marks / jump | `F8` / `Enter` |
| Sign & next | `Ctrl+Enter` | Park with breadcrumb | `Ctrl+P` |
| Skip to next study | `Ctrl+→` | Focus viewer ↔ report | `F2` |
| Undo last injection (atomic) | `Ctrl+Z` | Notification ledger | `F9` |
| Explain (any AI artifact) | `E` | Help overlay | `?` |

The green path is three inputs per routine study: tile mnemonics → `Ctrl+↓` → `Tab`-walk the ghost → `Ctrl+Enter`. **Focus discipline is a hard guarantee:** no background completion, refetch, or panel update may steal keyboard focus from the editor. Ever.

### 11.2 Alias grammar (canonical)

- Tile mnemonics: 2–4 lowercase chars, unique within the open study; consonant-skeleton derivation; digits encode level/grade (`pv45`, `fl2`, `doc56`, `b4a`); side prefixes r/l where side is intrinsic (`rvuj`).
- Level-slotted stems (`db`, `pv`, `ex`, `cs`, `fn`, `lith`, `doc`, `cpv`, `uv`, `cfn`) expand to one alias per level at seed time.
- No alias may be a strict prefix of another in the same study — **seed-time validation fails loudly**.
- Global `/macros` (`/nad`, `/clincorr`, `/history`, `/ask`, `/polish`, `/differential`, `/literature`) live in a separate namespace study mnemonics never shadow. Reserved: `nad`, `urgent`, `clincorr`.
- Authoritative alias tables: annex §6 and per-finding fields.

### 11.3 Adoption engine

Usage analytics drive keystroke coaching: the `?` overlay highlights the three keys the user hasn't adopted with a one-line payoff ("Ctrl+Enter would have saved you 214 clicks this week"). No mid-flow nags.

---

## 12. AI Copilot (operational specification)

### 12.1 Panel states

Quiet ("Copilot: watching · nothing to add", collapsed) / Offering (≤3 margin cards) / Asked (visible thinking state, `Esc` cancels). The panel never exceeds one screen-height; overflow goes to the ledger. The answering engine is disclosed in the footer.

### 12.2 Ghost text contract

Renders dimmed at the natural insertion point with an origin tick (⌗ measurement-derived / ↺ prior-derived / ◉ image-derived). `Tab` accepts one sentence; `Shift+Tab` skips (logged as suppression signal); typing or dictating over it replaces it. Accepted text stays provisional-styled until touched (Law 3). Never moves the cursor, never scrolls, never bulk-inserts.

### 12.3 Margin card anatomy

One anatomy for every AI offer: *one-line claim → confidence band chip → source chip(s) → [Insert] [Explain] [Dismiss]*. Cards wait at the margin; dismissing trains suppression; inserting places text at the cursor as provisional.

### 12.4 Gutter marks

Three glyphs: **✕** contradiction (blocking-critical), **△** inconsistency (non-blocking), **◌** completeness. Identical placement and interaction everywhere; `fix` offered where deterministic; `dismiss` requires a one-tap reason and is audit-trailed.

### 12.5 Confidence bands

*Routine* (grey) / *Worth a look* (amber outline) / *Attention* (filled amber). No percentages, no green — the palette allocates scrutiny. `E` reveals the raw score, drivers, and *what would change it*. Band thresholds calibrated against outcomes quarterly (§4.6).

### 12.6 Voice

PTT (key/pedal/dictaphone — one identical input) dictates into the focused section. Domain normalization (units, laterality, radiology vocabulary) renders applied-with-underline; heard-vs-rendered inspectable via `E`; semantically substantive corrections stay provisional amber. Ten voice verbs only: *next field / previous field / impression / insert {macro} / accept / undo / park / sign / new paragraph / stop*. "Sign" hits the same gate as `Ctrl+Enter`. Open mic silences all non-critical output (Law 7). Mic state (listening/processing/idle) is always unambiguous.

### 12.7 Prior comparison & lesion tracking

On study open: the **delta brief** — three lines (unchanged collapsed / changed with values and % / new-resolved), each linked to the prior's exact sentence. While writing: dual-sourced comparison ghosts ("…again seen, previously 6 mm, now 8 mm…"). For surveillance findings: the radiologist-curated **lesion registry** with per-lesion sparklines, criterion chips, and ◌ marks for unaddressed tracked lesions. Identity linking across studies is always an explicit human act.

### 12.8 Learning loop

Natural gestures (accept/skip/edit/dismiss-with-reason) are the only signal — no "was this helpful?" prompts, ever. Monthly digest surfaces trends and honesty checks ("2 suggestions you dismissed were later addressed in addenda — review?"). Plain-language "teach" rules ("never suggest X for pediatric studies") are confirmed, listed in My Prefs, and deletable. **Firewall:** personalization adjusts style, phrasing, and suggestion selection only — lint rules, escalation, calibration, and guideline anchors never personalize (§13.8).

### 12.9 Prompt history

Every explicit ask preserved per-radiologist; `/history` recalls, filters by study/modality/text; any ask re-runs on the current study or pins as a named command-line action ranked alongside macros and tiles. Pinned actions execute under all standard laws.

### 12.10 Audit trail & provenance

Unconditional record behind every signed report: every suggestion rendered (including never-accepted), band + raw score, evidence sources, engine/version, prompt lineage, and disposition (accepted / accepted-then-edited / skipped / dismissed-with-reason / overridden). The **report provenance view** is the signed report with AI-originated spans shaded and per-span lineage on click — visible only in provenance mode, never in the clinical document. Practice dashboards aggregate acceptance/edit/override rates by feature, modality, and model version.

---

## 13. Safety Rules (consolidated and binding)

1. **Authorship is structural.** Sign-off attests the radiologist's authorship and is impossible while any AI-originated span remains untouched-provisional; the gate lists remaining spans as jump-links.
2. **The sign gate is small and strict.** Only unresolved *critical* items block: ✕ contradictions, unmet mandatory fields (e.g., BI-RADS without composition), unreviewed provisional spans, and unstarted escalations for written critical findings.
3. **Lint tiers.** ✕ = the report would be internally false (laterality contradiction, certainty contradiction, category-vs-descriptor violations) — blocking. △ = inconsistency (text vs measurement-field divergence, severity vs number mismatch) — non-blocking, dismissible with reason. ◌ = completeness (unaddressed organ/level/lesion/indication) — non-blocking; `normal_variant` entries never raise ◌.
4. **Identity is ambient.** The per-patient color-fingerprinted identity band spans report and viewer; wrong-patient work is made structurally visible, not procedurally checked. Root-map lint (L4-5 → traversing L5; C5-6 → C6) and side-vs-indication lint run continuously.
5. **Critical escalation.** Written-finding pattern match → margin priority card (never covering the text) → one keystroke launches the critical-results workflow: referrer contact surfaced, communication sentence auto-documented (`rec.urgent` slots filled), timestamps recorded, identity-band chip until closed. Declining requires a reason. Pre-read image flags (Future) only re-order the queue, always labeled, never suppressing the independent read.
6. **Safety scales bind management** (P12). BI-RADS category insertion always carries its bound management line; descriptor-vs-category violations (spiculated + BI-RADS 2) are ✕-blocking. The same pattern is mandatory for future TI-RADS/PI-RADS-class scales.
7. **Templated urgency.** `rec.urgent` and `rec.fleischner` fill their slots from workflow/AI at runtime; the radiologist confirms; free-text urgent advice is a lint finding.
8. **Personalization firewall.** Learned preferences never alter lint, escalation, calibration, or guideline anchors — the safety net cannot be trained into silence.
9. **Never lose a sentence.** Draft state survives crash/close/roam; re-auth and updates never interrupt an open report; the input loop is protected above all rendering work (P1).
10. **Explicit degradation.** If AI services are down or a model is under review: one banner ("Copilot offline — full manual mode"), every feature degrades to its manual equivalent, nothing half-works silently.
11. **Standing refusals.** The AI never renders prognosis to patients, never communicates externally without radiologist action, and refuses out-of-scope asks ("write the whole report") with the reason.
12. **Unconditional audit** (§12.10) and **atomic undo** (P10) apply to everything above.

---

## 14. Clinical Catalog

The ten v1 studies. Full seed blocks (every finding with all 16 fields, per-study AI checks): annex §3. Summary of what each contributes:

| Study | Modality | Signature content & patterns | Critical entries |
|---|---|---|---|
| **MRI Brain** | MR | 16 findings; territory + Fazekas + granuloma/NCC set; Evans & ABC/2 auto-calc | hemorrhage; large-territory infarct |
| **MRI LS Spine** | MR | 17 findings; the shared **spine set** (morphology/zone/root/Modic/Meyerding); Level×Morphology grid; per-level table assembly | — (severe stenosis significant) |
| **MRI Cervical Spine** | MR | Reuses spine set; **cord ladder** as severity spine; DOC entries; myelomalacia | acute cord compression |
| **CT Brain (NCCT)** | CT | 14 findings; trauma-negative line; ICH/SDH/EDH/SAH with volume/thickness/MLS; fastest escalation path in the product | all hemorrhage; MLS ≥ 5 mm; diffuse edema |
| **USG Whole Abdomen** | US | 26 findings; organ-checklist reporting; fatty-liver grades; the #1 tile in the product ("FL Gr I, rest NAD") | — (hot GB/appendix → urgent pairing) |
| **USG KUB** | US | Reuses renal set + 8 KUB-specific; obstruction-level HUN; DJ-stent follow-ups | pyonephrosis |
| **HRCT Chest** | CT | 17 findings; pattern-first (TIB/GGO/UIP/NSIP); TB activity spectrum; Fleischner nodule track; CTSS auto-sum | — (miliary/mass significant + urgent pairing) |
| **Chest X-ray** | XR | 16 findings; two-line read; zone grid; Koch's spectrum; CTR auto-calc; ICU tubes/lines set | tension PTX; massive effusion; free gas |
| **Lower Limb Doppler** | US | 15 findings; venous segment map; reflux thresholds; ABI bands | acute proximal DVT; critical ischemia |
| **Mammography** | MG | 13 findings; builder chains; composition mandatory; BI-RADS bar with bound management; descriptor-gate lint | BI-RADS 5 |

Per-study AI assistance (missed-finding checks, contradiction checks, impression suggestions, follow-up suggestions) is seeded alongside each study block in the annex and executes through the surfaces of §4.2 under the rules of §13.

**Coverage roadmap (next tranche, by Indian-center volume):** USG Obstetric (own document — structured biometry), USG Thyroid/Neck (TI-RADS, §13.6 pattern), USG Scrotum, MRI Knee, MRI Shoulder, CT PNS, CECT Abdomen, Echo (structured measurements), legacy Barium/IVP set.

---

## 15. Seed Specification (engineering conversion guidance)

### 15.1 Entity model

Study types → finding entries (the atomic unit, §5.1) → bound by reference to `param./sev./lat./loc./meas./rec./crit.` shared entities → grouped into tile groups and combos → plus normal templates and alias tables. The annex's per-study YAML blocks are the machine-convertible source.

### 15.2 Conversion rules for seed files (JSON/YAML)

1. **Bind by reference.** Shared entities seed once; findings point by key. A copied value list is a conversion bug.
2. **Defaults on omission:** `criticality: none`, `normal_variant: false`, empty lists for parameters/recommendations/combos; `tile: true` implied.
3. **Sentences are fragment lists.** `{slot}` names match bound parameter/measurement keys exactly; optional fragments collapse without punctuation artifacts — seed sentence templates as ordered fragment lists, not raw strings, if simpler.
4. **Alias expansion + validation at seed time.** Expand level-slotted stems into concrete aliases; enforce uniqueness and the no-prefix rule per study; fail loudly.
5. **Criticality:** `critical:` links its `crit.*` key; `critical_if:` carries its plain-language condition verbatim for the copilot — do not formalize.
6. **Scale bindings are structural:** seed `sev.birads` (and successors) such that no path yields a category without its management line.
7. **Templated recommendations** keep slot markers intact (`rec.urgent`, `rec.fleischner`).
8. **Combos:** ordered member lists with `optional`/`alt` markers and shared-slot declarations.
9. **Tile ranking:** annex §4 order seeds initial weights; runtime analytics supersede.
10. **Do not seed** schema, API shapes, or UI layout from any design document — content only.

### 15.3 Naming conventions

- Entities: lowercase dotted namespaces — `sev.fatty_liver`, `loc.spine_lumbar`, `rec.spec_uro`, `crit.free_gas`, `tpl.normal.cxr`, `combo.usab.fl_rest_normal`.
- Findings: `<study_short>.<finding_key>` — `mrbr.` `mrls.` `mrcs.` `ctbr.` `usab.` `uskb.` `hrct.` `cxr.` `dopll.` `mmg.`; snake_case keys named for the clinical concept, not the wording (`fatty_liver`, not `bright_liver`).
- New studies claim a new short prefix; prefixes are never reused.

### 15.4 id_key conventions

`id_key`s are immutable API (P13): never renamed, never reused, never semantically repurposed. Wording, synonyms, tiles, and rankings may change freely under the same key. Cross-study reuse is by inclusion (`include_findings:`), not duplication — the including study places existing keys in its own tile groups.

### 15.5 Versioning the catalog

Semantic versioning of the catalog as a whole:

- **MAJOR** — never expected: removal or semantic change of a key (design forbids it; a major bump signals a governance failure to be reviewed).
- **MINOR** — additive: new findings, studies, parameters values (appended), recommendations, combos, synonyms, aliases.
- **PATCH** — wording, ranking weights, synonym additions, normal-template text.

Every entry carries `owner`, `version`, `review_date`, `status` (`draft`/`active`/`retired`). The AI Copilot consumes **active** entries only. Signed reports permanently resolve the entry version they used.

### 15.6 Extending without breaking compatibility

Additive-only discipline: new values append to choice sets (never reorder ordered scales — lint and assembly depend on position); new severity scales are new keys, not edits; new studies are new namespaces; per-practice customization is a layer above the central catalog (phrasal/additive only — severity scales, scale-management bindings, and the critical registry are centrally governed, §16.2). Anything that would change the meaning of an existing key is instead a new key plus a deprecation (§15.8).

### 15.7 Localization strategy

- **Keys are never localized.** `id_key`s, codes, aliases, and slot names are locale-invariant.
- All radiologist-visible strings (sentences, impression fragments, recommendation texts, labels, normal templates) are **locale packs keyed by id_key**; `en-IN` is the reference locale and the fallback.
- Indian reporting idiom (Koch's, PIVD, NAD…) lives in the `en-IN` pack and the synonym library; other locales map their idiom via their own synonym overlays.
- Practice-level wording edits are a per-practice overlay *above* the locale pack; resolution order: practice → locale → reference.
- Keyboard aliases are locale-invariant by default; a locale may *add* aliases, never remove or reassign reference ones.

### 15.8 Deprecation strategy

`status: retired` removes an entry from Quick Select, the command line, and the copilot vocabulary — but the key resolves forever (old reports, audit trails, and analytics must always render). Retired entries carry a tombstone note (`retired_because`, `replaced_by`). Aliases of retired entries are **never reassigned** to a different clinical meaning; a replacement entry may inherit the alias only when it is the direct successor (`replaced_by` link present). Quarterly analytics (§16.6) nominate retirement candidates; a human content editor decides.

---

## 16. Governance

### 16.1 Roles

Each catalog entry has a named **radiologist content editor** (owner). Product owns the interaction grammar (§§3–13); the clinical owner governs wording and clinical validity; engineering owns seed conversion fidelity (§15).

### 16.2 Centrally governed vs practice-editable

Centrally governed with clinical sign-off: severity scales and their order, scale↔management bindings (BI-RADS class), the critical finding registry, lint blocking rules, escalation behavior. Practice-editable: wording, tiles and pins, combos, synonyms, additional aliases, recommendation phrasing, locale/practice overlays.

### 16.3 AI governance

Confidence-band calibration reviewed quarterly against outcomes; model/provider changes appear in the audit trail and the practice dashboard; degradation policy per §13.10; the disclosure line in clinical reports is a governance-configured text applied verbatim (§4.3-20).

### 16.4 Change control

Additive-only evolution (§15.6); immutable keys (§15.4); governance changes to centrally-governed items are themselves versioned and audit-trailed. UI copy never uses legacy terminology (reconciliation log, top of document).

### 16.5 Safety review

The critical registry, lint rule set, and escalation workflow are reviewed with the clinical owner every release; every addendum caused by a missed lintable error becomes a rule-gap review.

### 16.6 The analytics loop

Quarterly: never-fired tiles → retirement candidates; repeated free-text → tile candidates (AI proposes as drafts); frequently deleted recommendations → wording review; keystroke-adoption stats → coaching targets (§11.3); acceptance/edit/override rates by model version → calibration review.

---

## 17. Future Roadmap

### 17.1 Priority mapping

**Must/Should/Future** (capability tier, §4.3) maps to build order as: P0 = trust chassis + loop release (Must items 1, 9, 10, 19, 20 + §3.3/§3.4/§10.1/§11.1); P1 = hands release (Must authoring core 2, 5, 15, 4, 12, 16, 14 + §7.2/§7.3); P2 = calm release (Should tier + §9.2 stage rail, §9.5 hanging protocols, §3.8 luminance); P3 = adoption & polish (§11.3 coaching, §3.8 micro-recovery, arrangement memory).

### 17.2 Future-tier capabilities (gated on maturity, not desire)

- **Image-level missed-finding nudges** — localize-only, sign-off-only (§4.3-4); gate: image-AI precision at practice-acceptable false-nudge rate.
- **Agentic voice** ("compare with the 2024 study and draft the delta sentence") — same surfaces, same laws; gate: voice-verb reliability in the reading room.
- **Literature support** — retrieved-and-linked only (§4.3-11); gate: verifiable citation pipeline.
- **Pre-read urgency queue re-ordering** — labeled, never suppressing the independent read (§13.5).

### 17.3 Content roadmap

Next study tranche per §14; TI-RADS/PI-RADS scales enter through the §13.6 binding pattern; Echo enters as a structured-measurements module; USG Obstetric gets a dedicated design document (biometry tables, growth curves, anomaly checklists exceed this document's entry anatomy).

### 17.4 Standing success measures

The tables in §1 and §4.6 are the permanent scorecard; every release re-measures them. Speed gained at accuracy cost is failure, by definition.

---

## 18. Glossary

| Term | Definition |
|---|---|
| **Annex** | `RADIOLOGY_KNOWLEDGE_SEED_SPEC.md` §§3–6: normative per-study seed blocks and registers |
| **BI-RADS bar** | Quick Select group injecting a BI-RADS category with its structurally bound management line |
| **Combo tile** | One gesture firing an ordered set of finding entries with shared slots |
| **Command line** | The `/` / `Ctrl+K` type-ahead across tiles, macros, templates, AI actions, fields, priors |
| **Confidence bands** | *Routine / Worth a look / Attention* — the only confidence display (§12.5) |
| **Cord ladder** | Ordered cervical severity set: indenting thecal sac → abutting → indenting → compressing cord with signal change |
| **Critical registry** | `crit.*` — centrally governed list of findings/conditions that trigger escalation |
| **Delta brief** | Three-line prior comparison (unchanged/changed/new-resolved) shown at Orient |
| **Edge glow** | Ambient notification channel — a 2 s pulse at the screen edge |
| **Escalation** | The critical-results workflow: one-keystroke launch, auto-documented communication, timestamped |
| **Finding entry** | The atomic catalog unit (six-element anatomy, §5.1) |
| **Ghost text** | Dimmed provisional inline AI draft; `Tab`-walked sentence-by-sentence |
| **Green path** | Sign-off with no unresolved critical items — one gesture, zero friction |
| **Gutter mark** | Inline lint glyph: ✕ contradiction / △ inconsistency / ◌ completeness |
| **Identity band** | Per-patient color-fingerprinted header spanning report and viewer windows |
| **Koch's** | Indian reporting idiom for pulmonary tuberculosis (synonym-mapped) |
| **Ledger** | Pull-channel notification panel (`F9`); nothing in it animates |
| **Lesion registry** | Radiologist-curated tracked-lesion list with sparkline histories |
| **Margin card** | The one AI card anatomy: claim → band chip → source chips → Insert/Explain/Dismiss |
| **NAD** | "No abnormality detected" — the `/nad` macro and normal-template family |
| **Park** | Deferring a study with a mandatory one-line breadcrumb |
| **PIVD** | Prolapsed intervertebral disc — dominant Indian term; maps to protrusion/extrusion entries |
| **Prior timeline** | Left-rail chronological strip of the patient's imaging with one-line conclusions |
| **Provisional text** | AI- or voice-originated text pending radiologist touch/confirmation; blocks sign-off while present |
| **Quick Select** | The tile system (legacy name "Chocolate Box" retired to synonym) |
| **Reporting hanging protocol** | Per user × modality workspace posture, auto-learned, pinnable |
| **Reporting Workspace** | The single canonical reporting surface (supersedes Cockpit / Command Center) |
| **Root map** | Traversing/exiting nerve-root rule per disc level; drives spine lint |
| **Stage Rail** | The adaptive right rail following Orient → Observe → Measure → Conclude → Verify |
| **Structured shadow** | Organ/finding/laterality/size structure harvested from prose, never demanded before it |
| **Tile mnemonic** | 2–4 char per-study keyboard alias firing a tile |
| **Trust chassis** | The five Must features that precede all assistive content: one home, confidence, explainability, audit, authorship gate |
| **Zero-Click Read Loop** | Sign advances to the next pre-staged study; the worklist becomes a queue editor |

---

*End of master specification. The annex (`RADIOLOGY_KNOWLEDGE_SEED_SPEC.md` §§3–6) completes the normative content. Four source documents remain in the repository for historical traceability with supersession banners; where texts differ, this document prevails.*
