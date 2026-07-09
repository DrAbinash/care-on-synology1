// ─────────────────────────────────────────────────────────────────────────────
// Radiology Canonical Catalog — Drizzle/Postgres implementation of CatalogStore.
//
// Thin adapter: it maps a CatalogTableName to its Drizzle table and translates
// the port's generic operations into typed queries. Business rules live in the
// service + validation layers (which are exercised against InMemoryCatalogStore
// in tests); this adapter is kept deliberately mechanical and is covered by
// typecheck + build.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@workspace/db";
import {
  parameterGroupsTable, parameterOptionsTable,
  findingCategoriesTable, findingDefinitionsTable,
  findingParameterBindingsTable, findingSynonymsTable, findingAliasesTable,
  findingLocationsTable, findingRecommendationsTable,
  findingSeverityBindingsTable, findingMeasurementBindingsTable,
} from "@workspace/db/schema";
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { CatalogStore, CatalogTableName, ListOpts, StoredRow } from "./store";

const TABLES: Record<CatalogTableName, PgTable> = {
  parameter_groups: parameterGroupsTable,
  parameter_options: parameterOptionsTable,
  finding_categories: findingCategoriesTable,
  finding_definitions: findingDefinitionsTable,
  finding_parameter_bindings: findingParameterBindingsTable,
  finding_synonyms: findingSynonymsTable,
  finding_aliases: findingAliasesTable,
  finding_locations: findingLocationsTable,
  finding_recommendations: findingRecommendationsTable,
  finding_severity_bindings: findingSeverityBindingsTable,
  finding_measurement_bindings: findingMeasurementBindingsTable,
};

// Column access by JS (camelCase) property name — the same names the service
// uses in `where` clauses and insert/patch objects.
function col(table: CatalogTableName, name: string): SQL.Aliased | any {
  const c = (TABLES[table] as unknown as Record<string, unknown>)[name];
  if (!c) throw new Error(`Unknown column ${name} on ${table}`);
  return c;
}

function whereEq(table: CatalogTableName, where?: Record<string, unknown>): SQL[] {
  if (!where) return [];
  return Object.entries(where).map(([k, v]) => eq(col(table, k), v as never));
}

export class DrizzleCatalogStore implements CatalogStore {
  async insert(table: CatalogTableName, values: Record<string, unknown>): Promise<StoredRow> {
    const [row] = await db.insert(TABLES[table]).values(values as never).returning();
    return row as StoredRow;
  }

  async getById(table: CatalogTableName, id: number, opts?: { includeDeleted?: boolean }): Promise<StoredRow | null> {
    const conds: SQL[] = [eq(col(table, "id"), id)];
    if (!opts?.includeDeleted) conds.push(isNull(col(table, "deletedAt")));
    const [row] = await db.select().from(TABLES[table]).where(and(...conds)).limit(1);
    return (row as StoredRow) ?? null;
  }

  async findOne(table: CatalogTableName, where: Record<string, unknown>, opts?: { includeDeleted?: boolean }): Promise<StoredRow | null> {
    const conds = whereEq(table, where);
    if (!opts?.includeDeleted) conds.push(isNull(col(table, "deletedAt")));
    const [row] = await db.select().from(TABLES[table]).where(and(...conds)).limit(1);
    return (row as StoredRow) ?? null;
  }

  async list(table: CatalogTableName, opts?: ListOpts): Promise<StoredRow[]> {
    const conds = whereEq(table, opts?.where);
    if (!opts?.includeDeleted) conds.push(isNull(col(table, "deletedAt")));
    let query = db.select().from(TABLES[table]).where(conds.length ? and(...conds) : undefined).orderBy(asc(col(table, "id"))) as any;
    if (opts?.limit != null) query = query.limit(opts.limit);
    if (opts?.offset != null) query = query.offset(opts.offset);
    return (await query) as StoredRow[];
  }

  async update(table: CatalogTableName, id: number, patch: Record<string, unknown>): Promise<StoredRow | null> {
    const [row] = await db.update(TABLES[table]).set(patch as never).where(eq(col(table, "id"), id)).returning();
    return (row as StoredRow) ?? null;
  }

  async search(table: CatalogTableName, fields: string[], q: string, opts?: { limit?: number }): Promise<StoredRow[]> {
    const like = `%${q.trim()}%`;
    const ors = fields.map((f) => ilike(col(table, f), like));
    const conds: SQL[] = [isNull(col(table, "deletedAt"))];
    if (ors.length) conds.push(or(...ors) as SQL);
    let query = db.select().from(TABLES[table]).where(and(...conds)).orderBy(asc(col(table, "id"))) as any;
    if (opts?.limit != null) query = query.limit(opts.limit);
    return (await query) as StoredRow[];
  }

  async count(table: CatalogTableName, opts?: { includeDeleted?: boolean; where?: Record<string, unknown> }): Promise<number> {
    const conds = whereEq(table, opts?.where);
    if (!opts?.includeDeleted) conds.push(isNull(col(table, "deletedAt")));
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(TABLES[table]).where(conds.length ? and(...conds) : undefined);
    return row?.n ?? 0;
  }
}
