/**
 * The per-job reference-knowledge override lives in the job's own `validation_json`, which the
 * worker rewrites when the run settles. These cases pin that the rewrite keeps the decision, and
 * that a job which asked for nothing is written exactly the way it was before the field existed.
 *
 * RED BEFORE `withRagEnvelope`: the two settling writes were inline `JSON.stringify(…)` /
 * `validation ? JSON.stringify(validation) : null`, and both dropped the envelope — a completed,
 * failed or retried job kept its answer and lost the record of which reference-knowledge mode it
 * ran in and why. The "nothing asked, nothing changed" cases are the control that keeps this a
 * preservation fix rather than a shape change on the default path.
 */
import { describe, it, expect } from "vitest";
import {
  RAG_OVERRIDE_ENVELOPE_KEY,
  decodeRagOverrideEnvelope,
  encodeRagOverrideEnvelope,
  resolveRagOverride,
  withRagEnvelope,
} from "./types";

const OFF_HONOURED = resolveRagOverride("off", true);
const OFF_IGNORED = resolveRagOverride("off", false);

/** What the READY write puts in the column: the validation result plus the run's own account. */
const READY_BODY = {
  groundingOk: true,
  issues: [],
  provenance: { provider: "ollama", model: "qwen3:14b" },
  provider: "ollama",
  usage: { totalTokens: 1810 },
};

describe("withRagEnvelope — the settling writes keep the per-job decision", () => {
  it("a completed job still says reference knowledge ran OFF because it was asked to", () => {
    const queued = encodeRagOverrideEnvelope(OFF_HONOURED);
    const settled = withRagEnvelope(queued, READY_BODY);
    const parsed = JSON.parse(settled ?? "");
    expect(parsed.ragOverride).toEqual({
      requested: "off",
      effective: "off",
      honoured: true,
      ignoredReason: null,
      needsRecording: true,
    });
    // Nothing of the run's own account is lost by the merge.
    expect(parsed.provenance).toEqual(READY_BODY.provenance);
    expect(parsed.provider).toBe("ollama");
    expect(parsed.usage).toEqual(READY_BODY.usage);
    expect(parsed.groundingOk).toBe(true);
  });

  it("a failed job keeps the reason an override was ignored", () => {
    const queued = encodeRagOverrideEnvelope(OFF_IGNORED);
    const failed = withRagEnvelope(queued, {
      sourceIdentity: { refused: "compose_source_unlinked", message: "not linked" },
    });
    expect(JSON.parse(failed ?? "").ragOverride).toEqual({
      requested: "off",
      effective: "default",
      honoured: false,
      ignoredReason: "not authorized",
      needsRecording: true,
    });
  });

  it("a failure with no validation result is still a row that says what was asked", () => {
    // Before this write existed the column went NULL here, which is the case the trial actually
    // hit: `bad_stored_snapshot` and the identity refusals fail with no validation object, so an
    // override asked for in the request left no trace of itself anywhere.
    const queued = encodeRagOverrideEnvelope(OFF_HONOURED);
    const failed = withRagEnvelope(queued, undefined);
    expect(failed).not.toBeNull();
    expect(decodeRagOverrideEnvelope(failed)?.effective).toBe("off");
    expect(decodeRagOverrideEnvelope(failed)?.honoured).toBe(true);
  });

  it("the envelope read back off the settled row is the contract the run was given", () => {
    const settled = withRagEnvelope(encodeRagOverrideEnvelope(OFF_HONOURED), READY_BODY);
    // This is the second-chance read a retry or `process-now` makes on the same row.
    const again = decodeRagOverrideEnvelope(settled);
    expect(again).toEqual(OFF_HONOURED);
  });

  it("nothing was asked: the column is written exactly as it was before this field existed", () => {
    // Control arms. `needsRecording` is false for absent and for an explicit "default", so a
    // normal job gains no key at all and both writes stay byte-identical to the shipped ones.
    for (const raw of [undefined, "", "default", "  "]) {
      const envelope = encodeRagOverrideEnvelope(resolveRagOverride(raw, true));
      expect(envelope).toBeNull();
      expect(withRagEnvelope(envelope, READY_BODY)).toBe(JSON.stringify(READY_BODY));
      expect(withRagEnvelope(envelope, undefined)).toBe(null);
      expect(withRagEnvelope(envelope, null)).toBe(null);
      expect(withRagEnvelope(envelope, { a: 1 })).toBe('{"a":1}');
    }
  });

  it("a column that cannot be read behaves as no request, never as a crash", () => {
    for (const junk of [null, undefined, "", "{", "null", "[]", '{"ragOverride":7}', '{"ragOverride":{"effective":"maybe"}}']) {
      expect(withRagEnvelope(junk, READY_BODY)).toBe(JSON.stringify(READY_BODY));
    }
  });

  it("the merged key is the one documented key, and it never duplicates a stale envelope", () => {
    const settled = withRagEnvelope(
      JSON.stringify({ [RAG_OVERRIDE_ENVELOPE_KEY]: { ...OFF_HONOURED, effective: "on" } }),
      READY_BODY,
    );
    const parsed = JSON.parse(settled ?? "");
    expect(Object.keys(parsed).filter((k) => k === RAG_OVERRIDE_ENVELOPE_KEY)).toHaveLength(1);
    expect(parsed.ragOverride.effective).toBe("on");
  });
});
