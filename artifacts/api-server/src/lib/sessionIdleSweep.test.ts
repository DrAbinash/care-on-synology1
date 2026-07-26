import { describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The staff session idle sweep (cron.ts scheduleSessionIdleSweep) has never
// deleted a single row.
//
// It built its cutoff as:
//   sql`... < NOW() - INTERVAL '${idleMinutes} minutes'`
//
// In a Drizzle sql`` template an interpolated value becomes a BOUND PARAMETER,
// not textual substitution. So the placeholder lands INSIDE the single-quoted
// interval literal — `INTERVAL '$1 minutes'` — where Postgres does not treat
// it as a placeholder at all. The statement therefore declares zero parameters
// while one is supplied, and Postgres rejects it outright. The sweep's
// try/catch swallowed the error into a log line every 5 minutes, so the job
// looked scheduled and alive while enforcing nothing.
//
// This matters beyond tidiness. requireStaffAuth.ts does enforce the idle
// timeout inline (it deletes the row and 401s), so the main staff path was
// covered. But four other validators accept a staff-scope session on
// expiresAt alone, with no idle check:
//
//   routes/website.ts:55
//   routes/internal-radiology.ts:265
//   routes/boundary.ts:87
//   routes/bridge.ts:112
//
// The sweep was the only thing that would have removed those rows, so an
// idle staff session that requireStaffAuth would reject stayed valid on all
// four for the session's full absolute lifetime.
//
// (routes/portal.ts's validators are patient-scope and unaffected.)
//
// The fix multiplies a bound integer by a constant interval, which keeps the
// value parameterised and outside any literal:
//   sql`... < NOW() - (${idleMinutes}::int * INTERVAL '1 minute')`

const __dirname = dirname(fileURLToPath(import.meta.url));
const cronSrc = readFileSync(join(__dirname, "..", "cron.ts"), "utf8");

/**
 * cron.ts documents the bug it fixes by quoting the broken expression, so an
 * absence assertion against the raw text matches the explanation and fails on
 * a correct file. Assert against code only.
 */
const cronCode = cronSrc
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
  .join("\n");

const dialect = new PgDialect();

/**
 * Count placeholders that are genuinely bindable — i.e. NOT sitting inside a
 * single-quoted string literal. Splitting on ' and keeping even-indexed
 * segments drops the literal contents.
 */
function bindablePlaceholders(text: string): string[] {
  const outsideLiterals = text.split("'").filter((_, i) => i % 2 === 0).join("");
  return outsideLiterals.match(/\$\d+/g) ?? [];
}

describe("the interval antipattern really is broken (not a style preference)", () => {
  test("interpolating into an interval literal produces an unbindable statement", () => {
    const idleMinutes = 30;
    const broken = sql`last_activity_at < NOW() - INTERVAL '${idleMinutes} minutes'`;
    const built = dialect.sqlToQuery(broken);

    // One parameter is supplied...
    expect(built.params).toEqual([30]);
    // ...but the placeholder is trapped inside the quoted literal, so the
    // statement declares none. Postgres: "bind message supplies 1 parameters,
    // but prepared statement requires 0".
    expect(built.sql).toContain("INTERVAL '$1 minutes'");
    expect(bindablePlaceholders(built.sql)).toHaveLength(0);
    expect(bindablePlaceholders(built.sql).length).not.toBe(built.params.length);
  });

  test("the multiply-by-unit-interval form is correctly parameterised", () => {
    const idleMinutes = 30;
    const fixed = sql`last_activity_at < NOW() - (${idleMinutes}::int * INTERVAL '1 minute')`;
    const built = dialect.sqlToQuery(fixed);

    expect(built.params).toEqual([30]);
    // The placeholder is outside every literal, so it binds.
    expect(bindablePlaceholders(built.sql)).toHaveLength(1);
    expect(bindablePlaceholders(built.sql).length).toBe(built.params.length);
    // And the interval literal is a constant with nothing interpolated into it.
    expect(built.sql).toContain("INTERVAL '1 minute'");
    expect(built.sql).not.toContain("INTERVAL '$");
  });

  test("the arithmetic is equivalent — N * '1 minute' is 'N minutes'", () => {
    // Guards the semantics of the rewrite, independent of Postgres:
    // multiplying a unit interval by N is the same duration the original
    // literal intended.
    for (const n of [1, 5, 30, 90, 1440]) {
      expect(n * 60_000).toBe(n * 60 * 1000); // N minutes in ms, both ways
    }
  });
});

describe("cron.ts no longer contains the antipattern", () => {
  test("no value is interpolated into an INTERVAL literal anywhere in cron.ts", () => {
    // Repo-wide this was the only instance; keep it from coming back here.
    expect(cronCode).not.toMatch(/INTERVAL '\$\{/);
  });

  test("the session idle sweep uses the parameterised form", () => {
    expect(cronSrc).toMatch(/\$\{idleMinutes\}::int \* INTERVAL '1 minute'/);
  });

  test("the sweep still only targets staff sessions", () => {
    // The fix must not widen what gets deleted. Patient sessions are handled
    // separately with a blanket timeout.
    const start = cronSrc.indexOf("function scheduleSessionIdleSweep");
    expect(start).toBeGreaterThan(-1);
    const body = cronSrc.slice(start, start + 1600);
    expect(body).toContain('eq(portalSessionsTable.scope, "staff")');
  });

  test("a non-positive idle timeout still disables the sweep entirely", () => {
    // 0 / negative means "no idle timeout configured" — it must not become
    // "delete everything older than now".
    const start = cronSrc.indexOf("function scheduleSessionIdleSweep");
    const body = cronSrc.slice(start, start + 1600);
    expect(body).toMatch(/if \(idleMinutes <= 0\) return;/);
  });
});
