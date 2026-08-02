# Care ERP Governance, Configuration & Development Standards

This document explains the key files that govern how Care ERP is developed, deployed, and maintained.

---

## 📋 Key Documents

### 1. **DEVELOPMENT_PRINCIPLES.md** (Read First!)
**Purpose:** The foundational principles for all development work on Care ERP.

**What it covers:**
- Core philosophy (understand before modifying, prefer enhancement)
- Hard constraints (never hardcode configuration)
- Prohibited modifications (billing, payments, permissions)
- Architecture and component design
- Optimization targets (Synology, PostgreSQL, Orthanc, OHIF, DICOM)
- Backward compatibility requirements
- Testing and deployment checklist

**When to read:**
- Before starting any development work
- When making architectural decisions
- When proposing changes to core features
- Before a code review or PR

**Key sections:**
- "Never Hardcode" — Critical security principle
- "Prohibited Modifications" — What you cannot touch
- "Backward Compatibility is Non-Negotiable" — Never break existing workflows

---

### 2. **CONTRIBUTING.md** (Quick Developer Guide)
**Purpose:** Quick reference for contributing code to Care ERP.

**What it covers:**
- Quick start (before you code)
- The 5-minute rules (do's and don'ts)
- How to commit and write PR descriptions
- Configuration best practices
- Testing requirements
- Common scenarios and how to handle them

**When to read:**
- When preparing to submit a PR
- When you have a quick question about contribution workflow
- Before your first commit

**Key sections:**
- "The 5-Minute Rules" — Essential do's and don'ts
- "Common Scenarios" — How to handle specific requests
- "Code Style" — TypeScript, React, SQL guidelines

---

### 3. **CONFIG_GUIDE.md** (Complete Configuration Reference)
**Purpose:** Comprehensive guide to ALL configurable settings in Care ERP.

**What it covers:**
- Quick reference table of all configuration variables
- Database configuration (PostgreSQL)
- API server settings (ports, CORS, JWT)
- DICOM and medical imaging (Orthanc, OHIF, Weasis)
- WhatsApp Business integration
- Payment gateway configuration
- Email and SMS settings
- Frontend configuration
- Logging and monitoring
- Synology NAS specific settings
- Security configuration (HTTPS, encryption, rate limiting)
- Development vs production examples
- Troubleshooting guide

**When to read:**
- When adding a new configuration variable
- When deploying to a new environment
- When troubleshooting connection issues
- When setting up integrations (WhatsApp, payment, etc.)

**Key sections:**
- "Never Hardcode" reminder at the top
- "How to Set Configuration" — Three options (file, Docker, admin UI)
- "Validation Checklist" — Before deploying

---

## 🔐 Configuration Principles (Summary)

### The Rule: Never Hardcode
```javascript
// ❌ WRONG - This is in production code
const ORTHANC_URL = "http://172.16.1.139:8042";
const API_PORT = 3000;
const PAYMENT_KEY = "sk_live_...";

// ✅ RIGHT - Load from environment
const ORTHANC_URL = process.env.ORTHANC_URL || 'http://localhost:8042';
const API_PORT = process.env.API_PORT || 3000;
const PAYMENT_KEY = process.env.PAYMENT_KEY;
```

### Why This Matters
- Your system runs in different environments (local, Synology NAS, future cloud)
- Hardcoding breaks portability and requires code changes for each environment
- Security: credentials in code are exposed to git history and developers
- Flexibility: admins can change settings without code changes

---

## 📁 How Files Are Used in Workflow

### Developer Starting New Feature
1. Read **DEVELOPMENT_PRINCIPLES.md** → understand the rules
2. Read **CONTRIBUTING.md** → understand workflow
3. Check **CONFIG_GUIDE.md** → if adding configuration

### DevOps/SysAdmin Deploying Care ERP
1. Copy `.env.example` → `.env`
2. Read **CONFIG_GUIDE.md** → fill in all values
3. Read "Validation Checklist" → verify everything works
4. Deploy and monitor

### Code Reviewer Reviewing PRs
1. Check **DEVELOPMENT_PRINCIPLES.md** → verify principles followed
2. Check **CONTRIBUTING.md** → verify commit/PR quality
3. Look for hardcoded values → refer to **CONFIG_GUIDE.md** if found

### Onboarding New Developer
1. Read **DEVELOPMENT_PRINCIPLES.md** (30 min)
2. Read **CONTRIBUTING.md** (10 min)
3. Skim **CONFIG_GUIDE.md** (5 min reference)
4. Ready to code!

---

## 🚫 What You Cannot Do

**These are strictly off-limits without explicit approval:**

### Business Logic
- ❌ Modify billing calculations
- ❌ Change patient registration workflow
- ❌ Alter payment processing
- ❌ Modify financial reconciliation

### Security & Permissions
- ❌ Change user role definitions
- ❌ Modify access control
- ❌ Alter authentication flow
- ❌ Change permission assignments

### Data Management
- ❌ Remove data retention policies
- ❌ Modify backup strategies
- ❌ Change audit logging

**Why?** These are business-critical and healthcare-regulated. Changes affect real patient care and legal compliance.

---

## ✅ What You Should Do

### Before Starting Code
1. **Understand existing implementation**
   - Read the relevant code
   - Understand why it works this way
   - Ask questions if unclear

