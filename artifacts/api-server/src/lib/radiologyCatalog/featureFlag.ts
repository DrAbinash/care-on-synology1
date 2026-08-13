// ─────────────────────────────────────────────────────────────────────────────
// ff_radiology_catalog — the single gate for the canonical catalog (B1 + B2).
//
// The catalog ships DORMANT. Until this flag is explicitly turned on, every
// catalog endpoint responds 404, so nothing in the running product can reach
// these tables. There is no existing server-side flag store in this repo, so
// the flag is read from an environment variable (default OFF). This is
// intentionally minimal — the ticket says "do not enable any feature flags"
// and "nothing existing should consume these tables yet".
// ─────────────────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from "express";
import { isFeatureEnabledServer } from "../featureFlags";

export const FF_RADIOLOGY_CATALOG = "ff_radiology_catalog";

/** OFF unless FF_RADIOLOGY_CATALOG env is truthy OR DB feature_flags row is enabled. */
export function isRadiologyCatalogEnabled(): boolean {
  const v = (process.env.FF_RADIOLOGY_CATALOG ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on";
}

/** Async gate — env var OR server feature_flags table (T0.1). */
export async function isRadiologyCatalogEnabledAsync(): Promise<boolean> {
  if (isRadiologyCatalogEnabled()) return true;
  return await isFeatureEnabledServer(FF_RADIOLOGY_CATALOG);
}

/** Router-level guard: 404 (not 403) so a disabled catalog is invisible. */
export async function requireRadiologyCatalogFlag(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(await isRadiologyCatalogEnabledAsync())) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}
