/**
 * The per-study critical-SLA ledger — behavioural contracts through the real
 * store and the real flag read path.
 *
 * Before the ledger, `criticalSlaStartedAt` was a single scalar wiped by every
 * study switch (it is clinical state, and a clock must never leak from Patient
 * A to Patient B). The elapsed time itself died with it: reopen a study whose
 * critical finding was still uncommunicated and the clock restarted from zero,
 * under-reporting by however long the radiologist spent on other studies —
 * and while they were elsewhere, NOTHING showed the clock at all.
 *
 * These tests pin the three halves of the fix:
 *   1. DETECTION writes a session ledger entry for the study (`criticalSlaStarts`).
 *   2. RESTORE re-projects the incoming study's entry into the active clock
 *      (original timestamp, escalation recomputed from real elapsed time).
 *   3. RETIRE deletes the entry (finalize closed the study / clearCriticalSla)
 *      so a reopened study does not inherit a dead clock.
 *
 * Everything runs through the same surfaces production uses — selectStudy,
 * recomputeCopilot, completeFinalize — with fake timers so "five minutes later"
 * is exact. Nothing mocks isFeatureEnabled; the flag path is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { setServerFeatureFlags } from "@/lib/staffSession";
import { CRITICAL_COMMS_FLAG } from "@/lib/criticalResultCommsFlag";

/** A worklist row with a patient attached — recomputeCopilot returns early
 *  without one (`if (!st?.patient)`), so no copilot item, and no SLA clock. */
function studyRow(id: string, name: string) {
  return {
    id,
    accession: `ACC-${id}`,
    studyInstanceUID: `1.2.840.${id}`,
    patient: {
      id: `pt-${id}`,
      name,
      age: 52,
      sex: "M",
      uhid: `UHID-${id}`,
      referringDoctor: "Dr Ref",
    },
    modality: "MR",
    bodyPart: "BRAIN",
    studyDescription: "MRI Brain",
    clinicalHistory: "Sudden onset weakness",
    status: "draft",
    priority: "urgent",
    receivedAt: new Date().toISOString(),
    priorCount: 0,
    criticalFlag: false,
    aiDraftReady: false,
    tatMinutes: 12,
    slaMinutes: 30,
    series: 1,
    images: 240,
  };
}

/** Matches the copilot's critical pattern with no negation in the window. */
const CRITICAL_FINDINGS = "Acute infarct in the left MCA territory.";

function setCommsFlag(enabled: boolean) {
  setServerFeatureFlags({ [CRITICAL_COMMS_FLAG]: enabled });
}

/** Open a study through the real FULL reset, give it content, run the real
 *  recompute — the exact sequence that starts the clock in production. */
function openStudyWith(studyId: string, findings: string) {
  useWorkspace.getState().selectStudy(studyId);
  useWorkspace.setState({
    findingsText: findings,
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    priors: [],
    measurements: [],
  } as never);
  useWorkspace.getState().recomputeCopilot();
}

beforeEach(() => {
  // Fake timers: selectStudy defers a recomputeCopilot via setTimeout(0), and
  // elapsed-time assertions need an exact, controllable clock.
  vi.useFakeTimers();
  useWorkspace.setState({ ...emptyClinicalState() } as never);
  useWorkspace.setState({
    activeStudyId: null,
    activeStudyInstanceUID: null,
    notification: null,
    criticalSlaStartedAt: null,
    criticalSlaEscalated: false,
    criticalSlaStarts: {},
    isFinalized: false,
    isDirty: false,
    studies: [
      studyRow("study-A", "Patient A"),
      studyRow("study-B", "Patient B"),
    ],
  } as never);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("detection writes the per-study ledger", () => {
  beforeEach(() => setCommsFlag(true));

  it("records the study's entry at the same moment the active clock starts", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).not.toBeNull();
    expect(s.criticalSlaStarts["study-A"]).toBe(s.criticalSlaStartedAt);
  });

  it("leaves other studies out of the ledger", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const starts = useWorkspace.getState().criticalSlaStarts;
    expect(Object.keys(starts)).toEqual(["study-A"]);
  });

  it("writes nothing when the comms workflow is off", () => {
    setCommsFlag(false);
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaStarts).toEqual({});
  });
});

