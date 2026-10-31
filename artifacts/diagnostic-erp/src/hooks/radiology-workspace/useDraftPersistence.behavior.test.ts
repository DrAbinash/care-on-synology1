import { act, createElement, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRadiologyDraftId, type RadiologyDraftRow } from "../useRadiologyDraftId";
import { useDraftPersistence } from "./useDraftPersistence";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { HttpError } from "@/lib/fetchApi";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";
import { toDraftFormatState, type StructuredValues } from "@/lib/structuredFormat";
import type { ReportDemography } from "@/lib/reportDemography";
import { serializeObservationLedger, type LedgerPatch } from "@/lib/observationLedger";
import type { CanonicalObservation } from "@/lib/observationSlot";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/fetchApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/fetchApi")>(),
  api: transport,
  rateAwareRetry: { retry: false },
}));

// No jsdom/test-renderer dependency: ReactDOM mounts a null-rendering probe.
// Only its host root/event targets are stubbed; React, effects, React Query,
// persistence, the workspace store and serialization all execute unchanged.
function hostContainer(): HTMLElement {
  const document = Object.assign(new EventTarget(), {
    nodeType: 9,
    activeElement: null,
    documentElement: null,
  });
  const window = Object.assign(new EventTarget(), {
    document,
    HTMLIFrameElement: class {},
  });
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Props = { studyId: number; patientId?: number | null; detailPatientId?: number | null };
type Result = ReturnType<typeof useDraftPersistence> & ReturnType<typeof useRadiologyDraftId> & {
  structuredValues: StructuredValues;
};
let result: Result;
let root: Root;
let client: QueryClient;
const toast = vi.fn();
const navigate = vi.fn();
const workflowActions = {
  transitioning: false,
  peekNext: () => null,
  beginTransition: vi.fn(),
  beginPreviousTransition: () => null,
};

function Probe(props: Props) {
  const draft = useRadiologyDraftId(props.studyId);
  const [draftHydratedStudyId, setDraftHydratedStudyId] = useState<number | null>(null);
  const [structuredValues, setStructuredValues] = useState<StructuredValues>({});
  const [, setSelectedQuickIds] = useState(new Set<number>());
  const structuredTouchedRef = useRef(false);
  // PR #1171 — the demography-override round-trip is part of the hook's
  // contract now; the probe holds the same radiologist-local state the
  // workspace does.
  const [demographyOverrides, setDemographyOverrides] = useState<Partial<ReportDemography>>({});
  const state = useWorkspace();
  const reset = useCallback(() => {
    setStructuredValues({});
    setSelectedQuickIds(new Set());
    structuredTouchedRef.current = false;
  }, []);
  const persistence = useDraftPersistence({
    ...draft,
    studyId: props.studyId,
    isOnline: true,
    isDirty: state.isDirty,
    isFinalized: false,
    signedContentLocked: false,
    backupEnabled: false,
    isMobile: false,
    useStructured: false,
    findingsMap: {},
    structuredValues,
    studySetup: { selectedTemplate: null },
    workflow: {
      ...workflowActions,
      currentRow: props.patientId == null ? null : { patientId: props.patientId },
    },
    detailPatientId: props.detailPatientId,
    toast,
    openStudy: navigate,
    onStudySwitchPageReset: reset,
    setStructuredValues,
    setSelectedQuickIds,
    structuredTouchedRef,
    ...readWorkspaceClinicalTexts(),
    draftHydratedStudyId,
    setDraftHydratedStudyId,
    demographyOverrides,
    setDemographyOverrides,
  });
  result = { ...draft, ...persistence, structuredValues, setDemographyOverrides, demographyOverrides };
  return null;
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function render(props: Props) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe, props)));
  });
  await settle();
}

async function edit(findingsText: string) {
  await act(async () => { useWorkspace.setState({ findingsText, isDirty: true }); });
}

async function save() {
  let id: number | null = null;
  await act(async () => { id = await result.saveDraft({ silent: true }); });
  return id;
}

/**
 * The Save button and Ctrl+S: no `silent`, because a person asked for it. Every
 * background writer — the 30 s autosave, the flush before leaving a study, the
 * structured-values debounce — passes `silent: true`, and that is exactly the
 * distinction the conflict latch turns on.
 */
async function explicitSave() {
  let id: number | null = null;
  await act(async () => { id = await result.saveDraft(); });
  return id;
}

const storedTexts = {
  findingsText: "L4-L5 left paracentral disc extrusion compresses the traversing L5 root.",
  impressionText: "L4-L5 disc extrusion with left L5 nerve root compression.",
  recommendationText: "Spine specialist consultation advised.",
  techniqueText: "Multiplanar T1, T2 and STIR MRI lumbar spine without contrast.",
  clinicalHistoryText: "Low back pain with left radiculopathy for six weeks.",
};
const values = { stenosis: "severe", canalAp: 6.5 };
const patterns = [{ patternId: "disc-extrusion", version: 1, bundleId: "extrusion-1", appliedAt: "2026-10-01T00:00:00Z" }];

