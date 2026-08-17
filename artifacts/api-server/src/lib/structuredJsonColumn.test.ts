import { describe, expect, it } from "vitest";
import {
  CARE_STRUCTURED_FORMAT_STATE_KIND,
  STRUCTURED_JSON_ENVELOPE_KIND,
  composeStructuredJsonColumn,
  extractA4Cache,
  extractCareStructuredFormat,
} from "./structuredJsonColumn";

const FORMAT = {
  kind: CARE_STRUCTURED_FORMAT_STATE_KIND,
  formatId: 9,
  formatVersion: 2,
  values: { "discs::l4-5::morphology": "bulge" },
  updatedAt: "2026-08-17T00:00:00.000Z",
} as const;

const CACHE = [{ findingId: 1, source: "quickselect" }];

describe("structured_json envelope (A4 cache + format values)", () => {
  it("legacy array is returned unchanged when there is no format state", () => {
    expect(composeStructuredJsonColumn({ existing: CACHE })).toEqual(CACHE);
    expect(extractA4Cache(CACHE)).toEqual(CACHE);
    expect(extractCareStructuredFormat(CACHE)).toBeNull();
  });

  it("null cache with no format state stays null", () => {
    expect(composeStructuredJsonColumn({ existing: null, a4Cache: null })).toBeNull();
  });

  it("wraps A4 array when format state is present so drift still sees the array", () => {
    const col = composeStructuredJsonColumn({ existing: CACHE, formatState: FORMAT });
    expect(col).toEqual({
      kind: STRUCTURED_JSON_ENVELOPE_KIND,
      a4Cache: CACHE,
      careStructuredFormat: FORMAT,
    });
    expect(extractA4Cache(col)).toEqual(CACHE);
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
  });

  it("A4 regen updates cache without dropping format values", () => {
    const existing = composeStructuredJsonColumn({ existing: CACHE, formatState: FORMAT });
    const nextCache = [{ findingId: 2 }];
    const col = composeStructuredJsonColumn({ existing, a4Cache: nextCache });
    expect(extractA4Cache(col)).toEqual(nextCache);
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
  });

  it("empty A4 cache + format state is an envelope, not null (so values survive deselect-all)", () => {
    const col = composeStructuredJsonColumn({ existing: CACHE, a4Cache: null, formatState: FORMAT });
    expect(extractA4Cache(col)).toBeNull();
    expect(extractCareStructuredFormat(col)).toEqual(FORMAT);
  });
});
