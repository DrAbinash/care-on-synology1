// ============================================================================
// I12-D — the read-only backup inventory.
//
// The claim under test is that an inventory tells the truth about what is on
// disk, and never upgrades a fact it does not have: a file with no sidecar is not
// "fine", a recorded checksum is not a verified one, an unreadable
// backup_verification table is not an empty one, and a directory of retries for
// one day is not a week of backups.
//
// Synthetic fixtures only. Nothing here takes a backup, restores one, or touches
// a real DSM job or backup destination.
// ============================================================================
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { makeContext } from "./ops-preflight.mjs";
import { classify, coverageGaps, inspect, main, render, restoreRows } from "./ops-backup-inventory.mjs";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const DB = "diagnostic_erp";
const SENTINEL = "SENTINEL-NOT-A-SECRET-7f3a9b";

let root;
let backupDir;

const write = (rel, text) => {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
  return full;
};

const day = (offsetDays, stamp = "030000") => {
  const d = new Date(NOW - offsetDays * 86_400_000);
  const iso = d.toISOString().slice(0, 10).replace(/-/g, "");
  return { name: `caredeoghar_${iso}_${stamp}.sql.gz`, createdUtc: `${d.toISOString().slice(0, 10)}T03:00:00Z`, dayKey: d.toISOString().slice(0, 10) };
};

/** Lay down one artifact and its sidecar. `over` edits the sidecar or the bytes. */
function artifact(offsetDays, over = {}) {
  const d = day(offsetDays, over.stamp ?? "030000");
  const bytes = Buffer.from(over.body ?? "synthetic gzip bytes");
  const file = write(path.join("backups", d.name), bytes);
  utimesSync(file, new Date(NOW - offsetDays * 86_400_000), new Date(NOW - offsetDays * 86_400_000));
  if (over.sidecar !== false) {
    const lines = [
      `artifact=${d.name}`,
      `created_utc=${over.createdUtc ?? d.createdUtc}`,
      "source_container=care-db",
      `source_database=${over.sourceDatabase ?? DB}`,
      "server_version=PostgreSQL 16.14",
      `exporter=${over.exporter ?? "pg_dump"}`,
      `schema_complete=${over.schemaComplete ?? "true"}`,
      `create_tables=${over.createTables ?? "439"}`,
      `encrypted=${over.encrypted ?? "no"}`,
      `sha256_artifact=${over.sha ?? "0".repeat(64)}`,
      `bytes=${over.bytes ?? bytes.length}`,
      "",
    ];
    write(path.join("backups", `${d.name}.meta`), lines.join("\n"));
  }
  return { ...d, file, bytes: bytes.length };
}

function ctxFor(extra = {}) {
  return makeContext({
    repo: root,
    env: { BACKUP_DIR: path.join(root, "backups"), DB_NAME: DB, ...(extra.env ?? {}) },
    exec: extra.exec ?? (() => ({ code: 0, stdout: "", stderr: "", missing: false })),
    now: () => NOW,
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "i12-inv-"));
  backupDir = path.join(root, "backups");
  mkdirSync(backupDir, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the control: a directory of complete, recent backups", () => {
  test("every artifact is OK, the days are covered, and nothing is claimed about restores", async () => {
    artifact(0);
    artifact(1);
    artifact(2);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts.map((r) => r.status)).toEqual(["OK", "OK", "OK"]);
    expect(inv.counts.OK).toBe(3);
    expect(inv.coverage.missing).toEqual([]);
    expect(inv.coverage.missingToday).toBe(false);
    // Present, manifest and checksum are three facts; restore is a fourth, and
    // three files with sidecars prove nothing about it.
    expect(inv.artifacts.every((r) => r.restored === "unproven")).toBe(true);
    expect(inv.restoreEvidence.databaseRows).toBe(0);
    expect(render(inv)).toMatch(/NO artifact in this inventory has a proven restore/);
  });

  test("an empty but readable directory is reported as empty, not as an error", async () => {
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.anyRootReadable).toBe(true);
    expect(inv.artifacts).toEqual([]);
    expect(render(inv)).toMatch(/holds nothing/);
  });

  test("a destination that cannot be read says nothing is known, not that nothing exists", async () => {
    const inv = await inspect(ctxFor(), [path.join(root, "nope")], { restoreRows: [] });
    expect(inv.anyRootReadable).toBe(false);
    expect(render(inv)).toMatch(/UNKNOWN about the backups/);
    expect(render(inv)).toMatch(/not evidence that there are none/);
    // With nothing observable, the tool must not claim a state for the artifacts.
    expect(render(inv)).not.toMatch(/NO artifact in this inventory has a proven restore/);
  });
});

