# CARE Radiology Workstation — UX Review & Experience Redesign

**Author:** Chief Product Officer / Chief UX Designer, CARE ERP Radiology
**Date:** 2026-07-09
**Status:** Product & UX guidance only. Architecture, schema, APIs, and implementation roadmap are frozen and out of scope for this document. Nothing here proposes new features — every recommendation reshapes existing capabilities (Worklist, Cockpit/Command Center, Quick Select, Favorites & Macros, AI Copilot, Local AI, Voice Dictation, Measurement Assistant, Protocol QA, embedded OHIF/Weasis viewer, sign-off pipeline) so a radiologist reading 8–12 hours a day works faster with less mental effort.

**The one-sentence thesis:** Our workstation has world-class ingredients arranged for a mouse-driven, tab-hunting, one-study-at-a-time visit — the redesign turns it into a continuous, keyboard-and-voice-first *reading loop* where the next action is always under the radiologist's fingers and the next study is always already open.

---

## The user we are designing for

A radiologist signing 60–120 studies a day. Every avoidable click costs ~1 second; every tab switch costs ~2 seconds plus a re-orientation glance; every "where is that button?" moment costs 5 seconds and — worse — a piece of working memory that was holding a finding. Multiply by 100 studies and 8 hours: **the enemy is not any single screen, it is the accumulated micro-friction of the loop.** All recommendations below are judged against five budgets per study:

| Budget | Today (typical MRI, estimated from current flow) | Target |
|---|---|---|
| Clicks to signed report | 25–40 | ≤ 8 (0 on the "green path") |
| Keyboard-only completion | Impossible (no shortcuts exist) | 100% of the reporting loop |
| Eye "long saccades" (report ↔ far panel/tab) | 15–25 | ≤ 6 |
| Interruptions (toasts, modals, re-auth) | 3–6 | ≤ 1, and never during dictation |
| Time to signed report | 18–20 min manual / 12–15 with AI | 8–10 min routine study |

---

# 1. UX Review — honest audit of the current experience

## 1.1 What is genuinely strong (protect these)

- **One-click cockpit entry from the worklist row and one-click sign for QA-clean studies.** The `ONE_CLICK_WORKFLOW_OPTIMIZATION` work already established the right instinct: collapse ceremony, keep the safety gate only when the AI Quality Inspector has unresolved critical warnings. This is the correct asymmetry — fast when clean, deliberate when risky.
- **Quick Select ("Chocolate Box") with pinning and search.** One click injecting a complete finding + impression pair is the single highest-leverage speed feature in the product. Pinned tiles floating top-left respects Fitts's law.
- **`/macro` text expansion in Findings/Impression.** This is the embryo of the keyboard-first workstation. It is currently the *only* keyboard affordance in the product — and radiologists who discover it love it. Everything in §5 grows from this seed.
- **AI output discipline.** Every AI product ("Requires review" badge, never auto-finalized, provider fallback suggestions) treats the radiologist as the author, not the approver of a machine's report. Keep this posture permanently; it is a trust asset competitors squander.
- **Post-hardening stability posture.** Debounced quality checks (no more per-keystroke lag), panel error boundaries (a crashing panel no longer kills the report in progress), paginated worklist. Typing latency is a UX feature: **protect the input loop above all other rendering work, forever.**
- **Dark-by-default reading surfaces.** Correct for a reading room. (But see §1.2 on it being an aesthetic rather than a managed luminance system.)
- **Deep MRI intelligence.** Protocol QA checklists, 39 auto-calculating measurement fields (Evans Index, ABC/2, Cobb…), stroke-protocol time discipline. This depth is a moat; the UX task is making it reachable without hunting.

## 1.2 Where the experience breaks down (ranked by daily cost)

