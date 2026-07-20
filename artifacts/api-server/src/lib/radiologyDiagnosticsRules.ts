/**
 * radiologyDiagnosticsRules.ts — Ticket M1.3 (Flight Deck), pure rules.
 *
 * Every verdict the clinical-activation diagnostics toolkit can produce is
 * derived here, with no IO: check statuses, HTTP/CORS/TLS/redirect/URL
 * classification, pacs_settings verification, and the final deployment
 * verdict. The IO lives in radiologyDeploymentDiagnostics.ts; keeping the
 * rules pure makes every failure mode unit-testable, including the ones that
 * need a broken network to reproduce.
 *
 * Backend v1 is FROZEN — nothing here mutates anything or introduces new
 * lifecycle semantics; these are read-only derivations around the frozen
 * modules (see docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md, clinical-activation
 * purpose).
 */

import { isDockerBridgeIp } from "./pacs/pacsConfig";
import type { OpsStatus } from "./radiologyOpsHealth";

// ── Check model ──────────────────────────────────────────────────────────────

export type CheckStatus = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";

export interface DiagnosticCheck {
  /** Stable machine id, e.g. "viewer.orthanc_http". */
  id: string;
  name: string;
  status: CheckStatus;
  /** What was actually observed — exact, never vague. */
  detail: string;
  /** Exactly what to do about it (required whenever status is not PASS). */
  fix?: string;
  endpoint?: string;
  httpStatus?: number;
  latencyMs?: number;
  data?: Record<string, unknown>;
}

export interface DiagnosticSection {
  id: string;
  title: string;
  status: CheckStatus;
  checks: DiagnosticCheck[];
}

/** FAIL > WARNING > UNKNOWN > PASS. UNKNOWN never masquerades as PASS; an
 *  empty section is honestly UNKNOWN, not silently healthy. */
const CHECK_RANK: Record<CheckStatus, number> = { PASS: 0, UNKNOWN: 1, WARNING: 2, FAIL: 3 };

export function worstCheckStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.length === 0) return "UNKNOWN";
  return statuses.reduce<CheckStatus>((worst, s) => (CHECK_RANK[s] > CHECK_RANK[worst] ? s : worst), "PASS");
}

export function sectionOf(id: string, title: string, checks: DiagnosticCheck[]): DiagnosticSection {
  return { id, title, status: worstCheckStatus(checks.map((c) => c.status)), checks };
}

/** BEND-1 ops statuses map 1:1 — the Flight Deck AGGREGATES the frozen
 *  /radiology-ops health service instead of re-deriving it. */
export function opsToCheckStatus(status: OpsStatus): CheckStatus {
  switch (status) {
    case "HEALTHY": return "PASS";
    case "DEGRADED": return "WARNING";
    case "UNHEALTHY": return "FAIL";
    default: return "UNKNOWN";
  }
}

/** Traffic light for the admin page: one fixed mapping, tested. */
export function trafficLight(status: CheckStatus): "green" | "yellow" | "red" | "gray" {
  switch (status) {
    case "PASS": return "green";
    case "WARNING": return "yellow";
    case "FAIL": return "red";
    default: return "gray";
  }
}

// ── HTTP response classification ────────────────────────────────────────────

export interface HttpVerdict {
  status: CheckStatus;
  note: string;
}

/** One rule for "what does this response code mean for a probe". 404 is a
 *  FAIL because for OUR probes the path is derived from configuration — a 404
 *  means the configured base URL points at the wrong subpath/service. */
export function classifyHttpResponse(httpStatus: number | undefined, error?: string): HttpVerdict {
  if (httpStatus === undefined) {
    return { status: "FAIL", note: error ? `no response (${error})` : "no response" };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: "WARNING", note: `HTTP ${httpStatus} — endpoint reachable but authentication was refused` };
  }
  if (httpStatus === 404) {
    return { status: "FAIL", note: "HTTP 404 — endpoint reachable but the path does not exist (wrong subpath or wrong service on this host/port)" };
  }
  if (httpStatus === 405) {
    return { status: "WARNING", note: "HTTP 405 — endpoint exists but rejected this method" };
  }
  if (httpStatus >= 500) {
    return { status: "FAIL", note: `HTTP ${httpStatus} — the service answered with a server error` };
  }
  if (httpStatus >= 400) {
    return { status: "WARNING", note: `HTTP ${httpStatus} — endpoint reachable but rejected the request` };
  }
  return { status: "PASS", note: `HTTP ${httpStatus}` };
}

