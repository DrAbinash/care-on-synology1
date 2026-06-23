/**
 * logger.js — File-based rolling logger for the DICOM pull agent.
 *
 * Writes to three separate files:
 *   logs/agent.log    — general activity, polling cycles, config fetch
 *   logs/error.log    — errors and exceptions
 *   logs/transfer.log — per-study C-MOVE/C-GET/C-STORE events
 *
 * Logs older than 30 days are cleaned up at startup and daily.
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.resolve(__dirname, "..", "logs");
const MAX_DAYS = 30;

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const streams = {
  agent:    fs.createWriteStream(path.join(LOG_DIR, "agent.log"),    { flags: "a" }),
  error:    fs.createWriteStream(path.join(LOG_DIR, "error.log"),    { flags: "a" }),
  transfer: fs.createWriteStream(path.join(LOG_DIR, "transfer.log"), { flags: "a" }),
};

function ts() {
  return new Date().toISOString();
}

function writeLine(stream, level, message, extra) {
  const line = JSON.stringify({ ts: ts(), level, message, ...(extra ?? {}) }) + "\n";
  stream.write(line);
}

const logger = {
  info(message, extra)     { writeLine(streams.agent,    "INFO",  message, extra); console.log(`[INFO]  ${message}`); },
  warn(message, extra)     { writeLine(streams.agent,    "WARN",  message, extra); writeLine(streams.error, "WARN", message, extra); console.warn(`[WARN]  ${message}`); },
  error(message, extra)    { writeLine(streams.agent,    "ERROR", message, extra); writeLine(streams.error, "ERROR", message, extra); console.error(`[ERROR] ${message}`); },
  transfer(message, extra) { writeLine(streams.transfer, "XFER",  message, extra); console.log(`[XFER]  ${message}`); },
};

/**
 * Delete log files older than MAX_DAYS days.
 * Runs at startup and once every 24 hours.
 */
function cleanOldLogs() {
  const cutoffMs = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      if (!file.endsWith(".log")) continue;
      const fullPath = path.join(LOG_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(fullPath);
          logger.info(`Cleaned old log file: ${file}`);
        }
      } catch {
        // ignore stat/unlink errors
      }
    }
  } catch (err) {
    // ignore readdir errors — LOG_DIR may not exist yet
  }
}

// Run cleanup at startup and then every 24 hours
cleanOldLogs();
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000).unref();

module.exports = { logger };