1. **No keyboard model at all.** Zero hotkeys in the Cockpit, Command Center, or workspace. A radiologist's hands must travel report → mouse → tab strip → tile → back, hundreds of times a day. Every peer system (Sectra, Visage, Philips) is operable heavily from keyboard/dictaphone buttons; we are operable only by mouse. This is the single largest deficiency.
2. **The 8-tab tool strip forces navigation instead of flow.** Quick / Findings / Templates / Measurements / Local-AI / Prior-Studies / My Prefs / Quality is an *inventory of capabilities*, not a *sequence of work*. The radiologist's job has a natural order (context → priors → observe → measure → conclude → verify → sign); our UI makes them remember which drawer each tool lives in and click to it. Tabs also hide state — you cannot see quality warnings while the Quality tab is hidden, or priors while writing the impression.
3. **Three overlapping reporting surfaces.** Cockpit vs. Command Center vs. Reporting Workspace (plus legacy pages) means muscle memory never compounds: buttons live in different places, features exist in one surface but not another, and training/documentation splits. For a professional tool, *sameness is speed.* One reporting surface must win; the others become redirects.
4. **The viewer is a separate tab, not a partner.** Launching OHIF/Weasis into a new browser tab de facto enables two monitors but the two windows share nothing afterward: no study-follow (opening the next study in the report window does not change the viewer), no synced patient identity check, focus lands unpredictably, and window arrangement resets every session. The pre-flight network diagnostic modal is excellent engineering surfaced as a *user-facing decision* ("force launch? switch profile?") that a reading radiologist should almost never have to make mid-list.
5. **AI Copilot is a vending machine, not a copilot.** The interaction is: open tab → pick category → pick action → Generate → read in panel → click "Insert into Impression." That's 4–6 clicks and two eye relocations per assist, and the result arrives as a block to be transplanted rather than a suggestion in place. The multiplicity of AI panels (Copilot Phase 6, Copilot Phase 8, NeuroPrompt, Local-AI) also makes "ask the AI" a *where* question before it can be a *what* question.
6. **Voice dictation is a destination, not an input method.** A dedicated dictation page with record → transcribe → review → insert stages means voice competes with typing instead of augmenting it. At ~20% maturity this is understood, but the *interaction contract* being built (batch transcription into a queue) is the wrong target; §3.4 defines the right one within existing capability.
7. **Notification and interruption hygiene.** Toasts appear over the working area; the mid-report forced logout (now patched) showed how catastrophic an interruption can be; critical-result, QA, and operational alerts share channels with routine confirmations. There is no "do not interrupt while dictating" concept.
8. **Worklist is a table, not a queue.** It reflects arrival order with filters. The radiologist decides "what next?" up to 120 times a day — a pure cognitive tax the system could pay instead (the docs already name AI urgency-ordering as a want). Every "what next?" decision also means a trip back to the worklist screen.
9. **Dark mode is a paint job, not a luminance system.** Fixed slate-900 with no user control, no calibration against reading-room ambient light, and some text/contrast combinations chosen aesthetically. Long-session visual fatigue is governed by *luminance ratios between report surface, viewer, and room* — not by "dark = good."
10. **Error prevention is back-loaded.** Quality checks concentrate at sign-off (Quality tab, blocking modal). Wrong-side/wrong-patient/sex-organ mismatches are cheapest to catch at the moment of writing, not at the gate.

## 1.3 How we compare — and where we can leapfrog

| Theme | Best-in-class today | Our current state | Our opportunity (invented, not copied) |
|---|---|---|---|
| Reading loop | Sectra's worklist-driven "next case" flow keeps radiologists in a rhythm | Manual return to worklist each study | **Zero-Click Read Loop** (§2.1): sign = next study already open, priors staged, template loaded |
| Viewer speed | Visage's instant server-side rendering from any client | New-tab launch with pre-flight probing | **Silent-resilient launch** (§2.4): probes run before the click; radiologist never sees a network decision |
| Hanging protocols | Philips IntelliSpace per-user, per-modality layouts | None | **Reporting hanging protocols** (§4.2): the *workspace* hangs per modality, not just images |
| Context sync | Epic Radiant's patient-context awareness across windows | None between report and viewer tabs | **Paired-window covenant** (§6.1): report and viewer are one workspace with a shared identity band |
| Dictation | PowerScribe-class field navigation via voice/dictaphone in competitor suites | Separate dictation page | **Cursorless dictation** (§3.4): the report's active section *is* the mic target; "next field" by voice or pedal |
| Speed tools | Everyone has macros/templates | Chocolate Box + `/macro` (good!) but mouse-gated tiles | **One vocabulary** (§3.1): tiles, macros, templates, AI actions unified under a single type-ahead command line |
| What to avoid | Epic Radiant in-basket noise; Centricity modal sprawl | We are drifting toward panel/tab sprawl | Interruption budget + single command surface (§3, §1.2-7) |

