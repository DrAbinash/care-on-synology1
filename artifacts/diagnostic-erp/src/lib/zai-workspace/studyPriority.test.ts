/**
 * The canonical triage rank — one authority shared by the server's
 * worklist SQL (#1165) and every client-side surface that decides what
 * the radiologist reports next. These pins exist so the workspace can
 * never again invent its own five-word vocabulary with a tier missing
 * (the emergency demotion, #1167).
 */
import { describe, expect, it } from "vitest";
import { STUDY_PRIORITY_RANK, studyPriorityRank } from "./studyPriority";

describe("STUDY_PRIORITY_RANK (server doctrine mirror)", () => {
  it("orders the five tiers exactly as studyPriorityEngine does", () => {
    // stat > emergency > urgent > vip > routine, expressed low-first.
    expect(STUDY_PRIORITY_RANK.stat).toBeLessThan(STUDY_PRIORITY_RANK.emergency);
    expect(STUDY_PRIORITY_RANK.emergency).toBeLessThan(STUDY_PRIORITY_RANK.urgent);
    expect(STUDY_PRIORITY_RANK.urgent).toBeLessThan(STUDY_PRIORITY_RANK.vip);
    expect(STUDY_PRIORITY_RANK.vip).toBeLessThan(STUDY_PRIORITY_RANK.routine);
  });

  it("keeps urgent strictly above vip (they were tied before #1167)", () => {
    expect(STUDY_PRIORITY_RANK.urgent).not.toBe(STUDY_PRIORITY_RANK.vip);
  });
});

describe("studyPriorityRank (tolerant reader)", () => {
  it("returns the tier rank for each vocabulary word", () => {
    expect(studyPriorityRank("stat")).toBe(0);
    expect(studyPriorityRank("emergency")).toBe(1);
    expect(studyPriorityRank("urgent")).toBe(2);
    expect(studyPriorityRank("vip")).toBe(3);
    expect(studyPriorityRank("routine")).toBe(4);
  });

  it("is case-insensitive", () => {
    expect(studyPriorityRank("EMERGENCY")).toBe(1);
    expect(studyPriorityRank("Stat")).toBe(0);
  });

  it("reads unknown, null, undefined and blank as the routine tier", () => {
    const routine = studyPriorityRank("routine");
    expect(studyPriorityRank("unknown-tier")).toBe(routine);
    expect(studyPriorityRank(null)).toBe(routine);
    expect(studyPriorityRank(undefined)).toBe(routine);
    expect(studyPriorityRank("")).toBe(routine);
    expect(studyPriorityRank("  ")).toBe(routine);
  });
});
