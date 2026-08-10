/**
 * studyLaunchService.ts — Ticket M1.2
 *
 * ONE canonical, deterministic study-launch pipeline for the radiology
 * Reporting Workspace:
 *
 *   selectViewerNetwork(config, opts)   — network auto-selection + force modes
 *   planStudyLaunch(input, settings)    — identity + URL construction (pure)
 *   launchRadiologyStudy(input, ...)    — plan + open + record + diagnostics
 *
 * Design rules (see ticket):
 *  - StudyInstanceUID is ALWAYS the primary identifier; accessionNumber is a
 *    fallback only when no UID exists AND the configured template can consume
 *    it; patient-name matching is forbidden and not even representable here.
 *  - Modes: AUTO | LAN | TAILSCALE | CLOUDFLARE | PUBLIC. AUTO probes the
 *    configured fallback order with short bounded timeouts and picks the
 *    first reachable endpoint. Forced modes NEVER silently switch — a forced
 *    failure returns a typed error with diagnostics preserved.
 *  - Base URLs come only from validated server settings (http/https, no
 *    embedded credentials); nothing here hardcodes clinic topology.
 *  - The short-lived route cache is trusted only until any probe or launch
 *    failure — failures invalidate it.
 *  - All browser APIs (probe fetch, window.open, localStorage, page origin,
 *    clock) are injectable so every rule is unit-testable.
 */

// ─── Modes ───────────────────────────────────────────────────────────────────

export const CONCRETE_MODES = ["LAN", "TAILSCALE", "CLOUDFLARE", "PUBLIC"] as const;
export type ConcreteMode = (typeof CONCRETE_MODES)[number];
export type NetworkMode = "AUTO" | ConcreteMode;

export const DEFAULT_FALLBACK_ORDER: ConcreteMode[] = ["LAN", "TAILSCALE", "CLOUDFLARE", "PUBLIC"];

export function isConcreteMode(v: string): v is ConcreteMode {
  return (CONCRETE_MODES as readonly string[]).includes(v);
}

// ─── Config model (parsed from the flat pacs-settings key/value store) ──────

export interface NetworkEndpoint {
  mode: ConcreteMode;
  /** OHIF (or viewer) base URL for this mode. */
  viewerBaseUrl: string;
  /** WADO endpoint Weasis should use for this mode (may equal viewerBaseUrl host). */
  wadoBaseUrl: string | null;
  /** Explicit probe URL; defaults to viewerBaseUrl + probePath. */
  probeUrl: string | null;
}

export interface ViewerNetworkConfig {
  endpoints: Partial<Record<ConcreteMode, NetworkEndpoint>>;
  fallbackOrder: ConcreteMode[];
  probePath: string;
  probeTimeoutMs: number;
  cacheTtlMs: number;
  /** Admin-configured default mode (workspace users may override per-browser). */
  defaultMode: NetworkMode;
  /** Diagnostics accumulated while parsing (invalid URLs, ignored modes…). */
  parseDiagnostics: string[];
}

export interface UrlValidation {
  ok: boolean;
  reason?: string;
}

/** http/https only, parseable, and NEVER carrying embedded credentials —
 *  launch URLs open in new tabs and must not leak secrets. */
