// tarFixture.mjs — a deterministic ustar writer, used ONLY by tests.
// ============================================================================
// WHY A TEST WRITES ITS OWN TAR
//   `verify-uploads-restore.mjs` has to refuse an artifact the backup job could never
//   have written: traversal paths, absolute and drive-qualified names, symlink and
//   hard-link members, device files, FIFOs, duplicate entries whose types conflict, and
//   a member whose header lies about its size. The obvious way to build those is
//   `tar --transform` or a staging tree — and on this platform bsdtar refuses to STORE
//   `../victim.txt` at all, so a test that relies on it silently does nothing while still
//   reporting green. A hand-built byte stream is the same hostile input on Linux, Windows
//   and CI, and it lets a test state something the real tar would never let you create
//   (a 10 MB member whose data is 40 bytes) instead of approximating it.
//
// This file is a test fixture, not a tool. It is not wired into the backup job, and it
// writes nothing to disk by itself — it returns bytes.
import { createHash } from "node:crypto";

export const BLOCK = 512;

/** Types that carry a data section in the stream, so the writer must pad them. */
const WITH_DATA = new Set(["0", "\0", "L", "K", "x", "g", "A", "V"]);

export const hashOf = (body) =>
  createHash("sha256").update(Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8")).digest("hex");

const octal = (value, len) => `${(value >>> 0).toString(8).padStart(len - 1, "0").slice(-(len - 1))}\0`;

const fixed = (s, len) => {
  const buf = Buffer.alloc(len);
  buf.write(String(s).slice(0, len), "latin1");
  return buf;
};

/** One 512-byte ustar header, fields at their documented offsets. */
export function header({ name, mode = 0o644, size = 0, mtime = 1700000000, type = "0", linkname = "" }) {
  const b = Buffer.alloc(BLOCK);
  fixed(name, 100).copy(b, 0);
  fixed(octal(mode, 8), 8).copy(b, 100);
  fixed(octal(0, 8), 8).copy(b, 108); // uid
  fixed(octal(0, 8), 8).copy(b, 116); // gid
  fixed(octal(size, 12), 12).copy(b, 124);
  fixed(octal(mtime, 12), 12).copy(b, 136);
  fixed("        ", 8).copy(b, 148); // checksum placeholder: spaces, as the algorithm requires
  b.write(String(type)[0] ?? "0", 156, "latin1");
  fixed(linkname, 100).copy(b, 157);
  b.write("ustar\0", 257, "latin1");
  b.write("00", 263, "latin1");
  fixed("root", 32).copy(b, 265);
  fixed("root", 32).copy(b, 297);
  fixed(octal(0, 8), 8).copy(b, 329);
  fixed(octal(0, 8), 8).copy(b, 337);
  let sum = 0;
  for (const byte of b) sum += byte;
  fixed(octal(sum, 8), 8).copy(b, 148);
  return b;
}

/**
 * Build a tar from `{ name, type, content, linkname, mode, size }` entries.
 * `size` overrides the header while the bytes written come from `content`, which is how a
 * test states that a member is 10 MB when it is really 40 bytes.
 */
export function tar(entries) {
  const out = [];
  for (const e of entries) {
    const type = e.type ?? "0";
    const body = Buffer.isBuffer(e.content) ? e.content : Buffer.from(String(e.content ?? ""), "utf8");
    out.push(header({
      name: e.name,
      type,
      mode: e.mode ?? 0o644,
      size: e.size ?? (WITH_DATA.has(type) ? body.length : 0),
      mtime: e.mtime ?? 1700000000,
      linkname: e.linkname ?? "",
    }));
    if (!WITH_DATA.has(type)) continue;
    out.push(body);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    if (pad) out.push(Buffer.alloc(pad));
  }
  out.push(Buffer.alloc(BLOCK * 2)); // end-of-archive: two zero blocks
  return Buffer.concat(out);
}

/** A manifest in the exact shape the backup job writes: sha  bytes  mode  path. */
export function manifestOf(files, over = {}) {
  return files
    .map(([name, body, mode = "644"], i) => {
      const o = over[name] ?? {};
      return `${o.sha ?? hashOf(body)}  ${o.bytes ?? Buffer.byteLength(body)}  ${mode}  ${name}`;
    })
    .join("\n") + "\n";
}
