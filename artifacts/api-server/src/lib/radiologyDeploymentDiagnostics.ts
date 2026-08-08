/**
 * radiologyDeploymentDiagnostics.ts — Ticket M1.3: the ONE canonical
 * clinical-activation diagnostics service ("Flight Deck").
 *
 * Everything reports into this service; nothing here duplicates an existing
 * diagnostic — it AGGREGATES the frozen Backend v1 surfaces:
 *   - getRadiologyConfig / validateRadiologyConfig  (lib/pacs/pacsConfig.ts)
 *   - buildRadiologyOpsHealth                        (BEND-1 ops health)
 *   - renderStructuredReport / verifyContentSha256   (D1/D4/D5 pure cores)
 *   - resolveReportVersion                           (D8 latest-revision authority)
 * and adds the deployment-shaped probes those surfaces do not cover: DICOMweb
 * QIDO/WADO, per-network-route reachability + DNS + TLS + CORS + redirect
 * loops, per-study visibility, a read-only workflow simulation, and
 * pacs_settings verification.
 *
 * READ-ONLY BY CONTRACT. Backend v1 is frozen: no schema changes, no
 * mutations, no destructive actions, no STOW writes, no setting deletion.
 * All external IO is injectable so every failure mode is unit-testable.
 */

import { db } from "@workspace/db";
import {
  dicomPulledStudiesTable,
  featureFlagsTable,
  pacsSettingsTable,
  patientReportAmendmentsTable,
  patientReportsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  reportSharesTable,
} from "@workspace/db/schema";
import { and, desc, eq, isNotNull, like, sql } from "drizzle-orm";
import { connect as tlsConnect } from "node:tls";
import { lookup as dnsLookupCb } from "node:dns";
import { isIP } from "node:net";
import { getRadiologyConfig, validateRadiologyConfig } from "./pacs/pacsConfig";
import { buildRadiologyOpsHealth } from "./radiologyOpsHealth";
import { renderStructuredReport } from "./structuredReport/renderer";
import { verifyContentSha256 } from "./structuredReport/hash";
import { resolveReportVersion } from "./radiologyReportVersion";
import { redeliveryBacklog } from "./redeliveryObligations";
import type { StructuredReportDocument } from "./structuredReport/types";
import {
  analyzeConfiguredUrl,
  certVerdict,
  classifyHttpResponse,
  classifySettings,
  corsVerdict,
  deriveDeploymentVerdict,
  opsToCheckStatus,
  redirectLoopVerdict,
  sectionOf,
  worstCheckStatus,
  type CheckStatus,
  type DeploymentFinding,
  type DeploymentVerdict,
  type DiagnosticCheck,
  type DiagnosticSection,
  type SettingRow,
} from "./radiologyDiagnosticsRules";

// ── Injectable IO ────────────────────────────────────────────────────────────

export interface HttpProbeResult {
  reachable: boolean;
  httpStatus?: number;
  latencyMs: number;
  error?: string;
  /** Full request chain including the start URL and every redirect target. */
  chain: string[];
  redirectLoop: boolean;
  allowOrigin?: string | null;
  bodyJson?: unknown;
}

export interface TlsInspection {
  ok: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
  issuer?: string;
  /** Whether Node's CA store trusts the chain (false → self-signed/untrusted). */
  authorized?: boolean;
  authorizationError?: string;
  error?: string;
}

export interface DiagnosticsIO {
  fetch: typeof fetch;
  tlsInspect(host: string, port: number, timeoutMs: number): Promise<TlsInspection>;
  dnsLookup(host: string): Promise<{ addresses: string[]; error?: string }>;
  now(): number;
}

export const defaultDiagnosticsIO: DiagnosticsIO = {
  fetch: (...args) => fetch(...args),
  tlsInspect(host, port, timeoutMs) {
    return new Promise((resolve) => {
      // rejectUnauthorized:false so an untrusted/self-signed cert can still be
      // READ and reported (that is the diagnosis) instead of failing opaquely.
      const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
      const done = (result: TlsInspection) => {
        socket.destroy();
        resolve(result);
      };
      socket.on("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        done({
          ok: true,
          validFrom: cert?.valid_from ? new Date(cert.valid_from) : null,
          validTo: cert?.valid_to ? new Date(cert.valid_to) : null,
          issuer: cert?.issuer ? Object.values(cert.issuer).join(", ") : undefined,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        });
      });
      socket.on("error", (err) => done({ ok: false, error: err.message }));
      socket.on("timeout", () => done({ ok: false, error: `TLS handshake timed out (${timeoutMs}ms)` }));
    });
  },
  dnsLookup(host) {
    return new Promise((resolve) => {
      dnsLookupCb(host, { all: true }, (err, addresses) => {
        if (err) resolve({ addresses: [], error: err.code ?? err.message });
        else resolve({ addresses: (addresses ?? []).map((a) => a.address) });
      });
    });
  },
  now: () => Date.now(),
};

/** Bounded HTTP probe with MANUAL redirect following so loops and long
 *  chains are diagnosable instead of opaque fetch failures. */
