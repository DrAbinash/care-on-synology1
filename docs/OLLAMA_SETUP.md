# OLLAMA_SETUP.md — Local AI Integration Guide

**Care Diagnostics ERP · Ollama LAN Setup**
*For: Windows PC (Ollama host) + Synology NAS (ERP + Open WebUI)*

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          Your LAN                               │
│                                                                 │
│  ┌──────────────────────┐         ┌────────────────────────┐   │
│  │   Windows PC          │         │   Synology NAS          │   │
│  │   192.168.1.250       │         │   192.168.1.137         │   │
│  │   172.16.1.140 (alt) │         │                         │   │
│  │                       │         │  ┌────────────────────┐│   │
│  │  Ollama :11434        │◄────────┤  │ ERP API :8080      ││   │
│  │  medgemma:27b         │         │  │ (Docker)           ││   │
│  │  gemma4:12b           │         │  └────────────────────┘│   │
│  │  qwen3:14b            │         │  ┌────────────────────┐│   │
│  │                       │         │  │ Open WebUI :3000   ││   │
│  └──────────────────────┘         │  │ (Container Mgr)   ││   │
│                                    │  └────────────────────┘│   │
│                                    └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

External access via Cloudflare Tunnel:
  https://webui.caredeoghar.com → Open WebUI :3000 (login required)
  Ollama port 11434 is NOT exposed publicly — LAN only
```

---

## PHASE 2 — Windows Ollama Setup

### Step 1: Install Ollama

Download from https://ollama.com/download and install.

Or via PowerShell (runs the installer):
```powershell
winget install Ollama.Ollama
```

### Step 2: Configure Ollama to Listen on LAN

Ollama by default only listens on localhost. To allow Synology to connect:

**Set environment variable (permanent):**
```powershell
# Run as Administrator
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
```

Then **restart Ollama** (from system tray → Quit, then relaunch).

**Verify it's listening on all interfaces:**
```powershell
netstat -an | findstr 11434
# Should show: 0.0.0.0:11434   LISTENING
```

### Step 3: Windows Firewall Rule

```powershell
# Run as Administrator
New-NetFirewallRule `
  -DisplayName "Ollama LAN Access" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 11434 `
  -Action Allow `
  -Profile Private `
  -RemoteAddress "192.168.1.0/24","172.16.1.0/24"
```

### Step 4: Pull Models

```powershell
# Best for medical radiology reporting (requires ~16GB VRAM or RAM)
ollama pull medgemma:27b

# Faster, balanced (requires ~8GB VRAM or RAM)
ollama pull gemma4:12b

# Good for formatting and rewriting (requires ~8GB VRAM or RAM)
ollama pull qwen3:14b
```

### Step 5: Verify Locally (from Windows)

```powershell
# Should return JSON with model list
curl http://localhost:11434/api/tags

# Quick generation test
curl http://localhost:11434/api/generate -d '{
  "model": "gemma4:12b",
  "prompt": "What is a normal MRI brain finding?",
  "stream": false
}'
```

### Step 6: Verify from Synology

SSH into Synology NAS, or use the ERP container terminal:

```bash
# Try primary IP
curl -m 10 http://192.168.1.250:11434/api/tags

# Try secondary IP (if Windows has two NICs)
curl -m 10 http://172.16.1.140:11434/api/tags
```

Both should return a JSON list of models. If either fails:
- Check Windows Firewall rule is active
- Check OLLAMA_HOST environment variable is set
- Check Ollama is running (system tray icon)
- Verify the IPs using `ipconfig` on Windows

---

## PHASE 4 — Connect Existing Open WebUI

Open WebUI runs as a **Synology Container Manager** container (separate from docker-compose.yml).

### Update Open WebUI OLLAMA_BASE_URL

1. Open **Synology DSM → Container Manager → Containers**
2. Find the `open-webui` container → **Stop** it
3. Click **Edit** → **Environment Variables**
4. Find `OLLAMA_BASE_URL` or add it:
   ```
   OLLAMA_BASE_URL=http://192.168.1.250:11434
   ```
5. **Save** and **Start** the container

**Fallback:** If `192.168.1.250` doesn't connect, change to:
```
OLLAMA_BASE_URL=http://172.16.1.140:11434
```

### Verify Open WebUI Works

1. Open http://192.168.1.137:3000 (LAN) or https://webui.caredeoghar.com
2. Log in
3. Go to **Settings → Models** — you should see `medgemma:27b`, `gemma4:12b`, `qwen3:14b`
4. Start a new chat and select a model

> ⚠️ Do NOT expose Ollama port 11434 in Cloudflare Tunnel. Only Open WebUI domain is exposed publicly.

---

## PHASE 5 — ERP AI Integration

### Enable in ERP Settings

1. Log in to ERP as admin/super_admin
2. Go to **Settings → AI Reporting → Local AI** tab
3. Set:
   - **Primary URL:** `http://192.168.1.250:11434`
   - **Fallback URL:** `http://172.16.1.140:11434`
   - **Default Model:** `medgemma:27b`
   - **LAN Mode:** ✅ ON (required for private IPs)
   - **Master Enable:** ✅ ON
4. Click **Auto-Detect** to verify both IPs
5. Click **Test Primary** to confirm connection
6. Click **Save Local AI Settings**

### Using in Command Center

