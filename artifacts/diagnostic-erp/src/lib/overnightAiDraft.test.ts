import { describe, expect, it } from "vitest";
import { formatRelativeAgo, overnightStatusMatches } from "./overnightAiDraft";

describe("overnight AI worklist formatters", () => {
  it("formats queue age without promising a completion time", () => {
    const now = new Date("2026-08-17T12:00:00Z").getTime();
    expect(formatRelativeAgo("2026-08-17T11:42:00Z", now)).toBe("18 min ago");
  });

  it("status chips group RETRYING with queued and STUCK with error", () => {
    expect(overnightStatusMatches("RETRYING", "queued")).toBe(true);
    expect(overnightStatusMatches("STUCK", "error")).toBe(true);
    expect(overnightStatusMatches("RUNNING", "queued")).toBe(false);
  });
});
