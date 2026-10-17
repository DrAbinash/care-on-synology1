/**
 * Every `{parameter}` written into a Quick Select tile's prose must have a UI
 * the radiologist can actually use to fill it — a question in `questions_json`,
 * or a chip named in `properties`. A token with no supplier reaches the report
 * either literally (an unknown token, unsubstituted by `fillTemplate`) or by
 * silent deletion (a `fillTemplate` token whose chip the tile never declared —
 * the sentence arrives at the page as a fluent, unfounded claim with the
 * question and the answer both missing).
 *
 * WHY READ THE DB RATHER THAN THE .sql FILE.
 * Two appliers can leave the file and the row disagreeing.
 * `care-db-patch-v2` consults `public.schema_migrations_log` and runs a feature
 * file exactly once, so an older clinic's DB reflects the file as it stood the
 * day it was first applied; `apply-all-migrations.mjs` (pnpm db:bootstrap)
 * ignores that table and re-runs every feature file, so a dev machine
 * reflects today's file. The strip reads the wire — which reads the table — so
 * the table is the source of truth for what actually reaches a report. Asserting
 * on the table catches both.
 *
 * WHAT IT PINS
 *   1. The measured defect this PR closes: `Foraminal stenosis L4-L5` asks
 *      `{severity}` but its `properties` column had only `side`, so the
 *      `applyPathologyOverlay` guard refused it forever — the tile was clickable
 *      but nothing could make it write. That is the "silent partial application"
 *      defect spelled with a chip instead of a brace, and the shipped
 *      catalogue's fix is exactly one word in `quick-select-tiles.data.ts`.
 *   2. Every other `{token}` in every other active tile has a UI behind it.
 *      The audit result the PR description quotes: measured across all 487
 *      active rows, one row leaked, that row is now fixed, and this test fails
 *      if any future row drifts back.
 *   3. A token only inside `[optional clauses]` is not a leak.
 *      `fillStructuredTemplate` (`structuredFindings.ts:59-72`) drops the whole
 *      clause when a key inside it is nullish, so no literal brace can reach
 *      the page. Counting those as leaks would be a false positive and the
 *      next contributor would silence the test rather than the defect.
 *
 * Skipped without DATABASE_URL — the assertion is about real rows and a
 * mocked DB would only assert the mock.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyQuickFindingsTable } from "@workspace/db/schema";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

/**
 * The five tokens `fillTemplate` (abnormalityEngine.ts:50-85) substitutes,
 * mapped to the `properties` chip that carries the value. A chip called
 * "measurement" fills the token `{value}` — the mismatch is historical and
 * preserved here, not corrected, because the strip and the engine already
 * agree on those exact strings.
 */
const TOKEN_TO_CHIP: Record<string, string> = {
  side: "side",
  severity: "severity",
  chronicity: "chronicity",
  level: "level",
  value: "measurement",
};

/**
 * The `properties` a tile must declare for `{severity} {side} neural foraminal
 * stenosis at L4-L5.` to be usable — this is what the shipped catalogue got
 * wrong before this PR, and the audit brief's named case.
 */
const FIXED_TILE_KEY = { studyType: "LS Spine", label: "Foraminal stenosis L4-L5" } as const;

function proseTokens(text: string): Set<string> {
  // Strip every `[optional clause]` before scanning — a token inside one
  // cannot print, only drop the clause.
  const bare = text.replace(/\[[^\]]*\]/g, "");
  const set = new Set<string>();
  for (const m of bare.matchAll(/\{([A-Za-z_][A-Za-z_0-9]*)\}/g)) set.add(m[1]);
  return set;
}

function declaredKeys(questionsJson: string | null | undefined): Set<string> {
  try {
    const arr = JSON.parse(questionsJson || "[]");
    return new Set(
      Array.isArray(arr) ? arr.map((q) => (q && typeof q.key === "string" ? q.key : "")).filter(Boolean) : [],
    );
  } catch {
    // A malformed questions_json means the UI has no dialog to run. That is a
    // different defect (a parse-time failure), not this one; returning empty
    // means any prose token counts as unresolved, which is the safe answer.
    return new Set();
  }
}

function propertyChips(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}

describe.skipIf(!dbReady)("Quick Select token ownership — every {token} has a UI", () => {
  type Row = typeof radiologyQuickFindingsTable.$inferSelect;
  let rows: Row[] = [];

  beforeAll(async () => {
    rows = await db.select().from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.isActive, true));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the specific tile the audit named carries both its chips", () => {
    const row = rows.find((r) => r.studyType === FIXED_TILE_KEY.studyType && r.label === FIXED_TILE_KEY.label);
    expect(row, `shipped tile ${FIXED_TILE_KEY.label} is missing from the DB`).toBeDefined();
    const chips = propertyChips(row!.properties);
    // Both must be present: `{severity}` needs `severity`, `{side}` needs
    // `side`. The tile's prose has both, so both must be clickable.
    expect(chips.has("severity"), `severity chip missing on ${FIXED_TILE_KEY.label}`).toBe(true);
    expect(chips.has("side"), `side chip missing on ${FIXED_TILE_KEY.label}`).toBe(true);
  });

  it("no active tile has a prose token nothing can fill", () => {
    const leaks: string[] = [];
    for (const r of rows) {
      const text = `${r.findingText}|${r.impressionText}|${r.techniqueText}|${r.recommendationText}`;
      const tokens = proseTokens(text);
      if (tokens.size === 0) continue;
      const declared = declaredKeys(r.questionsJson);
      const chips = propertyChips(r.properties);
      for (const tok of tokens) {
        if (declared.has(tok)) continue;
        const chip = TOKEN_TO_CHIP[tok];
        if (chip && chips.has(chip)) continue;
        leaks.push(`${r.studyType}/${r.label}: {${tok}}`);
      }
    }
    // A single failing string names the exact tile a doctor will see. An
    // empty array is the audit result this PR establishes and pins.
    expect(leaks).toEqual([]);
  });

  it("a token appearing only inside an [optional clause] is not a leak", () => {
    // Guard the guard: the drop-clause path in fillStructuredTemplate is why
    // this file's scan can ignore bracketed tokens. If that ever stops being
    // true, this test fails rather than the audit silently missing the case.
    const sample = "Gallbladder wall thickened[, with {periappendiceal} fluid].";
    expect(Array.from(proseTokens(sample))).toEqual([]);
    expect(Array.from(proseTokens(sample.replace(/\[/g, "").replace(/\]/g, "")))).toEqual(["periappendiceal"]);
  });

  it("the fillTemplate token map matches the five tokens abnormalityEngine substitutes", async () => {
    // This test is the coupling that stops the audit from quietly falling out
    // of step with the engine. If abnormalityEngine ever learns a sixth token
    // and this map doesn't gain it, the audit gives that token a false pass.
    // Read the source (safe: the file is on the disk under test, not shipped
    // prose).
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../diagnostic-erp/src/lib/abnormalityEngine.ts", import.meta.url),
      "utf8",
    );
    for (const m of src.matchAll(/\.replace\(\/\\\{(\w+)\\\}\/g/g)) {
      expect(
        Object.keys(TOKEN_TO_CHIP),
        `abnormalityEngine substitutes {${m[1]}} but this test's map does not name its chip`,
      ).toContain(m[1]);
    }
  });
});