1. Open **Radiology Command Center** for any study
2. In the right panel, click the **⚡ AI** tab (8th tab)
3. Select model from dropdown (loaded from Ollama)
4. Available actions:
   | Button | Action | Output |
   |--------|--------|--------|
   | 🧠 Generate AI Draft | Full report from study info | Findings draft |
   | ✨ Improve Report | Better language, same findings | Findings draft |
   | 🔁 Findings → Impression | Convert to formal impression | Impression |
   | 📥 Care Format | Technique/Findings/Impression | Findings draft |
   | ✓ Grammar Cleanup | Fix grammar, preserve meaning | Findings draft |

> ⚠️ **SAFETY**: All AI output goes to draft only. Radiologist must verify before finalization. AI never auto-finalizes.

---

## Environment Variables (docker-compose/.env)

Add to your `.env` file:

```env
# ── Local Ollama AI Integration ────────────────────────────────
# Primary Ollama endpoint on Windows PC
OLLAMA_PRIMARY_URL=http://192.168.1.250:11434

# Secondary/fallback endpoint (second NIC or IP alias)
OLLAMA_FALLBACK_URL=http://172.16.1.140:11434

# Default model for ERP AI assistant
OLLAMA_DEFAULT_MODEL=medgemma:27b
```

> Note: These env vars are NOT used directly by the ERP code. The ERP reads settings
> from the `clinic_settings` database table (set via admin UI). The env vars above
> are documentation references for network config.

---

## PHASE 3 — Auto-Detect Logic (How It Works)

The ERP backend uses an endpoint probe cache to automatically select the working Ollama URL:

1. **Primary URL** (`192.168.1.250:11434`) is probed first with 8s timeout
2. If primary fails → **Fallback URL** (`172.16.1.140:11434`) is tried
3. Working URL is **cached for 5 minutes** — no probe on every AI request
4. If both fail → backend returns HTTP 503 with clear message
5. ERP frontend shows `Offline` status in the AI tab
6. **Cache is cleared** automatically when primary fails — next request re-probes

The admin can also click **Auto-Detect** in settings to probe both IPs immediately.

---

## PHASE 7 — Permissions

All AI assistant actions require the `ai_reporting.use` permission.

Grant this permission in: **Staff Management → [User] → Permissions → AI Reporting: Use**

Admin and Super Admin roles have this permission automatically.

Audit logs are written to `radiology_ai_review_audits` table with:
- `modality`, `body_part`, `study_uid`
- `providers_queried` (JSON: model, endpoint, action, success)
- `selected_by_id`, `selected_by_name`
- `created_at`

---

## PHASE 8 — Testing Checklist

### Windows Tests
- [ ] `curl http://localhost:11434/api/tags` returns model list
- [ ] `ollama list` shows pulled models
- [ ] `netstat -an | findstr 11434` shows `0.0.0.0:11434 LISTENING`

### LAN Connectivity Tests
- [ ] `curl -m 10 http://192.168.1.250:11434/api/tags` from Synology
- [ ] `curl -m 10 http://172.16.1.140:11434/api/tags` from Synology (fallback)

### Open WebUI Tests
- [ ] http://192.168.1.137:3000 lists Ollama models
- [ ] https://webui.caredeoghar.com works with login
- [ ] Chat with `gemma4:12b` works
- [ ] Cloudflare Tunnel is NOT exposing port 11434

### ERP Tests
- [ ] Settings → AI → Local AI: Auto-Detect finds primary URL
- [ ] Settings → AI → Local AI: Test Primary shows "Connected"
- [ ] Command Center AI tab shows "Ollama online" badge
- [ ] "Generate AI Draft" produces output in findings area
- [ ] "Grammar Cleanup" corrects text without changing content
- [ ] "Findings → Impression" inserts into impression list
- [ ] Report save/finalize/print flow works unchanged
- [ ] Turn off Windows Ollama → ERP shows "Offline" — no hang
- [ ] Role without `ai_reporting.use` cannot see AI buttons

### Safety Checklist
- [ ] AI output always goes to draft area only
- [ ] Warning banner visible in AI tab
- [ ] No auto-finalize path exists
- [ ] Audit log entry created for each AI action

---

## Rollback Instructions

### Rollback Open WebUI to Previous Ollama URL

```
# In Synology Container Manager → open-webui → Edit → Env vars
OLLAMA_BASE_URL=<previous URL or remove entirely>
```

### Disable ERP Local AI

1. Settings → AI → Local AI → Master Enable → OFF → Save
2. AI tab still shows in Command Center but displays "disabled" message

### Rollback DB Schema (if needed)

Connect to PostgreSQL and run:
```sql
-- Remove new columns (data loss — only if needed)
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS ollama_fallback_url;
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS ollama_enabled;
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS ollama_timeout_seconds;
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS ollama_audit_enabled;
```

### Git Rollback

```bash
git log --oneline -5
git revert HEAD   # reverts last commit
# OR
git reset --hard <previous commit hash>
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Ollama not reachable from Synology | Check firewall rule, OLLAMA_HOST=0.0.0.0, restart Ollama |
| ERP shows "Ollama unreachable" | Check `ollamaLocalOnly=true` in settings (required for LAN IPs) |
| Model not loading | Run `ollama pull medgemma:27b` again on Windows |
| Open WebUI shows no models | Update `OLLAMA_BASE_URL` in Container Manager |
| SSRF blocked error | Enable "LAN Mode" toggle in Settings → AI → Local AI |
| AI response very slow | Use `gemma4:12b` instead of `medgemma:27b`, or increase timeout |
| ERP hangs when Ollama offline | Should not happen — probe timeout is 8s, ERP shows "Offline" |
