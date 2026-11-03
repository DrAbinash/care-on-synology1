/**
 * knowledgeCorpus.ts — a section-level index over the clinic's OWN radiologist documents.
 *
 * WHY THIS EXISTS
 * `ai-knowledge/care-radiologist/` holds the reporting rules Dr Abinash wrote for the local
 * model: `mri-brain-v1.md` (62 numbered sections), `mri-ls-spine-v1.2.md` (38) and
 * `master-system-prompt-v4.md` (30). Until now no line of CARE code read them, so a reference to
 * "the pack says…" could not be resolved, quoted, or versioned. Retrieval needs an address per
 * section (`mri-brain-v1.md#58`) and a version per file, because a rule quoted into a prompt must
 * be traceable to the exact document state it was quoted from — that is what makes "why did the
 * AI write this" answerable months later instead of folklore.
 *
 * WHAT THIS IS NOT
 * No database, no embeddings, no service, no new reporting engine. The index is built from files
 * at read time, in memory, once, and it is READ-ONLY: nothing here decides what a report says.
 * A retrieved section is reference knowledge about wording and interpretation; it is never a
 * patient finding, and it is never handed to the grounding corpora in `validateOutput.ts` — a
 * section that justified itself into the clinical-truth corpus would let documentation invent
 * findings. That boundary is enforced by its own test.
 *
 * FAIL-SAFE BY CONSTRUCTION
 * A missing directory, a missing document, an unreadable file or a document that no longer matches
 * the clinic's `SHA256SUMS` never throws and never silently halves the corpus: each is reported by
 * name in `missing` / `mismatches` / `reason`, and `available: false` means retrieval does nothing
 * at all — the same behaviour the clinic runs today.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** The documents CARE indexes, in report-authority order. A new document is a deliberate edit. */
export const KNOWLEDGE_FILES = [
  "mri-brain-v1.md",
  "mri-ls-spine-v1.2.md",
  "master-system-prompt-v4.md",
] as const;

/** The clinic's own integrity stamp, beside the documents it covers. */
export const KNOWLEDGE_MANIFEST = "SHA256SUMS";

const SUBDIR = path.join("ai-knowledge", "care-radiologist");

export type KnowledgeSection = {
  /** `mri-brain-v1.md#58` — the address a prompt and a provenance record both use. */
  address: string;
  file: string;
  id: number;
  title: string;
  headerLine: string;
  /** The document's own text, from the heading line to the line before the next section. */
  text: string;
  chars: number;
  /** SHA256 of the whole file this section was cut from. */
  version: string;
};

export type KnowledgeFileIndex = {
  file: string;
  count: number;
  ids: number[];
  /** Computed from the bytes on disk. */
  version: string;
  /** Read from `SHA256SUMS`, or null when the manifest does not list this file. */
  manifestVersion: string | null;
  bytes: number;
};

export type KnowledgeCorpus = {
  dir: string | null;
  available: boolean;
  /** Human/radiologist-readable: what was loaded, or exactly why nothing was. */
  reason: string;
  sections: KnowledgeSection[];
  byId: Map<string, KnowledgeSection>;
  files: KnowledgeFileIndex[];
  missing: { file: string; reason: string }[];
  mismatches: { file: string; version: string; manifestVersion: string }[];
};

export function knowledgeSectionId(file: string, id: number): string {
  return `${file}#${id}`;
}

/**
 * A numbered heading, fenced by the document's own `=====` banners on BOTH sides.
 *
 * Measured across all three documents: every real section heading satisfies this and nothing else
 * does — 62 / 38 / 30 headings, ids contiguous from 1. Prose that happens to start a line with
 * "5. something" is not a section, and must not be addressable as if it were clinical authority.
 */