function abnormalDraft(studyId = 101, patientId = 11): RadiologyDraftRow {
  return {
    id: studyId + 1000,
    studyId,
    worklistId: studyId,
    patientId,
    templateId: null,
    modality: "MR",
    studyName: "MRI lumbar spine",
    clinicalHistory: storedTexts.clinicalHistoryText,
    rawFindings: storedTexts.findingsText,
    findingsSections: JSON.stringify({ Technique: storedTexts.techniqueText }),
    // The column exactly as POST /save-draft writes it: JSON.stringify of the
    // impression array, not the bare sentence.
    impression: JSON.stringify([storedTexts.impressionText]),
    recommendation: storedTexts.recommendationText,
    formattedReportHtml: null,
    formattedReportText: null,
    status: "draft",
    updatedAt: "2026-10-01T00:00:00Z",
    structuredJson: {
      careStructuredFormat: toDraftFormatState({ formatId: 9, formatVersion: 2, values }),
      careAppliedPatterns: patterns,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  transport.get.mockReset();
  transport.post.mockReset();
  transport.post.mockImplementation(async (_url, body) => ({ success: true, draft: { id: body.id ?? 9001 } }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  notifyManager.setScheduler(queueMicrotask);
  root = createRoot(hostContainer());
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  client.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("draft read / hydration save boundary (actual hooks)", () => {
  it("P0-1 retains the acknowledged report when returning before the new read finishes", async () => {
    const original = abnormalDraft();
    const saved = { ...original, rawFindings: "Saved L4-L5 extrusion. Manual sentence retained exactly.", updatedAt: "2026-10-01T00:01:00Z" };
    transport.get.mockResolvedValueOnce({ success: true, drafts: [original] });
    transport.post.mockResolvedValueOnce({ success: true, draft: saved });
    await render({ studyId: 101, patientId: 11 });
    await edit(saved.rawFindings);
    expect(await save()).toBe(saved.id);
    expect(useWorkspace.getState().isDirty).toBe(false);

    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft(202, 22)] });
    await render({ studyId: 202, patientId: 22 });
    const returningRead = deferred<{ success: boolean; drafts: RadiologyDraftRow[] }>();
    transport.get.mockReturnValueOnce(returningRead.promise);
    await render({ studyId: 101, patientId: 11 });
    expect(readWorkspaceClinicalTexts()).toMatchObject({ ...storedTexts, findingsText: saved.rawFindings });
    expect(result.existingDraft?.updatedAt).toBe(saved.updatedAt);
    expect(await save()).toBe(saved.id);
    expect(transport.post.mock.calls.at(-1)![1].rawFindings).toBe(saved.rawFindings);
  });

  it("P0-1 cancels an older in-flight read before publishing a save acknowledgement", async () => {
    const original = abnormalDraft();
    const saved = { ...original, rawFindings: "New acknowledged findings.", updatedAt: "2026-10-01T00:01:00Z" };
    transport.get.mockResolvedValueOnce({ success: true, drafts: [original] });
    await render({ studyId: 101, patientId: 11 });
    const oldRead = deferred<{ success: boolean; drafts: RadiologyDraftRow[] }>();
    transport.get.mockReturnValueOnce(oldRead.promise);
    let refetch!: ReturnType<typeof result.refetchExistingDraft>;
    await act(async () => { refetch = result.refetchExistingDraft(); });
    await edit(saved.rawFindings);
    transport.post.mockResolvedValueOnce({ success: true, draft: saved });
    await save();
    await act(async () => { oldRead.resolve({ success: true, drafts: [original] }); await refetch; });
    await settle();
    expect(client.getQueryData(["radiology-existing-draft", 101])).toMatchObject(saved);
    expect(readWorkspaceClinicalTexts().findingsText).toBe(saved.rawFindings);
  });

  it("P0-1 preserves an acknowledgement arriving after navigation in its own study cache", async () => {
    const original = abnormalDraft();
    const saved = { ...original, rawFindings: "Patient A acknowledged during navigation.", updatedAt: "2026-10-01T00:01:00Z" };
    transport.get.mockResolvedValueOnce({ success: true, drafts: [original] });
    await render({ studyId: 101, patientId: 11 });
    await edit(saved.rawFindings);
    const pendingSave = deferred<{ success: boolean; draft: RadiologyDraftRow }>();
    transport.post.mockReturnValueOnce(pendingSave.promise);
    let saving!: Promise<number | null>;
    await act(async () => { saving = result.saveDraft({ silent: true }); });
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft(202, 22)] });
    await render({ studyId: 202, patientId: 22 });
    await act(async () => { pendingSave.resolve({ success: true, draft: saved }); await saving; });
    expect(result.draftId).toBe(1202);
    expect(readWorkspaceClinicalTexts()).toMatchObject(storedTexts);
    expect(client.getQueryData(["radiology-existing-draft", 101])).toMatchObject(saved);
  });

  it("P0-2 names the revision the server issued when it saves next", async () => {
    const stored = abnormalDraft();
    stored.revision = "dr1:11111111111111111111111111111111";
    transport.get.mockResolvedValueOnce({ success: true, drafts: [stored] });
    await render({ studyId: 101, patientId: 11 });
    await edit("Findings typed after reading the server's revision.");
    expect(await save()).toBe(1101);
    // The save that overwrote another console's text answered 200 with no idea
    // what the row held. Naming the revision is what lets the server refuse it.
    expect(transport.post.mock.calls.at(-1)![1]).toMatchObject({
      id: 1101,
      expectedRevision: "dr1:11111111111111111111111111111111",
    });
  });

  it("P0-2 a revision refusal is a refusal, not a failed save", async () => {
    const stored = abnormalDraft();
    stored.revision = "dr1:22222222222222222222222222222222";
    transport.get.mockResolvedValueOnce({ success: true, drafts: [stored] });
    await render({ studyId: 101, patientId: 11 });
    const typed = "Newest sentence; another console wrote over it first.";
    await edit(typed);
    transport.post.mockRejectedValueOnce(new HttpError(
      "The saved report changed since this editor last read it, so this save was not written.",
      409,
      {
        success: false,
        error: "DRAFT_REVISION_CONFLICT",
        code: "DRAFT_REVISION_CONFLICT",
        message: "The saved report changed since this editor last read it, so this save was not written.",
      },
    ));

    expect(await save()).toBeNull();
    // Nothing of the radiologist's was taken: the text stays, the dirty flag
    // stays, and the outcome is named as a refusal rather than a failure.
    expect(readWorkspaceClinicalTexts().findingsText).toBe(typed);
    expect(useWorkspace.getState().isDirty).toBe(true);
    expect(result.autoSaveStatus).toBe("conflict");
    const titles = toast.mock.calls.map((call) => String(call[0]?.title ?? ""));
    expect(titles.some((title) => /changed in another session/i.test(title))).toBe(true);
    expect(titles).not.toContain("Save failed");
    // The dirty flag being kept is NOT an invitation to the autosave to write.
    // Holding the text and holding off are two different things, and the second
    // one is what stops the refusal being walked back 30 seconds later by a save
    // nobody asked for.
    const postsAfterRefusal = transport.post.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await settle();
    expect(transport.post.mock.calls.length, "the autosave must not resolve a conflict").toBe(postsAfterRefusal);
  });

  it("P0-2 re-arms with the row that won, so the radiologist's own next save names the newer revision", async () => {
    const stored = abnormalDraft();
    stored.revision = "dr1:33333333333333333333333333333333";
    transport.get.mockResolvedValueOnce({ success: true, drafts: [stored] });
    await render({ studyId: 101, patientId: 11 });
    await edit("Mine, refused because theirs landed first.");
    transport.post.mockRejectedValueOnce(new HttpError(
      "The saved report changed since this editor last read it.",
      409,
      { success: false, code: "DRAFT_REVISION_CONFLICT", message: "The saved report changed." },
    ));
    expect(await save()).toBeNull();

    // The study is re-read, and the editor is NOT overwritten by it — the
    // radiologist's unsaved text outranks a row that arrived from elsewhere.
    const moved = {
      ...abnormalDraft(),
      rawFindings: "Theirs, saved first.",
      revision: "dr1:44444444444444444444444444444444",
    };
    transport.get.mockResolvedValueOnce({ success: true, drafts: [moved] });
    await act(async () => { await result.refetchExistingDraft(); });
    await settle();
    expect(readWorkspaceClinicalTexts().findingsText).toBe("Mine, refused because theirs landed first.");

    await edit("Mine, refused because theirs landed first. Extended.");
    // Held off, not lost: a background save is refused at the door and never
    // reaches the server, so the other session's row is untouched.
    const postsBeforeDeciding = transport.post.mock.calls.length;
    expect(await save(), "the autosave must not take this decision").toBeNull();
    expect(transport.post.mock.calls.length).toBe(postsBeforeDeciding);

    // The radiologist's own Save names the revision the re-read answered with —
    // not the one this console's refused save claimed, which would be a refusal
    // with no way out.
    expect(await explicitSave()).toBe(1101);
    expect(transport.post.mock.calls.at(-1)![1].expectedRevision)
      .toBe("dr1:44444444444444444444444444444444");
  });

  it("does not save pending or failed reads, then restores every narrative field on recovery", async () => {

    const read = deferred<{ success: boolean; drafts: RadiologyDraftRow[] }>();
    transport.get.mockReturnValueOnce(read.promise);
    await render({ studyId: 101, patientId: 11 });
    await edit("Unsaved placeholder must never replace the server draft.");
    expect(await save()).toBeNull();
    expect(transport.post).not.toHaveBeenCalled();

    await act(async () => { read.reject(new Error("Draft read unavailable")); });
    await settle();
    expect(result.existingDraftError).toBeTruthy();
    expect(result.draftReadPending).toBe(false);
    expect(result.draftHydratedStudyId).toBeNull();
    await act(async () => { await result.ensureDraftOnce(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    expect(transport.post).not.toHaveBeenCalled();

    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft()] });
    await act(async () => { await result.refetchExistingDraft(); });
    await settle();
    expect(result.draftReadSucceeded).toBe(true);
    expect(result.draftHydratedStudyId).toBe(101);
    expect(result.restoredDraftForStudyRef.current).toBe(101);
    expect(readWorkspaceClinicalTexts()).toMatchObject(storedTexts);
    expect(result.structuredValues).toEqual(values);
    expect(useWorkspace.getState().appliedPatternMarkers).toEqual(patterns);
    expect(useWorkspace.getState().isDirty).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    expect(transport.post).not.toHaveBeenCalled();
    expect(await save()).toBe(1101);
    expect(transport.post).toHaveBeenCalledExactlyOnceWith(
      "/api/radiology/report-generator/save-draft",
      expect.objectContaining({
        id: 1101, studyId: 101, worklistId: 101, patientId: 11,
        rawFindings: storedTexts.findingsText,
        impression: [storedTexts.impressionText],
        recommendation: storedTexts.recommendationText,
        technique: storedTexts.techniqueText,
        clinicalHistory: storedTexts.clinicalHistoryText,
        appliedPatterns: patterns,
      }),
    );
  });

  it("recovers a failed initial read without ever treating it as successful absence", async () => {
    transport.get.mockRejectedValueOnce(new Error("Draft read unavailable"));
    await render({ studyId: 101, patientId: 11 });
    expect(result.draftHydratedStudyId).toBeNull();
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft()] });
    await act(async () => { await result.refetchExistingDraft(); });
    await settle();
    expect(readWorkspaceClinicalTexts()).toMatchObject(storedTexts);
    expect(result.draftId).toBe(1101);
    expect(transport.post).not.toHaveBeenCalled();
  });

  it("allows first-draft autosave after a successful empty read", async () => {
    transport.get.mockResolvedValueOnce({ success: true, drafts: [] });
    await render({ studyId: 202, patientId: 22 });
    expect(result.draftReadSucceeded).toBe(true);
    expect(result.draftHydratedStudyId).toBe(202);
    expect(result.restoredDraftForStudyRef.current).toBeNull();
    expect(transport.post).not.toHaveBeenCalled();
    await edit("New abnormal findings entered after successful empty read.");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    expect(transport.post).toHaveBeenCalledTimes(1);
    expect(transport.post.mock.calls[0][1]).toMatchObject({
      id: undefined, studyId: 202, patientId: 22,
      rawFindings: "New abnormal findings entered after successful empty read.",
    });
    expect(result.draftId).toBe(9001);
  });

  it("waits for the new study's read and patient identity, and rejects a retained old save callback", async () => {
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft()] });
    await render({ studyId: 101, patientId: 11 });
    const oldSave = result.saveDraft;
    const nextRead = deferred<{ success: boolean; drafts: RadiologyDraftRow[] }>();
    transport.get.mockReturnValueOnce(nextRead.promise);
    await render({ studyId: 202 });
    expect(result.draftHydratedStudyId).toBeNull();
    expect(readWorkspaceClinicalTexts().findingsText).toBe("");
    await edit("Patient B temporary text");
    await act(async () => { expect(await oldSave({ silent: true })).toBeNull(); });
    expect(await save()).toBeNull();
    expect(transport.post).not.toHaveBeenCalled();

    await act(async () => { nextRead.resolve({ success: true, drafts: [abnormalDraft(202, 22)] }); });
    await settle();
    expect(result.draftHydratedStudyId).toBeNull();
    expect(await save()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    expect(transport.post).not.toHaveBeenCalled();

    await render({ studyId: 202, detailPatientId: 22 });
    expect(result.draftHydratedStudyId).toBe(202);
    expect(readWorkspaceClinicalTexts()).toMatchObject(storedTexts);
    await act(async () => { expect(await oldSave({ silent: true })).toBeNull(); });
    expect(transport.post).not.toHaveBeenCalled();
    expect(await save()).toBe(1202);
    expect(transport.post.mock.calls[0][1]).toMatchObject({ studyId: 202, id: 1202, patientId: 22 });
  });

  it("does not mark a patient-mismatched draft hydrated or overwrite it", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft(101, 99)] });
    await render({ studyId: 101, patientId: 11, detailPatientId: 99 });
    expect(result.draftHydratedStudyId).toBeNull();
    expect(result.restoredDraftForStudyRef.current).toBeNull();
    expect(readWorkspaceClinicalTexts().findingsText).toBe("");
    await edit("Rejected draft must not be overwritten");
    expect(await save()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    expect(transport.post).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it("autosaves coverage-only edits and restores both spine numbering states on reopen", async () => {
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft()] });
    await render({ studyId: 101, patientId: 11 });
    expect(useWorkspace.getState().isDirty).toBe(false);
    await act(async () => {
      useWorkspace.getState().setDorsalNumbering({ coverage: "upper", mode: "uncertain", designationNote: "Synthetic landmark" });
      useWorkspace.getState().setDorsoLumbarNumbering({ superior: "T8-T9", inferior: "L3-L4", numbering: "manual", designationNote: "Synthetic junction" });
    });
    expect(useWorkspace.getState().isDirty).toBe(true);
    const expected = {
      dorsalNumbering: structuredClone(useWorkspace.getState().dorsalNumbering),
      dorsoLumbarNumbering: structuredClone(useWorkspace.getState().dorsoLumbarNumbering),
    };
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    expect(transport.post).toHaveBeenCalledTimes(1);
    const payload = transport.post.mock.calls[0][1].spineReporting;
    expect(payload).toMatchObject(expected);
    await act(async () => { root.unmount(); });
    client.clear();
    root = createRoot(hostContainer());
    transport.get.mockResolvedValueOnce({ success: true, drafts: [{
      ...abnormalDraft(), structuredJson: { spineReporting: payload },
    }] });
    await render({ studyId: 101, patientId: 11 });
    expect(result.draftHydratedStudyId).toBe(101);
    expect(useWorkspace.getState()).toMatchObject(expected);
    expect(useWorkspace.getState().isDirty).toBe(false);
  });

  it("keeps saves enabled after genuine hydration despite a background refetch error", async () => {
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft()] });
    await render({ studyId: 101, patientId: 11 });
    await edit("Updated findings after hydration.");
    transport.get.mockRejectedValueOnce(new Error("Temporary refetch failure"));
    await act(async () => { await result.refetchExistingDraft(); });
    await settle();
    expect(result.existingDraftError).toBeTruthy();
    expect(result.draftReadSucceeded).toBe(false);
    expect(result.draftHydratedStudyId).toBe(101);
    expect(await save()).toBe(1101);
    expect(transport.post.mock.calls[0][1]).toMatchObject({
      rawFindings: "Updated findings after hydration.", technique: storedTexts.techniqueText,
    });
  });
});

