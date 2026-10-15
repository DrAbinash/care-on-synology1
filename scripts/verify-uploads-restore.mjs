#!/usr/bin/env node
/**
 * verify-uploads-restore.mjs — prove a document archive restores, into a directory it
 * made itself and deletes on the way out.
 * ============================================================================
 *
 * WHY THIS EXISTS
 *   `backup_verification` on the live clinic database has zero rows, and until
 *   `synology-uploads-archive.sh` nothing at all archived the uploads volume. An artifact
 *   that exists is not an artifact that restores, and "it restores" is not one claim but
 *   four, which this tool keeps apart because the clinic's old tooling reported the first
 *   as if it were the fourth:
 *
 *     ARCHIVE FOUND          the bytes are on disk and match the digest in their sidecar
 *     STRUCTURALLY VALID     it is a gzip tarball whose members a restore can represent
 *     ENCRYPTION VERIFIED    THIS run decrypted it — never inferred from `encrypted=yes`
 *     RESTORE VERIFIED       every extracted byte was re-hashed against the manifest
 *                            carried inside the archive itself
 *
 *   A state says `verified` only when this process produced the evidence for it in this
 *   run, and `not_applicable` when the artifact's shape makes the question void. A digest
 *   recorded in a sidecar is never promoted to verified by reading the sidecar.
 *
 * WHY IT REFUSES ENTRY TYPES RATHER THAN SANITIZING THEM
 *   A patient-document volume holds regular files and directories. Every other tar member
 *   is either a lie or an escape: a symlink member makes the restore create a path the
 *   operator did not ask for and, followed at write time, write OUTSIDE the restore
 *   directory; a hard-link member can point the restore at any inode on the box; a device
 *   node or FIFO needs privileges to create and can make the next `tar` or `find` block
 *   forever. There is no safe way to keep any of them, and silently dropping one is the
 *   other half of the same bug — the archive would then restore to something other than
 *   what was backed up, with nobody told. So an archive containing one is refused whole,
 *   by count and by reason, before a single byte is written.
 *
 * NO PATIENT NAME LEAVES THIS TOOL
 *   File names on this volume are the identifying part (`EXP-41_…_RAMESH-KUMAR-bill.pdf`),
 *   and this output is pasted into tickets and handovers. Every line is a count, a class,
 *   or a hash prefix. `--names` prints the ONE offending relative path for a technician
 *   standing at the box, and says out loud that it may identify a patient.
 *
 * WHAT A REAL RESTORE IS
 *   This tool is a drill, not the restore. When the clinic actually has to put documents
 *   back, the operator publishes the archive with `tar -xpf` into the volume as documented
 *   in docs/CARE_ERP_BACKUP_COVERAGE.md — this verifier deliberately does not apply
 *   modes or ownerships, because writing into a throwaway directory and then declaring the
 *   live volume ready would be a claim it has no evidence for.
 *
 * USAGE
 *   node scripts/verify-uploads-restore.mjs <artifact>
 *   BACKUP_PASSPHRASE=… node scripts/verify-uploads-restore.mjs <artifact>.enc
 *   node scripts/verify-uploads-restore.mjs <artifact> --into /tmp/drill --names --json
 *   node scripts/verify-uploads-restore.mjs <artifact> --max-bytes 100000 --max-entries 50
 *
 * EXIT CODE
 *   0 RESTORE VERIFIED · 1 refused or failed (integrity, structure, content) ·
 *   2 cannot run (usage, missing artifact, missing tool)
 */
