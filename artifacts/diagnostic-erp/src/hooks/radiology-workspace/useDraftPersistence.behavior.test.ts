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
    // stays (so the 30-second autosave re-arms instead of stalling on a chip
    // that said "Saved"), and the outcome is named as a refusal.
    expect(readWorkspaceClinicalTexts().findingsText).toBe(typed);
    expect(useWorkspace.getState().isDirty).toBe(true);
    expect(result.autoSaveStatus).toBe("conflict");
    const titles = toast.mock.calls.map((call) => String(call[0]?.title ?? ""));
    expect(titles.some((title) => /another window/i.test(title))).toBe(true);
    expect(titles).not.toContain("Save failed");
  });

  it("P0-2 re-arms with the row that won, so the next save names the newer revision", async () => {
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
    expect(await save()).toBe(1101);
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
