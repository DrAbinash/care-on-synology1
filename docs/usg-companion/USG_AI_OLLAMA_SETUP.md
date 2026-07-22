# USG AI Assistant — connecting Ollama (or any provider)

The USG AI assistant does **not** use a bespoke `USG_AI_GATEWAY_URL` gateway.
It routes through the canonical AI provider layer (`@workspace/ai-providers`),
the same one the rest of the ERP uses. Configuration lives in the **database**
(AI Provider Settings + Model Routing), **not** in environment variables.

> `OPENAI_BASE_URL`, `OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` are
> **not read** by the application — they appear only in older docs. Setting them
> does nothing. Configure providers in the admin UI instead.

## What the code actually calls

- Provider + model are resolved by `generateAiForTask("usg_ai_assistant", …)`
  (`lib/ai-providers/src/index.ts`), precedence:
  explicit override → **Model Route** for the task → global default provider.
- The built-in **Ollama** provider talks OpenAI-compatible:
  `new OpenAI({ baseURL: \`${endpointUrl}/v1\`, apiKey: "ollama" })` →
  `POST {endpointUrl}/v1/chat/completions` (`index.ts:103-107, 241-246`).
- Ollama health/reachability = `GET {endpointUrl}/api/tags` (`index.ts:255, 606`).
- The model's JSON output is parsed tolerantly (strips `<think>` blocks and code
  fences) and every suggestion passes the USG safety filter (no fetal sex,
  accept-only, draft-only).

## Exact configuration for Ollama at `http://172.16.1.140:11434`

1. **AI Provider Settings** → **Ollama**
   - Endpoint URL: `http://172.16.1.140:11434`
   - Enable it (optionally set as the global default provider).
   - Click **Test Connection** (`POST /api/ai-reporting/test-provider`) — it runs
     `/api/tags` **and** a live chat completion.
2. **Model Routing** → task **“USG AI Assistant”** (`usg_ai_assistant`)
   - Provider: `ollama`
   - Model: `qwen3:14b` (or another pulled model)
   - Without a route, the Ollama provider defaults to `gpt-oss:20b` — set the
     route so you control the model.
3. **Feature flags / policy**
   - `ff_radiology_ai` (global AI master) **ON**.
   - Per-radiologist AI policy = `pilot` or `production` (so suggestions are
     visible, not shadow-only).
   - `ff_radiology_usg_ai_assistant` **ON** (route existence).
   - `ff_radiology_usg_ai_growth` **ON** for deterministic growth notes
     (these need no model — they summarise the P4 timeline).

## Connectivity test (run from the care-api container, not just the host)

```sh
# Reachability + model list (what the health probe uses)
curl -s http://172.16.1.140:11434/api/tags | head -c 300

# OpenAI-compatible chat (exactly what the Ollama provider calls)
curl -s http://172.16.1.140:11434/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer ollama' \
  -d '{"model":"qwen3:14b","messages":[{"role":"user","content":"Reply with exactly: CONNECTED"}],"stream":false}'
```

The care-api container must be able to route to `172.16.1.140`. The PACS stack
runs on the `care-pacs-net` bridge; ensure care-api is on a network that reaches
the Ollama host (or use the host IP that is routable from the container).

## Notes on the model response

qwen3 returns a separate `reasoning` field plus `content`; the OpenAI SDK reads
`message.content`, so reasoning never leaks into the report. The parser also
strips any `<think>…</think>` that a model puts inline. If a model returns prose
instead of JSON, the panel simply shows no model suggestions (deterministic
growth notes, if enabled, still appear) — reporting is never blocked.
