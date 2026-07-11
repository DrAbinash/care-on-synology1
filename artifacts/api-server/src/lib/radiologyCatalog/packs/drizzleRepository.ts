// ─────────────────────────────────────────────────────────────────────────────
// DrizzleCatalogRepository — production Postgres transaction boundary (K3).
// Kept in its own module because importing the live `db` handle throws at import
// time when DATABASE_URL is unset; only the runtime CLI/API/job that actually
// performs an import should import this file.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@workspace/db";
import type { CatalogStore } from "../store";
import { DrizzleCatalogStore, type CatalogExecutor } from "../drizzleStore";
import type { CatalogRepository } from "./repository";

export class DrizzleCatalogRepository implements CatalogRepository {
  readStore(): CatalogStore {
    return new DrizzleCatalogStore(); // global db handle, no transaction
  }
  async runInTransaction<T>(fn: (store: CatalogStore) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(new DrizzleCatalogStore(tx as unknown as CatalogExecutor)));
  }
}
