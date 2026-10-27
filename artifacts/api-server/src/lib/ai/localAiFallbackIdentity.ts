/**
 * Is the configured Ollama "fallback URL" a second runtime, or a second address
 * for the same one?
 *
 * CARE's failover (routes/radiologyOllama.ts) tries the fallback address when
 * the primary times out. That is only resilience if two independent runtimes
 * stand behind the two addresses. On the clinic's own configuration both
 * addresses are interfaces of the single AI PC, so failover protects against a
 * dead NIC/route but not against a dead server — and nothing in the UI said so.
 *
 * This module is diagnostic only. It performs two read-only GETs when an
 * operator explicitly asks for it, and changes nothing about which endpoint
 * inference uses.
 */
import { createHash } from "node:crypto";
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import { hardenedLocalRequest } from "@workspace/ai-providers";

export type FallbackRuntimeFingerprint = {
  reachable: boolean;
  version: string | null;
  modelCount: number;
  /** Stable fingerprint of the served set (name@digest, sorted). */
  modelsFingerprint: string | null;
};

export type FallbackIdentityVerdict = {
  kind:
    | "not_configured"
    | "same_address"
    | "same_runtime"
    | "separate_runtime"
    | "unverified";
  /** Plain-language consequence for failover. */
  meaning: string;
  /** True only when a fallback would actually survive the primary dying. */
  independent: boolean;
  primary: FallbackRuntimeFingerprint | null;
  fallback: FallbackRuntimeFingerprint | null;
  checkedAt: string;
};

function normalizeOrigin(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

async function fingerprint(
  rawUrl: string,
  timeoutMs: number,
): Promise<FallbackRuntimeFingerprint> {
  const base = rawUrl.replace(/\/+$/, "");
  try {
    // SECURITY: Bind to validated IP and reject redirects for Ollama identity probe.
    const [tagsResult, versionResult] = await Promise.all([
      hardenedLocalRequest(`${base}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) }).catch((e) => ({ error: e })),
      hardenedLocalRequest(`${base}/api/version`, { signal: AbortSignal.timeout(timeoutMs) }).catch((e) => ({ error: e })),
    ]);
    if ("error" in tagsResult || !tagsResult.response.ok) {
      return { reachable: false, version: null, modelCount: 0, modelsFingerprint: null };
    }
    const tagsResp = tagsResult.response;
    const versionResp = "error" in versionResult ? null : versionResult.response;
    const data = (await tagsResp.json()) as {
      models?: Array<{ name?: string; digest?: string }>;
    };
    const models = Array.isArray(data.models) ? data.models : [];
    const names = models.map((m) => String(m?.name ?? "").trim()).filter(Boolean);
    // Digests are what prove identity; without them the name set alone is only
    // weak evidence, so the fingerprint is withheld rather than faked.
    const withDigest = models.filter((m) => String(m?.digest ?? "").trim().length > 0);
    const fingerprintValue =
      withDigest.length === 0
        ? null
        : createHash("sha256")
            .update(
              withDigest
                .map((m) => `${String(m.name).trim()}@${String(m.digest).trim()}`)
                .sort()
                .join("|"),
            )
            .digest("hex")
            .slice(0, 16);
    const version = versionResp && versionResp.ok
      ? String(((await versionResp.json().catch(() => ({}))) as { version?: string }).version ?? "") || null
      : null;
    return {
      reachable: true,
      version,
      modelCount: names.length,
      modelsFingerprint: fingerprintValue,
    };
  } catch {
    return { reachable: false, version: null, modelCount: 0, modelsFingerprint: null };
  }
}

/**
 * Compare primary and fallback as runtimes. Both URLs pass the same SSRF guard
 * inference uses; a URL the guard rejects is reported as unverified, never
 * fetched.
 */
export async function verifyOllamaFallbackIdentity(opts: {
  primaryUrl: string | null | undefined;
  fallbackUrl: string | null | undefined;
  localOnly: boolean;
  timeoutMs?: number;
}): Promise<FallbackIdentityVerdict> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = opts.timeoutMs ?? 4000;
  const primaryOrigin = normalizeOrigin(opts.primaryUrl);
  const fallbackOrigin = normalizeOrigin(opts.fallbackUrl);
  const base = { checkedAt, primary: null, fallback: null } as const;

  if (!fallbackOrigin) {
    return {
      ...base,
      kind: "not_configured",
      independent: false,
      meaning: "No fallback address configured — a failed primary has nowhere to go.",
    };
  }
  if (primaryOrigin && primaryOrigin === fallbackOrigin) {
    return {
      ...base,
      kind: "same_address",
      independent: false,
      meaning:
        "Fallback is the same address as primary. A retry against one server, not redundancy.",
    };
  }

  const primaryGuard = validateOllamaUrl(String(opts.primaryUrl), opts.localOnly);
  const fallbackGuard = validateOllamaUrl(String(opts.fallbackUrl), opts.localOnly);
  if (!primaryGuard.ok || !fallbackGuard.ok) {
    return {
      ...base,
      kind: "unverified",
      independent: false,
      meaning:
        "One of the two addresses is rejected by the SSRF guard, so the pair was not compared.",
    };
  }

  const primary = await fingerprint(primaryGuard.url.origin, timeoutMs);
  const fallback = await fingerprint(fallbackGuard.url.origin, timeoutMs);
  const details = { ...base, primary, fallback };

  if (!primary.reachable || !fallback.reachable) {
    return {
      ...details,
      kind: "unverified",
      independent: false,
      meaning: !primary.reachable
        ? "Primary did not answer, so the comparison is inconclusive."
        : "Fallback did not answer — it would not have helped during an outage.",
    };
  }
  if (primary.modelsFingerprint && fallback.modelsFingerprint) {
    const same =
      primary.modelsFingerprint === fallback.modelsFingerprint &&
      (primary.version == null || fallback.version == null || primary.version === fallback.version);
    return same
      ? {
          ...details,
          kind: "same_runtime",
          independent: false,
          meaning:
            "Both addresses serve the identical model set from the same Ollama build — one runtime, two network paths. Failover survives a bad route, not a dead server.",
        }
      : {
          ...details,
          kind: "separate_runtime",
          independent: true,
          meaning:
            "The two addresses serve different model sets or builds — genuinely independent runtimes, so failover is real.",
        };
  }
  return {
    ...details,
    kind: "unverified",
    independent: false,
    meaning:
      "At least one server reported no model digests, so identity could not be established (names alone are not proof).",
  };
}
