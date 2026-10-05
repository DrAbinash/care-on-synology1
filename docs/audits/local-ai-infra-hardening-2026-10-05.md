# CARE Local AI Infrastructure Hardening — 2026-10-05

Small, audit-justified corrections only. No provider abstraction, no new AI client, no DB
migration, no clinical workflow change, no model installation, no service restart.
Ollama stays the production Local AI runtime. LM Studio was **not** started, configured or
routed. Open WebUI was **not** modified.

Everything below was re-read at `origin/main` = `4a137d3e` on 2026-10-05, because other
sessions had landed through #832 since the infrastructure audit was written.

---

## 1. One canonical source for the Local AI constants (item 1)

**Before** — the same two values were declared in two production files, joined only by a
comment that said "Keep in sync":

| File | Declared |
| --- | --- |
| `lib/ai-providers/src/index.ts:22-23` | `CANONICAL_OLLAMA_ENDPOINT`, `CANONICAL_LOCAL_CHAT_VISION_MODEL` |
| `artifacts/api-server/src/lib/aiPipeline/canonicalLocalAi.ts:8-9` | the same two, again |
| `artifacts/api-server/src/lib/operationsContext.ts:122,130` | the same two, inline as string literals |

**After** — one leaf module owns them and the three consumers import it:

- new `lib/ai-providers/src/canonicalLocalAi.ts` (no imports of its own), exported through
  the package map as `@workspace/ai-providers/canonical`;
- `lib/ai-providers/src/index.ts` re-exports it (existing importers unchanged);
- `artifacts/api-server/src/lib/aiPipeline/canonicalLocalAi.ts` re-exports it and keeps its
  own normalise helpers and legacy alias map;
- `artifacts/api-server/src/lib/operationsContext.ts` imports the leaf, so it still pulls in
  no database pool.

**Effective values are unchanged**: `http://172.16.1.140:11434` and `qwen3-vl:8b`. Pinned by
`canonicalLocalAi.singleSource.test.ts`, which scans production code (comments stripped) and
fails if a second definition or a second copy of the endpoint literal appears.

The leaf exists as a subpath rather than a barrel import because `operationsContext.ts`
deliberately imports no `@workspace/db` — the CLI (`smoke-cli.ts`) injects its own pg pool.

**Known remaining copies that are prose, not code** (deliberately left alone in this PR):
`lib/db/src/schema/clinicSettings.ts:241` comment; `artifacts/diagnostic-erp/src/pages/AiReportingSettings.tsx:1180`
input placeholder; `LocalAiPanel.tsx` help text; `.env.example`, `deploy/synology/care.env`
and `Antigravity/09_AI/OLLAMA_SETUP.md` env samples. Changing any deployment env value would
change production behaviour, which is out of scope here.

## 2. Provider-aware health probe for `local_openai_compatible` (items 2 and 3)

CARE has two kinds of local AI, and only one of them was ever asked a question:

- **Ollama** — native API: `GET /api/tags`, `GET /api/ps`, `POST /api/chat`. Kept exactly as
  it was; nothing in this PR changes an Ollama check.
- **`local_openai_compatible`** — any local server speaking the OpenAI wire format
  (llama.cpp, vLLM, PrismML, LM Studio …). It answers `GET <baseURL>/models`. Before this PR
  nothing in CARE called it: the only signal available was a full chat completion with a
  30-second deadline, so "server down", "needs a key", "model not loaded" and "model slow"
  all looked identical to whoever was troubleshooting.

Added to the existing shared transport module (`lib/ai-providers/src/openAiCompatible.ts`),
reusing plain `fetch` in the same style as `probeOllamaReachable` — **no new client, no new
abstraction**:

```
probeOpenAiCompatibleModels(baseUrl, { apiKey?, timeoutMs? })
  → { reachable, httpStatus, latencyMs, models[], error }
```