describe("demography corrections round-trip (PR #1171)", () => {
  it("a stored draft's careDemographyOverrides reopen onto the card state and ride the next save", async () => {
    const stored = abnormalDraft();
    stored.structuredJson = {
      ...(stored.structuredJson ?? {}),
      careDemographyOverrides: {
        kind: "care.demography_overrides.v1",
        patientName: "CORRECTED NAME",
        age: "35 Yrs",
        studyDate: "01/02/2026",
      },
    };
    transport.get.mockResolvedValueOnce({ success: true, drafts: [stored] });
    await render({ studyId: 101, patientId: 11 });
    await settle();
    expect(result.draftHydratedStudyId).toBe(101);
    // The correction the radiologist typed reopens with the draft — not a
    // blank card, and not the registration master's uncorrected values.
    expect(result.demographyOverrides).toEqual({
      patientName: "CORRECTED NAME",
      age: "35 Yrs",
      studyDate: "01/02/2026",
    });
    await edit("Findings typed after the demography correction.");
    expect(await save()).toBe(1101);
    expect(transport.post.mock.calls.at(-1)![1]).toMatchObject({
      id: 1101,
      demographyOverrides: {
        patientName: "CORRECTED NAME",
        age: "35 Yrs",
        studyDate: "01/02/2026",
      },
    });
  });

  it("a draft with no corrections saves an explicit empty object — the clear signal", async () => {
    transport.get.mockResolvedValueOnce({ success: true, drafts: [abnormalDraft()] });
    await render({ studyId: 101, patientId: 11 });
    await settle();
    expect(result.demographyOverrides).toEqual({});
    await edit("Ordinary findings.");
    await save();
    // {} is a real write signal (a reverted correction must not survive as a
    // stale stored one), not an omitted key.
    expect(transport.post.mock.calls.at(-1)![1]).toMatchObject({ demographyOverrides: {} });
  });
});