import { spawnSync } from "node:child_process";
import { constants, createReadStream, createWriteStream, closeSync, copyFileSync, existsSync,
  lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync,
  statSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { parseSidecar } from "./ops-preflight.mjs";

export const BLOCK = 512;
export const MANIFEST_NAME = "MANIFEST.sha256";

/** Every way this tool can say no, in the words an operator reads. Pinned by tests. */
export const REJECTIONS = {
  ARTIFACT_MISSING: "the artifact you named is not a file",
  NO_SIDECAR: "an artifact with no sidecar has no claimed checksum, so nothing can be verified and nothing can be trusted",
  SIDECAR_NO_HASH: "the sidecar carries no sha256_artifact, so there is nothing to check the bytes against",
  ARTIFACT_HASH_MISMATCH: "the bytes are not the bytes the job wrote: truncated, edited, or the wrong file. Nothing was extracted.",
  DECRYPT_FAILED: "the ciphertext did not decrypt",
  NOT_GZIP: "the stream is not a gzip member, so it is not an archive this tool wrote",
  NOT_A_TAR: "the archive is not a readable tar stream",
  BAD_HEADER: "a tar header is corrupt or its checksum does not match its contents",
  TRUNCATED: "the archive ends in the middle of a member",
  COMPRESSED_SIZE_EXCEEDED: "the archive inflates to more bytes than the limit it was given (decompression bomb guard)",
  ENTRY_COUNT_EXCEEDED: "the archive has more members than the limit it was given",
  MEMBER_SIZE_EXCEEDED: "a member claims more bytes than the limit it was given",
  ABSOLUTE_PATH: "a member path is absolute",
  DRIVE_PATH: "a member path is Windows drive-qualified or contains a colon",
  UNC_PATH: "a member path is a UNC share",
  TRAVERSAL: "a member path walks out of the restore directory with ..",
  BACKSLASH_PATH: "a member path uses a backslash separator, which means a different thing on the box that restores it",
  CONTROL_CHARACTER: "a member path contains a control character",
  SYMLINK_MEMBER: "the archive contains a symbolic-link member; a document restore creates regular files and directories only",
  HARDLINK_MEMBER: "the archive contains a hard-link member, which can point the restore at any file on the box",
  DEVICE_MEMBER: "the archive contains a character or block device member",
  FIFO_MEMBER: "the archive contains a FIFO member, which blocks any reader that opens it",
  SOCKET_MEMBER: "the archive contains a contiguous-file or socket member",
  UNSUPPORTED_MEMBER: "the archive contains an entry type this restore does not represent",
  DUPLICATE_ENTRY: "the archive stores the same path twice, so which bytes win depends on read order",
  CONFLICTING_TYPE: "the same path appears as two different entry types",
  NO_MANIFEST: "the archive carries no MANIFEST.sha256, so its contents cannot be verified",
  MULTIPLE_MANIFESTS: "more than one MANIFEST.sha256 is present, so which one is authoritative is undefined",
  MANIFEST_FORM: "a manifest row is not in the four-field form the backup job writes",
  MANIFEST_COUNT_DISAGREES: "the sidecar's file count and the manifest inside the archive disagree: one of them is lying",
  MANIFEST_HASH_DISAGREES: "the manifest inside the archive is not the manifest the sidecar hashed",
  MANIFEST_SIZE_DISAGREES: "the sidecar's byte total and the manifest rows disagree",
  UNSAFE_INTO: "the restore directory already holds something, or is a link",
  EXTRACTION_FAILED: "a member could not be written into the isolated restore directory",
  MISSING: "the manifest promises a file the archive does not contain",
  CORRUPT: "a restored file does not match the hash and size its manifest row states",
  UNACCOUNTED: "the restored tree contains a file the manifest does not account for",
};

/** typeflag → what it is called, so a refusal can name the entry kind without its path. */
export const TYPE_NAMES = {
  0: "regular file", "\0": "regular file", 5: "directory", 1: "hard link", 2: "symbolic link",
  3: "character device", 4: "block device", 6: "FIFO", 7: "contiguous file",
  D: "GNU directory", K: "GNU long link name", L: "GNU long path name", V: "volume label",
  A: "access control list", g: "pax global header", x: "pax extended header",
};

export const short = (s) => String(s ?? "").slice(0, 12);

const sha256OfFile = (file) => {
  const h = createHash("sha256");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(file, "r");
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
};

const padded = (n) => (BLOCK - (n % BLOCK)) % BLOCK;

/** ustar octal field, including the base-256 extension a hostile archive can use. */
function numeric(block, off, len) {
  if (block[off] & 0x80) {
    let value = 0n;
    const negative = (block[off] & 0x40) !== 0;
    for (let i = off; i < off + len; i += 1) value = (value << 8n) | BigInt(block[i]);
    if (negative) value -= 2n ** BigInt(len * 8);
    return value < 0n ? null : Number(value);
  }
  const text = block.subarray(off, off + len).toString("latin1").replace(/\0[\s\0]*$/s, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

const cstring = (block, off, len) => block.subarray(off, off + len).toString("utf8").replace(/\0.*$/s, "");

/** Decode one header block. Returns null when it is not a header (bad checksum/fields). */
export function decodeHeader(block) {
  if (block.length !== BLOCK || block.every((b) => b === 0)) return null;
  const claimed = numeric(block, 148, 8);
  if (claimed === null) return null;
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  if (sum !== claimed) return null;
  const size = numeric(block, 124, 12);
  if (size === null || size < 0) return null;
  const magic = block.subarray(257, 263).toString("latin1");
  const name = cstring(block, 0, 100);
  const prefix = magic.startsWith("ustar") ? cstring(block, 345, 155) : "";
  const typeFlag = String.fromCharCode(block[156] === 0 ? 0x30 : block[156]);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    mode: numeric(block, 100, 8) ?? 0,
    size,
    mtime: numeric(block, 136, 12) ?? 0,
    type: typeFlag,
    typeName: TYPE_NAMES[typeFlag] ?? `type ${typeFlag}`,
    linkname: cstring(block, 157, 100),
  };
}

/**
 * A member path is refused before it is ever joined to anything. Each rule answers one
 * question, and the order only decides which reason a person reads first.
 */
export function pathProblem(name) {
  if (typeof name !== "string" || name.length === 0) return "CONTROL_CHARACTER";
  if (name.startsWith("//")) return "UNC_PATH";
  if (name.includes("\\")) return "BACKSLASH_PATH";
  if (/^[a-zA-Z]:([/\\]|$)/.test(name)) return "DRIVE_PATH";
  if (name.startsWith("/")) return "ABSOLUTE_PATH";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return "CONTROL_CHARACTER";
  const segments = name.split("/");
  if (segments.some((s) => s === "..")) return "TRAVERSAL";
  if (segments.some((s) => s.includes(":"))) return "DRIVE_PATH";
  return null;
}

/** `./a/b` and `a/./b` describe one tree path; hashing and comparison use the short form. */
export const normalizeName = (name) => name.split("/").filter((s) => s !== "" && s !== ".").join("/");

/** Refuse by entry type before the path is looked at. Only files and directories pass. */
export function typeProblem(entry) {
  switch (entry.type) {
    case "0": case "\0": case "": return null;
    case "5": return null;
    case "2": return "SYMLINK_MEMBER";
    case "1": return "HARDLINK_MEMBER";
    case "3": case "4": return "DEVICE_MEMBER";
    case "6": return "FIFO_MEMBER";
    case "7": return "SOCKET_MEMBER";
    default: return "UNSUPPORTED_MEMBER";
  }
}

/**
 * Walk a tar stream and return its members plus every structural finding. Writes nothing:
 * an archive that turns out to be hostile has to be discoverable without extracting it.
 */
export function readTar(file, { maxEntries = 200_000, maxMemberBytes = 1 << 30 } = {}) {
  const entries = [];
  const problems = [];
  const total = statSync(file).size;
  let longName = null;
  let longLink = null;
  let at = 0;
  const fd = openSync(file, "r");
  const block = Buffer.alloc(BLOCK);
  const readBlock = (offset) => {
    const b = Buffer.alloc(BLOCK);
    const got = readSync(fd, b, 0, BLOCK, offset);
    return got === BLOCK ? b : null;
  };
  try {
    for (;;) {
      const head = readBlock(at);
      if (!head) break; // clean end of file
      at += BLOCK;
      if (head.every((b) => b === 0)) break; // end-of-archive marker
      const h = decodeHeader(head);
      if (!h) { problems.push({ code: "NOT_A_TAR", detail: `a header at byte ${(at - BLOCK).toString()} is not a valid tar header` }); break; }
      const dataAt = at;
      // A member that claims more bytes than the limit is refused at its header, before the
      // reader asks "is there room for it" — otherwise a 2 GB lie reads as a truncated file,
      // which sends an operator to check the copy instead of the archive.
      if (h.type !== "5" && h.size > maxMemberBytes) {
        problems.push({ code: "MEMBER_SIZE_EXCEEDED", detail: `a member declares ${h.size} bytes (limit ${maxMemberBytes})` });
        break;
      }
      const consumed = h.size + padded(h.size);
      if (dataAt + Math.min(h.size, consumed) > total + BLOCK) {
        problems.push({ code: "TRUNCATED", detail: `${h.typeName} ${h.name === MANIFEST_NAME ? "manifest" : "member"} declares ${h.size} bytes with ${total - dataAt} left in the file` });
        break;
      }
      at += consumed;
      if (h.type === "L" || h.type === "K" || h.type === "x" || h.type === "g") {
        // Metadata pseudo-entries carry the real name of the entry that follows. They are
        // not members: no path, no type and no extraction decision comes from them.
        if (h.type !== "g" && h.type !== "x") longName = h.type === "L" ? readData(fd, dataAt, h.size) : longName;
        if (h.type === "K") { longLink = readData(fd, dataAt, h.size); }
        if (h.type === "x") {
          const m = /\d+ path=([^\n]+)\n/.exec(readData(fd, dataAt, h.size));
          if (m) longName = m[1];
        }
        continue;
      }
      if (longName) { h.name = longName; longName = null; }
      if (longLink) { h.linkname = longLink; longLink = null; }
      h.dataAt = dataAt;
      entries.push(h);
      if (entries.length > maxEntries) { problems.push({ code: "ENTRY_COUNT_EXCEEDED", detail: `more than ${maxEntries} members` }); break; }
    }
  } finally {
    closeSync(fd);
  }
  if (entries.length === 0 && !problems.length) problems.push({ code: "NOT_A_TAR", detail: "no members at all" });
  return { entries, problems };
}

function readData(fd, at, size) {
  const buf = Buffer.alloc(Math.min(size, 1 << 20));
  const got = readSync(fd, buf, 0, buf.length, at);
  return buf.subarray(0, got).toString("utf8").replace(/\0.*$/s, "");
}

/**
 * The security pass: everything that must be true before a byte is written. It runs over
 * the whole member list first, because an archive that only turns hostile at its 400th
 * entry would otherwise have 399 entries extracted before anything was noticed.
 */
export function auditEntries(entries) {
  const problems = [];
  const seen = new Map();
  let manifests = 0;
  for (const e of entries) {
    // A problem never carries the member's name in `detail`: on this volume the name is
    // the patient-identifying part, and these strings are what gets pasted into a ticket.
    // The name travels in `entryName`, which `verify` strips unless --names was asked for.
    const tp = typeProblem(e);
    if (tp) { problems.push({ code: tp, detail: e.typeName, entryName: e.name }); continue; }
    const pp = pathProblem(e.name);
    if (pp) { problems.push({ code: pp, detail: "a member path", entryName: e.name }); continue; }
    const name = normalizeName(e.name);
    if (!name) continue; // a "./" root entry says nothing
    if (name === MANIFEST_NAME) manifests += 1;
    const previous = seen.get(name);
    if (previous) {
      problems.push({
        code: previous.type === e.type ? "DUPLICATE_ENTRY" : "CONFLICTING_TYPE",
        detail: name === MANIFEST_NAME ? "the manifest appears twice" : "the same path appears twice",
        entryName: e.name,
      });
      continue;
    }
    seen.set(name, e);
  }
  if (manifests === 0) problems.push({ code: "NO_MANIFEST" });
  if (manifests > 1) problems.push({ code: "MULTIPLE_MANIFESTS" });
  return { problems, byName: seen };
}

/** Write the audited members into a directory that was proved safe. Files and dirs only. */
export function extractEntries(entries, into, file) {
  const written = [];
  const problems = [];
  const src = openSync(file, "r");
  const buf = Buffer.alloc(1 << 20);
  try {
    for (const e of entries) {
      if (typeProblem(e)) continue;
      const name = normalizeName(e.name);
      if (!name) continue;
      const target = path.join(into, ...name.split("/"));
      if (e.type === "5") {
        try { mkdirSync(target, { recursive: true }); }
        catch { problems.push({ code: "EXTRACTION_FAILED", detail: "a directory member could not be created" }); continue; }
        written.push({ name, dir: true });
        continue;
      }
      try { mkdirSync(path.dirname(target), { recursive: true }); } catch { /* the file open below reports it */ }
      // O_NOFOLLOW: a link someone left in the restore directory must not turn this write
      // into a write somewhere else. O_EXCL (`wx`): an entry that is already there is a
      // conflict to be reported, not a target to be overwritten — a restore that silently
      // replaces files cannot tell a good archive from a bad one.
      let fd;
      try {
        fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      } catch {
        problems.push({ code: "EXTRACTION_FAILED", detail: name === MANIFEST_NAME ? "the manifest could not be written" : "a member could not be written into the isolated directory" });
        continue;
      }
      let left = e.size;
      let at = e.dataAt;
      try {
        while (left > 0) {
          const n = readSync(src, buf, 0, Math.min(buf.length, left), at);
          if (n <= 0) { problems.push({ code: "TRUNCATED", detail: "a member ends before its declared size" }); break; }
          writeSync(fd, buf, 0, n);
          at += n;
          left -= n;
        }
      } finally {
        closeSync(fd);
      }
      written.push({ name, dir: false });
    }
  } finally {
    closeSync(src);
  }
  return { written, problems };
}

/** Walk the restored tree. Names stay relative; the caller decides what may be printed. */
export function listTree(into) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { out.push({ name: rel, dir: true }); walk(full, rel); }
      else out.push({ name: rel, dir: false, size: statSync(full).size });
    }
  };
  walk(into, "");
  return out;
}

