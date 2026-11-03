/**
 * knowledgeCorpus.test.ts — the section index over the clinic's OWN radiologist
 * documents, with nothing new stored and nothing new served.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS
 * `ai-knowledge/care-radiologist/` is the text a radiologist wrote for Open WebUI. It has never
 * been read by a line of CARE code, so its structure was only ever known by eye. Retrieval needs
 * an address per section (`mri-brain-v1.md#58`) and a version per file, because a reference
 * quoted into a report prompt must be traceable to the exact document state it came from — that
 * is what §9 of the brief asks for, and it is also the only way a later "why did the AI say this"
 * can be answered.
 *
 * Counts and id ranges are pinned from measurement (62 / 38 / 30 sections, each contiguous 1..N).
 * Byte totals are deliberately NOT pinned: editing a clinical document must not break a build —
 * the version hash is where an edit is allowed to show up.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  loadKnowledgeCorpus,
  knowledgeSectionId,
  __resetKnowledgeCorpusCacheForTests,
} from "./knowledgeCorpus";

const BRAIN = "mri-brain-v1.md";
const SPINE = "mri-ls-spine-v1.2.md";
const MASTER = "master-system-prompt-v4.md";

beforeEach(() => __resetKnowledgeCorpusCacheForTests());
afterEach(() => __resetKnowledgeCorpusCacheForTests());

describe("the corpus CARE already ships but never read", () => {
  it("indexes every authored document at section level", () => {
    const c = loadKnowledgeCorpus();
    expect(c.available).toBe(true);
    expect(c.dir).toBeTruthy();
    const byFile = Object.fromEntries(c.files.map((f) => [f.file, f.count]));
    // Measured 2026-11-03: every numbered heading in these files is fenced by `=====` banners,
    // so the section count is exact and the ids are contiguous — no gaps, no duplicates.
    expect(byFile[BRAIN]).toBe(62);
    expect(byFile[SPINE]).toBe(38);
    expect(byFile[MASTER]).toBe(30);
    for (const f of c.files) {
      expect(f.ids).toEqual(Array.from({ length: f.count }, (_, i) => i + 1));
    }
  });

  it("gives a section a stable, quotable address", () => {
    const c = loadKnowledgeCorpus();
    const s58 = c.byId.get(knowledgeSectionId(BRAIN, 58));
    expect(s58).toBeTruthy();
    expect(s58!.title).toContain("DIAGNOSTIC SYNTHESIS");
    expect(s58!.address).toBe(`${BRAIN}#58`);
    // The section carries its own heading and stops before the next one, so what is quoted is
    // one rule and not the tail of the document.
    expect(s58!.text).toContain("58. DIAGNOSTIC SYNTHESIS");
    expect(s58!.text).not.toContain("59. ");
    expect(s58!.chars).toBe(s58!.text.length);
  });

  it("versions each file by its own SHA256 and agrees with the clinic's SHA256SUMS", () => {
    const c = loadKnowledgeCorpus();
    expect(c.mismatches).toEqual([]);
    for (const f of c.files) {
      const raw = fs.readFileSync(path.join(c.dir!, f.file));
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      expect(f.version).toBe(sha);
      expect(f.manifestVersion).toBe(sha);
      expect(sha).toHaveLength(64);
    }
  });

  it("reads a section's text byte-for-byte from the document, not a re-serialisation", () => {
    // A prompt that quotes clinical authority must show the sentence the radiologist wrote, so
    // the index may normalise line endings for parsing but must hand back document text.
    const raw = fs.readFileSync(path.join(loadKnowledgeCorpus().dir!, BRAIN), "utf8").replace(/\r\n/g, "\n");
    const c = loadKnowledgeCorpus();
    for (const id of [1, 4, 58]) {
      const s = c.byId.get(knowledgeSectionId(BRAIN, id))!;
      const fromDoc = raw.slice(raw.indexOf(s.headerLine), raw.indexOf(s.headerLine) + s.text.length);
      expect(fromDoc).toBe(s.text);
    }
  });

  it("is deterministic — the same documents index to the same addresses and versions", () => {
    const a = loadKnowledgeCorpus();
    const b = loadKnowledgeCorpus();
    expect(a.sections.map((s) => s.address)).toEqual(b.sections.map((s) => s.address));
    expect(a.files.map((f) => `${f.file}@${f.version.slice(0, 12)}`).join()).toBe(
      b.files.map((f) => `${f.file}@${f.version.slice(0, 12)}`).join(),
    );
  });
});

describe("fail-safe — a corpus that is not there changes nothing", () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "care-kb-probe-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("refuses to claim knowledge when the directory is absent", () => {
    const c = loadKnowledgeCorpus({ dir: path.join(tmp, "nope") });
    expect(c.available).toBe(false);
    expect(c.sections).toEqual([]);
    expect(c.byId.size).toBe(0);
    // The reason names the path, because "RAG did nothing" must be diagnosable from the log.
    expect(c.reason).toContain("nope");
  });

  it("keeps the sections it can read and names the file it could not", () => {
    fs.writeFileSync(
      path.join(tmp, BRAIN),
      ["=====", "1. FIRST RULE", "=====", "body one", "=====", "2. SECOND RULE", "=====", "body two", ""].join("\n"),
    );
    const c = loadKnowledgeCorpus({ dir: tmp });
    expect(c.available).toBe(true);
    expect(c.sections).toHaveLength(2);
    expect(c.missing.map((m) => m.file)).toEqual([SPINE, MASTER]);
    expect(c.byId.get(knowledgeSectionId(BRAIN, 2))!.title).toBe("SECOND RULE");
  });

  it("indexes a heading only when the document's own banner fences it", () => {
    // Prose that merely contains a numbered line is not a section: the clinic's documents fence
    // every real heading with `=====`, and a loose rule would index "5. something" typed inside a
    // paragraph as if it were clinical authority.
    fs.writeFileSync(
      path.join(tmp, BRAIN),
      [
        "=====", "1. REAL SECTION", "=====", "text",
        "5. a numbered line inside prose, lower case, no fence",
        "=====", "2. ANOTHER REAL SECTION", "=====", "more", "",
      ].join("\n"),
    );
    const c = loadKnowledgeCorpus({ dir: tmp });
    expect(c.byId.has(knowledgeSectionId(BRAIN, 5))).toBe(false);
    expect(c.byId.get(knowledgeSectionId(BRAIN, 1))!.title).toBe("REAL SECTION");
    expect(c.byId.get(knowledgeSectionId(BRAIN, 2))!.title).toBe("ANOTHER REAL SECTION");
  });

  it("reports a document that no longer matches the clinic's manifest instead of hiding it", () => {
    // SHA256SUMS is the clinic's own stamp. If a document is edited without re-stamping, every
    // quoted reference would be attributed to a version that does not exist.
    const dir = loadKnowledgeCorpus().dir!;
    fs.writeFileSync(path.join(tmp, BRAIN), fs.readFileSync(path.join(dir, BRAIN)));
    fs.writeFileSync(path.join(tmp, MASTER), fs.readFileSync(path.join(dir, MASTER)));
    fs.writeFileSync(
      path.join(tmp, "SHA256SUMS"),
      `0000000000000000000000000000000000000000000000000000000000000000  ${MASTER}\n`,
    );
    const c = loadKnowledgeCorpus({ dir: tmp });
    expect(c.mismatches).toHaveLength(1);
    expect(c.mismatches[0].file).toBe(MASTER);
    expect(c.mismatches[0].manifestVersion).toBe("0".repeat(64));
    // The section text still comes from the file the clinic has, and the mismatch is what is
    // reported — retrieval is allowed to continue, silently wrong attribution is not.
    expect(c.byId.size).toBeGreaterThan(0);
  });
});
