// ============================================================================
// PR-2 (Tasks 1 and 2) — the ERP document volumes: archive with a deterministic
// manifest, and an isolated restore that refuses an artifact it cannot trust.
//
// Everything here runs against synthetic fixtures in a temp directory. No patient file,
// no production volume, no DSM job and no database is involved. The fixtures deliberately
// use patient-shaped file names so the tests can prove those names never reach the output.
//
// The hostile archives are built by scripts/tarFixture.mjs rather than by `tar`, because
// on this platform bsdtar refuses to STORE a traversal path at all: a test that needed
// `tar` to create one would silently do nothing and still report green. A hand-built byte
// stream is the same hostile input on Linux, Windows and CI.
// ============================================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { gzipSync } from "node:zlib";

import { isArtifact } from "./ops-preflight.mjs";
import { REJECTIONS, auditEntries, decodeHeader, extractEntries, main, normalizeName, parseManifest, pathProblem, readTar, summaryLine, typeProblem, verify } from "./verify-uploads-restore.mjs";
import { BLOCK, manifestOf, tar as buildTar } from "./tarFixture.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const ARCHIVE = path.join(REPO, "scripts", "synology-uploads-archive.sh");
const VERIFY = path.join(REPO, "scripts", "verify-uploads-restore.mjs");
const MANIFEST_NAME = "MANIFEST.sha256";
const SPAWN = 60_000;
const PASS = "sentinel-passphrase-not-a-real-one-4f2a";

const POSIX = (p) => (process.platform === "win32" ? String(p).replace(/\\/g, "/").replace(/^([A-Za-z]:)/, (_m, d) => d.toLowerCase()) : p);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const TOOLCHAIN = spawnSync("sh", ["-c", "command -v tar && command -v gzip && command -v sha256sum && command -v openssl && command -v mktemp && command -v stat"], { encoding: "utf8" }).status === 0;

const roots = [];
function tempRoot(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  roots.push(root);
  return root;
}