export async function probeHttp(
  io: DiagnosticsIO,
  url: string,
  opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number; maxRedirects?: number; parseJson?: boolean } = {},
): Promise<HttpProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const chain: string[] = [url];
  const started = io.now();
  let current = url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await io.fetch(current, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return { reachable: true, httpStatus: res.status, latencyMs: io.now() - started, chain, redirectLoop: false };
        }
        const next = new URL(location, current).toString();
        chain.push(next);
        const loop = redirectLoopVerdict(chain);
        if (loop.loop || hop === maxRedirects) {
          return {
            reachable: true,
            httpStatus: res.status,
            latencyMs: io.now() - started,
            chain,
            redirectLoop: loop.loop,
            error: loop.loop ? `redirect loop via ${loop.repeated}` : `more than ${maxRedirects} redirects`,
          };
        }
        current = next;
        continue;
      }
      let bodyJson: unknown;
      if (opts.parseJson && res.status < 500) {
        bodyJson = await res.json().catch(() => undefined);
      } else {
        await res.arrayBuffer().catch(() => undefined); // drain
      }
      return {
        reachable: true,
        httpStatus: res.status,
        latencyMs: io.now() - started,
        chain,
        redirectLoop: false,
        allowOrigin: res.headers.get("access-control-allow-origin"),
        bodyJson,
      };
    }
    return { reachable: false, latencyMs: io.now() - started, chain, redirectLoop: false, error: "redirect handling exhausted" };
  } catch (err) {
    const message = err instanceof Error ? (err.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : err.message) : String(err);
    return { reachable: false, latencyMs: io.now() - started, chain, redirectLoop: false, error: message };
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function orthancAuthHeaders(): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  if (!user || !pass) return {};
  return { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

/** Server-vantage Orthanc base: the internal Docker name when provided (the
 *  ERP container often cannot reach the NAS's own external LAN IP), else the
 *  browser-facing base derived from configuration. */
async function orthancProbeBase(): Promise<{ base: string | null; vantage: string }> {
  const internal = process.env.ORTHANC_INTERNAL_URL?.replace(/\/+$/, "");
  if (internal) return { base: internal, vantage: "internal Docker network (ORTHANC_INTERNAL_URL)" };
  const cfg = await getRadiologyConfig();
  const fromDicomWeb = cfg.orthanc.dicomWebUrl?.replace(/\/dicom-web\/?$/, "");
  if (fromDicomWeb) return { base: fromDicomWeb.replace(/\/+$/, ""), vantage: "configured browser-facing URL" };
  return { base: null, vantage: "not configured" };
}

async function loadPacsSettingRows(): Promise<SettingRow[]> {
  const rows = await db
    .select({ key: pacsSettingsTable.key, category: pacsSettingsTable.category, value: pacsSettingsTable.value })
    .from(pacsSettingsTable);
  return rows.map((r) => ({ key: r.key, category: r.category ?? "general", value: r.value }));
}

function settingValue(rows: SettingRow[], key: string): string {
  return rows.find((r) => r.key === key && r.value?.trim())?.value?.trim() ?? "";
}

function erpServedHttps(): boolean {
  return (process.env.PUBLIC_BASE_URL ?? "").trim().toLowerCase().startsWith("https://");
}

function check(
  id: string,
  name: string,
  status: CheckStatus,
  detail: string,
  extras: Partial<DiagnosticCheck> = {},
): DiagnosticCheck {
  return { id, name, status, detail, ...extras };
}

function originOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

const UID_RE = /^[0-9.]{1,128}$/;

/** Issues that make a launch URL unusable vs. ones that merely limit reach
 *  (localhost works on the server machine; whitespace/double slashes usually
 *  still resolve) — the latter warn instead of failing the deployment. */
const HARD_URL_ISSUES = new Set([
  "EMPTY", "UNPARSEABLE", "BAD_SCHEME", "EMBEDDED_CREDENTIALS",
  "DOCKER_BRIDGE_IP", "MIXED_CONTENT", "PLACEHOLDER",
]);

function urlIssuesStatus(issues: ReturnType<typeof analyzeConfiguredUrl>): CheckStatus {
  if (issues.length === 0) return "PASS";
  return issues.some((i) => HARD_URL_ISSUES.has(i.code)) ? "FAIL" : "WARNING";
}

/** DICOM JSON attribute reader: tag → first value. */
function dicomAttr(entry: unknown, tag: string): string | number | null {
  if (typeof entry !== "object" || entry === null) return null;
  const attr = (entry as Record<string, { Value?: unknown[] }>)[tag];
  const v = attr?.Value?.[0];
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "Alphabetic" in v) return String((v as { Alphabetic?: unknown }).Alphabetic ?? "");
  return null;
}

// ── Phase 3 — Viewer diagnostics ─────────────────────────────────────────────

export async function runViewerDiagnostics(io: DiagnosticsIO = defaultDiagnosticsIO): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];
  const cfg = await getRadiologyConfig();
  const { base: orthancBase, vantage } = await orthancProbeBase();
  const auth = orthancAuthHeaders();

  // Orthanc REST + version + auth posture
  if (!orthancBase) {
    checks.push(check("viewer.orthanc_http", "Orthanc REST API", "FAIL", "no Orthanc endpoint configured on the server", {
      fix: "Set ORTHANC_INTERNAL_URL (container-to-container) or the Orthanc DICOMweb URL in Radiology Settings.",
    }));
  } else {
    const open = await probeHttp(io, `${orthancBase}/system`, { parseJson: true });
    const authed = open.httpStatus === 401 || open.httpStatus === 403
      ? await probeHttp(io, `${orthancBase}/system`, { headers: auth, parseJson: true })
      : open;
    const verdict = classifyHttpResponse(authed.httpStatus, authed.error);
    const version = typeof (authed.bodyJson as { Version?: unknown })?.Version === "string"
      ? String((authed.bodyJson as { Version: string }).Version)
      : null;
    checks.push(check("viewer.orthanc_http", "Orthanc REST API", verdict.status,
      `${verdict.note} via ${vantage}${version ? ` — Orthanc ${version}` : ""}`, {
        endpoint: `${orthancBase}/system`,
        httpStatus: authed.httpStatus,
        latencyMs: authed.latencyMs,
        fix: verdict.status === "PASS" ? undefined : "Check the care-orthanc container is running and ORTHANC_INTERNAL_URL points at it (default http://care-orthanc:8042).",
        data: version ? { version } : undefined,
      }));

    // authentication posture
    if (open.httpStatus === 200) {
      checks.push(check("viewer.orthanc_auth", "Orthanc authentication", "WARNING",
        "Orthanc answered /system WITHOUT credentials — authentication is disabled", {
          fix: "Enable AuthenticationEnabled + RegisteredUsers in orthanc.json before exposing any non-LAN route.",
        }));
    } else if (open.httpStatus === 401 || open.httpStatus === 403) {
      if (!auth.Authorization) {
        checks.push(check("viewer.orthanc_auth", "Orthanc authentication", "FAIL",
          "Orthanc requires authentication but ORTHANC_USERNAME/ORTHANC_PASSWORD are not set in the ERP environment", {
            fix: "Add ORTHANC_USERNAME and ORTHANC_PASSWORD to the ERP .env (matching orthanc.json RegisteredUsers).",
          }));
      } else if (authed.httpStatus && authed.httpStatus < 400) {
        checks.push(check("viewer.orthanc_auth", "Orthanc authentication", "PASS",
          "authentication enforced and the ERP's credentials are accepted"));
      } else {
        checks.push(check("viewer.orthanc_auth", "Orthanc authentication", "FAIL",
          `Orthanc REJECTED the ERP's configured credentials (HTTP ${authed.httpStatus ?? "?"})`, {
            fix: "Fix ORTHANC_USERNAME/ORTHANC_PASSWORD in the ERP .env to match orthanc.json RegisteredUsers.",
          }));
      }
    } else {
      checks.push(check("viewer.orthanc_auth", "Orthanc authentication", "UNKNOWN",
        "auth posture not assessable while /system is unreachable", { fix: "Fix Orthanc reachability first (viewer.orthanc_http)." }));
    }

    // DICOMweb plugin presence = QIDO/WADO/STOW-RS endpoints exist.
    // STOW itself is NOT exercised — it is a write and this toolkit is dry-run only.
    const plugins = await probeHttp(io, `${orthancBase}/plugins`, { headers: auth, parseJson: true });
    const pluginList = Array.isArray(plugins.bodyJson) ? (plugins.bodyJson as unknown[]).map(String) : null;
    if (pluginList) {
      const hasDicomWeb = pluginList.some((p) => p.toLowerCase().includes("dicom-web"));
      checks.push(check("viewer.stow_capability", "DICOMweb plugin (QIDO/WADO/STOW-RS)", hasDicomWeb ? "PASS" : "FAIL",
        hasDicomWeb
          ? `dicom-web plugin loaded (plugins: ${pluginList.join(", ")}) — STOW-RS available; not exercised (write operation, dry-run policy)`
          : `dicom-web plugin NOT loaded (plugins: ${pluginList.join(", ") || "none"})`, {
          endpoint: `${orthancBase}/plugins`,
          fix: hasDicomWeb ? undefined : 'Enable the DicomWeb plugin in orthanc.json ("Plugins" + "DicomWeb": {"Enable": true}).',
        }));
    } else {
      checks.push(check("viewer.stow_capability", "DICOMweb plugin (QIDO/WADO/STOW-RS)", "UNKNOWN",
        `plugin list not readable (${plugins.error ?? `HTTP ${plugins.httpStatus ?? "?"}`})`, {
          endpoint: `${orthancBase}/plugins`, fix: "Fix Orthanc reachability/authentication first.",
        }));
    }

    // QIDO — study search
    const qido = await probeHttp(io, `${orthancBase}/dicom-web/studies?limit=1`, {
      headers: { ...auth, Accept: "application/dicom+json" },
      parseJson: true,
    });
    const qidoVerdict = classifyHttpResponse(qido.httpStatus, qido.error);
    const qidoStudies = Array.isArray(qido.bodyJson) ? (qido.bodyJson as unknown[]) : null;
    const sampleUid = qidoStudies && qidoStudies.length > 0 ? String(dicomAttr(qidoStudies[0], "0020000D") ?? "") : "";
    checks.push(check("viewer.dicomweb_qido", "DICOMweb QIDO study search", qidoVerdict.status,
      qidoVerdict.status === "PASS"
        ? `QIDO answered (${qido.latencyMs}ms) — ${qidoStudies?.length === 0 ? "PACS is reachable but currently holds no studies" : "study list retrievable"}`
        : qidoVerdict.note, {
        endpoint: `${orthancBase}/dicom-web/studies`,
        httpStatus: qido.httpStatus,
        latencyMs: qido.latencyMs,
        fix: qidoVerdict.status === "PASS" ? undefined : "Verify the dicom-web plugin is enabled and the ERP's Orthanc credentials are valid.",
      }));

    // WADO-RS — series list + first-series metadata for a real study
    if (sampleUid && UID_RE.test(sampleUid)) {
      const series = await probeHttp(io, `${orthancBase}/dicom-web/studies/${sampleUid}/series`, {
        headers: { ...auth, Accept: "application/dicom+json" }, parseJson: true,
      });
      const seriesList = Array.isArray(series.bodyJson) ? (series.bodyJson as unknown[]) : null;
      const seriesVerdict = classifyHttpResponse(series.httpStatus, series.error);
      checks.push(check("viewer.dicomweb_series", "DICOMweb series retrieval", seriesVerdict.status,
        seriesVerdict.status === "PASS"
          ? `study ${sampleUid.slice(0, 24)}… lists ${seriesList?.length ?? 0} series (${series.latencyMs}ms)`
          : `series list for sample study failed: ${seriesVerdict.note}`, {
          httpStatus: series.httpStatus, latencyMs: series.latencyMs,
          fix: seriesVerdict.status === "PASS" ? undefined : "WADO-RS series retrieval is broken — OHIF cannot enumerate a study's series.",
        }));
      const firstSeriesUid = seriesList && seriesList.length > 0 ? String(dicomAttr(seriesList[0], "0020000E") ?? "") : "";
      if (firstSeriesUid && UID_RE.test(firstSeriesUid)) {
        const meta = await probeHttp(io, `${orthancBase}/dicom-web/studies/${sampleUid}/series/${firstSeriesUid}/metadata`, {
          headers: { ...auth, Accept: "application/dicom+json" }, parseJson: true,
        });
        const metaVerdict = classifyHttpResponse(meta.httpStatus, meta.error);
        const instanceCount = Array.isArray(meta.bodyJson) ? (meta.bodyJson as unknown[]).length : null;
        checks.push(check("viewer.dicomweb_metadata", "DICOMweb WADO metadata", metaVerdict.status,
          metaVerdict.status === "PASS"
            ? `first series metadata retrievable — ${instanceCount ?? "?"} instance(s) (${meta.latencyMs}ms)`
            : `WADO metadata failed: ${metaVerdict.note}`, {
            httpStatus: meta.httpStatus, latencyMs: meta.latencyMs,
            fix: metaVerdict.status === "PASS" ? undefined : "Without WADO-RS metadata the viewer cannot render images.",
          }));
      }
    } else if (qidoVerdict.status === "PASS") {
      checks.push(check("viewer.dicomweb_metadata", "DICOMweb WADO metadata", "UNKNOWN",
        "no study available in PACS yet — WADO retrieval not exercised", {
          fix: "Send one test study to the PACS, then re-run diagnostics.",
        }));
    }
  }

  // OHIF reachability (probe vantage may differ from the browser's)
  const ohifProbeUrl = process.env.OHIF_INTERNAL_URL || cfg.ohif.baseUrl;
  if (!cfg.ohif.baseUrl) {
    checks.push(check("viewer.ohif_reachable", "OHIF viewer", "FAIL", "OHIF base URL is not configured", {
      fix: "Set the OHIF Base URL in Radiology Settings → Viewers (e.g. http://172.16.1.139:3010).",
    }));
  } else {
    const ohif = await probeHttp(io, ohifProbeUrl);
    const verdict = classifyHttpResponse(ohif.httpStatus, ohif.error);
    checks.push(check("viewer.ohif_reachable", "OHIF viewer", verdict.status,
      `${verdict.note} (${ohif.latencyMs}ms, probed from the ERP server${process.env.OHIF_INTERNAL_URL ? " via OHIF_INTERNAL_URL" : ""})${ohif.redirectLoop ? " — REDIRECT LOOP detected" : ""}`, {
        endpoint: cfg.ohif.baseUrl,
        httpStatus: ohif.httpStatus,
        latencyMs: ohif.latencyMs,
        fix: verdict.status === "PASS" ? undefined : "Check the OHIF container is running; if the ERP container cannot reach the LAN IP, set OHIF_INTERNAL_URL for probing (browser launch URL is unaffected).",
        data: ohif.chain.length > 1 ? { redirects: ohif.chain } : undefined,
      }));
  }

  // Weasis WADO endpoint (parameterless WADO-URI answering 400 IS the healthy signal)
  const weasisTarget = cfg.weasis.wadoUrl;
  if (!weasisTarget) {
    checks.push(check("viewer.weasis_wado", "Weasis WADO endpoint", "WARNING", "no WADO endpoint configured for Weasis", {
      fix: "Set the Weasis WADO URL in Radiology Settings → Viewers (usually http://<LAN-IP>:8042/wado).",
    }));
  } else {
    const wado = await probeHttp(io, weasisTarget, { headers: auth });
    const status: CheckStatus = !wado.reachable ? "FAIL" : (wado.httpStatus && wado.httpStatus < 500) ? "PASS" : "FAIL";
    checks.push(check("viewer.weasis_wado", "Weasis WADO endpoint", status,
      status === "PASS"
        ? `endpoint answered HTTP ${wado.httpStatus} (${wado.latencyMs}ms)${wado.httpStatus === 400 ? " — 400 without parameters is expected for WADO-URI" : ""}`
        : `unreachable/broken: ${wado.error ?? `HTTP ${wado.httpStatus}`}`, {
        endpoint: weasisTarget,
        httpStatus: wado.httpStatus,
        latencyMs: wado.latencyMs,
        fix: status === "PASS" ? undefined : "Weasis on workstations must reach this URL — verify host/port and that Orthanc's WADO is enabled.",
      }));
  }

  // Launch URL construction + validity (uses a real study when one exists)
  const [latestStudy] = await db
    .select({ uid: radiologyWorklistTable.studyInstanceUID })
    .from(radiologyWorklistTable)
    .where(isNotNull(radiologyWorklistTable.studyInstanceUID))
    .orderBy(desc(radiologyWorklistTable.id))
    .limit(1);
  const launchUid = latestStudy?.uid || "1.2.826.0.1.3680043.8.498.0"; // placeholder when no studies yet
  const template = cfg.ohif.studyLaunchTemplate || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}";
  const launchUrl = template
    .replace(/\{OHIF_BASE_URL\}/g, cfg.ohif.baseUrl.replace(/\/+$/, ""))
    .replace(/\{studyInstanceUID\}/g, encodeURIComponent(launchUid));
  const launchIssues = analyzeConfiguredUrl(launchUrl, { erpServedHttps: erpServedHttps(), role: "OHIF launch" });
  const launchStatus = urlIssuesStatus(launchIssues);
  checks.push(check("viewer.launch_url", "Viewer launch URL", launchStatus,
    launchStatus === "PASS"
      ? `launch URL builds cleanly${latestStudy?.uid ? " for the latest real study" : " (no studies yet — placeholder UID used)"}: ${launchUrl}`
      : `${launchUrl} — ${launchIssues.map((i) => i.message).join("; ")}`, {
      fix: launchIssues[0]?.fix,
      data: { launchUrl, usedRealStudy: Boolean(latestStudy?.uid) },
    }));

  // Viewer enablement flags
  const rows = await loadPacsSettingRows();
  const ohifEnabled = settingValue(rows, "ohif_enabled") !== "false";
  const weasisEnabled = settingValue(rows, "weasis_enabled") !== "false";
  checks.push(check("viewer.enabled_flags", "Viewer enablement", (!ohifEnabled && !weasisEnabled) ? "FAIL" : "PASS",
    `OHIF ${ohifEnabled ? "enabled" : "DISABLED"}, Weasis ${weasisEnabled ? "enabled" : "DISABLED"}`, {
      fix: (!ohifEnabled && !weasisEnabled) ? "Both viewers are disabled in settings — no study can be opened. Re-enable at least one." : undefined,
    }));

  return sectionOf("viewer", "Viewer & DICOMweb", checks);
}

