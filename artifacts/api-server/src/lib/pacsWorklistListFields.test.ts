import { describe, expect, it } from "vitest";
import {
  omitHeavyPacsWorklistFields,
  omitHeavyPacsWorklistRows,
} from "./pacsWorklistListFields";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("omitHeavyPacsWorklistFields", () => {
  it("strips dicomMetadata and aiDraftJson while preserving list scalars", () => {
    const row = {
      id: 1,
      modality: "MR",
      status: "STUDY_RECEIVED",
      aiDraftStatus: "READY",
      dicomMetadata: "{\"PatientAge\":\"045Y\"}",
      aiDraftJson: "{\"findings\":\"x\"}",
      matchReasons: "[\"uid\"]",
    };
    const slim = omitHeavyPacsWorklistFields(row);
    expect(slim).toEqual({
      id: 1,
      modality: "MR",
      status: "STUDY_RECEIVED",
      aiDraftStatus: "READY",
      matchReasons: "[\"uid\"]",
    });
    expect("dicomMetadata" in slim).toBe(false);
    expect("aiDraftJson" in slim).toBe(false);
  });

  it("maps row arrays", () => {
    expect(omitHeavyPacsWorklistRows([
      { id: 1, dicomMetadata: "x", aiDraftJson: "y", modality: "CT" },
    ])).toEqual([{ id: 1, modality: "CT" }]);
  });
});

describe("pacs-worklist list path contracts", () => {
  it("route omits heavy blobs from list JSON and joins billed patient", () => {
    const src = readFileSync(join(__dirname, "../routes/radiology.ts"), "utf8");
    expect(src).toMatch(/omitHeavyPacsWorklistRows/);
    expect(src).toMatch(/alias\(patientsTable,\s*"study_patients"\)/);
    expect(src).toMatch(/fetchUsgAggregatesByWorklistIds/);
    expect(src).toMatch(/pacs-worklist\/:id\/ai-draft/);
    expect(src).toMatch(/PACS_WORKLIST_DETAIL_SELECT/);
  });
});
