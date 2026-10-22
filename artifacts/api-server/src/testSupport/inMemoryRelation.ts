import { getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { backupJobsTable, backupJobLogsTable } from "@workspace/db/schema";

/**
 * In-memory stand-in for the two backup relations, so a `vi.mock("@workspace/db")` can honour the
 * WHERE clause it is actually handed instead of answering every read with the whole dataset.
 *
 * Why this exists: an unconditional "return all rows" mock is what let a scheduling change look
 * green while its at-most-once guard was not being exercised at all. `fireScheduledBackups()` claims
 * an occurrence with `job_id = $1 AND started_at >= $2`; a mock that ignores those predicates either
 * reports a claim for every hour of the day (so later hours never run) or none (so duplicate runs
 * look correct). The tests then assert on the mock's behaviour rather than the code's.
 *
 * Predicates are read from the SQL the real driver would send (`PgDialect.sqlToQuery`), and only the
 * AND-ed column comparisons the backup runner uses are supported. Anything else throws, so a future
 * predicate cannot be silently mis-read as "matched everything".
 */

const dialect = new PgDialect();

/** The drizzle table name, read the way the driver sees it. `table === X` is not reliable inside a
 *  hoisted `vi.mock` factory, which is why the relations are keyed by name. */
export function relationName(table: unknown): string {
  const sym = Object.getOwnPropertySymbols(table as object).find((s) => String(s) === "Symbol(drizzle:Name)");
  return sym ? String((table as Record<symbol, unknown>)[sym]) : "?";
}

/** SQL column name → the camelCase property the in-memory rows are keyed by. */
function columnToProps(table: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, column] of Object.entries(getTableColumns(table as never))) {
    out[(column as { name: string }).name] = prop;
  }
  return out;
}

const PROPS_BY_RELATION: Record<string, Record<string, string>> = {
  [relationName(backupJobsTable)]: columnToProps(backupJobsTable),
  [relationName(backupJobLogsTable)]: columnToProps(backupJobLogsTable),
};

const COMPARISONS = [">=", "<=", "<>", "!=", "=", ">", "<"] as const;
type Comparison = (typeof COMPARISONS)[number];

export interface WhereClause {
  sql: string;
  params: unknown[];
}

/** The exact statement text a real pg session would receive. Returns an empty clause for `undefined`. */
export function explainWhere(clause: unknown): WhereClause {
  if (clause === undefined || clause === null) return { sql: "", params: [] };
  const built = dialect.sqlToQuery(clause as Parameters<PgDialect["sqlToQuery"]>[0]);
  return { sql: built.sql, params: built.params as unknown[] };
}

interface Predicate {
  prop: string;
  op: Comparison;
  paramAt: number;
}

function readPredicates(clause: WhereClause): Predicate[] {
  if (/\bor\b/i.test(clause.sql)) {
    throw new Error(`inMemoryRelation cannot honour an OR predicate: ${clause.sql}`);
  }
  const pattern = /"(?<table>\w+)"\."(?<column>\w+)"\s*(?<op>>=|<=|<>|!=|=|>|<)\s*\$(?<param>\d+)/g;
  const out: Predicate[] = [];
  for (const match of clause.sql.matchAll(pattern)) {
    const groups = match.groups as { table: string; column: string; op: string; param: string };
    const props = PROPS_BY_RELATION[groups.table];
    if (!props) throw new Error(`inMemoryRelation does not know relation "${groups.table}"`);
    const prop = props[groups.column];
    if (!prop) throw new Error(`inMemoryRelation: column "${groups.table}.${groups.column}" has no row property`);
    out.push({ prop, op: groups.op as Comparison, paramAt: Number(groups.param) - 1 });
  }
  if (out.length === 0) throw new Error(`inMemoryRelation read no predicate from: ${clause.sql}`);
  return out;
}

/** Comparable form of a value. Timestamps arrive as Dates on one side and may be ISO strings on the
 *  other, depending on whether the row was seeded by a test or written by the runner. */
function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return value;
}

function matches(row: Record<string, unknown>, predicate: Predicate, params: unknown[]): boolean {
  const left = comparable(row[predicate.prop]);
  const right = comparable(params[predicate.paramAt]);
  switch (predicate.op) {
    case "=":
      return left === right;
    case "<>":
    case "!=":
      return left !== right;
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
  }
}

/** The rows a `select … where` would return. */
export function selectRows<T extends Record<string, unknown>>(
  table: unknown,
  rows: T[],
  clause: unknown,
): T[] {
  const where = explainWhere(clause);
  const predicates = readPredicates(where);
  return rows.filter((row) => predicates.every((p) => matches(row, p, where.params)));
}

/** Applies an `update … set … where` to the in-memory rows and reports how many matched — a real
 *  database changes nothing when the predicate matches nothing, and callers below rely on that. */
export function updateRows<T extends Record<string, unknown>>(
  rows: T[],
  values: Partial<T>,
  clause: unknown,
): number {
  const where = explainWhere(clause);
  const predicates = readPredicates(where);
  let matched = 0;
  for (const row of rows) {
    if (predicates.every((p) => matches(row, p, where.params))) {
      Object.assign(row, values);
      matched++;
    }
  }
  return matched;
}

/** Appends an inserted row carrying the id a `returning()` clause would hand back. */
export function insertRow<T extends Record<string, unknown>>(rows: T[], values: T, id: number): T {
  const row = { ...values, id };
  rows.push(row);
  return row;
}
