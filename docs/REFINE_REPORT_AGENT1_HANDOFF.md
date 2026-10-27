# Refine Report — Integration Handoff for Agent 1

## Invoking Refine Report

The radiologist types a free-language instruction ("Organise findings by level",
"Add a canal measurement table", "Make this more professional"). The UI passes
the instruction, the current draft text, and any editor selection into
`resolveRefineTarget()` from `refineTarget.ts`.

```ts
import { resolveRefineTarget } from "../lib/reportComposer/refineTarget";

const target = resolveRefineTarget({
  instruction: userText,
  selection: window.getSelection()?.toString() ?? "",
  findings: currentFindings,
  impression: currentImpression,
  recommendation: currentRecommendation,
});
if (!target) return; // empty instruction → no-op
```

## How the target resolver decides

| Condition | Result |
|-----------|--------|
| Selection non-empty | `jobKind: "SELECTION_EDIT"`, `selectionText` is the selection |
| No selection | `jobKind: "SECTION_EDIT"`, `selectionText` is the labelled whole draft (Findings + Impression + optional Recommendation) |
| Selection found in Impression only | `selectionField: "IMPRESSION"` |
| Selection found in both or only Findings | `selectionField: "FINDINGS"` |

The instruction itself is NEVER reclassified. The model reads it verbatim.

## Creating the Composer job

Use the existing `POST /api/radiology/composer/enqueue` route with:

```json
{
  "worklistId": <number>,
  "jobKind": target.jobKind,
  "selectionText": target.selectionText,
  "selectionField": target.selectionField,
  "instruction": target.instruction
}
```

This flows through the same frozen-snapshot, tracked-change, and accept/apply
pipeline as every other Composer job kind. No new route, no new schema.

## Tracked-change review

After the job reaches READY, `GET /api/radiology/composer/jobs/:id` returns
`trackedChanges` — a list of `{field, originalText, proposedText, reviewState}`.
The existing review UI (accept/reject/edit per change) applies without modification.

## Applying accepted changes

`applyAiComposerAccepted()` (existing) writes accepted text into the workspace
editor and records the change in the observation ledger. This path is unchanged.

## Failures and unresolved questions

The draft schema includes `unresolvedQuestions: string[]` (now typed in the ERP
frontend types). When the model cannot honour an instruction without changing a
clinical fact, it returns the text unchanged and lists the reason in
`unresolvedQuestions`. Agent 1 should surface these alongside the validation
warnings in the review panel.

If `unresolvedQuestions` is non-empty, the radiologist sees:
> "The assistant could not [instruction] without changing a clinical fact.
> It has returned the text unchanged."

## What this PR does NOT touch

- MRI Brain workspace files
- Whole-spine reporting files
- The Command Center (closed by #884/#885)
- The observation ledger schema
- Agent 2's deterministic generator

Agent 1 owns the button placement, event wiring, and display layout.
