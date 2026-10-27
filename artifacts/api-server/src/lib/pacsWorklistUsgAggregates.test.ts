import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeUsgAggregatesIntoRows } from "./pacsWorklistUsgAggregates";
import { PACS_WORKLIST_DETAIL_OMIT, PACS_WORKLIST_DETAIL_SELECT } from "./pacsWorklistDetailFields";

describe("mergeUsgAggregatesIntoRows", () => {
  it("attaches constrained aggregates by worklist id (same semantics as left join)", () => {
    const rows = [{ id: 10, modality: "US" }, { id: 11, modality: "MR" }];
    const aggs = new Map([
      [10, { usgMeasurementCount: 3, usgKeyImageCount: 1, usgReportStatus: "draft" }],
    ]);
    expect(mergeUsgAggregatesIntoRows(rows, aggs)).toEqual([
      {
        id: 10,
        modality: "US",
        usgMeasurementCount: 3,
        usgKeyImageCount: 1,
        usgReportStatus: "draft",
      },
      {
        id: 11,
        modality: "MR",
        usgMeasurementCount: 0,
        usgKeyImageCount: 0,
        usgReportStatus: null,
      },
    ]);
  });
});

describe("pacs-worklist USG aggregate path contracts", () => {
  it("constrains USG aggregates to returned worklist IDs (no full-table GROUP BY joins)", () => {
    const src = readFileSync(join(__dirname, "../routes/radiology.ts"), "utf8");
    expect(src).toMatch(/fetchUsgAggregatesByWorklistIds/);
    expect(src).not.toMatch(/GROUP BY worklist_id\s*\n\s*\) AS usg_meas/);
    const aggSrc = readFileSync(join(__dirname, "pacsWorklistUsgAggregates.ts"), "utf8");
    expect(aggSrc).toMatch(/inArray\(usgMeasurementsTable\.worklistId/);
    expect(aggSrc).toMatch(/inArray\(usgKeyImagesTable\.worklistId/);
    expect(aggSrc).toMatch(/DISTINCT ON \(worklist_id\)/);
  });
});

describe("pacs-worklist detail field selection", () => {
  it("includes dicomMetadata and demographics; omits aiDraftJson", () => {
    const keys = Object.keys(PACS_WORKLIST_DETAIL_SELECT);
    expect(keys).toContain("dicomMetadata");
    expect(keys).toContain("patientName");
    expect(keys).toContain("age");
    expect(keys).toContain("sex");
    expect(keys).not.toContain("aiDraftJson");
    expect(PACS_WORKLIST_DETAIL_OMIT).toContain("aiDraftJson");

    // D-5 — a caller that loses the response to POST /api/patient-reports has
    // to be able to ask the study what it is bound to. `status` alone cannot
    // answer that: the create binds report_id in its own transaction, so the
    // half-finalized study still reads REPORT_IN_PROGRESS with a report row
    // sitting behind it. Without these two keys the detail route describes the
    // queue but not the binding, and the recovery has nothing to read.
    expect(keys).toContain("reportId");
    expect(keys).toContain("deliveryStatus");

    const src = readFileSync(join(__dirname, "../routes/radiology.ts"), "utf8");
    expect(src).toMatch(/PACS_WORKLIST_DETAIL_SELECT/);
    expect(src).toMatch(/pacs-worklist\/:id\/ai-draft/);
  });
});