const HEADER_RE = /^(\d+)\.\s+([A-Z0-9][A-Z0-9 ,/&().\u2014'`\-]*[A-Z0-9.\u2014'`])$/;
const FENCE_RE = /^={5,}$/;

function candidateDirs(explicit?: string): { dir: string; source: string }[] {
  const out: { dir: string; source: string }[] = [];
  if (explicit) out.push({ dir: explicit, source: "argument" });
  const env = process.env.CARE_KNOWLEDGE_DIR;
  if (env) out.push({ dir: env, source: "CARE_KNOWLEDGE_DIR" });
  // The api image runs with WORKDIR /app and the corpus is COPYed beside dist/, so cwd is the
  // container's truth. Repo checkouts put it two levels above this package instead.
  out.push({ dir: path.join(process.cwd(), SUBDIR), source: "cwd" });
  out.push({ dir: path.resolve(process.cwd(), "..", "..", SUBDIR), source: "cwd-parents" });
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // src/lib/reportComposer → repo root is five levels up. In the esbuild bundle this lands in
    // `dist/`, finds nothing, and the cwd candidates above have already answered.
    out.push({ dir: path.resolve(here, "..", "..", "..", "..", "..", SUBDIR), source: "module" });
  } catch {
    /* not resolvable from this runtime; the cwd candidates are the ones that matter */
  }
  return out;
}

function readManifest(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(dir, KNOWLEDGE_MANIFEST), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      // `64-hex  path  N bytes` — the clinic's stamp adds the size, so split on the double space
      // and keep the path as the second field.
      const parts = line.split(/\s{2}/);
      if (parts.length < 2) continue;
      if (!/^[0-9a-f]{64}$/.test(parts[0])) continue;
      out.set(path.basename(parts[1].trim()), parts[0]);
    }
  } catch {
    /* no manifest: every file still gets its own computed version, just with nothing to compare */
  }
  return out;
}

/** Cut one document into its numbered sections, keeping the document's own text. */
function parseSections(file: string, content: string, version: string): KnowledgeSection[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const heads: { id: number; title: string; i: number }[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    if (!FENCE_RE.test(lines[i - 1]) || !FENCE_RE.test(lines[i + 1])) continue;
    const m = HEADER_RE.exec(lines[i]);
    if (!m) continue;
    heads.push({ id: Number(m[1]), title: m[2].trim(), i });
  }
  return heads.map((h, k) => {
    // Up to the fence line that opens the NEXT heading, so the text is exactly this section.
    const end = k + 1 < heads.length ? heads[k + 1].i - 1 : lines.length;
    const text = lines.slice(h.i, Math.max(h.i + 1, end)).join("\n");
    return {
      address: knowledgeSectionId(file, h.id),
      file,
      id: h.id,
      title: h.title,
      headerLine: lines[h.i],
      text,
      chars: text.length,
      version,
    };
  });
}

const cacheByKey = new Map<string, KnowledgeCorpus>();

export function loadKnowledgeCorpus(opts: { dir?: string } = {}): KnowledgeCorpus {
  const key = opts.dir ?? "__resolve__";
  const hit = cacheByKey.get(key);
  if (hit) return hit;

  const dirs = candidateDirs(opts.dir);
  const dir = opts.dir
    ? (fs.existsSync(opts.dir) ? opts.dir : null)
    : (dirs.find((d) => {
        try {
          return fs.statSync(d.dir).isDirectory();
        } catch {
          return false;
        }
      })?.dir ?? null);

  const corpus: KnowledgeCorpus = {
    dir,
    available: false,
    reason: "",
    sections: [],
    byId: new Map(),
    files: [],
    missing: [],
    mismatches: [],
  };

  if (!dir) {
    corpus.reason =
      `No radiology knowledge documents found (looked in: ${dirs.map((d) => `${d.dir} [${d.source}]`).join(", ")}). `
      + "Reference knowledge is OFF for this run; the report is composed from the radiologist's own input.";
    cacheByKey.set(key, corpus);
    return corpus;
  }

  const manifest = readManifest(dir);
  const loaded: string[] = [];
  for (const file of KNOWLEDGE_FILES) {
    const full = path.join(dir, file);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(full);
    } catch (err) {
      corpus.missing.push({ file, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const version = crypto.createHash("sha256").update(bytes).digest("hex");
    const manifestVersion = manifest.get(file) ?? null;
    if (manifestVersion && manifestVersion !== version) {
      corpus.mismatches.push({ file, version, manifestVersion });
    }
    const sections = parseSections(file, bytes.toString("utf8"), version);
    if (sections.length === 0) {
      corpus.missing.push({ file, reason: "read, but no fenced numbered section found" });
      continue;
    }
    loaded.push(file);
    corpus.files.push({
      file,
      count: sections.length,
      ids: sections.map((s) => s.id),
      version,
      manifestVersion,
      bytes: bytes.length,
    });
    for (const s of sections) corpus.sections.push(s);
  }

  for (const s of corpus.sections) corpus.byId.set(s.address, s);

  corpus.available = corpus.files.length > 0;
  const parts = [
    `${corpus.files.length}/${KNOWLEDGE_FILES.length} documents`,
    `${corpus.sections.length} sections from ${loaded.join(", ") || "(none)"}`,
  ];
  if (corpus.missing.length) parts.push(`unreadable: ${corpus.missing.map((m) => m.file).join(", ")}`);
  if (corpus.mismatches.length) {
    parts.push(`does not match ${KNOWLEDGE_MANIFEST}: ${corpus.mismatches.map((m) => m.file).join(", ")}`);
  }
  corpus.reason = corpus.available
    ? `Reference knowledge loaded from ${dir} — ${parts.join("; ")}.`
    : `No reference knowledge available (${parts.join("; ")}). Composing from the radiologist's own input.`;

  cacheByKey.set(key, corpus);
  return corpus;
}

/** Test seam only: the index is a process-lifetime cache, and tests change the filesystem. */
export function __resetKnowledgeCorpusCacheForTests(): void {
  cacheByKey.clear();
}
