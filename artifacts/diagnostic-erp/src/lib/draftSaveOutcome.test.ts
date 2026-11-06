import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRAFT_REVISION_CONFLICT,
  LOCKED_BY_OTHER,
  draftSaveOutcome,
  draftSaveRefusalCode,
} from "./draftSaveOutcome";

/**
 * The dirty flag is what re-arms the 30s autosave, so clearing it on a partial
 * save is what turns a recoverable write failure into permanent silent loss.
 * These pin that decision; the server contract behind it is pinned in
 * radiology-report-generator.formatState.test.ts.
 */

describe("draftSaveOutcome", () => {
  it("clears dirty and reports saved on a clean save", () => {
    const outcome = draftSaveOutcome({
      success: true,
      draft: { id: 101 },
      structuredJsonPersistFailed: false,
    });
    expect(outcome).toEqual({ id: 101, clearDirty: true, status: "saved", notice: "saved" });
  });

  it("keeps the study dirty when the envelope failed, but still returns the id", () => {
    const outcome = draftSaveOutcome({
      success: true,
      draft: { id: 101 },
      structuredJsonPersistFailed: true,
    });
    // id survives so the next save updates this row instead of inserting a
    // second draft, and so a partial save never blocks leaving the study —
    // the narrative text did commit.
    expect(outcome.id).toBe(101);
    expect(outcome.clearDirty).toBe(false);
    expect(outcome.status).toBe("error");
    expect(outcome.notice).toBe("partial");
  });

  it("reads the id from either response shape", () => {
    expect(draftSaveOutcome({ draft: { id: 7 } }).id).toBe(7);
    expect(draftSaveOutcome({ id: 9 }).id).toBe(9);
    expect(draftSaveOutcome({ draft: { id: 7 }, id: 9 }).id).toBe(7);
  });

  it("never clears dirty when there is no id to remember", () => {
    expect(draftSaveOutcome({ success: true }).clearDirty).toBe(false);
    expect(draftSaveOutcome(null).clearDirty).toBe(false);
    expect(draftSaveOutcome(undefined).clearDirty).toBe(false);
    expect(draftSaveOutcome({}).id).toBeNull();
  });

  it("treats a missing flag as success, so older responses keep working", () => {
    // The flag is new; a response without it must behave exactly as before.
    expect(draftSaveOutcome({ draft: { id: 3 } }).notice).toBe("saved");
    expect(draftSaveOutcome({ draft: { id: 3 } }).clearDirty).toBe(true);
  });

  it("does not read a falsy-but-present flag as a failure", () => {
    expect(draftSaveOutcome({ draft: { id: 3 }, structuredJsonPersistFailed: false }).clearDirty)
      .toBe(true);
  });
});

describe("draftSaveRefusalCode — a refusal is not a failure", () => {
  // P0-2. Built from the shape `fetchApi` actually throws
  // (`HttpError(message, status, details)` where details is the parsed body), not
  // from a hand-written error of convenience: a test that invents its own error
  // shape stays green while the real transport delivers something else.
  const httpError = (status: number, body: unknown) => {
    const err = new Error("server said") as Error & { status: number; details?: unknown };
    err.name = "HttpError";
    err.status = status;
    err.details = body;
    return err;
  };

  it("reads the code out of a 409 the server refused", () => {
    expect(draftSaveRefusalCode(httpError(409, {
      success: false,
      error: "DRAFT_REVISION_CONFLICT",
      code: "DRAFT_REVISION_CONFLICT",
      message: "The saved report changed since this editor last read it.",
    }))).toBe(DRAFT_REVISION_CONFLICT);
  });

  it("is null for a genuine failure, whatever its shape", () => {
    expect(draftSaveRefusalCode(httpError(500, { code: "DRAFT_REVISION_CONFLICT" })))
      .toBeNull();
    // A network error carries no status and no body: nothing was refused, because
    // nothing was answered.
    expect(draftSaveRefusalCode(new Error("Server not responding"))).toBeNull();
    expect(draftSaveRefusalCode(undefined)).toBeNull();
  });

  it("is null for a 409 that names no code, so an unknown refusal is not dressed up", () => {
    expect(draftSaveRefusalCode(httpError(409, { error: "SOMETHING_UNRECOGNISED", message: "…" })))
      .toBeNull();
    expect(draftSaveRefusalCode(httpError(409, "not json"))).toBeNull();
  });

  it("names a locked study the moment the refusal carries its code", () => {
    // The shape `POST /save-draft` answers with when another radiologist holds
    // the write lock. `error` alone used to be the whole body, which the client
    // could not tell from a failure — see the route contract below.
    expect(draftSaveRefusalCode(httpError(409, {
      error: "LOCKED_BY_OTHER",
      code: "LOCKED_BY_OTHER",
      lockedBy: "Dr Other Console",
      message: "This study is currently being reported by Dr Other Console.",
    }))).toBe(LOCKED_BY_OTHER);
  });

  it("does not mistake the signed-report refusal for a revision conflict", () => {
    expect(draftSaveRefusalCode(httpError(409, { code: "REPORT_LOCKED" }))).toBe("REPORT_LOCKED");
    expect(draftSaveRefusalCode(httpError(409, { code: "REPORT_LOCKED" }))).not.toBe(DRAFT_REVISION_CONFLICT);
  });
});

/**
 * The server half of the same contract. Four routes refuse a write that another
 * user's study lock blocks; the client can only classify a refusal it can name,
 * and three of the four bodies carried `error` without `code`. A behavioural
 * request test would need a locked worklist row, a staff session and a draft, so
 * this pins the invariant the routes share — every body that names the error also
 * names the code — and `useDraftPersistence.behavior.test.ts` proves the client
 * acts on the wire shape this produces.
 */
describe("the server's lock refusal carries the code this client classifies", () => {
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, "..", "..", "..", "api-server", "src", rel), "utf8");
  const ROUTES = [
    "routes/radiology-report-generator.ts",
    "routes/internal-radiology.ts",
  ];

  for (const route of ROUTES) {
    it(`${route}: every LOCKED_BY_OTHER refusal names its code`, () => {
      const src = read(route);
      const errors = (src.match(/error:\s*"LOCKED_BY_OTHER"/g) ?? []).length;
      const codes = (src.match(/code:\s*"LOCKED_BY_OTHER"/g) ?? []).length;
      expect(errors, "the route still refuses locked writes").toBeGreaterThan(0);
      expect(codes, `${errors} refusals name the error, ${codes} name the code`).toBe(errors);
    });
  }

  it("both sides spell the code identically", () => {
    const spelled = read("routes/radiology-report-generator.ts").includes(`code: "${LOCKED_BY_OTHER}"`);
    expect(spelled, "the constant the client reads is the literal the server writes").toBe(true);
  });
});
