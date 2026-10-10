/**
 * Built-in model capability defaults (complements ai_model_capabilities DB).
 * Capabilities belong to MODEL — not vendor assumptions.
 */

/**
 * The one Ollama name-pattern list.
 *
 * Two copies of this existed and they disagreed: `classifyOllamaModelVisionByName`
 * (index.ts) recognised the whole gemma3 family as vision-capable, while the
 * capability row below declared `gemma3:12b` as `supportsVision: false`. The two
 * are consulted by different callers — the Composer's selected-image gate by the
 * former, the model registry and cloud image-egress policy by the latter — so a
 * model could be simultaneously "vision-capable, send images" and "not
 * vision-capable, refuse images" depending on which path asked.
 *
 * `gemma3:12b` settled it by measurement, not by argument. Ollama's own
 * `/api/show` for the model the clinic actually runs reports
 * `capabilities: ["completion","vision"]` with a CLIP vision projector present
 * (`clip.has_vision_encoder`, `clip.vision.image_size`, `clip.projector_type`),
 * which is what the `false` in the table denied. The table was wrong.
 *
 * These are still only name heuristics. `/api/show` is the authority whenever
 * the server reports one; an unrecognised name resolves to "unknown" and every
 * caller treats that as fail-closed, so adding a family here is never a way to
 * make an unverified model accept pixels.
 */
export const OLLAMA_VISION_NAME_PATTERNS: RegExp[] = [
  /llava/i, /bakllava/i, /moondream/i, /minicpm-v/i, /pixtral/i,
  /llama3\.2-vision/i, /llama-vision/i, /llama4/i,
  /qwen2(\.5)?-vl/i, /qwen-vl/i, /qwen3-vl/i, /granite3\.2-vision/i, /cogvlm/i,
  /gemma3(?!:1b)/i, // gemma3 family supports vision except the 1b text-only variant
  // Google's medically-tuned family (MedGemma 1 / 1.5, 4B and 27B tags). Both
  // tiers read real images — MedGemma 1.5 covers CT, MRI, chest X-ray and
  // whole-slide histopathology — so any `medgemma…` tag is a vision model.
  // Nothing here downloads or selects the model; it only stops CARE from
  // refusing one the operator configured deliberately.
  /medgemma/i,
];

export const OLLAMA_TEXT_ONLY_NAME_PATTERNS: RegExp[] = [
  /gpt-oss/i, /^llama3(\.1)?(?!.*vision)/i, /mistral/i, /mixtral/i,
  /phi-?3/i, /phi-?4/i, /qwen2(\.5)?(?!.*vl)/i, /deepseek/i, /codellama/i,
  /starcoder/i, /gemma2/i, /^gemma(?!3)/i, /command-r/i, /gemma3:1b/i,
];

/**
 * Best-effort, name-based classification. Vision is tested first so a name in
 * both lists is never silently downgraded. `unknown` means "no idea" — callers
 * must not read it as permission.
 */
export function classifyOllamaModelVisionByName(
  model: string,
): "vision" | "text-only" | "unknown" {
  const name = (model || "").trim();
  if (!name) return "unknown";
  if (OLLAMA_VISION_NAME_PATTERNS.some((p) => p.test(name))) return "vision";
  if (OLLAMA_TEXT_ONLY_NAME_PATTERNS.some((p) => p.test(name))) return "text-only";
  return "unknown";
}

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
    // Corrected against Ollama's own report for this model:
    // `/api/show` → capabilities ["completion","vision"] with a CLIP vision
    // projector. It had been declared `false` here while `classifyOllamaModelVisionByName`
    // called the gemma3 family vision-capable, so the two tables contradicted
    // each other. `false` was the wrong one. This does NOT make it the vision
    // default — it is a 12B model whose value here is report prose, and it is
    // still last on VRAM (8.16 GB, measured 87% resident) — but refusing to
    // believe it can see was simply untrue.
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: false,
    phiEligible: true,
    isLocal: true,
    displayName: "Gemma3 12B (local)",
  },
  /**
   * Google MedGemma 1.5 — the medical-image reader CARE could not previously
   * name. It is *optional*: nothing selects it, no default changes, and CARE
   * never downloads it. The operator pulls it deliberately, and until the tag
   * exists locally the Composer's own `/api/tags` presence check refuses it
   * rather than falling back to something else.
   *
   * Placed after `qwen3-vl:8b` on purpose. `defaultModelForProvider("ollama",
   * true)` returns the FIRST vision row, so inserting this above it would have
   * silently moved every vision default in the product to a model the clinic
   * has not installed.
   *
   * `experimental` is the table's existing word for "declared, not yet proven
   * here", and the structured-output claim is exactly what the comparison
   * harness measures — a 4B model is more likely to answer in prose than the
   * 12B it is being compared against.
   *
   * Tag variants (`medgemma:4b`, `medgemma1.5:4b-it`, `medgemma:27b`) are not
   * rows — `lookupBuiltinCapability` matches the tag exactly. They are covered
   * by `/medgemma/i` in the name list instead, which is why both exist.
   */
  {
    provider: "ollama",
    model: "medgemma1.5:4b",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: false,
    phiEligible: true,
    isLocal: true,
    experimental: true,
    displayName: "MedGemma 1.5 4B (local, medical imaging)",
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
  /**
   * Default served-model id for a local OpenAI-compatible server.
   * Display name "Bonsai 2 27B" is the initial clinic config — the provider
   * itself remains vendor-neutral (local_openai_compatible).
   * Vision is declared here for the known default; other model ids fail
   * closed unless Settings marks supportsVision (see capability helpers).
   */
  {
    provider: "local_openai_compatible",
    model: "bonsai",
    supportsVision: true,
    supportsGroundedJson: true,
    supportsLongContext: true,
    phiEligible: true,
    isLocal: true,
    displayName: "Bonsai 2 27B",
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
    // Delegates to the one name list instead of a second copy that could drift.
    // `unknown` stays false: a name nobody recognises is not permission to send
    // pixels, and the Composer's gate still confirms via /api/show.
    return classifyOllamaModelVisionByName(model) === "vision";
  }
  // Local OpenAI-compatible: never infer vision from model name alone.
  // Unknown models fail closed until Settings / builtin declares vision.
  if (provider === "local_openai_compatible") {
    return false;
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