---

# 2. Workflow improvements — redesign the loop, not the screens

## 2.1 The Zero-Click Read Loop (flagship change)

Today the unit of work is "open a study." It should be "run my list."

**Redesigned loop:**
1. Radiologist opens the Cockpit once, at the start of a session. They never return to the worklist unless they choose to.
2. The system serves the **next best study** automatically: critical flags first, then stroke-protocol/time-critical, then AI-flagged urgency, then oldest-in-queue — with the ordering rationale shown in two words ("Critical · CT Head") so trust is never blind. The existing worklist becomes the *queue editor* (reorder, claim, defer), not the launchpad.
3. While the radiologist reads study *N*, the workstation **pre-stages study N+1**: lock acquired, priors fetched (Phase-8 Copilot already auto-fetches priors — move it earlier in time), modality template and Quick Select tab pre-selected, viewer preloading the series.
4. **Sign advances the loop.** On "Finalize & Sign" (or its keystroke, §5), the PDF/PACS/notify pipeline runs entirely in the background; the next study appears in under a second; a quiet edge indicator (§3.6) later confirms "Report 47 delivered." The radiologist's flow state never breaks to watch archiving spinners.
5. **Defer, don't abandon.** A single action ("park") sends an ambiguous study to a personal parking lane with a mandatory one-line breadcrumb ("await clinical history," "call referrer") that reappears when the study is re-served — so re-opening a parked study costs zero re-orientation.

**Why this beats the field:** Sectra optimizes assignment; Visage optimizes pixels. Nobody has fused "sign" with "next is already open, priors already compared, template already hanging." That fusion converts ~90 seconds of per-study logistics into 0 and — more importantly — removes ~100 daily "what next?" decisions.

## 2.2 Stage-aware workspace instead of tab-hunting

Replace the 8-tab mental model with the radiologist's own sequence. Same capabilities, re-sequenced (see §4 for layout):

| Reading stage | What the workspace foregrounds automatically | Today's equivalent |
|---|---|---|
| **Orient** (study opens) | Clinical indication, safety flags, prior-report one-liner, protocol QA verdict | Scattered: header + Prior-Studies tab + Quality tab |
| **Observe** (dictating findings) | Quick Select tiles for this study type, macros, Smart Findings extraction running quietly | Quick tab + My Prefs tab |
| **Measure** (a measurable finding is dictated/typed) | The relevant Measurement Assistant fields surface beside the sentence (typing "Evans" or dictating a ventricle finding raises the Evans Index field) | Measurements tab, 22–39 fields all at once |
| **Conclude** (cursor enters Impression) | AI impression draft offered as ghost text (§3.3), differential and follow-up guidance one keystroke away | Local-AI/Copilot tabs |
| **Verify & sign** (report complete) | Quality findings as an inline lint gutter (§3.5), consistency check, then the sign action | Quality tab + modal |

Stages are *suggestions*, never walls: everything remains reachable at any time via the command line (§3.1). The point is that in the default case, **the right tool is already on screen when the radiologist needs it,** eliminating most tab clicks and the "which drawer?" recall burden.

## 2.3 Consolidate to one reporting surface

Declare the Command Center layout the canonical reporting surface. Cockpit and Reporting Workspace become entry points into it (their routes forward there), and their unique strengths (e.g., any Cockpit-only panels) are absorbed as stage modules. Retire legacy reporting pages from navigation. Success measure: a radiologist trained on Monday finds every control in the same place on every study, every modality, forever. This costs no new capability — it is subtraction, the cheapest speed upgrade we own.

## 2.4 Make the viewer launch invisible

The network-profile intelligence (LAN/Tailscale/Public probing) is excellent — so run it *continuously in the background* from session start, not at click time. By the time the radiologist opens a study, the workstation already knows the healthy route and the working viewer. The diagnostic modal survives only for the truly-unreachable case, rewritten in plain language ("Images can't load on this network — try Weasis / retry / report without images") with one recommended action pre-focused. Radiologists should go weeks without ever thinking about network profiles.

