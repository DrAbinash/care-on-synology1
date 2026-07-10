// ─────────────────────────────────────────────────────────────────────────────
// Radiology Canonical Catalog — persistence port (Tickets B1 + B2).
//
// The service layer talks to a CatalogStore, never to the DB directly. Two
// implementations exist: DrizzleCatalogStore (production, ./drizzleStore) and
// InMemoryCatalogStore (below) which lets the whole CRUD/soft-delete/search/
// version/FK-integrity suite run deterministically with no live database —
// matching this repo's convention of not requiring DATABASE_URL in tests.
// ─────────────────────────────────────────────────────────────────────────────

export type CatalogTableName =
  | "parameter_groups"
  | "parameter_options"
  | "finding_categories"
  | "finding_definitions"
  | "finding_parameter_bindings"
  | "finding_synonyms"
  | "finding_aliases"
  | "finding_locations"
  | "finding_recommendations"
  | "finding_severity_bindings"
  | "finding_measurement_bindings";

export const CATALOG_TABLE_NAMES: CatalogTableName[] = [
  "parameter_groups", "parameter_options", "finding_categories", "finding_definitions",
  "finding_parameter_bindings", "finding_synonyms", "finding_aliases", "finding_locations",
  "finding_recommendations", "finding_severity_bindings", "finding_measurement_bindings",
];

/** Tables that carry (status, version) lifecycle columns. */
export const VERSIONED_TABLES = new Set<CatalogTableName>([
  "parameter_groups", "parameter_options", "finding_categories", "finding_definitions",
]);

export interface StoredRow {
  id: number;
  deletedAt: Date | null;
  [k: string]: unknown;
}

export interface ListOpts {
  includeDeleted?: boolean;
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface CatalogStore {
  insert(table: CatalogTableName, values: Record<string, unknown>): Promise<StoredRow>;
  getById(table: CatalogTableName, id: number, opts?: { includeDeleted?: boolean }): Promise<StoredRow | null>;
  findOne(table: CatalogTableName, where: Record<string, unknown>, opts?: { includeDeleted?: boolean }): Promise<StoredRow | null>;
  list(table: CatalogTableName, opts?: ListOpts): Promise<StoredRow[]>;
  update(table: CatalogTableName, id: number, patch: Record<string, unknown>): Promise<StoredRow | null>;
  search(table: CatalogTableName, fields: string[], q: string, opts?: { limit?: number }): Promise<StoredRow[]>;
  count(table: CatalogTableName, opts?: { includeDeleted?: boolean; where?: Record<string, unknown> }): Promise<number>;
}

// ── In-memory implementation (tests / dry-runs) ──────────────────────────────

export class InMemoryCatalogStore implements CatalogStore {
  private data = new Map<CatalogTableName, StoredRow[]>();
  private byId = new Map<CatalogTableName, Map<number, StoredRow>>();
  private seq = new Map<CatalogTableName, number>();
  private now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    for (const t of CATALOG_TABLE_NAMES) {
      this.data.set(t, []);
      this.byId.set(t, new Map());
      this.seq.set(t, 0);
    }
  }

  private rows(table: CatalogTableName): StoredRow[] {
    const r = this.data.get(table);
    if (!r) throw new Error(`Unknown catalog table: ${table}`);
    return r;
  }

  // O(1) id lookup — the persisted store is indexed by PK, so the in-memory
  // stand-in mirrors that (and keeps the test suite fast).
  private index(table: CatalogTableName): Map<number, StoredRow> {
    const m = this.byId.get(table);
    if (!m) throw new Error(`Unknown catalog table: ${table}`);
    return m;
  }

  private matches(row: StoredRow, where?: Record<string, unknown>): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  async insert(table: CatalogTableName, values: Record<string, unknown>): Promise<StoredRow> {
    const id = (this.seq.get(table) ?? 0) + 1;
    this.seq.set(table, id);
    const ts = this.now();
    const row: StoredRow = {
      deletedAt: null,
      createdAt: ts,
      updatedAt: ts,
      ...values,
      id, // id always wins — immutable, store-assigned
    };
    if (!("deletedAt" in values)) row.deletedAt = null;
    this.rows(table).push(row);
    this.index(table).set(id, row);
    return { ...row };
  }

  async getById(table: CatalogTableName, id: number, opts?: { includeDeleted?: boolean }): Promise<StoredRow | null> {
    const row = this.index(table).get(id);
    if (!row) return null;
    if (row.deletedAt && !opts?.includeDeleted) return null;
    return { ...row };
  }

  async findOne(table: CatalogTableName, where: Record<string, unknown>, opts?: { includeDeleted?: boolean }): Promise<StoredRow | null> {
    const row = this.rows(table).find((r) => (opts?.includeDeleted || !r.deletedAt) && this.matches(r, where));
    return row ? { ...row } : null;
  }

  async list(table: CatalogTableName, opts?: ListOpts): Promise<StoredRow[]> {
    let out = this.rows(table).filter((r) => (opts?.includeDeleted || !r.deletedAt) && this.matches(r, opts?.where));
    out = out.sort((a, b) => a.id - b.id);
    const start = opts?.offset ?? 0;
    const end = opts?.limit != null ? start + opts.limit : undefined;
    return out.slice(start, end).map((r) => ({ ...r }));
  }

  async update(table: CatalogTableName, id: number, patch: Record<string, unknown>): Promise<StoredRow | null> {
    const row = this.index(table).get(id); // same object reference lives in the array — no re-index needed
    if (!row) return null;
    Object.assign(row, patch, { id, updatedAt: this.now() });
    return { ...row };
  }

  async search(table: CatalogTableName, fields: string[], q: string, opts?: { limit?: number }): Promise<StoredRow[]> {
    const needle = q.toLowerCase().trim();
    const out = this.rows(table).filter((r) =>
      !r.deletedAt &&
      fields.some((f) => typeof r[f] === "string" && (r[f] as string).toLowerCase().includes(needle)),
    );
    out.sort((a, b) => a.id - b.id);
    return (opts?.limit != null ? out.slice(0, opts.limit) : out).map((r) => ({ ...r }));
  }

  async count(table: CatalogTableName, opts?: { includeDeleted?: boolean; where?: Record<string, unknown> }): Promise<number> {
    return this.rows(table).filter((r) => (opts?.includeDeleted || !r.deletedAt) && this.matches(r, opts?.where)).length;
  }

  // ── Transaction simulation (used by InMemoryCatalogRepository for K3 rollback tests) ──
  /** Deep-copy the entire store state. */
  snapshot(): string {
    return JSON.stringify({
      data: [...this.data.entries()],
      seq: [...this.seq.entries()],
    });
  }

  /** Restore state captured by snapshot() — models a transaction ROLLBACK. */
  restore(snap: string): void {
    const parsed = JSON.parse(snap, (key, value) =>
      // revive Date-looking ISO strings on known timestamp fields
      typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) ? new Date(value) : value,
    ) as { data: [CatalogTableName, StoredRow[]][]; seq: [CatalogTableName, number][] };
    this.data = new Map(parsed.data);
    this.seq = new Map(parsed.seq);
    this.byId = new Map();
    for (const t of CATALOG_TABLE_NAMES) {
      const idx = new Map<number, StoredRow>();
      for (const row of this.data.get(t) ?? []) idx.set(row.id, row);
      this.byId.set(t, idx);
    }
  }
}
