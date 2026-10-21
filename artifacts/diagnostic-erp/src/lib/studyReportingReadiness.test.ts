/**
 * Phase 3, item A — appointment vs reporting exam visibility.
 *
 * One table, two kinds of row, and before this change they were
 * pixel-identical in the Reading Queue: a SCHEDULED worklist row (the
 * appointment/billing door's record of a booked procedure, no DICOM yet)
 * normalized its status into "received" — the queue asserted an appointment's
 * images had arrived, and the radiologist found out only after opening it.
 *
 * These tests pin the three layers of the fix, top down:
 *
 *   1. normalizeWorkspaceStudy carries "scheduled" honestly (no laundering);
 *   2. studyReportingReadiness classifies by lifecycle status ONLY — a missing
 *      images count can never make an arrived exam read as an appointment,
 *      because the worklist endpoint does not send counts at all;
 *   3. the queue strip renders the badge and the header count (source
 *      contract — this container has no browser).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeWorkspaceStudy, normalizeWorkspaceStudies } from "./zai-workspace/normalizeWorkspaceStudy";
import { countAwaitingAcquisition, studyReportingReadiness } from "./studyReportingReadiness";

/** A flat pacs-worklist row exactly as the endpoint returns it. */
function worklistRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 4102,
    patientName: "SYNTHETIC PATIENT",
    modality: "MR",
    studyDescription: "MRI LS Spine Plain",
    accessionNumber: "SYN-ACC-0001",
    // The pacs-worklist endpoint does not send image or series counts; the
    // normalizer defaults them to 0 and the classifier must not be fooled.
    ...overrides,
  };
}

describe("normalizeWorkspaceStudy carries the appointment status honestly", () => {
  it("a SCHEDULED row (the appointment door's booking) stays scheduled", () => {
    const study = normalizeWorkspaceStudy(worklistRow({ status: "SCHEDULED", sourceAppointmentId: 771 }));
    expect(study?.status).toBe("scheduled");
  });

  it("an arrived exam stays received — the reporting lifecycle is untouched", () => {
    for (const status of ["STUDY_RECEIVED", "REPORT_IN_PROGRESS", "REPORT_FINAL"]) {
      const study = normalizeWorkspaceStudy(worklistRow({ status }));
      expect(study?.status, status).not.toBe("scheduled");
    }
    const received = normalizeWorkspaceStudy(worklistRow({ status: "STUDY_RECEIVED" }));
    expect(received?.status).toBe("received");
  });

  it("junk statuses still fall back to received — no new invention", () => {
    expect(normalizeWorkspaceStudy(worklistRow({ status: "WHATEVER" }))?.status).toBe("received");
    expect(normalizeWorkspaceStudy(worklistRow({}))?.status).toBe("received");
  });

  it("a queue payload of mixed rows normalizes without losing the appointment", () => {
    const studies = normalizeWorkspaceStudies([
      worklistRow({ id: 1, status: "STUDY_RECEIVED" }),
      worklistRow({ id: 2, status: "SCHEDULED" }),
    ]);
    expect(studies.map((s) => s.status).sort()).toEqual(["received", "scheduled"]);
  });
});

describe("studyReportingReadiness — the display classifier", () => {
  it("a booked appointment awaits acquisition, with badge and hint a radiologist can act on", () => {
    const r = studyReportingReadiness({ status: "scheduled" });
    expect(r.state).toBe("awaiting-acquisition");
    expect(r.badge).toContain("BOOKED");
    expect(r.hint).toContain("no images");
  });

  it("the reporting lifecycle is reportable and renders no badge — today's appearance", () => {
    for (const status of ["received", "in_progress", "draft", "prelim", "final", "amended"]) {
      const r = studyReportingReadiness({ status });
      expect(r.state, status).toBe("reportable");
      expect(r.badge, status).toBe("");
      expect(r.hint, status).toBe("");
    }
  });

  it("decides on lifecycle status ONLY — a missing image count never makes an arrived exam an appointment", () => {
    // The wire omits counts entirely; images: 0 is the DEFAULT for every
    // arrived study. Deciding readiness from the count would mark the whole
    // queue as awaiting.
    expect(studyReportingReadiness({ status: "received", images: 0, series: 0 }).state)
      .toBe("reportable");
    expect(studyReportingReadiness({ status: "received" }).state).toBe("reportable");
    expect(studyReportingReadiness({}).state).toBe("reportable");
  });

  it("counts the appointments in a queue, mixed with exams", () => {
    expect(countAwaitingAcquisition([
      { status: "received" },
      { status: "scheduled" },
      { status: "scheduled" },
      { status: "final" },
    ])).toBe(2);
    expect(countAwaitingAcquisition([])).toBe(0);
  });
});

/** No browser in this container — the queue strip wiring is pinned by source. */
describe("the Reading Queue wiring (source contract)", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

  it("a booked row carries the badge, the hint, and the header counts them", () => {
    const strip = read("../components/radiology/zai-workspace/worklist-strip.tsx");
    expect(strip).toMatch(/studyReportingReadiness/);
    expect(strip).toMatch(/queue-row-booked/);
    expect(strip).toMatch(/queue-awaiting-count/);
    expect(strip).toMatch(/countAwaitingAcquisition/);
    expect(strip).toMatch(/readiness\.hint/);
  });
});