## 2.5 Modality-tuned loops, one grammar

The loop above is identical across MRI, CT, US, Doppler, mammo, X-ray, Echo — only the *content* hanging in each stage changes (MRI hangs protocol QA + neuro measurement sets; US/Doppler hangs the sonologist worksheet; mammo hangs laterality-paired structure with BI-RADS-gated sign-off; X-ray hangs a two-line rapid template with the shortest path to sign). One grammar, per-modality vocabulary — so switching modalities mid-list (our radiologists do, constantly) costs zero relearning.

---

# 3. Interaction improvements — collapse clicks into keystrokes and utterances

## 3.1 One command surface: the Reporting Command Line

Today the same *intent* — "insert my standard disc-bulge text" — has four different UIs: a Chocolate Box tile, a `/macro`, a template, or an AI polish. Unify their *access* (not their storage or admin): a single type-ahead invoked by `/` in the editor or `Ctrl+K` anywhere, searching across **tiles + macros + templates + AI actions + measurement fields + priors** with frequency-weighted ranking (the usage analytics for this already exist in My Prefs).

- `/disc` → top hit is the pinned DISC_BULGE tile → `Enter` inserts finding + impression.
- `/evans` → jumps focus to the Evans Index measurement field.
- `/polish` → runs Local-AI Grammar Cleanup on the current section.
- `/prior` → opens the most recent comparable prior in the right rail.

Result: **the Chocolate Box becomes fully keyboard-operable without losing its visual grid** (the grid remains for visual pickers and trainees; the command line serves the expert who already knows what they want). This is the interaction pattern that makes 8 tabs unnecessary.

## 3.2 Quick Select, keyboard-native

For the visual grid itself: pressing the Quick Select hotkey overlays each visible tile with its two-character mnemonic (auto-generated, stable, learnable — e.g., `DB` on Disc Bulge). Type the mnemonic → tile fires → focus returns to the editor at the insertion point. Pinned tiles get single characters. The 24-tile cap stops being a browsing limit because search and mnemonics reach the whole catalog. Expected effect: a normal-study lumbar spine report becomes ~6 keystrokes of findings selection with zero mouse contact.

## 3.3 AI Copilot: from vending machine to marginal ghost

Keep every existing AI capability and its safety posture; change only the *delivery*:

- **Ghost drafts.** When the cursor enters the Impression of a study whose findings are written, the smart-impression draft renders as dimmed inline text. `Tab` accepts a sentence, `Shift+Tab` rejects it, typing anything simply overwrites — the exact contract developers love in code assistants, which no radiology vendor has shipped well. The "Requires review" principle is *strengthened*: the radiologist physically steps through every accepted sentence.
- **One ask box.** All AI panels (Copilot 6, Copilot 8, NeuroPrompt, Local-AI) answer through one place — the command line (`/ask differential for ring-enhancing lesion`) — with the provider/feature routing happening invisibly under the existing flags. The panels' tab real estate is reclaimed; their outputs land in one consistent right-rail card with one consistent **Insert / Discard / Refine** trio, always operable by keyboard.
- **Never push, always offer.** AI output never moves the cursor, never scrolls the report, never toasts. It waits, dimmed, at the margin. Consistency-checker findings appear as gutter marks (§3.5), not popups.

## 3.4 Voice as an input mode, not a page

Within the existing Web-Speech capability and review-before-insert safety model:

- **Mic lives in the editor.** Push-to-talk (hold a key, a dictaphone button, or a foot pedal — all just "hold to talk") dictates into the *currently focused section*. The separate dictation page remains only for long-form batch use.
- **Provisional-text contract.** Dictated text lands styled-as-provisional (underlined amber) and becomes normal text when the radiologist touches it or explicitly confirms the section — preserving "reviewed before signed" without a separate transcription queue screen.
- **Ten verbs, not a grammar.** Voice commands limited to a learnable set: *next field, previous field, impression, insert [macro name], undo, park study, sign.* Small vocabularies stay reliable and trainable; sprawling ones erode trust with misfires.
- **Dictation is sacred time.** While the mic is open, the workstation suppresses every non-critical toast, refetch flash, and badge animation (see §3.6).

