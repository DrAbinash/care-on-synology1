/**
 * PR-5 — the critical-result communication workflow is optional.
 *
 * `ff_radiology_critical_result_comms` (default OFF) governs the COMMUNICATION
 * workflow built on top of critical-finding detection: the 15-minute SLA clock,
 * the interrupt popup, the pre-sign acknowledgement block, the Mark Critical
 * Finding panel, the tracker page and its API. This centre does not currently
 * follow that protocol, so the workflow ships switched off rather than deleted.
 *
 * The line this file exists to hold is the one between the workflow and the
 * DETECTOR. Turning the flag off must stop the clock and the popup, but it must
 * NOT stop `runCopilotAnalysis` from reporting "Critical finding detected" in
 * the copilot rail. Detection is clinical information about the report text;
 * the clock and the popup are a process obligation. Conflating the two would
 * mean a centre that does not run the protocol also stops being told that a
 * report describes an acute infarct — which is the opposite of what was asked
 * for. So the OFF case asserts both halves: no clock, no interrupt, and the
 * advisory item still present.
 *
 * These are behavioural tests through the real store and the real flag read
 * path (`setServerFeatureFlags`, the same function hooks/useServerFeatureFlags
 * calls after GET /api/feature-flags resolves). Nothing here mocks
 * `isFeatureEnabled`, so a gate that read the flag from somewhere else would
 * not pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { setServerFeatureFlags } from "@/lib/staffSession";
import { CRITICAL_COMMS_FLAG, criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";

/** A worklist row with a patient attached. `recomputeCopilot` returns early
 *  without one (`if (!st?.patient)`), so the copilot — and therefore the SLA
 *  block that reads its output — would never run. */
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

/** Matches CRITICAL_PATTERNS' /acute infarct|acute stroke|mca territory infarct/i
 *  with no negation in the preceding 30 characters, so runLintRules raises
 *  CRITICAL_FINDING and runCopilotAnalysis emits a kind:"critical" item. */
const CRITICAL_FINDINGS = "Acute infarct in the left MCA territory.";
const BENIGN_FINDINGS = "Age-appropriate cerebral atrophy. No acute intracranial haemorrhage.";

function setCommsFlag(enabled: boolean) {
  setServerFeatureFlags({ [CRITICAL_COMMS_FLAG]: enabled });
}

/** Open a study through the real FULL reset, give it content, and run the real
 *  recompute. Returns nothing — assertions read the store directly so they see
 *  the SLA and notification fields too, not just the rail. */
function openStudyWith(findings: string) {
  useWorkspace.getState().selectStudy("study-A");
  useWorkspace.setState({
    findingsText: findings,
    // Deliberately empty: runLintRules is fed findings + impression together,
    // so a critical sentence left in the impression would raise a critical item
    // even in the benign-report case below and make that assertion meaningless.
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
  // Fake timers keep selectStudy's deferred recomputeCopilot from firing after
  // the assertions, or during the next test.
  vi.useFakeTimers();
  useWorkspace.setState({ ...emptyClinicalState() } as never);
  useWorkspace.setState({
    activeStudyId: null,
    activeStudyInstanceUID: null,
    notification: null,
    criticalSlaStartedAt: null,
    criticalSlaEscalated: false,
    isFinalized: false,
    isDirty: false,
    studies: [studyRow("study-A", "Patient A")],
  } as never);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the flag read point itself", () => {
  it("reports exactly what the server hydrated", () => {
    setCommsFlag(true);
    expect(criticalCommsEnabled()).toBe(true);
    setCommsFlag(false);
    expect(criticalCommsEnabled()).toBe(false);
  });
});

describe("workflow ON — the clock and the interrupt still work", () => {
  beforeEach(() => setCommsFlag(true));

  it("starts the SLA clock on a detected critical finding", () => {
    openStudyWith(CRITICAL_FINDINGS);
    expect(useWorkspace.getState().criticalSlaStartedAt).not.toBeNull();
  });

  it("raises the interrupt notification naming the finding", () => {
    openStudyWith(CRITICAL_FINDINGS);
    const n = useWorkspace.getState().notification;
    expect(n?.kind).toBe("interrupt");
    expect(n?.text).toMatch(/Critical finding/i);
  });

  it("keeps the informational rail item", () => {
    openStudyWith(CRITICAL_FINDINGS);
    const items = useWorkspace.getState().copilotItems;
    expect(items.some((i) => i.kind === "critical")).toBe(true);
  });
});

describe("workflow OFF — no clock, no interrupt, detector untouched", () => {
  beforeEach(() => setCommsFlag(false));

  it("does not start the SLA clock", () => {
    openStudyWith(CRITICAL_FINDINGS);
    expect(useWorkspace.getState().criticalSlaStartedAt).toBeNull();
    expect(useWorkspace.getState().criticalSlaEscalated).toBe(false);
  });

  it("does not raise an interrupt notification", () => {
    openStudyWith(CRITICAL_FINDINGS);
    expect(useWorkspace.getState().notification).toBeNull();
  });

  it("STILL reports the critical finding in the copilot rail", () => {
    // The detector is deliberately out of scope for this flag. A centre that
    // does not run the communication protocol must still be told that the
    // report describes an acute infarct.
    openStudyWith(CRITICAL_FINDINGS);
    const items = useWorkspace.getState().copilotItems;
    const critical = items.filter((i) => i.kind === "critical");
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0].detail).toMatch(/Critical finding/i);
  });

  it("leaves the notification slot free for other kinds", () => {
    // The single `notification` field is shared with edge-glow and ledger
    // notifications. Suppressing the critical interrupt must not block those.
    openStudyWith(CRITICAL_FINDINGS);
    useWorkspace.getState().pushNotification({ kind: "edge-glow", text: "unrelated" });
    expect(useWorkspace.getState().notification?.kind).toBe("edge-glow");
  });

  it("produces no critical rail item for a benign report either way", () => {
    openStudyWith(BENIGN_FINDINGS);
    expect(useWorkspace.getState().copilotItems.some((i) => i.kind === "critical")).toBe(false);
    expect(useWorkspace.getState().criticalSlaStartedAt).toBeNull();
  });
});

describe("toggling mid-session", () => {
  it("stops raising the interrupt when the flag is turned off after a finding", () => {
    setCommsFlag(true);
    openStudyWith(CRITICAL_FINDINGS);
    expect(useWorkspace.getState().criticalSlaStartedAt).not.toBeNull();

    // An admin turns the workflow off while a study is open. The next recompute
    // must not raise a fresh interrupt for a new critical sentence.
    setCommsFlag(false);
    useWorkspace.setState({
      notification: null,
      criticalSlaStartedAt: null,
      findingsText: `${CRITICAL_FINDINGS}\nThere is also a pneumothorax.`,
    } as never);
    useWorkspace.getState().recomputeCopilot();

    expect(useWorkspace.getState().notification).toBeNull();
    expect(useWorkspace.getState().criticalSlaStartedAt).toBeNull();
  });
});