2. **Prefer enhancement over redesign**
   - Make the current system better
   - Don't rewrite just for style preferences
   - Redesigns introduce risk

3. **Plan for reusability**
   - Design components others can use
   - Think long-term
   - Build for AI-readiness where appropriate

### During Development
1. **Use environment variables**
   - Add to `.env.example` with comments
   - Update **CONFIG_GUIDE.md**
   - Never hardcode anything

2. **Test thoroughly**
   - Run `pnpm test` ✅ (must pass)
   - Run `pnpm typecheck` ✅ (must pass)
   - Test on Docker locally
   - Test on target environment if possible

3. **Write clear commits**
   - Explain *why* you changed something
   - Keep commits focused
   - Reference issues if applicable

### Before Committing
1. All tests pass
2. No hardcoded values
3. Backward compatible
4. Configuration documented
5. Clear commit message

---

## 🔄 Configuration Update Workflow

### Adding a New Setting

**Step 1:** Document in `.env.example`
```env
# New Feature Settings
NEW_FEATURE_ENABLED=true
NEW_FEATURE_TIMEOUT=30
```

**Step 2:** Load in code
```typescript
const isEnabled = process.env.NEW_FEATURE_ENABLED === 'true';
const timeout = parseInt(process.env.NEW_FEATURE_TIMEOUT || '30');
```

**Step 3:** Document in CONFIG_GUIDE.md
```markdown
## New Feature Configuration

### Enable/Disable
\`\`\`env
NEW_FEATURE_ENABLED=true
NEW_FEATURE_TIMEOUT=30  # seconds
\`\`\`
```

**Step 4:** Update DEVELOPMENT_PRINCIPLES.md if it's important
- Only for architectural settings
- Link to CONFIG_GUIDE.md for details

**Step 5:** Commit
```
Feature: Add new feature configuration

- Added NEW_FEATURE_ENABLED and NEW_FEATURE_TIMEOUT to .env
- Updated CONFIG_GUIDE.md with documentation
- Follows principle: all configuration externalized
```

---

## 🏥 Healthcare Production Context

Care ERP serves **real diagnostic centers** with **real patient data**. This is not a hobby project.

### What This Means
- **Reliability:** Features must work correctly every time
- **Security:** Patient data must be protected
- **Compliance:** Healthcare regulations must be followed
- **Backward Compatibility:** Existing workflows must never break
- **Audit Trail:** Changes must be documented and traceable

### Making Changes Safely
1. Understand the current system thoroughly
2. Make minimal, focused changes
3. Test extensively before production
4. Keep clear documentation
5. Be able to explain your reasoning

---

## ⚡ Quick Reference: The 10 Commandments of Care ERP Development

1. **Understand first** — Read code before changing it
2. **Enhance, don't redesign** — Make it better, don't rewrite it
3. **Keep it working** — Don't remove features without replacement
4. **Never hardcode** — Everything goes in .env or settings
5. **Respect constraints** — Billing, payments, permissions are off-limits
6. **Build reusable** — Think long-term, not just this feature
7. **Stay compatible** — Existing workflows must continue working
8. **Verify infrastructure** — Check before assuming
9. **Test thoroughly** — All tests must pass before commit
10. **Document clearly** — Why you changed something, not how

---

## 📚 Related Files

- `.env.example` — Environment configuration template (start here for deployment)
- `docker-compose.yml` — Service definitions (Orthanc, PostgreSQL, etc.)
- `apps/api-server/` — Backend API code
- `apps/diagnostic-erp/` — Frontend React code
- `lib/db/src/schema/` — Database table definitions

---

## Getting Help

### I'm confused about...

**"Can I change X?"**
→ See DEVELOPMENT_PRINCIPLES.md "Prohibited Modifications" section

**"How do I add a configuration option?"**
→ See CONFIG_GUIDE.md "How to Set Configuration" section

**"What's the workflow for PRs?"**
→ See CONTRIBUTING.md "Pull Requests" section

**"What environment variables exist?"**
→ See CONFIG_GUIDE.md "Quick Reference" table

**"I want to understand the system better"**
→ Read DEVELOPMENT_PRINCIPLES.md "Architecture & Component Design"

---

## File Versions & Updates

| File | Last Updated | Version | Notes |
|------|-------------|---------|-------|
| DEVELOPMENT_PRINCIPLES.md | July 2, 2026 | 1.0 | Foundation document |
| CONTRIBUTING.md | July 2, 2026 | 1.0 | Developer workflow |
| CONFIG_GUIDE.md | July 2, 2026 | 1.0 | Complete reference |
| .env.example | July 2, 2026 | Enhanced | Added security warnings |

---

## Next Steps

### For Developers
1. Read DEVELOPMENT_PRINCIPLES.md (now)
2. Read CONTRIBUTING.md (before first PR)
3. Reference CONFIG_GUIDE.md as needed

### For DevOps
1. Read CONFIG_GUIDE.md (deployment checklist)
2. Copy .env.example → .env
3. Configure for your environment
4. Validate before production

### For Team Leads
1. Ensure all developers read DEVELOPMENT_PRINCIPLES.md
2. Reference these files during code reviews
3. Update files as standards evolve

---

*Last Updated: July 2, 2026*
*Care ERP Version: Production*