type SaveBody = {
  id?: number;
  studyId?: number;
  worklistId?: number;
  expectedRevision?: string | null;
  rawFindings?: string | null;
};

/**
 * POST /save-draft's revision gate (`decideDraftRevision` in
 * api-server/src/lib/radiologyDraftRevision.ts) and its write branch
 * (`if (id) { update } else { insert }`), modelled closely enough that these
 * tests fail for the reason the SERVER refuses rather than against a stub that
 * always says yes: a study with no row answers `"absent"`, a study with a row
 * answers that row's token, and a save naming anything else is refused without
 * writing. An accepted save that names no row id INSERTs — which is how one
 * study ends up with two rows and nobody can tell which way round they are.
 * Every accepted write moves the token, as a content fingerprint does whenever
 * the narrative it covers differs.
 */
function revisionGate() {
  const rows = new Map<number, { id: number; revision: string; writes: number }>();
  const issued: string[] = [];
  const refused: Array<{ studyId: number; claimed: string | null | undefined }> = [];
  const forks: Array<{ studyId: number; id: number }> = [];
  let nextRowId = 1101;
  const post = vi.fn(async (_url: string, body: SaveBody) => {
    const studyId = Number(body.worklistId ?? body.studyId);
    const row = rows.get(studyId) ?? null;
    const current = row ? row.revision : "absent";
    if (body.expectedRevision != null && body.expectedRevision !== current) {
      refused.push({ studyId, claimed: body.expectedRevision });
      throw new HttpError(
        "The saved report changed since this editor last read it, so this save was not written.",
        409,
        {
          success: false,
          error: "DRAFT_REVISION_CONFLICT",
          code: "DRAFT_REVISION_CONFLICT",
          message: "The saved report changed since this editor last read it, so this save was not written.",
        },
      );
    }
    const token = `dr1:${String(issued.length + 1).padStart(32, "0")}`;
    issued.push(token);
    if (row && body.id != null) {
      row.revision = token;
      row.writes += 1;
      return { success: true, draft: { id: row.id }, revision: row.revision };
    }
    // No row id named: an INSERT, whether or not the study already had a row.
    const created = { id: nextRowId++, revision: token, writes: 1 };
    if (row) forks.push({ studyId, id: created.id });
    rows.set(studyId, created);
    return { success: true, draft: { id: created.id }, revision: created.revision };
  });
  return { post, rows, issued, refused, forks };
}