## 3.5 Error prevention: lint the report while it's written

Move the Quality Inspector's presence (not its logic) from the sign-off gate into the writing surface:

- **Gutter marks** beside offending lines as they're written — laterality contradiction (left in findings, right in impression), sex/organ mismatch, measurement in text absent from the Measurement Assistant, template placeholder left unfilled, critical finding without a documented communication.
- **Identity is ambient, not checked.** A persistent patient band (name, age/sex, accession, modality) sits atop *both* the report window and viewer window in an identity-matched accent color derived per-patient — a mismatch between windows is visible pre-attentively, before any words are read. Wrong-patient dictation becomes structurally hard.
- **The sign gate gets smaller and stricter.** Because issues surface early, the final modal appears only for *unresolved critical* items — and when it does, it lists exactly the blocking items as one-click/one-key jumps to the offending line. Clean studies keep (and strengthen) the one-key sign.
- **Undo is a right, not a feature.** Every injection — tile, macro, AI insert, voice utterance — is a single atomic undo step. `Ctrl+Z` must never half-remove a Chocolate Box insertion.

## 3.6 Notification hygiene: the interruption budget

Three channels, strictly tiered, replacing the current toast-for-everything pattern:

1. **Interrupt (rare, earned):** critical result on *your* patient, stroke-protocol arrival, study reassignment. Full-attention banner, requires acknowledgment, may sound in the reading room. Budget: should be startling *because* it is rare.
2. **Edge glow (ambient):** background completions — report delivered, PACS archived, prior fetched, AI draft ready. A 2-second soft pulse on the relevant screen edge, no text unless glanced at (hover/peek reveals detail). Never steals focus, never covers the report.
3. **Ledger (pull):** everything else — operational notices, non-urgent QA stats, digest of the day — accumulates in a panel the radiologist opens between studies or at breaks. Nothing in the ledger ever animates.

During dictation or within 5 seconds of active typing, channels 2–3 are silent by rule.

---

# 4. Screen layout improvements

## 4.1 The canonical reporting layout (single-monitor baseline)

```
┌──────────────────────────────────────────────────────────────────────┐
│ IDENTITY BAND  ● Anita Rao · F 54 · MRI Brain C+ · Acc 20931 · ⚑QA ok │
├────────────┬──────────────────────────────────────┬──────────────────┤
│ CONTEXT    │            REPORT CANVAS             │  STAGE RAIL      │
│ RAIL (L)   │                                      │  (R, adaptive)   │
│            │  Clinical indication (1 line, fixed) │                  │
│ Queue      │  ─ Findings ───────────────────────  │  Orient: priors  │
│  ▸ now     │   …editor, ghost text, gutter marks… │  Observe: tiles  │
│  ▸ next    │  ─ Impression ─────────────────────  │  Measure: fields │
│  ▸ parked  │   …ghost draft offered here…         │  Conclude: AI    │
│ Prior      │                                      │  Verify: lint    │
│ timeline   │  [ progress dots: O·O·M·C·V ]        │                  │
├────────────┴──────────────────────────────────────┴──────────────────┤
│ COMMAND LINE  /                          mic ● PTT      Sign (⏎ path) │
└──────────────────────────────────────────────────────────────────────┘
```

- **Report canvas is the fixed center of gravity.** It never moves, resizes, or scrolls because of anything a panel does. Eyes return to a constant home position thousands of times a day; layout stability *is* fatigue reduction.
- **Left context rail** is read-mostly and stable: the queue (now / next / parked) and a **prior-study timeline** — a compact chronological strip of this patient's imaging with one-line conclusions, replacing the Prior-Studies tab. Glanceable history without navigation.
- **Right stage rail** is the only adaptive region (per §2.2), so change appears in exactly one predictable place. Its current stage is always visible in the progress dots under the canvas.
- **Bottom command line** replaces the tab strip as the universal access path; the mic state and the sign affordance live beside it, because "speak," "command," and "sign" are the three terminal actions of every study.
- **Tabs are demoted, not deleted:** a "More tools" overflow retains direct access to full Measurements, Preferences admin, and Quality detail for the rare deep-dive.

## 4.2 Reporting hanging protocols