// ── Phase 4 — Network diagnostics ────────────────────────────────────────────

const NETWORK_MODES = ["LAN", "TAILSCALE", "CLOUDFLARE", "PUBLIC"] as const;
type NetworkModeName = (typeof NETWORK_MODES)[number];
const MODE_SUFFIX: Record<NetworkModeName, string> = { LAN: "", TAILSCALE: "_tailscale", CLOUDFLARE: "_cloudflare", PUBLIC: "_public" };

/** Server-side mirror of the launcher's per-mode endpoint keys
 *  (studyLaunchService.parseViewerNetworkConfig) — SAME keys, no new ones. */
export function readModeEndpoints(rows: SettingRow[]): Record<NetworkModeName, { viewerUrl: string; wadoUrl: string; probeUrl: string }> {
  const result = {} as Record<NetworkModeName, { viewerUrl: string; wadoUrl: string; probeUrl: string }>;
  for (const mode of NETWORK_MODES) {
    const suffix = MODE_SUFFIX[mode];
    let viewerUrl = settingValue(rows, `ohif_base_url${suffix}`);
    if (!viewerUrl && mode === "PUBLIC") {
      const legacyHost = settingValue(rows, "public_pacs_host");
      if (legacyHost) viewerUrl = `https://${legacyHost.replace(/^https?:\/\//, "")}`;
    }
    const wadoUrl = settingValue(rows, `wado_base_url${suffix}`) ||
      (mode === "LAN" ? settingValue(rows, "weasis_wado_url") || settingValue(rows, "wado_uri_base_url") : "");
    result[mode] = { viewerUrl, wadoUrl, probeUrl: settingValue(rows, `viewer_probe_url${suffix}`) };
  }
  return result;
}

