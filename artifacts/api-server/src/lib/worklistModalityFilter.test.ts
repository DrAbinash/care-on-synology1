import { describe, expect, it } from "vitest";
import { worklistModalitySqlFilter } from "./worklistModalityFilter";
import { radiologyWorklistTable } from "@workspace/db/schema";

describe("worklistModalitySqlFilter", () => {
  it("returns undefined for all/empty", () => {
    expect(worklistModalitySqlFilter(radiologyWorklistTable.modality, "all")).toBeUndefined();
    expect(worklistModalitySqlFilter(radiologyWorklistTable.modality, "")).toBeUndefined();
  });

  it("returns SQL fragments for US, XR, and MR filters", () => {
    expect(worklistModalitySqlFilter(radiologyWorklistTable.modality, "US")).toBeTruthy();
    expect(worklistModalitySqlFilter(radiologyWorklistTable.modality, "USG")).toBeTruthy();
    expect(worklistModalitySqlFilter(radiologyWorklistTable.modality, "XR")).toBeTruthy();
    expect(worklistModalitySqlFilter(radiologyWorklistTable.modality, "MR")).toBeTruthy();
  });
});