describe("switching studies keeps the clock honest", () => {
  beforeEach(() => setCommsFlag(true));

  it("restores the ORIGINAL start on switch-back, not a restart from zero", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const t0 = useWorkspace.getState().criticalSlaStartedAt!;
    expect(t0).not.toBeNull();

    // Five minutes on another study, then back.
    useWorkspace.getState().selectStudy("study-B");
    vi.advanceTimersByTime(5 * 60_000);
    useWorkspace.getState().selectStudy("study-A");

    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).toBe(t0);
    expect(s.criticalSlaEscalated).toBe(false);
  });

  it("keeps the ledger entry visible while the study is NOT open", () => {
    // The whole point of the ledger: the queue badge reads it while the
    // radiologist works elsewhere. The entry must outlive the switch away.
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const t0 = useWorkspace.getState().criticalSlaStarts["study-A"]!;

    useWorkspace.getState().selectStudy("study-B");
    const s = useWorkspace.getState();
    expect(s.activeStudyId).toBe("study-B");
    expect(s.criticalSlaStartedAt).toBeNull(); // B's clock, not A's
    expect(s.criticalSlaStarts["study-A"]).toBe(t0); // A's elapsed time lives on
  });

  it("restores an overdue entry as already escalated", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);

    useWorkspace.getState().selectStudy("study-B");
    // 15-minute default SLA window passes while the study is parked.
    vi.advanceTimersByTime(16 * 60_000);
    useWorkspace.getState().selectStudy("study-A");

    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).not.toBeNull();
    expect(s.criticalSlaEscalated).toBe(true);
  });

  it("gives a study with no ledger entry a clean null clock", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    useWorkspace.getState().selectStudy("study-B");
    // B has no critical finding; its clock must be null, never A's.
    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaEscalated).toBe(false);
    expect(s.criticalSlaStarts["study-B"]).toBeUndefined();
  });

  it("does not restart the clock when re-detection fires on a restored study", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const t0 = useWorkspace.getState().criticalSlaStartedAt!;

    useWorkspace.getState().selectStudy("study-B");
    vi.advanceTimersByTime(5 * 60_000);
    useWorkspace.getState().selectStudy("study-A");

    // The draft re-hydrates the critical sentence; recomputeCopilot runs again
    // through the real path. The clock must keep the original start.
    useWorkspace.setState({ findingsText: CRITICAL_FINDINGS } as never);
    useWorkspace.getState().recomputeCopilot();

    expect(useWorkspace.getState().criticalSlaStartedAt).toBe(t0);
    expect(useWorkspace.getState().criticalSlaStarts["study-A"]).toBe(t0);
  });
});

describe("retiring a clock", () => {
  beforeEach(() => setCommsFlag(true));

  it("finalize deletes the study's ledger entry", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    expect(useWorkspace.getState().criticalSlaStarts["study-A"]).toBeDefined();

    useWorkspace.getState().completeFinalize();
    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaStarts["study-A"]).toBeUndefined();
  });

  it("a finalized study reopened later starts a fresh clock, not the dead one", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const t0 = useWorkspace.getState().criticalSlaStarts["study-A"]!;
    useWorkspace.getState().completeFinalize();

    vi.advanceTimersByTime(30 * 60_000);
    useWorkspace.getState().selectStudy("study-A");
    // No entry → no clock. Detection is what starts the next one.
    expect(useWorkspace.getState().criticalSlaStartedAt).toBeNull();

    openStudyWith("study-A", CRITICAL_FINDINGS);
    const t1 = useWorkspace.getState().criticalSlaStarts["study-A"]!;
    expect(t1).not.toBe(t0);
  });

  it("clearCriticalSla retires the entry too", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    useWorkspace.getState().clearCriticalSla();
    const s = useWorkspace.getState();
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaStarts["study-A"]).toBeUndefined();
  });

  it("retiring one study's clock never touches another's", () => {
    openStudyWith("study-A", CRITICAL_FINDINGS);
    const tA = useWorkspace.getState().criticalSlaStarts["study-A"]!;
    openStudyWith("study-B", CRITICAL_FINDINGS);
    const tB = useWorkspace.getState().criticalSlaStarts["study-B"]!;

    useWorkspace.getState().clearCriticalSla();
    const starts = useWorkspace.getState().criticalSlaStarts;
    expect(starts["study-A"]).toBe(tA);
    expect(starts["study-B"]).toBeUndefined();
    expect(tB).toBeDefined();
  });
});