- `baseUrl` is the *versioned* base the SDK is given (`…/v1`), so the URL asked is
  `…/v1/models` — matching how `openAiCompatibleChat` builds its client.
- An **empty API key is valid**: no `Authorization` header is sent at all unless a key
  exists. 401/403 is reported as `auth_required (HTTP 401)`, not as a dead server.
- **Bounded**: `AbortSignal.timeout`, default 3000 ms.
- **Fail safe**: never throws. Transport error, timeout, HTTP error and unparseable body all
  come back as a value, and the key is scrubbed out of any error text (`[REDACTED]`, ≤160
  chars). An unconfigured endpoint returns `endpoint_not_configured` without touching the
  network.

Wired into three places, all of which previously assumed Ollama:

1. **Settings → "Test connection"** (`OpenAiCompatibleProvider.testConnection`). Asks
   `/models` first, returns the served ids as `availableModels`, notes when the requested
   model is not among them, and short-circuits with the real reason when the server did not
   answer at all instead of waiting 30 s for a chat call that cannot succeed. A 404 on
   `/models` (server does not implement it) still falls through to the chat completion, which
   remains the verdict. Cloud vendors are **not** probed — no extra egress.
2. **Ops report** (`operationsChecks.ts`, new check `ai.local_openai_compatible`,
   `optional: true`, alongside the unchanged `ai.ollama`). Reads the saved endpoint/default
   from `ai_provider_settings` through the injected `query` function. SKIPPED when nothing is
   configured, SKIPPED with the route consequence named when the provider is switched off,
   PASS on a reachable server or a 401, WARNING on unreachable / 4xx other than auth / saved
   model not served. It sends no key, so the ops path never handles the decrypted secret.
3. **Pipeline self-test** (`aiPipelineSelfTest.ts`, new `routed-provider-health` step). Only
   runs when the resolved draft route's provider is `local_openai_compatible`, and reports
   that provider's own answer. The Ollama-native steps around it are untouched.

Also added one row to `scripts/verify-deployment.mjs` — the NAS command — because its AI
section could previously only say "Ollama not set — AI reporting disabled", which is untrue
for a clinic whose route points at an OpenAI-wire server.

## 3. Fallback truthfulness (item 4)

**What the configuration actually is** (`deploy/synology/care.env:90-92`, unchanged):

```
OLLAMA_PRIMARY_URL  = http://192.168.1.250:11434
OLLAMA_FALLBACK_URL = http://172.16.1.140:11434
OLLAMA_BASE_URL     = http://192.168.1.250:11434
```

**Measured 2026-10-05** from this machine, read-only GETs:

| Address | `/api/version` | models |
| --- | --- | --- |
| `192.168.1.250:11434` | `0.35.0` | `qwen3:30b@4918f0eaab34, qwen3-vl:8b@3216286ea8c5, qwen3:14b@c33f2ed1b31c, gemma3:12b@b637d1ffa37b, gemma3:4b@3eb7fa8be850, gpt-oss:20b@1a42e97930aa` |
| `172.16.1.140:11434` | `0.35.0` | byte-for-byte the same six names and digests |

Same build, same served set, same digests: **one Ollama runtime on one Windows PC, reachable
by two addresses.** So `radiologyOllama.ts` failover (primary → fallback) protects against a
dead route or a dead interface. It does **not** protect against the Ollama process dying, the
PC dying, or the GPU dying — and until now nothing in the product said so. The admin UI and
docs presented a "Fallback URL" field in terms that read like redundancy.

**What changed**: the truth is now reported wherever the fallback is reported.

- `GET /api/radiology-ops/ollama/status` gained `fallbackSemantics`, `fallbackMeaning` and
  `fallbackIdentity`. Without a query parameter this is config-only — no extra network calls,
  no added latency.
