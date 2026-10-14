import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, NetworkError } from "./fetchApi";
import {
  classifyHopeDeliveryError,
  classifyHopeDeliveryResponse,
  hopeDeliveryToast,
  type HopeEmitRefusal,
  type HopeEmitSuccess,
} from "./hopeDeliveryOutcome";

const refusal = (body: HopeEmitRefusal) => body;
const success = (body: Partial<HopeEmitSuccess> & { ok: true }) => body;

describe("classifyHopeDeliveryResponse — the nine delivery outcomes", () => {
  it("1. Hope accepted the report => delivered, and only then", () => {
    const o = classifyHopeDeliveryResponse(success({ dispatched: { sent: 1, failed: 0 } }));
    expect(o.kind).toBe("delivered");
    expect(o.title).toBe("Sent to Hope");
    expect(o.destructive).toBe(false);
  });

  it("2. no HOPE referral => benign, and says nothing at all", () => {
    const o = classifyHopeDeliveryResponse(
      refusal({ ok: false, code: "NO_REFERRAL", error: "No Hope referral linked to this study/order." }),
    );
    // A CARE study that is not a Hope prescription is the ordinary case. Toasting it on
    // every sign would train radiologists to ignore the one message that matters.
    expect(o.kind).toBe("absent");
    expect(o.title).toBeNull();
    expect(o.description).toBeNull();
    expect(o.destructive).toBe(false);
  });

  it("7. permanent rejection (enqueue transaction failed) => visible failure", () => {
    const o = classifyHopeDeliveryResponse(
      refusal({ ok: false, code: "EMIT_FAILED", error: "Failed to send report to Hope" }),
    );
    // This is the outcome the old empty catch swallowed, and the reason this PR exists.
    expect(o.kind).toBe("failed");
    expect(o.destructive).toBe(true);
    expect(o.title).toContain("not sent");
    expect(o.description).toContain("Failed to send report to Hope");
  });

  it("6. wrong study/report association => the server's own sentence survives", () => {
    const sentence =
      "Refusing to send to Hope: the only report linked to this study belongs to a different patient than worklist 42 (patient 7). Resolve the study-to-report link before delivering.";
    const o = classifyHopeDeliveryResponse(refusal({ ok: false, code: "NOT_FOUND", error: sentence }));
    expect(o.kind).toBe("failed");
    expect(o.description).toContain(sentence);
    expect(o.description).toContain("signed and stays in CARE");
  });

  it("8/9. duplicate delivery attempt is not reported as a fresh send", () => {
    const o = classifyHopeDeliveryResponse(
      success({ alreadySent: true, emitted: false, dispatched: { sent: 1, failed: 0 } }),
    );
    expect(o.kind).toBe("delivered");
    expect(o.title).toBe("Already on Hope");
  });

  it("never claims delivery when dispatch sent nothing", () => {
    const o = classifyHopeDeliveryResponse(success({ dispatched: { sent: 0, failed: 1 } }));
    expect(o.kind).toBe("pending");
    expect(o.title).not.toMatch(/sent to hope/i);
    expect((o.title ?? "") + (o.description ?? "")).not.toMatch(/available on hope/i);
    expect(o.destructive).toBe(false);
  });

  it("ok:true with no dispatch evidence is queued, not delivered", () => {
    const o = classifyHopeDeliveryResponse(success({}));
    expect(o.kind).toBe("pending");
    expect(o.title).not.toBe("Sent to Hope");
  });

  it("an unknown refusal code still surfaces, and is not silently benign", () => {
    const o = classifyHopeDeliveryResponse(refusal({ ok: false, code: "SIGNING_SECRET_ROTATED" }));
    expect(o.kind).toBe("failed");
    expect(o.destructive).toBe(true);
  });

  it("a refusal body that did not throw classifies the same as one that did", () => {
    // Guards the trap this module deliberately avoids: a fabricated error object is not
    // `instanceof HttpError`, so a code-driven path cannot be shared by faking one.
    const thrown = classifyHopeDeliveryError(
      new HttpError("No Hope referral", 409, { ok: false, code: "NO_REFERRAL" }),
    );
    const resolved = classifyHopeDeliveryResponse(refusal({ ok: false, code: "NO_REFERRAL" }));
    expect(resolved).toEqual(thrown);
    expect(resolved.kind).toBe("absent");
  });
});