export function validateBaseUrl(raw: string | null | undefined): UrlValidation {
  const value = raw?.trim();
  if (!value) return { ok: false, reason: "empty" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported_scheme:${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials_in_url" };
  }
  return { ok: true };
}

/** Join a base URL and a path, collapsing duplicate slashes without touching
 *  the scheme's "//" — preserves reverse-proxy subpaths like /erp or /ohif. */
export function joinUrl(base: string, path: string): string {
  if (!path) return base.replace(/\/+$/, "");
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

const MODE_KEY_SUFFIX: Record<ConcreteMode, string> = {
  LAN: "",
  TAILSCALE: "_tailscale",
  CLOUDFLARE: "_cloudflare",
  PUBLIC: "_public",
};

/**
 * Parse the flat settings record into the canonical network config.
 * Reuses the EXISTING keys for LAN (`ohif_base_url`, `weasis_wado_url`/
 * `wado_uri_base_url`) and Tailscale (`ohif_base_url_tailscale`) so no
 * duplicate settings are created; Cloudflare/Public follow the same suffix
 * pattern. Unconfigured or invalid modes are ignored (with diagnostics).
 */
export function parseViewerNetworkConfig(settings: Record<string, string>): ViewerNetworkConfig {
  const diagnostics: string[] = [];
  const endpoints: Partial<Record<ConcreteMode, NetworkEndpoint>> = {};

  for (const mode of CONCRETE_MODES) {
    const suffix = MODE_KEY_SUFFIX[mode];
    let viewerBaseUrl = settings[`ohif_base_url${suffix}`]?.trim() || "";
    // Back-compat: an old-style bare public host implies a public viewer URL.
    if (!viewerBaseUrl && mode === "PUBLIC" && settings["public_pacs_host"]?.trim()) {
      viewerBaseUrl = `https://${settings["public_pacs_host"].trim().replace(/^https?:\/\//, "")}`;
      diagnostics.push("PUBLIC viewer URL derived from legacy public_pacs_host");
    }
    if (!viewerBaseUrl) continue; // mode not configured — ignored by design

    const validation = validateBaseUrl(viewerBaseUrl);
    if (!validation.ok) {
      diagnostics.push(`${mode} ignored: invalid base URL (${validation.reason})`);
      continue;
    }

    const wadoRaw =
      settings[`wado_base_url${suffix}`]?.trim() ||
      (mode === "LAN"
        ? settings["weasis_wado_url"]?.trim() || settings["wado_uri_base_url"]?.trim() || ""
        : "");
    let wadoBaseUrl: string | null = wadoRaw || null;
    if (wadoBaseUrl && !validateBaseUrl(wadoBaseUrl).ok) {
      diagnostics.push(`${mode} WADO URL invalid — ignored`);
      wadoBaseUrl = null;
    }

    const probeRaw = settings[`viewer_probe_url${suffix}`]?.trim() || "";
    let probeUrl: string | null = probeRaw || null;
    if (probeUrl && !validateBaseUrl(probeUrl).ok) {
      diagnostics.push(`${mode} probe URL invalid — ignored`);
      probeUrl = null;
    }

    endpoints[mode] = { mode, viewerBaseUrl, wadoBaseUrl, probeUrl };
  }

  // Fallback order: configured override respected, unknown/unconfigured
  // entries dropped, missing configured modes appended in default order.
  const rawOrder = (settings["viewer_network_fallback_order"] ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const order: ConcreteMode[] = [];
  for (const item of rawOrder) {
    if (isConcreteMode(item) && !order.includes(item)) order.push(item);
    else if (!isConcreteMode(item)) diagnostics.push(`fallback order entry ignored: ${item}`);
  }
  for (const mode of DEFAULT_FALLBACK_ORDER) {
    if (!order.includes(mode)) order.push(mode);
  }

  const probeTimeoutMs = clampInt(settings["viewer_probe_timeout_ms"], 200, 10_000, 1500);
  const cacheTtlMs = clampInt(settings["viewer_route_cache_ttl_ms"], 0, 300_000, 15_000);
  const rawDefault = (settings["viewer_network_mode"] ?? "AUTO").trim().toUpperCase();
  const defaultMode: NetworkMode = rawDefault === "AUTO" || isConcreteMode(rawDefault) ? (rawDefault as NetworkMode) : "AUTO";

  return {
    endpoints,
    fallbackOrder: order,
    probePath: settings["viewer_probe_path"]?.trim() ?? "",
    probeTimeoutMs,
    cacheTtlMs,
    defaultMode,
    parseDiagnostics: diagnostics,
  };
}

function clampInt(raw: string | undefined, min: number, max: number, dflt: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ─── Route cache (short-lived last-successful-route optimization) ────────────

export interface RouteCacheEntry {
  mode: ConcreteMode;
  baseUrl: string;
  at: number;
}

export interface RouteCache {
  get(): RouteCacheEntry | null;
  set(entry: RouteCacheEntry): void;
  invalidate(): void;
}

const CACHE_KEY = "viewer_route_cache_v1";

export function localStorageRouteCache(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = window.localStorage): RouteCache {
  return {
    get() {
      try {
        const raw = storage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as RouteCacheEntry;
        if (!parsed || !isConcreteMode(parsed.mode) || typeof parsed.at !== "number") return null;
        return parsed;
      } catch {
        return null;
      }
    },
    set(entry) {
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(entry));
      } catch {
        /* quota/privacy mode — cache is an optimization only */
      }
    },
    invalidate() {
      try {
        storage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export function memoryRouteCache(): RouteCache {
  let entry: RouteCacheEntry | null = null;
  return {
    get: () => entry,
    set: (e) => {
      entry = e;
    },
    invalidate: () => {
      entry = null;
    },
  };
}

// ─── Network selection ───────────────────────────────────────────────────────

export type ProbeFn = (url: string, timeoutMs: number) => Promise<boolean>;

export interface ReachabilityResult {
  mode: ConcreteMode;
  url: string;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

export interface NetworkSelection {
  requestedMode: NetworkMode;
  selectedMode: ConcreteMode | null;
  selectedBaseUrl: string | null;
  reason: string;
  fallbackOrder: ConcreteMode[];
  reachabilityResults: ReachabilityResult[];
  cacheUsed: boolean;
  diagnostics: string[];
}

export interface SelectNetworkOptions {
  requestedMode: NetworkMode;
  probe: ProbeFn;
  cache?: RouteCache;
  now?: () => number;
  /** Origin scheme of the ERP page — https pages cannot probe/launch http
   *  endpoints (browser mixed-content blocking); detected deterministically
   *  instead of relying on a failed fetch. */
  pageIsHttps?: boolean;
  /** Modes to skip (workspace "Retry with next route"). */
  skipModes?: ConcreteMode[];
}

/** Default browser probe: bounded no-cors fetch — an opaque response counts
 *  as reachable; abort/timeout/mixed-content counts as unreachable. */
export const browserProbe: ProbeFn = async (url, timeoutMs) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: "GET", mode: "no-cors", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
};

function probeTargetFor(endpoint: NetworkEndpoint, config: ViewerNetworkConfig): string {
  return endpoint.probeUrl ?? joinUrl(endpoint.viewerBaseUrl, config.probePath);
}

function isHttpUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * ONE deterministic selector.
 *
 * AUTO: fresh cached route (still configured, still in the order, not
 * skipped) wins without probing; otherwise probe the fallback order with
 * bounded timeouts and select the first reachable endpoint. Every probe is
 * recorded in reachabilityResults; a fully-unreachable result carries the
 * whole fallback history.
 *
 * Forced mode: probe only that mode. Unconfigured → not configured error;
 * unreachable → error WITHOUT switching (the caller decides whether to
 * "Retry with fallback", which is just another call with AUTO+skipModes).
 */
export async function selectViewerNetwork(
  config: ViewerNetworkConfig,
  opts: SelectNetworkOptions,
): Promise<NetworkSelection> {
  const now = opts.now ?? Date.now;
  const cache = opts.cache ?? null;
  const skip = new Set(opts.skipModes ?? []);
  const diagnostics = [...config.parseDiagnostics];
  const results: ReachabilityResult[] = [];
  const requestedMode = opts.requestedMode;

  const availableOrder = config.fallbackOrder.filter((m) => config.endpoints[m] && !skip.has(m));
  if (skip.size > 0) diagnostics.push(`skipping modes per retry request: ${[...skip].join(", ")}`);

  const probeMode = async (mode: ConcreteMode): Promise<ReachabilityResult> => {
    const endpoint = config.endpoints[mode]!;
    const target = probeTargetFor(endpoint, config);
    if (opts.pageIsHttps && isHttpUrl(target)) {
      // Deterministic: an https page can never fetch/launch a plain-http
      // endpoint — record why instead of letting the probe "time out".
      return { mode, url: target, reachable: false, latencyMs: 0, error: "mixed_content_blocked" };
    }
    const start = now();
    const reachable = await opts.probe(target, config.probeTimeoutMs);
    return { mode, url: target, reachable, latencyMs: now() - start };
  };

  // ── Forced mode ────────────────────────────────────────────────────────────
  if (requestedMode !== "AUTO") {
    const endpoint = config.endpoints[requestedMode];
    if (!endpoint) {
      return {
        requestedMode,
        selectedMode: null,
        selectedBaseUrl: null,
        reason: `${requestedMode} is not configured`,
        fallbackOrder: availableOrder,
        reachabilityResults: results,
        cacheUsed: false,
        diagnostics: [...diagnostics, `forced mode ${requestedMode} has no configured endpoint`],
      };
    }
    const result = await probeMode(requestedMode);
    results.push(result);
    if (!result.reachable) {
      cache?.invalidate(); // never trust cached success after a probe failure
      return {
        requestedMode,
        selectedMode: null,
        selectedBaseUrl: null,
        reason:
          result.error === "mixed_content_blocked"
            ? `${requestedMode} blocked: http endpoint cannot be reached from an https page`
            : `${requestedMode} endpoint is unreachable`,
        fallbackOrder: availableOrder,
        reachabilityResults: results,
        cacheUsed: false,
        diagnostics: [...diagnostics, `forced mode ${requestedMode} failed — NOT falling back (explicit retry required)`],
      };
    }
    cache?.set({ mode: requestedMode, baseUrl: endpoint.viewerBaseUrl, at: now() });
    return {
      requestedMode,
      selectedMode: requestedMode,
      selectedBaseUrl: endpoint.viewerBaseUrl,
      reason: `forced ${requestedMode} (${result.latencyMs}ms)`,
      fallbackOrder: availableOrder,
      reachabilityResults: results,
      cacheUsed: false,
      diagnostics,
    };
  }

  // ── AUTO ──────────────────────────────────────────────────────────────────
  if (availableOrder.length === 0) {
    return {
      requestedMode,
      selectedMode: null,
      selectedBaseUrl: null,
      reason: "no network mode is configured",
      fallbackOrder: availableOrder,
      reachabilityResults: results,
      cacheUsed: false,
      diagnostics: [...diagnostics, "no configured endpoints — set viewer base URLs in Radiology Settings"],
    };
  }

  const cached = cache?.get() ?? null;
  if (
    cached &&
    now() - cached.at < config.cacheTtlMs &&
    availableOrder.includes(cached.mode) &&
    config.endpoints[cached.mode]?.viewerBaseUrl === cached.baseUrl
  ) {
    return {
      requestedMode,
      selectedMode: cached.mode,
      selectedBaseUrl: cached.baseUrl,
      reason: `recent successful route (${cached.mode}) reused`,
      fallbackOrder: availableOrder,
      reachabilityResults: results,
      cacheUsed: true,
      diagnostics,
    };
  }

  for (const mode of availableOrder) {
    const result = await probeMode(mode);
    results.push(result);
    if (result.reachable) {
      cache?.set({ mode, baseUrl: config.endpoints[mode]!.viewerBaseUrl, at: now() });
      return {
        requestedMode,
        selectedMode: mode,
        selectedBaseUrl: config.endpoints[mode]!.viewerBaseUrl,
        reason: `AUTO selected ${mode} (${result.latencyMs}ms${results.length > 1 ? `, after ${results.length - 1} fallback${results.length > 2 ? "s" : ""}` : ""})`,
        fallbackOrder: availableOrder,
        reachabilityResults: results,
        cacheUsed: false,
        diagnostics,
      };
    }
    diagnostics.push(`${mode} unreachable${result.error ? ` (${result.error})` : ""} — trying next configured path`);
  }

  cache?.invalidate();
  const allMixed = results.length > 0 && results.every((r) => r.error === "mixed_content_blocked");
  return {
    requestedMode,
    selectedMode: null,
    selectedBaseUrl: null,
    reason: allMixed
      ? "every configured endpoint is plain http and this page is https (mixed content)"
      : "no configured network path is reachable",
    fallbackOrder: availableOrder,
    reachabilityResults: results,
    cacheUsed: false,
    diagnostics,
  };
}

// ─── Study identity + launch URL construction ────────────────────────────────

export type ViewerType = "OHIF" | "WEASIS";
export type IdentifierType = "STUDY_INSTANCE_UID" | "ACCESSION_NUMBER";

export type LaunchErrorCode =
  | "MISSING_STUDY_IDENTIFIER"
  | "VIEWER_NOT_CONFIGURED"
  | "NETWORK_MODE_NOT_CONFIGURED"
  | "NO_REACHABLE_NETWORK"
  | "STUDY_NOT_FOUND"
  | "VIEWER_UNAVAILABLE"
  | "POPUP_BLOCKED"
  | "MIXED_CONTENT_BLOCKED"
  | "INVALID_BASE_URL"
  | "PACS_LOOKUP_FAILED"
  | "STALE_STUDY_CONTEXT";

export interface StudyLaunchInput {
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  patientId?: number | null;
  worklistId?: number | null;
  viewer: ViewerType;
  requestedMode: NetworkMode;
}

export interface StudyLaunchResult {
  success: boolean;
  viewerType: ViewerType;
  requestedMode: NetworkMode;
  selectedNetworkMode: ConcreteMode | null;
  selectedBaseUrl: string | null;
  identifierType: IdentifierType | null;
  identifierUsed: string | null;
  finalLaunchUrl: string | null;
  probeResults: ReachabilityResult[];
  fallbackHistory: string[];
  errorCode: LaunchErrorCode | null;
  diagnostics: string[];
}

const UID_TOKEN = /\{studyInstanceUID\}/g;
const ACCESSION_TOKEN = /\{accessionNumber\}/g;
const BASE_TOKEN = /\{OHIF_BASE_URL\}/g;
const WADO_TOKEN = /\{WADO_URL\}|\{wado_url\}/g;

/** Build the OHIF launch URL for one endpoint. Template is optional; the
 *  default matches the existing deployment convention. */
export function buildOhifUrl(
  endpoint: NetworkEndpoint,
  template: string | undefined,
  identifier: { type: IdentifierType; value: string },
): { ok: true; url: string } | { ok: false; reason: string } {
  const base = endpoint.viewerBaseUrl.replace(/\/+$/, "");
  const tpl = template?.trim() || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}";
  if (identifier.type === "ACCESSION_NUMBER" && !ACCESSION_TOKEN.test(tpl)) {
    return { ok: false, reason: "ohif template cannot consume an accession number" };
  }
  ACCESSION_TOKEN.lastIndex = 0;
  const url = tpl
    .replace(BASE_TOKEN, base)
    .replace(UID_TOKEN, identifier.type === "STUDY_INSTANCE_UID" ? encodeURIComponent(identifier.value) : "")
    .replace(ACCESSION_TOKEN, identifier.type === "ACCESSION_NUMBER" ? encodeURIComponent(identifier.value) : "");
  // Collapse accidental duplicate slashes in the path (never the scheme's //).
  const normalized = url.replace(/([^:/])\/{2,}/g, "$1/");
  const check = validateBaseUrl(normalized);
  if (!check.ok) return { ok: false, reason: `generated URL invalid (${check.reason})` };
  return { ok: true, url: normalized };
}

/** Build the Weasis launch URL for one endpoint (weasis:// protocol). */
export function buildWeasisUrl(
  endpoint: NetworkEndpoint,
  template: string | undefined,
  identifier: { type: IdentifierType; value: string },
): { ok: true; url: string } | { ok: false; reason: string } {
  const wado = endpoint.wadoBaseUrl;
  const tpl = template?.trim();
  if (tpl) {
    if (identifier.type === "ACCESSION_NUMBER" && !ACCESSION_TOKEN.test(tpl)) {
      return { ok: false, reason: "weasis template cannot consume an accession number" };
    }
    ACCESSION_TOKEN.lastIndex = 0;
    if (WADO_TOKEN.test(tpl) && !wado) {
      return { ok: false, reason: "weasis template needs a WADO URL but none is configured for this mode" };
    }
    WADO_TOKEN.lastIndex = 0;
    const url = tpl
      .replace(WADO_TOKEN, wado ?? "")
      .replace(UID_TOKEN, identifier.type === "STUDY_INSTANCE_UID" ? identifier.value : "")
      .replace(ACCESSION_TOKEN, identifier.type === "ACCESSION_NUMBER" ? identifier.value : "");
    return { ok: true, url };
  }
  if (!wado) return { ok: false, reason: "no WADO endpoint configured for this mode" };
  if (identifier.type === "ACCESSION_NUMBER") {
    return { ok: false, reason: "default weasis launch requires a StudyInstanceUID" };
  }
  return { ok: true, url: `weasis://$dicom:get -w "${wado}" -r "studyUID=${identifier.value}"` };
}

/** UID first; accession ONLY when no UID exists. Patient names are not an
 *  input and can never participate — wrong-patient prevention by design. */
export function selectStudyIdentifier(input: Pick<StudyLaunchInput, "studyInstanceUID" | "accessionNumber">):
  | { ok: true; type: IdentifierType; value: string }
  | { ok: false } {
  const uid = input.studyInstanceUID?.trim();
  if (uid) return { ok: true, type: "STUDY_INSTANCE_UID", value: uid };
  const accession = input.accessionNumber?.trim();
  if (accession) return { ok: true, type: "ACCESSION_NUMBER", value: accession };
  return { ok: false };
}

export interface LaunchDeps {
  probe?: ProbeFn;
  cache?: RouteCache;
  now?: () => number;
  pageIsHttps?: boolean;
  skipModes?: ConcreteMode[];
  /** Pre-opened window (opened synchronously in the click handler so the
   *  popup blocker sees a user gesture). null = the browser blocked it. */
  openTarget?: Window | null | undefined;
  /** Returns true when the workspace has moved to a DIFFERENT study since
   *  the click — a stale async selection must never launch the wrong
   *  patient's study. */
  isStale?: () => boolean;
  /** Success/failure recorders (default: viewerService localStorage stats). */
  recordSuccess?: (mode: string, viewer: string, url: string, ms: number) => void;
  recordFailure?: (stage: string, url: string, status: string) => void;
}

function failure(
  input: StudyLaunchInput,
  errorCode: LaunchErrorCode,
  diagnostics: string[],
  extras: Partial<StudyLaunchResult> = {},
): StudyLaunchResult {
  return {
    success: false,
    viewerType: input.viewer,
    requestedMode: input.requestedMode,
    selectedNetworkMode: null,
    selectedBaseUrl: null,
    identifierType: null,
    identifierUsed: null,
    finalLaunchUrl: null,
    probeResults: [],
    fallbackHistory: [],
    errorCode,
    diagnostics,
    ...extras,
  };
}

/**
 * Pure planning step: identity → config → network selection → URL. Separated
 * from the window-opening side effects so every rule is testable.
 */
export async function planStudyLaunch(
  input: StudyLaunchInput,
  settings: Record<string, string>,
  deps: LaunchDeps = {},
): Promise<StudyLaunchResult> {
  const config = parseViewerNetworkConfig(settings);
  const diagnostics: string[] = [];

  const identifier = selectStudyIdentifier(input);
  if (!identifier.ok) {
    return failure(input, "MISSING_STUDY_IDENTIFIER", [
      ...config.parseDiagnostics,
      "study has neither a StudyInstanceUID nor an accession number",
    ]);
  }
  if (identifier.type === "ACCESSION_NUMBER") {
    diagnostics.push("StudyInstanceUID missing — using accession-number fallback");
  }

  const viewerEnabled =
    input.viewer === "OHIF"
      ? settings["ohif_enabled"] !== "false"
      : settings["weasis_enabled"] !== "false";
  if (!viewerEnabled) {
    return failure(input, "VIEWER_NOT_CONFIGURED", [...config.parseDiagnostics, `${input.viewer} is disabled in settings`]);
  }

  const selection = await selectViewerNetwork(config, {
    requestedMode: input.requestedMode,
    probe: deps.probe ?? browserProbe,
    cache: deps.cache,
    now: deps.now,
    pageIsHttps: deps.pageIsHttps,
    skipModes: deps.skipModes,
  });
  diagnostics.push(...selection.diagnostics, `route: ${selection.reason}`);
  const fallbackHistory = selection.reachabilityResults.map(
    (r) => `${r.mode}: ${r.reachable ? "reachable" : `unreachable${r.error ? ` (${r.error})` : ""}`} in ${r.latencyMs}ms`,
  );

  if (!selection.selectedMode || !selection.selectedBaseUrl) {
    const allMixed =
      selection.reachabilityResults.length > 0 &&
      selection.reachabilityResults.every((r) => r.error === "mixed_content_blocked");
    const errorCode: LaunchErrorCode =
      input.requestedMode !== "AUTO" && !config.endpoints[input.requestedMode as ConcreteMode]
        ? "NETWORK_MODE_NOT_CONFIGURED"
        : Object.keys(config.endpoints).length === 0
          ? "NETWORK_MODE_NOT_CONFIGURED"
          : allMixed
            ? "MIXED_CONTENT_BLOCKED"
            : "NO_REACHABLE_NETWORK";
    return failure(input, errorCode, diagnostics, {
      probeResults: selection.reachabilityResults,
      fallbackHistory,
    });
  }

  const endpoint = config.endpoints[selection.selectedMode]!;
  const built =
    input.viewer === "OHIF"
      ? buildOhifUrl(endpoint, settings["ohif_study_url_template"], identifier)
      : buildWeasisUrl(endpoint, settings["weasis_manifest_url_template"], identifier);
  if (!built.ok) {
    const identifierProblem = identifier.type === "ACCESSION_NUMBER" && built.reason.includes("accession");
    return failure(input, identifierProblem ? "MISSING_STUDY_IDENTIFIER" : "INVALID_BASE_URL", [...diagnostics, built.reason], {
      selectedNetworkMode: selection.selectedMode,
      selectedBaseUrl: selection.selectedBaseUrl,
      identifierType: identifier.type,
      identifierUsed: identifier.value,
      probeResults: selection.reachabilityResults,
      fallbackHistory,
    });
  }

  // Mixed-content guard on the FINAL URL too (probe URL may be https while
  // the viewer URL is http). weasis:// URLs are handled by the OS protocol
  // handler and are exempt.
  if (deps.pageIsHttps && input.viewer === "OHIF" && isHttpUrl(built.url)) {
    return failure(input, "MIXED_CONTENT_BLOCKED", [...diagnostics, "final OHIF URL is plain http but the page is https"], {
      selectedNetworkMode: selection.selectedMode,
      selectedBaseUrl: selection.selectedBaseUrl,
      identifierType: identifier.type,
      identifierUsed: identifier.value,
      probeResults: selection.reachabilityResults,
      fallbackHistory,
    });
  }

  return {
    success: true,
    viewerType: input.viewer,
    requestedMode: input.requestedMode,
    selectedNetworkMode: selection.selectedMode,
    selectedBaseUrl: selection.selectedBaseUrl,
    identifierType: identifier.type,
    identifierUsed: identifier.value,
    finalLaunchUrl: built.url,
    probeResults: selection.reachabilityResults,
    fallbackHistory,
    errorCode: null,
    diagnostics,
  };
}

/**
 * Full launch: plan, guard against stale study context, navigate the
 * pre-opened window (or open one), record stats, invalidate the route cache
 * on failure. The ONLY place launch side effects live.
 */
function openProtocolLaunchUrl(url: string, placeholder?: Window | null): void {
  if (placeholder) {
    try {
      placeholder.location.href = url;
    } catch {
      /* cross-origin or protocol navigation */
    }
    try {
      placeholder.close();
    } catch {
      /* already closed */
    }
  }
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  iframe.src = url;
  window.setTimeout(() => iframe.remove(), 2000);
}

export async function launchRadiologyStudy(
  input: StudyLaunchInput,
  settings: Record<string, string>,
  deps: LaunchDeps = {},
): Promise<StudyLaunchResult> {
  const cache = deps.cache ?? localStorageRouteCache();
  const plan = await planStudyLaunch(input, settings, { ...deps, cache });

  const closeTarget = () => {
    try {
      deps.openTarget?.close();
    } catch {
      /* cross-origin or already closed */
    }
  };

  if (deps.isStale?.()) {
    closeTarget();
    return failure(input, "STALE_STUDY_CONTEXT", [
      ...plan.diagnostics,
      "study selection changed while probing — launch aborted to prevent opening the wrong patient",
    ]);
  }

  if (!plan.success || !plan.finalLaunchUrl) {
    closeTarget();
    cache.invalidate();
    deps.recordFailure?.("plan", plan.finalLaunchUrl ?? "", plan.errorCode ?? "UNKNOWN");
    return plan;
  }

  // Popup handling: the workspace opens a blank window synchronously inside
  // the click gesture and passes it as openTarget. openTarget === null means
  // the browser blocked it.
  if (deps.openTarget === null) {
    cache.invalidate();
    deps.recordFailure?.("popup", plan.finalLaunchUrl, "POPUP_BLOCKED");
    return { ...plan, success: false, errorCode: "POPUP_BLOCKED" };
  }

  const start = (deps.now ?? Date.now)();
  try {
    const isProtocol = plan.finalLaunchUrl.startsWith("weasis://");
    if (isProtocol) {
      openProtocolLaunchUrl(plan.finalLaunchUrl, deps.openTarget ?? undefined);
    } else if (deps.openTarget) {
      deps.openTarget.location.href = plan.finalLaunchUrl;
    } else if (typeof window !== "undefined") {
      const w = window.open(plan.finalLaunchUrl, "_blank");
      if (!w) {
        cache.invalidate();
        deps.recordFailure?.("popup", plan.finalLaunchUrl, "POPUP_BLOCKED");
        return { ...plan, success: false, errorCode: "POPUP_BLOCKED" };
      }
    }
  } catch (e) {
    cache.invalidate();
    deps.recordFailure?.("open", plan.finalLaunchUrl, String(e));
    return {
      ...plan,
      success: false,
      errorCode: "VIEWER_UNAVAILABLE",
      diagnostics: [...plan.diagnostics, `window navigation failed: ${String(e)}`],
    };
  }

  deps.recordSuccess?.(
    plan.selectedNetworkMode ?? "?",
    plan.viewerType,
    plan.finalLaunchUrl,
    (deps.now ?? Date.now)() - start,
  );
  return plan;
}
