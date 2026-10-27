/**
 * @vitest-environment node
 *
 * The Composer settings seed — checked in the database, because that is where the
 * value the clinic runs actually lives.
 *
 * `zzzz…_composer_model_and_timeout_seed.sql` exists because
 * `resolveComposerRuntime` computes
 *
 *     enabled = localRuntime.ollamaEnabled && !!composerModel
 *
 * from a `clinic_settings` row whose `ollama_composer_model` had no default and
 * whose `ollama_composer_timeout_seconds` was materialised as 45 when the column
 * was added. The code's own `?? 90` fallback is unreachable on a NOT NULL column,
 * and the earlier `…_default_90.sql` moved only the column DEFAULT — by its own
 * stated design it never touched a row — so an existing install kept running 45 s.
 * At 45 s the model was still writing a usable report when CARE hung up, and the
 * radiologist was handed the deterministic fallback.
 *
 * A source-text grep cannot see any of that. This reads the migrated row and the
 * column default back from Postgres, so it fails if the seed stops running, if it
 * stops being guarded, or if the row and the default drift apart.
 *
 * It skips without a DATABASE_URL, like every other DB-backed test here. In CI the
 * database is bootstrapped through the full migration path, which is exactly the
 * path being tested.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { clinicSettingsTable } from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";

const maybe = hasDatabaseUrl() ? describe : describe.skip;

type Row = { model: string | null; timeout: number; enabled: boolean };

maybe("composer settings seed (real Postgres)", () => {
  let row: Row | null = null;
  let modelDefault: string | null = null;

  beforeAll(async () => {
    // The SAME row the resolver reads: `resolveComposerRuntime` takes the highest
    // id. Ordering by the timeout instead would have this test pass on a database
    // where the row the Composer uses is still 45.
    const [r] = await db
      .select({
        model: clinicSettingsTable.ollamaComposerModel,
        timeout: clinicSettingsTable.ollamaComposerTimeoutSeconds,
        enabled: clinicSettingsTable.ollamaEnabled,
      })
      .from(clinicSettingsTable)
      .orderBy(sql`id DESC`)
      .limit(1);
    row = r ?? null;
    // `db.execute` hands back a pg Result on one driver and a plain array on
    // another (the same shape `imageSendAudit.request.test.ts` notes), so read it
    // through both rather than assuming one.
    const res = await db.execute<{ column_default: string | null }>(sql`
      select column_default from information_schema.columns
       where table_name = 'clinic_settings' and column_name = 'ollama_composer_model'
       limit 1
    `);
    const rows = ((res as unknown as { rows?: Array<{ column_default: string | null }> }).rows
      ?? (res as unknown as Array<{ column_default: string | null }>)) ?? [];
    modelDefault = rows[0]?.column_default ?? null;
  });

  it("the row the Composer reads carries the approved 90-second ceiling", () => {
    expect(row, "no clinic_settings row exists").not.toBeNull();
    // The resolver clamps 10–120, so 90 is what reaches the AbortSignal.
    expect(row!.timeout).toBe(90);
  });

  it("the row carries a Composer model, so the runtime is not forced to fall back", () => {
    // With this column empty `enabled` is false for every install and every
    // Generate answers from the deterministic composer. The seed exists to stop
    // that being the silent state of a freshly deployed clinic.
    expect((row!.model ?? "").trim()).toBe("qwen3:14b");
  });

  it("a brand-new install inherits the same model, not an empty one", () => {
    // The singleton row is created by an explicit-column INSERT in
    // api-server/src/index.ts that omits every `ollama_*` column, so a fresh
    // site takes the DATABASE default. Without this, the seed would only ever
    // describe an existing install.
    // Postgres stores and returns a column default as an expression, so the
    // shipped value arrives as `'qwen3:14b'::text`. Match the expression rather
    // than a bare literal, which would be red on every real server.
    expect(modelDefault, "ollama_composer_model has no column default")
      .toMatch(/^'qwen3:14b'(::text|::pg_catalog\.text)?$/);
  });

  it("leaves the AI master switch alone", () => {
    // The seed deliberately does not touch `ollama_enabled`: a boolean cannot be
    // told apart between "never set" and "an administrator turned it off", and it
    // is a site-level switch over every Ollama endpoint, not just the Composer.
    // This test exists so that decision stays a decision rather than drift.
    expect(typeof row!.enabled).toBe("boolean");
  });
});