// ── Configured-URL classification (wrong protocol/host/port/subpath) ────────

export interface UrlIssue {
  code:
    | "EMPTY"
    | "UNPARSEABLE"
    | "BAD_SCHEME"
    | "EMBEDDED_CREDENTIALS"
    | "DOCKER_BRIDGE_IP"
    | "LOCALHOST_ONLY"
    | "MIXED_CONTENT"
    | "PLACEHOLDER"
    | "DOUBLE_SLASH_PATH"
    | "WHITESPACE";
  message: string;
  fix: string;
}

/** Deterministic misconfiguration detection for a browser-facing base URL —
 *  the classic wrong-protocol / wrong-host / wrong-port / wrong-subpath
 *  mistakes that make a viewer "silently not open". */
export function analyzeConfiguredUrl(
  raw: string | null | undefined,
  opts: { erpServedHttps?: boolean; role: string } ,
): UrlIssue[] {
  const issues: UrlIssue[] = [];
  if (raw == null || raw.trim() === "") {
    return [{ code: "EMPTY", message: `${opts.role} URL is empty`, fix: `Configure the ${opts.role} URL in Radiology Settings.` }];
  }
  if (raw !== raw.trim()) {
    issues.push({ code: "WHITESPACE", message: `${opts.role} URL has leading/trailing whitespace`, fix: "Remove the surrounding spaces — some clients refuse to parse padded URLs." });
  }
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ code: "UNPARSEABLE", message: `${opts.role} URL "${value}" is not a valid URL`, fix: "Use a full URL including the scheme, e.g. http://192.168.1.137:3010." });
    return issues;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    issues.push({ code: "BAD_SCHEME", message: `${opts.role} URL uses unsupported scheme ${url.protocol}`, fix: "Browsers can only launch http:// or https:// viewer URLs." });
  }
  if (url.username || url.password) {
    issues.push({ code: "EMBEDDED_CREDENTIALS", message: `${opts.role} URL embeds credentials`, fix: "Remove user:pass@ from the URL — launch URLs open in browser tabs and must not leak secrets." });
  }
  if (isDockerBridgeIp(url.hostname)) {
    issues.push({ code: "DOCKER_BRIDGE_IP", message: `${opts.role} URL points at Docker bridge address ${url.hostname}, which only resolves inside the Docker host`, fix: "Use the clinic's real LAN IP, Tailscale IP, or public domain instead." });
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    issues.push({ code: "LOCALHOST_ONLY", message: `${opts.role} URL points at ${url.hostname} — only reachable from the server machine itself`, fix: "Use an address other workstations can reach (LAN IP, Tailscale IP, or domain)." });
  }
  if (opts.erpServedHttps && url.protocol === "http:") {
    issues.push({ code: "MIXED_CONTENT", message: `${opts.role} URL is plain http but the ERP is served over https — browsers block this as mixed content`, fix: "Serve this endpoint over https (or access the ERP over http on the LAN)." });
  }
  if (/YOUR_DOMAIN|example\.com|replit\.app/i.test(value)) {
    issues.push({ code: "PLACEHOLDER", message: `${opts.role} URL still contains a placeholder (${value})`, fix: "Replace the placeholder with the clinic's real address." });
  }
  if (/[^:/]\/{2,}/.test(url.pathname + url.search)) {
    issues.push({ code: "DOUBLE_SLASH_PATH", message: `${opts.role} URL path contains duplicate slashes`, fix: "Remove the doubled '/' — some reverse proxies treat '//' as a different route." });
  }
  return issues;
}

// ── Redirect loop detection ──────────────────────────────────────────────────