function runSh(args, env = {}) {
  const r = spawnSync("sh", [POSIX(ARCHIVE), ...args.map(POSIX)], { encoding: "utf8", cwd: REPO, env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function runVerify(args, env = {}) {
  const r = spawnSync(process.execPath, [POSIX(VERIFY), ...args.map(POSIX)], { encoding: "utf8", cwd: REPO, env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const kv = (meta, key) => {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(meta, "utf8"));
  return m ? m[1].trim() : null;
};

const DOCUMENTS = [
  ["expenses/EXP-41_ab12cd34_RAMESH-KUMAR-bill.pdf", "bill-a\n"],
  ["scanned/sub/REF-7_patient-77_referral.jpg", "jpeg-ish\n"],
  ["site/queue-display.json", '{"updated":"2026-10-15"}\n'],
];

function fixture(kind = "uploads", extra = []) {
  const root = tempRoot("uploads-pr2");
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  mkdirSync(src, { recursive: true });
  for (const [rel, body] of kind === "empty" ? [] : [...DOCUMENTS, ...extra]) {
    const full = path.join(src, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  mkdirSync(dest, { recursive: true });
  return { root, src, dest };
}

const treeHash = (dir) => {
  const acc = [];
  const walk = (d, prefix) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      const rel = `${prefix}${name}`;
      if (statSync(full).isDirectory()) { acc.push(`${rel}/`); walk(full, `${rel}/`); }
      else acc.push(`${rel}:${sha(readFileSync(full))}`);
    }
  };
  walk(dir, "");
  return sha(Buffer.from(acc.join("\n"), "utf8"));
};

const published = (dir) => readdirSync(dir).filter((n) => !n.startsWith(".") && !n.endsWith(".meta")).sort();
/** Newest generation by mtime. Name order is NOT age order: a same-second second run is
 *  written as `…+1.tar.gz`, and `+` sorts before `.`, so the lexicographic "last" is the
 *  older file and a test that read it would be checking the wrong artifact. */
const byAge = (dir) => published(dir).map((n) => ({ n, t: statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t);
const artifactOf = (dir) => {
  const list = byAge(dir);
  expect(list.length, "no artifact was published").toBeGreaterThan(0);
  return path.join(dir, list[list.length - 1].n);
};
const oldestOf = (dir) => path.join(dir, byAge(dir)[0].n);

/** Build an archive and sidecar exactly as the job would, then let the test lie about it. */
function hostile(files, { extraEntries = [], manifestText, sidecar = {}, name = "backup_uploads_2026-01-01T00-00-00-UTC.tar.gz", root, compress = true } = {}) {
  const withManifest = manifestText !== false;
  const text = withManifest ? (manifestText ?? manifestOf(files)) : "";
  const entries = [
    ...(withManifest ? [{ name: MANIFEST_NAME, content: text }] : []),
    ...files.map(([n, c]) => ({ name: n, content: c })),
    ...extraEntries,
  ];
  const raw = buildTar(entries);
  const bytes = compress ? gzipSync(raw) : raw;
  const artifact = path.join(root ?? tempRoot("hostile"), name);
  writeFileSync(artifact, bytes);
  const rows = withManifest ? parseManifest(text).filter((r) => !r.bad) : [];
  const fields = {
    artifact: name,
    created_utc: "2026-01-01T00:00:00Z",
    source_container: "care-api",
    source_database: "not_applicable",
    exporter: "synology-uploads-archive",
    schema_complete: "true",
    create_tables: "0",
    encrypted: "no",
    bytes: String(bytes.length),
    sha256_sql_gzipped: sha(bytes),
    sha256_artifact: sha(bytes),
    archive_class: "uploads",
    manifest_files: String(rows.length),
    manifest_bytes: String(rows.reduce((a, r) => a + r.bytes, 0)),
    manifest_sha256: withManifest ? sha(Buffer.from(text, "utf8")) : null,
    ...sidecar,
  };
  writeFileSync(`${artifact}.meta`, Object.entries(fields).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", "utf8");
  return { artifact, bytes };
}

/** The verifier is a drill: point it at a directory and it leaves the tree there. */
function restoreInto(artifact, dir, env = {}) {
  if (existsSync(dir) && readdirSync(dir).length > 0) rmSync(dir, { recursive: true, force: true });
  return runVerify([artifact, "--into", dir], env);
}

beforeAll(() => {
  expect(TOOLCHAIN, "sh, tar, gzip, sha256sum, openssl, mktemp and stat must all answer or these tests mean nothing").toBe(true);
});

afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────────
// TASK 1 — the archive job
// ────────────────────────────────────────────────────────────────────────────
describe("the archive job", () => {
  test("archives a populated volume, writes a sidecar, and leaves the source byte-identical", () => {
    const f = fixture();
    const before = treeHash(f.src);
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    expect(r.code, r.out).toBe(0);
    expect(treeHash(f.src), "a backup must never write to the volume it is reading").toBe(before);

    const arts = published(f.dest);
    expect(arts.length).toBe(1);
    expect(arts[0]).toMatch(/^backup_uploads_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-UTC\.tar\.gz$/);
    const meta = `${path.join(f.dest, arts[0])}.meta`;
    expect(existsSync(meta), "no sidecar means the artifact cannot be verified later").toBe(true);
    expect(kv(meta, "archive_class")).toBe("uploads");
    expect(kv(meta, "manifest_files")).toBe("3");
    expect(Number(kv(meta, "manifest_bytes"))).toBeGreaterThan(10);
    expect(kv(meta, "encrypted")).toBe("no");
    expect(kv(meta, "exporter")).toBe("synology-uploads-archive");
    expect(kv(meta, "source_database")).toBe("not_applicable");
    expect(kv(meta, "sha256_artifact")).toBe(sha(readFileSync(path.join(f.dest, arts[0]))));
    expect(kv(meta, "manifest_sha256")).toMatch(/^[0-9a-f]{64}$/);
  }, SPAWN);

  test("the manifest inside the archive lists every file with its hash, byte count and mode", () => {
    const f = fixture("uploads", [["site/executable.sh", "#!/bin/sh\n"]]);
    try { execFileSync("chmod", ["755", path.join(f.src, "site", "executable.sh")]); } catch { /* win32 no-op */ }
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    expect(r.code, r.out).toBe(0);
    const into = path.join(f.root, "restore");
    const v = restoreInto(artifactOf(f.dest), into);
    expect(v.code, v.out).toBe(0);
    const rows = parseManifest(readFileSync(path.join(into, MANIFEST_NAME), "utf8"));
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.sha).toMatch(/^[0-9a-f]{64}$/);
      expect(row.bytes).toBe(statSync(path.join(into, ...row.name.split("/"))).size);
      expect(row.mode).toMatch(/^\d{3,4}$/);
    }
    expect(rows.map((x) => x.name)).toContain("site/executable.sh");
  }, SPAWN);

  test("an EMPTY volume is a valid backup with files=0, and restoring it is a verified no-op", () => {
    const f = fixture("empty");
    const r = runSh(["--class", "object_storage", "--src", f.src, "--dest", f.dest]);
    expect(r.code, r.out).toBe(0);
    expect(published(f.dest).length).toBe(1);
    const art = artifactOf(f.dest);
    expect(kv(`${art}.meta`, "manifest_files")).toBe("0");
    expect(kv(`${art}.meta`, "manifest_bytes")).toBe("0");
    const v = runVerify([art]);
    expect(v.code, v.out).toBe(0);
    expect(v.out).toMatch(/verified=0 of 0/);
  }, SPAWN);

  test("a missing source is NOT reported as an empty one", () => {
    const f = fixture();
    const r = runSh(["--class", "uploads", "--src", path.join(f.root, "does-not-exist"), "--dest", f.dest]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/missing is not empty/);
    expect(published(f.dest).length).toBe(0);
  }, SPAWN);

  test("spaces, Unicode and deep nesting survive the round trip", () => {
    const f = fixture("uploads", [
      ["site/réport copie 1.txt", "unicode name\n"],
      ["scanned/2026/10/15/deep/deeper/deepest/aadhaar-1234 5678 copy (1).pdf", "deep\n"],
    ]);
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    expect(r.code, r.out).toBe(0);
    const into = path.join(f.root, "restore");
    const v = restoreInto(artifactOf(f.dest), into);
    expect(v.code, v.out).toBe(0);
    expect(v.out).toMatch(/verified=5 of 5/);
    expect(existsSync(path.join(into, "site", "réport copie 1.txt"))).toBe(true);
    expect(existsSync(path.join(into, "scanned", "2026", "10", "15", "deep", "deeper", "deepest", "aadhaar-1234 5678 copy (1).pdf"))).toBe(true);
  }, SPAWN);

  test("an empty directory is preserved, because a tree missing its folders is not the tree", () => {
    const f = fixture("uploads");
    mkdirSync(path.join(f.src, "scanned", "pending"), { recursive: true });
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    expect(r.code, r.out).toBe(0);
    expect(kv(`${artifactOf(f.dest)}.meta`, "manifest_empty_dirs")).toBe("1");
    const into = path.join(f.root, "restore");
    const v = restoreInto(artifactOf(f.dest), into);
    expect(v.code, v.out).toBe(0);
    expect(statSync(path.join(into, "scanned", "pending")).isDirectory()).toBe(true);
  }, SPAWN);

  test("the manifest is deterministic, and one changed byte changes it", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const first = kv(`${artifactOf(f.dest)}.meta`, "manifest_sha256");
    writeFileSync(path.join(f.src, "site", "queue-display.json"), '{"updated":"2026-10-16"}\n', "utf8");
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    expect(kv(`${artifactOf(f.dest)}.meta`, "manifest_sha256")).not.toBe(first);
    const g = fixture();
    runSh(["--class", "uploads", "--src", g.src, "--dest", g.dest]);
    expect(kv(`${artifactOf(g.dest)}.meta`, "manifest_sha256")).toBe(first);
  }, SPAWN);

  test("with a passphrase the envelope is the approved one and is proven to decrypt", () => {
    const f = fixture();
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { BACKUP_PASSPHRASE: PASS });
    expect(r.code, r.out).toBe(0);
    const art = artifactOf(f.dest);
    expect(art).toMatch(/\.tar\.gz\.enc$/);
    expect(kv(`${art}.meta`, "encrypted")).toBe("yes");
    expect(readFileSync(art).subarray(0, 8).toString("latin1")).toBe("Salted__");
    const v = runVerify([art], { BACKUP_PASSPHRASE: PASS });
    expect(v.code, v.out).toBe(0);
    expect(v.out).toMatch(/encryption=verified/);
    expect(v.out).toMatch(/verified=3 of 3/);
  }, SPAWN);

  test("an encrypted run leaves no plaintext behind, and an unencrypted run says so", () => {
    const f = fixture();
    runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { BACKUP_PASSPHRASE: PASS });
    const names = readdirSync(f.dest);
    expect(names.filter((n) => n.endsWith(".tar.gz")), "the plaintext survived the round-trip proof").toEqual([]);
    expect(names.filter((n) => n.includes("partial"))).toEqual([]);
    expect(names.every((n) => n.endsWith(".enc") || n.endsWith(".enc.meta"))).toBe(true);
    const plain = fixture();
    runSh(["--class", "uploads", "--src", plain.src, "--dest", plain.dest]);
    expect(kv(`${artifactOf(plain.dest)}.meta`, "encrypted")).toBe("no");
    expect(readdirSync(plain.dest).some((n) => n.includes("partial"))).toBe(false);
  }, SPAWN);

  test("a job that is killed part-way publishes nothing an inventory could mistake for a backup", async () => {
    const f = fixture();
    writeFileSync(path.join(f.src, "expenses", "large.bin"), Buffer.alloc(48 * 1024 * 1024, 7));
    const child = spawn("sh", [POSIX(ARCHIVE), "--class", "uploads", "--src", f.src, "--dest", f.dest], { cwd: REPO, env: process.env });
    await new Promise((resolve) => setTimeout(resolve, 150));
    child.kill("SIGKILL");
    await new Promise((resolve) => child.on("exit", resolve));
    for (const n of readdirSync(f.dest)) {
      if (n.endsWith(".meta")) continue;
      const full = path.join(f.dest, n);
      if (n.endsWith(".partial") || n.startsWith(".")) {
        expect(isArtifact(n), `${n} must not count as a backup artifact`).toBe(false);
        continue;
      }
      // A published name can only exist if the job got past verification; if it was cut
      // off between publish and sidecar, the verifier has to refuse it rather than trust it.
      if (!existsSync(`${full}.meta`)) {
        const v = runVerify([full]);
        expect(v.code).toBe(1);
        expect(v.out).toMatch(/NO_SIDECAR/);
      }
    }
    const done = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    expect(done.code, done.out).toBe(0);
    expect(runVerify([artifactOf(f.dest)]).code).toBe(0);
  }, SPAWN);

  test("nothing is deleted unless retention is asked for twice over", () => {
    const f = fixture();
    runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { KEEP_DAYS: "1" });
    expect(published(f.dest).length).toBe(2);
    const warned = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { KEEP_DAYS: "1" });
    expect(warned.out).toMatch(/DELETE_OLD is not 1/);
    expect(published(f.dest).length).toBe(3);
    const old = oldestOf(f.dest);
    const stamp = new Date(Date.now() - 40 * 86400000);
    utimesSync(old, stamp, stamp);
    if (existsSync(`${old}.meta`)) utimesSync(`${old}.meta`, stamp, stamp);
    runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { KEEP_DAYS: "30", DELETE_OLD: "1" });
    expect(existsSync(old), "an out-of-retention generation should have been removed").toBe(false);
    expect(existsSync(`${old}.meta`), "its sidecar must not outlive the artifact it describes").toBe(false);
    expect(published(f.dest).length).toBe(3);
  }, SPAWN);

  test("a KEEP_DAYS that is not a number is refused rather than read as zero", () => {
    const f = fixture();
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { KEEP_DAYS: "seven" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/KEEP_DAYS must be a non-negative integer/);
  }, SPAWN);

  test("a source or destination inside the repository is refused outright", () => {
    const inside = path.join(REPO, "tmp-pr2-dest");
    mkdirSync(inside, { recursive: true });
    const f = fixture();
    try {
      const r = runSh(["--class", "uploads", "--src", f.src, "--dest", inside]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/inside the repository|never enter GitHub/);
      const back = runSh(["--class", "uploads", "--src", REPO, "--dest", f.dest]);
      expect(back.code).toBe(1);
      expect(back.out).toMatch(/inside the repository/);
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
  }, SPAWN);

  test("a destination inside a .git directory is refused on its own terms", () => {
    // The guard above compares against the repository this script sits in, so it does not cover
    // a clone reached by another path — the deploy checkout's own `.git`, or a worktree's gitdir.
    // Only the `.git` arm refuses that, and it had no test behind it (mutant #46 survived the
    // battery, which is how I know the sentence "never enter GitHub" was not yet proven).
    const f = fixture("uploads", []);
    const repo = tempRoot("fakerepo");
    const into = path.join(repo, ".git", "backups");
    const r = runSh(["--class", "uploads", "--src", f.src, "--dest", into]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/inside a \.git directory/);
    expect(readdirSync(into), "the refusal must happen before anything is written").toEqual([]);
  }, SPAWN);

  test("an unknown class is a usage error, not a silent archive of nothing", () => {
    const f = fixture();
    const r = runSh(["--class", "dicom_images", "--src", f.src, "--dest", f.dest]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/--class must be uploads or object_storage/);
  }, SPAWN);

  test("the database gate cannot be satisfied by a document archive", () => {
    // `isArtifact` is what `backup.freshness` and `backup.artifacts_present` count. If an
    // uploads archive joined that set, a fresh 83 MB tar would answer for a database that
    // was never dumped — two different questions, one green light.
    expect(isArtifact("backup_uploads_2026-10-16T03-00-00-UTC.tar.gz")).toBe(false);
    expect(isArtifact("backup_uploads_2026-10-16T03-00-00-UTC.tar.gz.enc")).toBe(false);
    expect(isArtifact("backup_object_storage_2026-10-16T03-00-00-UTC.tar.gz.enc")).toBe(false);
    expect(isArtifact(".backup_uploads_2026-10-16T03-00-00-UTC.tar.gz.partial")).toBe(false);
    expect(isArtifact("backup_DB_2026-10-16T03-00-00-UTC.sql.enc")).toBe(true);
    expect(isArtifact("caredeoghar_20261016_030000.sql.gz")).toBe(true);
  });
});
// ────────────────────────────────────────────────────────────────────────────
// TASK 2 — the isolated restore, entry type by entry type. Each case is an artifact the
// backup job could not have written; the restore must refuse the whole archive and write
// nothing, rather than extract the safe part and mention the rest on a second line.
// ────────────────────────────────────────────────────────────────────────────
describe("the restore refuses every entry shape a document volume cannot contain", () => {
  const GOOD = [["expenses/listed.pdf", "known\n"]];

  const cases = [
    ["a member that walks out of the restore directory", { name: "../escape.txt", content: "victim\n" }, "TRAVERSAL"],
    ["a member that walks out after normalisation", { name: "expenses/../../escape.txt", content: "victim\n" }, "TRAVERSAL"],
    ["an absolute member path", { name: "/etc/passwd-synthetic", content: "victim\n" }, "ABSOLUTE_PATH"],
    ["a Windows drive-qualified member path", { name: "C:/Windows/synthetic.ini", content: "victim\n" }, "DRIVE_PATH"],
    ["a UNC member path", { name: "//server/share/victim.txt", content: "victim\n" }, "UNC_PATH"],
    ["a backslash member path", { name: "..\\escape.txt", content: "victim\n" }, "BACKSLASH_PATH"],
    ["a member path containing a control character", { name: "expenses/bad\x01name.txt", content: "victim\n" }, "CONTROL_CHARACTER"],
    ["a symbolic-link member", { name: "expenses/link.txt", type: "2", linkname: "/etc/passwd" }, "SYMLINK_MEMBER"],
    ["a symbolic-link member whose target is relative and escaping", { name: "expenses/link2.txt", type: "2", linkname: "../../../etc/passwd" }, "SYMLINK_MEMBER"],
    ["a hard-link member", { name: "expenses/hard.txt", type: "1", linkname: "/etc/shadow" }, "HARDLINK_MEMBER"],
    ["a character-device member", { name: "expenses/dev.txt", type: "3" }, "DEVICE_MEMBER"],
    ["a block-device member", { name: "expenses/blk.txt", type: "4" }, "DEVICE_MEMBER"],
    ["a FIFO member", { name: "expenses/pipe.txt", type: "6" }, "FIFO_MEMBER"],
    ["a contiguous-file member", { name: "expenses/odd.txt", type: "7" }, "SOCKET_MEMBER"],
    ["an entry type this restore does not represent", { name: "Expenses/weird.txt", type: "Q" }, "UNSUPPORTED_MEMBER"],
    ["the same path stored twice", { name: "expenses/listed.pdf", content: "second copy\n" }, "DUPLICATE_ENTRY"],
    ["the same path as two different types", { name: "expenses/listed.pdf", type: "5" }, "CONFLICTING_TYPE"],
    ["the manifest stored twice", null, "MULTIPLE_MANIFESTS"],
    ["no manifest at all", null, "NO_MANIFEST"],
  ];

  for (const [label, extra, code] of cases) {
    test(`refuses ${label} with ${code}, and writes nothing`, () => {
      const root = tempRoot("hostile-entry");
      const extraEntries = code === "MULTIPLE_MANIFESTS" ? [{ name: MANIFEST_NAME, content: "" }] : extra ? [extra] : [];
      const built = hostile(GOOD, { root, extraEntries, manifestText: code === "NO_MANIFEST" ? false : undefined });
      const into = path.join(root, "into");
      const v = restoreInto(built.artifact, into);
      expect(v.code, v.out).toBe(1);
      expect(v.out).toContain(`REJECTED ${code}`);
      expect(v.out).toMatch(/structure=invalid/);
      expect(v.out).not.toMatch(/restore=verified/);
      // Nothing at all was extracted: not the hostile entry, not even the safe one.
      const left = existsSync(into) ? readdirSync(into) : [];
      expect(left, `a refused archive must leave an empty restore directory, found ${left.join(", ")}`).toEqual([]);
      expect(existsSync(path.join(root, "escape.txt"))).toBe(false);
    }, SPAWN);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// TASK 2 — limits: a decompression bomb and an unbounded member list must not be
// allowed to run the box out of memory while "verifying" a backup.
// ────────────────────────────────────────────────────────────────────────────
describe("the restore enforces its own limits", () => {
  test("an archive that inflates past the limit is stopped while it inflates", () => {
    const root = tempRoot("bomb");
    // 4 MB of zeros is ~4 KB gzipped: the classic shape of a bomb, and a real member of a
    // volume this size would never be this compressible.
    const files = [["expenses/bomb.bin", Buffer.alloc(4 * 1024 * 1024, 0)]];
    const { artifact } = hostile(files, { root, manifestText: manifestOf([["expenses/bomb.bin", Buffer.alloc(4 * 1024 * 1024, 0)]]) });
    const v = runVerify([artifact, "--max-bytes", "262144"]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/COMPRESSED_SIZE_EXCEEDED/);
    expect(v.out).toMatch(/limit of 262144/);
  }, SPAWN);

  test("an archive with more members than the limit is refused by count", () => {
    const root = tempRoot("many");
    const files = Array.from({ length: 12 }, (_, i) => [`expenses/f${i}.txt`, `${i}\n`]);
    const { artifact } = hostile(files, { root });
    const v = runVerify([artifact, "--max-entries", "5"]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/ENTRY_COUNT_EXCEEDED/);
  }, SPAWN);

  test("a member whose header claims more bytes than the limit is refused", () => {
    const root = tempRoot("big-member");
    const raw = buildTar([
      { name: MANIFEST_NAME, content: "" },
      { name: "expenses/lies.bin", content: "only 9 bytes", size: 2_000_000_000 },
    ]);
    const bytes = gzipSync(raw);
    const artifact = path.join(root, "backup_uploads_2026-01-01T00-00-00-UTC.tar.gz");
    writeFileSync(artifact, bytes);
    writeFileSync(`${artifact}.meta`, `artifact=backup_uploads_2026-01-01T00-00-00-UTC.tar.gz\nencrypted=no\narchive_class=uploads\nmanifest_files=0\nsha256_artifact=${sha(bytes)}\n`, "utf8");
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/MEMBER_SIZE_EXCEEDED/);
  }, SPAWN);

  test("a member whose declared size runs past the end of the archive is refused as truncated", () => {
    const root = tempRoot("truncated");
    const raw = buildTar([
      { name: MANIFEST_NAME, content: "" },
      { name: "expenses/cut.bin", content: "short", size: 200_000 },
    ]);
    const bytes = gzipSync(raw);
    const artifact = path.join(root, "backup_uploads_2026-01-01T00-00-00-UTC.tar.gz");
    writeFileSync(artifact, bytes);
    writeFileSync(`${artifact}.meta`, `artifact=backup_uploads_2026-01-01T00-00-00-UTC.tar.gz\nencrypted=no\narchive_class=uploads\nmanifest_files=0\nsha256_artifact=${sha(bytes)}\n`, "utf8");
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/TRUNCATED/);
  }, SPAWN);

  test("a stream that is not gzip at all is refused before anything is read", () => {
    const root = tempRoot("not-gzip");
    const { artifact } = hostile([["expenses/a.pdf", "x\n"]], { root, compress: false });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/NOT_GZIP/);
    expect(v.out).toMatch(/1f8b/);
  }, SPAWN);

  test("a corrupt tar header is refused, not skipped", () => {
    const root = tempRoot("bad-header");
    const good = buildTar([
      { name: MANIFEST_NAME, content: "" },
      { name: "expenses/a.pdf", content: "known\n" },
    ]);
    // Break the checksum of the second header so it can no longer be validated.
    good[BLOCK + 148] = 0x3f;
    const bytes = gzipSync(good);
    const artifact = path.join(root, "backup_uploads_2026-01-01T00-00-00-UTC.tar.gz");
    writeFileSync(artifact, bytes);
    writeFileSync(`${artifact}.meta`, `artifact=backup_uploads_2026-01-01T00-00-00-UTC.tar.gz\nencrypted=no\narchive_class=uploads\nmanifest_files=0\nsha256_artifact=${sha(bytes)}\n`, "utf8");
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/NOT_A_TAR/);
  }, SPAWN);
});
// ────────────────────────────────────────────────────────────────────────────
// TASK 2 — the answers a drill has to give: missing, corrupt, unaccounted, and the
// sidecar disagreeing with the archive about what it holds.
// ────────────────────────────────────────────────────────────────────────────
describe("the restore reports what it actually found", () => {
  test("a manifest that lies about a file's hash is caught as corrupt, not restored", () => {
    const root = tempRoot("lying");
    const body = "original\n";
    const name = "expenses/a.pdf";
    const lie = `${"0".repeat(64)}  ${Buffer.byteLength(body)}  644  ${name}\n`;
    const { artifact } = hostile([[name, body]], { root, manifestText: lie, sidecar: { manifest_sha256: null } });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/corrupt=1/);
    expect(v.out).toMatch(/restore=failed/);
  }, SPAWN);

  test("a manifest row in neither the job's form nor a parseable shape is refused, not dropped", () => {
    // parseManifest counts a malformed row as `bad`; the verifier's job is to refuse the whole
    // archive rather than verify the rows it happens to understand. Mutant #34 dropped this arm
    // and the suite stayed green, because every other manifest test writes well-formed rows.
    const root = tempRoot("form");
    const files = [["expenses/a.pdf", "known\n"]];
    const { artifact } = hostile(files, {
      root,
      manifestText: `${manifestOf(files)}one field only, not a manifest row\n`,
      sidecar: { manifest_sha256: null },
    });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/MANIFEST_FORM/);
    expect(v.out).toMatch(/1 row\(s\) of 2/);
    expect(v.out).not.toMatch(/restore=ok/);
  }, SPAWN);

  test("a file the manifest promises but the archive lacks is reported missing", () => {
    const root = tempRoot("missing");
    const files = [["expenses/present.pdf", "here\n"]];
    const text = manifestOf(files) + manifestOf([["scanned/gone.pdf", "absent\n"]]);
    const { artifact } = hostile(files, { root, manifestText: text });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/missing=1/);
    expect(v.out).toMatch(/MANIFEST promises|MISSING/);
  }, SPAWN);

  test("a file the manifest does not account for is a finding too", () => {
    const root = tempRoot("injected");
    const { artifact } = hostile(
      [["expenses/listed.pdf", "known\n"], ["expenses/injected.php", "<?php system($_GET[0]); ?>\n"]],
      { root, manifestText: manifestOf([["expenses/listed.pdf", "known\n"]]), sidecar: { manifest_files: "1", manifest_bytes: "6", manifest_sha256: null } },
    );
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/unaccounted=1/);
  }, SPAWN);

  test("a sidecar that counts differently from the manifest inside the archive is refused", () => {
    const root = tempRoot("count");
    const { artifact } = hostile([["expenses/a.pdf", "known\n"]], { root, sidecar: { manifest_files: "9" } });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/MANIFEST_COUNT_DISAGREES/);
    expect(v.out).toMatch(/sidecar says 9/);
  }, SPAWN);

  test("a sidecar whose manifest hash is not the manifest in the archive is refused", () => {
    const root = tempRoot("msighash");
    const { artifact } = hostile([["expenses/a.pdf", "known\n"]], { root, sidecar: { manifest_sha256: "f".repeat(64) } });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/MANIFEST_HASH_DISAGREES/);
  }, SPAWN);

  test("a sidecar whose byte total disagrees with the manifest rows is refused", () => {
    const root = tempRoot("bytes");
    const { artifact } = hostile([["expenses/a.pdf", "known\n"]], { root, sidecar: { manifest_bytes: "12345" } });
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/MANIFEST_SIZE_DISAGREES/);
  }, SPAWN);

  test("an artifact with no sidecar is refused, and one with no digest is refused differently", () => {
    const root = tempRoot("nosidecar");
    const a = hostile([["expenses/a.pdf", "known\n"]], { root });
    rmSync(`${a.artifact}.meta`);
    const v = runVerify([a.artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/NO_SIDECAR/);
    const b = hostile([["expenses/a.pdf", "known\n"]], { root, sidecar: { sha256_artifact: null } });
    const v2 = runVerify([b.artifact]);
    expect(v2.code, v2.out).toBe(1);
    expect(v2.out).toMatch(/SIDECAR_NO_HASH/);
  }, SPAWN);

  test("a truncated artifact fails on the digest before anything is extracted", () => {
    const root = tempRoot("trunc-art");
    const { artifact } = hostile([["expenses/a.pdf", "known\n"]], { root });
    const full = readFileSync(artifact);
    writeFileSync(artifact, full.subarray(0, Math.floor(full.length / 2)));
    const v = runVerify([artifact]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/ARTIFACT_HASH_MISMATCH/);
    expect(v.out).toMatch(/Nothing was extracted/);
  }, SPAWN);

  test("an encrypted artifact is refused with no passphrase, and with the wrong one", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { BACKUP_PASSPHRASE: PASS }).code).toBe(0);
    const art = artifactOf(f.dest);
    const none = runVerify([art], { BACKUP_PASSPHRASE: "" });
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/DECRYPT_FAILED/);
    expect(none.out).toMatch(/cannot be decrypted is not a backup/);
    const wrong = runVerify([art], { BACKUP_PASSPHRASE: "not-the-one" });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toMatch(/decryption failed|wrong passphrase/);
    expect(wrong.out).toMatch(/encryption=failed/);
  }, SPAWN);
});

