> **Superseded:** consolidated into [CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md](CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md), the single authoritative design document. Where texts differ, the master spec prevails. Retained for historical traceability.

# CARE Radiology — The AI Radiologist Experience: Product Specification

**Author:** Chief AI Product Designer, CARE ERP Radiology
**Date:** 2026-07-09
**Status:** Product specification for implementation **after** the current frozen roadmap completes. No architecture, schema, API, or implementation content. Companion to `RADIOLOGY_WORKSTATION_UX_REVIEW.md` — this spec uses the interaction vocabulary defined there (ghost text, command line, gutter marks, edge-glow/ledger notification tiers, identity band, Zero-Click Read Loop) and designs the AI layer that lives inside it.
**Prime directive:** The AI assists; it never replaces. The radiologist is the sole author of every report. The AI is a brilliant, tireless, slightly junior colleague who reads everything, forgets nothing, speaks only when useful, shows its work when asked, and never touches the pen.

---

## Part 0 — The interaction doctrine (applies to every feature below)

Every AI feature in this spec obeys eight non-negotiable laws. They are stated once here and assumed everywhere; each feature's "Why it remains safe" builds on them.

1. **Offer, never act.** AI output is always a *proposal* rendered in a visually distinct provisional style (dimmed ghost text inline, or a margin card). It never inserts, deletes, scrolls, moves the cursor, or changes report state without an explicit radiologist gesture (`Tab` to accept, `Enter` on a card, voice "accept").
2. **Silence is a first-class output.** When the AI has nothing above its usefulness threshold, it shows nothing — no empty panels, no "no suggestions found" noise. An AI that mostly stays quiet is an AI whose interruptions get read.
3. **Provisional until touched.** All accepted AI text carries a provisional marker until the radiologist edits it, dwells on it, or confirms the section. Nothing AI-originated can reach sign-off unreviewed (this extends the existing "Requires review" badge into a per-sentence discipline).
4. **Honest, calibrated, three-band confidence.** The AI never displays raw percentages to the reading eye (they invite false precision). It speaks in three bands — *Routine* / *Worth a look* / *Attention* — while the exact model score is preserved one click deep and in the audit trail.
5. **Every claim is traceable.** Any suggestion can answer, in one interaction, "why do you say that?" — pointing to the sentence, measurement, prior report line, or image region it derived from.
6. **The radiologist's correction outranks the model.** Edits, rejections, and overrides are treated as the highest-value signal the system receives, and the product visibly honors them (the AI stops re-suggesting what this radiologist rejects).
7. **Interruption budget applies.** AI respects the workstation's tiering: only a confirmed-pattern critical finding may use the interrupt channel; everything else is ghost text, margin cards, edge-glow, or the ledger. Nothing AI-related fires during open-mic dictation except critical escalation.
8. **Reversible, always.** Every AI acceptance is a single atomic undo step. `Ctrl+Z` after accepting a ghost paragraph removes exactly that paragraph.

**The four moments of assistance.** All twenty features present through only four interaction surfaces, so the radiologist learns one grammar, not twenty:

| Surface | What appears there | Radiologist gesture |
|---|---|---|
| **Ghost text** (inline, dimmed) | Draft findings, impression drafts, refinements | `Tab` accept / `Shift+Tab` skip / type over |
| **Margin cards** (right stage-rail) | Differentials, recommendations, comparisons, literature | `Enter` insert / `E` explain / `X` dismiss |
| **Gutter marks** (left of the offending line) | Errors, inconsistencies, missed-item nudges | `F8` cycle / `Enter` jump / fix or dismiss |
| **Interrupt banner** (rare, earned) | Critical finding escalation only | Mandatory acknowledge |

---

## Part 1 — The twenty features

### 1. AI Copilot Panel — the one home for AI

**Priority: Must**

**User interaction.** The four existing AI surfaces (Copilot Phase 6, Copilot Phase 8, NeuroPrompt, Local-AI) present to the radiologist as **one copilot** with one personality and one location: the right stage-rail's AI region plus the command line (`/ask …`). The radiologist never chooses a panel, provider, or "phase" — they express intent ("differential," "polish," "compare with 2024 MRI") and routing happens invisibly under the existing provider flags. The panel has exactly three states: **Quiet** (nothing to say — collapsed to a slim presence line reading "Copilot: watching · nothing to add"), **Offering** (1–3 margin cards, never more), and **Asked** (responding to an explicit request, with a visible thinking state that can be cancelled with `Esc`).

