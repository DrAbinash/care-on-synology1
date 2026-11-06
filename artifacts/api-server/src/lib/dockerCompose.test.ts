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

// ── The compose project name is pinned ───────────────────────────────────────
//
// Without a top-level `name:`, Docker Compose derives the project from the
// directory it is invoked in. This deployment is invoked from several: the NAS
// deploy checkout, Synology Container Manager's own path, and a copy per working
// session. Every distinct directory is a distinct project, so `docker compose up
// -d` does not update the running stack — it builds a parallel one beside it,
// while Container Manager keeps presenting the old stack as current.
//
// Measured on the NAS 2026-10-28: 18 volumes named
// care-erp{1-github,-git,-claude,-fable,-github-cursor}_{db_data,object_storage,
// uploads_data}. db_data kept its data only because it is `external: true` with a
// fixed name; the two volumes that are not external were recreated empty under
// each new prefix — a deploy from a fresh directory silently loses report
// attachments while the database still looks intact.
//
// This test cannot catch the drift itself (it reads the repo, not the NAS); it
// catches the pin being dropped or renamed, which is what puts the clinic back at
// risk. `.trim()` on the captured value is load-bearing: the file is checked out
// CRLF on Windows and the CR would otherwise land in the value.

describe("docker-compose.yml — the project name is pinned", () => {
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");

  /** Unindented `key: value` lines, i.e. the document's top-level keys. Service
   *  keys are indented two spaces, so they cannot appear here. */
  function topLevelEntries(): { key: string; value: string }[] {
    return [...composeText.matchAll(/^([A-Za-z_-]+):[ \t]*(.*)$/gm)].map((m) => ({
      key: m[1],
      value: m[2].trim(),
    }));
  }

  test("declares exactly one top-level name, and it is the one production runs under", () => {
    const names = topLevelEntries().filter((e) => e.key === "name");
    expect(names.map((n) => n.value), "a second top-level name: would make the file ambiguous").toHaveLength(1);
    expect(names[0].value).toBe("care-erp-github");
  });

  test("still declares the other top-level keys the deploy depends on", () => {
    const keys = topLevelEntries().map((e) => e.key);
    for (const required of ["services", "volumes"]) {
      expect(keys, `top-level "${required}" is missing`).toContain(required);
    }
  });
});

// ── deploy-synology.sh must not override the pin ─────────────────────────────
//
// A `-p`/`--project-name` on the command line wins over the file, so the pin
// above is only as good as the script that does not contradict it. Measured on
// 2026-10-28: the script passed no project flag at all, which is exactly how the
// directory name ended up deciding.

describe("deploy-synology.sh — it does not fight the pinned project name", () => {
  const script = readFileSync(resolve(__dirname, "../../../../deploy-synology.sh"), "utf-8");

  test("no compose invocation passes a project name", () => {
    const offenders = script
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => /docker[ ]+compose/.test(l) && /(\-p|--project-name)[ =]/.test(l));
    expect(offenders, "compose must inherit the project name from docker-compose.yml").toEqual([]);
  });

  test("it runs compose, so the pin in the file is what takes effect", () => {
    expect(script).toMatch(/docker compose up[ ]+-d/);
  });
});
