import { describe, expect, it } from "vitest";
import { HttpError, RateLimitedError } from "./fetchApi";
import {
  frozenKeyImageRailState,
  keyImageRailShouldMount,
  type RailReadState,
} from "./frozenKeyImageRailState";

const base = {
  draftId: 292,
  draftPending: false,
  draftError: undefined,
  imagesPending: false,
  imagesError: undefined,
  itemCount: 0,
};

const kinds: RailReadState["kind"][] = ["images", "loading", "rate-limited", "read-failed", "empty"];

describe("frozenKeyImageRailState — the anti-lie rule", () => {
  it("says nothing is attached only when a read answered 'none'", () => {
    expect(frozenKeyImageRailState(base).kind).toBe("empty");
  });

  it("never says 'empty' while a read is in flight", () => {
    const pending = [
      frozenKeyImageRailState({ ...base, draftPending: true }),
      frozenKeyImageRailState({ ...base, draftId: null, draftPending: true }),
      frozenKeyImageRailState({ ...base, imagesPending: true }),
    ];
    for (const s of pending) expect(s.kind).not.toBe("empty");
    expect(pending.map((s) => s.kind)).toEqual(["loading", "loading", "loading"]);
  });

  it("never says 'empty' when a read failed — the study may be full of images", () => {
    for (const err of [new RateLimitedError("busy", 60_000), new HttpError("boom", 500)]) {
      expect(frozenKeyImageRailState({ ...base, draftError: err }).kind).not.toBe("empty");
      expect(frozenKeyImageRailState({ ...base, imagesError: err }).kind).not.toBe("empty");
    }
  });

  it("calls a 429 a wait, with the server's own number", () => {
    const s = frozenKeyImageRailState({ ...base, imagesError: new RateLimitedError("busy", 45_000) });
    expect(s).toEqual({ kind: "rate-limited", waitSeconds: 45 });
    const viaDraft = frozenKeyImageRailState({ ...base, draftError: new RateLimitedError("busy", null) });
    expect(viaDraft).toEqual({ kind: "rate-limited", waitSeconds: 60 });
  });

  it("keeps images already on screen when the refresh behind them fails", () => {
    // This is the difference between a radiologist re-attaching pictures they
    // already have and trusting the strip.
    const s = frozenKeyImageRailState({
      ...base,
      itemCount: 14,
      imagesError: new RateLimitedError("busy", 60_000),
      imagesPending: true,
    });
    expect(s).toEqual({ kind: "images", count: 14 });
  });

  it("prefers a failed anchor read over a failed images read", () => {
    const s = frozenKeyImageRailState({
      ...base,
      draftError: new RateLimitedError("busy", 30_000),
      imagesError: new HttpError("boom", 500),
    });
    expect(s).toEqual({ kind: "rate-limited", waitSeconds: 30 });
  });

  it("treats an answered anchor of null as a study with no draft yet", () => {
    expect(frozenKeyImageRailState({ ...base, draftId: null }).kind).toBe("empty");
  });

  it("returns one of the known states for every combination", () => {
    for (const draftId of [null, 292]) {
      for (const draftPending of [false, true]) {
        for (const draftError of [undefined, new RateLimitedError("busy", 60_000)]) {
          for (const itemCount of [0, 3]) {
            const s = frozenKeyImageRailState({ ...base, draftId, draftPending, draftError, itemCount });
            expect(kinds).toContain(s.kind);
            if (itemCount > 0) expect(s.kind).toBe("images");
            if (draftError && itemCount === 0) expect(s.kind).toBe("rate-limited");
          }
        }
      }
    }
  });
});

describe("keyImageRailShouldMount", () => {
  it("mounts on the study opened in the URL, which is known before any request", () => {
    expect(keyImageRailShouldMount(392)).toBe(true);
    expect(keyImageRailShouldMount("392")).toBe(true);
  });

  it("does not mount without an anchor", () => {
    for (const v of [null, undefined, 0, -1, NaN, "abc", {}]) {
      expect(keyImageRailShouldMount(v)).toBe(false);
    }
  });
});