- `?verifyFallback=1` opts into a comparison: both addresses pass the same SSRF guard
  inference uses, then `GET /api/tags` + `/api/version` are read from each and the sorted
  `name@digest` set is hashed. Verdicts are `same_address`, `same_runtime`,
  `separate_runtime`, `not_configured`, `unverified` — with `unverified` used whenever proof
  is missing (no digests, guard rejects one side, one side unreachable). `independent: true`
  is returned **only** for `separate_runtime`.
- New `artifacts/api-server/src/lib/ai/localAiFallbackIdentity.ts`. Diagnostic only: it does
  not choose an endpoint, does not cache, and is not called by any inference path.

**What did NOT change**: the failover order, the timeout logic, the endpoint cache,
`docker-compose.yml`, `deploy/synology/care.env`, `.env.example` and any clinic network
setting. Making this a genuine second runtime is a hardware/deployment decision (a second
host), not a code change — recorded here rather than silently attempted.

## 4. GPU reporting on two RTX 3050s (item 5)

**Measured 2026-10-05** (`nvidia-smi --query-gpu`):

```
0, NVIDIA GeForce RTX 3050, 8192 MiB, 1202 MiB used
1, NVIDIA GeForce RTX 3050, 6144 MiB,   13 MiB used
```

Two cards, **different sizes** (8 GB + 6 GB), 14 GB total — which matches the "14 GB
graphics" Windows reports for this box.

**What Ollama tells us**: `GET /api/ps` returned `{"models":[]}` at 17:0x (nothing resident),
so the field set was confirmed against the installed version's own definition —
`ProcessModelResponse` in `api/types.go` at tag `v0.35.0` — which carries exactly
`name, model, size, digest, details, expires_at, size_vram, context_length`. **There is no
device, GPU index or per-accumulator field.** Ollama therefore cannot attribute VRAM to a
specific 3050, and CARE must not imply otherwise.

**The bug**: `ollamaRunnerDiagnostics.ts` summed every runner's `size_vram` into
`totalSizeVramBytes` and printed it as `totalVram=…`. With two runners the number silently
read as "one card is using X", when it was a sum spanning both — the exact figure operators
compare against "8192 MiB free" to decide whether a context size will OOM.

**What changed** (reporting only, no inference logic):

- each runner now carries `device`, populated **only** when a server reports one
  (`device`, or a joined `devices[]`), otherwise `null` — nothing is guessed;
- `formatPsSummary` prints the per-runner figure as before and now appends `@CUDA 0` when the
  server supplies it, so both cards stay individually identifiable the moment Ollama can say
  which is which;
- the aggregate label became `sumVramAcrossRunners=…`, and when more than one runner is
  resident with no device information the line ends `… (sum spans all runners; this server
  reports no per-GPU split)`.

No multi-GPU placement, sharding, `OLLAMA_GPU_OVERSHIP`/`CUDA_VISIBLE_DEVICES`, num_ctx or
offload logic was added or changed. `isLikelyTooLargeForRtx3050` still answers the honest
question it was written for — "would this model not fit one 8 GB card" — and is not a
claim about this host's total.

## 5. LM Studio — audit only (item 6)

Nothing was installed, uninstalled, started, stopped, configured, routed or deleted in this
PR. State as found at 17:3x on 2026-10-05: `LM Studio.exe` ×5 processes with
`lmlink-connector`, `lms server` disabled, and **no listener on port 3000** for Open WebUI.

The earlier lab work (2026-10-05, CPU-only so as not to evict production `qwen3-vl:8b`, one
non-patient test image) is the reason LM Studio stays out of CARE, and it is worth keeping in
front of the next person who is tempted:

1. **Integration blocker.** Gemma-4 12B QAT puts roughly 88 % of its output in
   `reasoning_content`; `choices[0].message.content` stays empty until `max_tokens` reaches
   about 420. CARE's shared transport reads only `message.content`
   (`openAiCompatible.ts:146-149`) and the local-compat Composer adapter sends no
   `max_tokens`. A route onto that model would produce `empty_model_response` for real work —
   silently, on the draft path. `thinking_enabled:false` / `reasoning_effort` were ignored.
