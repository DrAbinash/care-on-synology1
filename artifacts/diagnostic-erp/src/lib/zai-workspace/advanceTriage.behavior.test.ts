/**
 * The store's advance must triage by the SERVER's doctrine — the same
 * rank the PACS worklist SQL orders by (#1165): stat > emergency >
 * urgent > vip > routine. Before #1167 the store's studies never even
 * carried "emergency" (the normalizer demoted it to "routine") and the
 * advance's own map tied vip with urgent, so an emergency study could
 * wait behind urgent, vip, and even behind a routine with a better TAT.
 *
 * Behavior harness: seed the real store through setStudies (the same
 * ingress useWorkspaceClinicalUi uses), then call advanceToNextStudy and
 * read back activeStudyId.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace } from "./store";

function row(opts: {
  id: number;
  priority: string;
  tatMinutes?: number;
}) {
  return {
    id: opts.id,
    patientId: opts.id * 10,
    patientName: `Patient ${opts.id}`,
    accessionNumber: `ACC-${opts.id}`,
    studyInstanceUID: `1.2.3.${opts.id}`,
    modality: "CT",
    status: "STUDY_RECEIVED",
    studyDescription: "CHEST",
    bodyPart: "Chest",
    priority: opts.priority,
    tatMinutes: opts.tatMinutes ?? 0,
    createdAt: new Date().toISOString(),
  };
}

describe("advanceToNextStudy triage (#1167)", () => {
  beforeEach(() => {
    const s = useWorkspace.getState();
    s.setStudies([]);
    useWorkspace.setState({
      activeStudyId: null,
      completedStudyIds: new Set<string>(),
      nextStudyId: null,
      nextStudyPreloaded: false,
    });
  });

  it("advances to an emergency study ahead of urgent, vip and routine", () => {
    useWorkspace.getState().setStudies([
      row({ id: 1, priority: "routine", tatMinutes: 1 }),
      row({ id: 2, priority: "urgent", tatMinutes: 2 }),
      row({ id: 3, priority: "vip", tatMinutes: 3 }),
      row({ id: 4, priority: "emergency", tatMinutes: 999 }),
    ]);
    useWorkspace.getState().advanceToNextStudy();
    expect(useWorkspace.getState().activeStudyId).toBe("4");
  });

  it("keeps urgent above vip (they used to tie, broken by TAT)", () => {
    useWorkspace.getState().setStudies([
      row({ id: 1, priority: "vip", tatMinutes: 1 }),
      row({ id: 2, priority: "urgent", tatMinutes: 500 }),
    ]);
    useWorkspace.getState().advanceToNextStudy();
    expect(useWorkspace.getState().activeStudyId).toBe("2");
  });

  it("still puts stat above emergency", () => {
    useWorkspace.getState().setStudies([
      row({ id: 1, priority: "emergency" }),
      row({ id: 2, priority: "stat" }),
    ]);
    useWorkspace.getState().advanceToNextStudy();
    expect(useWorkspace.getState().activeStudyId).toBe("2");
  });

  it("falls back to the queue scan order inside the same tier (TAT tiebreak)", () => {
    useWorkspace.getState().setStudies([
      row({ id: 1, priority: "routine", tatMinutes: 30 }),
      row({ id: 2, priority: "routine", tatMinutes: 10 }),
    ]);
    useWorkspace.getState().advanceToNextStudy();
    expect(useWorkspace.getState().activeStudyId).toBe("2");
  });

  it("keeps the emergency tier after a completed stat (skip completed)", () => {
    useWorkspace.getState().setStudies([
      row({ id: 1, priority: "stat" }),
      row({ id: 2, priority: "emergency" }),
      row({ id: 3, priority: "urgent" }),
    ]);
    useWorkspace.setState({ completedStudyIds: new Set<string>(["1"]) });
    useWorkspace.getState().advanceToNextStudy();
    expect(useWorkspace.getState().activeStudyId).toBe("2");
  });
});
