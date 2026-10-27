/**
 * B10-23 — the legacy free-text report rule, as a pure decision.
 *
 * The point of the module is that the ONLY things that can make a write legal
 * are: this study was never reachable by the modern pipeline, AND the text
 * being overwritten already exists. Everything else — role, staff id, the
 * typed "reportedBy" name, the study's status, how confident the caller
 * sounds — must be unable to change the verdict, so a route can be softened by
 * passing a different header but this function cannot be.
 */
import { describe, expect, it } from "vitest";
import {
  decideLegacyReportWrite,
  type LegacyReportAuthorityFacts,
} from "./legacyReportAuthority";

const base: LegacyReportAuthorityFacts = {
  stage: "final",
  existingColumn: "Prior legacy final text.",
  hasWorklistRow: false,
  hasPatientReport: false,
};

describe("B10-23 — a study the Reporting Workspace can reach is closed to this surface", () => {
  it("refuses a final write when a worklist row links the study", () => {
    const d = decideLegacyReportWrite({ ...base, hasWorklistRow: true });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("unreachable");
    expect(d.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
    expect(d.httpStatus).toBe(409);
  });

  it("refuses a preliminary write on the same ground (prelim is read too)", () => {
    // priorStudies.ts falls back to prelimReport when there is no final, and
    // pacsArchive.ts does the same, so a legacy "preliminary" is not inert text.
    const d = decideLegacyReportWrite({
      ...base,
      stage: "preliminary",
      existingColumn: null,
      hasWorklistRow: true,
    });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("unreachable");
    expect(d.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
  });

  it("refuses when only a patient_reports row exists, with no worklist row", () => {
    // The route can hold a report id in either id space (worklistId ?? studyId),
    // so the absence of a worklist row is not evidence of absence.
    const d = decideLegacyReportWrite({ ...base, hasPatientReport: true });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("unreachable");
    expect(d.code).toBe("LEGACY_REPORT_SURFACE_CLOSED");
  });

  it("the surface check runs even when the column is non-blank — corrections are not a loophole", () => {
    const d = decideLegacyReportWrite({ ...base, hasWorklistRow: true, existingColumn: "already here" });
    expect(d.allowed).toBe(false);
  });
});

describe("B10-23 — no NEW authoritative content is created here", () => {
  it.each([
    ["null", null],
    ["empty string", ""],
    ["whitespace only", "   \n\t "],
  ])("a %s target column means this write would be the study's first report", (_l, existingColumn) => {
    const d = decideLegacyReportWrite({ ...base, existingColumn });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("unreachable");
    expect(d.code).toBe("LEGACY_REPORT_CREATION_CLOSED");
    expect(d.httpStatus).toBe(409);
  });

  it("applies to preliminary as well as final", () => {
    const d = decideLegacyReportWrite({ ...base, stage: "preliminary", existingColumn: "" });
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error("unreachable");
    expect(d.code).toBe("LEGACY_REPORT_CREATION_CLOSED");
  });

  it("names the Reporting Workspace in every refusal, and never a dead end", () => {
    // #863 taught this: a refusal that points at a path which does not exist
    // sends the radiologist nowhere. Both branches must name the workspace, and
    // the creation branch must also say what is actually missing.
    for (const facts of [
      { ...base, hasWorklistRow: true },
      { ...base, existingColumn: null },
    ]) {
      const d = decideLegacyReportWrite(facts);
      expect(d.allowed).toBe(false);
      if (d.allowed) throw new Error("unreachable");
      expect(d.error).toContain("Reporting Workspace");
    }
    const creation = decideLegacyReportWrite({ ...base, existingColumn: null });
    if (creation.allowed) throw new Error("unreachable");
    expect(creation.error).toContain("worklist");
  });
});

describe("B10-23 — the historical compatibility branch is real, not vacuous", () => {
  it("allows correcting legacy text on a study the modern pipeline never touched", () => {
    expect(
      decideLegacyReportWrite({
        stage: "final",
        existingColumn: "2019 CT brain — old free-text report.",
        hasWorklistRow: false,
        hasPatientReport: false,
      }),
    ).toEqual({ allowed: true });
  });

  it("the two refusal rules are distinguishable, so an operator can tell why", () => {
    const closed = decideLegacyReportWrite({ ...base, hasWorklistRow: true });
    const creation = decideLegacyReportWrite({ ...base, existingColumn: null });
    if (closed.allowed || creation.allowed) throw new Error("unreachable");
    expect(closed.code).not.toBe(creation.code);
  });

  it("carries no role, staff id, status or reportedBy parameter", () => {
    // Positive control on the SIGNATURE of the rule: a parameter the decision
    // cannot see cannot be argued with. If someone widens the facts type, this
    // test is where that gets noticed.
    const params = decideLegacyReportWrite.length;
    expect(params).toBe(1);
    const keys = Object.keys(base).sort();
    expect(keys).toEqual(["existingColumn", "hasPatientReport", "hasWorklistRow", "stage"]);
    for (const forbidden of ["role", "staffId", "status", "reportedBy", "actor", "override"]) {
      expect(keys, `facts must not carry "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("extra keys on the input object cannot flip the verdict", () => {
    const widened = {
      ...base,
      hasWorklistRow: true,
      status: "reported_final",
      role: "super_admin",
      reportedBy: "Dr Something",
      override: true,
    };
    const d = decideLegacyReportWrite(widened);
    expect(d.allowed).toBe(false);
  });
});