export function redirectLoopVerdict(chain: string[]): { loop: boolean; repeated?: string } {
  const seen = new Set<string>();
  for (const rawUrl of chain) {
    const normalized = rawUrl.replace(/\/+$/, "");
    if (seen.has(normalized)) return { loop: true, repeated: normalized };
    seen.add(normalized);
  }
  return { loop: false };
}

// ── CORS verdict (viewer origin → DICOMweb origin) ──────────────────────────

export function corsVerdict(input: {
  viewerOrigin: string | null;
  dicomWebOrigin: string | null;
  allowOrigin: string | null | undefined; // Access-Control-Allow-Origin observed
}): HttpVerdict {
  if (!input.viewerOrigin || !input.dicomWebOrigin) {
    return { status: "UNKNOWN", note: "viewer or DICOMweb URL not configured — CORS not applicable yet" };
  }
  if (input.viewerOrigin === input.dicomWebOrigin) {
    return { status: "PASS", note: "viewer and DICOMweb share one origin — CORS not required" };
  }
  if (input.allowOrigin === "*" || input.allowOrigin === input.viewerOrigin) {
    return { status: "PASS", note: `cross-origin allowed (Access-Control-Allow-Origin: ${input.allowOrigin})` };
  }
  if (input.allowOrigin) {
    return {
      status: "FAIL",
      note: `DICOMweb allows origin ${input.allowOrigin} but the viewer runs on ${input.viewerOrigin} — the browser will block image loading`,
    };
  }
  return {
    status: "FAIL",
    note: `DICOMweb at ${input.dicomWebOrigin} sends no Access-Control-Allow-Origin header, but the viewer runs on ${input.viewerOrigin} — OHIF will show a blank study`,
  };
}

// ── TLS certificate verdict ──────────────────────────────────────────────────

export function certVerdict(input: { validFrom?: Date | null; validTo?: Date | null; now: Date }): HttpVerdict {
  if (!input.validTo) return { status: "UNKNOWN", note: "certificate details unavailable" };
  const daysLeft = Math.floor((input.validTo.getTime() - input.now.getTime()) / 86_400_000);
  if (input.validFrom && input.validFrom.getTime() > input.now.getTime()) {
    return { status: "FAIL", note: `certificate is not valid yet (valid from ${input.validFrom.toISOString()})` };
  }
  if (daysLeft < 0) return { status: "FAIL", note: `certificate EXPIRED ${-daysLeft} day(s) ago (${input.validTo.toISOString()})` };
  if (daysLeft <= 14) return { status: "WARNING", note: `certificate expires in ${daysLeft} day(s) (${input.validTo.toISOString()})` };
  return { status: "PASS", note: `certificate valid, ${daysLeft} day(s) remaining` };
}

// ── pacs_settings verification (Phase 9 — read-only recommendations) ────────

export interface SettingDescriptor {
  key: string;
  category: string;
  purpose: string;
  /** Deprecated/legacy keys are flagged with their replacement — NEVER auto-deleted. */
  deprecated?: { replacedBy?: string; note: string };
  numeric?: { min: number; max: number };
  enumValues?: string[];
  url?: boolean;
  /** Missing recommended keys produce a WARNING finding. */
  recommended?: boolean;
}

/** The grounded registry of every pacs_settings key the radiology stack
 *  actually reads (pacsConfig.ts, studyLaunchService.ts, ai.ts voice config,
 *  RadiologySettingsCenter). Keys outside this list are reported as
 *  unused/orphaned for ADMIN REVIEW — nothing is deleted automatically. */
