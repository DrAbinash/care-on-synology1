import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Immutable audit trail for all sensitive operations across the ERP.
 * Logs are append-only. No edit or delete endpoints exist.
 *
 * Chain of hashes:
 *   previousHash = chainHash of the preceding audit log (empty string for first).
 *   chainHash    = SHA256(JSON(canonical fields + previousHash))
 *
 * Tampering with any row or inserting a row out of order breaks the chain
 * and is detectable by the verification endpoint.
 */
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),               // nullable for system / unauthenticated actions
    userName: text("user_name").notNull().default("system"),
    role: text("role").notNull().default("system"),
    action: text("action").notNull(),          // login | logout | create | edit | delete | print | reprint | refund | export | approve | finalize | backup | download
    module: text("module").notNull(),        // dashboard | patients | billing | payments | reports | radiology | lab | doctors | commission | accounting | settings | backups | audit | system
    entityType: text("entity_type"),          // bill | payment | patient | report | user | voucher | backup | audit
    entityId: text("entity_id"),             // stored as text to accept UUIDs, serials, or composite keys
    oldValue: text("old_value"),              // JSON snapshot of previous state (truncated if >64KB)
    newValue: text("new_value"),              // JSON snapshot of new state
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    reason: text("reason"),                   // e.g. "Bill cancelled at patient request"
    previousHash: text("previous_hash").notNull().default(""),
    chainHash: text("chain_hash").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_user_idx").on(table.userId),
    index("audit_action_idx").on(table.action),
    index("audit_module_idx").on(table.module),
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_created_idx").on(table.createdAt),
    index("audit_chain_hash_idx").on(table.chainHash),
  ],
);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
