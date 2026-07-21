/**
 * Provider circuit breaker — DB wrappers (Phase P2 / Gate G7).
 *
 * Reuses the EXISTING ai_provider_health_logs table (append-only probe log) — no
 * new state table. State is DERIVED from the recent probe window by the pure
 * computeCircuitState (circuitLogic.ts).
 */
import { db } from "@workspace/db";
import { aiProviderHealthLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { computeCircuitState, type CircuitOptions, type CircuitState } from "./circuitLogic";

/** DB-backed: is the breaker open for this provider right now? */
export async function getProviderCircuitState(provider: string, opts: CircuitOptions = {}): Promise<CircuitState> {
  const window = opts.window ?? 5;
  const rows = await db
    .select({ isSuccess: aiProviderHealthLogsTable.isSuccess })
    .from(aiProviderHealthLogsTable)
    .where(eq(aiProviderHealthLogsTable.provider, provider))
    .orderBy(desc(aiProviderHealthLogsTable.createdAt))
    .limit(window);
  return computeCircuitState(rows, opts);
}

/** Record a probe/attempt outcome (reuses the existing health log table). */
export async function recordProviderHealth(entry: {
  provider: string;
  model?: string;
  endpointUrl?: string;
  latencyMs?: number;
  statusCode?: number;
  isSuccess: boolean;
  errorMessage?: string;
}): Promise<void> {
  await db.insert(aiProviderHealthLogsTable).values({
    provider: entry.provider,
    model: entry.model ?? null,
    endpointUrl: entry.endpointUrl ?? null,
    latencyMs: entry.latencyMs ?? null,
    status: entry.isSuccess ? "healthy" : "error",
    statusCode: entry.statusCode ?? null,
    isSuccess: entry.isSuccess,
    errorMessage: entry.errorMessage ?? null,
  });
}