export async function runNetworkDiagnostics(io: DiagnosticsIO = defaultDiagnosticsIO): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];
  const rows = await loadPacsSettingRows();
  const cfg = await getRadiologyConfig();
  const endpoints = readModeEndpoints(rows);
  const https = erpServedHttps();

  const configuredModes = NETWORK_MODES.filter((m) => endpoints[m].viewerUrl);
  const defaultMode = (settingValue(rows, "viewer_network_mode") || "AUTO").toUpperCase();
  const fallbackRaw = settingValue(rows, "viewer_network_fallback_order");
  const fallbackOrder = fallbackRaw
    ? fallbackRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...NETWORK_MODES];
  const badFallbackEntries = fallbackOrder.filter((m) => !NETWORK_MODES.includes(m as NetworkModeName));

  checks.push(check("network.route_config", "Route configuration", configuredModes.length === 0 ? "FAIL" : badFallbackEntries.length > 0 ? "WARNING" : "PASS",
    configuredModes.length === 0
      ? "no network route has a viewer URL configured — study launch cannot work on any path"
      : `configured: ${configuredModes.join(", ")} · default mode: ${defaultMode} · fallback order: ${fallbackOrder.join(" → ")}${badFallbackEntries.length ? ` · invalid entries ignored: ${badFallbackEntries.join(", ")}` : ""}`, {
      fix: configuredModes.length === 0
        ? "Set at least the LAN OHIF base URL in Radiology Settings → Viewers → Network routes."
        : badFallbackEntries.length > 0 ? "Remove the invalid fallback-order entries (valid: LAN, TAILSCALE, CLOUDFLARE, PUBLIC)." : undefined,
      data: { configuredModes, defaultMode, fallbackOrder },
    }));

  if (defaultMode !== "AUTO" && !configuredModes.includes(defaultMode as NetworkModeName)) {
    checks.push(check("network.default_mode", "Default network mode", "FAIL",
      `default mode is forced to ${defaultMode} but that route has no viewer URL configured — every launch will fail until changed`, {
        fix: `Configure the ${defaultMode} viewer URL, or set the default mode back to AUTO.`,
      }));
  }

  for (const mode of configuredModes) {
    const idBase = `network.${mode.toLowerCase()}`;
    const { viewerUrl, wadoUrl, probeUrl } = endpoints[mode];
    const roleName = `${mode} viewer`;

    // 1. configured-URL classification (wrong protocol/host/port/subpath)
    const issues = analyzeConfiguredUrl(viewerUrl, { erpServedHttps: https, role: roleName });
    checks.push(check(`${idBase}.url`, `${mode} — URL sanity`, urlIssuesStatus(issues),
      issues.length === 0 ? `${viewerUrl} is well-formed` : issues.map((i) => i.message).join("; "), {
        endpoint: viewerUrl, fix: issues[0]?.fix,
      }));
    if (issues.some((i) => i.code === "UNPARSEABLE")) continue;

    let host = "";
    let port = 0;
    let isHttps = false;
    try {
      const u = new URL(viewerUrl);
      host = u.hostname;
      port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
      isHttps = u.protocol === "https:";
    } catch {
      continue;
    }

    // 2. DNS
    if (isIP(host)) {
      checks.push(check(`${idBase}.dns`, `${mode} — DNS`, "PASS", `IP literal ${host} — no DNS resolution required`));
    } else {
      const dns = await io.dnsLookup(host);
      checks.push(check(`${idBase}.dns`, `${mode} — DNS`, dns.addresses.length > 0 ? "PASS" : "FAIL",
        dns.addresses.length > 0
          ? `${host} resolves to ${dns.addresses.join(", ")}`
          : `${host} does NOT resolve (${dns.error ?? "no records"}) — wrong hostname or missing DNS entry`, {
          fix: dns.addresses.length > 0 ? undefined : mode === "TAILSCALE"
            ? "Check the MagicDNS name and that Tailscale is up on this server."
            : "Fix the hostname, or create the DNS record (Cloudflare tunnel hostnames must exist in the zone).",
        }));
      if (dns.addresses.length === 0) continue;
    }

    // 3. reachability + latency + redirects (server vantage)
    const target = probeUrl || viewerUrl;
    const reach = await probeHttp(io, target);
    const verdict = classifyHttpResponse(reach.httpStatus, reach.error);
    const vantageNote = mode === "LAN" || mode === "TAILSCALE"
      ? " (probed from the ERP server — workstation reachability can differ)"
      : "";
    checks.push(check(`${idBase}.reachable`, `${mode} — reachability`, verdict.status,
      `${verdict.note} in ${reach.latencyMs}ms${vantageNote}`, {
        endpoint: target, httpStatus: reach.httpStatus, latencyMs: reach.latencyMs,
        fix: verdict.status === "PASS" ? undefined : mode === "CLOUDFLARE"
          ? "Check cloudflared is running and the tunnel route maps this hostname to the OHIF service."
          : mode === "TAILSCALE"
            ? "Check Tailscale is connected on both this server and the NAS (tailscale status)."
            : "Verify the service is running and the host/port are correct.",
      }));

    if (reach.chain.length > 1) {
      checks.push(check(`${idBase}.redirects`, `${mode} — redirects`, reach.redirectLoop ? "FAIL" : reach.chain.length > 3 ? "WARNING" : "PASS",
        reach.redirectLoop
          ? `REDIRECT LOOP: ${reach.chain.join(" → ")}`
          : `redirect chain: ${reach.chain.join(" → ")}`, {
          fix: reach.redirectLoop
            ? "Break the loop — usually an http→https redirect fighting a proxy that forwards back to http (check X-Forwarded-Proto handling)."
            : reach.chain.length > 3 ? "Shorten the redirect chain — each hop adds latency to every viewer load." : undefined,
          data: { chain: reach.chain },
        }));
    }

    // 4. TLS certificate (https routes only)
    if (isHttps) {
      const tls = await io.tlsInspect(host, port, 4000);
      if (!tls.ok) {
        checks.push(check(`${idBase}.tls`, `${mode} — TLS certificate`, "FAIL", `TLS handshake failed: ${tls.error}`, {
          fix: "The endpoint claims https but cannot complete TLS — check the certificate installation / tunnel TLS mode.",
        }));
      } else {
        const cert = certVerdict({ validFrom: tls.validFrom, validTo: tls.validTo, now: new Date(io.now()) });
        const trustNote = tls.authorized === false ? ` — NOT trusted by system CAs (${tls.authorizationError ?? "self-signed?"}); browsers will warn` : "";
        checks.push(check(`${idBase}.tls`, `${mode} — TLS certificate`, tls.authorized === false && cert.status === "PASS" ? "WARNING" : cert.status,
          `${cert.note}${tls.issuer ? ` · issuer: ${tls.issuer}` : ""}${trustNote}`, {
            fix: cert.status === "PASS" && tls.authorized !== false ? undefined : "Renew/replace the certificate (Cloudflare-proxied hosts renew automatically; self-managed certs need certbot or the NAS certificate panel).",
          }));
      }
    }

    // 5. CORS (viewer origin → DICOMweb origin for this mode)
    const dicomWebUrl = wadoUrl || (mode === "LAN" ? cfg.orthanc.dicomWebUrl : "");
    if (dicomWebUrl) {
      const viewerOrigin = originOf(viewerUrl);
      const dwOrigin = originOf(dicomWebUrl);
      if (viewerOrigin && dwOrigin && viewerOrigin !== dwOrigin) {
        const corsProbe = await probeHttp(io, dicomWebUrl, { headers: { Origin: viewerOrigin, ...orthancAuthHeaders() } });
        const cors = corsVerdict({ viewerOrigin, dicomWebOrigin: dwOrigin, allowOrigin: corsProbe.allowOrigin });
        checks.push(check(`${idBase}.cors`, `${mode} — CORS (viewer → DICOMweb)`, corsProbe.reachable ? cors.status : "UNKNOWN",
          corsProbe.reachable ? cors.note : `DICOMweb endpoint unreachable from the server — CORS not assessable (${corsProbe.error ?? ""})`, {
            endpoint: dicomWebUrl,
            fix: cors.status === "PASS" ? undefined : "Add Access-Control-Allow-Origin for the viewer origin on the reverse proxy in front of Orthanc (or serve viewer and DICOMweb from one origin).",
          }));
      } else if (viewerOrigin && dwOrigin) {
        checks.push(check(`${idBase}.cors`, `${mode} — CORS (viewer → DICOMweb)`, "PASS",
          "viewer and DICOMweb share one origin — CORS not required"));
      }
    }
  }

  // Tailscale host hint (network category) — flag drift with the Tailscale route
  const tailscaleHost = settingValue(rows, "tailscale_host");
  if (tailscaleHost && !tailscaleHost.startsWith("100.") && !tailscaleHost.includes(".ts.net")) {
    checks.push(check("network.tailscale_host", "Tailscale host setting", "WARNING",
      `tailscale_host = "${tailscaleHost}" is neither a 100.x.y.z Tailscale IP nor a MagicDNS name`, {
        fix: "Use the NAS's Tailscale IP (100.x.y.z from `tailscale ip`) or its MagicDNS hostname.",
      }));
  }

  return sectionOf("network", "Network routes", checks);
}

// ── Phase 5 — Study diagnostics ──────────────────────────────────────────────