describe("artifact ↔ manifest pairing", () => {
  test("a file with no sidecar is UNVERIFIED and names what is unknown", async () => {
    artifact(0, { sidecar: false });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].status).toBe("UNVERIFIED");
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/no \.meta sidecar/);
    expect(inv.artifacts[0].checksum).toBe("absent");
  });

  test("a sidecar whose artifact is gone is listed, because retention bugs surface here first", async () => {
    const a = artifact(0);
    artifact(1);
    rmSync(a.file);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.orphanSidecars).toEqual([`${a.name}.meta`]);
    expect(render(inv)).toMatch(/removed without its manifest/);
  });

  test("an interrupted .partial is never counted as a backup", async () => {
    artifact(0);
    write(path.join("backups", "caredeoghar_20261015_030000.sql.gz.partial"), "half a dump");
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts.length).toBe(1);
    expect(inv.interrupted.length).toBe(1);
    expect(render(inv)).toMatch(/must never be restored from/);
  });

  test("a subdirectory is reported instead of silently producing an empty inventory", async () => {
    mkdirSync(path.join(backupDir, "2026-10-14"), { recursive: true });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts).toEqual([]);
    expect(inv.subdirectories).toEqual([path.join(backupDir, "2026-10-14")]);
    expect(render(inv)).toMatch(/NOT searched/);
  });

  test("an encrypted artifact is recognized, with its manifest stating so", async () => {
    const d = day(0);
    const file = write(path.join("backups", `${d.name}.enc`), Buffer.from("openssl-stub"));
    utimesSync(file, new Date(NOW), new Date(NOW));
    write(path.join("backups", `${d.name}.enc.meta`), [
      `artifact=${d.name}.enc`, `created_utc=${d.createdUtc}`, `source_database=${DB}`,
      "exporter=pg_dump", "schema_complete=true", "create_tables=439", "encrypted=yes",
      `sha256_artifact=${"0".repeat(64)}`, `bytes=${8}`, "",
    ].join("\n"));
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts.length).toBe(1);
    expect(inv.artifacts[0].manifest.encrypted).toBe("yes");
  });
});

