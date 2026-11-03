# RAG knowledge packaging — what ships in the API image and how to prove it

Scope: the Composer's reference-knowledge corpus (`ai-knowledge/care-radiologist/`) as it is built
into the deployed `care-api` image, and how to verify that from the NAS once a deploy has happened.
Retrieval behaviour is documented in the headers of `knowledgeRetrieval.ts` and
`knowledgeCorpus.ts`; this file answers only "is the knowledge actually in the image, and is the
process reading that copy?".

## What was executed here, and what was not

**No Docker image was built or run on this machine.** `docker` is not installed on the Windows dev
box (`which docker` → `command not found`, checked 2026-11-03), and NAS SSH resets the connection
pre-auth from here, so there is no way to run a container or to `docker exec` into the clinic's one
from this session. Everything below under "Verify inside the running container" is a command for the
operator to run — none of it has been executed by me, and it must not be read as verified.

What **was** executed here is a bundle-and-layout proof, because the part that could fail in a
container is not Docker — it is *where a bundled ESM process looks for a data directory*. The api
server is compiled by esbuild into a single `/app/dist/index.mjs`
(`artifacts/api-server/build.mjs:20-30`), so no source file sits next to the code at runtime and a
repo-relative path silently resolves to nothing. The proof reproduces exactly that shape:

- harness: `tmp/rag-image/driver.ts`, bundled with the same esbuild options as the api server
  (`bundle: true`, `format: "esm"`, `platform: "node"`, `target: "node22"`);
- two directory layouts staged under `tmp/rag-image/`: `app/` = `dist/index.mjs` beside
  `ai-knowledge/care-radiologist/` (what the Dockerfile now produces), and `app-without-corpus/` =
  `dist/` and nothing else (what the image was before the `COPY` line existed);
- one scenario per process, because the corpus index is a process-lifetime cache — which is the
  container's behaviour, not a test convenience;
- log: `tmp/rag-image/packaged-layout-proof.log`, run 2026-11-03T09:41Z.

Measured in that log, from the packaged layout with the corpus present:

```
dir=...\app\ai-knowledge\care-radiologist available=true sections=130 missing=0 mismatches=0
documents=mri-brain-v1.md:62:d34b5594cc53 | mri-ls-spine-v1.2.md:38:b1172beaea9d | master-system-prompt-v4.md:30:c8b18ca21931
```

and from the layout without the corpus — the fail-safe case, with no exception and no truncation:

```
dir=null available=false sections=0
reason=No radiology knowledge documents found (looked in: ... [cwd], ... [cwd-parents], ... [module]).
        Reference knowledge is OFF for this run; the report is composed from the radiologist's own input.
COMPOSE rag=ON identical_to_base=true added_chars=0 fits=true
```

`COMPOSE rag=ON identical_to_base=true` is the point of that line: with the flag on and the corpus
missing, the request the Composer sends is **byte-identical** to the request it sends with the flag
off. A missing corpus can therefore never be the reason a report is refused, shortened, or changed.

## What is copied, and where

One line in the `api` stage, before `EXPOSE 8080` (`Dockerfile:165`):

```
COPY --from=api-build /repo/ai-knowledge/care-radiologist        ./ai-knowledge/care-radiologist
```

`FROM node:22-bookworm-slim AS api` is `Dockerfile:70` and that stage's `WORKDIR /app` is
`Dockerfile:117`, so the corpus lands at **`/app/ai-knowledge/care-radiologist`**. It is copied from
the `api-build` stage (`/repo` = the build context checkout), not from the runtime worktree, so a
stale NAS working tree cannot shadow it — the image content is decided by git.

Three documents and the manifest are read; everything else in the directory ships as the clinic's
provenance archive and is never opened by the process:

| File | Sections | SHA256 (first 12, as the runtime reports it) |
| --- | --- | --- |
| `mri-brain-v1.md` | 62 | `d34b5594cc53` |
| `mri-ls-spine-v1.2.md` | 38 | `b1172beaea9d` |
| `master-system-prompt-v4.md` | 30 | `c8b18ca21931` |
| `SHA256SUMS` | — | the clinic's own stamp; full 64-hex lines |

Total 130 sections. The manifest format is `<64-hex>  <path>  <N bytes>` and is parsed by
`readManifest()` (`knowledgeCorpus.ts:112`). Measured 2026-11-03: the four files the loader reads are
43 070 / 23 722 / 32 618 / 905 bytes and copy byte-identically (`COPY mri-brain-v1.md bytes=43070
identical=true` in the proof log). `originals/` holds the same brain document as a `.txt` inside a
zip plus the Open WebUI prompt asset — checked for patient content on 2026-11-03: no patient names,
the only `patient` strings are instructions ("do not invent the patient's…"), and the asset's `name`
is `CARE RADIOLOGIST- REPORT COMPOSER`.

## How the running process finds it

`candidateDirs()` (`knowledgeCorpus.ts:96-111`) is ordered, first hit wins:

1. an explicit `dir` argument (tests only);
2. `CARE_KNOWLEDGE_DIR` env var — the escape hatch if the layout ever moves;
3. `<cwd>/ai-knowledge/care-radiologist` — **this is the one that answers in the container**, because
   `docker/api-entrypoint.sh:29` is `exec node --enable-source-maps ./dist/index.mjs` from `WORKDIR
   /app`;
4. `<cwd>/../../ai-knowledge/care-radiologist` (a repo checkout run from a package directory);
5. five levels up from the module's own file — meaningful from `src/lib/reportComposer/`, and in the
   bundle it lands outside `/app` and finds nothing, which is why candidate 3 exists.

