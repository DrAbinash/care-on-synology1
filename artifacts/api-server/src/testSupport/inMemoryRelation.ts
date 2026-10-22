import { getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { backupJobsTable, backupJobLogsTable, radiologyOpsChecksTable, watchdogStatusTable } from "@workspace/db/schema";

/**
 * In-memory stand-in for the relations the backup code reads, so a `vi.mock("@workspace/db")` can
 * honour the WHERE and ORDER BY it is actually handed instead of answering every read with the whole
 * dataset.
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
  [relationName(radiologyOpsChecksTable)]: columnToProps(radiologyOpsChecksTable),
  // The alert path keeps its per-job cooldown state here, so its restart-safety test has to honour
  // `service_name = $1` — a mock that returns every watchdog row would let one job inherit another's
  // "already notified" memory and the cooldown would look correct while being nonsense.
  [relationName(watchdogStatusTable)]: columnToProps(watchdogStatusTable),
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

/**
 * Apply a real `orderBy(...)` to the in-memory rows.
 *
 * The clause is read from the SQL a pg session would receive (`"backup_job_logs"."id" desc`), so a
 * handler that asks for the newest row by `id DESC` and a handler that asks for `created_at ASC` get
 * different orders here, exactly as they would on the database. An order-by this cannot read throws
 * rather than leaving the rows in insertion order, which would silently hand back the wrong "latest".
 */
export function orderRows<T extends Record<string, unknown>>(table: unknown, rows: T[], clause: unknown): T[] {
  if (clause === undefined || clause === null) return rows;
  const relation = relationName(table);
  let column: string;
  let direction = 1;
  if (typeof (clause as { toQuery?: unknown })?.toQuery === "function") {
    // asc()/desc() arrive as SQL fragments: `"backup_job_logs"."id" desc`.
    const built = dialect.sqlToQuery(clause as Parameters<PgDialect["sqlToQuery"]>[0]);
    direction = /\bdesc\b/i.test(built.sql) ? -1 : 1;
    const match = /"(?<table>\w+)"\."(?<column>\w+)"/.exec(built.sql);
    if (!match?.groups) throw new Error(`inMemoryRelation cannot read an order-by from: ${built.sql}`);
    if (match.groups.table !== relation) throw new Error(`inMemoryRelation ordered ${built.sql} against relation ${relation}`);
    column = match.groups.column;
  } else {
    // A bare column (`.orderBy(table.createdAt)`) is ascending, and carries no SQL to parse.
    const name = (clause as { name?: string })?.name;
    if (!name) throw new Error("inMemoryRelation cannot read this order-by clause");
    column = name;
  }
  const prop = PROPS_BY_RELATION[relation]?.[column];
  if (!prop) throw new Error(`inMemoryRelation cannot order ${relation}.${column}`);
  return [...rows].sort((a, b) => {
    const left = comparable(a[prop]);
    const right = comparable(b[prop]);
    if (left === right) return 0;
    return (left as number) > (right as number) ? direction : -direction;
  });
}

/** Project a `select({ key: table.column, … })` down to the columns it named, keyed by the alias. */
export function projectRows<T extends Record<string, unknown>>(
  rows: T[],
  columns: Record<string, unknown>,
  table: unknown,
): Record<string, unknown>[] {
  const props = PROPS_BY_RELATION[relationName(table)];
  if (!props) throw new Error(`inMemoryRelation cannot project from an unknown relation`);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [alias, column] of Object.entries(columns)) {
      const name = (column as { name?: string })?.name;
      if (!name) throw new Error(`inMemoryRelation: select alias "${alias}" is not a plain column`);
      const prop = props[name];
      if (!prop) throw new Error(`inMemoryRelation: no row property for select alias "${alias}" (${name})`);
      out[alias] = row[prop];
    }
    return out;
  });
}