/** Flush the promise chain a `void requestLeaveThen(...)` leaves behind. */
async function drainLeaveChain() {
  for (let round = 0; round < 6; round += 1) await vi.advanceTimersByTimeAsync(0);
}

describe("P0-2 one console must not race itself", () => {
  it("three saves fired together for a study with no draft row all land on that one row", async () => {
    const gate = revisionGate();
    transport.get.mockResolvedValue({ success: true, drafts: [] });
    transport.post.mockImplementation(gate.post);
    await render({ studyId: 101, patientId: 11 });
    await settle();
    // The read ANSWERED "no draft row yet" — the cold hydrate measured in the
    // browser on a study that had never been saved.
    expect(result.draftReadSucceeded).toBe(true);
    expect(result.existingDraft).toBeNull();

    await edit("Report text typed before anything had been saved.");
    const saves: Array<Promise<number | null>> = [];
    await act(async () => {
      saves.push(result.saveDraft({ silent: true }));
      saves.push(result.saveDraft({ silent: true }));
      saves.push(result.saveDraft({ silent: true }));
      await Promise.all(saves);
    });

    expect(gate.refused).toEqual([]);
    expect(gate.forks).toEqual([]);
    expect(gate.rows.get(101)?.writes).toBe(3);
    expect(await Promise.all(saves)).toEqual([1101, 1101, 1101]);

    const bodies = transport.post.mock.calls.map((call) => call[1] as SaveBody);
    expect(bodies).toHaveLength(3);
    // Only the first save can honestly claim the study had no row.
    expect(bodies[0].id).toBeUndefined();
    expect(bodies[0].expectedRevision).toBe("absent");
    // Each save behind it names the row the one ahead created, and the token
    // that save's own response issued — not the render's stale "no row yet".
    expect(bodies[1].id).toBe(1101);
    expect(bodies[1].expectedRevision).toBe(gate.issued[0]);
    expect(bodies[2].id).toBe(1101);
    expect(bodies[2].expectedRevision).toBe(gate.issued[1]);
  });

  it("the flush before a study switch is not refused by the saves that went ahead of it", async () => {
    const gate = revisionGate();
    transport.get.mockResolvedValue({ success: true, drafts: [] });
    transport.post.mockImplementation(gate.post);
    await render({ studyId: 101, patientId: 11 });
    await settle();
    await edit("Unsaved text on a study that has never been saved.");

    await act(async () => {
      const autosave = result.saveDraft({ silent: true });
      // The radiologist jumps to the next patient while that save is in flight,
      // which is what produced the three-saves-in-40ms transcript.
      result.openStudyGuarded(202);
      await autosave;
      await drainLeaveChain();
    });

    expect(gate.refused).toEqual([]);
    expect(gate.forks).toEqual([]);
    // The refusal used to land here, on the flush that runs before the switch,
    // which read `null` as "the save failed" and held the radiologist on the
    // study: a guard that protects the report must not trap its reader.
    expect(navigate).toHaveBeenCalledWith(202);
    expect(toast.mock.calls.map((call) => String(call[0]?.title ?? ""))).not.toContain("Save failed");
  });

  it("a genuine conflict during that flush keeps its own explanation instead of 'Save failed'", async () => {
    const gate = revisionGate();
    const read = abnormalDraft();
    read.revision = `dr1:${"e".repeat(32)}`;
    transport.get.mockResolvedValue({ success: true, drafts: [read] });
    transport.post.mockImplementation(gate.post);
    await render({ studyId: 101, patientId: 11 });
    await settle();
    // Another console wrote the row after this editor read it.
    gate.rows.set(101, { id: 1101, revision: `dr1:${"f".repeat(32)}`, writes: 1 });

    const typed = "My newest sentence, which another window overwrote first.";
    await edit(typed);
    await act(async () => {
      result.openStudyGuarded(202);
      await drainLeaveChain();
    });

    expect(gate.refused).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
    const titles = toast.mock.calls.map((call) => String(call[0]?.title ?? ""));
    expect(titles.some((title) => /changed in another session/i.test(title))).toBe(true);
    // With TOAST_LIMIT at 1 this title evicted the sentence above it, so the
    // radiologist saw "Save failed" for a report nothing had failed to save.
    expect(titles).not.toContain("Save failed");
    expect(readWorkspaceClinicalTexts().findingsText).toBe(typed);
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("stops at the refusal: nothing this console saves on its own may roll back the other window", async () => {
    // Reproduced in the browser (tmp/evidence/who-retries.json). Two consoles on
    // one study: A saves, B saves and is refused with 409, and 305 ms later a
    // SECOND request goes out from B naming A's fresh token and is accepted.
    // B's own text then sits in the row and A's sentence is gone. The refusal is
    // real — and it is undone without anyone touching anything, which is exactly
    // the silent lost update P0-2 exists to stop and acceptance item 2 forbids.
    //
    // The refusal's own sentence puts the decision in the radiologist's hands:
    // "save again to replace the other window's version with yours". A save that
    // re-issues itself is not that save.
    const gate = revisionGate();
    const read = abnormalDraft();
    read.revision = `dr1:${"e".repeat(32)}`;
    transport.get.mockResolvedValue({ success: true, drafts: [read] });
    // Every request this console makes, with the stack that made it, so a second
    // one names its own caller instead of being inferred from its timing.
    const attempts: Array<{ body: SaveBody; stack: string }> = [];
    const gated = gate.post;
    transport.post.mockImplementation(async (url: string, body: SaveBody) => {
      attempts.push({ body, stack: new Error("save-request").stack ?? "" });
      return gated(url, body);
    });
    await render({ studyId: 101, patientId: 11 });
    await settle();

    // Another console wins the row while this one sits open, and the re-read the
    // refusal triggers hands that newer row back.
    const otherToken = `dr1:${"a".repeat(32)}`;
    gate.rows.set(101, { id: 1101, revision: otherToken, writes: 2 });
    transport.get.mockResolvedValue({
      success: true,
      drafts: [{ ...read, revision: otherToken, rawFindings: "The other window's sentence." }],
    });

    const typed = "My sentence, typed after the other console loaded the report.";
    await edit(typed);
    const id = await save();

    expect(id).toBeNull();
    expect(gate.refused).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].body.expectedRevision).toBe(`dr1:${"e".repeat(32)}`);

    /** Name the caller of anything beyond the save that was asked for. */
    const extras = () => attempts.slice(1).map((a) => ({
      revision: a.body.expectedRevision,
      findings: a.body.rawFindings,
      stack: (a.stack ?? "").split("\n").slice(1, 10).filter((l) => /src\//.test(l)).join(" | "),
    }));

    // First: does anything re-issue as soon as the refusal's own re-read lands?
    // This is the 305 ms second request the browser measured.
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await settle();
    expect(extras(), `immediately after the refusal: ${JSON.stringify(extras())}`).toEqual([]);

    // Then: let the whole autosave window run.
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    await settle();
    expect(extras(), `after the autosave window: ${JSON.stringify(extras())}`).toEqual([]);
    // And the chip still tells the truth: a save that was deliberately withheld is
    // not a save that failed, and it is not "Saving…" forever either.
    expect(result.autoSaveStatus).toBe("conflict");

    // The radiologist's text is still in the editor, and the report is still the
    // other window's — nothing was written, which is what the toast promised.
    expect(readWorkspaceClinicalTexts().findingsText).toBe(typed);
    expect(gate.rows.get(101)?.revision).toBe(otherToken);
    expect(
      String(gate.rows.get(101) && attempts.length),
      "only the refused save was ever sent",
    ).toBe("1");

    // The other window's sentence must still be the one on the server.
    expect(attempts[0].body.rawFindings).toBe(typed);

    // An explicit Save is the deliberate tie-breaker and must be allowed through.
    const explicit = await act(async () => { const r = await result.saveDraft(); return r; });
    expect(explicit, "the radiologist's own Save must succeed").toBe(1101);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].body.expectedRevision).toBe(otherToken);

    // And the autosave resumes: type again, let the window pass, and it writes.
    const second = "L4-L5 disc bulge with left L5 root compression, added after the conflict.";
    await edit(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    await settle();
    expect(attempts).toHaveLength(3);
    expect(attempts[2].body.rawFindings).toBe(second);
    expect(readWorkspaceClinicalTexts().findingsText).toBe(second);
  });
});

