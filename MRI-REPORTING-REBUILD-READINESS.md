# MRI Reporting Recovery — Rebuild Readiness

**For the owner. Read this before you rebuild CARE ERP.**

## The headline

On 2026-10-11 the existing CARE Composer generated a real MRI report from a real
local model for the first time. That was measured on this development machine
against your AI PC while it was online. It used the shipped prompt builder, the
shipped Ollama transport and the shipped JSON parser — nothing was simulated.

What it did **not** need was any new code. It needed two settings.

## Why it never worked before

Two separate things were wrong, and each one alone was enough to stop every report.

**1. The Composer refused your AI PC's address.**
CARE checks the Ollama address before connecting, to be sure clinical data cannot
be sent somewhere unexpected. That check refuses private network addresses unless
**Local / LAN mode** is turned on — and the setting is created **off** by default.
So the Composer said "endpoint blocked" and never even tried to connect.

This is why it looked fine everywhere else: bill OCR does not pass through that
particular check. The same correctly configured model worked for scanning bills and
was invisible to report writing.

**2. The error never told you what to do.**
CARE knew the answer. The checker produced the sentence "Private/LAN addresses
require Local / LAN mode to be enabled in Settings → Radiology → AI Assistant" —
and then threw it away, so you only ever saw a code. That is fixed.

A third thing was lying to you: the AI Reporting Settings screen **displayed
Local / LAN mode as ON** while the database actually held OFF, because the screen
started from a different default than the server. So the settings page said the
thing that was not true, and "Test connection" passed while reports kept failing.
That is fixed too — the screen now shows the value the server really has.

## Your AI PC address changed — that mattered

The working Ollama is `http://192.168.1.250:11434`.

The old address `http://172.16.1.140:11434` was still baked into the program as
the fallback used when nothing is configured. After a rebuild, if a setting is
missing, CARE would quietly aim at a machine that no longer answers. That baked-in
address is removed; the fallback is now the ordinary local default, and your real
address lives where it belongs — in the deployment configuration.

## The five settings to check after the rebuild

Open **AI Reporting Settings** (staff login → the AI settings page). In the **Local AI** section:

| Setting | What it must be |
|---|---|
| Local AI enabled | **ON** |
| Ollama endpoint | `http://192.168.1.250:11434` |
| **Local / LAN mode** | **ON** ← this is the one that blocked everything |
| **Report Composer model** | `gemma3:12b` ← must not be empty |
| Timeout | 45–60 seconds is comfortable for a full report |

Then **Save**, and press the connection test — it should report the models it found.

**Why `gemma3:12b` and not `qwen3-vl:8b`:** measured in an earlier investigation,
`qwen3-vl:8b` reads the input correctly but spends the whole answer budget on its
internal reasoning and returns **no report text**. Turning off thinking, forcing
JSON format, and giving it more context were each tried and each failed. `gemma3:12b`
answered properly. Use `qwen3-vl:8b` later for images, not for writing the report.

## How to know it worked

In the Radiology Reporting Workspace, select an MRI study, enter observations, and
choose **Generate AI Report**. The report appears in the existing Composer panel
with findings and an impression you can accept, edit or reject.

If it does not appear, the panel now states the reason in plain language. These are
the three you may see, and what each means:

- **"…require Local / LAN mode to be enabled…"** → Local / LAN mode is off. Turn it on and save.
- **"FALLBACK DRAFT — Local AI was not used"** → the Report Composer model is empty. Set it to `gemma3:12b`.
  CARE deliberately shows this warning instead of presenting a mechanical draft as an AI report.
- **"The model replied in prose rather than the structured form…"** or an empty-response
  error → the model answered but not usefully; pick a different model and retry.
  **Your observations are not touched when generation fails.**

## What is on main versus what still needs merging

| Change | Where it is | Merge needed before rebuild? |
|---|---|---|
| AI image de-identification foundation | **PR #909 — already merged to `main`** | No |
| Error reason now reaches the screen | **PR #911 — draft, not merged** | **Yes, to see the messages above** |
| Cloud image privacy enforcement | PR #910 — draft | No (does not affect text MRI reports) |
| Local/LAN display fix, removed dead address, plain-language parse error, live-report test | **PR #912 (this branch)** | **Yes** |

**Nothing was merged or deployed automatically.** If you rebuild from `main` as it
stands tonight, MRI generation will work **provided you turn Local / LAN mode on and
set the composer model** — but failures will still show the older, less helpful text.
Merging #911 and #912 first is what makes the remaining setup steps self-explanatory.

## Migrations and secrets

- **No database migration is required** for any of these changes. All touched columns
  (`ollama_local_only`, `ollama_composer_model`, `ollama_base_url`) already exist.
- **No secret or API key was changed.** Nothing here needs cloud AI.
- The deployment file `deploy/synology/care.env` already points the primary endpoint
  at `192.168.1.250`. Its **fallback** line pointed at the dead old address and now
  matches the working one, so a failover attempt will not spend its timeout on a
  machine that is gone.

## Local model only, for now

Text-only MRI reports need no internet and no cloud provider, and no patient data
leaves the clinic for them. Cloud text providers and OHIF image selection remain
separate pieces of work and are deliberately **not** required for your first report.