2. **No capacity headroom to gain.** The GPU-offload trial was declined on blast-radius
   grounds, with the measurement to justify it: the 31B-class load estimated 6.66 GiB against
   ~6.7 GiB free on GPU0 while the NAS was actively using Ollama (probe HTTP 200 at 15:04:19).
   OOM there evicts or breaks the production runtime.
3. CARE has no dependency on it: `local_openai_compatible` already covers any OpenAI-wire
   local server through Settings, and it is now health-checkable — which is what LM Studio
   would need before it could be routed at all.

If LM Studio is ever wanted, the order is: expose its server on `127.0.0.1` only, confirm
`GET /v1/models`, then prove `content` (not `reasoning_content`) is populated for the exact
`max_tokens` CARE sends, and only then make it a routed provider.

## 6. Open WebUI — stale assumptions documented, not edited (item 7)

Repo-wide search finds **no code reference** to Open WebUI in `lib/`, `artifacts/` or
`scripts/` — it is not a CARE dependency and no CARE path calls it. The mentions are all
documentation/config comments, and several describe things that are no longer true:

| Where | Claim | Reality measured 2026-10-05 |
| --- | --- | --- |
| `.env.example:229` | "Only Open WebUI (port 3000) is exposed. Ollama/OCR stay LAN-only." | No listener on `:3000` on `172.16.1.140`, `192.168.1.250` or `127.0.0.1`. Whether a NAS container still publishes it was **not** checked from here — UNKNOWN. |
| `.env.example:232-233` | "Open WebUI Ollama URL … `OLLAMA_BASE_URL=http://192.168.1.250:11434`" | That variable is read by CARE's own runtime resolver (`operationsContext.ts`, `aiPipeline/config.ts`), not by Open WebUI. The comment invites an operator to change CARE's primary by editing it for a chat UI. |
| `docs/CARE_ERP_NAS_VALIDATION_CHECKLIST.md:23-24` | probes `http://172.16.1.140:11434/api/tags`, expects `qwen3:14b`, remediation `ollama pull qwen3:14b` | Canonical model is `qwen3-vl:8b` (`canonicalLocalAi.ts`); `qwen3:14b` is pulled but is not the configured model. The checklist teaches the wrong remediation for "AI is broken". |
| `docs/CARE_ERP_ROUTE_AND_SERVICE_MAP.md:43`, `Antigravity/09_AI/OLLAMA_SETUP.md`, `SOP/RECOVERY/**` | describe AI health as `GET /api/tags` only | True for Ollama; incomplete now that a route can point at an OpenAI-wire server, which answers `/models`. |
| `deploy/synology/care.env:91-92` | fallback presented as a second server | See §3 — same runtime, two addresses. |

These files were deliberately **not** edited: `.env.example` and `care.env` are deployment
configuration, and the SOP/Antigravity trees are heuristically maintained by hand. Listed as
the follow-up instead. `care.env` also holds live secrets in a public repo — tracked
separately, and not this PR's business.

## 7. Tests (item 8)

