import { describe, it, expect } from "vitest";
import { splitSqlStatements, prepareSqlStatements } from "./sqlStatementSplitter";

// Regression coverage for a production incident: care-api's
// runStartupMigrations() failed on boot with
//   ERROR: syntax error at or near "has_seconds"
// because the old `sql.split(';')` shredded a `DO $$ DECLARE ... $$` block
// (which legitimately contains internal semicolons) into broken fragments.
// Since the statement loop has no per-statement recovery, everything AFTER
// the first such block in that ~2000-line SQL string silently never ran.

describe("splitSqlStatements — DO $$ ... $$ blocks stay whole", () => {
  it("keeps a DO $$ DECLARE ... END $$ block as a single statement, internal semicolons and all", () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS dicom_nodes (id SERIAL PRIMARY KEY);
      DO $$
      DECLARE
        has_minutes BOOLEAN;
        has_seconds BOOLEAN;
      BEGIN
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dicom_nodes' AND column_name = 'pull_interval_minutes') INTO has_minutes;
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dicom_nodes' AND column_name = 'pull_interval_seconds') INTO has_seconds;
        IF has_minutes AND NOT has_seconds THEN
          ALTER TABLE dicom_nodes RENAME COLUMN pull_interval_minutes TO pull_interval_seconds;
        END IF;
      END $$;
      ALTER TABLE dicom_nodes ADD COLUMN IF NOT EXISTS query_lookback_hours INTEGER;
    `;
    const statements = splitSqlStatements(sql).map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("CREATE TABLE");
    expect(statements[1]).toMatch(/^DO \$\$/);
    expect(statements[1]).toContain("has_seconds BOOLEAN;");
    expect(statements[1]).toMatch(/END \$\$$/);
    expect(statements[2]).toContain("ALTER TABLE dicom_nodes ADD COLUMN");

    // The exact failure mode: no statement should ever be a bare fragment
    // like "has_seconds BOOLEAN" on its own — it must always be nested
    // inside the DO block statement.
    const bareFragments = statements.filter((s) => /^[a-z_]+\s+(BOOLEAN|INTEGER|TEXT|RECORD)\b/i.test(s));
    expect(bareFragments).toHaveLength(0);
  });

  it("handles multiple DO $$ blocks and dollar-quoted tags with a name (DO $tag$ ... $tag$)", () => {
    const sql = `
      DO $$ BEGIN RAISE NOTICE 'a; b; c'; END $$;
      DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$;
      SELECT 1;
    `;
    const statements = splitSqlStatements(sql).map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^DO \$\$/);
    expect(statements[1]).toMatch(/^DO \$body\$/);
    expect(statements[1]).toMatch(/\$body\$$/); // trailing ";" is the separator, not part of the statement
    expect(statements[2]).toBe("SELECT 1");
  });
});

describe("splitSqlStatements — semicolons inside line comments are inert", () => {
  it("does not split on a semicolon that appears mid-sentence inside a -- comment", () => {
    // Exact real-world line from index.ts that broke a cruder fix attempt:
    // the comment itself contains an English-sentence semicolon.
    const sql = `
      END $$;
      -- DO block above only warns in that case; these two statements guarantee
      -- the current column names always end up present, with sane defaults.
      ALTER TABLE dicom_nodes ADD COLUMN IF NOT EXISTS pull_interval_seconds INTEGER;
    `;
    const statements = splitSqlStatements(sql).map((s) => s.trim()).filter(Boolean);
    // Must NOT produce a bogus statement starting mid-sentence at "these two...".
    expect(statements.some((s) => s.startsWith("these two statements"))).toBe(false);
    const last = statements[statements.length - 1];
    expect(last).toContain("ALTER TABLE dicom_nodes ADD COLUMN");
    expect(last).toContain("-- DO block above only warns in that case; these two statements guarantee");
  });
});

describe("prepareSqlStatements — comment-prefixed real SQL is never dropped", () => {
  it("keeps a statement whose first line is a comment immediately followed by real SQL (no naive startsWith('--') rejection)", () => {
    const sql = `
      -- Idempotent: safe to run repeatedly regardless of which columns already exist.
      DO $$
      BEGIN
        NULL;
      END $$;
    `;
    const statements = prepareSqlStatements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("DO $$");
    expect(statements[0]).toContain("NULL;");
  });

  it("drops a chunk that is comments/whitespace all the way through", () => {
    // The semicolon on its own line (not inside a comment) is a genuine
    // separator, so the two comment lines above it form their own
    // comment-only chunk — exactly the case prepareSqlStatements() must
    // filter out (semicolons INSIDE a comment, covered by the test above,
    // are a different scenario and stay inert).
    const sql = `
      -- just an explanatory note
      -- not attached to any statement
      ;
      SELECT 1;
    `;
    const statements = prepareSqlStatements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe("SELECT 1");
  });

  it("still splits ordinary statements on plain top-level semicolons", () => {
    const sql = `CREATE TABLE t (id INT); ALTER TABLE t ADD COLUMN x TEXT; SELECT 1;`;
    const statements = prepareSqlStatements(sql);
    expect(statements).toEqual([
      "CREATE TABLE t (id INT)",
      "ALTER TABLE t ADD COLUMN x TEXT",
      "SELECT 1",
    ]);
  });
});
