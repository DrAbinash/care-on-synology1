import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Backup / DR reachability contract.
//
// Production logs `Cron schedulers disabled (set ENABLE_SCHEDULERS=1 to enable)`.
// That gate in index.ts wraps EVERY in-process timer, and the code itself notes
// production does not set it. Combined with internal-cron exposing no endpoint
// for them, three safety jobs had NO reachable code path at all:
//
//   * fireScheduledBackups      — automated backups never fired from the API
//   * restore-verification      — backups never proven restorable
//   * backup dead-man           — "backups have stopped" alert could never run,
//                                 so TOTAL backup failure was undetectable
//
// On top of that, neither ENABLE_SCHEDULERS nor CRON_SECRET was passed into the
// api container by docker-compose, so *neither* mechanism could be turned on.
//
// This pins both halves of the fix: the jobs are externally triggerable, and
// the compose env actually plumbs the switches.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");

const cronSrc = readFileSync(join(__dirname, "cron.ts"), "utf8");
const internalCronSrc = readFileSync(join(__dirname, "routes", "internal-cron.ts"), "utf8");
const compose = readFileSync(join(REPO, "docker-compose.yml"), "utf8");

describe("backup/DR jobs are externally triggerable", () => {
  test("the runners are exported from cron.ts", () => {
    expect(cronSrc).toContain("export async function runRestoreVerificationJob");
    expect(cronSrc).toContain("export async function runBackupDeadManCheck");
    // fireScheduledBackups was already exported; assert it stayed that way.
    expect(cronSrc).toContain("export async function fireScheduledBackups");
  });

  test("the schedulers still delegate to those runners (no behaviour lost)", () => {
    expect(cronSrc).toContain("await runRestoreVerificationJob(\"cron\")");
    expect(cronSrc).toContain("await runBackupDeadManCheck()");
    // Both cron.schedule cadences preserved: weekly Mon 03:30, every 6h.
    expect(cronSrc).toContain('cron.schedule("30 3 * * 1"');
    expect(cronSrc).toContain('cron.schedule("7 */6 * * *"');
  });

  test("internal-cron exposes an endpoint for each of the three jobs", () => {
    for (const path of ["/scheduled-backups", "/restore-verification", "/backup-dead-man"]) {
      expect(internalCronSrc, `${path} endpoint must exist`).toContain(`router.post("${path}"`);
    }
  });

  test("the new endpoints sit behind the same CRON_SECRET guard", () => {
    // router.use(requireCronSecret) is registered before any route, so every
    // endpoint including the new ones is gated. Guard still fails closed.
    const guardAt = internalCronSrc.indexOf("router.use(requireCronSecret)");
    expect(guardAt).toBeGreaterThan(-1);
    for (const path of ["/scheduled-backups", "/restore-verification", "/backup-dead-man"]) {
      expect(internalCronSrc.indexOf(`router.post("${path}"`)).toBeGreaterThan(guardAt);
    }
    expect(internalCronSrc).toContain('res.status(503).json({ error: "CRON_SECRET not configured on server" })');
  });

  test("a restore that cannot be proven is reported, not swallowed as success", () => {
    // verified:false must be surfaced rather than collapsed into ok:true only.
    expect(internalCronSrc).toContain("verified: result.ok");
  });
});

describe("docker-compose plumbs the scheduler switches into the api container", () => {
  test("ENABLE_SCHEDULERS and CRON_SECRET are passed through", () => {
    expect(compose).toContain("ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS:-}");
    expect(compose).toContain("CRON_SECRET: ${CRON_SECRET:-}");
  });

  test("the dead-man threshold is configurable", () => {
    expect(compose).toContain("BACKUP_DEADMAN_MAX_AGE_HOURS: ${BACKUP_DEADMAN_MAX_AGE_HOURS:-}");
  });
});
