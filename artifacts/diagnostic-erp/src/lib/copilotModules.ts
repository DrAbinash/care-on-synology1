/**
 * copilotModules.ts — the CARE Copilot's modular plug-in system (PR #80 Part 20).
 *
 * The Copilot is designed to grow: future capabilities (voice assistant, image
 * AI, previous-study comparison, guideline checker, billing suggestions,
 * follow-up letters) should plug in without touching the core. A `CopilotModule`
 * is that plug-in — it can be a synchronous LOCAL analyser (deterministic, runs
 * live) or an on-demand AI reasoner (async, behind the existing provider
 * abstraction). The registry is the single composition point.
 *
 * The Phase-1 deterministic engine (analyzeCopilot) remains the always-on core;
 * modules registered here layer ADDITIONAL items on top. Pure and alias-free.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";

/** Injected AI caller — the workspace passes one backed by the existing
 *  /api/ai-reporting/query endpoint (provider selection + fallback live there),
 *  so modules never talk to a specific LLM directly. */
export type AiAsk = (prompt: string, category: string) => Promise<string>;

export interface CopilotModule {
  id: string;
  label: string;
  kind: "local" | "ai";
  /** Local, deterministic analysis (LOCAL modules). Runs live; must be fast. */
  analyze?(ctx: CopilotContext): CopilotItem[];
  /** On-demand AI reasoning (AI modules). Invoked only when the user asks. */
  run?(ctx: CopilotContext, ask: AiAsk): Promise<CopilotItem[]>;
}

const registry = new Map<string, CopilotModule>();

export function registerCopilotModule(m: CopilotModule): void {
  registry.set(m.id, m);
}
export function unregisterCopilotModule(id: string): void {
  registry.delete(id);
}
export function getCopilotModules(): CopilotModule[] {
  return [...registry.values()];
}
export function localCopilotModules(): CopilotModule[] {
  return getCopilotModules().filter((m) => m.kind === "local" && typeof m.analyze === "function");
}
export function aiCopilotModules(): CopilotModule[] {
  return getCopilotModules().filter((m) => m.kind === "ai" && typeof m.run === "function");
}

/** Merge all registered LOCAL add-on modules' items (deterministic). A module
 *  that throws contributes nothing rather than breaking the panel. */
export function runLocalModules(ctx: CopilotContext): CopilotItem[] {
  return localCopilotModules().flatMap((m) => {
    try {
      return m.analyze!(ctx);
    } catch {
      return [];
    }
  });
}

/** Run all registered AI modules concurrently; a failing module is skipped so
 *  a provider outage never blocks the others. */
export async function runAiModules(ctx: CopilotContext, ask: AiAsk): Promise<CopilotItem[]> {
  const results = await Promise.all(
    aiCopilotModules().map((m) => m.run!(ctx, ask).catch(() => [] as CopilotItem[])),
  );
  return results.flat();
}