describe("classifyHopeDeliveryError — transport outcomes", () => {
  it("3/4. server unreachable is pending, because reconcile re-emits it", () => {
    const o = classifyHopeDeliveryError(new NetworkError("Server not responding"));
    expect(o.kind).toBe("pending");
    expect(o.destructive).toBe(false);
    // Must not claim the report is on Hope.
    expect((o.title ?? "") + (o.description ?? "")).not.toMatch(/available on hope/i);
    expect(o.description).toMatch(/retry/i);
  });

  it("5. authentication failure is a visible failure, not a benign absence", () => {
    const o = classifyHopeDeliveryError(
      new HttpError("invalid or expired staff session", 401, { ok: false, code: "NOT_FOUND" }),
    );
    expect(o.kind).toBe("failed");
    expect(o.destructive).toBe(true);
  });

  it("a 409 refusal keeps its code even though the transport threw", () => {
    const o = classifyHopeDeliveryError(
      new HttpError("No Hope referral linked", 409, {
        ok: false,
        code: "NO_REFERRAL",
        error: "No Hope referral linked to this study/order.",
      }),
    );
    expect(o.kind).toBe("absent");
    expect(o.title).toBeNull();
  });

  it("an HttpError with an unparseable body is still a failure, never a silence", () => {
    const o = classifyHopeDeliveryError(new HttpError("Gateway", 500, undefined));
    expect(o.kind).toBe("failed");
    expect(o.destructive).toBe(true);
    expect(o.description).toContain("HTTP 500");
  });

  it("a non-Error throw does not vanish", () => {
    const o = classifyHopeDeliveryError("boom");
    expect(o.kind).toBe("failed");
    expect(o.destructive).toBe(true);
  });

  it("signing is never described as failing when only delivery did", () => {
    for (const body of [
      refusal({ ok: false, code: "EMIT_FAILED", error: "Failed to send report to Hope" }),
      refusal({ ok: false, code: "NOT_SIGNED", error: "Finalize and sign first" }),
    ]) {
      const o = classifyHopeDeliveryResponse(body);
      expect(o.title).toMatch(/Signed/i);
    }
  });
});

// ── The mapping from outcome to what the radiologist actually sees ────────────
//
// Without these, classification could be perfect and the defect still live: inverting
// `hopeDeliveryToast` to return null for every real outcome re-silences the whole
// feature and was measured GREEN until this block existed.
describe("hopeDeliveryToast — an outcome must reach the screen or be deliberately silent", () => {
  const ALL: Array<[string, unknown]> = [
    ["EMIT_FAILED", refusal({ ok: false, code: "EMIT_FAILED", error: "Failed to send report to Hope" })],
    ["NOT_FOUND cross-patient", refusal({ ok: false, code: "NOT_FOUND", error: "belongs to a different patient" })],
    ["NOT_SIGNED", refusal({ ok: false, code: "NOT_SIGNED", error: "Finalize and sign first" })],
    ["unknown code", refusal({ ok: false, code: "WHATEVER" })],
    ["dispatch failed", success({ dispatched: { sent: 0, failed: 2 } })],
    ["dispatch sent", success({ dispatched: { sent: 1, failed: 0 } })],
    ["no dispatch evidence", success({})],
  ];

  it("every outcome that is not a deliberate absence renders a toast", () => {
    for (const [label, body] of ALL) {
      const outcome = classifyHopeDeliveryResponse(body);
      const msg = hopeDeliveryToast(outcome);
      expect(msg, label).not.toBeNull();
      expect(msg?.title, label).toBeTruthy();
    }
  });

  it("a genuine failure renders destructively", () => {
    for (const [label, body] of ALL.filter(([l]) => !/sent|no dispatch/.test(l))) {
      const outcome = classifyHopeDeliveryResponse(body);
      if (outcome.kind !== "failed") continue;
      const msg = hopeDeliveryToast(outcome);
      expect(msg, label).not.toBeNull();
      expect(msg?.variant, label).toBe("destructive");
      expect(msg?.duration, label).toBeGreaterThan(2500);
    }
  });

  it("the benign no-referral case is the ONLY thing allowed to be silent", () => {
    const absent = classifyHopeDeliveryResponse(refusal({ ok: false, code: "NO_REFERRAL" }));
    expect(absent.kind).toBe("absent");
    expect(hopeDeliveryToast(absent)).toBeNull();

    // And nothing classified failed may ever be silent — that is the swallow re-born.
    for (const [, body] of ALL) {
      const outcome = classifyHopeDeliveryResponse(body);
      if (outcome.kind === "failed") expect(hopeDeliveryToast(outcome)).not.toBeNull();
    }
  });

  it("success and pending never read as destructive", () => {
    for (const body of [
      success({ dispatched: { sent: 1, failed: 0 } }),
      success({ dispatched: { sent: 0, failed: 1 } }),
    ]) {
      const msg = hopeDeliveryToast(classifyHopeDeliveryResponse(body));
      expect(msg?.variant).toBe("default");
    }
  });

  it("a network failure is reported without alarming, and never as a sign failure", () => {
    const msg = hopeDeliveryToast(classifyHopeDeliveryError(new NetworkError("unreachable")));
    expect(msg).not.toBeNull();
    expect(msg?.variant).toBe("default");
    expect(msg?.title).toMatch(/Signed/i);
  });
});