/** The manifest is `<sha256>  <bytes>  <mode>  <path>`; the field separator is two spaces. */
export function parseManifest(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const parts = raw.split("  ");
    if (parts.length < 4) { rows.push({ bad: true, raw }); continue; }
    const [sha, bytes, mode, ...rest] = parts;
    if (!/^[0-9a-f]{64}$/.test(sha) || !/^\d+$/.test(bytes)) { rows.push({ bad: true, raw }); continue; }
    rows.push({ sha, bytes: Number(bytes), mode, name: normalizeName(rest.join("  ")) });
  }
  return rows;
}

/** Re-hash everything the manifest claims, then account for everything it does not. */
export function verifyContents(into, rows) {
  const out = { verified: 0, missing: 0, corrupt: 0, unaccounted: 0, firstBad: null, dirsMissing: 0 };
  const expected = new Set();
  for (const row of rows) {
    if (row.bad) { out.corrupt += 1; out.firstBad ??= MANIFEST_NAME; continue; }
    expected.add(row.name);
    const full = path.join(into, ...row.name.split("/"));
    let st = null;
    try { st = lstatSync(full); } catch { st = null; }
    if (!st || !st.isFile()) { out.missing += 1; out.firstBad ??= row.name; continue; }
    if (st.size !== row.bytes || sha256OfFile(full) !== row.sha) { out.corrupt += 1; out.firstBad ??= row.name; }
    else out.verified += 1;
  }
  for (const f of listTree(into)) {
    if (f.dir || f.name === MANIFEST_NAME || expected.has(f.name)) continue;
    out.unaccounted += 1;
    out.firstBad ??= f.name;
  }
  return out;
}