Just as PACS hangs images, the workspace hangs *itself* per user × modality × study-type: which Quick Select tab, which template, which measurement set, which rail modules, which viewer layout request. Saved automatically from behavior ("you always open spine measurements on lumbar MRI — hang it by default?") with explicit pin/unpin control in My Prefs. IntelliSpace hangs pixels; we hang the *entire reporting posture*. Combined with the Zero-Click loop, opening a study means everything is already where yesterday's muscle memory expects it.

## 4.3 Density and typography for 8-hour eyes

- One report typeface at generous line-height; **section headers differ by weight/position, never by color alone.**
- Line length in the canvas capped near ~75 characters — full-width text on wide monitors is measurably slower to scan and re-find.
- Reserve saturated color exclusively for meaning (critical, warning, AI-provisional, dictation-provisional). The current slate palette's decorative accents compete with the four colors that matter.
- All type on a 4-step user-controlled scale (per §9 accessibility), persisted per user.

---

# 5. Keyboard-first workflow

Design rule: **every action in the reporting loop has a keystroke; the mouse is an alternative, never a requirement.** One global cheat-sheet key (`?`) overlays the map. All bindings user-remappable in My Prefs (radiologists arrive with PowerScribe/PACS reflexes from prior jobs — let them keep them).

### The home-row loop (defaults, illustrative)

| Intent | Key | Notes |
|---|---|---|
| Command line | `/` (in editor) or `Ctrl+K` | Reaches everything: tiles, macros, templates, AI, fields, priors |
| Quick Select mnemonic overlay | `Q` (when editor unfocused) or `Ctrl+Q` | Then 1–2 chars to fire a tile (§3.2) |
| Next / previous report section | `Ctrl+↓` / `Ctrl+↑` | Findings → Impression → … also voice verbs |
| Accept / reject ghost sentence | `Tab` / `Shift+Tab` | AI drafts only ever advance sentence-by-sentence |
| Push-to-talk | hold `Ctrl+Space` (or pedal/dictaphone) | Release = provisional text lands at cursor |
| Jump to first lint mark | `F8` | Cycles gutter issues; `Enter` on one jumps to line |
| Park study (with breadcrumb prompt) | `Ctrl+P` | One line, then next study serves |
| Sign & next | `Ctrl+Enter` | Green path: signs instantly; gated path: opens the (keyboard-navigable) blocking list |
| Skip to next study without signing | `Ctrl+→` | Keeps lock rules intact; study returns to queue per policy |
| Launch / focus viewer | `F2` | Focuses the paired window if open, launches if not |
| Viewer sync to current study | automatic | See §6.1 — no key needed is the point |
| Undo last injection | `Ctrl+Z` | Atomic per §3.5 |
| Notification ledger | `F9` | Pull channel only |

### Why this is more than a shortcut list

- **The green path is literally three inputs per routine study:** mnemonic keys for normal-template tiles → `Ctrl+↓` to impression → `Tab`-walk the ghost draft → `Ctrl+Enter`. Sign-to-sign, hands never leave the keyboard, eyes never leave the canvas.
- **Focus discipline is a hard product guarantee:** no background completion, refetch, or panel update may steal keyboard focus from the editor. Ever. (The historical mid-report logout is the cautionary tale.)
- **Discoverability without training days:** every button's tooltip shows its keystroke; the `?` overlay highlights the three keys the user *hasn't* adopted yet with a one-line payoff ("Ctrl+Enter would have saved you 214 clicks this week" — the My-Analytics data already counts these).

---

# 6. Multi-monitor recommendations

Our reality: a two-window setup already emerges organically (report window + viewer tab), and some radiologists roam on laptops. Design for **three tiers with one behavior**:

## 6.1 The paired-window covenant (all tiers)

Whatever the hardware, the report window and viewer window behave as one workstation:

- **Study-follow:** when the loop advances to the next study, the viewer follows automatically — no re-launch, no second click. (This alone removes the biggest hidden click-tax in the current design.)
- **Shared identity band:** both windows show the same patient band with the same per-patient accent color (§3.5). One glance across monitors verifies identity pre-attentively.
- **Focus etiquette:** `F2` flips focus report↔viewer; signing never yanks focus to the viewer; the viewer never raises itself.
- **Arrangement memory:** window positions/sizes per monitor-fingerprint are restored every session. Rebuilding the desk each morning is banked time.

