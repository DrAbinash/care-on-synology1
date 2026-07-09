import { useEffect } from "react";
import { api } from "@/lib/fetchApi";
import { setServerFeatureFlags } from "@/lib/staffSession";

type FeatureFlagRow = { key: string; enabled: boolean };

/**
 * Fetches GET /api/feature-flags once per mount and hydrates the
 * "ff_radiology_" flags in staffSession.ts so isFeatureEnabled() reflects
 * the server's feature_flags table instead of only the client-only
 * localStorage defaults (Radiology Implementation Roadmap, Ticket T0.1).
 *
 * Deliberately lives in hooks/, not lib/staffSession.ts or lib/fetchApi.ts:
 * fetchApi.ts already imports from staffSession.ts, so importing `api` back
 * into staffSession.ts would create a circular module dependency. This hook
 * sits above both and has no such constraint.
 *
 * Fails soft on any error (no session yet, network error, non-2xx) — the
 * app keeps working with FEATURE_FLAG_DEFAULTS (all ff_radiology_* off)
 * exactly as it did before this hook existed.
 */
export function useServerFeatureFlags(): void {
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const rows = await api.get<FeatureFlagRow[]>("/api/feature-flags");
        if (cancelled || !Array.isArray(rows)) return;
        const flags = Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
        setServerFeatureFlags(flags);
      } catch {
        // No staff session yet, offline, or the endpoint isn't reachable —
        // silently keep the existing client-only defaults. Never surfaces
        // an error to the user for a background hydration call.
      }
    }

    void hydrate();
    return () => { cancelled = true; };
  }, []); // run once on mount
}