// ────────────────────────────────────────────────────────────────────────────
// TASK 2 — isolation: the drill can only ever write where it says it writes.
// ────────────────────────────────────────────────────────────────────────────
describe("the restore is isolated", () => {
  test("with no --into it creates its own throwaway directory and removes it again", () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("uploads-verify-")).length;
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const v = runVerify([artifactOf(f.dest)]);
    expect(v.code, v.out).toBe(0);
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith("uploads-verify-")).length;
    expect(after, "a drill must not leave a copy of the clinic's documents in the temp directory").toBe(before);
  }, SPAWN);

  test("--into pointing at a directory that already holds something is refused, not merged into", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const into = path.join(f.root, "somewhere");
    mkdirSync(into, { recursive: true });
    writeFileSync(path.join(into, "already-here.txt"), "do not touch\n", "utf8");
    const v = runVerify([artifactOf(f.dest), "--into", into]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/UNSAFE_INTO/);
    expect(v.out).toMatch(/cannot tell a good archive from a bad one/);
    expect(readFileSync(path.join(into, "already-here.txt"), "utf8")).toBe("do not touch\n");
    expect(readdirSync(into)).toEqual(["already-here.txt"]);
  }, SPAWN);

  test("--into pointing at a file is refused", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const asFile = path.join(f.root, "afile");
    writeFileSync(asFile, "x", "utf8");
    const v = runVerify([artifactOf(f.dest), "--into", asFile]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/UNSAFE_INTO/);
  }, SPAWN);

  test("--into pointing at a link is refused, and nothing reaches through it", () => {
    // The isolation this whole verifier promises rests on the restore landing in the directory
    // the operator named. A link planted at that path silently moves the extracted documents
    // somewhere else, and mutant #29 showed the arm had no test: it could be deleted and the
    // suite would still call the restore isolated.
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const target = path.join(f.root, "elsewhere");
    mkdirSync(target, { recursive: true });
    const link = path.join(f.root, "restore-dir");
    // Windows cannot make a real directory symlink unprivileged (EPERM, measured here); a
    // junction is the same reparse point and Node's lstat reports it as a link, which is what
    // the arm under test reads. The premise is asserted, not assumed.
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    expect(lstatSync(link).isSymbolicLink(), `${link} is not a link on this platform`).toBe(true);
    const v = runVerify([artifactOf(f.dest), "--into", link]);
    expect(v.code, v.out).toBe(1);
    expect(v.out).toMatch(/UNSAFE_INTO/);
    expect(v.out).toMatch(/symbolic link/);
    expect(readdirSync(target), "the refused restore wrote through the link").toEqual([]);
  }, SPAWN);

  test("a refused archive still writes nothing into the directory it was given", () => {
    const root = tempRoot("silent-refusal");
    const { artifact } = hostile([["expenses/a.pdf", "known\n"]], { root, extraEntries: [{ name: "../escape.txt", content: "victim\n" }] });
    const into = path.join(root, "into");
    mkdirSync(into, { recursive: true });
    const v = runVerify([artifact, "--into", into]);
    expect(v.code, v.out).toBe(1);
    expect(readdirSync(into)).toEqual([]);
    expect(existsSync(path.join(root, "escape.txt"))).toBe(false);
  }, SPAWN);

  test("a member that collides with a file already in the restore directory is refused, not written through", () => {
    // This is the O_EXCL half of the isolation rule, and it is the portable form of
    // "do not extract through an existing symlink": a pre-existing entry is a conflict to
    // be reported, never a target to be replaced. On a POSIX box the same open also carries
    // O_NOFOLLOW, which is what stops a link left in the directory from redirecting the
    // write; that half cannot be created here without developer-mode symlink rights, so the
    // refusal to touch an existing entry is what this test can prove on every platform.
    const root = tempRoot("collision");
    const tarFile = path.join(root, "a.tar");
    writeFileSync(tarFile, buildTar([{ name: MANIFEST_NAME, content: "" }, { name: "expenses/a.pdf", content: "from the archive\n" }]));
    const into = path.join(root, "into");
    mkdirSync(path.join(into, "expenses"), { recursive: true });
    const victim = path.join(into, "expenses", "a.pdf");
    writeFileSync(victim, "already here\n", "utf8");
    const read = readTar(tarFile);
    const res = extractEntries(read.entries, into, tarFile);
    expect(res.problems.map((p) => p.code)).toContain("EXTRACTION_FAILED");
    expect(readFileSync(victim, "utf8"), "an existing file must never be replaced by a drill").toBe("already here\n");
    const flags = readFileSync(victim, "utf8");
    expect(flags).not.toContain("from the archive");
  });

  test("the live volume is never the restore target: the tool writes only where it is told", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const before = treeHash(f.src);
    runVerify([artifactOf(f.dest)]);
    expect(treeHash(f.src)).toBe(before);
  }, SPAWN);
});

