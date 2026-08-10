// Typed client for the local per-workstation Scanner Bridge (scan-bridge/),
// called DIRECTLY from the browser at http://127.0.0.1:8766. This must never
// be proxied through the API server — the API server's own loopback is not
// the reception workstation's loopback, so a server-side fetch to 127.0.0.1
// can never reach the workstation's bridge (this was the root cause of
// "Capture ID / Direct Scan: fetch failed" and "Import Latest Scan: fetch
// failed" prior to this fix).
//
// Persists the last-known-good bridge base URL per workstation (localStorage)
// so a future multi-port setup (e.g. distinguishing a TVS PDS 8M path from a
// Canon flatbed path) has somewhere to read/write from without a new storage
// mechanism.

const BRIDGE_URL_STORAGE_KEY = "care_scan_bridge_url";
const BRIDGE_SECRET_STORAGE_KEY = "care_scan_bridge_secret";

export function getScanBridgeUrl(): string {
  try {
    const stored = window.localStorage.getItem(BRIDGE_URL_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through to default
  }
  return (import.meta as any).env?.VITE_SCAN_BRIDGE_URL || "http://127.0.0.1:8766";
}

export function setScanBridgeUrl(url: string): void {
  try {
    window.localStorage.setItem(BRIDGE_URL_STORAGE_KEY, url);
  } catch {
    // ignore
  }
}

export function getScanBridgeSecret(): string {
  try {
    return window.localStorage.getItem(BRIDGE_SECRET_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setScanBridgeSecret(secret: string): void {
  try {
    window.localStorage.setItem(BRIDGE_SECRET_STORAGE_KEY, secret);
  } catch {
    // ignore
  }
}

function bridgeHeaders(): Record<string, string> {
  const secret = getScanBridgeSecret();
  return secret ? { "X-Bridge-Secret": secret } : {};
}

/**
 * Three distinguishable failure states instead of one boolean "offline", so
 * the UI can show reception staff an actionable message:
 *  - "not-running": fetch threw (connection refused / DNS failure / bridge
 *    process not started).
 *  - "blocked": the bridge is very likely running, but the browser refused
 *    to complete the request — CORS origin not allowlisted, Private Network
 *    Access preflight rejected, or an auth secret mismatch.
 *  - "device-error": the bridge itself responded, but the scanner/adapter
 *    reported a problem (no device, driver error, etc).
 *  - "ok": bridge reachable and adapter reports a connected device.
 */
export type ScanBridgeState = "ok" | "not-running" | "blocked" | "device-error";

export interface ScanBridgeHealth {
  state: ScanBridgeState;
  vendor?: string;
  deviceConnected?: boolean;
  authRequired?: boolean;
  corsConfigured?: boolean;
  error?: string;
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getScanBridgeUrl()}${path}`, {
    ...init,
    mode: "cors",
    headers: { ...bridgeHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
}

export async function checkScanBridgeHealth(): Promise<ScanBridgeHealth> {
  try {
    const res = await bridgeFetch("/health", { method: "GET" });
    const json = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok || json.ok !== true) {
      return { state: "device-error", error: String(json.error ?? "Bridge reported an error"), vendor: json.vendor as string | undefined };
    }
    // Bridge process is reachable. deviceConnected=false only means no scanner
    // plugged in or watch folder empty — /scan and /latest-scan may still work
    // (folder-watch clinics, or WIA after staff scans via vendor software).
    return {
      state: "ok",
      vendor: json.vendor as string | undefined,
      deviceConnected: json.deviceConnected as boolean | undefined,
      authRequired: json.authRequired as boolean | undefined,
      corsConfigured: json.corsConfigured as boolean | undefined,
    };
  } catch (err) {
    // A network-level failure here is ambiguous between "process not
    // running" and "CORS/PNA preflight rejected" — both surface to fetch()
    // as a generic TypeError with no further detail available to JS. We
    // label it "not-running" as the more common case and let ScannerSettings
    // offer CORS/PNA troubleshooting guidance regardless.
    return { state: "not-running", error: err instanceof Error ? err.message : "Bridge unreachable" };
  }
}

export interface ScanBridgeImageResult {
  ok: boolean;
  imageBase64?: string;
  mimeType?: string;
  filename?: string;
  error?: string;
  code?: string | null;
  fallback?: string | null;
}

export async function scanBridgeCapture(): Promise<ScanBridgeImageResult> {
  try {
    const res = await bridgeFetch("/scan", { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as ScanBridgeImageResult;
    if (!res.ok || !json.ok) return { ok: false, error: json.error || "Scan failed", code: json.code ?? null, fallback: json.fallback ?? null };
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach the scanner bridge. Is it running on this workstation?" };
  }
}

export async function scanBridgeCaptureWithFallback(): Promise<ScanBridgeImageResult> {
  const direct = await scanBridgeCapture();
  if (direct.ok && direct.imageBase64) return direct;

  const shouldTryLatest =
    direct.fallback === "folder-watch" ||
    direct.code === "WIA_UNSUPPORTED_DRIVER" ||
    direct.code === "WIA_NO_DEVICE";

  if (shouldTryLatest) {
    const latest = await scanBridgeLatestScan();
    if (latest.ok && latest.imageBase64) return latest;
    return {
      ok: false,
      error: latest.error || direct.error || "Scan failed — try scanning in your scanner app, then Import Latest.",
      code: latest.code ?? direct.code ?? null,
      fallback: latest.fallback ?? direct.fallback ?? "folder-watch",
    };
  }

  return direct;
}

export async function scanBridgeLatestScan(): Promise<ScanBridgeImageResult> {
  try {
    const res = await bridgeFetch("/latest-scan", { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as ScanBridgeImageResult;
    if (!res.ok || !json.ok) return { ok: false, error: json.error || "No latest scan found", fallback: json.fallback ?? null };
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach the scanner bridge. Is it running on this workstation?" };
  }
}

export interface ScanBridgeOpenAppResult {
  ok: boolean;
  message?: string;
  app?: string;
  error?: string;
}

export async function scanBridgeOpenApp(): Promise<ScanBridgeOpenAppResult> {
  try {
    const res = await bridgeFetch("/open-scanner-app", { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as ScanBridgeOpenAppResult;
    if (!res.ok || !json.ok) return { ok: false, error: json.error || "Could not open scanner app" };
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach the scanner bridge. Is it running on this workstation?" };
  }
}

export interface ScanBridgeDevice {
  index: number;
  name: string;
}

export async function scanBridgeDevices(): Promise<ScanBridgeDevice[]> {
  try {
    const res = await bridgeFetch("/devices", { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as { ok: boolean; devices?: ScanBridgeDevice[] };
    return json.ok ? (json.devices ?? []) : [];
  } catch {
    return [];
  }
}