## 6.2 Tier guidance

| Tier | Setup | Guidance |
|---|---|---|
| **Reference** (reading room) | 1× diagnostic display (images) + 1× vertical or landscape worklist/report display + keyboard/mic/pedal | Viewer owns the diagnostic display edge-to-edge; report layout (§4.1) owns the second display; identity bands aligned along the shared bezel edge so the cross-check saccade is minimal and horizontal. |
| **Standard** (office) | 2× commodity monitors | Same as reference; workstation detects the second display and offers the split once, then remembers. |
| **Roaming** (laptop, on-call) | Single screen | A `F2`-toggled overlay mode: viewer full-screen with a collapsible report drawer (dictation + command line only), so preliminary reads don't require window juggling; full canvas on return. |

## 6.3 What we deliberately don't do

No four-monitor sprawl, no detachable floating panels. Panel-tearing (à la some Centricity/IntelliSpace configurations) creates per-user layout drift, support burden, and hunt-time. Two windows, strong covenant, zero configuration.

---

# 7. Reading-room ergonomics

The workstation's UX extends into the physical room; software should carry its share:

1. **Managed luminance, not fixed dark.** Keep dark as default, but add a session luminance control (three steps: dim room / normal / bright office) that scales *surface* brightness while preserving contrast ratios — and schedule-aware auto-dimming for evening shifts. The report surface should sit near the viewer's mid-grey so the report↔images saccade doesn't force pupil re-adaptation hundreds of times an hour. (This is the correct version of "dark mode" for our users; a cosmetic toggle is not.)
2. **Sound with intent.** Optional, quiet, distinct earcons for exactly two events: sign-confirmed and critical-interrupt. Nothing else ever sounds. In a shared reading room, all sound defaults off with per-user opt-in on their own device.
3. **Hands-free where hands are busy.** Pedal/dictaphone-button PTT (§3.4) means posture doesn't collapse toward the mouse over the shift. Every hold-to-talk device maps to the same single input; no device-specific behavior.
4. **Micro-recovery by design.** After a signing streak (e.g., 90 minutes continuous), the *between-studies* moment — never mid-study — offers a dismissible 20-second pause card (look 6 m away; the 20-20-20 habit). Paired with the My-Analytics session view ("you read 34 studies in 3h10m; your median TAT drifts +18% after hour 4"), fatigue becomes visible and self-manageable rather than moralized. Zero gamification, zero streak-shaming.
5. **Interruption shielding for the room.** The dictating-state (mic open) is honored by the *whole* product: operational dashboards, WhatsApp/SMS-triggering events, and QA nudges queue to the ledger. Reading rooms are interruption sinks; our software should be the one thing in the room that never taps them on the shoulder uninvited.
6. **Session continuity.** Re-authentication, network profile changes, and app updates must never occur mid-report (grace-complete the open study first). The patched forced-logout bug becomes a standing product guarantee with a name: **"never lose a sentence."** Draft state survives crash, tab-close, and roaming handoffs, always.

---

# 8. Prioritized UX backlog

Ordered by (radiologist-minutes saved × error-risk reduced) ÷ effort. P0 = do first; each row is a shippable slice of the sections above. No new features — all rows recompose existing capability.

