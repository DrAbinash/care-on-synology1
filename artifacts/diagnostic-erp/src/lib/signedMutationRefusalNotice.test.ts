/**
 * A refusal that only the console could hear.
 *
 * `refuseSignedMutation` guards 21 clinical mutators on a signed study, and
 * until now its only output was `console.warn`. Most of those mutators are
 * reachable from a control that is still enabled — the Confirm button of an
 * overwrite dialog armed before somebody signed, a canvas tile, a macro — so the
 * radiologist clicked, the dialog closed, nothing changed, and there was no
 * signal anywhere on screen.
 *
 * There is no DOM harness in this package (`environment: "node"` repo-wide), but
 * `toast` is a plain exported function rather than a hook, so mocking it makes
 * the whole path testable: real store, real signing action, real guarded
 * mutators, asserted on what the radiologist would have been shown.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import { announceSignedMutationRefusal } from "@/lib/zai-workspace/signedMutationRefusalNotice";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const here = dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(join(here, "zai-workspace/store.ts"), "utf8").replace(/\r\n/g, "\n");
const commandsSrc = readFileSync(
  join(here, "../hooks/radiology-workspace/useWorkspaceCommands.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

const toastMock = vi.mocked(toast);
const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;

/** How long one refusal stays on screen — the module uses this for both the
 *  toast duration and the suppression window. */
const ANNOUNCE_MS = 8000;

function described(): string {
  const call = toastMock.mock.calls.at(-1)?.[0] as { description?: string } | undefined;
  return call?.description ?? "";
}

/**
 * Ten minutes per test rather than a fixed clock: the suppression window is
 * module state, so without this a later case reusing an action name would be
 * silently throttled by an earlier one and pass for the wrong reason.
 */
let clock = Date.UTC(2026, 9, 6, 12, 0, 0);

beforeEach(() => {
  clock += 600_000;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  toastMock.mockClear();
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine",
      regions: ["LS Spine"],
      source: "auto",
    }),
    studies: [{ id: "study-signed", patient: { name: "Signed Patient", sex: "F" }, modality: "MR" }],
    activeStudyId: "study-signed",
    activeStudyInstanceUID: "1.2.840.SIGNED",
    clinicalHistoryText: "44F, L5 radiculopathy.",
    completedStudyIds: new Set<string>(),
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The real signing action, not `setState({ isFinalized: true })`, so every test
 *  below fails if signing ever stops setting the flag the guard reads. */
function sign() {
  useWorkspace.getState().completeFinalize();
  expect(useWorkspace.getState().isFinalized).toBe(true);
}

function tileOverlay(id: string) {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
    templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
    ownership: {
      anatomicalSection: DISC_L45.anatomicalSection,
      conflictGroup: DISC_L45.conflictGroup,
      baselineReplaces: DISC_L45.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: DISC_L45.scopeBodyPart,
    label: DISC_L45.label,
    findingsText: DISC_L45.sentence,
  });
}

