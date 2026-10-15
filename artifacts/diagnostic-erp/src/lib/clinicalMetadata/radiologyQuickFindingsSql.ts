import type { AuditSeedBatch } from "./anatomyMetadataAudit";

/**
 * Static reader for `INSERT INTO radiology_quick_findings …` blocks.
 *
 * The clinic's quick findings live in the database, seeded by these migration
 * files, so an inventory that only read TypeScript would silently describe a
 * catalogue the reporting workspace is not the only owner of. This parses the
 * SQL text it is handed — it opens no files and never touches a database, so the
 * audit runs anywhere and cannot read patient rows.
 *
 * Anything it cannot parse is reported as `unparsedRows` rather than guessed at:
 * a coverage figure is only worth having if its denominator is honest.
 */

const TABLE = "radiology_quick_findings";

/** Split a tuple body on top-level commas, honouring `''`-escaped SQL strings. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") { current += "'"; i++; }
        else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") { depth--; if (depth < 0) depth = 0; }
    if (ch === "," && depth === 0) { out.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Walk `( … )` tuples starting at `from`, stopping at the statement's end. */
function readTuples(sql: string, from: number): { tuples: string[]; end: number } {
  const tuples: string[] = [];
  let i = from;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") i++;
        else inString = false;
      }
      i++;
      continue;
    }
    if (ch === "'") { inString = true; i++; continue; }
    // A statement ends at `;` or at its `ON CONFLICT` clause. The latter matters:
    // `ON CONFLICT (study_type, label) DO NOTHING` looks exactly like another
    // tuple, and reading it as one invents a bad row in every seeded file.
    if (ch === ";") return { tuples, end: i };
    if ((ch === "O" || ch === "o") && /^on\s+conflict\b/i.test(sql.slice(i, i + 20))) {
      return { tuples, end: i };
    }
    if (ch === "(") {
      let depth = 0;
      let innerString = false;
      let j = i;
      for (; j < sql.length; j++) {
        const c = sql[j]!;
        if (innerString) {
          if (c === "'") {
            if (sql[j + 1] === "'") j++;
            else innerString = false;
          }
          continue;
        }
        if (c === "'") { innerString = true; continue; }
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) break; }
      }
      if (j >= sql.length) return { tuples, end: sql.length };
      tuples.push(sql.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    i++;
  }
  return { tuples, end: i };
}

/** A value counts as populated only if it is a non-empty quoted literal. */
function isPopulatedValue(v: string | undefined): boolean {
  if (v == null) return false;
  const t = v.trim();
  if (!t) return false;
  if (/^NULL$/i.test(t)) return false;
  if (t === "''") return false;
  if (/^'(\s|'')*'$/.test(t)) return false;
  return true;
}

/** A section cell that holds a template token is a placeholder stored as data. */
function isTemplateTokenValue(v: string | undefined): boolean {
  if (v == null) return false;
  return /^\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}$/.test(v.trim().replace(/^'|'$/g, ""));
}

export function parseQuickFindingInserts(sql: string, file: string): AuditSeedBatch | null {
  const re = new RegExp(
    `INSERT\\s+INTO\\s+(?:public\\.)?${TABLE}\\s*\\(([^)]*)\\)\\s*(?:VALUES|values)`,
    "gi",
  );
  const columns: string[] = [];
  const merged: string[][] = [];
  let unparsedRows = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const cols = (m[1] ?? "").split(",").map((s) => s.trim().replace(/"/g, "").toLowerCase()).filter(Boolean);
    const { tuples } = readTuples(sql, m.index + m[0].length);
    if (tuples.length === 0) { unparsedRows++; continue; }
    for (const cell of cols) if (!columns.includes(cell)) columns.push(cell);
    for (const t of tuples) {
      const values = splitTopLevel(t);
      if (values.length !== cols.length) { unparsedRows++; continue; }
      merged.push(cols.map((_, i) => values[i]!));
    }
  }
  if (merged.length === 0 && unparsedRows === 0) return null;

  const populated: Record<string, number> = { __unparsedRows: unparsedRows };
  for (const c of columns) populated[c] = 0;
  populated["__template_section_tokens"] = 0;
  for (const row of merged) {
    columns.forEach((c, i) => {
      if (isPopulatedValue(row[i])) populated[c] = (populated[c] ?? 0) + 1;
    });
    const si = columns.indexOf("anatomical_section");
    if (si >= 0 && isTemplateTokenValue(row[si])) {
      populated["__template_section_tokens"] = (populated["__template_section_tokens"] ?? 0) + 1;
    }
  }

  return { file, rowCount: merged.length, columns, populated: Object.freeze(populated) };
}

/** Distinct section spellings used by the DB rows, for the vocabulary census. */
export function distinctSectionValues(sql: string): string[] {
  const out = new Set<string>();
  const batch = parseQuickFindingInserts(sql, "x");
  if (!batch) return [];
  const re = new RegExp(
    `INSERT\\s+INTO\\s+(?:public\\.)?${TABLE}\\s*\\(([^)]*)\\)\\s*(?:VALUES|values)`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const cols = (m[1] ?? "").split(",").map((s) => s.trim().toLowerCase());
    const si = cols.indexOf("anatomical_section");
    if (si < 0) continue;
    for (const t of readTuples(sql, m.index + m[0].length).tuples) {
      const values = splitTopLevel(t);
      if (values.length !== cols.length) continue;
      const v = (values[si] ?? "").trim().replace(/^'|'$/g, "").replace(/''/g, "'");
      if (v) out.add(v);
    }
  }
  return [...out].sort();
}
