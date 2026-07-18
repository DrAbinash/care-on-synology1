/**
 * AI Model Capability Registry — Phase P2 / Gate G7.
 *
 * Augments the existing provider routing (ai_provider_settings + ai_model_routes
 * in lib/ai-providers) with per-model CAPABILITIES and DIGEST PINNING — the two
 * things routing needs but the settings table cannot express. The AI Gateway
 * reads this to pick an eligible provider (vision / grounded-JSON / PHI) and to
 * record exactly which model+digest produced a draft (reproducibility).
 */
import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const aiModelCapabilitiesTable = pgTable(
  "ai_model_capabilities",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(), // ollama | gemini | openai | anthropic
    model: text("model").notNull(),
    // Pinned digest (e.g. Ollama /api/show digest, or a cloud model snapshot id).
    // Null = unpinned (allowed, but flagged as non-reproducible by the gateway).
    modelDigest: text("model_digest"),
    supportsVision: boolean("supports_vision").notNull().default(false),
    supportsGroundedJson: boolean("supports_grounded_json").notNull().default(false),
    supportsLongContext: boolean("supports_long_context").notNull().default(false),
    // May this model receive PHI / patient images? Local models are on-prem;
    // cloud models are PHI-eligible only when a data agreement allows it.
    phiEligible: boolean("phi_eligible").notNull().default(false),
    isLocal: boolean("is_local").notNull().default(false),
    maxTokens: integer("max_tokens"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    providerModelKey: uniqueIndex("ai_model_capability_provider_model_key").on(t.provider, t.model),
  }),
);
export type AiModelCapability = typeof aiModelCapabilitiesTable.$inferSelect;
