import { describe, expect, it } from "vitest";
import {
  freezeForSignSafely,
  frozenImageSignFailure,
} from "./frozenKeyImageSignOutcome";

describe("freezeForSignSafely — the one contract all three signing paths share", () => {
  it("passes a clean freeze straight through, with no failure marker", async () => {
    const seen: unknown[] = [];
    const out = await freezeForSignSafely(
      async () => ({ frozen: 2, placeholders: 1, skipped: 4 }),
      (err) => seen.push(err),
    );
    expect(out).toEqual({ frozen: 2, placeholders: 1, skipped: 4 });
    expect(out.failed).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("turns a throw into the announced outcome and still logs the original error", async () => {
    const logged: unknown[] = [];
    const boom = new Error("socket hang up");
    const out = await freezeForSignSafely(
      async () => {
        throw boom;
      },
      (err) => logged.push(err),
    );
    expect(out).toMatchObject({ failed: true, error: "socket hang up" });
    expect(logged).toEqual([boom]);
  });

  it("never rethrows — a signed report is not undone by a lost picture", async () => {
    await expect(
      freezeForSignSafely(
        async () => {
          throw new Error("disk full");
        },
        () => {},
      ),
    ).resolves.toMatchObject({ failed: true });
  });
});

describe("frozenImageSignFailure", () => {
  it("keeps the sign's 201 contract additive — counts present, marked failed", () => {
    expect(frozenImageSignFailure(new Error("PACS unreachable"))).toEqual({
      frozen: 0,
      placeholders: 0,
      skipped: 0,
      failed: true,
      error: "PACS unreachable",
    });
  });

  it("carries the server's own sentence, so the desk repeats it rather than inventing one", () => {
    expect(frozenImageSignFailure(new Error("relation radiology_report_key_images does not exist")).error).toBe(
      "relation radiology_report_key_images does not exist",
    );
  });

  it("survives a thrown non-Error instead of producing an undefined message", () => {
    expect(frozenImageSignFailure("socket hang up").error).toBe("socket hang up");
    expect(frozenImageSignFailure(undefined).failed).toBe(true);
  });
});
