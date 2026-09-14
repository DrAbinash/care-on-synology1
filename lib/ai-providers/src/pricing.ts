/**
 * Display/telemetry-only pricing. Never influences clinical routing.
 */
export type ModelPriceRow = {
  provider: string;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  currency: "USD";
  source: string;
  lastUpdated: string;
};

const ROWS: ModelPriceRow[] = [
  {
    provider: "qwen",
    model: "qwen3.7-plus",
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 1.6,
    currency: "USD",
    source: "Alibaba Model Studio international list ≤256K",
    lastUpdated: "2026-05-26",
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    inputPerMillionUsd: 0.14,
    outputPerMillionUsd: 0.28,
    currency: "USD",
    source: "DeepSeek trial placeholder",
    lastUpdated: "2026-09-14",
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-flash-vision-exp",
    inputPerMillionUsd: 0.14,
    outputPerMillionUsd: 0.28,
    currency: "USD",
    source: "DeepSeek vision trial placeholder",
    lastUpdated: "2026-09-14",
  },
  {
    provider: "openai",
    model: "gpt-4o",
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10,
    currency: "USD",
    source: "OpenAI list placeholder",
    lastUpdated: "2026-09-14",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
    currency: "USD",
    source: "OpenAI list placeholder",
    lastUpdated: "2026-09-14",
  },
];

export function listModelPricing(): ModelPriceRow[] {
  return [...ROWS];
}

export function estimateUsageCostUsd(opts: {
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): number | null {
  if (opts.promptTokens == null || opts.completionTokens == null) return null;
  const row = ROWS.find(
    (r) =>
      r.provider === opts.provider &&
      r.model.toLowerCase() === opts.model.trim().toLowerCase(),
  );
  if (!row) return null;
  return (
    (opts.promptTokens * row.inputPerMillionUsd +
      opts.completionTokens * row.outputPerMillionUsd) /
    1_000_000
  );
}
