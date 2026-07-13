// Splits a multi-statement SQL string on top-level semicolons only — i.e.
// NOT semicolons inside a dollar-quoted PL/pgSQL block (`DO $$ ... $$` /
// `DO $tag$ ... $tag$`) or inside a `-- line comment`.
//
// Root cause this fixes: a plain `sql.split(';')` shreds every
// `DO $$ DECLARE x BOOLEAN; y BOOLEAN; BEGIN ... END $$;` block in
// index.ts's runStartupMigrations() SQL into broken fragments — one of
// which was a bare `has_seconds BOOLEAN`, a real production incident (the
// resulting syntax error aborted the whole statement loop, so every
// statement after the first such block in that ~2000-line SQL string never
// ran, silently, for as long as this bug existed).
//
// Line comments need the same treatment: a `-- ...` comment can contain an
// English-sentence semicolon (e.g. "-- ...in that case; these two
// statements guarantee...", a real line in that same SQL) which must not be
// treated as a statement boundary either.
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let dollarTag: string | null = null;
  for (let i = 0; i < sql.length; ) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += sql[i];
        i += 1;
      }
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl + 1;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    const tagMatch = sql[i] === "$" ? /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i)) : null;
    if (tagMatch) {
      dollarTag = tagMatch[0];
      current += dollarTag;
      i += dollarTag.length;
    } else if (sql[i] === ";") {
      statements.push(current);
      current = "";
      i += 1;
    } else {
      current += sql[i];
      i += 1;
    }
  }
  if (current.trim()) statements.push(current);
  return statements;
}

/**
 * Cleans up the raw output of splitSqlStatements() for execution: trims
 * whitespace and drops chunks that are comments/whitespace all the way
 * through. A chunk can legitimately start with one or more `-- comment`
 * lines immediately followed by real SQL (e.g. a `-- note` directly above a
 * `DO $$ ... $$` block, with no semicolon between them) — reject only
 * chunks with NO real SQL anywhere in them, not just ones whose first line
 * happens to be a comment.
 */
export function prepareSqlStatements(sql: string): string[] {
  return splitSqlStatements(sql)
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0 && stmt.replace(/^(\s*--[^\n]*\n?)+/, "").trim().length > 0);
}