/** Decrypt with the approved envelope, through openssl's environment, never its argv. */
export function decryptArtifact(artifact, out, passphrase, spawn = spawnSync) {
  if (!passphrase) return { ok: false, code: "DECRYPT_FAILED", detail: "the sidecar says encrypted=yes and no BACKUP_PASSPHRASE is set — an archive that cannot be decrypted is not a backup, and cannot be verified" };
  if (!existsSync("/dev/null") && process.platform === "win32") {
    const which = spawn("openssl", ["version"], { encoding: "utf8" });
    if (which.error) return { ok: false, code: "DECRYPT_FAILED", detail: "openssl is not on PATH" };
  }
  const r = spawn("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", "env:BACKUP_PASSPHRASE", "-in", artifact, "-out", out], {
    env: { ...process.env, BACKUP_PASSPHRASE: passphrase },
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.error || r.status !== 0) return { ok: false, code: "DECRYPT_FAILED", detail: "decryption failed: wrong passphrase, or the ciphertext is corrupt. Nothing was extracted." };
  return { ok: true };
}

/** Stream-inflate with a hard ceiling: a bomb has to be stopped WHILE it inflates. */
export async function inflateTo(src, dest, maxBytes) {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) { cb(new Error("OVER_LIMIT")); return; }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(src), createGunzip(), counter, createWriteStream(dest));
  } catch (err) {
    if (String(err?.message).includes("OVER_LIMIT")) return { ok: false, code: "COMPRESSED_SIZE_EXCEEDED", bytes };
    return { ok: false, code: "NOT_GZIP", bytes };
  }
  return { ok: true, bytes };
}

