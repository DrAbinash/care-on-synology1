import { pgTable, serial, integer, text, real, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Phase 22: AI Provider Health Monitor
export const aiProviderHealthLogsTable = pgTable(
  "ai_provider_health_logs",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    endpointUrl: text("endpoint_url"),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    status: text("status").notNull(), // healthy | degraded | error | unreachable
    statusCode: integer("status_code"),
    errorMessage: text("error_message"),
    isSuccess: boolean("is_success").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index("aphl_provider_idx").on(t.provider),
    statusIdx: index("aphl_status_idx").on(t.status),
    createdIdx: index("aphl_created_idx").on(t.createdAt),
  }),
);
export type AiProviderHealthLog = typeof aiProviderHealthLogsTable.$inferSelect;
