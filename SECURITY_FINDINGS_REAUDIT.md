# Security Findings Re-Audit — Milestone 1 Gate 1

**Status:** Independent verification, per IMPLEMENTATION_CHECKLIST.md Gate 1's explicit requirement that closure be independently verified, not self-attested. This document corrects the prior planning documents' "default JWT/session secrets" framing, which turns out to be imprecise — the real findings are narrower but still real, and one finding (plaintext WhatsApp tokens) was not previously named at all.

---

## What the Prior Documents Claimed

01_CURRENT_ARCHITECTURE_AUDIT.md and every downstream document referenced "default JWT/session secrets, default DB password" as two unresolved CRITICAL findings from an earlier full ERP security audit. That audit was not re-read before this document — only its summary conclusion was repeated, exactly the pattern this project has caught itself in once before with the Laboratory module.

## What's Actually True, Verified Today

### Finding 1 — Session-secret fallback exists in source, but is fail-closed at the infrastructure level

artifacts/api-server/src/lib/cryptoUtils.ts contains a fallback: if SESSION_SECRET is unset, the code falls back to a hardcoded literal string. This fallback would be catastrophic if it were ever live — anyone reading the public source code would know the encryption key for anything protected by this mechanism.

However, docker-compose.yml already enforces a hard fail-fast guard requiring SESSION_SECRET to be set in .env, with Compose refusing to start the API container at all if it's unset. This means the dangerous fallback string is unreachable in the actual deployed system today, as long as .env is correctly configured on the Synology host — which cannot be verified directly from this environment, since there is no shell access to the live Synology box. The deployment mechanism itself makes the worst-case scenario structurally impossible rather than merely discouraged.

Risk remaining: the fallback string should still be removed from source as defense in depth and dead-code cleanup. Low urgency given the Compose guard, but should be addressed.

### Finding 2 — No JWT is used anywhere in this codebase

The prior documents' "default JWT secret" framing does not correspond to anything real — a search for jsonwebtoken, jwt., or JWT_SECRET across the entire API server returns zero matches. Authentication is via portal_sessions bearer tokens, random tokens stored in the database and validated against an expiry timestamp, not JWTs. This part of the prior finding should be retired entirely — it was never accurate, not just resolved.

### Finding 3 — newly identified — WhatsApp Business API tokens stored in plaintext

The WhatsApp numbers and settings schema both define an access token field as plain text, with no encryption applied anywhere in the write path. An encrypt/decrypt mechanism exists in the codebase and is used for exactly one thing, an AI-reporting provider's API key, but was never applied to WhatsApp credentials.

This is a real, previously undocumented gap. A database backup, a read replica, or any SQL-level access to this database exposes live WhatsApp Business API tokens in cleartext. Given today's other work involves a WhatsApp bot that is more built and more live than previously assumed, this is now a higher-priority finding than it would have been under the original assumption that WhatsApp AI was a dormant skeleton.

### Finding 4 — DB password

Not independently verified in this pass — verifying the actual deployed database password's strength and rotation status requires access to the live Synology .env file, which this environment cannot reach. This remains genuinely open, not closed, and not falsely claimed as checked.

---

## Gate 1 Status — Honest Assessment

| Original Gate 1 item | Status after this re-audit |
|---|---|
| Default JWT/session secrets, independently verified closed | Partially retired, partially open. No JWT exists at all, so that half of the original finding was never real. The session-secret fallback exists in source but is unreachable in deployment due to the Compose fail-fast guard — structurally mitigated, not yet cleaned up. |
| Default DB password, independently verified closed | Still open. Not verifiable from this environment; requires direct access to the live .env on Synology. |
| Plaintext WhatsApp credential storage | Newly identified, open. Not in the original Gate 1 list at all. |

## Recommendation

Gate 1 should not be marked complete. Two concrete actions are needed before it can be:

1. Confirm with whoever has Synology shell access that .env's DB_PASSWORD and SESSION_SECRET are both genuinely random values, not example or placeholder values copied from .env.example.
2. Decide whether to encrypt the WhatsApp access token fields using the existing encryptSecret mechanism — low engineering cost, since the function already exists and is simply not called for these two fields yet.

This document itself is the independently-verified, not-self-attested step for everything checkable from source. The remaining two items require a human with Synology access, and are flagged honestly as open rather than assumed closed.
