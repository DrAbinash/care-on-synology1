/**
 * C1 — Smart Dictation is bound to the study it was spoken against.
 *
 * The panel is mounted once per reporting workspace while the route study
 * changes underneath it, and until now the session carried no study identity at
 * all. The consequence is the defect this file reproduces: words dictated
 * against patient A's Findings survive a navigation, the Compose press then
 * reads whatever narrative is on screen, and Apply writes A's sentences into B's
 * report through `applyVoiceComposerPlan` — where autosave persists them inside
 * B's current generation, past every signed-report guard.
 *
 * Three shapes, three witnesses:
 *   • navigation           — the route id moves; the session is voided and announced;
 *   • row re-linked        — the DICOM StudyInstanceUID moves under the same row id;
 *   • store lag / divergence — `activeStudyId` no longer names the bound route id,
 *     which is the one that matters, because the STORE decides where the write lands.
 *
 * No jsdom/test-renderer dependency: ReactDOM mounts a null-rendering probe (the
 * pattern this package already uses in useDraftPersistence.behavior.test.ts), and
 * the workspace store, the fold, the preview and Apply all execute unchanged. The
 * compose response is a real `deterministicCompose` plan handed back through a
 * mocked transport — no invented payload, no network, no PHI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DICTATION_APPLY_REFUSAL_MSG,
  DICTATION_STUDY_SWITCH_MSG,
  useSmartDictation,
} from "./useSmartDictation";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { deterministicCompose } from "../../../api-server/src/lib/voiceReportComposer/composer";
import type { ComposeApiResponse } from "@/lib/voiceReportComposer/types";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/fetchApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/fetchApi")>(),
  api: transport,
}));

const normalLs = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
/** Patient A's dictation and patient B's narrative — synthetic, no identifiers. */
const WORDS_A = "Disc desiccation at L3-4 and L4-5.";
const WORDS_B = "Loss of lumbar lordosis.";
const B_NARRATIVE = {
  findingsText: "Straightening of the lumbar lordosis with multilevel facet arthropathy.",
  impressionText: "Loss of lumbar lordosis, multilevel facet arthropathy.",
};

function hostContainer(): HTMLElement {
  const document = Object.assign(new EventTarget(), {
    nodeType: 9,
    activeElement: null,
    documentElement: null,
  });
  const window = Object.assign(new EventTarget(), { document, HTMLIFrameElement: class {} });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return Object.assign(new EventTarget(), {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
  }) as unknown as HTMLElement;
}

function deferred<T = ComposeApiResponse>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

/** The response the route would hand back for these words, against the live narrative. */
function responseFor(transcript: string): ComposeApiResponse {
  const plan = deterministicCompose({
    transcript,
    region: "LS Spine",
    findingsText: useWorkspace.getState().findingsText,
  });
  if (!plan || !plan.observations?.length) {
    throw new Error(`the deterministic composer returned no observation plan for: ${transcript}`);
  }
  return { ok: true, plan };
}

type Hook = ReturnType<typeof useSmartDictation>;
let result: Hook;
let root: Root;

function Probe({ studyId }: { studyId: number | undefined }) {
  result = useSmartDictation({
    studyId,
    region: "LS Spine",
    modality: "MR",
    reportTitle: "MRI lumbar spine",
    enabled: true,
  });
  return null;
}

/** The store state one open study holds, exactly as `selectStudy` leaves it. */
function settleStudy(studyId: number | null, uid: string | null, narrative?: Record<string, string>) {
  useWorkspace.setState({
    activeStudyId: studyId == null ? null : String(studyId),
    activeStudyInstanceUID: uid,
    clinicalHistoryText: "",
    techniqueText: normalLs.technique,
    findingsText: narrative?.findingsText ?? normalLs.findings,
    impressionText: narrative?.impressionText ?? normalLs.impression,
    recommendationText: normalLs.recommendation,
    fieldProvenance: {},
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    appliedPathologyPatches: [],
    patchUndoStack: [],
    patchRedoStack: [],
    lastPatchSnapshot: null,
    lastVoiceApplyId: null,
    isDirty: false,
    isFinalized: false,
  });
}

