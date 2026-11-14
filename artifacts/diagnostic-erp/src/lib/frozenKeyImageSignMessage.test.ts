import { describe, expect, it } from "vitest";
import { frozenKeyImageSignMessage } from "./frozenKeyImageSignMessage";

describe("frozenKeyImageSignMessage", () => {
  it("says nothing when the freeze had nothing to report", () => {
    for (const refs of [undefined, null, { frozen: 3, placeholders: 0, skipped: 1 }]) {
      expect(frozenKeyImageSignMessage(refs)).toBeNull();
    }
  });

  it("keeps the per-image wording it was written with", () => {
    expect(frozenKeyImageSignMessage({ frozen: 0, placeholders: 1, skipped: 0 })!.title).toBe(
      "1 attached image could not be captured",
    );
    expect(frozenKeyImageSignMessage({ frozen: 0, placeholders: 2, skipped: 0 })!.title).toBe(
      "2 attached images could not be captured",
    );
    expect(
      frozenKeyImageSignMessage({ frozen: 0, placeholders: 2, skipped: 0 })!.description,
    ).toContain("IMAGE COULD NOT BE READ");
  });

  it("is at least as loud when the whole freeze threw as when one pixel was missing", () => {
    const m = frozenKeyImageSignMessage({
      frozen: 0,
      placeholders: 0,
      skipped: 0,
      failed: true,
      error: "PACS unreachable",
    });
    expect(m).not.toBeNull();
    expect(m!.title).toContain("could not be saved");
    expect(m!.description).toContain("PACS unreachable");
    expect(m!.description).toContain("reprint still depends on PACS");
  });

  it("still speaks when the server gave no reason", () => {
    const m = frozenKeyImageSignMessage({ frozen: 0, placeholders: 0, skipped: 0, failed: true });
    expect(m!.description).not.toContain("()");
    expect(m!.title).toContain("could not be saved");
  });

  it("treats a failed freeze as the whole verdict, not as zero bad images", () => {
    // A throw zeroes the counts; a caller that only looked at `placeholders`
    // would read that as a clean signing.
    expect(frozenKeyImageSignMessage({ frozen: 0, placeholders: 0, skipped: 0, failed: true })).not.toBeNull();
  });
});