describe("P0-2 the identity a save names comes from what this console has proven", () => {
  it("names its own acknowledgement before the editor has re-rendered", async () => {
    const gate = revisionGate();
    transport.get.mockResolvedValue({ success: true, drafts: [] });
    transport.post.mockImplementation(gate.post);
    await render({ studyId: 101, patientId: 11 });
    await settle();

    // Hold every React Query notification: the cache holds the acknowledgement
    // but the editor has not re-rendered, so `existingDraft` in the next save's
    // closure is still the empty read. This is the ordinary browser case —
    // React SCHEDULES the render, it does not run it between two queued saves.
    const held: Array<() => void> = [];
    notifyManager.setScheduler((callback) => { held.push(callback); });
    try {
      await edit("Text typed before the first save answered.");
      const saves: Array<Promise<number | null>> = [];
      await act(async () => {
        saves.push(result.saveDraft({ silent: true }));
        saves.push(result.saveDraft({ silent: true }));
        await Promise.all(saves);
      });
      expect(gate.refused).toEqual([]);
      expect(gate.forks).toEqual([]);
      const bodies = transport.post.mock.calls.map((call) => call[1] as SaveBody);
      expect(bodies[1]).toMatchObject({ id: 1101, expectedRevision: gate.issued[0] });
    } finally {
      notifyManager.setScheduler(queueMicrotask);
      await act(async () => { held.forEach((callback) => callback()); });
    }
  });

  it("records an acknowledgement for the study it was sent for, after the editor has moved on", async () => {
    const gate = revisionGate();
    transport.get.mockResolvedValue({ success: true, drafts: [] });
    // Hold the first save's answer until the radiologist has opened the next
    // patient, which is the case the queue cannot order away.
    let calls = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    transport.post.mockImplementation(async (url: string, body: SaveBody) => {
      calls += 1;
      const answered = gate.post(url, body);
      return calls === 1 ? held.then(() => answered) : answered;
    });

    await render({ studyId: 101, patientId: 11 });
    await settle();
    await edit("Patient A's sentence, saved while the editor moves on.");
    let saving!: Promise<number | null>;
    await act(async () => { saving = result.saveDraft({ silent: true }); });
    await render({ studyId: 202, patientId: 22 });
    await settle();
    await act(async () => { release(); await saving; });
    await settle();

    // Study 101's identity is what its own acknowledgement proved. The mirror of
    // the settled read only ever covers the study on screen, so without that
    // write a return to 101 before its read settles would claim the study still
    // has no draft row and fork a second one.
    expect(result.provenDraftRef.current.get(101)).toEqual({ id: 1101, revision: gate.issued[0] });
    expect(gate.forks).toEqual([]);
  });

  it("re-arms on the row that won after its OWN acknowledged save is later refused", async () => {
    const gate = revisionGate();
    // The read answers with whatever the gate holds, so a refusal's re-read
    // returns the row the other console actually wrote.
    transport.get.mockImplementation(async () => {
      const row = gate.rows.get(101);
      return {
        success: true,
        drafts: row ? [{ ...abnormalDraft(), id: row.id, revision: row.revision }] : [],
      };
    });
    transport.post.mockImplementation(gate.post);
    await render({ studyId: 101, patientId: 11 });
    await settle();
    await edit("My first sentence, saved.");
    expect(await save()).toBe(1101);

    // Another console then writes the row this editor's own save created.
    const theirs = `dr1:${"9".repeat(32)}`;
    gate.rows.get(101)!.revision = theirs;
    await edit("My second sentence, which their write has overtaken.");
    expect(await save()).toBeNull();
    expect(gate.refused).toEqual([{ studyId: 101, claimed: gate.issued[0] }]);

    await settle();
    await act(async () => { await result.refetchExistingDraft(); });
    await settle();
    // The re-read replaces the cache only; the radiologist's unsaved text
    // outranks a row that arrived from elsewhere.
    expect(readWorkspaceClinicalTexts().findingsText)
      .toBe("My second sentence, which their write has overtaken.");

    // The next save must name the token that re-read answered with — not the one
    // this console's own save earned, which is the token the other console has
    // just replaced. Naming it again would be a refusal with no way out.
    await edit("My third sentence, written over theirs.");
    expect(await explicitSave()).toBe(1101);
    expect(transport.post.mock.calls.at(-1)![1].expectedRevision).toBe(theirs);
    expect(gate.refused).toHaveLength(1);
    expect(gate.forks).toEqual([]);
  });

  it("says which kind of open happened when a saved box no longer matches the text", async () => {
    // Measured in the browser (tmp/evidence/stab-rule7-AFTER-fix.json): a plain Ctrl+S and a reload
    // came back with the clicked box still on the rail marked `selected`, while the toast announced
    // "Opened as narrative-only". A radiologist who believes that re-clicks the box and writes the
    // finding a second time, so the sentence has to name the state that actually occurred.
    const box: LedgerPatch = {
      id: "qf-480",
      observation: {
        slotKey: "LS Spine|L4-L5|spondylolisthesis",
        role: "finding",
        concept: "spondylolisthesis",
        level: "L4-L5",
        baselineReplaces: "No spondylolisthesis.",
      } as unknown as CanonicalObservation,
      templates: { findings: "Grade 1 spondylolisthesis at L4-L5." },
      lastRendered: { findings: "Grade 1 spondylolisthesis at L4-L5." },
      replacedBaseline: { findings: ["No spondylolisthesis."], impression: [] },
      source: "quick-findings",
      protected: false,
    };
    const draft = abnormalDraft();
    draft.structuredJson = {
      ...draft.structuredJson,
      careObservationLedger: serializeObservationLedger([box]),
    };
    // The stored Findings is the extrusion sentence, so this box's prose is genuinely absent from
    // the text it is reconciled against — that is what marks it stale on hydrate.
    transport.get.mockResolvedValueOnce({ success: true, drafts: [draft] });
    await render({ studyId: 101, patientId: 11 });
    await settle();

    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches.map((p) => p.id)).toEqual(["qf-480"]);
    expect(patches[0]!.stale).toBe(true);

    const titles = toast.mock.calls.map((call) => String(call[0]?.title ?? ""));
    expect(titles, "the ledger came back, so the report did not open as narrative text")
      .not.toContain("Opened as narrative-only");
    expect(titles.some((title) => /quick select boxes/i.test(title))).toBe(true);
  });
});
