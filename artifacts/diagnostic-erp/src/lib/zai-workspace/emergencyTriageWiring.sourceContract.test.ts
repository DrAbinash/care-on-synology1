/**
 * Source contracts — the workspace's triage ranking has ONE authority.
 *
 * The unit pins in studyPriority.test.ts cover the rank itself and
 * advanceTriage.behavior.test.ts covers the store's advance; these pins
 * guard the WIRING, so no surface can quietly re-invent a private
 * priority map with a tier missing or misranked (the emergency demotion,
 * #1167: three separate `{ stat: 0, urgent: 1, routine: 2, vip: 1 }`
 * maps — no emergency, vip tied with urgent — each one vote away from
 * the server's doctrine).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const NORMALIZER = "lib/zai-workspace/normalizeWorkspaceStudy.ts";
const TYPES = "lib/zai-workspace/types.ts";
const STORE = "lib/zai-workspace/store.ts";
const CLINICAL_UI = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const STRIP = "components/radiology/zai-workspace/worklist-strip.tsx";

describe("emergency triage — wiring (#1167)", () => {
  it("1. the Priority vocabulary includes the server's emergency tier", () => {
    expect(read(TYPES)).toContain('"emergency"');
  });

  it("2. the normalizer keeps emergency instead of folding it to routine", () => {
    const src = read(NORMALIZER);
    expect(src).toContain('"emergency"');
  });

  it("3. the workspace's two throughput rankings use the shared rank, not private maps", () => {
    const src = read(CLINICAL_UI);
    expect(src).toContain("studyPriorityRank");
    // The private map is gone from BOTH ranking effects (auto-open and the
    // 80% preload) — its presence anywhere in the hook is the regression.
    expect(src).not.toContain("{ stat: 0, urgent: 1, routine: 2, vip: 1 }");
    expect(src).not.toContain("pr[a.priority]");
  });

  it("4. the store's advance uses the shared rank", () => {
    const src = read(STORE);
    expect(src).toContain("studyPriorityRank");
    expect(src).not.toContain("{ stat: 0, urgent: 1, routine: 2, vip: 1 }");
  });

  it("5. the reading-queue strip can badge an emergency row (no routine fallback)", () => {
    const src = read(STRIP);
    expect(src).toMatch(/emergency:\s*\{\s*l:\s*"EMERGENCY"/);
  });
});
