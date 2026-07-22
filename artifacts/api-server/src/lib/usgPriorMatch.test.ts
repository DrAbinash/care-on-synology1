import { describe, it, expect } from "vitest";
import { matchPriorStudies, parseStudyDate, type StudyRef } from "./usgPriorMatch";

const study = (over: Partial<StudyRef>): StudyRef => ({
  studyInstanceUID: "cur",
  patientId: 1,
  modality: "US",
  ...over,
});

describe("P4.1 usgPriorMatch — parseStudyDate", () => {
  it("parses YYYYMMDD and ISO, rejects garbage", () => {
    expect(parseStudyDate("20240115")).toBe(Date.UTC(2024, 0, 15));
    expect(parseStudyDate("2024-01-15")).toBe(Date.parse("2024-01-15"));
    expect(parseStudyDate("not a date")).toBeNull();
    expect(parseStudyDate(null)).toBeNull();
  });
});

describe("P4.1 usgPriorMatch — cross-patient safety", () => {
  it("NEVER matches a different patientId", () => {
    const current = study({ studyInstanceUID: "cur", patientId: 1, studyDate: "20240601" });
    const out = matchPriorStudies(current, [
      study({ studyInstanceUID: "other", patientId: 2, studyDate: "20240101" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("rejects a crosswalk-id mismatch even with same patientId", () => {
    const current = study({ studyInstanceUID: "cur", patientId: 1, patientCrosswalkId: "A", studyDate: "20240601" });
    const out = matchPriorStudies(current, [
      study({ studyInstanceUID: "p", patientId: 1, patientCrosswalkId: "B", studyDate: "20240101" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("never returns the current study as its own prior", () => {
    const current = study({ studyInstanceUID: "same", patientId: 1, studyDate: "20240601" });
    const out = matchPriorStudies(current, [study({ studyInstanceUID: "same", patientId: 1, studyDate: "20240601" })]);
    expect(out).toHaveLength(0);
  });

  it("excludes priors dated after the current study", () => {
    const current = study({ studyInstanceUID: "cur", patientId: 1, studyDate: "20240101" });
    const out = matchPriorStudies(current, [
      study({ studyInstanceUID: "future", patientId: 1, studyDate: "20240601" }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("P4.1 usgPriorMatch — scoring & ordering", () => {
  it("ranks same modality+region+final highest and computes interval", () => {
    const current = study({
      studyInstanceUID: "cur", patientId: 1, modality: "US", bodyRegion: "abdomen", studyDate: "20240601",
    });
    const out = matchPriorStudies(current, [
      study({ studyInstanceUID: "a", patientId: 1, modality: "US", bodyRegion: "abdomen", reportStatus: "final", studyDate: "20240101" }),
      study({ studyInstanceUID: "b", patientId: 1, modality: "CT", bodyRegion: "chest", studyDate: "20240501" }),
    ]);
    expect(out[0].study.studyInstanceUID).toBe("a");
    expect(out[0].reasons).toContain("same modality");
    expect(out[0].reasons).toContain("final report");
    expect(out[0].intervalDays).toBe(152);
  });

  it("respects filters and maxResults", () => {
    const current = study({ studyInstanceUID: "cur", patientId: 1, modality: "US", bodyRegion: "pelvis", studyDate: "20240601" });
    const candidates = [
      study({ studyInstanceUID: "a", patientId: 1, modality: "US", bodyRegion: "pelvis", studyDate: "20240401" }),
      study({ studyInstanceUID: "b", patientId: 1, modality: "CT", bodyRegion: "pelvis", studyDate: "20240301" }),
      study({ studyInstanceUID: "c", patientId: 1, modality: "US", bodyRegion: "pelvis", studyDate: "20240201" }),
    ];
    const out = matchPriorStudies(current, candidates, { sameModalityOnly: true, maxResults: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].study.modality).toBe("US");
  });

  it("prefers the most recent prior when scores tie", () => {
    const current = study({ studyInstanceUID: "cur", patientId: 1, modality: "US", bodyRegion: "abdomen", studyDate: "20240601" });
    const out = matchPriorStudies(current, [
      study({ studyInstanceUID: "old", patientId: 1, modality: "US", bodyRegion: "abdomen", studyDate: "20240101" }),
      study({ studyInstanceUID: "recent", patientId: 1, modality: "US", bodyRegion: "abdomen", studyDate: "20240501" }),
    ]);
    expect(out[0].study.studyInstanceUID).toBe("recent");
  });
});