**UI concept.** A single vertically-stacked card list in the stage rail. Every card shares one anatomy: *one-line claim → confidence band chip → source chip(s) → [Insert] [Explain] [Dismiss]*. A persistent footer line shows which engine answered (e.g., "Local · on-device") for transparency without ceremony. The panel never exceeds one screen-height; overflow goes to the ledger.

**Why it reduces workload.** Today "ask the AI" is a *where* question (which of four panels?) before it is a *what* question, costing a decision plus 4–6 clicks per assist. One home with one card anatomy means zero navigation and a single learned reflex for every AI capability in the product.

**Why it remains safe.** One surface means one review discipline — there is no "other panel" whose output follows different rules. The Quiet state prevents the panel from manufacturing content to justify its screen space, which is the root cause of automation-bias creep in competitor products.

---

### 2. AI Findings Suggestions — drafting the observable

**Priority: Must**

**User interaction.** As the radiologist works (dictating, typing, firing Quick Select tiles), the copilot composes candidate finding sentences from three inputs it already has: the study metadata/protocol, the measurement fields being filled, and — where image AI is available — image-derived observations. Candidates appear as **ghost text at the natural insertion point** in the Findings section, one finding at a time, in the radiologist's own template style. `Tab` accepts, `Shift+Tab` skips (skip is logged as signal), typing anything overwrites. Dictating over ghost text simply replaces it.

**UI concept.** Dimmed inline text with a subtle left-edge tick showing its origin (measurement-derived ⌗, prior-derived ↺, image-derived ◉). No popups, no side-by-side "AI draft" documents to transplant from.

**Why it reduces workload.** The biggest time cost in findings is not deciding *what* was seen — it is typing the boilerplate around it. Ghost findings convert a 15-word sentence into one keystroke while keeping the radiologist's eye at the exact line being authored, eliminating the read-panel → copy → relocate loop of the current Draft tab.

**Why it remains safe.** The radiologist physically steps through every sentence; nothing enters the report in bulk. Ghost text is provisional-styled until touched (Law 3), origin-ticked (Law 5), and skips train suppression (Law 6). Findings the AI cannot ground in a source get no ghost at all — silence, not speculation (Law 2).

---

### 3. Differential Diagnosis Suggestions — the colleague's second thought

**Priority: Should**

**User interaction.** Two triggers: *explicit* (`/differential` in the command line, or "differential" by voice) and *ambient* — when the written findings match a pattern with a meaningful differential, a single margin card appears: "Differential worth noting (3)". Expanding it lists up to five candidates, each one line: diagnosis → the *discriminator* ("favors X: rim enhancement + restricted diffusion") → what would distinguish it ("MRS or follow-up in 6 wks would separate from Y"). `Enter` inserts a differential paragraph in the radiologist's phrasing style; individual candidates can be toggled in/out before insertion.

**UI concept.** One collapsed card; expanded, a ranked list with discriminators in plain text — never probability percentages next to diagnoses (band chips only). A "not suggesting" line at the bottom shows the one nearest excluded candidate and why, so the radiologist can disagree with the AI's exclusions too.

**Why it reduces workload.** Differential construction is the highest-cognitive-load moment of reporting. A pre-structured, discriminator-led list converts recall ("what else causes this?") into recognition ("yes, include 1 and 3") — the single largest mental-effort reduction in this spec.

**Why it remains safe.** Discriminator-led display keeps the radiologist reasoning rather than rubber-stamping a ranked list. Ambient trigger fires only above threshold (Law 2), inserts nothing without selection (Law 1), and the "not suggesting" line makes the AI's blind spots inspectable rather than invisible.

---

### 4. Missed Finding Detection — the safety net that respects the fisherman

**Priority: Must (report-level) / Future (image-level)**

**User interaction.** Two layers with very different postures:
- **Report-level (Must):** the copilot continuously cross-checks the report against what the study *context implies should be addressed* — the clinical question in the indication, structures on the modality checklist, measurements entered but never mentioned, priors with findings this report neither confirms nor resolves. Gaps appear as **gutter marks** on the relevant section: "Indication asks about hydrocephalus — ventricles not yet addressed."
- **Image-level (Future, as image-AI capability matures):** before sign-off only — never during reading — a single card may appear: "One region may merit a second look (series 4, image 23)". Clicking focuses the paired viewer on that region.