const headBytes = (file, n) => {
  const buf = Buffer.alloc(n);
  const fd = openSync(file, "r");
  try { return buf.slice(0, readSync(fd, buf, 0, n, 0)); } finally { closeSync(fd); }
};

/** A problem leaves this tool with a path in it only when the operator asked for paths. */
const sanitizeProblem = (p, opts) => {
  const out = { code: p.code, detail: p.detail ?? REJECTIONS[p.code] };
  if (opts?.names && p.entryName) out.path = p.entryName;
  return out;
};

/**
 * Run the whole drill for one artifact and return the four states, the counts and the
 * reasons. `deps` exists so a test can substitute the passphrase source and the spawner;
 * nothing here is ever consulted for a verdict it did not itself produce.
 */
export async function verify(artifact, opts = {}) {
  const deps = { spawn: spawnSync, tmp: tmpdir, read: readFileSync, ...opts.deps };
  const env = opts.env ?? process.env;
  const report = {
    artifact: path.basename(artifact),
    class: null,
    evidence: { archive: "unknown", structure: "unknown", encryption: "not_applicable", restore: "unknown" },
    problems: [],
    counts: { entries: 0, files: 0, dirs: 0, uncompressedBytes: 0 },
    result: { verified: 0, of: 0, missing: 0, corrupt: 0, unaccounted: 0, firstBad: null },
    exit: 1,
  };
  const stop = (code, detail, exit = 1) => {
    report.problems.push({ code, detail: detail ?? REJECTIONS[code] });
    report.exit = exit;
    return report;
  };

  if (!existsSync(artifact) || !statSync(artifact).isFile()) return stop("ARTIFACT_MISSING", null, 2);
  const metaFile = `${artifact}.meta`;
  if (!existsSync(metaFile)) return stop("NO_SIDECAR");
  const sidecar = parseSidecar(deps.read(metaFile, "utf8"));
  report.class = String(sidecar.archive_class ?? "").trim() || "(no archive_class in the sidecar)";
  const claimed = String(sidecar.sha256_artifact ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(claimed)) return stop("SIDECAR_NO_HASH");
  report.evidence.archive = "found";
  const actual = sha256OfFile(artifact);
  if (actual !== claimed) return stop("ARTIFACT_HASH_MISMATCH", `the sidecar claims ${short(claimed)}, these bytes hash to ${short(actual)} — it is truncated, edited, or not the file the job wrote. Nothing was extracted.`);

  const encrypted = String(sidecar.encrypted ?? "").trim() === "yes";
  const work = mkdtempSync(path.join(deps.tmp(), "uploads-verify-"));
  const into = opts.into ? path.resolve(opts.into) : path.join(work, "restore");
  try {
    if (opts.into) {
      if (existsSync(opts.into)) {
        const st = lstatSync(opts.into);
        if (st.isSymbolicLink()) return stop("UNSAFE_INTO", "the restore directory is a symbolic link");
        if (!st.isDirectory()) return stop("UNSAFE_INTO", "the restore directory is not a directory");
        if (readdirSync(opts.into).length > 0) return stop("UNSAFE_INTO", "the restore directory is not empty — a restore over files that are already there cannot tell a good archive from a bad one");
      }
    }
    mkdirSync(into, { recursive: true });

    const gz = path.join(work, "archive.tar.gz");
    if (encrypted) {
      const d = decryptArtifact(artifact, gz, env.BACKUP_PASSPHRASE ?? "", deps.spawn);
      if (!d.ok) { report.evidence.encryption = "failed"; return stop(d.code, d.detail); }
      report.evidence.encryption = "verified";
    } else {
      copyFileSync(artifact, gz);
      report.evidence.encryption = "not_applicable";
    }
    const head = headBytes(gz, 2);
    if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) return stop("NOT_GZIP", `the stream starts with ${head.toString("hex") || "nothing"}, not the gzip magic 1f8b`);

    const tarFile = path.join(work, "archive.tar");
    const maxBytes = Number(opts.maxBytes ?? env.UPLOADS_MAX_UNCOMPRESSED ?? 4 * 1024 * 1024 * 1024);
    const inflated = await inflateTo(gz, tarFile, maxBytes);
    if (!inflated.ok) return stop(inflated.code, `${inflated.bytes} bytes inflated against a limit of ${maxBytes}`);
    report.counts.uncompressedBytes = inflated.bytes;

    const read = readTar(tarFile, {
      maxEntries: Number(opts.maxEntries ?? env.UPLOADS_MAX_ENTRIES ?? 200_000),
      maxMemberBytes: Number(opts.maxMemberBytes ?? 1 << 30),
    });
    report.counts.entries = read.entries.length;
    const audit = auditEntries(read.entries);
    const structural = [...read.problems, ...audit.problems];
    if (structural.length) {
      report.evidence.structure = "invalid";
      report.problems.push(...structural.map((p) => sanitizeProblem(p, opts)));
      return report;
    }
    report.evidence.structure = "valid";

    const extracted = extractEntries(read.entries, into, tarFile);
    if (extracted.problems.length) {
      report.problems.push(...extracted.problems.map((p) => sanitizeProblem(p, opts)));
      return report;
    }
    report.counts.files = extracted.written.filter((w) => !w.dir).length;
    report.counts.dirs = extracted.written.filter((w) => w.dir).length;

    const manifestPath = path.join(into, MANIFEST_NAME);
    if (!existsSync(manifestPath)) return stop("NO_MANIFEST", "the manifest is not at the archive root, where a restore has to find it");
    const raw = deps.read(manifestPath, "utf8");
    const rows = parseManifest(raw);
    const bad = rows.filter((r) => r.bad);
    if (bad.length) return stop("MANIFEST_FORM", `${bad.length} row(s) of ${rows.length}`);

    const sidecarFiles = String(sidecar.manifest_files ?? "").trim();
    if (sidecarFiles && sidecarFiles !== String(rows.length)) return stop("MANIFEST_COUNT_DISAGREES", `the sidecar says ${sidecarFiles}, the manifest inside the archive lists ${rows.length}`);
    const sidecarManifest = String(sidecar.manifest_sha256 ?? "").trim();
    if (sidecarManifest && sidecarManifest !== sha256OfFile(manifestPath)) return stop("MANIFEST_HASH_DISAGREES", `the sidecar says ${short(sidecarManifest)}, the manifest hashes to ${short(sha256OfFile(manifestPath))}`);
    const sidecarBytes = String(sidecar.manifest_bytes ?? "").trim();
    const rowBytes = rows.reduce((a, r) => a + r.bytes, 0);
    if (sidecarBytes && sidecarBytes !== String(rowBytes)) return stop("MANIFEST_SIZE_DISAGREES", `the sidecar says ${sidecarBytes}, the manifest rows add up to ${rowBytes}`);

    const v = verifyContents(into, rows);
    report.result = {
      verified: v.verified,
      of: rows.length,
      missing: v.missing,
      corrupt: v.corrupt,
      unaccounted: v.unaccounted,
      // A path is only ever carried out when the operator asked for it, in either shape.
      firstBad: opts.names ? v.firstBad : null,
    };
    const clean = v.missing === 0 && v.corrupt === 0 && v.unaccounted === 0 && v.verified === rows.length;
    report.evidence.restore = clean ? "verified" : "failed";
    if (!clean) return stop(v.missing ? "MISSING" : v.corrupt ? "CORRUPT" : "UNACCOUNTED");
    report.exit = 0;
    return report;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const summaryLine = (r) =>
  `RESTORE ${r.evidence.restore === "verified" ? "VERIFIED" : "FAILED"} class=${r.class ?? "-"} verified=${r.result.verified} of ${r.result.of} missing=${r.result.missing} corrupt=${r.result.corrupt} unaccounted=${r.result.unaccounted}`;

export const evidenceLine = (r) =>
  `evidence archive=${r.evidence.archive} structure=${r.evidence.structure} encryption=${r.evidence.encryption} restore=${r.evidence.restore}`;

const USAGE = "usage: node scripts/verify-uploads-restore.mjs <artifact> [--into DIR] [--names] [--json] [--max-bytes N] [--max-entries N]";

export async function main(argv = process.argv.slice(2), out = { write: (s) => process.stdout.write(s) }) {
  const say = (s) => out.write(`${s}\n`);
  const opts = { names: false, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--names") opts.names = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--into") opts.into = argv[++i];
    else if (a === "--max-bytes") opts.maxBytes = argv[++i];
    else if (a === "--max-entries") opts.maxEntries = argv[++i];
    else if (a === "--help" || a === "-h") { say(USAGE); return 0; }
    else if (String(a).startsWith("-")) { say(`ERROR: unknown option ${a}\n${USAGE}`); return 2; }
    else rest.push(a);
  }
  if (rest.length !== 1) { say(`ERROR: exactly one artifact is required\n${USAGE}`); return 2; }

  const report = await verify(rest[0], opts);
  if (opts.json) {
    say(JSON.stringify({
      ...report,
      problems: report.problems.map((p) => ({
        code: p.code,
        reason: p.detail ?? REJECTIONS[p.code],
        ...(p.path ? { path: p.path } : {}),
      })),
    }, null, 2));
  } else {
    say(`artifact=${report.artifact} class=${report.class ?? "-"}`);
    say(evidenceLine(report));
    say(summaryLine(report));
    for (const p of report.problems) {
      // The reason printed is the one THIS run measured — "the sidecar says 9, the manifest
      // lists 1" is actionable, the fixed sentence for the code is not. Only `--names` can
      // add a path, and it is added in a separate field so nothing else can carry one.
      const reason = p.detail ?? REJECTIONS[p.code];
      if (p.path) {
        say(`REJECTED ${p.code}: ${reason} — offending path (may identify a patient; never paste this line into a ticket): ${p.path}`);
      } else {
        say(`REJECTED ${p.code}: ${reason}`);
      }
    }
    if (report.result.firstBad) say(`first offending path (may identify a patient; never paste this line into a ticket): ${report.result.firstBad}`);
    if (report.problems.length && !opts.names) say("pass --names to print the first offending path; nothing was ever written to a live volume by this tool");
  }
  return report.exit;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main().then((code) => process.exit(code));