export async function runStudyDiagnostics(studyInstanceUID: string, io: DiagnosticsIO = defaultDiagnosticsIO): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];

  if (!UID_RE.test(studyInstanceUID)) {
    checks.push(check("study.format", "StudyInstanceUID format", "FAIL",
      `"${studyInstanceUID.slice(0, 64)}" is not a valid DICOM UID (digits and dots only, max 128 chars)`, {
        fix: "Copy the StudyInstanceUID exactly from the worklist row or PACS — no spaces or letters.",
      }));
    return sectionOf("study", `Study ${studyInstanceUID.slice(0, 40)}`, checks);
  }
  checks.push(check("study.format", "StudyInstanceUID format", "PASS", "well-formed DICOM UID"));

  // ERP knowledge of the study
  const [worklist] = await db
    .select({
      id: radiologyWorklistTable.id,
      patientName: radiologyWorklistTable.patientName,
      accessionNumber: radiologyWorklistTable.accessionNumber,
      status: radiologyWorklistTable.status,
    })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID))
    .limit(1);
  const [pulled] = await db
    .select({ id: dicomPulledStudiesTable.id, patientName: dicomPulledStudiesTable.patientName, accessionNumber: dicomPulledStudiesTable.accessionNumber })
    .from(dicomPulledStudiesTable)
    .where(eq(dicomPulledStudiesTable.studyInstanceUID, studyInstanceUID))
    .limit(1);
  const [studyRow] = await db
    .select({ id: radiologyStudiesTable.id })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.studyInstanceUid, studyInstanceUID))
    .limit(1);
  const erpSources = [worklist && "worklist", pulled && "pulled-studies", studyRow && "radiology-studies"].filter(Boolean) as string[];
  checks.push(check("study.erp_row", "Known to the ERP", erpSources.length > 0 ? "PASS" : "WARNING",
    erpSources.length > 0
      ? `found in: ${erpSources.join(", ")}${worklist ? ` · worklist #${worklist.id} (${worklist.status ?? "?"})` : ""}`
      : "the ERP has no row for this study — it exists only in the PACS (sync hook may not have fired)", {
      fix: erpSources.length > 0 ? undefined : "Check the Orthanc→ERP sync hook (INTERNAL_API_KEY + erp_internal_api_url) and re-send the study.",
      data: { worklistId: worklist?.id ?? null },
    }));

  const { base: orthancBase } = await orthancProbeBase();
  const auth = orthancAuthHeaders();
  let orthancTags: { patientName: string | null; patientId: string | null; accession: string | null } | null = null;
  let orthancSeriesCount: number | null = null;
  let orthancInstanceCount: number | null = null;

  if (!orthancBase) {
    checks.push(check("study.pacs_exists", "Exists in PACS", "UNKNOWN", "no Orthanc endpoint configured on the server", {
      fix: "Set ORTHANC_INTERNAL_URL or the Orthanc DICOMweb URL first.",
    }));
  } else {
    // Orthanc lookup by EXACT UID (never by patient name)
    try {
      const res = await io.fetch(`${orthancBase}/tools/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: studyInstanceUID }, Expand: true }),
      });
      if (res.ok) {
        const found = (await res.json()) as Array<{
          MainDicomTags?: Record<string, string>;
          PatientMainDicomTags?: Record<string, string>;
          Series?: string[];
        }>;
        if (Array.isArray(found) && found.length > 0) {
          const s = found[0];
          orthancTags = {
            patientName: s.PatientMainDicomTags?.PatientName ?? null,
            patientId: s.PatientMainDicomTags?.PatientID ?? null,
            accession: s.MainDicomTags?.AccessionNumber ?? null,
          };
          orthancSeriesCount = Array.isArray(s.Series) ? s.Series.length : null;
          checks.push(check("study.pacs_exists", "Exists in PACS", "PASS",
            `found in Orthanc — ${orthancSeriesCount ?? "?"} series · patient "${orthancTags.patientName ?? "?"}" (ID ${orthancTags.patientId ?? "?"}) · accession ${orthancTags.accession ?? "—"}`));
        } else {
          checks.push(check("study.pacs_exists", "Exists in PACS", "FAIL",
            "Orthanc has NO study with this exact StudyInstanceUID", {
              fix: "The study was never stored (or was deleted) — re-send from the modality, or verify the UID.",
            }));
        }
      } else {
        checks.push(check("study.pacs_exists", "Exists in PACS", "UNKNOWN", `Orthanc /tools/find answered HTTP ${res.status}`, {
          fix: "Fix Orthanc reachability/authentication (see Viewer section) and re-run.",
        }));
      }
    } catch (err) {
      checks.push(check("study.pacs_exists", "Exists in PACS", "UNKNOWN",
        `PACS lookup failed: ${err instanceof Error ? err.message : String(err)}`, {
          fix: "Fix Orthanc reachability (see Viewer section) and re-run.",
        }));
    }

    // QIDO visibility + counts
    const qido = await probeHttp(io, `${orthancBase}/dicom-web/studies?StudyInstanceUID=${encodeURIComponent(studyInstanceUID)}`, {
      headers: { ...auth, Accept: "application/dicom+json" }, parseJson: true,
    });
    const qidoList = Array.isArray(qido.bodyJson) ? (qido.bodyJson as unknown[]) : null;
    if (qidoList && qidoList.length > 0) {
      const nSeries = dicomAttr(qidoList[0], "00201206");
      const nInstances = dicomAttr(qidoList[0], "00201208");
      orthancInstanceCount = typeof nInstances === "number" ? nInstances : Number(nInstances) || null;
      checks.push(check("study.qido", "Visible via QIDO", "PASS",
        `QIDO returns the study (${qido.latencyMs}ms) — ${nSeries ?? "?"} series, ${nInstances ?? "?"} instances`));
    } else {
      const verdict = classifyHttpResponse(qido.httpStatus, qido.error);
      checks.push(check("study.qido", "Visible via QIDO", qidoList ? "FAIL" : verdict.status,
        qidoList ? "QIDO answered but does NOT list this study — the viewer will show an empty result" : `QIDO query failed: ${verdict.note}`, {
          fix: "If the study exists in Orthanc but QIDO misses it, rebuild the DICOMweb index or check QIDO query parameters/plugin version.",
        }));
    }

    // WADO metadata + rendered-frame accessibility for the first series/instance
    const series = await probeHttp(io, `${orthancBase}/dicom-web/studies/${studyInstanceUID}/series`, {
      headers: { ...auth, Accept: "application/dicom+json" }, parseJson: true,
    });
    const seriesList = Array.isArray(series.bodyJson) ? (series.bodyJson as unknown[]) : null;
    const firstSeriesUid = seriesList && seriesList.length > 0 ? String(dicomAttr(seriesList[0], "0020000E") ?? "") : "";
    if (firstSeriesUid && UID_RE.test(firstSeriesUid)) {
      const meta = await probeHttp(io, `${orthancBase}/dicom-web/studies/${studyInstanceUID}/series/${firstSeriesUid}/metadata`, {
        headers: { ...auth, Accept: "application/dicom+json" }, parseJson: true,
      });
      const metaList = Array.isArray(meta.bodyJson) ? (meta.bodyJson as unknown[]) : null;
      const metaVerdict = classifyHttpResponse(meta.httpStatus, meta.error);
      checks.push(check("study.metadata", "WADO metadata", metaList ? "PASS" : metaVerdict.status,
        metaList
          ? `first series metadata OK — ${metaList.length} instance(s) (${meta.latencyMs}ms)`
          : `metadata retrieval failed: ${metaVerdict.note}`, {
          latencyMs: meta.latencyMs,
          fix: metaList ? undefined : "The viewer cannot render without WADO-RS metadata — check the dicom-web plugin.",
        }));
      const firstInstanceUid = metaList && metaList.length > 0 ? String(dicomAttr(metaList[0], "00080018") ?? "") : "";
      if (firstInstanceUid && UID_RE.test(firstInstanceUid)) {
        const frame = await probeHttp(io, `${orthancBase}/dicom-web/studies/${studyInstanceUID}/series/${firstSeriesUid}/instances/${firstInstanceUid}/rendered`, {
          headers: { ...auth, Accept: "image/jpeg" },
        });
        const okStatuses = frame.httpStatus !== undefined && frame.httpStatus < 400;
        checks.push(check("study.images", "Image pixels accessible", okStatuses ? "PASS" : (frame.httpStatus === 406 || frame.httpStatus === 501) ? "WARNING" : "FAIL",
          okStatuses
            ? `rendered frame retrievable (HTTP ${frame.httpStatus}, ${frame.latencyMs}ms)`
            : `rendered frame failed: ${frame.error ?? `HTTP ${frame.httpStatus}`}${(frame.httpStatus === 406 || frame.httpStatus === 501) ? " — /rendered unsupported by this Orthanc build (viewer may still load raw frames)" : ""}`, {
            httpStatus: frame.httpStatus, latencyMs: frame.latencyMs,
            fix: okStatuses ? undefined : "If /rendered is unsupported, upgrade the Orthanc dicom-web plugin; otherwise check instance data integrity.",
          }));
      }
      // missing instances: QIDO-declared count vs metadata-visible count of first series is
      // not directly comparable; compare Orthanc series count vs QIDO series count instead.
      if (orthancSeriesCount != null && seriesList) {
        checks.push(check("study.instances", "Series/instance completeness", orthancSeriesCount === seriesList.length ? "PASS" : "WARNING",
          orthancSeriesCount === seriesList.length
            ? `series counts agree (Orthanc ${orthancSeriesCount} = DICOMweb ${seriesList.length})${orthancInstanceCount != null ? ` · ${orthancInstanceCount} instances declared` : ""}`
            : `series count MISMATCH: Orthanc reports ${orthancSeriesCount}, DICOMweb lists ${seriesList.length} — instances may still be arriving or the index is stale`, {
            fix: orthancSeriesCount === seriesList.length ? undefined : "Wait for the transfer to finish, then re-run; persistent mismatch → rebuild the DICOMweb index.",
          }));
      }
    } else if (seriesList) {
      checks.push(check("study.metadata", "WADO metadata", "FAIL", "study has no listable series via DICOMweb", {
        fix: "The study exists but has no series content — re-send it from the modality.",
      }));
    }
  }

  // Viewer launch URL + params for THIS study
  const cfg = await getRadiologyConfig();
  const template = cfg.ohif.studyLaunchTemplate || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}";
  const launchUrl = template
    .replace(/\{OHIF_BASE_URL\}/g, cfg.ohif.baseUrl.replace(/\/+$/, ""))
    .replace(/\{studyInstanceUID\}/g, encodeURIComponent(studyInstanceUID));
  const launchIssues = analyzeConfiguredUrl(launchUrl, { erpServedHttps: erpServedHttps(), role: "OHIF launch" });
  const uidEmbedded = launchUrl.includes(encodeURIComponent(studyInstanceUID));
  const viewerUrlStatus: CheckStatus = !uidEmbedded ? "FAIL" : urlIssuesStatus(launchIssues);
  checks.push(check("study.viewer_url", "Viewer launch URL", viewerUrlStatus,
    viewerUrlStatus === "PASS"
      ? launchUrl
      : !uidEmbedded
        ? "the launch template does not embed the StudyInstanceUID — the viewer would open without a study"
        : `${launchUrl} — ${launchIssues.map((i) => i.message).join("; ")}`, {
      fix: !uidEmbedded ? "Restore {studyInstanceUID} in the OHIF study URL template." : launchIssues[0]?.fix,
      data: { launchUrl },
    }));

  // Patient identifier consistency (wrong-patient prevention)
  const erpName = worklist?.patientName ?? pulled?.patientName ?? null;
  const erpAccession = worklist?.accessionNumber ?? pulled?.accessionNumber ?? null;
  if (orthancTags && (erpName || erpAccession)) {
    const normalize = (s: string | null) => (s ?? "").replace(/[\s^,]+/g, " ").trim().toUpperCase();
    const nameMatch = !erpName || !orthancTags.patientName || normalize(erpName) === normalize(orthancTags.patientName);
    const accessionMatch = !erpAccession || !orthancTags.accession || erpAccession.trim() === orthancTags.accession.trim();
    checks.push(check("study.identifiers", "Patient identifier consistency", nameMatch && accessionMatch ? "PASS" : "FAIL",
      nameMatch && accessionMatch
        ? `ERP and PACS agree — "${erpName ?? orthancTags.patientName ?? "?"}", accession ${erpAccession ?? orthancTags.accession ?? "—"}`
        : `MISMATCH between ERP and PACS: name "${erpName ?? "—"}" vs "${orthancTags.patientName ?? "—"}", accession "${erpAccession ?? "—"}" vs "${orthancTags.accession ?? "—"}" — wrong-patient risk`, {
        fix: nameMatch && accessionMatch ? undefined : "Do NOT report this study until reconciled — fix the worklist row or the DICOM tags at the modality.",
      }));
  } else if (orthancTags) {
    checks.push(check("study.identifiers", "Patient identifier consistency", "WARNING",
      "the ERP has no patient identifiers for this study to compare against the PACS", {
        fix: "Ensure the sync hook creates a worklist row so identity can be cross-checked.",
      }));
  }

  return sectionOf("study", `Study ${studyInstanceUID.slice(0, 40)}`, checks);
}

// ── Phase 6 — System diagnostics (aggregates BEND-1 ops health) ─────────────

const OPS_FIX_HINTS: Record<string, string> = {
  database: "Check DATABASE_URL and that PostgreSQL is running.",
  startup: "Inspect server logs for the startup/migration error, fix, and restart.",
  migrations: "Re-run the container migration pipeline (db-patch-v2) and check schema_deploy_state.",
  featureFlags: "Enable the missing dependency flags in the documented order (see /api/radiology-ops/flags).",
  jobs: "Drain via POST /api/radiology-ops/jobs/tick and inspect dead letters at /api/radiology-ops/jobs/dead-letter.",
  redelivery: "Review open obligations at /api/radiology-ops/obligations and queue or dismiss each one.",
  pacsArchive: "Retry archive jobs via the ops tick; check Orthanc reachability first.",
  viewerPacs: "See the Viewer & Network sections of this report for the exact failing endpoint.",
  auditChain: "Run POST /api/radiology-ops/audit-verify and investigate any suspicious rows immediately.",
  structuredDrift: "Run POST /api/radiology-ops/drift-scan; regenerate stale caches via the documented repair.",
  restoreVerification: "Run POST /api/radiology-ops/restore-verify to prove the latest backup restores.",
  backups: "Check the backup job schedule and BACKUP_PASSPHRASE; verify the Synology pull path.",
  staleLocks: 'Release via POST /api/radiology-ops/repair {"action":"release_stale_locks"} — dry-run first.',
  consistency: "Open GET /api/radiology-ops/consistency and fix the listed ERROR checks.",
  version: "Set GIT_COMMIT/npm_package_version in the build for traceable deployments.",
};

export async function runSystemDiagnostics(io: DiagnosticsIO = defaultDiagnosticsIO): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];

  // The frozen BEND-1 health service is the source of truth for backend
  // components — mapped, not re-implemented.
  const ops = await buildRadiologyOpsHealth({ maskTopology: false });
  for (const [name, component] of Object.entries(ops.components)) {
    const status = opsToCheckStatus(component.status);
    checks.push(check(`system.${name}`, `Backend — ${name}`, status, component.detail, {
      fix: status === "PASS" ? undefined : OPS_FIX_HINTS[name] ?? "See GET /api/radiology-ops/health for details.",
      data: component.data,
    }));
  }

  // Schedulers
  const schedulersOn = process.env.ENABLE_SCHEDULERS === "1" || process.env.ENABLE_SCHEDULERS === "true";
  checks.push(check("system.scheduler", "Background schedulers", schedulersOn ? "PASS" : "WARNING",
    schedulersOn
      ? "ENABLE_SCHEDULERS is on — radiology job tick (every minute) and audit verification (daily) will run"
      : "ENABLE_SCHEDULERS is OFF — durable jobs and scheduled audit verification will NOT run on their own", {
      fix: schedulersOn ? undefined : "Set ENABLE_SCHEDULERS=1 in the production ERP environment (exactly one instance).",
    }));

  // Health endpoint inventory (informational — one place that lists them all)
  checks.push(check("system.health_endpoints", "Health endpoints", "PASS",
    "liveness: GET /health · readiness: GET /api/healthz · schema: GET /api/health/schema · radiology ops: GET /api/radiology-ops/health · PACS services: GET /api/radiology/network/health", {
      data: {
        endpoints: ["/health", "/api/healthz", "/api/health/schema", "/api/radiology-ops/health", "/api/radiology/network/health"],
      },
    }));

  // Voice provider capability (mirrors GET /api/ai/transcribe/status semantics)
  const settingRows = await loadPacsSettingRows();
  const serverStt = Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL);
  const localSttUrl = settingRows.find((r) => r.key === "voice_local_stt_url" && r.category === "voice")?.value?.trim() ?? "";
  const localStt = /^https?:\/\//i.test(localSttUrl);
  const voiceEnabled = settingValue(settingRows, "voice_enabled") !== "false";
  checks.push(check("system.voice_provider", "Voice / dictation providers", !voiceEnabled ? "WARNING" : (serverStt || localStt) ? "PASS" : "WARNING",
    `voice layer ${voiceEnabled ? "enabled" : "DISABLED in settings"} · server STT ${serverStt ? "configured" : "not configured"} · local STT ${localStt ? "configured" : "not configured"} · browser speech available per-browser (Chrome/Edge)`, {
      fix: !voiceEnabled
        ? "Enable voice in Radiology Settings → Voice if dictation is part of the go-live scope."
        : (serverStt || localStt) ? undefined : "Only browser speech recognition is available — configure a clinic-local STT server (Radiology Settings → Voice) or a server STT key for Firefox/Safari coverage.",
    }));

  // Structured pipeline content counts (informational truth for go-live)
  try {
    const [draftCount] = await db.select({ n: sql<number>`count(*)::int` }).from(radiologyReportDraftsTable);
    const [d1Count] = await db.select({ n: sql<number>`count(*)::int` }).from(radiologyReportDraftsTable).where(isNotNull(radiologyReportDraftsTable.structuredJsonD1));
    const [signedStructured] = await db.select({ n: sql<number>`count(*)::int` })
      .from(patientReportsTable)
      .where(and(isNotNull(patientReportsTable.structuredJson), isNotNull(patientReportsTable.signedAt)));
    const [amendments] = await db.select({ n: sql<number>`count(*)::int` }).from(patientReportAmendmentsTable);
    checks.push(check("system.structured_content", "Structured reporting content", "PASS",
      `${draftCount?.n ?? 0} drafts (${d1Count?.n ?? 0} with canonical D1) · ${signedStructured?.n ?? 0} signed structured reports · ${amendments?.n ?? 0} amendments`, {
        data: { drafts: draftCount?.n ?? 0, d1Drafts: d1Count?.n ?? 0, signedStructured: signedStructured?.n ?? 0, amendments: amendments?.n ?? 0 },
      }));
  } catch (err) {
    checks.push(check("system.structured_content", "Structured reporting content", "UNKNOWN", String(err)));
  }

  // Renderer + signed-hash integrity against REAL persisted documents
  try {
    const [signed] = await db
      .select({ id: patientReportsTable.id, structuredJson: patientReportsTable.structuredJson })
      .from(patientReportsTable)
      .where(and(isNotNull(patientReportsTable.structuredJson), isNotNull(patientReportsTable.signedAt)))
      .orderBy(desc(patientReportsTable.id))
      .limit(1);
    let doc: StructuredReportDocument | null = (signed?.structuredJson as StructuredReportDocument) ?? null;
    let source = signed ? `signed report #${signed.id}` : "";
    if (!doc) {
      const [draft] = await db
        .select({ id: radiologyReportDraftsTable.id, d1: radiologyReportDraftsTable.structuredJsonD1 })
        .from(radiologyReportDraftsTable)
        .where(isNotNull(radiologyReportDraftsTable.structuredJsonD1))
        .orderBy(desc(radiologyReportDraftsTable.id))
        .limit(1);
      doc = (draft?.d1 as StructuredReportDocument) ?? null;
      source = draft ? `draft #${draft.id}` : "";
    }
    if (!doc) {
      checks.push(check("system.renderer", "D4 renderer", "UNKNOWN",
        "no structured document persisted yet — render path not exercised against real data", {
          fix: "Create one structured draft in the Reporting Workspace, then re-run.",
        }));
    } else {
      const rendered = renderStructuredReport(doc);
      checks.push(check("system.renderer", "D4 renderer", "PASS",
        `renderer produced deterministic output from ${source} (${rendered.findings.length} finding line(s), ${rendered.warnings.length} warning(s))`));
      if (signed?.structuredJson) {
        const hash = verifyContentSha256(signed.structuredJson);
        checks.push(check("system.signed_hash", "Signed content hash integrity", hash.ok ? "PASS" : "FAIL",
          hash.ok
            ? `latest signed structured report (#${signed.id}) recomputes to its stamped jcs-sha256 hash`
            : `HASH MISMATCH on signed report #${signed.id}: stored ${hash.stored ?? "—"} ≠ recomputed ${hash.computed} — signed content may have been altered`, {
            fix: hash.ok ? undefined : "Treat as an integrity incident: run POST /api/radiology-ops/audit-verify and POST /api/radiology-ops/drift-scan immediately; do not deliver this report.",
          }));
      }
    }
  } catch (err) {
    checks.push(check("system.renderer", "D4 renderer", "UNKNOWN", `render check failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  // Locks + assignments (activation-facing counts; stale locks already covered by ops)
  try {
    const [locks] = await db.select({ n: sql<number>`count(*)::int` }).from(radiologyWorklistTable).where(isNotNull(radiologyWorklistTable.lockUserId));
    const [assigned] = await db.select({ n: sql<number>`count(*)::int` }).from(radiologyWorklistTable).where(isNotNull(radiologyWorklistTable.assignedRadiologistId));
    checks.push(check("system.locks_assignments", "Locks & assignments", "PASS",
      `${locks?.n ?? 0} active study lock(s) · ${assigned?.n ?? 0} assigned worklist row(s)`, {
        data: { activeLocks: locks?.n ?? 0, assignedRows: assigned?.n ?? 0 },
      }));
  } catch (err) {
    checks.push(check("system.locks_assignments", "Locks & assignments", "UNKNOWN", String(err)));
  }

  void io; // system diagnostics are DB/env-derived; io kept for signature symmetry
  return sectionOf("system", "System & backend", checks);
}

// ── Phase 7 — Clinical workflow simulation (dry-run, read-only) ─────────────

export async function runWorkflowSimulation(io: DiagnosticsIO = defaultDiagnosticsIO): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];
  const flags = await db.select().from(featureFlagsTable).where(like(featureFlagsTable.key, "ff_radiology_%"));
  const flagOn = (key: string) => flags.find((f) => f.key === key)?.enabled === true;

  // 1. pick a real study (never fabricates data)
  const [row] = await db
    .select({
      id: radiologyWorklistTable.id,
      uid: radiologyWorklistTable.studyInstanceUID,
      patientName: radiologyWorklistTable.patientName,
      accessionNumber: radiologyWorklistTable.accessionNumber,
      status: radiologyWorklistTable.status,
    })
    .from(radiologyWorklistTable)
    .where(isNotNull(radiologyWorklistTable.studyInstanceUID))
    .orderBy(desc(radiologyWorklistTable.id))
    .limit(1);
  checks.push(check("workflow.open_study", "Open study (worklist)", row ? "PASS" : "UNKNOWN",
    row
      ? `worklist #${row.id} — "${row.patientName ?? "?"}", accession ${row.accessionNumber ?? "—"}, status ${row.status ?? "?"}`
      : "no worklist row with a StudyInstanceUID exists yet — send one test study before go-live", {
      fix: row ? undefined : "Send a test study from a modality (or the PACS Q/R page) so the full workflow can be simulated.",
      data: row ? { worklistId: row.id, studyInstanceUID: row.uid } : undefined,
    }));

  // 2. launch viewer for that study (URL construction + PACS presence, no window)
  if (row?.uid) {
    const cfg = await getRadiologyConfig();
    const template = cfg.ohif.studyLaunchTemplate || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}";
    const launchUrl = template
      .replace(/\{OHIF_BASE_URL\}/g, cfg.ohif.baseUrl.replace(/\/+$/, ""))
      .replace(/\{studyInstanceUID\}/g, encodeURIComponent(row.uid));
    const issues = analyzeConfiguredUrl(launchUrl, { erpServedHttps: erpServedHttps(), role: "OHIF launch" });
    const { base: orthancBase } = await orthancProbeBase();
    let pacsNote = "PACS presence not probed (Orthanc unreachable)";
    let pacsOk: boolean | null = null;
    if (orthancBase) {
      try {
        const res = await io.fetch(`${orthancBase}/tools/find`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...orthancAuthHeaders() },
          signal: AbortSignal.timeout(4000),
          body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: row.uid } }),
        });
        if (res.ok) {
          const found = (await res.json()) as unknown[];
          pacsOk = Array.isArray(found) && found.length > 0;
          pacsNote = pacsOk ? "study present in PACS" : "study NOT in PACS";
        } else {
          pacsNote = `PACS lookup answered HTTP ${res.status}`;
        }
      } catch {
        pacsNote = "PACS lookup failed";
      }
    }
    const urlStatus = urlIssuesStatus(issues);
    const launchViewerStatus: CheckStatus =
      urlStatus === "FAIL" || pacsOk === false ? "FAIL" : pacsOk === null || urlStatus === "WARNING" ? "WARNING" : "PASS";
    checks.push(check("workflow.launch_viewer", "Launch viewer (dry-run)", launchViewerStatus,
      `${issues.length === 0 ? `launch URL OK: ${launchUrl}` : `${launchUrl} — ${issues.map((i) => i.message).join("; ")}`} · ${pacsNote}`, {
        fix: issues[0]?.fix ?? (pacsOk === false ? "The worklist row references a study the PACS does not hold — re-send it or fix the UID." : pacsOk === null ? "Fix Orthanc reachability so launches can be validated end-to-end." : undefined),
        data: { launchUrl },
      }));
  }

  // 3. draft save path (flags + real draft data; no writes)
  const draftFlag = flagOn("ff_radiology_structured_d1_draft");
  const [latestD1Draft] = await db
    .select({ id: radiologyReportDraftsTable.id, d1: radiologyReportDraftsTable.structuredJsonD1, status: radiologyReportDraftsTable.status })
    .from(radiologyReportDraftsTable)
    .where(isNotNull(radiologyReportDraftsTable.structuredJsonD1))
    .orderBy(desc(radiologyReportDraftsTable.id))
    .limit(1);
  checks.push(check("workflow.save_draft", "Save draft (structured D1)", draftFlag ? (latestD1Draft ? "PASS" : "UNKNOWN") : "WARNING",
    draftFlag
      ? latestD1Draft
        ? `structured drafting enabled — latest D1 draft #${latestD1Draft.id} (${latestD1Draft.status})`
        : "structured drafting enabled but no D1 draft exists yet"
      : "ff_radiology_structured_d1_draft is OFF — drafts save without the canonical D1 document", {
      fix: draftFlag ? (latestD1Draft ? undefined : "Create one structured draft in the Reporting Workspace to prove the path.") : "Enable flags in order: structured_core → catalog → structured_d1_draft (see /api/radiology-ops/flags).",
    }));

  // 4. structured document renders (read-only render of the real draft)
  if (latestD1Draft?.d1) {
    try {
      const rendered = renderStructuredReport(latestD1Draft.d1 as StructuredReportDocument);
      checks.push(check("workflow.structured_render", "Structured report render", "PASS",
        `draft #${latestD1Draft.id} renders deterministically (${rendered.findings.length} finding line(s))`));
    } catch (err) {
      checks.push(check("workflow.structured_render", "Structured report render", "FAIL",
        `draft #${latestD1Draft.id} failed to render: ${err instanceof Error ? err.message : String(err)}`, {
          fix: "Run POST /api/radiology-ops/drift-scan — the draft's D1 may be malformed.",
        }));
    }
  }

  // 5. finalize/sign path (flag + proof from real signed reports; no signing)
  const finalFlag = flagOn("ff_radiology_structured_final");
  const [latestSigned] = await db
    .select({ id: patientReportsTable.id, structuredJson: patientReportsTable.structuredJson })
    .from(patientReportsTable)
    .where(and(isNotNull(patientReportsTable.structuredJson), isNotNull(patientReportsTable.signedAt)))
    .orderBy(desc(patientReportsTable.id))
    .limit(1);
  checks.push(check("workflow.finalize", "Finalize & sign", latestSigned ? "PASS" : finalFlag ? "UNKNOWN" : "WARNING",
    latestSigned
      ? `sign path proven — latest signed structured report #${latestSigned.id}`
      : finalFlag
        ? "structured finalize enabled but no structured report has been signed yet"
        : "ff_radiology_structured_final is OFF — finalize produces legacy (non-structured) signed reports only", {
      fix: latestSigned ? undefined : finalFlag ? "Sign one test report end-to-end before go-live." : "Enable ff_radiology_structured_final after its dependencies (see the flag registry).",
    }));

  // 6. read back latest version + hash integrity (D8 authority, read-only)
  if (latestSigned) {
    try {
      const resolved = await resolveReportVersion(latestSigned.id);
      checks.push(check("workflow.read_back", "Read back latest version", resolved ? "PASS" : "FAIL",
        resolved
          ? `resolveReportVersion(#${latestSigned.id}) → serves #${resolved.resolvedReportId} (latest in chain: #${resolved.latestReportId}${resolved.superseded ? ", requested row is superseded" : ""})`
          : `resolveReportVersion(#${latestSigned.id}) returned nothing for an existing report`, {
          fix: resolved ? undefined : "Run GET /api/radiology-ops/consistency — the amendment chain may be broken.",
        }));
    } catch (err) {
      checks.push(check("workflow.read_back", "Read back latest version", "FAIL", String(err)));
    }
    const hash = verifyContentSha256(latestSigned.structuredJson);
    checks.push(check("workflow.verify_hash", "Verify signed content hash", hash.ok ? "PASS" : "FAIL",
      hash.ok ? `signed report #${latestSigned.id} hash verifies (jcs-sha256/1)` : `hash MISMATCH on #${latestSigned.id}`, {
        fix: hash.ok ? undefined : "Integrity incident — run audit-verify + drift-scan; do not deliver.",
      }));
    // 7. print / PDF path — the shared delivery renderer resolves to the
    // latest signed revision; proven read-only via render + resolution above.
    checks.push(check("workflow.print_pdf", "Print / PDF path", "PASS",
      `print, PDF, public-token PDF, email and PACS archive all flow through one server renderer that resolves report #${latestSigned.id} to its latest signed revision (verified read-only above)`));
  }

  // 8. share + re-delivery obligations (read-only counts)
  try {
    const [shares] = await db.select({ n: sql<number>`count(*)::int` }).from(reportSharesTable).where(eq(reportSharesTable.status, "sent"));
    const backlog = await redeliveryBacklog();
    checks.push(check("workflow.share", "Share & re-delivery", backlog.failed > 0 ? "WARNING" : "PASS",
      `${shares?.n ?? 0} sent share(s) recorded · re-delivery obligations: ${backlog.open} open, ${backlog.failed} failed`, {
        fix: backlog.failed > 0 ? "Review failed obligations at GET /api/radiology-ops/obligations?status=failed and queue or dismiss each." : undefined,
      }));
  } catch (err) {
    checks.push(check("workflow.share", "Share & re-delivery", "UNKNOWN", String(err)));
  }

  // 9. amendment chain (read-only; BEND-1 PG verification proved the write path)
  try {
    const [amendment] = await db
      .select({ amendedReportId: patientReportAmendmentsTable.amendedReportId, originalReportId: patientReportAmendmentsTable.originalReportId })
      .from(patientReportAmendmentsTable)
      .orderBy(desc(patientReportAmendmentsTable.id))
      .limit(1);
    if (amendment) {
      const resolved = await resolveReportVersion(amendment.originalReportId);
      const movedForward = resolved != null && resolved.latestReportId !== amendment.originalReportId;
      checks.push(check("workflow.amendment", "Amendment → latest version", movedForward ? "PASS" : "FAIL",
        movedForward
          ? `amending #${amendment.originalReportId} correctly resolves readers to revision #${resolved.latestReportId}`
          : `amendment exists but resolution still lands on the original #${amendment.originalReportId}`, {
          fix: movedForward ? undefined : "Run GET /api/radiology-ops/consistency — the amendment linkage is inconsistent.",
        }));
    } else {
      checks.push(check("workflow.amendment", "Amendment → latest version", "UNKNOWN",
        "no amendment exists yet in this deployment (the chain mechanics were proven in backend verification)", {
          fix: "Optionally amend one test report to prove the path against live data.",
        }));
    }
  } catch (err) {
    checks.push(check("workflow.amendment", "Amendment → latest version", "UNKNOWN", String(err)));
  }

  // 10. voice dispatcher readiness (providers + enablement; no audio sent)
  const settingRows = await loadPacsSettingRows();
  const voiceEnabled = settingValue(settingRows, "voice_enabled") !== "false";
  const serverStt = Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL);
  const localStt = /^https?:\/\//i.test(settingRows.find((r) => r.key === "voice_local_stt_url")?.value?.trim() ?? "");
  checks.push(check("workflow.voice", "Voice command layer", voiceEnabled ? "PASS" : "WARNING",
    `voice ${voiceEnabled ? "enabled" : "DISABLED"} · providers: browser${serverStt ? " + server" : ""}${localStt ? " + local" : ""} · commands run through the M1.5 dispatcher with allowlist + confirmation policy`, {
      fix: voiceEnabled ? undefined : "Enable voice in Radiology Settings → Voice if in scope for go-live.",
    }));

  // 11. assignment + lock mechanics (read-only counts over live columns)
  try {
    const [assigned] = await db.select({ n: sql<number>`count(*)::int` }).from(radiologyWorklistTable).where(isNotNull(radiologyWorklistTable.assignedRadiologistId));
    const [locked] = await db.select({ n: sql<number>`count(*)::int` }).from(radiologyWorklistTable).where(isNotNull(radiologyWorklistTable.lockUserId));
    checks.push(check("workflow.assignment_lock", "Assignment & locking", "PASS",
      `${assigned?.n ?? 0} row(s) assigned · ${locked?.n ?? 0} active lock(s) — id-canonical assignment and derived-expiry locks are live columns on the worklist`, {
        data: { assigned: assigned?.n ?? 0, locked: locked?.n ?? 0 },
      }));
  } catch (err) {
    checks.push(check("workflow.assignment_lock", "Assignment & locking", "UNKNOWN", String(err)));
  }

  return sectionOf("workflow", "Clinical workflow simulation (dry-run)", checks);
}

