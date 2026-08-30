import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Fix: care-migrate previously had no `profiles:` key, meaning a normal
// `docker compose up -d` would start it alongside every other service —
// contradicting the file's own comments, which claimed it was "NOT in the
// automatic startup chain." This risked care-migrate running a competing
// migration alongside care-db-patch-v2 during a routine Synology Container
// Manager rebuild. This test guards against that regression.
//
// Uses simple text-block parsing rather than a YAML library, to avoid
// adding a new dependency (or relying on one only present transitively)
// just for this one regression check.

const COMPOSE_PATH = resolve(__dirname, "../../../../docker-compose.yml");

function getServiceBlock(composeText: string, serviceName: string): string {
  // Matches from "  <serviceName>:" (2-space indented, top-level under
  // services:) up to the next 2-space-indented service key or EOF.
  const re = new RegExp(`\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z_-]+:\\n|\\nvolumes:\\n|$)`);
  const m = composeText.match(re);
  return m ? m[1] : "";
}

describe("docker-compose.yml — care-migrate manual-only guard", () => {
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");

  test("care-migrate service block includes profiles: [manual] (or equivalent list form)", () => {
    const block = getServiceBlock(composeText, "migrate");
    expect(block, "migrate service block should exist and be non-empty").not.toBe("");
    const hasProfilesGate =
      /profiles:\s*\[\s*manual\s*\]/.test(block) ||
      /profiles:\s*\n\s*-\s*manual/.test(block);
    expect(hasProfilesGate, "migrate service must be gated behind profiles: [manual]").toBe(true);
  });

  test("core deployment services (db, db-patch-v2, schema-verify, api, web) are NOT profile-gated", () => {
    for (const name of ["db", "db-patch-v2", "schema-verify", "api", "web"]) {
      const block = getServiceBlock(composeText, name);
      expect(block, `service "${name}" should exist in docker-compose.yml`).not.toBe("");
      expect(block, `service "${name}" should not require a profile to start`).not.toMatch(/^\s*profiles:/m);
    }
  });
});

// ── Postgres must not be published to the whole network ──────────────────────
//
// The db service published "${DB_HOST_PORT:-5400}:5432", which docker binds to
// 0.0.0.0 — the database was reachable from every machine on the clinic network
// (and from the internet if the NAS forwards the port) with the default
// password `changeme`:
//
//   psql -h <nas-ip> -p 5400 -U erp -d diagnostic_erp
//
// Full read/write on patients, bills and reports, bypassing every permission
// check, rate limit and audit trail in the app. SOP/RECOVERY/07_SECURITY/
// ERP_SECURITY_AUDIT.md already rated this High and recommended binding to
// loopback; it was never applied.
//
// Nothing needs the host port: all maintenance scripts use `docker exec` and
// the api reaches the db over the compose network.

describe("docker-compose.yml — the database is not exposed to the network", () => {
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");
  const dbBlock = getServiceBlock(composeText, "db");

  /** The published-port mapping for the db service. */
  function dbPortMapping(): string {
    const m = dbBlock.match(/^\s*-\s*"([^"]*:5432)"\s*$/m);
    expect(m, "db must declare a published port mapping").toBeTruthy();
    return m![1];
  }

  /** Mirrors docker's ${VAR:-default} expansion. */
  function expand(s: string, env: Record<string, string> = {}): string {
    return s.replace(/\$\{(\w+):-([^}]*)\}/g, (_, name: string, dflt: string) => env[name] || dflt);
  }

  test("the mapping carries an explicit bind address, defaulting to loopback", () => {
    // A two-part "PORT:5432" mapping is what docker binds to 0.0.0.0; the
    // three-part form pins the interface. Count parts AFTER expansion —
    // ${DB_BIND_ADDR:-127.0.0.1} contains colons of its own.
    const mapping = dbPortMapping();
    expect(mapping).toContain("${DB_BIND_ADDR:-127.0.0.1}");
    expect(
      expand(mapping).split(":").length,
      `"${mapping}" must expand to HOST_ADDR:HOST_PORT:5432`,
    ).toBe(3);
  });

  test("the default resolves to 127.0.0.1 when DB_BIND_ADDR is unset", () => {
    expect(expand(dbPortMapping())).toBe("127.0.0.1:5400:5432");
    // ...and an operator can still opt into a specific interface (e.g. Tailscale).
    expect(expand(dbPortMapping(), { DB_BIND_ADDR: "100.65.255.115" })).toBe("100.65.255.115:5400:5432");
  });

  test("the web service is still published normally — this change is db-only", () => {
    // Guards against over-applying the fix and making the ERP unreachable.
    const webBlock = getServiceBlock(composeText, "web");
    expect(webBlock).toMatch(/\$\{HOST_PORT:-8888\}:80/);
    expect(webBlock).not.toContain("127.0.0.1:");
  });
});

// ── Backup destination must be a real, persistent mount ───────────────────────
//
// Backup & Replication jobs are configured with a destinationPath like
// /volume1/docker/backups/db — meaningful only on the HOST. Without a bind
// mount at that exact path, it is just an ordinary path INSIDE the api
// container: encryptBackupFile() happily creates it and writes the .enc file
// there, the job logs "success", the checksum matches, the dead-man check
// stays green — and the file lives in the container's ephemeral writable
// layer, not on the NAS. It is deleted the moment the container is recreated,
// with no error anywhere.
//
// docker inspect on the running container confirmed this directly: only
// object_storage and uploads_data were mounted. Nothing backed the path every
// existing backup job was configured to write to.

describe("docker-compose.yml — the backup destination is a real bind mount, not ephemeral", () => {
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");
  const apiBlock = getServiceBlock(composeText, "api");

  test("api has a volume mount covering /volume1/docker/backups", () => {
    expect(apiBlock).toMatch(/:\/volume1\/docker\/backups\s*$/m);
  });

  test("the mount is a bind mount (contains a real path), not a Docker-managed named volume", () => {
    // A bare name like "object_storage:/app/data/..." is a named volume —
    // Docker-managed, and still NOT the same location an operator can find
    // with `ls` on the NAS or point scripts/verify-backup-restore.sh at. The
    // host side here must contain a slash.
    const line = apiBlock.match(/^\s*-\s*(\S*:\/volume1\/docker\/backups)\s*$/m)?.[1] ?? "";
    const hostSide = line.split(":/volume1/docker/backups")[0];
    expect(hostSide, `host side "${hostSide}" of "${line}" must be a real path`).toMatch(/\//);
  });

  test("the default host path matches what the existing Nightly/config/DB jobs already use", () => {
    // So this fix requires zero changes to already-configured backup_jobs
    // rows — the same destinationPath string now resolves to a persistent
    // directory instead of a phantom one inside the container.
    expect(apiBlock).toContain("${BACKUP_HOST_DIR:-/volume1/docker/backups}:/volume1/docker/backups");
  });

  test("the other two api volumes are untouched", () => {
    expect(apiBlock).toContain("object_storage:/app/data/object-storage");
    expect(apiBlock).toContain("uploads_data:/app/data/uploads");
  });

  test("uploads volume comment documents radiology-key-images durability", () => {
    expect(apiBlock).toMatch(/radiology-key-images/);
    expect(apiBlock).toMatch(/DB backup alone is NOT sufficient/i);
  });
});
