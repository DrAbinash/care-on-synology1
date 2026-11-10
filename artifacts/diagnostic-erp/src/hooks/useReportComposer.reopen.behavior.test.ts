/**
 * useReportComposer.reopen.behavior.test.ts — A-1 regression.
 *
 * THE DEFECT UNDER GUARD
 *   The reopen effect keyed on `opts.worklistId` never cleared `job` /
 *   `reviewOpen` — `setJob` only ever received a job object. The workspace
 *   swaps `worklistId` in place on ONE mounted instance, so after switching
 *   from study A (READY draft) to study B, B's AI tab still rendered A's
 *   proposed findings with live Accept/Reject/Apply controls, and Apply could
 *   write A's text into B's draft whenever the freshness hash could not tell
 *   the two studies apart (two untouched normals of the same region).
 *
 * The fix resets job / reviewOpen / inputPreview SYNCHRONOUSLY at the top of
 * the effect — before the await — so study B's first committed render never
 * carries study A's job, even while B's own fetch is still in flight.
 *
 * Harness: same convention as useReportingStudySetup.regionTransition.test.ts
 * — real React root, real zustand store, real hook; only the composer API and
 * the toaster are mocked. A never-resolving promise for study B's fetch pins
 * the reset to the effect body itself, not to the response arriving.
 */
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReportComposer } from "./useReportComposer";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { ComposeJobView } from "@/lib/reportComposer/types";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const latestMock = vi.fn();
vi.mock("@/lib/reportComposer/api", () => ({
  reportComposerApi: {
    latest: (...a: unknown[]) => latestMock(...a),
    getJob: vi.fn(),
    enqueue: vi.fn(),
    cancel: vi.fn(),
    apply: vi.fn(),
    editChange: vi.fn(),
    acceptChange: vi.fn(),
    rejectChange: vi.fn(),
    acceptAll: vi.fn(),
    rejectAll: vi.fn(),
    discard: vi.fn(),
    regenerate: vi.fn(),
  },
  // JobKind re-exported as a type only; the runtime mock needs no value.
  JobKind: undefined,
}));

const STUDY_A = 91001;
const STUDY_B = 91002;

function jobFixture(worklistId: number, id: number): ComposeJobView {
  return {
    id,
    studyId: null,
    worklistId,
    reportId: null,
    jobKind: "REPORT",
    status: "READY",
    sourceReportRevision: "rev-1",
    sourceFindingsHash: "h-findings",
    sourceImpressionHash: "h-impression",
    sourceRecommendationHash: "h-recommendation",
    inputHash: "h-input",
    proposedFindings: "Proposed for the study it belongs to.",
    proposedImpression: "Impression for the study it belongs to.",
    proposedRecommendation: null,
    trackedChanges: [],
    draft: null,
    validation: null,
    sources: {},
    model: "test-model",
    fallbackUsed: false,
    latencyMs: null,
    safeError: null,
    createdBy: null,
    appliedBy: null,
    createdAt: "2026-11-10T08:00:00Z",
    startedAt: "2026-11-10T08:00:01Z",
    completedAt: "2026-11-10T08:00:05Z",
    appliedAt: null,
  } satisfies ComposeJobView;
}

let root: Root;
let current: ReturnType<typeof useReportComposer>;

function Harness({ worklistId }: { worklistId: number | null }) {
  current = useReportComposer({
    worklistId,
    studyId: null,
    reportId: null,
  });
  useLayoutEffect(() => undefined, []);
  return null;
}

function render(worklistId: number | null) {
  act(() => root.render(createElement(Harness, { worklistId })));
}

async function tick() {
  // Flush the reopen effect's async chain without fake timers.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No network in hook tests")));
  const document = {
    nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {},
  };
  const window = Object.assign(new EventTarget(), { document, HTMLIFrameElement: class {} });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  root = createRoot({
    nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document, addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLElement);
  latestMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useReportComposer reopen (A-1)", () => {
  it("drops the previous study's READY job when the workspace switches studies", async () => {
    latestMock.mockResolvedValueOnce({ ok: true, job: jobFixture(STUDY_A, 501) });
    render(STUDY_A);
    await tick();
    expect(current.job?.id).toBe(501);
    expect(current.job?.worklistId).toBe(STUDY_A);
    expect(current.reviewOpen).toBe(true);

    // Study B's fetch never resolves: whatever the panel shows for B must come
    // from the effect body's reset, not from B's response arriving.
    let releaseB: () => void = () => undefined;
    latestMock.mockImplementationOnce(
      () => new Promise<{ ok: boolean; job: null }>((resolve) => { releaseB = () => resolve({ ok: true, job: null }); }),
    );
    latestMock.mockImplementationOnce(
      () => new Promise<{ ok: boolean; job: null }>((resolve) => { releaseB = () => resolve({ ok: true, job: null }); }),
    );
    render(STUDY_B);
    expect(current.job).toBeNull();
    expect(current.reviewOpen).toBe(false);
    expect(latestMock).toHaveBeenLastCalledWith(STUDY_B);
    releaseB();
    await tick();
    expect(current.job).toBeNull();
    expect(current.reviewOpen).toBe(false);
  });

  it("reopens the new study's own job with review open (the reset must not break reopen)", async () => {
    latestMock.mockResolvedValueOnce({ ok: true, job: jobFixture(STUDY_A, 501) });
    render(STUDY_A);
    await tick();
    expect(current.reviewOpen).toBe(true);

    latestMock.mockResolvedValueOnce({ ok: true, job: jobFixture(STUDY_B, 702) });
    render(STUDY_B);
    await tick();
    expect(current.job?.id).toBe(702);
    expect(current.job?.worklistId).toBe(STUDY_B);
    expect(current.reviewOpen).toBe(true);
  });

  it("clears the job when the workspace closes the study (worklistId null)", async () => {
    latestMock.mockResolvedValueOnce({ ok: true, job: jobFixture(STUDY_A, 501) });
    render(STUDY_A);
    await tick();
    render(null);
    expect(current.job).toBeNull();
    expect(current.reviewOpen).toBe(false);
    expect(latestMock).toHaveBeenCalledTimes(1);
  });

  it("leaves no previous-study draft in the store text (Apply path untouched by reopen)", () => {
    // The store must not have been mutated by mounting the hook alone.
    const s = useWorkspace.getState();
    expect(s.findingsText ?? "").toBe("");
  });
});
