// ─────────────────────────────────────────────────────────────────────────────
// CatalogRepository — transactional boundary for the K3 importer.
//
// readStore()          → non-transactional store for K2 dry-run reads.
// runInTransaction(fn) → runs fn against a transaction-scoped store; ANY throw
//                        rolls the whole thing back (K3: "rollback on failure",
//                        "everything inside one transaction").
//
// The production Postgres implementation (DrizzleCatalogRepository) lives in
// ./drizzleRepository so that this module — and everything that only needs the
// in-memory implementation (tests, dry-runs) — never imports the live `db`
// handle (which throws at import time without DATABASE_URL).
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogStore } from "../store";
import { InMemoryCatalogStore } from "../store";

export interface CatalogRepository {
  readStore(): CatalogStore;
  runInTransaction<T>(fn: (store: CatalogStore) => Promise<T>): Promise<T>;
}

/** In-memory repository — snapshot/restore models transaction commit/rollback (tests). */
export class InMemoryCatalogRepository implements CatalogRepository {
  constructor(private mem: InMemoryCatalogStore = new InMemoryCatalogStore()) {}
  readStore(): CatalogStore {
    return this.mem;
  }
  async runInTransaction<T>(fn: (store: CatalogStore) => Promise<T>): Promise<T> {
    const snap = this.mem.snapshot();
    try {
      return await fn(this.mem);
    } catch (err) {
      this.mem.restore(snap); // ROLLBACK
      throw err;
    }
  }
}