// ────────────────────────────────────────────────────────────────────────────
// No patient identifier reaches anything a human pastes into a ticket.
// ────────────────────────────────────────────────────────────────────────────
describe("patient names never leave the archive", () => {
  const LEAKS = ["RAMESH", "KUMAR", "patient-77", "REF-7", "EXP-41"];

  test("neither the job nor the verifier prints a file name or a path component", () => {
    const f = fixture();
    const a = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]);
    expect(a.code, a.out).toBe(0);
    const v = runVerify([artifactOf(f.dest)]);
    expect(v.code, v.out).toBe(0);
    for (const line of [a.out, v.out]) {
      for (const needle of LEAKS) expect(line, `output must not contain ${needle}`).not.toContain(needle);
    }
    const meta = readFileSync(`${artifactOf(f.dest)}.meta`, "utf8");
    for (const needle of LEAKS) expect(meta, `sidecar must not contain ${needle}`).not.toContain(needle);
  }, SPAWN);

  test("a refusal that names the offending member shape keeps the member's path out of the output", () => {
    // The refusal above is a MISSING finding, and MISSING is counted rather than listed, so it
    // never puts anything into report.problems — the gate that strips `entryName` was a line no
    // test could break, which is why mutant #42 survived: make --json attach the path
    // unconditionally and this suite stayed green. A type rejection does carry the member name,
    // so that is the input that actually reaches the gate.
    const root = tempRoot("leak-type");
    const files = [["expenses/listed.pdf", "known\n"]];
    const { artifact } = hostile(files, {
      root,
      extraEntries: [{ name: "expenses/REF-7_patient-77_link.txt", type: "2", linkname: "/etc/passwd" }],
    });
    const plain = runVerify([artifact]);
    expect(plain.code, plain.out).toBe(1);
    expect(plain.out).toMatch(/SYMLINK_MEMBER/);
    for (const needle of LEAKS) expect(plain.out, `prose must not contain ${needle}`).not.toContain(needle);

    const json = runVerify([artifact, "--json"]);
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.out);
    const refused = parsed.problems.find((p) => p.code === "SYMLINK_MEMBER");
    expect(refused, "--json must still say which shape was refused").toBeTruthy();
    expect(refused.path, "--json must not carry a member path unless --names was passed").toBeUndefined();
    for (const needle of LEAKS) expect(json.out, `--json must not contain ${needle}`).not.toContain(needle);

    const named = runVerify([artifact, "--names"]);
    expect(named.code).toBe(1);
    expect(named.out).toMatch(/REF-7_patient-77_link\.txt/);
    expect(named.out).toMatch(/may identify a patient/);
  }, SPAWN);

  test("a refusal does not leak a path either, in prose or in --json", () => {
    const root = tempRoot("leak-refusal");
    const files = [["scanned/patient-77_referral.jpg", "here\n"]];
    const { artifact } = hostile(files, { root, manifestText: manifestOf(files) + manifestOf([["scanned/RAMESH-KUMAR_missing.pdf", "absent\n"]]) });
    const plain = runVerify([artifact]);
    expect(plain.code).toBe(1);
    for (const needle of LEAKS) {
      expect(plain.out, `refusal output must not contain ${needle}`).not.toContain(needle);
      expect(plain.out).toMatch(/MISSING/);
    }
    const json = runVerify([artifact, "--json"]);
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.out);
    expect(parsed.result.firstBad, "--json must not carry a path unless --names was passed").toBeNull();
    for (const needle of LEAKS) expect(json.out, `--json must not contain ${needle}`).not.toContain(needle);
  }, SPAWN);

  test("--names prints the one offending path and warns about it in the same line", () => {
    const root = tempRoot("names-flag");
    const files = [["scanned/patient-77_referral.jpg", "here\n"]];
    const { artifact } = hostile(files, { root, manifestText: manifestOf(files) + manifestOf([["scanned/REF-7_gone.pdf", "absent\n"]]) });
    const v = runVerify([artifact, "--names"]);
    expect(v.code).toBe(1);
    expect(v.out).toMatch(/may identify a patient/);
    expect(v.out).toMatch(/REF-7_gone\.pdf|patient-77_referral\.jpg/);
  }, SPAWN);

  test("hiding the names from the log does not lose them from the archive", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const into = path.join(f.root, "restore");
    const v = restoreInto(artifactOf(f.dest), into);
    expect(v.code, v.out).toBe(0);
    expect(existsSync(path.join(into, "expenses", "EXP-41_ab12cd34_RAMESH-KUMAR-bill.pdf"))).toBe(true);
    expect(readFileSync(path.join(into, "expenses", "EXP-41_ab12cd34_RAMESH-KUMAR-bill.pdf"), "utf8")).toBe("bill-a\n");
  }, SPAWN);
});
// ────────────────────────────────────────────────────────────────────────────
// The vocabulary, and the small parsers the drill is built out of. A refusal whose code
// is not in REJECTIONS prints as `undefined:` — which is how a gate starts lying quietly.
// ────────────────────────────────────────────────────────────────────────────
describe("the evidence vocabulary", () => {
  test("a good archive answers all four states in one line, and the fourth only because this run earned it", () => {
    const f = fixture();
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const v = runVerify([artifactOf(f.dest)]);
    expect(v.code, v.out).toBe(0);
    expect(v.out).toMatch(/evidence archive=found structure=valid encryption=not_applicable restore=verified/);
    expect(v.out).toMatch(/RESTORE VERIFIED class=uploads verified=3 of 3 missing=0 corrupt=0 unaccounted=0/);
  }, SPAWN);

  test("an encrypted archive is the only case that may say encryption=verified", () => {
    const root = tempRoot("enc-vocab");
    const files = [["expenses/a.pdf", "known\n"]];
    // `encrypted=yes` in the sidecar with no passphrase available must NOT read as verified.
    const { artifact } = hostile(files, { root, sidecar: { encrypted: "yes" } });
    const v = runVerify([artifact], { BACKUP_PASSPHRASE: "" });
    expect(v.code).toBe(1);
    expect(v.out).toMatch(/encryption=failed/);
    expect(v.out).not.toMatch(/encryption=verified/);
  }, SPAWN);

  test("every rejection code this tool can raise has an operator-facing sentence", () => {
    for (const [code, text] of Object.entries(REJECTIONS)) {
      expect(code, `${code} must be SCREAMING_SNAKE so the line reads as a code`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(text.length, `${code} must explain itself`).toBeGreaterThan(20);
      for (const needle of ["RAMESH", "KUMAR", "patient"]) expect(`${code}=${text}`, `a fixed reason must not contain a path`).not.toContain(needle);
    }
  });

  test("a code that is not in the vocabulary is a bug, and this test is where it surfaces", () => {
    const root = tempRoot("unknown-code");
    const { artifact } = hostile([["expenses/a.pdf", "known\n"]], { root, extraEntries: [{ name: "x/../../y.txt", content: "v" }] });
    const out = runVerify([artifact]).out;
    const codes = [...out.matchAll(/REJECTED ([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(REJECTIONS[c], `${c} has no reason text`).toBeTruthy();
    expect(out).not.toMatch(/REJECTED [A-Z0-9_]+: undefined/);
  }, SPAWN);

  test("the usage line is printed for no argument, two arguments, and an unknown option", async () => {
    const lines = [];
    const w = (s) => lines.push(s);
    expect(await main([], { write: w })).toBe(2);
    expect(await main(["a", "b"], { write: w })).toBe(2);
    expect(await main(["--nope", "a"], { write: w })).toBe(2);
    expect(lines.join("\n")).toMatch(/usage: node scripts\/verify-uploads-restore\.mjs/);
    expect(await main(["--help"], { write: w })).toBe(0);
  }, SPAWN);

  test("an artifact that does not exist is a cannot-run, not a restore failure", () => {
    const root = tempRoot("absent");
    const v = runVerify([path.join(root, "no-such-file.tar.gz")]);
    expect(v.code).toBe(2);
    expect(v.out).toMatch(/ARTIFACT_MISSING|not found/);
  }, SPAWN);
});

describe("the parsers the drill is built out of", () => {
  test("pathProblem answers each shape with its own code", () => {
    expect(pathProblem("../up.txt")).toBe("TRAVERSAL");
    expect(pathProblem("a/../../up.txt")).toBe("TRAVERSAL");
    expect(pathProblem("/etc/passwd")).toBe("ABSOLUTE_PATH");
    expect(pathProblem("C:/Windows/a.ini")).toBe("DRIVE_PATH");
    expect(pathProblem("c:\\Windows\\a.ini")).toBe("BACKSLASH_PATH");
    expect(pathProblem("//srv/share/a")).toBe("UNC_PATH");
    expect(pathProblem("a\\b.txt")).toBe("BACKSLASH_PATH");
    expect(pathProblem("a/b\x01c")).toBe("CONTROL_CHARACTER");
    expect(pathProblem("C:/a", "x")).toBe("DRIVE_PATH");
    expect(pathProblem("a:b/c.txt")).toBe("DRIVE_PATH");
    expect(pathProblem("expenses/a.pdf")).toBeNull();
    expect(pathProblem("./expenses/a.pdf")).toBeNull();
    expect(pathProblem("scanned/2026/10/name with spaces (1).pdf")).toBeNull();
  });

  test("normalizeName makes ./a/b and a/./b the same path, so hashing cannot double-count", () => {
    expect(normalizeName("./expenses/a.pdf")).toBe("expenses/a.pdf");
    expect(normalizeName("expenses/./a.pdf")).toBe("expenses/a.pdf");
    expect(normalizeName("expenses//a.pdf")).toBe("expenses/a.pdf");
  });

  test("typeProblem accepts only regular files and directories", () => {
    for (const t of ["0", "\0", "5"]) expect(typeProblem({ type: t }), `type ${t}`).toBeNull();
    expect(typeProblem({ type: "2" })).toBe("SYMLINK_MEMBER");
    expect(typeProblem({ type: "1" })).toBe("HARDLINK_MEMBER");
    expect(typeProblem({ type: "3" })).toBe("DEVICE_MEMBER");
    expect(typeProblem({ type: "4" })).toBe("DEVICE_MEMBER");
    expect(typeProblem({ type: "6" })).toBe("FIFO_MEMBER");
    expect(typeProblem({ type: "7" })).toBe("SOCKET_MEMBER");
    expect(typeProblem({ type: "Z" })).toBe("UNSUPPORTED_MEMBER");
  });

  test("parseManifest reads the four-field row and keeps a path that contains spaces", () => {
    const rows = parseManifest(manifestOf([["scanned/name with  double   space.pdf", "x\n"]]));
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("scanned/name with  double   space.pdf");
    expect(rows[0].mode).toBe("644");
    expect(parseManifest("nonsense line\n")[0].bad).toBe(true);
    expect(parseManifest("ZZ  1  644  a.txt\n")[0].bad).toBe(true);
  });

  test("decodeHeader validates its own checksum, which is how a torn archive is noticed", () => {
    const good = buildTar([{ name: "a.txt", content: "x" }]).subarray(0, BLOCK);
    expect(decodeHeader(good).name).toBe("a.txt");
    const torn = Buffer.from(good);
    torn[10] = 0x5a;
    expect(decodeHeader(torn)).toBeNull();
    expect(decodeHeader(Buffer.alloc(BLOCK))).toBeNull();
  });

  test("readTar counts members and rejects a header that lies about its size", () => {
    const root = tempRoot("readtar");
    const raw = buildTar([
      { name: MANIFEST_NAME, content: "" },
      { name: "a.txt", content: "short" },
    ]);
    const file = path.join(root, "t.tar");
    writeFileSync(file, raw);
    const r = readTar(file);
    expect(r.entries.map((e) => e.name)).toEqual([MANIFEST_NAME, "a.txt"]);
    const lying = buildTar([{ name: MANIFEST_NAME, content: "" }, { name: "a.txt", content: "short", size: 500_000 }]);
    const file2 = path.join(root, "lie.tar");
    writeFileSync(file2, lying);
    expect(readTar(file2).problems.map((p) => p.code)).toContain("TRUNCATED");
    expect(readTar(file2, { maxMemberBytes: 1024 }).problems.map((p) => p.code)).toContain("MEMBER_SIZE_EXCEEDED");
  });

  test("auditEntries is quiet about the archive the job actually wrote", () => {
    const f = fixture("uploads", [["site/notes.txt", "n\n"]]);
    expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    const work = path.join(f.root, "unzip");
    mkdirSync(work, { recursive: true });
    const tarFile = path.join(work, "a.tar");
    copyFileSync(artifactOf(f.dest), path.join(work, "a.tar.gz"));
    writeFileSync(tarFile, execFileSync("gzip", ["-dc", POSIX(path.join(work, "a.tar.gz"))], { encoding: "buffer", maxBuffer: 1 << 24 }));
    const read = readTar(tarFile);
    expect(auditEntries(read.entries).problems).toEqual([]);
    expect(read.problems).toEqual([]);
    const into = path.join(f.root, "extract");
    mkdirSync(into, { recursive: true });
    expect(extractEntries(read.entries, into, tarFile).problems).toEqual([]);
    expect(existsSync(path.join(into, MANIFEST_NAME))).toBe(true);
  }, SPAWN);
});

// ────────────────────────────────────────────────────────────────────────────
// This PR sits beside the database job the clinic depends on. It must not disturb it.
// ────────────────────────────────────────────────────────────────────────────
describe("the two new scripts do not disturb the database job they sit beside", () => {
  test("an armed retention pass retires its own generations and nothing that merely lives beside them", () => {
    // What "does not disturb the database job" has to mean in a test CI can actually run.
    // The guard this replaces diffed the branch against `origin/main` to prove the five
    // protected scripts were not edited. That is a review-scope claim, not a code property,
    // and it could not run anywhere but a developer clone: actions/checkout leaves a
    // detached single-commit tree with no `main` ref, so `git diff --name-only
    // origin/main...HEAD` threw `unknown revision` and was the only red in 14,125 tests on
    // run 38805317907. Once this merges, the same line compares main with itself — a pass
    // that cannot fail. The database job's dumps and this job's archives share one directory
    // on the clinic box, and retention is the only destructive path in this script, so the
    // destructive path is what gets measured.
    const f = fixture("uploads", []);
    const neighbours = [
      // the database job's own artifact family, both plaintext and encrypted
      "caredeoghar_20261015_023000.sql.gz",
      "caredeoghar_20261015_023000.sql.gz.enc",
      "caredeoghar_20261015_023000.sql.gz.enc.meta",
      // the unversioned nightly job the clinic also writes to the same directory
      "backup_DB_2026-10-15T08-31-32-149Z.sql.enc",
      "backup_DB_2026-10-15T08-31-32-149Z.sql.enc.meta",
      // the hardest case: an artifact of *this* tool's own shape, same extension and
      // directory, from the other class. Only the label separates it from what this run
      // is allowed to retire, and it is aged on purpose so the age filter cannot save it.
      "backup_object_storage_2026-01-01T00-00-00-UTC.tar.gz",
      "backup_object_storage_2026-01-01T00-00-00-UTC.tar.gz.meta",
    ];
    for (const n of neighbours) writeFileSync(path.join(f.dest, n), `neighbour ${n}\n`);
    const bytesOf = Object.fromEntries(neighbours.map((n) => [n, readFileSync(path.join(f.dest, n))]));

    for (let i = 0; i < 2; i += 1) {
      expect(runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest]).code).toBe(0);
    }
    const mine = readdirSync(f.dest).filter((n) => /^backup_uploads_.*\.tar\.gz/.test(n));
    expect(mine.length, "two generations plus their sidecars").toBe(4);
    const aged = new Date(Date.now() - 40 * 86400000);
    for (const n of [...mine, "backup_object_storage_2026-01-01T00-00-00-UTC.tar.gz",
                     "backup_object_storage_2026-01-01T00-00-00-UTC.tar.gz.meta"]) {
      utimesSync(path.join(f.dest, n), aged, aged);
    }

    const run = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest], { KEEP_DAYS: "30", DELETE_OLD: "1" });
    expect(run.code, run.out).toBe(0);
    // both directions: the retirement really happened, and it really stopped at the label
    for (const n of mine.filter((x) => !x.includes("+"))) {
      expect(existsSync(path.join(f.dest, n)), `retention left ${n} behind`).toBe(false);
    }
    expect(run.out).toMatch(/retention: removing backup_uploads_/);
    expect(run.out).not.toMatch(/removing (backup_object_storage|backup_DB|caredeoghar)/);
    for (const n of neighbours) {
      expect(existsSync(path.join(f.dest, n)), `retention deleted the database job's ${n}`).toBe(true);
      expect(readFileSync(path.join(f.dest, n)), `${n} was rewritten`).toEqual(bytesOf[n]);
    }
  }, SPAWN);

  test("a label cannot widen the delete scope past the volume this job owns", () => {
    // `--label` is interpolated straight into the retention globs, so a glob character in it
    // turns a tidy-up of one volume into a delete over every archive in the directory.
    // A bare "*" is deliberately not in this list: on a Windows checkout the MSYS runtime
    // expands argv globs before the script starts, so the script receives a pile of repository
    // paths and answers with a usage error (exit 2) instead of this guard's answer. `upl*ads`
    // and `uploads?` do not match any real file, pass through untouched, and reach the same
    // character-class arm a bare star would — measured on this box, not assumed.
    for (const bad of ["upl*ads", "uploads?", "[a-z]oader", ".hidden", "a b", "a\tb", "$HOME", "../uploads"]) {
      const f = fixture("uploads", []);
      const r = runSh(["--class", "uploads", "--src", f.src, "--dest", f.dest, "--label", bad]);
      expect(r.code, `--label ${JSON.stringify(bad)} was accepted`).toBe(1);
      expect(r.out).toMatch(/LABEL must be a plain file-name fragment/);
      expect(published(f.dest).length, `--label ${JSON.stringify(bad)} published before refusing`).toBe(0);
    }
    const ok = fixture("uploads", []);
    expect(runSh(["--class", "uploads", "--src", ok.src, "--dest", ok.dest, "--label", "uploads-v1"]).code).toBe(0);
    expect(published(ok.dest)[0]).toMatch(/^backup_uploads-v1_/);
  }, SPAWN);

  test("an archive artifact shape is git-ignored, so a drill cannot commit patient documents", () => {
    for (const probe of [
      "backup_uploads_2026-10-16T03-00-00-UTC.tar.gz",
      "backup_uploads_2026-10-16T03-00-00-UTC.tar.gz.enc",
      "backup_object_storage_2026-10-16T03-00-00-UTC.tar.gz.enc.meta",
      ".backup_uploads_2026-10-16T03-00-00-UTC.tar.gz.partial",
    ]) {
      const r = spawnSync("git", ["check-ignore", "-q", probe], { cwd: REPO, encoding: "utf8" });
      expect(r.status, `${probe} must be ignored by git`).toBe(0);
    }
  });

  test("the runbook and the coverage document both name the new tool, so an operator can find it", () => {
    const runbook = readFileSync(path.join(REPO, "docs", "CARE_ERP_DEPLOYMENT_RUNBOOK.md"), "utf8");
    const coverage = readFileSync(path.join(REPO, "docs", "CARE_ERP_BACKUP_COVERAGE.md"), "utf8");
    expect(runbook).toContain("synology-uploads-archive.sh");
    expect(runbook).toContain("verify-uploads-restore.mjs");
    expect(coverage).toContain("synology-uploads-archive.sh");
    expect(coverage).toMatch(/ARCHIVE FOUND|archive found/);
    // The owner's two standing decisions must not be re-raised as gaps by this document.
    expect(coverage).toMatch(/owner[- ]decision|owner accepted|not a gap/i);
  });
});