describe("announceSignedMutationRefusal", () => {
  it("names the way back instead of the machine action", () => {
    expect(announceSignedMutationRefusal("setField:findings", clock)).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const call = toastMock.mock.calls[0][0] as {
      title?: string;
      description?: string;
      variant?: string;
      duration?: number;
    };
    expect(call.variant).toBe("destructive");
    expect(call.title).toContain("signed");
    // The correction path, not a dead end: withdrawal is reachable from Report
    // Hub since #852, which is the same fact PR-16 and PR-17 rely on.
    expect(call.description).toContain("Report Hub");
    expect(call.description).toContain("withdraw");
    // The action string is an internal identifier. Handing it to a radiologist
    // is the exact mistake #857 fixes for server error codes.
    expect(call.description).not.toContain("setField");
    expect(call.title).not.toContain("setField");
  });

  it("stays quiet while the same refusal is still on screen, then says it again", () => {
    expect(announceSignedMutationRefusal("setField:findings", clock)).toBe(true);
    // Every keystroke into a stale editor would otherwise re-fire this, and with
    // TOAST_LIMIT at 1 the radiologist would watch it flicker instead of reading it.
    expect(announceSignedMutationRefusal("setField:findings", clock + 1)).toBe(false);
    expect(announceSignedMutationRefusal("setField:findings", clock + ANNOUNCE_MS - 1)).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);

    expect(announceSignedMutationRefusal("setField:findings", clock + ANNOUNCE_MS)).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it("tracks different actions separately, so one busy field cannot mute another", () => {
    expect(announceSignedMutationRefusal("setField:findings", clock)).toBe(true);
    expect(announceSignedMutationRefusal("mergeField:quick-select", clock)).toBe(true);
    expect(announceSignedMutationRefusal("applyMacroBundle", clock)).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the toast on screen for as long as it suppresses a repeat", () => {
    announceSignedMutationRefusal("applyMergedResult", clock);
    const call = toastMock.mock.calls[0][0] as { duration?: number };
    expect(call.duration).toBe(ANNOUNCE_MS);
  });
});

describe("through the store — a refused clinical write is something the radiologist sees", () => {
  it("announces a guarded write on a signed study", () => {
    tileOverlay("qs-disc-l45");
    sign();
    toastMock.mockClear();

    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().setField("findings", "Inserted after signing.", { source: "manual" });

    expect(useWorkspace.getState().findingsText).toBe(before);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(described()).toContain("Nothing was applied");
  });

  it("announces the overwrite dialog's Confirm, which closes having done nothing", () => {
    // The reachable case: the dialog was armed while the report was still
    // writable, somebody signed, and the radiologist then pressed Confirm. The
    // guard dismisses the modal anyway — one that cannot be closed is worse —
    // so without a toast the button simply appeared to work.
    tileOverlay("qs-disc-l45");
    sign();
    useWorkspace.setState({
      confirmOverwriteOpen: true,
      pendingPathologyPatch: {
        incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
        templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
        ownership: {
          anatomicalSection: DISC_L45.anatomicalSection,
          conflictGroup: DISC_L45.conflictGroup,
          baselineReplaces: DISC_L45.baselineReplaces,
        },
        source: "quick-select",
        id: "qs-other",
        region: DISC_L45.scopeBodyPart,
        label: DISC_L45.label,
        findingsText: DISC_L45.sentence,
      },
    } as never);
    toastMock.mockClear();

    useWorkspace.getState().confirmOverwriteAndApply();

    expect(useWorkspace.getState().confirmOverwriteOpen).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(described()).toContain("Report Hub");
  });

  it("announces a canvas macro, whose callers all discard the blocked return", () => {
    sign();
    toastMock.mockClear();

    const outcome = useWorkspace.getState().applyMacroBundle({ observations: [] });

    expect(outcome).toBe("blocked");
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("announces a Quick Select tile, whose strip takes no disabled prop at all", () => {
    // The highest-traffic control in the workspace. `QuickSelectStrip` is
    // rendered at ReportCanvas.tsx:1605 directly below a sibling that does
    // receive `disabled={contentLocked}`, but its own props are field,
    // bodyPart, compact, anatomyFilter and onAfterPick — so the tile is clickable
    // and `onPick` runs `incUsage` and `onAfterPick` whether or not the write
    // landed. This guard was a bare `if`, so it refused without even a console
    // line, and it still returns "applied" while doing so.
    sign();
    toastMock.mockClear();

    const before = useWorkspace.getState().appliedPathologyPatches.length;
    const returned = useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
      templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
      ownership: {
        anatomicalSection: DISC_L45.anatomicalSection,
        conflictGroup: DISC_L45.conflictGroup,
        baselineReplaces: DISC_L45.baselineReplaces,
      },
      source: "quick-select",
      id: "qs-after-signing",
      region: DISC_L45.scopeBodyPart,
      label: DISC_L45.label,
      findingsText: DISC_L45.sentence,
      force: true,
    });

    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(before);
    expect(returned, "the false success value this PR deliberately does not change").toBe("applied");
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(described()).toContain("Nothing was applied");
  });

  it("leaves undoLastPatch to useWorkspaceCommands, which explains it better", () => {
    tileOverlay("qs-disc-l45");
    sign();
    const frame = useWorkspace.getState().patchUndoStack.at(-1);
    expect(frame, "the frame must survive the refusal for the command layer to read").toBeTruthy();
    toastMock.mockClear();

    expect(useWorkspace.getState().undoLastPatch()).toBe(false);

    // Not a gap: Ctrl+Shift+Z has its own refusal toast, and it distinguishes
    // "refused" from "nothing to undo" using the frame above. With TOAST_LIMIT
    // at 1 a second toast from the store would only flash underneath it.
    expect(toastMock).not.toHaveBeenCalled();
    expect(commandsSrc).toContain("Undo refused — the report is signed");
  });

  it("says nothing on a study that is not signed", () => {
    tileOverlay("qs-disc-l45");
    useWorkspace.getState().setField("findings", "Ordinary editing.", { source: "manual" });
    expect(useWorkspace.getState().findingsText).toContain("Ordinary editing.");
    expect(toastMock).not.toHaveBeenCalled();
  });
});

describe("ratchet", () => {
  it("still routes every guarded mutator through the single predicate", () => {
    expect(storeSrc.match(/function refuseSignedMutation\(/g) ?? []).toHaveLength(1);
    expect((storeSrc.match(/refuseSignedMutation\(get\(\)/g) ?? []).length).toBeGreaterThanOrEqual(18);
  });

  it("lets exactly one caller opt out of the announcement, and names it", () => {
    // A silent opt-out is how this regresses: the guard keeps returning true, so
    // every existing test still passes, and the refusal goes back to being
    // console-only. Pinning the count and the name means adding a second one is
    // a decision somebody has to make deliberately.
    const optOuts = storeSrc.match(/refuseSignedMutation\(get\(\), "[^"]+", false\)/g) ?? [];
    expect(optOuts).toEqual(['refuseSignedMutation(get(), "undoLastPatch", false)']);
  });
});
