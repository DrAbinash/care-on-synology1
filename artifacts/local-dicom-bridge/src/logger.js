/**
 * Simple rolling-file logger for the local bridge.
 * No external dependencies — just fs.appendFileSync.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, "..", "logs");

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "agent.log");
const ERR_FILE = path.join(LOG_DIR, "error.log");

const MAX_LOG_AGE_DAYS = 30;

function timestamp() {
  return new Date().toISOString();
}

function write(file, line) {
  try {
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch { /* silent */ }
}

export const logger = {
  info(msg, meta = {}) {
    const line = `${timestamp()} [INFO] ${msg} ${meta && Object.keys(meta).length ? JSON.stringify(meta) : ""}`;
    console.log(line);
    write(LOG_FILE, line);
  },
  warn(msg, meta = {}) {
    const line = `${timestamp()} [WARN] ${msg} ${meta && Object.keys(meta).length ? JSON.stringify(meta) : ""}`;
    console.warn(line);
    write(LOG_FILE, line);
    write(ERR_FILE, line);
  },
  error(msg, meta = {}) {
    const line = `${timestamp()} [ERROR] ${msg} ${meta && Object.keys(meta).length ? JSON.stringify(meta) : ""}`;
    console.error(line);
    write(LOG_FILE, line);
    write(ERR_FILE, line);
  },
  transfer(msg, meta = {}) {
    const line = `${timestamp()} [XFER] ${msg} ${meta && Object.keys(meta).length ? JSON.stringify(meta) : ""}`;
    console.log(line);
    write(LOG_FILE, line);
  },
};

// Cleanup old logs once at startup
try {
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 86400000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    const p = path.join(LOG_DIR, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
} catch { /* ignore */ }
