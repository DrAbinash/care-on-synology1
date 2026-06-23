import { pgTable, serial, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Queue of mutations made while offline. Each row represents one local change
// that needs to be pushed to the cloud when connectivity returns.
export const syncQueueTable = pgTable("sync_queue", {
  id: serial("id").primaryKey(),
  // Action type: create | update | delete
  action: text("action").notNull(),
  // Target table: patients | orders | bills | payments | samples | ...
  tableName: text("table_name").notNull(),
  // Primary key of the affected row on the local DB
  localId: integer("local_id"),
  // Cloud-side ID (null until synced)
  cloudId: integer("cloud_id"),
  // Full row payload as JSON (for create/update)
  payload: jsonb("payload"),
  // Conflict resolution hint (server_wins | local_wins | merge)
  conflictStrategy: text("conflict_strategy").notNull().default("server_wins"),
  // Sync state
  isSynced: boolean("is_synced").notNull().default(false),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  // Server response (error message or cloud ID)
  syncResult: text("sync_result"),
  // Ordering for replay
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSyncQueueSchema = createInsertSchema(syncQueueTable).omit({ id: true, createdAt: true, syncedAt: true });
export type InsertSyncQueue = z.infer<typeof insertSyncQueueSchema>;
export type SyncQueue = typeof syncQueueTable.$inferSelect;

// Per-table checkpoint: last timestamp we successfully pulled from the cloud.
// Used for incremental sync (only fetch changes newer than last pull).
export const syncCheckpointTable = pgTable("sync_checkpoints", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull().unique(),
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
  lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SyncCheckpoint = typeof syncCheckpointTable.$inferSelect;