// ── Wiring: the call site must actually use the classifier ────────────────────
//
// The pure module can be perfect and the defect still live, because the defect is a
// `.catch(() => {})`. These assertions are scoped to the Hope-push block and comments
// are stripped first: `setDemographyOverrides`-style experience says a raw whole-file
// match passes on defective code, and here the old block's own explanatory comment
// literally contains the word "silent".
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), "utf8").replace(/\r\n/g, "\n");
const FINALIZE_SRC = read("../hooks/radiology-workspace/useStudyFinalize.ts");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.replace(/\/\/[^\n]*$/g, ""))
    .join("\n");
}

/** Brace-matched block starting at the first `{` after `marker`. */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at === -1) throw new Error(`marker not found: ${marker}`);
  const open = src.indexOf("{", at);
  if (open === -1) throw new Error(`no block after: ${marker}`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced block after: ${marker}`);
}

const hopeBlock = stripComments(blockAfter(FINALIZE_SRC, "if (!finalizeResult.idempotent && finalizeResult.signed"));

describe("useStudyFinalize — HOPE push wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extracted the Hope push block, not the whole file", () => {
    expect(hopeBlock).toContain("send-report-to-hope");
    expect(hopeBlock.length).toBeGreaterThan(60);
    // Must not have bled into the critical-acknowledgement step that follows it.
    expect(hopeBlock).not.toContain("acknowledge-critical");
  });

  it("RED-UNTIL-WIRED: the empty catch is gone", () => {
    // The swallow is `.catch(() => { ... })` — a catch arm taking NO error argument.
    // Testing for an empty brace body does not work here: `catch\s*\(\s*\)` expects
    // `catch()`, while the real text is `catch(()`, so the pattern never matched even
    // on the defective code. A handler that receives the error is the signal.
    expect(hopeBlock).not.toMatch(/\.catch\s*\(\s*\(\s*\)\s*=>/);
    expect(hopeBlock).toMatch(/\.catch\s*\(\s*\(\s*\w+\s*\)\s*=>/);
  });

  it("RED-UNTIL-WIRED: both response and error outcomes are classified", () => {
    expect(hopeBlock).toMatch(/classifyHopeDeliveryResponse/);
    expect(hopeBlock).toMatch(/classifyHopeDeliveryError/);
  });

  it("the success wording no longer lives at the call site", () => {
    // It moved into the classifier, which is the only place allowed to decide that Hope
    // has the report. A second copy here is how enqueue starts reading as delivery.
    expect(hopeBlock).not.toContain('"Sent to Hope"');
    expect(hopeBlock).not.toContain("available on Hope");
  });

  it("the classifier module is imported, not inlined", () => {
    expect(FINALIZE_SRC).toMatch(/from "@\/lib\/hopeDeliveryOutcome"/);
  });
});