describe("manifest audit: the claims a sidecar makes about itself", () => {
  test("the wrong source database disqualifies the artifact by name", async () => {
    artifact(0, { sourceDatabase: "db_data" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].status).toBe("INVALID");
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/source_database=db_data but this host is diagnostic_erp/);
  });

  test("a size that disagrees with the file is caught, in both directions", async () => {
    artifact(0, { bytes: 999999 });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/bytes=999999 but file is 20/);
    expect(inv.artifacts[0].status).toBe("INVALID");
  });

  test("a dump with no tables is INVALID even though the file exists", async () => {
    artifact(0, { createTables: "0" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/create_tables=0/);
  });

  test("a data-only dump is named as the defect rather than a smaller backup", async () => {
    artifact(0, { schemaComplete: "false" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/schema_complete=false/);
  });

  test("the remote fallback exporter is flagged on its own artifact", async () => {
    artifact(0, { exporter: "node-pg-remote" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    // /remote/ is the accepted marker the #1004 script writes; a plain non-pg_dump
    // exporter is what must fail.
    expect(inv.artifacts[0].status).toBe("OK");
    artifact(1, { exporter: "mystery", stamp: "040000" });
    const again = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(again.artifacts.find((r) => r.day === day(1).dayKey).problems.join(" ")).toMatch(/exporter=mystery/);
  });

  test("a malformed digest is INVALID and an absent one is not silently fine", async () => {
    artifact(0, { sha: "not-a-hash" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/sha256_artifact is malformed/);

    artifact(1, { sha: "", stamp: "040000" });
    const again = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(again.artifacts.find((r) => r.day === day(1).dayKey).problems.join(" ")).toMatch(/sha256_artifact is not recorded/);
  });
});

describe("checksums: recorded is not verified", () => {
  test("without --verify-checksums a digest is only reported as recorded", async () => {
    artifact(0);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].checksum).toBe("recorded");
    expect(inv.artifacts[0].verifiedSha).toBeNull();
    expect(inv.checksums).toMatch(/not recomputed/);
  });

  test("with --verify-checksums the digest is computed and a mismatch is INVALID", async () => {
    const { createHash } = await import("node:crypto");
    const body = "synthetic gzip bytes";
    const good = createHash("sha256").update(body).digest("hex");
    artifact(0, { sha: good });
    artifact(1, { sha: "f".repeat(64), stamp: "040000" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    const verified = await inspect(ctxFor(), [backupDir], { verifyChecksums: true, restoreRows: [] });
    expect(verified.artifacts.find((r) => r.day === day(0).dayKey).checksum).toBe("verified");
    const bad = verified.artifacts.find((r) => r.day === day(1).dayKey);
    expect(bad.checksum).toBe("MISMATCH");
    expect(bad.status).toBe("INVALID");
    expect(bad.problems.join(" ")).toMatch(/the bytes are/);
    // The plain inventory must NOT have upgraded anything.
    expect(inv.artifacts.every((r) => r.checksum !== "verified")).toBe(true);
  });
});

describe("freshness and day coverage", () => {
  test("an artifact past the limit is STALE, and the limit is the operator's", async () => {
    artifact(2);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].status).toBe("STALE");
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/past the 26h freshness limit/);

    const relaxed = await inspect(ctxFor({ env: { PREFLIGHT_MAX_BACKUP_AGE_HOURS: "60" } }), [backupDir], { restoreRows: [] });
    expect(relaxed.artifacts[0].status).toBe("OK");
  });

  test("four dumps from one day do not make four days of coverage", async () => {
    artifact(0, { stamp: "010000" });
    artifact(0, { stamp: "020000" });
    artifact(0, { stamp: "030000" });
    artifact(0, { stamp: "040000" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts.length).toBe(4);
    expect(inv.coverage.distinctDays).toBe(1);
    expect(inv.coverage.missing).toEqual([]);
    expect(inv.coverage.oldest).toBe(inv.coverage.newest);
  });

  test("a gap in the middle of the retained span is listed day by day", async () => {
    artifact(0);
    artifact(4);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.coverage.missing).toEqual([day(3).dayKey, day(2).dayKey, day(1).dayKey]);
    expect(render(inv)).toMatch(/MISSING 3 day/);
    expect(render(inv)).toMatch(/nothing from it is recoverable/);
  });

  test("coverageGaps works on the day keys alone, oldest first", () => {
    const g = coverageGaps(["2026-10-01", "2026-10-04"], NOW);
    expect(g.missing).toEqual(["2026-10-02", "2026-10-03"]);
    expect(g.distinctDays).toBe(2);
  });

  test("a file dated in the future is INVALID, because retention arithmetic cannot see it", async () => {
    // `find -mtime +N -delete` counts backwards from now. An artifact whose mtime
    // is ahead of the clock is invisible to that expression forever, and its age
    // computes negative — so a clock-skewed box would show an eternally fresh
    // backup that no retention pass will ever rotate.
    const a = artifact(0, { stamp: "050000" });
    const future = NOW + 3 * 86_400_000;
    utimesSync(a.file, new Date(future), new Date(future));
    writeFileSync(`${a.file}.meta`, readFileSync(`${a.file}.meta`, "utf8").replace(/^bytes=.*/m, `bytes=${a.bytes}`));
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].status).toBe("INVALID");
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/in the future/);
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/find -mtime/);
  });

  test("the manifest date wins over the file mtime, because a copy preserves mtimes", async () => {
    artifact(0, { createdUtc: "2026-10-05T03:00:00Z" });
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].day).toBe("2026-10-05");
    expect(inv.artifacts[0].ageHours).toBeLessThan(1);
  });
});