export const KNOWN_PACS_SETTINGS: SettingDescriptor[] = [
  // viewer — LAN base URLs + launch templates (M1.2 canonical launcher)
  { key: "ohif_base_url", category: "viewer", purpose: "OHIF viewer base URL (LAN)", url: true, recommended: true },
  { key: "ohif_study_url_template", category: "viewer", purpose: "OHIF study launch URL template" },
  { key: "weasis_wado_url", category: "viewer", purpose: "WADO endpoint Weasis connects to (LAN)", url: true },
  { key: "weasis_manifest_url_template", category: "viewer", purpose: "Weasis launch template (weasis:// protocol)" },
  { key: "wado_uri_base_url", category: "viewer", purpose: "legacy WADO-URI base URL", deprecated: { replacedBy: "weasis_wado_url", note: "read only as a fallback when weasis_wado_url is empty" } },
  { key: "dicom_web_base_url", category: "viewer", purpose: "DICOMweb (QIDO/WADO-RS) base URL fallback", url: true },
  { key: "ohif_enabled", category: "viewer", purpose: "enable/disable OHIF launch", enumValues: ["true", "false"] },
  { key: "weasis_enabled", category: "viewer", purpose: "enable/disable Weasis launch", enumValues: ["true", "false"] },
  { key: "default_viewer", category: "viewer", purpose: "default viewer for study launch", enumValues: ["OHIF", "WEASIS", "ohif", "weasis"] },
  { key: "viewer_mode", category: "viewer", purpose: "which viewers are offered", enumValues: ["BOTH", "OHIF_ONLY", "WEASIS_ONLY"] },
  { key: "pacs_ae_title", category: "viewer", purpose: "legacy PACS AE title", deprecated: { replacedBy: "orthanc_ae_title", note: "read only as a fallback" } },
  { key: "pacs_ip", category: "viewer", purpose: "legacy PACS IP", deprecated: { replacedBy: "orthanc_ip", note: "read only as a fallback" } },
  { key: "pacs_port", category: "viewer", purpose: "legacy PACS DICOM port", deprecated: { replacedBy: "conquest_port", note: "read only as a fallback" } },
  // viewer — per-mode network routes (M1.2)
  { key: "ohif_base_url_tailscale", category: "viewer", purpose: "OHIF base URL over Tailscale", url: true },
  { key: "ohif_base_url_cloudflare", category: "viewer", purpose: "OHIF base URL over Cloudflare tunnel", url: true },
  { key: "ohif_base_url_public", category: "viewer", purpose: "OHIF base URL over public IP/domain", url: true },
  { key: "wado_base_url_tailscale", category: "viewer", purpose: "WADO URL over Tailscale", url: true },
  { key: "wado_base_url_cloudflare", category: "viewer", purpose: "WADO URL over Cloudflare tunnel", url: true },
  { key: "wado_base_url_public", category: "viewer", purpose: "WADO URL over public IP/domain", url: true },
  { key: "viewer_probe_url_tailscale", category: "viewer", purpose: "explicit probe URL for Tailscale route", url: true },
  { key: "viewer_probe_url_cloudflare", category: "viewer", purpose: "explicit probe URL for Cloudflare route", url: true },
  { key: "viewer_probe_url_public", category: "viewer", purpose: "explicit probe URL for public route", url: true },
  { key: "viewer_network_mode", category: "viewer", purpose: "default network mode for study launch", enumValues: ["AUTO", "LAN", "TAILSCALE", "CLOUDFLARE", "PUBLIC"] },
  { key: "viewer_network_fallback_order", category: "viewer", purpose: "comma-separated AUTO fallback order" },
  { key: "viewer_probe_path", category: "viewer", purpose: "path appended to base URLs for reachability probes" },
  { key: "viewer_probe_timeout_ms", category: "viewer", purpose: "probe timeout", numeric: { min: 200, max: 10_000 } },
  { key: "viewer_route_cache_ttl_ms", category: "viewer", purpose: "successful-route cache TTL", numeric: { min: 0, max: 300_000 } },
  { key: "public_pacs_host", category: "viewer", purpose: "legacy bare public host", deprecated: { replacedBy: "ohif_base_url_public", note: "only consumed to derive a PUBLIC viewer URL when ohif_base_url_public is empty" } },
  // orthanc
  { key: "orthanc_ae_title", category: "orthanc", purpose: "Orthanc AE title" },
  { key: "orthanc_ip", category: "orthanc", purpose: "Orthanc LAN IP (DICOM + fallback host)" },
  { key: "orthanc_dicom_port", category: "orthanc", purpose: "Orthanc DICOM port", numeric: { min: 1, max: 65_535 } },
  { key: "orthanc_http_port", category: "orthanc", purpose: "Orthanc HTTP port", numeric: { min: 1, max: 65_535 } },
  { key: "orthanc_dicomweb_url", category: "orthanc", purpose: "Orthanc DICOMweb base URL", url: true },
  { key: "orthanc_wado_url", category: "orthanc", purpose: "Orthanc WADO-URI URL", url: true },
  { key: "orthanc_url", category: "orthanc", purpose: "Orthanc base URL (server-side probes)", url: true },
  // conquest
  { key: "conquest_ae_title", category: "conquest", purpose: "Conquest AE title" },
  { key: "conquest_ip", category: "conquest", purpose: "Conquest LAN IP" },
  { key: "conquest_port", category: "conquest", purpose: "Conquest DICOM port", numeric: { min: 1, max: 65_535 } },
  { key: "conquest_wado_url", category: "conquest", purpose: "Conquest WADO URL", url: true },
  // erp
  { key: "erp_lan_url", category: "erp", purpose: "ERP base URL on the LAN", url: true },
  { key: "erp_internal_api_url", category: "erp", purpose: "ERP internal API URL for PACS hooks", url: true },
  { key: "erp_internal_api_key", category: "erp", purpose: "internal API key for PACS hooks (secret)" },
  // network
  { key: "tailscale_host", category: "network", purpose: "Tailscale IP/hostname of the NAS" },
  // workflow (M1.6A) — read by key only; the settings writer defaults it to "general"
  { key: "radiology_lock_ttl_seconds", category: "general", purpose: "study lock TTL (derived expiry)", numeric: { min: 30, max: 86_400 } },
  // report presentation (R1.1/R1.2) — read by key via lib/presentationTemplateStore.
  // Values are template KEYS (system seeds + custom), so no enum pin here.
  { key: "report_presentation_template", category: "report", purpose: "active presentation template (standard copy)" },
  { key: "report_presentation_template_patient", category: "report", purpose: "active presentation template (patient copy — public delivery)" },
  { key: "report_presentation_template_referrer", category: "report", purpose: "active presentation template (referrer copy)" },
  // voice (M1.6B2/B3)
  { key: "voice_enabled", category: "voice", purpose: "voice command layer on/off", enumValues: ["true", "false"] },
  { key: "voice_provider", category: "voice", purpose: "default STT provider", enumValues: ["browser", "server", "local", "auto"] },
  { key: "voice_language", category: "voice", purpose: "dictation language (BCP-47)" },
  { key: "voice_default_mode", category: "voice", purpose: "default voice mode" },
  { key: "voice_confirmation_policy", category: "voice", purpose: "confirmation policy for high-risk voice commands" },
  { key: "voice_auto_punctuation", category: "voice", purpose: "auto punctuation on/off", enumValues: ["true", "false"] },
  { key: "voice_input_device", category: "voice", purpose: "preferred input device label" },
  { key: "voice_ptt_key", category: "voice", purpose: "push-to-talk key" },
  { key: "voice_segment_seconds", category: "voice", purpose: "streaming segment length", numeric: { min: 1, max: 60 } },
  { key: "voice_local_stt_url", category: "voice", purpose: "clinic-local STT server URL", url: true },
  { key: "voice_local_stt_kind", category: "voice", purpose: "local STT protocol", enumValues: ["openai", "whispercpp"] },
  { key: "voice_local_stt_model", category: "voice", purpose: "local STT model name" },
  { key: "voice_local_stt_prompt", category: "voice", purpose: "Whisper vocabulary-biasing prompt (blank = built-in radiology default)" },
];