**UI concept.** Gutter marks styled identically to error-prevention lint (feature 15) but with a distinct "completeness" glyph (◌). The image-level card shows a thumbnail with the region outlined — no diagnosis text attached, only *where to look*, preserving the radiologist's independent read.

**Why it reduces workload.** Paradoxically, a trusted safety net *speeds reading up*: radiologists reread their own reports precisely because they fear omission. A systematic completeness check lets the final self-review be one pass instead of three.

**Why it remains safe.** Report-level checks are deterministic and explainable (each mark cites the indication line, checklist item, or prior it derives from). Image-level nudges are deliberately *localizing, not diagnosing* — the AI says "look here," never "you missed a nodule," so the radiologist's perception, not the model's label, remains the diagnostic act. Timing (sign-off, not mid-read) avoids anchoring the initial search pattern.

---

### 5. Impression Refinement — the ghost draft, disciplined

**Priority: Must**

**User interaction.** When the cursor enters the Impression with findings written, the copilot offers the impression as ghost text — synthesized from *this report's findings*, ordered by clinical significance, in the radiologist's historical impression style. `Tab` walks it sentence-by-sentence. After the radiologist writes or edits their own impression, `/polish` (or voice "polish") offers a refinement diff — clarity, redundancy, tightening — shown as tracked-changes-style ghost edits, each accepted or rejected individually.

**UI concept.** Ghost text for the draft; for refinement, inline strike/insert marks in provisional styling with a floating "3 edits offered — Tab through" chip. Never a side-by-side rewrite: the radiologist reviews *changes*, not two whole documents.

**Why it reduces workload.** The impression is the most-rewritten paragraph in radiology. A significance-ordered draft in one's own voice, accepted sentence-wise, cuts impression time from minutes to seconds on routine studies — and refinement-as-diff removes the "did it change my meaning somewhere?" full reread that block rewrites force.