| # | File | Result |
| --- | --- | --- |
| A | `artifacts/api-server/src/lib/aiPipeline/canonicalLocalAi.singleSource.test.ts` | **4 passed** — one definition, no second copy of the endpoint literal in code, both layers agree, legacy normalisation unchanged |
| B+C | `lib/ai-providers/src/openAiModelsProbe.test.ts` | **18 passed** — 12 probe cases (`data[]` and `models[]` parsing, trailing-slash form, no `Authorization` when keyless, bearer when keyed, bounded signal, 401/403 vs 5xx vs transport vs timeout, non-JSON body, unconfigured = no network, Ollama not classified as compat) + 6 test-connection cases (short-circuit when down, ids returned, "not one of them" note, 404 falls through to chat, cloud never probed, Ollama still on `/api/tags`) |
| D | `artifacts/api-server/src/lib/operationsChecks.test.ts` | **39 passed** (30 before + 9 new) — SKIPPED / switched-off / PASS / 401 / 404 / not-served / unreachable paths, `/models` and never `/api/tags`, no key sent, and `ai.ollama` unaffected by a down compat server |
| E | `artifacts/api-server/src/lib/ai/localAiFallbackIdentity.test.ts` | **8 passed** — not_configured / same_address / same_runtime / separate_runtime / unverified paths, SSRF-guard refusal, no fetch when there is nothing to compare |
| F | `artifacts/api-server/src/lib/ai/ollamaRunnerDiagnostics.test.ts` | **8 passed** — per-runner VRAM and context preserved, device read-if-present, `devices[]` joined, sum labelled honestly, caveat only when unattributed, PHI-free |
| G | `artifacts/api-server/src/lib/ai/localAiProviderAwareness.sourceContract.test.ts` | **13 passed** — Ollama keeps `/api/tags`, `/api/ps` and `ollama pull` in health/ops/self-test/verify-deployment; the four compat files contain no `/api/tags` call; still exactly one `new OpenAI(`; `ComposerProviderName` still exactly five; canonical leaf has no imports |
| H | existing suites re-run: `canonicalLocalAi.test.ts` **5 passed**, `compatibleProviders.consolidation`, `providerModel`, `ollamaDiagnostics`, `phiTextCloudGuard`, `requestTimeout`, `reportComposer/**`, `reportComposer/providers/**` | pass, except the DB-dependent cases below |

**Suite run** (same command with a dummy `DATABASE_URL` so `@workspace/db` can load):
`lib/ai-providers/src` + `artifacts/api-server/src/lib/ai` + `aiPipeline` +
`operationsChecks.test.ts` + `reportComposer` →
**85 files: 80 passed, 5 failed; 779 tests: 2 failed, 763 passed, 14 skipped.**

The 5 failures are all `connect ECONNREFUSED 127.0.0.1:5411` — they need a real Postgres
(`aiDraftE2e.dummyImages`, `keyImageOwnership.request`, `preDeploySafety.request`,
`onArrivalSchedule.smoke`, `phiImageCloudGuard`'s one `createAiProviderFromDb` case).
**A/B measured:** the same five files run in the untouched primary tree without this PR's
changes give the identical result (5 files failed, 2 failed / 2 passed / 14 skipped), so they
are environmental, not a regression. No claim of a green local suite is made here; CI is the
authority.

**Typecheck**: `tsc --build` at the root (all libs) and
`tsc -p artifacts/api-server/tsconfig.json --noEmit` — both clean. Note that
`tsconfig.json` excludes `**/*.test.ts`, so the new tests are validated by running them, not
by the typecheck.

**Bundle**: `node artifacts/api-server/build.mjs` succeeds (17.0 MB `dist/index.mjs`), proving
esbuild resolves the new `@workspace/ai-providers/canonical` subpath; the built file contains
no unresolved reference to it.

## 8. Verdict

- Ollama remains the production Local AI runtime. Nothing about inference, routing, model
  choice, the observation ledger, Composer workflow, review/apply, provenance, stale
  protection or finalization changed.
- A clinic that never configures `local_openai_compatible` sees one new SKIPPED ops row and
  one new `unverified` field in the Local AI status payload — no new outbound traffic on any
  default path.
- The `?verifyFallback=1` comparison is opt-in and read-only; production networking was not
  touched, so the two-address/one-runtime situation is reported truthfully rather than fixed
  by surprise.
- Clinic test should check: Settings → AI Providers → Test connection on the local
  OpenAI-compatible row (with and without a key saved), Admin → operations report
  (`ai.local_openai_compatible` row), `GET /api/radiology-ops/ollama/status`
  (with and without `?verifyFallback=1`), the AI pipeline self-test run once with the draft
  route on Ollama, and `node scripts/verify-deployment.mjs` on the NAS.
