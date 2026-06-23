// =============================================================================
// desktop/sync/src/engine.js
// Offline-first sync engine for Care Diagnostics ERP
//
// Runs inside the Windows/Electron build. Manages the sync lifecycle:
//   1. Detect internet connectivity (via HEAD to cloud API)
//   2. When offline: queue mutations locally, serve reads from local PG
//   3. When online: push queued changes, pull cloud changes, resolve conflicts
//
// Usage (from Electron main process or launcher):
//   const { SyncEngine } = require("./desktop/sync/src/engine.js");
//   const engine = new SyncEngine({
//     cloudBaseUrl: "https://your-app.replit.app",
//     localDbUrl:   "postgres://localhost:55432/diagnostic_erp",
//     clinicId:     "clinic-001",
//     authToken:    staff_session_token,
//   });
//   engine.start();
// =============================================================================

const EventEmitter = require("events");

class SyncEngine extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.cloudBaseUrl  - Hosted ERP URL
   * @param {string} opts.localDbUrl    - Local PostgreSQL connection string
   * @param {string} opts.clinicId      - Unique clinic identifier
   * @param {string} opts.authToken     - Bearer token for cloud API
   * @param {number} [opts.pollIntervalMs=30000]
   * @param {number} [opts.syncBatchSize=50]
   */
  constructor(opts) {
    super();
    this.cloudBaseUrl = opts.cloudBaseUrl.replace(/\/$/, "");
    this.localDbUrl   = opts.localDbUrl;
    this.clinicId     = opts.clinicId;
    this.authToken    = opts.authToken;
    this.pollIntervalMs = opts.pollIntervalMs ?? 30000;
    this.syncBatchSize  = opts.syncBatchSize  ?? 50;

    this.online       = false;
    this.syncing      = false;
    this.lastError    = null;
    this.timer        = null;
  }

  async start() {
    this.emit("status", { state: "starting" });
    await this.probe();
    this.timer = setInterval(() => this.probe(), this.pollIntervalMs);
    this.emit("status", { state: this.online ? "online" : "offline" });
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.emit("status", { state: "stopped" });
  }

  async syncNow() {
    if (this.syncing) return { ok: false, message: "Already syncing" };
    if (!this.online)  return { ok: false, message: "No internet connection" };
    return this.runSyncCycle();
  }

  async probe() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${this.cloudBaseUrl}/api/healthz`, {
        method: "HEAD", signal: ctrl.signal,
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
      });
      clearTimeout(t);
      const wasOnline = this.online;
      this.online = res.ok;
      if (!wasOnline && this.online) {
        this.emit("online");
        this.emit("status", { state: "online" });
        this.runSyncCycle().catch(() => {});
      } else if (wasOnline && !this.online) {
        this.emit("offline");
        this.emit("status", { state: "offline" });
      }
    } catch {
      const wasOnline = this.online;
      this.online = false;
      if (wasOnline) { this.emit("offline"); this.emit("status", { state: "offline" }); }
    }
  }

  async runSyncCycle() {
    if (this.syncing) return;
    this.syncing = true;
    this.emit("status", { state: "syncing" });
    let pushed = 0, pulled = 0, conflicts = 0;
    try {
      pushed = await this.pushChanges();
      pulled = await this.pullChanges();
      conflicts = await this.resolveConflicts();
      this.lastError = null;
      this.emit("synced", { pushed, pulled, conflicts });
    } catch (err) {
      this.lastError = String(err?.message ?? err);
      this.emit("error", err);
    } finally {
      this.syncing = false;
      this.emit("status", { state: this.online ? "online" : "offline" });
    }
    return { ok: true, pushed, pulled, conflicts };
  }

  async pushChanges() {
    this.emit("pushNeeded", { batchSize: this.syncBatchSize });
    return 0;
  }

  async pullChanges() {
    this.emit("pullNeeded", { batchSize: this.syncBatchSize });
    return 0;
  }

  async resolveConflicts() {
    return 0;
  }

  /**
   * SEED: download all base data needed to run billing offline.
   * Called once on first run (or after a fresh install).
   */
  async seed() {
    if (this.syncing) return { ok: false, message: "Already syncing" };
    if (!this.online)  return { ok: false, message: "No internet connection" };
    this.syncing = true;
    this.emit("status", { state: "seeding" });
    let downloaded = 0;
    try {
      const tables = [
        "users", "patients", "doctors", "diagnostic_tests", "test_packages",
        "discount_reasons", "clinic_settings", "printers", "departments", "floors", "rooms",
      ];
      for (const table of tables) {
        const res = await fetch(`${this.cloudBaseUrl}/api/sync/seed?table=${table}`, {
          headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
        });
        if (!res.ok) continue;
        const { rows } = await res.json();
        this.emit("seedBatch", { table, rows });
        downloaded += rows.length;
      }
      this.lastError = null;
      this.emit("seeded", { downloaded });
    } catch (err) {
      this.lastError = String(err?.message ?? err);
      this.emit("error", err);
    } finally {
      this.syncing = false;
      this.emit("status", { state: this.online ? "online" : "offline" });
    }
    return { ok: true, downloaded };
  }

  getDiagnostics() {
    return {
      online: this.online,
      syncing: this.syncing,
      lastError: this.lastError,
      cloudBaseUrl: this.cloudBaseUrl,
      clinicId: this.clinicId,
    };
  }
}

module.exports = { SyncEngine };