**Why it remains safe.** Sentence-wise acceptance forces sequential review (stronger than today's block "Insert into Impression"). The refiner is constrained to preserve every clinical assertion — it may not add findings, soften certainty, or change laterality/measurements; any such change is blocked and surfaced as "cannot refine without changing meaning." Diff display makes each alteration individually accountable.

---

### 6. Recommendation Generation — guideline-anchored next steps

**Priority: Should**

**User interaction.** When the impression contains findings with established follow-up pathways (incidental nodules, aneurysm surveillance, cyst classifications), a margin card offers the recommendation sentence with its anchor visible: "Follow-up CT in 6–12 months — per Fleischner 2017, solid nodule 6–8 mm, low-risk." `Enter` inserts; the guideline citation inserts with it (in the report style the practice prefers). If patient factors the AI cannot see would change the interval, the card says so: "assumes low-risk; if high-risk, interval is 3–6 months" — with both variants one keystroke apart.

**UI concept.** A single card, recommendation sentence on top, anchor chip below (guideline name + year), variant toggle if factors are ambiguous. Expired or superseded guidelines never render silently — the card states its guideline version explicitly.

**Why it reduces workload.** Recommendation writing is lookup work — exactly what machines should carry. Removing the "check the Fleischner table again" trip saves time *and* eliminates a class of from-memory interval errors.

**Why it remains safe.** Every recommendation is anchored to a named, versioned guideline (Law 5) — the AI never free-styles management advice. Ambiguity is surfaced as explicit variants rather than resolved by silent assumption. The radiologist inserts; the AI never auto-appends.

---

### 7. Structured Finding Assistance — free voice in, structure out

**Priority: Should**

**User interaction.** The radiologist dictates or types naturally; the copilot (extending the existing Smart Findings extraction) quietly maintains the **structured shadow** of the report — organ, finding, laterality, size, severity, actionability — visible as a compact structured strip in the stage rail. Where the practice requires structured fields (BI-RADS, protocol QA items, measurement sets), the strip shows which are satisfied by the prose so far (✓) and which remain (◌). Clicking or `Enter` on an unmet field jumps the cursor to the natural place to address it — or, where the prose already contains the answer, offers to map it ("'left kidney 9.8 cm' → fill Renal length L?").

**UI concept.** A slim two-column strip: field → state. Satisfied fields collapse; only gaps stay visible. No forms-first data entry anywhere — structure is *harvested from prose*, never demanded before it.

**Why it reduces workload.** Structured reporting's historical failure is making radiologists serve the form. Inverting it — prose first, structure harvested, gaps surfaced — delivers structured data at close to zero marginal effort and removes double-entry (say it, then type it in a field) entirely.

**Why it remains safe.** Every harvested mapping is confirmable (the "map this?" offer), and the prose remains the authoritative report — the structure is derived and auditable, never a competing source of truth. Mandatory fields (BI-RADS) gate sign-off exactly as they do today; the AI only makes reaching the gate cheaper.

---

### 8. Measurement Interpretation — numbers with meaning attached

**Priority: Should**

**User interaction.** When a measurement lands in the Measurement Assistant (typed, dictated, or auto-calculated — Evans Index, ABC/2, Cobb angle…), the field annotates itself: value → reference band for age/sex ("Evans 0.34 — above 0.30 upper limit") → trend vs. priors where they exist ("was 0.31 in 2024 → enlarging"). A ghost sentence expressing the interpretation is offered at the cursor in Findings.

**UI concept.** Inline annotation directly beneath the measurement field — band shown as a miniature range bar with the value's position marked, prior values as dots on the same bar. No separate "interpretation panel"; meaning lives where the number lives.

**Why it reduces workload.** Radiologists carry hundreds of thresholds in memory and re-derive "is this abnormal for a 7-year-old?" many times a day. Putting the reference band *on the field* deletes that recall step, and the trend dots collapse a prior-hunting expedition into a glance.

**Why it remains safe.** Reference bands are sourced, versioned, and displayed with their population caveat one click deep (Law 5). The AI annotates the number; only the radiologist decides whether it is a finding. Auto-calculations remain exactly as deterministic as today — this feature adds context, not computation.

---

### 9. Confidence Display — honest uncertainty, no theater

**Priority: Must**

**User interaction.** Every AI proposal carries exactly one of three band chips: **Routine** (grey — high-confidence, pattern well within training), **Worth a look** (amber outline — plausible but check me), **Attention** (filled amber — the AI itself flags material uncertainty or conflict). Pressing `E` (explain) on any chip reveals the layer beneath: the raw score, what drove it, and — critically — *what would change it* ("confidence limited: no contrast series available").

**UI concept.** Chips share one visual system across ghost ticks, margin cards, and gutter marks. No percentages, no green. (Green invites skimming; grey invites normal review; amber invites attention — the palette is a review-behavior instrument, not a scoreboard.)

**Why it reduces workload.** Calibrated bands let the radiologist *allocate scrutiny* — skim-review Routine ghosts, slow down on Attention cards — which is how experienced clinicians already triage a junior's work. Time flows to where uncertainty actually is.

**Why it remains safe.** Three honest bands beat false-precision percentages, which are known to induce both over-trust (97%!) and numeric anchoring. Band thresholds are calibrated against outcome data and audited (Part 2), so "Routine" is a measured claim, not a mood. The "what would change it" line keeps uncertainty *actionable* instead of decorative.

---

### 10. Explainability — "why do you say that?" in one gesture

**Priority: Must**

**User interaction.** Every AI artifact — ghost sentence, card, gutter mark, chip — answers `E` (or long-press, or voice "explain") with its **evidence view**: the specific inputs it derived from, highlighted in place. A prior-derived ghost highlights the exact sentence in the 2024 report; a measurement-derived finding highlights the field; an image-derived nudge outlines the region in the paired viewer; a guideline card opens the relevant guideline row. A second press reveals the model/provider, version, and prompt lineage (feature 18).

**UI concept.** Evidence appears as *highlighting of things already on screen or one glance away* — never as a wall of generated justification prose (LLM self-explanations are testimony, not evidence; we show sources instead). A breadcrumb line summarizes: "From: prior MRI 2024-03-11 · impression line 2 + today's DWI series."

**Why it reduces workload.** Trust calibrated by inspection is faster than trust rebuilt by re-derivation. When verifying a suggestion costs one keystroke and one saccade, the radiologist verifies more and re-does less.

**Why it remains safe.** Source-highlighting explainability is falsifiable — the radiologist can see when the cited evidence *doesn't* support the claim, which is exactly the failure mode generated-prose explanations hide. Suggestions that cannot cite a source do not render (Law 2/5); explainability is therefore a *gate*, not a garnish.

---

### 11. Literature Support — the library card, on request

**Priority: Future**

**User interaction.** Explicit-only (`/literature` on a selected finding or differential — never ambient). Returns up to three entries: a one-line takeaway, source type chip (guideline / society statement / peer-reviewed review), year, and citation. `Enter` inserts a formatted citation into the report where the practice style allows; otherwise it stays reference-only in the panel and files to the ledger for after-hours reading.

**UI concept.** Margin cards in the standard anatomy with a distinct "library" glyph, hard-capped at three results ranked by evidence hierarchy, each carrying its retrieval date. A visible "verify before citing" footer on every card.

**Why it reduces workload.** The rare "what does the literature say about this variant?" question currently means leaving the workstation entirely — a 5–10 minute context break. Answering it in-place protects the reading session even if the answer is used once a day.

**Why it remains safe.** Explicit-invocation-only prevents citation-decorated automation bias. Sources are retrieved-and-linked, never generated — a fabricated citation is a medico-legal hazard, so anything unverifiable simply doesn't render. Evidence-hierarchy ranking and dated retrieval keep the card honest about recency and strength.

---

### 12. Prior Report Comparison — the delta, not the archaeology

**Priority: Must**

**User interaction.** On study open (pre-staged by the Zero-Click loop), the copilot has already read the relevant priors and shows a **delta brief** in the Orient stage: three lines — *unchanged* (collapsed), *changed* ("lesion 8 mm → was 6 mm, +33% in 14 months"), *new/resolved*. Each line links to the prior's exact sentence. While writing, if the radiologist addresses a lesion the prior tracked, a ghost offers the comparison phrase ("…again seen, previously 6 mm, now 8 mm…") with both source values inspectable.

**UI concept.** The delta brief lives at the top of the prior-timeline rail: compact, three-line, expandable per item. Comparison ghosts carry the ↺ origin tick. Where priors are from outside reports (scanned PDFs), extraction confidence uses the standard band chips.

**Why it reduces workload.** Prior comparison is the most expensive routine act in reporting — open prior, find the lesion, transcribe numbers, compute change. The delta brief converts a multi-minute archaeology dig per study into a three-second glance, and the comparison ghost eliminates transcription (and its digit-swap errors) entirely.

**Why it remains safe.** Every delta line is dual-sourced and one keystroke from both originals (Law 5). Extracted-from-PDF values are banded, never presented with false certainty. The radiologist confirms each comparison sentence individually; the AI never asserts stability it can't cite.

---

### 13. Follow-up Comparison — longitudinal memory for tracked findings

**Priority: Should**

**User interaction.** For findings under surveillance (building on the existing Tumor Follow-up panel), the copilot maintains each lesion's **story**: a sparkline of size/measurement over every prior study, target-lesion status, and the applicable response criterion where relevant (RECIST-style contexts). When today's measurement lands, the story updates live and a ghost offers the longitudinal sentence ("Target lesion 3: 22 mm, previously 26 mm (−15%); overall course regressing since 2025-01"). At sign-off, any tracked lesion left unaddressed raises a completeness gutter mark (feature 4).

**UI concept.** One row per tracked lesion in the stage rail's Measure stage: name, sparkline, current value, trend arrow, criterion chip. Clicking a sparkline point opens that study's report line (and viewer, where images are archived).

**Why it reduces workload.** Longitudinal follow-up is where human working memory fails hardest — five lesions across four timepoints is twenty numbers. Making the trajectory a persistent visual object removes both the reconstruction labor and the "which lesion was target 2 again?" anxiety that slows oncologic reads most.

**Why it remains safe.** The lesion registry is radiologist-curated: the AI proposes lesion identity matches across studies, but linking (and unlinking) is an explicit human act — misregistration is the dangerous failure here, so it is never silent. Every sparkline point is source-linked; criterion calculations show their arithmetic on `E`.

---

### 14. Voice Dictation Assistance — the mic that understands radiology

**Priority: Must (core) / Future (full agentic voice)**

**User interaction.** *Core:* push-to-talk dictates into the focused section (per the UX review); the AI layer adds real-time domain correction — radiology vocabulary, unit normalization ("eight millimeters" → 8 mm), laterality phrasing, template-slot awareness (dictating over a placeholder fills it), and the ten-verb command set (*next field, impression, insert [macro], undo, park, sign…*). Corrections beyond trivial normalization render as provisional amber text for touch-to-confirm. *Future:* conversational acts — "compare this with the 2024 study and draft the delta sentence" — routed through the same copilot with the same card/ghost outputs.

**UI concept.** Dictated text streams at the cursor; normalizations appear already-applied with a faint underline (hover/`E` shows what was heard vs. rendered). A slim mic-state strip shows *listening / processing / idle* unambiguously — mic state must never be guessable-wrong.

**Why it reduces workload.** Dictation is already the fastest input; its tax is correction. Domain-aware normalization attacks exactly the errors that force re-reading (units, laterality, homophones like "ileum/ilium"), and voice verbs remove the residual mouse trips that currently break dictation flow.

**Why it remains safe.** Heard-vs-rendered is always inspectable, so normalization never silently changes meaning; anything semantically substantive stays provisional until touched (Law 3). Voice *verbs* are a fixed, small vocabulary — "sign" requires the same gate as the keystroke, including the critical-QA blocking list. Open-mic time suppresses all non-critical AI output (Law 7).

---

### 15. Error Prevention — the lint layer

**Priority: Must**

**User interaction.** The consistency engine (extending today's Quality Inspector and consistency checker) runs continuously and surfaces issues as **gutter marks while writing**, not as a sign-off wall: laterality contradictions (findings say left, impression says right), sex/organ and age/finding mismatches, measurement-text vs. measurement-field divergence, unfilled template placeholders, contradictory certainty ("no acute infarct" + "acute DWI restriction"), critical-finding-without-communication-note. `F8` cycles marks; `Enter` jumps to the line; each mark offers *fix* (one-keystroke correction where deterministic) or *dismiss with reason* (one tap: "intended"). The sign gate then shrinks to only unresolved critical marks.

**UI concept.** Three mark glyphs: ✕ contradiction (blocking-critical), △ inconsistency (non-blocking), ◌ completeness (from feature 4). Identical placement and interaction everywhere. Marks never move text or steal focus.

**Why it reduces workload.** Catching a laterality error at the line costs two seconds; catching it in the sign-off modal costs a full report re-read; catching it after signing costs an addendum and a phone call. Front-loading the lint also makes the final self-review a single-pass act (the report has been continuously verified) — this feature *is* the speed feature.

**Why it remains safe.** Deterministic checks (laterality, placeholders, number divergence) are exhaustive and explainable by construction. Dismissals require a reason and are audit-trailed (feature 19), so overriding safety is possible — radiologists are sometimes right against the rule — but never frictionless or invisible. The blocking tier is reserved for contradictions that would make the report internally false.

---

### 16. Critical Finding Escalation — the only interruption the AI has earned

**Priority: Must**

**User interaction.** When the AI detects a pattern in the *radiologist's own written findings* consistent with a critical result category (per the practice's critical-results policy), a **priority card** appears at the moment the finding is written: "This reads as a critical finding (intracranial hemorrhage). Start critical-results workflow?" One keystroke launches the existing escalation path — referrer contact surfaced, communication documented into the report, timestamps recorded. If image-AI (Future tier) flags a candidate critical *before* the read on a queued study, it may re-order the Zero-Click queue and must show its reason on the served study's Orient brief ("Served early: possible PE flagged — verify independently").

**UI concept.** The priority card uses the interrupt channel's visual weight but sits in the margin, not over the report — the radiologist is mid-thought on exactly this finding; covering their text would be self-defeating. Queue re-orders are labeled, never silent. Escalation state (contacted / documented / pending) is a visible chip on the identity band until closed.

**Why it reduces workload.** Critical-results workflows fail on logistics, not judgment — finding the referrer's number, remembering the documentation sentence, logging the time. One-keystroke launch with auto-documentation removes ten minutes of administrative scramble at exactly the moment cognitive load peaks.

**Why it remains safe.** Escalation on *written findings* means the human made the diagnosis; the AI only recognized its category and offered the workflow — assistance at its purest. Pre-read image flags never assert a diagnosis, are always labeled on arrival, and cannot suppress or bypass the radiologist's independent read. Declining the card requires a reason (mirroring lint dismissal), protecting both patient and radiologist.

---

### 17. Learning from Radiologist Corrections — the loop that makes it *theirs*

**Priority: Should**

**User interaction.** Mostly invisible: every accept, skip, edit, dismissal-with-reason, and override is captured as preference signal. Visible in two places: (a) the copilot adapts — stops offering the differential this radiologist always dismisses, adopts their phrasing patterns in ghosts, learns their recommendation style; (b) a monthly **"Your copilot" digest** in My Analytics: "You edited 14% of accepted ghosts (down from 22%) · You've rejected 'incidental sinus disease' phrasing 11 times — suppressed · 2 suggestions you dismissed were later addressed in addenda (review?)". A per-item "teach" affordance lets the radiologist explicitly correct a pattern ("never suggest X for pediatric studies") in plain language, with the resulting rule shown back for confirmation.

**UI concept.** No mid-flow "was this helpful?" prompts — ever. Signal comes from natural gestures. The digest is a pull-channel card; "teach" rules appear in My Prefs as a reviewable, deletable list in plain language.

**Why it reduces workload.** An AI that converges on *this* radiologist's practice needs progressively fewer corrections — acceptance rates climb, edit rates fall, and the assistant compounds in value instead of resetting every study. The digest turns the radiologist into the trainer, which is also what makes them trust it.

**Why it remains safe.** Personalization adjusts *style, phrasing, and suggestion selection* — it is firewalled from safety behavior: lint rules, critical escalation, confidence calibration, and guideline anchors never personalize (a radiologist cannot accidentally train the safety net to stay quiet). All learned rules are inspectable and deletable; the "dismissed but later addended" line keeps the learning loop honest in both directions.

---

### 18. Prompt History — the radiologist's own AI notebook

**Priority: Should**

**User interaction.** Every explicit AI ask (command-line queries, differentials, polishes, literature pulls) is preserved per-radiologist as a searchable history: `/history` recalls it, filterable by study, modality, or text. Any past interaction can be **re-run on the current study** ("run my usual white-matter workup prompt") or **pinned as a personal AI action** — appearing thereafter in the command line like a macro (this generalizes the existing NeuroPrompt categories into user-authored, reusable asks).

**UI concept.** A ledger-style list: ask → one-line result summary → study context chip → [Re-run] [Pin]. Pinned actions get names and appear in `/` autocomplete alongside macros and tiles — one vocabulary (per the UX review's command-line unification).

**Why it reduces workload.** Radiologists develop repeatable AI moves ("summarize priors for MS follow-up the way I like"). Recomposing that ask from scratch every time wastes the invention; pinning converts a good prompt into a permanent one-keystroke tool. History also answers "what did I ask on that case last week?" without reconstruction.

**Why it remains safe.** History is the user-facing face of the audit trail (feature 19) — the same record serves recall and accountability. Pinned actions execute under all standard laws (ghosts, cards, provisional text); pinning changes *access speed*, never review requirements. Histories are per-radiologist and private within the practice's governance policy.

---

### 19. AI Audit Trail — every suggestion, remembered

**Priority: Must**

**User interaction.** Passive during reading — zero interaction cost. Behind every signed report the system keeps the complete AI record: every suggestion rendered (including those never accepted), its confidence band and raw score, its evidence sources, the model/provider/version that produced it, and the radiologist's disposition (accepted / accepted-then-edited / skipped / dismissed-with-reason / overridden). Reviewable per-report through a **"Report provenance"** view: the final text with AI-originated spans subtly shaded and each span's lineage on click. Practice-level dashboards aggregate acceptance/edit/override rates by feature, modality, and model version for QA review.

**UI concept.** The provenance view is the signed report, annotated — not a log table. Shading is visible only in provenance mode, never in the clinical document. Aggregate dashboards live beside the existing My Analytics / QA surfaces.

**Why it reduces workload.** For the individual: instant, honest answers to "did I write that or accept it?" months later — invaluable in peer review and discrepancy meetings. For the practice: model regressions and drift become visible as rate changes, so quality management is a glance, not an investigation.

**Why it remains safe.** A complete disposition record — including *rejected* suggestions — is the difference between an auditable AI and a deniable one. It powers confidence calibration (feature 9), the learning loop's honesty checks (feature 17), and the medico-legal posture (feature 20). Recording is unconditional and cannot be disabled per-study.

---

### 20. Medico-legal Safeguards — the frame around everything

**Priority: Must**

**User interaction.** Largely invisible by design; visible exactly where it must be. (a) **Authorship is structural:** sign-off attests the radiologist's authorship and is technically impossible while any AI text remains untouched-provisional — the gate shows the remaining provisional spans as jump-links, not a scolding modal. (b) **The clinical report never discloses AI decoratively or shamefully** — it follows the practice's disclosure policy verbatim, configured once by governance, applied automatically. (c) **Degradation is explicit:** if AI services are unavailable or a model is under quality review, the workstation says so once ("Copilot offline — full manual mode") and every feature degrades to its manual equivalent; nothing half-works silently. (d) **Boundaries are baked in:** the AI never renders prognosis to patients, never communicates externally without radiologist action, and out-of-scope asks ("just write the whole report") return a standing refusal with the reason.

**UI concept.** The provisional-span jump-list at the sign gate; a single degradation banner state; a governance settings surface (policy text, disclosure wording, feature enablement, retention) that is versioned and itself audit-trailed.

**Why it reduces workload.** Counterintuitively, hard safeguards *reduce* cognitive load: the radiologist never has to privately adjudicate "am I allowed to lean on this?" — the product's constitution answers it. Explicit degradation also kills the most fatiguing failure mode of AI tools: silent partial function that must be second-guessed all shift.

**Why it remains safe.** This feature is the enforcement layer for Laws 1–8: authorship attestation makes "the AI wrote it" structurally false; unconditional audit (19) makes every assist reconstructable; calibrated bands (9) and source-gated rendering (10) make over-trust harder; and the refusal boundary keeps the product permanently on the *assist* side of the line it must never cross.

---

## Part 2 — Priority summary and sequencing

| # | Feature | Priority | Depends on |
|---|---|---|---|
| 1 | AI Copilot panel (one home) | **Must** | — |
| 9 | Confidence display | **Must** | 1 |
| 10 | Explainability | **Must** | 1, 9 |
| 19 | AI audit trail | **Must** | 1 |
| 20 | Medico-legal safeguards | **Must** | 19 |
| 2 | AI findings suggestions | **Must** | 1, 9, 10 |
| 5 | Impression refinement | **Must** | 2 |
| 15 | Error prevention lint | **Must** | 10 |
| 4 | Missed finding detection (report-level) | **Must** | 15 |
| 12 | Prior report comparison | **Must** | 10 |
| 16 | Critical finding escalation | **Must** | 15 |
| 14 | Voice dictation assistance (core) | **Must** | 2 |
| 3 | Differential diagnosis | Should | 1, 9, 10 |
| 6 | Recommendation generation | Should | 10 |
| 7 | Structured finding assistance | Should | 2 |
| 8 | Measurement interpretation | Should | 12 |
| 13 | Follow-up comparison | Should | 12 |
| 17 | Learning from corrections | Should | 19 |
| 18 | Prompt history | Should | 19 |
| 11 | Literature support | Future | 10 |
| 4b | Missed finding detection (image-level) | Future | 4, viewer maturity |
| 14b | Agentic voice | Future | 14, 1 |

**Sequencing logic.** The trust chassis ships first (1, 9, 10, 19, 20) — no assistive content feature launches without one home, honest confidence, inspectable evidence, complete audit, and the authorship gate. Then the authoring core (2, 5, 15, 4, 12, 16, 14): drafting, refinement, safety net, priors, escalation, voice. The Should tier deepens clinical intelligence once the chassis has earned daily trust. Future items wait on capability maturity, not desire.

## Part 3 — Success measures

- **Acceptance rate** of ghost findings and impression drafts (target: >70% sentence-accept on routine studies by month 3) with **edit-after-accept rate falling** month over month.
- **Suggestion precision:** dismissed-then-later-addended rate < 2% (the AI's misses are rare and honest).
- **Calibration audit:** outcomes within each confidence band match the band's claim, reviewed quarterly.
- **Lint value:** ≥ 90% of laterality/placeholder/divergence errors caught pre-sign; addendum rate for these error classes → 0.
- **Escalation latency:** critical finding written → communication documented, median < 5 minutes.
- **Interruption discipline:** zero non-critical AI interruptions during open-mic dictation, enforced as a bug class.
- **Radiologist-reported trust** (quarterly 3-question pulse: "helps me / slows me / I trust its silence") trending up on all three.
- **Time:** median sign-to-sign time on AI-assisted studies −25% vs. matched unassisted baseline, with **no rise** in discrepancy or addendum rates — speed that costs accuracy is failure.

---

## Closing principle

The ideal AI radiologist experience is measured by what the radiologist *stops noticing*: the boilerplate they no longer type, the thresholds they no longer recall, the priors they no longer excavate, the errors that no longer reach the sign gate, the escalation logistics that no longer steal ten minutes at the worst moment. The AI earns its place not by being impressive but by being *quietly, inspectably, correctably useful* — a colleague whose silence can be trusted, whose suggestions can be interrogated, whose memory is perfect, and whose pen never touches the report.