describe("restore evidence, per artifact", () => {
  test("a recorded proof marks exactly the artifact it names", async () => {
    const today = artifact(0);
    artifact(1);
    write("ops-evidence.json", JSON.stringify({
      restore_verification: { artifact: today.name, verified_at: new Date(NOW - 3_600_000).toISOString(), passed: true, tables: 439 },
    }));
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts.find((r) => r.artifact === today.name).restored).toBe("recorded");
    expect(inv.artifacts.find((r) => r.day === day(1).dayKey).restored).toBe("unproven");
    expect(render(inv)).toMatch(/recorded for caredeoghar/);
  });

  test("a proof older than the evidence window is a stale record, not a pass", async () => {
    const today = artifact(0);
    write("ops-evidence.json", JSON.stringify({
      restore_verification: { artifact: today.name, verified_at: new Date(NOW - 200 * 86_400_000).toISOString(), passed: true },
    }));
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.artifacts[0].restored).toBe("stale-record");
    expect(inv.artifacts[0].problems.join(" ")).toMatch(/re-prove it/);
  });

  test("a backup_verification row marks the artifact it names, and only PASSED rows", async () => {
    const a = artifact(0);
    const b = artifact(1, { stamp: "040000" });
    const inv = await inspect(ctxFor(), [backupDir], {
      restoreRows: [
        { artifact: a.name, verified_at: "2026-10-15T04:00:00Z", status: "PASSED" },
        { artifact: b.name, verified_at: "2026-10-14T04:00:00Z", status: "FAILED" },
      ],
    });
    expect(inv.artifacts.find((r) => r.artifact === a.name).restored).toBe("in-database");
    expect(inv.artifacts.find((r) => r.artifact === b.name).restored).toBe("unproven");
  });

  test("the inventory says out loud when nothing is proved, and stops when something is", async () => {
    // This sentence is the reason the tool exists: a directory can hold seven
    // perfect dumps and still never have been tested. It must appear while no
    // artifact has a proof and disappear when one does — a banner pinned to
    // always-print is noise, and one that never prints hides the only finding
    // that a backup count cannot show.
    artifact(0);
    artifact(1);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(render(inv)).toMatch(/NO artifact in this inventory has a proven restore/);

    const proved = artifact(2, { stamp: "060000" });
    write("ops-evidence.json", JSON.stringify({
      restore_verification: { artifact: proved.name, verified_at: new Date(NOW - 3_600_000).toISOString(), passed: true },
    }));
    const again = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(render(again)).not.toMatch(/NO artifact in this inventory has a proven restore/);
    expect(again.artifacts.find((r) => r.artifact === proved.name).restored).toBe("recorded");
  });

  test("no DATABASE_URL means backup_verification was NOT READ — never reported as empty", async () => {
    artifact(0);
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: null });
    expect(inv.restoreEvidence.databaseRows).toBeNull();
    expect(render(inv)).toMatch(/backup_verification: not read \(no DATABASE_URL\)/);
    expect(render(inv)).not.toMatch(/0 row\(s\) in backup_verification/);
  });

  test("restoreRows() asks psql only when a URL exists, and reports its own failure", () => {
    const calls = [];
    const noUrl = restoreRows(makeContext({ repo: root, env: { DB_NAME: DB }, exec: () => ({ code: 0, stdout: "", stderr: "", missing: false }) }));
    expect(noUrl.rows).toBeNull();
    expect(noUrl.note).toMatch(/not set/);

    const ctx = makeContext({
      repo: root,
      env: { DB_NAME: DB, DATABASE_URL: "postgresql://erp@127.0.0.1:59999/diagnostic_erp" },
      exec: (cmd, args) => { calls.push([cmd, args.join(" ")]); return { code: 1, stdout: "", stderr: "no such table: backup_verification\n", missing: false }; },
    });
    const failed = restoreRows(ctx);
    expect(failed.rows).toBeNull();
    expect(failed.note).toMatch(/could not be read .*no such table/);
    expect(calls[0][0]).toBe("psql");

    const ok = restoreRows(makeContext({
      repo: root,
      env: { DB_NAME: DB, DATABASE_URL: "postgresql://erp@127.0.0.1:59999/diagnostic_erp" },
      exec: () => ({ code: 0, stdout: "caredeoghar_x.sql.gz|2026-10-15T04:00:00Z|PASSED\n", stderr: "", missing: false }),
    }));
    expect(ok.rows).toEqual([{ artifact: "caredeoghar_x.sql.gz", verified_at: "2026-10-15T04:00:00Z", status: "PASSED" }]);
  });

  test("a broken evidence file degrades the note, not the inventory", async () => {
    artifact(0);
    write("ops-evidence.json", "{ not json");
    const inv = await inspect(ctxFor(), [backupDir], { restoreRows: [] });
    expect(inv.restoreEvidence.evidenceError).toMatch(/unparseable/);
    expect(inv.artifacts.length).toBe(1);
  });
});

