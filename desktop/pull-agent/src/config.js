/**
 * config.js — Configuration management for the DICOM pull agent.
 *
 * Priority:
 *   1. Environment variables (.env file or system env)
 *   2. Remote config fetched from ERP API every 5 minutes
 *   3. Last-known-good config (persisted locally to config/last-known-good.json)
 *   4. Built-in defaults
 *
 * Set ERP_CONFIG_ENABLED=0 to disable remote config entirely.
 */

const fs   = require("fs");
const path = require("path");
const { logger } = require("./logger");

// ─── Load .env if present ─────────────────────────────────────────────────────
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

// ─── Constants ────────────────────────────────────────────────────────────────
const CONFIG_DIR  = path.resolve(__dirname, "..", "config");
const LKG_PATH    = path.join(CONFIG_DIR, "last-known-good.json");
const FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

// ─── In-memory config ─────────────────────────────────────────────────────────
let _config = null;

function loadLastKnownGood() {
  try {
    if (fs.existsSync(LKG_PATH)) {
      const data = JSON.parse(fs.readFileSync(LKG_PATH, "utf8"));
      logger.info("Loaded last-known-good config from disk", { path: LKG_PATH });
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
      aeTitle: process.env.CONQUEST_AE      ?? "CONQUEST1",
    },
    modalities: [],
    pullSettings: {
      pollIntervalMs:    Number(process.env.DEFAULT_POLLING_INTERVAL_MS ?? 300_000),
      agentAeTitle:      process.env.LOCAL_AE_TITLE ?? "DIAGNO_AGENT",
      maxConcurrentJobs: 3,
      maxRetries:        Number(process.env.MAX_RETRIES ?? 5),
    },
  };
}

async function fetchRemoteConfig() {
  const baseUrl    = process.env.ERP_BASE_URL;
  const apiKey     = process.env.INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const url = `${baseUrl.replace(/\/$/, "")}/api/internal/dicom-agent/config`;
  try {
    // Dynamic import for ESM compatibility on newer Node
    const { default: fetch } = await import("node-fetch").catch(() => ({ default: global.fetch }));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    logger.info("Remote config fetched successfully", { modalities: data.modalities?.length ?? 0 });
    return data;
  } catch (err) {
    logger.warn("Remote config fetch failed — using last-known-good", { error: String(err) });
    return null;
  }
}

async function refreshConfig() {
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
    // First-time startup with no connectivity — fall back to last-known-good or defaults
    _config = loadLastKnownGood() ?? getDefaultConfig();
  }
  // If fetch fails but _config already set, keep using current config
}

function getConfig() {
  return _config ?? getDefaultConfig();
}

module.exports = { refreshConfig, getConfig, FETCH_INTERVAL_MS };
