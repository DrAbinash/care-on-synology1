/**
 * Capability Registry — DB loaders (Phase P2 / Gate G7).
 *
 * Reads ai_model_capabilities and, reusing the existing routing (resolveTaskRoute
 * / ai_model_routes), builds the local-first provider chain (pure buildProviderChain
 * in capabilityLogic.ts). Adds capability filtering + PHI-eligibility + digest
 * pinning that routing alone cannot express.
 */
import { db } from "@workspace/db";
import { aiModelCapabilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveTaskRoute, getDefaultProviderName } from "./index";
import { buildProviderChain, type CapabilityRow, type ProviderChoice, type RequiredCapabilities } from "./capabilityLogic";

export type { RequiredCapabilities, ProviderChoice, CapabilityRow } from "./capabilityLogic";
export { buildProviderChain } from "./capabilityLogic";

export async function loadCapabilities(): Promise<CapabilityRow[]> {
  const rows = await db
    .select()
    .from(aiModelCapabilitiesTable)
    .where(eq(aiModelCapabilitiesTable.isEnabled, true));
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    modelDigest: r.modelDigest,
    isLocal: r.isLocal,
    phiEligible: r.phiEligible,
    caps: { vision: r.supportsVision, groundedJson: r.supportsGroundedJson, longContext: r.supportsLongContext },
  }));
}

/** Look up the pinned digest for a (provider, model), or null if unpinned. */
export async function resolveModelPin(provider: string, model: string): Promise<string | null> {
  const [row] = await db
    .select({ digest: aiModelCapabilitiesTable.modelDigest })
    .from(aiModelCapabilitiesTable)
    .where(eq(aiModelCapabilitiesTable.provider, provider))
    .limit(1);
  return row?.digest ?? null;
}

/** DB-backed: resolve the full ordered chain for a task. */
export async function selectProviderChain(
  taskKey: string,
  required: RequiredCapabilities,
  phiPresent: boolean,
): Promise<ProviderChoice[]> {
  const candidates = await loadCapabilities();
  const route = await resolveTaskRoute(taskKey);
  const preferred = route
    ? { provider: route.provider, model: route.model }
    : { provider: await getDefaultProviderName() };
  return buildProviderChain(candidates, required, phiPresent, preferred);
}
