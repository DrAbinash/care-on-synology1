/**
 * knowledgePackaging.test.ts — the corpus has to be *in* the image, at the path the loader reads.
 *
 * WHY A CONTRACT TEST AND NOT A DOCKER RUN
 * Retrieval that works on a development machine and finds nothing in the container is the failure
 * mode this file exists for: the api stage is a slim image whose `/app` holds only the lines it
 * COPYes, and this repo's history has already been bitten once by a file that existed in the
 * checkout and not in the image (`nginx.conf` is baked, not mounted). So the two facts that make
 * packaged retrieval work are pinned here as source: the Dockerfile puts the directory at
 * `/app/ai-knowledge/care-radiologist`, and the loader's resolution finds a corpus at exactly that
 * relative position.
 *
 * WHAT IS NOT CLAIMED
 * No image was built or run to write these tests — this development box has no `docker`
 * executable, so the container is verified by its filesystem contract (test 3 moves the process's
 * working directory to a packaged layout and runs the real loader) and by the commands in
 * `docs/CARE_RAG_KNOWLEDGE_PACKAGING.md`, which are run on the NAS, where the image exists.
 * "Built and verified inside the container" is not something this suite is allowed to assert.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KNOWLEDGE_FILES, loadKnowledgeCorpus, __resetKnowledgeCorpusCacheForTests } from "./knowledgeCorpus";
import { retrieveReferenceKnowledge } from "./knowledgeRetrieval";
import type { ComposerInputSnapshot } from "./types";

const REPO = path.resolve(process.cwd());
const SUBDIR = path.join("ai-knowledge", "care-radiologist");

const originalCwd = process.cwd();
const made: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  __resetKnowledgeCorpusCacheForTests();
  while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

function packDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "care-api-image-"));
  made.push(root);
  fs.mkdirSync(path.join(root, SUBDIR), { recursive: true });
  for (const f of [...KNOWLEDGE_FILES, "SHA256SUMS"]) {
    fs.copyFileSync(path.join(REPO, SUBDIR, f), path.join(root, SUBDIR, f));
  }
  return root;
}

describe("the api image carries the documents the index requires", () => {
  const dockerfile = fs.readFileSync(path.join(REPO, "Dockerfile"), "utf8");

  /**
   * The `api` RUNTIME stage, line-sliced.
   *
   * Done by stage rather than by searching the whole file because the fact under test is which
   * layer the corpus lands in: a COPY in `api-build` would satisfy "the string is in the Dockerfile"
   * and still leave `/app` without the documents. Slicing on `\r?\n` because this checkout stores
   * the Dockerfile CRLF while CI checks it out LF — a needle containing a raw `\n` matches one and
   * not the other.
   */
  function stage(name: string): string[] {
    const lines = dockerfile.split(/\r?\n/);
    const from = lines.findIndex((l) => new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`).test(l));
    expect(from, `stage ${name} not found`).toBeGreaterThan(-1);
    let to = lines.length;
    for (let i = from + 1; i < lines.length; i++) if (/^FROM\s/.test(lines[i])) { to = i; break; }
    return lines.slice(from, to);
  }

  const apiStage = stage("api");

  it("copies the corpus directory into /app, where WORKDIR puts it", () => {
    expect(apiStage).toContain("WORKDIR /app");
    const copy = apiStage.find((l) =>
      /^COPY\b.*\/repo\/ai-knowledge\/care-radiologist\s+\.\/ai-knowledge\/care-radiologist/.test(l));
    expect(copy).toBeTruthy();
    expect(copy).toContain("--from=api-build");
  });

  it("the copy is before the image's own EXPOSE, so it is part of the runtime layer", () => {
    const copyAt = apiStage.findIndex((l) => l.includes("./ai-knowledge/care-radiologist"));
    const exposeAt = apiStage.findIndex((l) => l.startsWith("EXPOSE 8080"));
    expect(copyAt).toBeGreaterThan(-1);
    expect(exposeAt).toBeGreaterThan(-1);
    expect(copyAt).toBeLessThan(exposeAt);
  });

  it("no other stage ships the corpus — only the api runtime layer needs it", () => {
    // Guards the stage slicer itself: if the pin above were really "anywhere in the file", the web
    // and migrate stages would contain the same COPY. `web-build` compiles the SPA and never reads
    // radiology documents.
    for (const other of ["web-build", "web", "migrate"]) {
      const body = stage(other).join("\n");
      expect(body.includes("ai-knowledge/care-radiologist"), other).toBe(false);
    }
  });

  it("every required document exists in the build context and is not ignored", () => {
    const ignored = fs.readFileSync(path.join(REPO, ".dockerignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    // The matcher is pinned before it is trusted: `**/*.zip` must really exclude the zip
    // archives, or the check below would pass on a broken translation and the exclusions would
    // be invisible. That is exactly the vacuous-checker failure this repo has been bitten by.
    //
    // One pattern per line is translated to a regex over the *whole* relative path, and — matching
    // Docker — a pattern that names a directory excludes everything under it, so each ancestor
    // prefix of the path is tested as well. `**/node_modules` is the control that proves this
    // second rule: it has no trailing wildcard yet must hit a file nested inside a module folder.
    const toRe = (p: string) =>
      new RegExp(
        `^${p
          .replace(/[.+]/g, (c) => `\\${c}`)
          .replace(/\//g, "\\/")
          .replace(/\*\*/g, "\u0000")
          .replace(/\*/g, "[^/]*")
          .replace(/\u0000/g, ".*")}$`,
      );
    const matches = (p: string, rel: string) => {
      const re = toRe(p);
      const segs = rel.split("/");
      for (let i = 1; i <= segs.length; i++) if (re.test(segs.slice(0, i).join("/"))) return true;
      return false;
    };
    expect(matches("**/*.zip", "ai-knowledge/care-radiologist/originals/CARE MRI BRAIN V1 (1).zip")).toBe(true);
    expect(matches("**/node_modules", "artifacts/api-server/src/node_modules/x")).toBe(true);
    expect(matches("**/*.zip", "ai-knowledge/care-radiologist/mri-brain-v1.md")).toBe(false);

    for (const f of [...KNOWLEDGE_FILES, "SHA256SUMS"]) {
      const rel = `${SUBDIR}/${f}`.split(path.sep).join("/");
      expect(fs.existsSync(path.join(REPO, rel)), rel).toBe(true);
      const hit = ignored.filter((p) => !p.startsWith("!")).find((p) => matches(p, rel));
      expect(hit, `${rel} excluded by .dockerignore`).toBeUndefined();
    }
  });

});

describe("a packaged layout resolves through the real loader", () => {
  it("finds the corpus at the position the Dockerfile puts it", () => {
    const root = packDir();
    process.chdir(root);
    __resetKnowledgeCorpusCacheForTests();
    const c = loadKnowledgeCorpus();
    expect(c.available).toBe(true);
    expect(c.dir).toBe(path.join(root, SUBDIR));
    expect(c.missing).toEqual([]);
    expect(c.mismatches).toEqual([]);
    // Same bytes in the image as in the checkout — which is what makes the SHA256 in a
    // provenance record mean the same thing on the NAS and here.
    const repo = (() => { process.chdir(originalCwd); __resetKnowledgeCorpusCacheForTests(); return loadKnowledgeCorpus(); })();
    process.chdir(root);
    __resetKnowledgeCorpusCacheForTests();
    expect(c.files.map((f) => `${f.file}@${f.version.slice(0, 12)}`)).toEqual(
      repo.files.map((f) => `${f.file}@${f.version.slice(0, 12)}`),
    );
    expect(c.sections).toHaveLength(130); // 62 + 38 + 30, measured
  });

  it("an image built without the directory composes exactly as before", () => {
    // Pointed at the empty directory explicitly, not merely run from an empty cwd: the loader's
    // candidate chain ends with a module-relative lookup, and in a checkout that lands on the real
    // documents no matter where the process was started. That fallback is a development
    // convenience; inside the api image the bundle sits in /app/dist and resolves above `/`, so the
    // container's answer comes from cwd. Naming the dir is what isolates the no-corpus state.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "care-api-no-kb-"));
    made.push(empty);
    __resetKnowledgeCorpusCacheForTests();
    const c = loadKnowledgeCorpus({ dir: empty });
    expect(c.available).toBe(false);
    expect(c.dir).toBe(empty);
    expect(c.files).toEqual([]);
    expect(c.missing.map((m) => m.file)).toEqual([...KNOWLEDGE_FILES]);
    // A deliberate minimal snapshot: only the fields retrieval reads. `as unknown as` because this
    // is a fixture, not a claim that the contract is this small.
    const s = {
      worklistId: 1,
      modality: "MR",
      region: "Brain",
      family: "brain",
      findings: "Restricted diffusion on DWI with corresponding low ADC signal.",
      impression: "",
      observations: [],
    } as unknown as ComposerInputSnapshot;
    const r = retrieveReferenceKnowledge(s, { maxChars: 6000, corpus: c });
    expect(r.block).toBe("");
    expect(r.passages).toEqual([]);
  });
});
