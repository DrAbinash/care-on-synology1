/**
 * copilotAiModule.ts — the on-demand AI reasoning module (PR #80 Parts 6/7/18/21).
 *
 * A `CopilotModule` of kind "ai": when the radiologist explicitly asks, it sends
 * the current context to the LLM (through an injected `ask`, which the workspace
 * backs with the EXISTING /api/ai-reporting/query endpoint — provider selection
 * and fallback already live there) and turns the reply into advisory Copilot
 * items. The prompt asks for a fixed, line-based format so the parser is pure
 * and deterministic; nothing is auto-inserted (Part 17). Results are cached per
 * report by the caller (Part 18).
 *
 * Registering here (on import) is the whole integration — the panel gains AI
 * differentials / recommendations / impression suggestions with no engine change
 * (Part 20). Pure functions are exported for testing.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule, type AiAsk } from "./copilotModules";

export const COPILOT_AI_CATEGORY = "copilot-reasoning";

/** Build the (non-sensitive-structured) prompt from the reporting context. */
export function buildCopilotAiPrompt(ctx: CopilotContext): string {
  const findings = ctx.findings.trim() || "(none entered yet)";
  const impression = ctx.impression.filter(Boolean).join("; ") || "(none)";
  return [
    "You are a senior radiologist assisting a colleague. Based only on the data below,",
    "reply with SHORT advisory lines, each on its own line, using EXACTLY these prefixes",
    "(omit any that don't apply, no other prose):",
    "DIFFERENTIAL: a | b | c",
    "MISSING: <one observation worth adding>",
    "RECOMMENDATION: <one recommendation>",
    "IMPRESSION: <one concise impression line>",
    "",
    `Study: ${ctx.region || ctx.studyDescription || ctx.modality}`,
    `Clinical history: ${ctx.clinicalHistory || "(none)"}`,
    `Findings: ${findings}`,
    `Impression so far: ${impression}`,
  ].join("\n");
}

/** Parse the fixed line-based reply into advisory items. Unknown lines ignored. */
export function parseCopilotAiResponse(text: string): CopilotItem[] {
  const items: CopilotItem[] = [];
  let i = 0;
  for (const rawLine of (text || "").split("\n")) {
    const line = rawLine.trim();
    const m = line.match(/^(DIFFERENTIAL|MISSING|RECOMMENDATION|IMPRESSION)\s*:\s*(.+)$/i);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const body = m[2].trim();
    if (!body) continue;
    const id = `ai:${kind.toLowerCase()}:${i++}`;
    const whyBase = "Suggested by the AI reasoner from the current findings and clinical history — review before accepting.";
    if (kind === "DIFFERENTIAL") {
      items.push({ id, category: "differential", severity: "info", title: "AI differential", detail: body.split("|").map((s) => s.trim()).filter(Boolean).join(" · "), why: whyBase, confidence: "medium" });
    } else if (kind === "MISSING") {
      items.push({ id, category: "missing", severity: "info", title: `AI: consider ${body}`, detail: body, why: whyBase, confidence: "medium" });
    } else if (kind === "RECOMMENDATION") {
      items.push({ id, category: "recommendation", severity: "info", title: "AI-suggested recommendation", detail: body, why: whyBase, confidence: "medium", insertText: body, insertTarget: "recommendation" });
    } else if (kind === "IMPRESSION") {
      items.push({ id, category: "impression", severity: "info", title: "AI-suggested impression line", detail: body, why: whyBase, confidence: "medium", insertText: body, insertTarget: "impression" });
    }
  }
  return items;
}

export const AI_REASONER_MODULE = {
  id: "ai-reasoner",
  label: "AI reasoning",
  kind: "ai" as const,
  run: async (ctx: CopilotContext, ask: AiAsk): Promise<CopilotItem[]> =>
    parseCopilotAiResponse(await ask(buildCopilotAiPrompt(ctx), COPILOT_AI_CATEGORY)),
};

// Plug in on import (Part 20). Idempotent — re-registering replaces by id.
registerCopilotModule(AI_REASONER_MODULE);