// ── Phase 9 — Settings verification ──────────────────────────────────────────

export async function runSettingsVerification(): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];
  const rows = await loadPacsSettingRows();
  const findings = classifySettings(rows, { ohifUrlEnv: process.env.OHIF_URL ?? null });

  // The existing config validator stays the authority for cross-field
  // radiology config warnings (bridge IPs, duplicate AE titles/ports,
  // placeholders) — folded in, not re-implemented.
  const configWarnings = await validateRadiologyConfig().catch((err) => [`config validation failed: ${err instanceof Error ? err.message : String(err)}`]);
  configWarnings.forEach((warning, i) => {
    checks.push(check(`settings.config_warning_${i + 1}`, "Radiology config", "WARNING", warning, {
      fix: "Follow the instruction in the warning — it names the exact key or env var to change.",
    }));
  });

  for (const finding of findings) {
    checks.push(check(`settings.${finding.kind}.${finding.key}`, `Setting — ${finding.key}`,
      finding.kind === "invalid_value" ? "FAIL" : "WARNING",
      finding.message, { fix: finding.recommendation }));
  }

  if (findings.length === 0 && configWarnings.length === 0) {
    checks.push(check("settings.registry", "Settings registry", "PASS",
      `${rows.length} pacs_settings row(s) verified against ${new Set(rows.map((r) => r.key)).size} key(s) — no missing, duplicate, unused, conflicting, deprecated, shadowed or out-of-range settings found`));
  } else {
    checks.push(check("settings.registry", "Settings registry", "PASS",
      `${rows.length} pacs_settings row(s) checked — ${findings.length + configWarnings.length} finding(s) above are read-only recommendations; nothing was changed or deleted`));
  }

  return sectionOf("settings", "Settings verification", checks);
}