No candidate points at a mounted volume and nothing is read from git at runtime. If every candidate
misses, the run is simply without reference knowledge.

## Verify inside the running container — operator commands, not executed here

Run on the NAS, in the operator's own shell, after a deploy that includes this change. Container
`care-api` (`docker-compose.yml:230`).

**1. The files are in the image and in the running container:**

```
docker exec care-api ls -l /app/ai-knowledge/care-radiologist
```

Expect four entries plus `benchmarks/`, `originals/`, `README.md`; the three documents must be
43070, 23722 and 32618 bytes and `SHA256SUMS` 905 bytes.

**2. The bytes are the ones the clinic stamped — compare against the shipped manifest:**

```
docker exec care-api sha256sum /app/ai-knowledge/care-radiologist/mri-brain-v1.md /app/ai-knowledge/care-radiologist/mri-ls-spine-v1.2.md /app/ai-knowledge/care-radiologist/master-system-prompt-v4.md
docker exec care-api cat /app/ai-knowledge/care-radiologist/SHA256SUMS
```

The three hashes must equal the manifest's lines for the same files. A mismatch is not cosmetic: the
loader computes its own version per document and reports `mismatches` — a document that no longer
matches `SHA256SUMS` is still usable, but the audit row will name a different version than the
manifest, which is exactly the discrepancy these two commands are meant to catch.

**3. The process resolves the packaged path (no model call, no patient data):**

```
docker exec care-api node -e "const m=await import('/app/dist/index.mjs').catch(()=>null); console.log('boot', m?'ok':'skipped')"
```

That is *not* a good probe — it boots the server. The honest probe is the one the loader itself
answers with, visible in the application log on the first composed report after RAG is enabled:

```
docker logs care-api 2>&1 | grep -m5 compose-rag
```

Format (`composeEngine.ts:928-931`), emitted only when at least one section was actually added:

```
[compose-rag] kind=PROFESSIONALIZE sections=mri-brain-v1.md#62,mri-brain-v1.md#59,... versions=d34b5594cc53 added_chars=3801
```

A `sections=` list whose `versions=` matches step 2 is direct evidence that the model was given the
packaged corpus, from the packaged path, with the packaged content. Absence of the line means either
the flag is off or the request did not use the text path — it does not prove a failure, and the
audit row's `referenceKnowledge` field is the per-study record of the same fact.

**4. Enable the flag (it ships OFF, and stays off until a row exists):**

`isFeatureEnabledServer()` reads the `feature_flags` table and returns `false` for an unknown key, so
the deployed default is exactly "no behaviour change". `PATCH /api/feature-flags/ff_radiology_ai_rag`
**404s while no row exists** (`routes/featureFlags.ts:97-100`), so the row is created once, disabled:

```
docker exec -i care-db psql -U erp -d diagnostic_erp -c "INSERT INTO feature_flags (key, enabled, description) VALUES ('ff_radiology_ai_rag', false, 'Composer reference knowledge from the clinic radiology documents') ON CONFLICT (key) DO NOTHING"
```

Then toggle it from Flight Deck (the key is registered in `radiologyFeatureFlagRegistry.ts` with
`wired: true`, so the API will accept it) or:

```
curl -X PATCH https://<care-host>/api/feature-flags/ff_radiology_ai_rag -H 'content-type: application/json' --data '{"enabled":true}'
```

with a staff session that has the admin role. `invalidateFeatureFlagCache()` and the Redis
`feature-flags:all` key are cleared by the same route, so no restart is needed. Database and role
names come from `docker-compose.yml`; if the NAS `POSTGRES_DB`/`POSTGRES_USER` differ from the
defaults in AGENTS.md, read them from the compose file before running step 4.

**Rollback** is `{"enabled":false}` — the prompt returns to the byte-for-byte pre-RAG request, because
with `enabled: false` the retrieval path returns the caller's prompts untouched and adds no
provenance field.

## The source-contract test

`artifacts/api-server/src/lib/reportComposer/knowledgePackaging.test.ts` (6 tests) pins the packaging
so a future Dockerfile edit cannot silently drop the corpus:

- the `api` stage, sliced by `FROM … AS api` boundaries rather than by line numbers, contains a `COPY`
  whose source is `/repo/ai-knowledge/care-radiologist` and whose destination is
  `./ai-knowledge/care-radiologist`;
- no other stage (`web-build`, `web`, `migrate`) ships the corpus — only the api runtime layer needs
  it, and a second copy in the web image would put clinical documents in an nginx container;
- `.dockerignore` cannot exclude it: each pattern is matched against every **ancestor prefix** of the
  path, with the directory-prefix semantics that a bare `ai-knowledge` line would otherwise be missed;
- the destination the Dockerfile writes is one of the directories `candidateDirs()` actually
  consults — the test reads the loader's own candidate list rather than restating it, so moving the
  copy without moving the resolver fails here instead of in production;
- with no corpus reachable, `loadKnowledgeCorpus({ dir: <empty temp dir> })` reports all three
  documents missing and stays `available: false` (an empty cwd alone would prove nothing, because the
  module-relative candidate would still find the repo's own copy — hence the explicit argument).

## What this file does not claim

It does not claim the clinic's image contains the corpus today — the deployed image is whatever
`deploy-synology.sh` last built from `origin/main`, and this branch is not merged. It does not claim
any container was started here. Steps 1-4 are the way to establish all of that on the NAS in about a
minute, and the executed evidence for the resolution logic is `tmp/rag-image/packaged-layout-proof.log`.