async function render(studyId: number | undefined = 42) {
  await act(async () => { root.render(createElement(Probe, { studyId })); });
}

/** Re-render with a new route study, the way a workspace navigation does. */
async function navigateTo(studyId: number, uid: string | null, narrative?: Record<string, string>) {
  settleStudy(studyId, uid, narrative);
  await render(studyId);
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

/** The radiologist's own sequence: type/dictate a line, press Compose, press Apply. */
async function stageAndCompose(words = WORDS_A) {
  await act(async () => { result.stageDictation(words); });
  await act(async () => { result.composeStaged(); });
  await settle();
}

async function pressApply() {
  let applied = false;
  await act(async () => { applied = result.applyAll(); });
  return applied;
}

beforeEach(() => {
  vi.clearAllMocks();
  transport.post.mockReset();
  settleStudy(42, "1.2.840.42");
  transport.post.mockImplementation(async () => responseFor(WORDS_A));
  root = createRoot(hostContainer());
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("C1 — the bound study receives its own dictation", () => {
  it("the normal lane is unchanged: stage, Compose and Apply into the study on screen", async () => {
    await render();
    await stageAndCompose();
    expect(result.pendingCount).toBeGreaterThan(0);

    const before = useWorkspace.getState().findingsText;
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(before);
    expect(result.error).toBeNull();
  });

  it("a workspace with no route study still dictates — the no-param surfaces are not refused", async () => {
    settleStudy(null, null);
    await render(undefined);
    await stageAndCompose();
    expect(result.pendingCount).toBeGreaterThan(0);

    const before = useWorkspace.getState().findingsText;
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(before);
  });

  it("an unparseable route id is unbound, not a study named \"nan\"", async () => {
    // App.tsx computes `Number(params.studyId)`; a garbage param must not become
    // an identity that two different studies compare equal to.
    settleStudy(null, null);
    await render(Number("not-a-study"));
    await stageAndCompose();
    expect(await pressApply()).toBe(true);
  });

  it("a second dictation after a successful Apply binds the study as it is now", async () => {
    // The binding is released by the Apply it guarded: keeping it would refuse
    // the next batch over a uid that moved after those words were already
    // written, and the radiologist would be told to re-dictate words that are
    // already on the page.
    await render();
    await stageAndCompose();
    expect(await pressApply()).toBe(true);

    await act(async () => { useWorkspace.setState({ activeStudyInstanceUID: "1.2.840.999" }); });
    transport.post.mockImplementation(async () => responseFor(WORDS_B));
    await act(async () => { result.stageDictation(WORDS_B); });
    expect(result.staged).toContain("lordosis");
    expect(result.error).toBeNull();

    await act(async () => { result.composeStaged(); });
    await settle();
    expect(result.pendingCount).toBeGreaterThan(0);
    const ledgerBefore = useWorkspace.getState().voiceComposerObservations.length;
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().voiceComposerObservations.length).toBeGreaterThan(ledgerBefore);
  });

  it("the refusal names no patient, no study id and none of the dictated words", async () => {
    await render();
    await stageAndCompose();
    settleStudy(43, "1.2.840.43", B_NARRATIVE);
    await pressApply();
    for (const message of [result.error ?? "", DICTATION_STUDY_SWITCH_MSG, DICTATION_APPLY_REFUSAL_MSG]) {
      expect(message).not.toMatch(/\d/);
      expect(message.toLowerCase()).not.toContain("desiccation");
      expect(message.toLowerCase()).not.toContain("lordosis");
    }
  });
});

describe("C1 — navigation voids the session and writes nothing", () => {
  it("a navigation between Compose and Apply clears the session and leaves patient B's report alone", async () => {
    await render();
    await stageAndCompose();
    expect(result.pendingCount).toBeGreaterThan(0);

    await navigateTo(43, "1.2.840.43", B_NARRATIVE);

    expect(result.hasPending).toBe(false);
    expect(result.pendingCount).toBe(0);
    expect(result.staged).toBe("");
    expect(result.error).toBe(DICTATION_STUDY_SWITCH_MSG);
    const before = useWorkspace.getState().findingsText;
    expect(await pressApply()).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("words staged but not yet composed are dropped on navigation, not carried to the new study", async () => {
    await render();
    await act(async () => { result.stageDictation(WORDS_A); });
    expect(result.staged).toContain("desiccation");

    await navigateTo(43, "1.2.840.43", B_NARRATIVE);

    expect(result.staged).toBe("");
    expect(result.error).toBe(DICTATION_STUDY_SWITCH_MSG);
  });

  it("dictating into the new study after a navigation binds fresh and applies into it", async () => {
    await render();
    await stageAndCompose();
    await navigateTo(43, "1.2.840.43", B_NARRATIVE);

    transport.post.mockImplementation(async () => responseFor(WORDS_B));
    await stageAndCompose(WORDS_B);
    expect(result.pendingCount).toBeGreaterThan(0);
    const before = useWorkspace.getState().findingsText;
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(before);
  });
});

describe("C1 — the identity moved under the same row id", () => {
  it("a store that no longer names the bound study refuses Apply, keeps the words, and applies once it agrees", async () => {
    await render();
    await stageAndCompose();
    const before = useWorkspace.getState().findingsText;

    // No navigation: the route prop is still 42 while the store holds 43. This is
    // the shape A-02 warns about, and Apply is where it would become a write.
    await act(async () => { useWorkspace.setState({ activeStudyId: "43" }); });

    expect(await pressApply()).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe(before);
    expect(result.error).toBe(DICTATION_APPLY_REFUSAL_MSG);
    // Recoverable, not a dead end: the session is still there for Discard…
    expect(result.hasPending).toBe(true);
    // …and the same press succeeds once the workspace names one study again.
    await act(async () => { useWorkspace.setState({ activeStudyId: "42" }); });
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(before);
  });

  it("a row re-linked to a different StudyInstanceUID refuses Apply", async () => {
    await render();
    await stageAndCompose();
    const before = useWorkspace.getState().findingsText;

    await act(async () => { useWorkspace.setState({ activeStudyInstanceUID: "1.2.840.999" }); });

    expect(await pressApply()).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe(before);

    await act(async () => { useWorkspace.setState({ activeStudyInstanceUID: "1.2.840.42" }); });
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(before);
  });

  it("a study with no DICOM UID is not refused when the UID arrives during the dictation", async () => {
    // A non-PACS row legitimately has no StudyInstanceUID, and hydration fills it
    // in later. Only two DIFFERENT uids are a switch.
    settleStudy(42, null);
    await render();
    await stageAndCompose();
    await act(async () => { useWorkspace.setState({ activeStudyInstanceUID: "1.2.840.42" }); });
    expect(await pressApply()).toBe(true);
  });

  it("a dictation dispatched after the identity moved never reaches the composer", async () => {
    // `dictate()` is the one-utterance lane with no staging step, so the press
    // itself is the first place a moved identity can be seen. Sending anyway
    // would post a request whose narrative belongs to the study on screen while
    // the words belong to the one that was left.
    await render();
    await act(async () => { result.dictate(WORDS_A); });
    await settle();
    expect(transport.post.mock.calls.length).toBe(1);

    await act(async () => { useWorkspace.setState({ activeStudyId: "43" }); });
    await act(async () => { result.dictate(WORDS_B); });
    await settle();

    expect(transport.post.mock.calls.length).toBe(1);
    expect(result.hasPending).toBe(false);
    expect(result.error).toBe(DICTATION_STUDY_SWITCH_MSG);
    expect(useWorkspace.getState().findingsText).toBe(normalLs.findings);
  });

  it("words staged after a re-link are refused at the request, not composed against the new study", async () => {
    await render();
    await act(async () => { result.stageDictation(WORDS_A); });
    const postsBefore = transport.post.mock.calls.length;

    await act(async () => { useWorkspace.setState({ activeStudyInstanceUID: "1.2.840.999" }); });
    await act(async () => { result.stageDictation(WORDS_B); });

    // The batch was voided instead of growing, and nothing has been composed.
    expect(result.staged).toBe("");
    expect(result.error).toBe(DICTATION_STUDY_SWITCH_MSG);
    expect(transport.post.mock.calls.length).toBe(postsBefore);
  });
});

describe("C1 — a delayed response belongs to the study it was built from", () => {
  it("a response that lands after a navigation is discarded and never folds into the new session", async () => {
    const inflight = deferred();
    transport.post.mockReturnValue(inflight.promise);
    await render();
    await act(async () => { result.stageDictation(WORDS_A); });
    await act(async () => { result.composeStaged(); });

    await navigateTo(43, "1.2.840.43", B_NARRATIVE);
    inflight.resolve(responseFor(WORDS_A));
    await settle();

    expect(result.hasPending).toBe(false);
    expect(result.pendingCount).toBe(0);
    expect(useWorkspace.getState().findingsText).toBe(B_NARRATIVE.findingsText);
    // No stuck panel: the compose flag is released even though the answer is dropped.
    expect(result.composing).toBe(false);
  });

  it("a response for a study that moved under the same row voids the session instead of folding", async () => {
    const inflight = deferred();
    transport.post.mockReturnValue(inflight.promise);
    await render();
    await stageAndCompose();

    await act(async () => { useWorkspace.setState({ activeStudyId: "43" }); });
    inflight.resolve(responseFor(WORDS_A));
    await settle();

    expect(result.hasPending).toBe(false);
    expect(result.error).toBe(DICTATION_STUDY_SWITCH_MSG);
    expect(useWorkspace.getState().findingsText).toBe(normalLs.findings);
  });

  it("a stale response cannot wipe the dictation the radiologist started on the new study", async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first.promise, second.promise];
    transport.post.mockImplementation(() => queue.shift() ?? Promise.resolve(null));

    await render();
    await stageAndCompose();

    // Move on, and dictate again in the new study while the first answer is out.
    await navigateTo(43, "1.2.840.43", B_NARRATIVE);
    await act(async () => { result.stageDictation(WORDS_B); });

    // The late answer for patient A arrives. The panel is still composing, so the
    // new words are staged — and they must survive, with nothing folded in.
    first.resolve(responseFor(WORDS_A));
    await settle();
    expect(result.hasPending).toBe(false);
    expect(result.staged).toContain("lordosis");
    expect(useWorkspace.getState().findingsText).toBe(B_NARRATIVE.findingsText);

    // Now the Compose press for patient B runs, and its answer still lands.
    await act(async () => { result.composeStaged(); });
    second.resolve(responseFor(WORDS_B));
    await settle();
    expect(result.pendingCount).toBeGreaterThan(0);
    const before = useWorkspace.getState().findingsText;
    expect(await pressApply()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(before);
  });

  it("discarding the session drops a response that is still in flight", async () => {
    const inflight = deferred();
    transport.post.mockReturnValue(inflight.promise);
    await render();
    await act(async () => { result.stageDictation(WORDS_A); });
    await act(async () => { result.composeStaged(); });

    await act(async () => { result.discardSession(); });
    inflight.resolve(responseFor(WORDS_A));
    await settle();

    expect(result.hasPending).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe(normalLs.findings);
  });
});

describe("C1 — the caller hands the hook the route study", () => {
  it("useWorkspaceClinicalUi passes studyId into useSmartDictation", () => {
    // The hook defaults to unbound, so a call site that drops the prop silently
    // restores the defect. This pin is the only thing that sees the wiring.
    const clinicalUi = readFileSync(
      join(__dirname, "radiology-workspace", "useWorkspaceClinicalUi.tsx"),
      "utf8",
    );
    const at = clinicalUi.indexOf("const smartDictation = useSmartDictation");
    expect(at).toBeGreaterThan(-1);
    expect(clinicalUi.slice(at, at + 400)).toMatch(/\n\s*studyId,/);
  });
});