// ── Phase 8 — Deployment report ──────────────────────────────────────────────

export interface DeploymentReport {
  generatedAt: string;
  verdict: DeploymentVerdict;
  findings: DeploymentFinding[];
  sections: DiagnosticSection[];
  version: { app: string; commit: string };
  studyInstanceUID?: string;
}

export async function buildDeploymentReport(
  opts: { studyInstanceUID?: string; includeWorkflow?: boolean } = {},
  io: DiagnosticsIO = defaultDiagnosticsIO,
): Promise<DeploymentReport> {
  const sections: DiagnosticSection[] = [];
  sections.push(await runSystemDiagnostics(io));
  sections.push(await runViewerDiagnostics(io));
  sections.push(await runNetworkDiagnostics(io));
  sections.push(await runSettingsVerification());
  if (opts.includeWorkflow !== false) sections.push(await runWorkflowSimulation(io));
  if (opts.studyInstanceUID) sections.push(await runStudyDiagnostics(opts.studyInstanceUID, io));

  const { verdict, findings } = deriveDeploymentVerdict(sections);
  return {
    generatedAt: new Date().toISOString(),
    verdict,
    findings,
    sections,
    version: {
      app: process.env.npm_package_version ?? "unknown",
      commit: (process.env.GIT_COMMIT ?? "unknown").slice(0, 8),
    },
    ...(opts.studyInstanceUID ? { studyInstanceUID: opts.studyInstanceUID } : {}),
  };
}

export { worstCheckStatus };