export interface SettingsFinding {
  kind: "missing" | "duplicate" | "unknown" | "conflict" | "deprecated" | "shadowed" | "invalid_value";
  key: string;
  category?: string;
  message: string;
  /** Read-only recommendation — the Flight Deck NEVER changes or deletes settings. */
  recommendation: string;
}

export interface SettingRow {
  key: string;
  category: string;
  value: string | null;
}

export function classifySettings(
  rows: SettingRow[],
  env: { ohifUrlEnv?: string | null } = {},
): SettingsFinding[] {
  const findings: SettingsFinding[] = [];
  const byKey = new Map<string, SettingRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }
  const descriptorFor = (key: string) => KNOWN_PACS_SETTINGS.find((d) => d.key === key);
  const valueOf = (key: string) => byKey.get(key)?.find((r) => r.value?.trim())?.value?.trim() ?? "";

  // duplicates: same key stored more than once (any category split)
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      const categories = [...new Set(list.map((r) => r.category))];
      const values = [...new Set(list.map((r) => r.value?.trim() ?? ""))];
      findings.push({
        kind: "duplicate",
        key,
        message: `"${key}" is stored ${list.length} times (categories: ${categories.join(", ")})${values.length > 1 ? " with DIFFERENT values" : ""}`,
        recommendation: values.length > 1
          ? `Keep the row in category "${descriptorFor(key)?.category ?? categories[0]}" and remove the others — readers resolve by key+category, so stale copies mislead.`
          : "Remove the redundant duplicate row (values are identical, so this is safe once verified).",
      });
    }
  }

  // per-row: unknown, deprecated, wrong category, invalid values
  for (const row of rows) {
    const desc = descriptorFor(row.key);
    if (!desc) {
      findings.push({
        kind: "unknown",
        key: row.key,
        category: row.category,
        message: `"${row.key}" (category ${row.category}) is not read by any current radiology code path`,
        recommendation: "Orphaned/unused setting — review and remove manually if confirmed obsolete. NOT deleted automatically.",
      });
      continue;
    }
    if (desc.deprecated) {
      findings.push({
        kind: "deprecated",
        key: row.key,
        category: row.category,
        message: `"${row.key}" is a legacy key: ${desc.deprecated.note}`,
        recommendation: desc.deprecated.replacedBy
          ? `Migrate the value to "${desc.deprecated.replacedBy}" and then remove this key.`
          : "Plan removal once no fallback reads remain.",
      });
    }
    if (desc.category !== row.category) {
      findings.push({
        kind: "conflict",
        key: row.key,
        category: row.category,
        message: `"${row.key}" is stored in category "${row.category}" but readers look it up in "${desc.category}"`,
        recommendation: `Re-save the value under category "${desc.category}" — the current row is invisible to the code that needs it.`,
      });
    }
    const value = row.value?.trim() ?? "";
    if (value) {
      if (desc.numeric) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < desc.numeric.min || n > desc.numeric.max) {
          findings.push({
            kind: "invalid_value",
            key: row.key,
            category: row.category,
            message: `"${row.key}" = "${value}" is outside the accepted range ${desc.numeric.min}–${desc.numeric.max}`,
            recommendation: `Set a value between ${desc.numeric.min} and ${desc.numeric.max}; out-of-range values are silently clamped or ignored.`,
          });
        }
      }
      if (desc.enumValues && !desc.enumValues.includes(value)) {
        findings.push({
          kind: "invalid_value",
          key: row.key,
          category: row.category,
          message: `"${row.key}" = "${value}" is not one of: ${desc.enumValues.join(" | ")}`,
          recommendation: `Use one of the accepted values — unknown values fall back to defaults, which hides the misconfiguration.`,
        });
      }
      if (desc.url) {
        try {
          const u = new URL(value);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
        } catch {
          findings.push({
            kind: "invalid_value",
            key: row.key,
            category: row.category,
            message: `"${row.key}" = "${value}" is not a valid http(s) URL`,
            recommendation: "Enter a full URL including the scheme, e.g. http://192.168.1.137:8042.",
          });
        }
      }
    }
  }

  // shadowed: legacy value present AND its replacement set to something different
  const legacyWado = valueOf("wado_uri_base_url");
  const canonicalWado = valueOf("weasis_wado_url");
  if (legacyWado && canonicalWado && legacyWado !== canonicalWado) {
    findings.push({
      kind: "shadowed",
      key: "wado_uri_base_url",
      message: `"wado_uri_base_url" (${legacyWado}) is shadowed by "weasis_wado_url" (${canonicalWado}) — the legacy value is never used while both are set`,
      recommendation: "Delete the legacy wado_uri_base_url row (manually) or align it — a diverging shadow copy misleads future debugging.",
    });
  }
  const legacyPublicHost = valueOf("public_pacs_host");
  const canonicalPublic = valueOf("ohif_base_url_public");
  if (legacyPublicHost && canonicalPublic) {
    findings.push({
      kind: "shadowed",
      key: "public_pacs_host",
      message: `"public_pacs_host" is shadowed by "ohif_base_url_public" — the legacy host is only read when the canonical key is empty`,
      recommendation: "Remove public_pacs_host (manually) once ohif_base_url_public is confirmed working.",
    });
  }

  // conflict with environment: settings win over env by design — surface divergence
  const ohifSetting = valueOf("ohif_base_url");
  if (ohifSetting && env.ohifUrlEnv && ohifSetting.replace(/\/+$/, "") !== env.ohifUrlEnv.replace(/\/+$/, "")) {
    findings.push({
      kind: "conflict",
      key: "ohif_base_url",
      message: `pacs_settings ohif_base_url (${ohifSetting}) differs from the OHIF_URL environment variable (${env.ohifUrlEnv}) — the setting wins`,
      recommendation: "Align OHIF_URL in .env with the setting (or clear one of them) so restarts and re-deploys cannot flip the viewer URL.",
    });
  }

  // missing recommended keys
  for (const desc of KNOWN_PACS_SETTINGS) {
    if (desc.recommended && !valueOf(desc.key)) {
      findings.push({
        kind: "missing",
        key: desc.key,
        message: `recommended setting "${desc.key}" (${desc.purpose}) is not configured`,
        recommendation: `Set "${desc.key}" in Radiology Settings — without it the stack falls back to environment defaults that may not match this clinic.`,
      });
    }
  }

  return findings;
}

