/**
 * F3 — the reason a draft job failed has to reach the browser.
 *
 * Measured 2026-11-01 on the clinic's own Ollama: a job against
 * `http://192.168.1.250:11434` while `ollama_local_only` was off went `FAILED` in
 * about 2 ms. Nothing was written to the report, which is correct — that setting
 * is a privacy control, not a bug. What was missing was proof that the operator can
 * see WHY. `safeError` carries the code (`composer_endpoint_blocked`), and the
 * sentence beside it is `validation.provenance.degradedReason`, which the SSRF
 * guard writes for a clinician: it names the switch to turn and where to find it.
 *
 * Both already reach `publicJobView`, and `ReportComposerAssistant` already renders
 * them (`ai-compose-failed`, `ai-compose-failure-reason`) — this file pins the seam
 * rather than changing it.
 *
 * Why the seam and not the component: `artifacts/diagnostic-erp/tsconfig.json` sets
 * `"jsx": "preserve"`, so a `.tsx` imported from a Vitest test transpiles to
 * `React.createElement` with no React in scope and dies at render. No component in
 * this repo is render-tested, and a test that passes only in a scratch config with
 * the automatic JSX runtime forced on would be evidence about my rig, not about the
 * clinic. The data path below is what the panel reads; the panel's own markup has
 * not been render-verified, and the PR report says so rather than implying it was.
 */
import { describe, expect, it } from "vitest";
import {
  composeDegradedReason,
  isDeterministicComposeFallback,
} from "./types";

describe("a failed composer job's reason survives to the browser", () => {
  it("F3-1 the endpoint refusal keeps the guard's actionable sentence", () => {
    // The shape `failJob` persists: safeError as the column, provenance inside
    // validation_json. Written verbatim from the job row this was measured on.
    const job = {
      validation: {
        ok: false,
        errors: [],
        warnings: [],
        provenance: {
          aiMode: "TEXT_ONLY",
          provider: "ollama",
          fallbackUsed: false,
          degradedReason:
            'Private/LAN addresses require "Local / LAN mode" to be enabled in Settings → Radiology → AI Assistant (192.168.1.250)',
        },
      },
    };
    const reason = composeDegradedReason(job);
    expect(reason).toMatch(/Local \/ LAN mode/);
    expect(reason).toContain("192.168.1.250");
  });

  it("F3-2 a job that failed with no reason attached yields empty, not undefined text", () => {
    // The panel branches on this string being non-empty; a stray "undefined" in a
    // clinician's error line would be read as a new failure.
    expect(composeDegradedReason({ validation: { provenance: { degradedReason: null } } })).toBe("");
    expect(composeDegradedReason({ validation: null })).toBe("");
    expect(composeDegradedReason(null)).toBe("");
  });

  /**
   * The field the browser reads is the field the SERVER writes, so the sanitize
   * rule lives on that side: a code plus a sentence CARE itself authored. The
   * server-side owner is `deterministicFallbackReason` and its suite
   * (`composeDisplay.test.ts` in api-server), which pins that a failure never
   * reaches the clinician as a bare code.
   */
  it("F3-3 a fallback draft's reason and a failure's reason are the same field", () => {
    // One owner for "why is this answer not from the model" — the fallback banner
    // and the failure line must not read two different places and disagree.
    const job = {
      validation: {
        provenance: {
          fallbackUsed: true,
          provider: "deterministic",
          degradedReason: "Local AI is switched off in Settings, so nothing was sent to a model.",
        },
      },
    };
    expect(composeDegradedReason(job)).toBe(
      "Local AI is switched off in Settings, so nothing was sent to a model.",
    );
    expect(isDeterministicComposeFallback(job as never)).toBe(true);
  });
});
