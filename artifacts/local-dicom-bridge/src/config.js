/**
 * config.js — Configuration management for the local DICOM bridge.
 *
 * Priority:
 *   1. Environment variables (.env or system env)
 *   2. Remote config fetched from ERP every CONFIG_REFRESH_MS
 *   3. Last-known-good config persisted to config/last-known-good.json
 *   4. Built-in defaults
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env if present ──────────────────────────────────────────────
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ── Constants ─────────────────────────────────────────────────────
const CONFIG_DIR = path.resolve(__dirname, "..", "config");
const LKG_PATH = path.join(CONFIG_DIR, "last-known-good.json");

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

// ── In-memory config ────────────────────────────────────────────────────
let _config = null;

function loadLastKnownGood() {
  try {
    if (fs.existsSync(LKG_PATH)) {
      const data = JSON.parse(fs.readFileSync(LKG_PATH, "utf8"));
      logger.info("Loaded last-known-good config", { path: LKG_PATH });
      return data;
    }
  } catch (err) {
    logger.warn("Could not load last-known-good config", { error: String(err) });
  }
  return null;
}

function saveLastKnownGood(config) {
  try {
    fs.writeFileSync(LKG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    logger.warn("Could not persist last-known-good config", { error: String(err) });
  }
}

function getDefaultConfig() {
  return {
    conquest: {
      host:    process.env.CONQUEST_HOST    ?? "127.0.0.1",
      port:    Number(process.env.CONQUEST_PORT ?? 5678),
      aeTitle: process.env.CONQUEST_AE_TITLE  ?? "CONQUEST1",
    },
    modalities: [],
    pullSettings: {
      pollIntervalMs:     Number(process.env.POLL_INTERVAL_MS     ?? 300_000),
      agentAeTitle:       process.env.AGENT_AE_TITLE              ?? "DIAGNO_AGENT",
      maxConcurrentJobs:  Number(process.env.MAX_CONCURRENT_JOBS  ?? 3),
      dimseTimeoutMs:     Number(process.env.DIMSE_TIMEOUT_MS     ?? 60_000),
    },
    erpSettings: {
      heartbeatEndpoint: "/api/internal/dicom-agent/heartbeat",
      logEndpoint:       "/api/internal/dicom-agent/log",
      configEndpoint:    "/api/internal/dicom-agent/config",
    },
  };
}

// ── ERP fetch ────────────────────────────────────────────────────────────
async function erpFetch(path, options = {}) {
  const baseUrl = process.env.ERP_BASE_URL;
  const apiKey  = process.env.INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn(`ERP API ${path} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn(`ERP API ${path} failed`, { error: String(err) });
    return null;
  }
}

async function fetchRemoteConfig() {
  const baseUrl = process.env.ERP_BASE_URL;
  const apiKey  = process.env.INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const url = `${baseUrl.replace(/\/$/, "")}/api/internal/dicom-agent/config`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    logger.info("Remote config fetched", { modalities: data.modalities?.length ?? 0 });
    return data;
  } catch (err) {
    logger.warn("Remote config fetch failed — using last-known-good", { error: String(err) });
    return null;
  }
}

export async function refreshConfig() {
  const erpEnabled = process.env.ERP_CONFIG_ENABLED !== "0";
  if (!erpEnabled) {
    if (!_config) {
      _config = loadLastKnownGood() ?? getDefaultConfig();
    }
    return;
  }

  const remote = await fetchRemoteConfig();
  if (remote) {
    _config = remote;
    saveLastKnownGood(remote);
  } else if (!_config) {
    _config = loadLastKnownGood() ?? getDefaultConfig();
  }
  // If fetch fails but _config already set, keep using current
}

export function getConfig() {
  return _config ?? getDefaultConfig();
}

export { erpFetch };