| # | Pri | Item | What ships | Primary payoff | Effort |
|---|---|---|---|---|---|
| 1 | **P0** | **Core keyboard map** (§5) | Sign-&-next, section jump, command line `Ctrl+K`, PTT key, undo-atomicity, focus-steal ban, `?` overlay | Unlocks every other speed gain; largest single click reduction | M |
| 2 | **P0** | **Zero-Click Read Loop v1** (§2.1) | Auto-serve next study on sign; background sign pipeline; park-with-breadcrumb | ~60–90 s logistics removed per study; flow state preserved | M |
| 3 | **P0** | **One reporting surface** (§2.3) | Command Center canonical; Cockpit/Workspace routes forward into it; legacy pages retired from nav | Muscle memory compounds; halves training & support surface | M |
| 4 | **P0** | **Identity band + paired-window covenant v1** (§3.5, §6.1) | Shared patient band w/ per-patient accent in both windows; viewer study-follow; `F2` focus flip | Wrong-patient/wrong-study risk structurally reduced; kills re-launch tax | M |
| 5 | **P1** | **Command line unification** (§3.1) | `/` type-ahead across tiles+macros+templates+AI actions, frequency-ranked | Converts the Chocolate Box & AI suite to keyboard-native | M |
| 6 | **P1** | **Quick Select mnemonics** (§3.2) | Tile mnemonic overlay, single-char pinned tiles, focus-return contract | Routine-study findings in seconds, zero mouse | S |
| 7 | **P1** | **Notification tiering** (§3.6) | Interrupt / edge-glow / ledger channels; dictation & typing silence rule | Interruption budget enforced; dictation protected | S–M |
| 8 | **P1** | **Ghost-draft impression** (§3.3) | Smart-impression as inline dimmed text; `Tab`/`Shift+Tab` sentence walk; provisional styling | AI assist without eye relocation; review discipline strengthened | M |
| 9 | **P1** | **Inline report lint** (§3.5) | Quality/consistency checks as live gutter marks; smaller, stricter sign gate with jump-to-issue | Errors caught at write-time; sign gate stops being a wall | M |
| 10 | **P2** | **Stage-aware right rail** (§2.2, §4.1) | Adaptive rail (orient/observe/measure/conclude/verify); tabs demoted to overflow | Ends tab-hunting; right tool on screen at the right moment | L |
| 11 | **P2** | **Reporting hanging protocols** (§4.2) | Per user×modality workspace posture, auto-learned + pinnable | Zero-setup familiarity on every study | M |
| 12 | **P2** | **Editor-native dictation** (§3.4) | PTT into focused section; provisional-text contract; ten voice verbs | Voice becomes an input method; posture relief | M–L |
| 13 | **P2** | **Silent viewer resilience** (§2.4) | Continuous background probing; modal only for hard failure, plain-language, one recommended action | Network decisions vanish from the reading day | S–M |
| 14 | **P2** | **Luminance system** (§7.1) | 3-step surface luminance, schedule-aware dimming, contrast-safe palette pass | Direct visual-fatigue reduction for 8–12 h sessions | S–M |
| 15 | **P3** | **Prior timeline rail** (§4.1) | Chronological strip w/ one-line conclusions replacing Prior-Studies tab | Glanceable history; fewer panel trips | M |
| 16 | **P3** | **Arrangement memory + roaming overlay** (§6.1–6.2) | Window layout persistence per display setup; single-screen overlay mode | Desk rebuilds itself; laptop reads stop being juggling | M |
| 17 | **P3** | **Fatigue-aware session view** (§7.4) | Between-study micro-pause card; session drift stats in My Analytics | Sustainable pace, visible fatigue | S |
| 18 | **P3** | **Keystroke coaching** (§5) | Tooltip keys everywhere; "3 keys you're missing" nudge from usage data | Adoption engine for items 1–12 | S |

**Sequencing note:** Items 1–4 are one coherent release ("the loop release") and should be validated together in a live reading session with 2–3 staff radiologists using a stopwatch and a click counter — the five budgets in the opening table are the acceptance criteria. Items 5–9 form release two ("the hands release"), 10–14 release three ("the calm release").

### Measures of success (per release, from existing analytics)

- Median sign-to-sign time (not just TAT) — target −30% by release two.
- Clicks per signed study (instrument once, watch forever) — target ≤8 median.
- % of studies signed with zero mouse contact — target 40% by release two.
- Interruptions rendered during dictation — target 0, enforced as a bug class.
- Wrong-patient/wrong-side near-miss reports — target 0 with identity band live.
- Radiologist-reported end-of-shift fatigue (2-question pulse, monthly) — trending down.

---

## Closing principle

Sectra earns its speed reputation with the worklist; Visage with the pixels; Philips with the hang; Epic with the context. We will earn ours with **the loop**: from the moment a radiologist sits down to the moment they stand up, the workstation should feel like one continuous gesture — study appears, fingers speak, images follow, errors surface themselves, signing is a heartbeat, and the next study is already waiting. Every backlog item above is that sentence, decomposed.
