/**
 * Built-in model capability defaults (complements ai_model_capabilities DB).
 * Capabilities belong to MODEL — not vendor assumptions.
 */
export type BuiltinModelCapability = {
  provider: string;
  model: string;
  supportsVision: boolean;
  supportsGroundedJson: boolean;
  supportsLongContext: boolean;
  phiEligible: boolean;
  isLocal: boolean;
  experimental?: boolean;
  displayName: string;
};

export const BUILTIN_MODEL_CAPABILITIES: BuiltinModelCapability[] = [
  {
    provider: "ollama",
    model: "qwen3-vl:8b",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: false,
    phiEligible: true,
    isLocal: true,
    displayName: "Qwen3-VL 8B (local)",
  },
  {
    provider: "ollama",
    model: "qwen3:14b",
    supportsVision: false,
    supportsGroundedJson: true,
    supportsLongContext: true,
    phiEligible: true,
    isLocal: true,
    displayName: "Qwen3 14B (local)",
  },
  {
    provider: "ollama",
    model: "gemma3:12b",
    supportsVision: false,
    supportsGroundedJson: true,
    supportsLongContext: false,
    phiEligible: true,
    isLocal: true,
    displayName: "Gemma3 12B (local)",
  },
  {
    provider: "qwen",
    model: "qwen3.7-plus",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: true,
    phiEligible: false,
    isLocal: false,
    experimental: true,
    displayName: "Qwen3.7-Plus (Model Studio)",
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    supportsVision: false,
    supportsGroundedJson: true,
    supportsLongContext: true,
    phiEligible: false,
    isLocal: false,
    experimental: true,
    displayName: "DeepSeek V4 Pro",
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-flash-vision-exp",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: false,
    phiEligible: false,
    isLocal: false,
    experimental: true,
    displayName: "DeepSeek V4 Flash Vision (exp)",
  },
  {
    provider: "openai",
    model: "gpt-4o",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: true,
    phiEligible: false,
    isLocal: false,
    experimental: true,
    displayName: "GPT-4o",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: false,
    phiEligible: false,
    isLocal: false,
    experimental: true,
    displayName: "GPT-4o mini",
  },
];

export function lookupBuiltinCapability(
  provider: string,
  model: string,
): BuiltinModelCapability | null {
  const m = model.trim().toLowerCase();
  return (
    BUILTIN_MODEL_CAPABILITIES.find(
      (r) => r.provider === provider && r.model.toLowerCase() === m,
    ) ?? null
  );
}

export function modelSupportsVision(provider: string, model: string): boolean {
  const row = lookupBuiltinCapability(provider, model);
  if (row) return row.supportsVision;
  if (provider === "ollama") {
    return /vl|vision|llava|minicpm-v|moondream/.test(model.toLowerCase());
  }
  return false;
}

export function assertVisionCapable(
  provider: string,
  model: string,
): { ok: true } | { ok: false; safeError: string } {
  if (!modelSupportsVision(provider, model)) {
    return { ok: false, safeError: "model_not_vision_capable" };
  }
  return { ok: true };
}

export function listBuiltinModels(opts?: {
  provider?: string;
  vision?: boolean;
  textOnly?: boolean;
}): BuiltinModelCapability[] {
  return BUILTIN_MODEL_CAPABILITIES.filter((r) => {
    if (opts?.provider && r.provider !== opts.provider) return false;
    if (opts?.vision === true && !r.supportsVision) return false;
    if (opts?.textOnly === true && r.supportsVision && !r.supportsGroundedJson) return false;
    return true;
  });
}

export function defaultModelForProvider(
  provider: string,
  needVision: boolean,
): string | null {
  const rows = listBuiltinModels({ provider });
  const match = rows.find((r) => (needVision ? r.supportsVision : true));
  return match?.model ?? null;
}
