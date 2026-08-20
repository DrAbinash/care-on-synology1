import { describe, expect, it } from "vitest";
import { formatRelativeAgo, overnightStatusMatches } from "./overnightAiDraft";

describe("overnight AI worklist formatters", () => {
  it("formats queue age without promising a completion time", () => {
    const now = new Date("2026-08-17T12:00:00Z").getTime();
    expect(formatRelativeAgo("2026-08-17T11:42:00Z", now)).toBe("18 min ago");
  });

  it("status chips group RETRYING with queued, STUCK with error, and isolate EMPTY/QUARANTINED", () => {
    expect(overnightStatusMatches("RETRYING", "queued")).toBe(true);
    expect(overnightStatusMatches("STUCK", "error")).toBe(true);
    expect(overnightStatusMatches("RUNNING", "queued")).toBe(false);
    expect(overnightStatusMatches("EMPTY", "empty")).toBe(true);
    expect(overnightStatusMatches("EMPTY", "ready")).toBe(false);
    expect(overnightStatusMatches("QUARANTINED", "quarantined")).toBe(true);
    expect(overnightStatusMatches("QUARANTINED", "ready")).toBe(false);
  });
});
