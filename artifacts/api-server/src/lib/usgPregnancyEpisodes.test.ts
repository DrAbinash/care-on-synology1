import { describe, it, expect } from "vitest";
import { groupPregnancyEpisodes, anchorEddMs, type ObScan } from "./usgPregnancyEpisodes";

const scan = (over: Partial<ObScan>): ObScan => ({
  studyInstanceUID: "s", studyDate: "20240101", ...over,
});

describe("P4.3 usgPregnancyEpisodes — anchor EDD derivation", () => {
  it("prefers explicit EDD over LMP", () => {
    const ms = anchorEddMs(scan({ edd: "20241001", lmp: "20231201" }));
    expect(ms).toBe(Date.UTC(2024, 9, 1));
  });

  it("derives EDD from LMP + 280 days when no explicit EDD", () => {
    const ms = anchorEddMs(scan({ lmp: "20240101" }));
    expect(ms).toBe(Date.UTC(2024, 0, 1) + 280 * 86_400_000);
  });

  it("derives EDD from study date and established GA", () => {
    const ms = anchorEddMs(scan({ studyDate: "20240601", gaDays: 140 }));
    expect(ms).toBe(Date.UTC(2024, 5, 1) + (280 - 140) * 86_400_000);
  });

  it("returns null with no usable dating source", () => {
    expect(anchorEddMs(scan({ studyDate: "20240601" }))).toBeNull();
  });
});

describe("P4.3 usgPregnancyEpisodes — grouping", () => {
  it("groups scans of one pregnancy together", () => {
    const eps = groupPregnancyEpisodes([
      scan({ studyInstanceUID: "a", studyDate: "20240201", lmp: "20240101" }),
      scan({ studyInstanceUID: "b", studyDate: "20240401", lmp: "20240101" }),
    ]);
    expect(eps).toHaveLength(1);
    expect(eps[0].scans.map((s) => s.studyInstanceUID)).toEqual(["a", "b"]);
  });

  it("NEVER merges two clearly separate pregnancies", () => {
    const eps = groupPregnancyEpisodes([
      scan({ studyInstanceUID: "p1", studyDate: "20220201", lmp: "20220101" }),
      scan({ studyInstanceUID: "p2", studyDate: "20240201", lmp: "20240101" }),
    ]);
    expect(eps).toHaveLength(2);
  });

  it("is deterministic — episode ids derive from anchor EDD, not randomness", () => {
    const a = groupPregnancyEpisodes([scan({ studyInstanceUID: "a", studyDate: "20240201", lmp: "20240101" })]);
    const b = groupPregnancyEpisodes([scan({ studyInstanceUID: "a", studyDate: "20240201", lmp: "20240101" })]);
    expect(a[0].episodeId).toBe(b[0].episodeId);
    expect(a[0].episodeId).toMatch(/^ep_edd_/);
  });

  it("honors an explicit override map for manual regrouping", () => {
    const eps = groupPregnancyEpisodes(
      [
        scan({ studyInstanceUID: "a", studyDate: "20240201", lmp: "20240101" }),
        scan({ studyInstanceUID: "b", studyDate: "20240401", lmp: "20240101" }),
      ],
      { a: "grp1", b: "grp2" },
    );
    expect(eps).toHaveLength(2);
  });
});
