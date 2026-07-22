/**
 * resolveTestModel — pure model-resolution for POST /api/ai-reporting/test-provider.
 *
 * Fixes the bug where a submitted model (e.g. "gemini-2.0-flash") was ignored and
 * a hard-coded probe model ("gemini-1.5-flash") was used instead. Rules:
 *   - request supplies `model` → must be non-empty AND a valid provider/model
 *     combination; used VERBATIM (no silent fallback).
 *   - `model` omitted → the stored provider default (if any), else undefined so
 *     the provider uses its own built-in probe model.
 */

import { validateProviderModel } from "@workspace/ai-providers";

export type TestModelResolution = { model?: string } | { error: string };

export function resolveTestModel(opts: {
  provider: string;
  hasModelField: boolean;
  submitted?: string;
  storedDefault?: string | null;
}): TestModelResolution {
  if (opts.hasModelField) {
    const m = (opts.submitted ?? "").trim();
    if (!m) return { error: "Model cannot be empty." };
    const v = validateProviderModel(opts.provider, m);
    if (!v.ok) return { error: v.message ?? `Invalid model for ${opts.provider}.` };
    return { model: m };
  }
  // Omitted → preserve the stored default; undefined lets the provider probe.
  return { model: opts.storedDefault ?? undefined };
}