describe("output contract", () => {
  test("nothing that looks like a credential or a patient field is printed", async () => {
    artifact(0);
    write(".env", `DB_PASSWORD=${SENTINEL}\nJWT_SECRET=${SENTINEL}\nPATIENT_NAME=Some Patient\n`);
    const inv = await inspect(ctxFor({ env: { DB_PASSWORD: SENTINEL, JWT_SECRET: SENTINEL } }), [backupDir], { restoreRows: [] });
    const text = render(inv) + JSON.stringify(inv);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toMatch(/PATIENT_NAME/);
    // A manifest may record a container name; it must never be asked to record a password.
    expect(text).not.toMatch(/postgres:\/\/|postgresql:\/\//i);
  });

  test("--json is parseable and carries the same facts as the text", async () => {
    artifact(0);
    const chunks = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(String(c)); return true; };
    let code;
    try {
      code = await main(["--json"], { ctx: ctxFor(), roots: [backupDir], restoreRows: [] });
    } finally { process.stdout.write = realWrite; }
    expect(code).toBe(0);
    const parsed = JSON.parse(chunks.join(""));
    expect(parsed.artifacts[0].artifact).toBe(day(0).name);
    expect(parsed.counts.OK).toBe(1);
  });

  test("an unreadable destination exits 2, which is a finding about the box", async () => {
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      const code = await main([], { ctx: ctxFor(), roots: [path.join(root, "nope")], restoreRows: [] });
      expect(code).toBe(2);
    } finally { process.stdout.write = realWrite; }
  });

  test("classify does not invent an artifact out of a stray file", () => {
    write(path.join("backups", "notes.txt"), "not a backup");
    write(path.join("backups", "caredeoghar_not-a-timestamp.sql.gz"), Buffer.from("x"));
    const inv = classify(ctxFor(), [backupDir]);
    expect(inv.artifacts.map((a) => a.name)).toEqual(["caredeoghar_not-a-timestamp.sql.gz"]);
    expect(inv.other.map((f) => f.name)).toEqual(["notes.txt"]);
  });
});
