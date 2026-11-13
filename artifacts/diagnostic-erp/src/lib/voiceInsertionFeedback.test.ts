/**
 * The voice bar may not report a write that did not happen.
 *
 * A Quick Select click has an answer of its own (`QuickToggleOutcome`) since the
 * parameter contract, and the boundary returns it for reachable reasons: a side
 * nobody chose, an unresolved `{size}`-style parameter, a sentence already in the
 * report — plus `"pending"` while the overwrite dialog waits for an answer. Each
 * of those raises its own toast; only the voice bar disagreed.
 *
 * At `ba207aa62` the voice door called the toggle as a bare statement and threw
 * the verdict away:
 *
 *   useVoiceReporting.ts:151  `applyCatalogAfterConfirmRef.current(f, true);`
 *                             then `applied.push(f)` for every box it clicked,
 *                             then `ok: true, message: 'Applied ' + labels` (:162-164)
 *   useVoiceReporting.ts:294  `handleQuickToggleRef.current(f, nowSelected);`
 *                             then `ok: true, message: 'Selected "…"'` (:296-297)
 *
 * `useVoiceSession` renders that `ok` as `✓` in the command bar and arms the Undo
 * button with the returned frame (:152-153). So the bar said `✓ Selected "Glioma
 * recurrence"` about a sentence the report does not contain, while the boundary's
 * own toast on the same click said nothing was written, and it offered an Undo
 * whose only job would be to withdraw rows that click never created.
 *
 * Environment honesty: this is a React hook and vitest runs `environment: "node"`
 * repo-wide, so the wording is tested as a pure module and the wiring as a
 * source-level pin. Nothing here is browser evidence — no voice bar was rendered,
 * no microphone was opened.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeQuickSelectOutcome, summarizeCatalogApplyOutcomes,
} from "@/lib/voiceInsertionFeedback";
import type { QuickToggleOutcome } from "@/lib/zai-workspace/quickSelectTilePayload";

const here = dirname(fileURLToPath(import.meta.url));

function src(rel: string): string {
  return readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Strip comments so a comment can neither satisfy a pin nor defeat one. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const voiceHook = code(src("../hooks/radiology-workspace/useVoiceReporting.ts"));
const clinicalUi = code(src("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"));
const voiceSession = code(src("../hooks/useVoiceSession.ts"));
const payloadSrc = code(src("./zai-workspace/quickSelectTilePayload.ts"));

const LABEL = "Glioma recurrence";

describe("describeQuickSelectOutcome — one box, one click", () => {
  it("claims the past tense only for the two verdicts that wrote", () => {
    expect(describeQuickSelectOutcome("applied", LABEL, true)).toEqual({
      ok: true, message: `Selected “${LABEL}”`,
    });
    expect(describeQuickSelectOutcome("removed", LABEL, false)).toEqual({
      ok: true, message: `Removed “${LABEL}”`,
    });
  });

  it("says nothing was added when the boundary refused a select", () => {
    const r = describeQuickSelectOutcome("refused", LABEL, true);
    expect(r.ok).toBe(false);
    expect(r.message).toBe(`“${LABEL}” was not added — the report is unchanged`);
    // The sentence the bar used to speak for this click.
    expect(r.message).not.toMatch(/Selected|Applied|added “/);
  });

  it("says nothing was removed when a deselect was refused", () => {
    // Reachable: a clinical-history box whose template needs a side answers
    // through `toggleClinicalHistoryContribution`, which returns "refused".
    const r = describeQuickSelectOutcome("refused", LABEL, false);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("was not removed");
    expect(r.message).not.toMatch(/Removed/);
  });

  it("does not claim a pending overwrite dialog has been written", () => {
    const r = describeQuickSelectOutcome("pending", LABEL, true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("needs the on-screen confirmation first");
    expect(r.message).toContain("nothing has been written yet");
    expect(r.message).not.toMatch(/Selected|Applied/);
  });

  it("answers every verdict the boundary can return, and defaults to not-ok", () => {
    // The union is read from its declaration: a fifth verdict added there cannot
    // join this file's answer as an implicit success.
    const declared = payloadSrc.match(/export type QuickToggleOutcome =([^;]+);/);
    expect(declared).not.toBeNull();
    const members = declared![1].split("|").map((m) => m.trim().replace(/"/g, ""));
    expect(members.sort()).toEqual(["applied", "pending", "refused", "removed"]);
    for (const outcome of members as QuickToggleOutcome[]) {
      const r = describeQuickSelectOutcome(outcome, LABEL, true);
      expect(r.ok).toBe(outcome === "applied" || outcome === "removed");
      expect(r.message).toContain(LABEL);
    }
  });
});

describe("summarizeCatalogApplyOutcomes — a spoken sentence can match several boxes", () => {
  it("returns null when nothing was clicked, so the dictation falls through", () => {
    // Not a refusal: every matched box was already on the report, and this path
    // has always appended the spoken words as text in that case.
    expect(summarizeCatalogApplyOutcomes([], [], [])).toBeNull();
  });

  it("reports a clean multi-box apply", () => {
    expect(summarizeCatalogApplyOutcomes(["Disc herniation L4-L5", "Cerebral edema"], [], [])).toEqual({
      ok: true,
      message: "Applied “Disc herniation L4-L5” · “Cerebral edema”",
    });
  });

  it("names what did not land in the same breath as what did", () => {
    const r = summarizeCatalogApplyOutcomes(["Cerebral edema"], [LABEL], [])!;
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Applied “Cerebral edema”. not added: “Glioma recurrence”");
    // The box that was refused is not counted among the applied.
    expect(r.message.slice(0, r.message.indexOf("."))).toBe("Applied “Cerebral edema”");
  });

  it("splits an unconfirmed box from an applied one", () => {
    const r = summarizeCatalogApplyOutcomes(["Cerebral edema"], [], ["Fatty liver"])!;
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Applied “Cerebral edema”");
    expect(r.message).toContain("“Fatty liver” needs the on-screen confirmation first");
  });

  it("says nothing was applied when every box was refused", () => {
    const one = summarizeCatalogApplyOutcomes([], [LABEL], [])!;
    expect(one.ok).toBe(false);
    expect(one.message).toBe("Nothing was applied — “Glioma recurrence” was not added");
    expect(one.message).not.toMatch(/Applied “/);

    const two = summarizeCatalogApplyOutcomes([], [LABEL, "Cerebral edema"], [])!;
    expect(two.ok).toBe(false);
    expect(two.message).toContain("were not added");
  });

  it("keeps a wholly-pending apply out of the past tense", () => {
    const r = summarizeCatalogApplyOutcomes([], [], ["Fatty liver", LABEL])!;
    expect(r.ok).toBe(false);
    expect(r.message).toContain("need the on-screen confirmation first");
    expect(r.message).not.toMatch(/Applied|Selected/);
  });

  it("reports refusals alongside pendings when nothing landed", () => {
    const r = summarizeCatalogApplyOutcomes([], [LABEL], ["Fatty liver"])!;
    expect(r.ok).toBe(false);
    expect(r.message).toContain("“Glioma recurrence” was not added");
    expect(r.message).toContain("“Fatty liver” needs the on-screen confirmation first");
  });
});

describe("the voice door reads the verdict it is given (wiring pins)", () => {
  it("never calls a toggle as a bare statement, which is what discarded the verdict", () => {
    // The statement form is the defect: a call on its own line whose result is
    // not read. `ba207aa62` had two, at :151 and :294.
    expect(voiceHook).not.toMatch(
      /^[ \t]*(handleQuickToggleRef|applyCatalogAfterConfirmRef)\.current\([^)]*\);[ \t]*$/m,
    );
  });

  it("derives the explicit select/remove answer from the toggle's own verdict", () => {
    expect(voiceHook).toMatch(
      /const report = describeQuickSelectOutcome\(\s*handleQuickToggleRef\.current\(f, nowSelected\),\s*f\.label,\s*nowSelected,?\s*\);/,
    );
    expect(voiceHook).not.toMatch(/message: `\$\{nowSelected \? "Selected" : "Removed"\}/);
  });

  it("returns before arming an undo when the click did not land", () => {
    const guard = voiceHook.indexOf("if (!report.ok) return report;");
    const undo = voiceHook.indexOf("undo: () => handleQuickToggleRef.current(f, !nowSelected)");
    expect(guard).toBeGreaterThan(-1);
    expect(undo).toBeGreaterThan(guard);
  });

  it("collects the catalog verdicts instead of assuming them", () => {
    expect(voiceHook).toMatch(
      /const outcome = applyCatalogAfterConfirmRef\.current\(f, true\);\s*if \(outcome === "applied"\) applied\.push\(f\);\s*else if \(outcome === "pending"\) awaiting\.push\(f\.label\);\s*else withheld\.push\(f\.label\);/,
    );
  });

  it("counts a use, and offers an undo, only for the boxes that landed", () => {
    const appliedGuard = voiceHook.indexOf("if (applied.length > 0) {");
    const telemetry = voiceHook.indexOf("trackWorkspaceEvent({");
    expect(appliedGuard).toBeGreaterThan(-1);
    expect(telemetry).toBeGreaterThan(appliedGuard);
    expect(voiceHook).toMatch(/meta: \{ count: applied\.length/);
    // The undo loop replays the applied set only — never the withheld one.
    expect(voiceHook).toMatch(
      /undo: \(\) => \{\s*for \(const f of applied\) applyCatalogAfterConfirmRef\.current\(f, false\);/,
    );
    expect(voiceHook.indexOf("for (const f of withheld")).toBe(-1);
  });

  it("hands the refs a verdict-typed, fail-closed default", () => {
    // An unwired ref that returned void read as "no answer", which the door used
    // to fill in with a success sentence. A ref with no handler must refuse.
    expect(clinicalUi).toMatch(
      /const handleQuickToggleRef = useRef<\(finding: QuickFinding, nowSelected: boolean\) => QuickToggleOutcome>\(\(\) => "refused"\);/,
    );
    expect(clinicalUi).toMatch(
      /const applyCatalogAfterConfirmRef = useRef<\(finding: QuickFinding, nowSelected: boolean\) => QuickToggleOutcome>\(\(\) => "refused"\);/,
    );
    expect(voiceHook).toMatch(
      /handleQuickToggleRef: MutableRefObject<\(finding: QuickFinding, nowSelected: boolean\) => QuickToggleOutcome>;/,
    );
  });

  it("leaves the bar honouring the flag: no ✓, no Undo, for a not-ok answer", () => {
    // Not a change made here — pinned because the whole fix rides on it.
    expect(voiceSession).toMatch(
      /setFeedback\(result\.ok \? `✓ \$\{result\.message \?\? "Done"\}` : `✗ \$\{result\.message \?\? "Could not execute"\}`\);/,
    );
    expect(voiceSession).toMatch(/if \(result\.ok && result\.undo\) setLastUndo\(/);
  });
});