// ── Deployment verdict (Phase 8 — never vague) ──────────────────────────────

export type DeploymentVerdict = "HEALTHY" | "DEGRADED" | "BROKEN";

export interface DeploymentFinding {
  severity: "BLOCKER" | "WARNING";
  /** Which check, e.g. "viewer.dicomweb_qido". */
  where: string;
  /** What was observed. */
  why: string;
  /** What to do about it. */
  fix: string;
}

/** Checks whose FAILURE means the radiology stack cannot serve a clinic. */
export const CRITICAL_CHECK_IDS = [
  "system.database",
  "system.startup",
  "system.migrations",
  "viewer.orthanc_http",
  "viewer.dicomweb_qido",
  "viewer.ohif_reachable",
  "viewer.launch_url",
] as const;

export function deriveDeploymentVerdict(sections: DiagnosticSection[]): {
  verdict: DeploymentVerdict;
  findings: DeploymentFinding[];
} {
  const critical = new Set<string>(CRITICAL_CHECK_IDS);
  const findings: DeploymentFinding[] = [];
  let broken = false;
  let degraded = false;

  for (const section of sections) {
    for (const check of section.checks) {
      const fix = check.fix?.trim() || "See the check detail above — it names the exact endpoint and observed response.";
      if (check.status === "FAIL") {
        const isCritical = critical.has(check.id);
        if (isCritical) broken = true;
        else degraded = true;
        findings.push({
          severity: isCritical ? "BLOCKER" : "WARNING",
          where: check.id,
          why: check.detail,
          fix,
        });
      } else if (check.status === "WARNING") {
        degraded = true;
        findings.push({ severity: "WARNING", where: check.id, why: check.detail, fix });
      } else if (check.status === "UNKNOWN" && critical.has(check.id)) {
        degraded = true;
        findings.push({
          severity: "WARNING",
          where: check.id,
          why: `${check.detail} (never verified — a critical check cannot stay UNKNOWN before go-live)`,
          fix,
        });
      }
    }
  }

  return { verdict: broken ? "BROKEN" : degraded ? "DEGRADED" : "HEALTHY", findings };
}
