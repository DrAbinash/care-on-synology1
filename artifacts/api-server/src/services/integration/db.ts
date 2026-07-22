import { db } from "@workspace/db";

// A Drizzle transaction handle has the same query surface as `db`. Deriving the
// type this way keeps helpers usable both inside and outside a transaction
// without importing Drizzle's verbose generic types.
export type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
export type Executor = typeof db | Tx;
