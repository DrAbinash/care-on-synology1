# Care ERP Development Principles

**Care ERP** is a **production diagnostic center ERP system** serving real healthcare operations. Every change must respect this production context and the trust placed in this system.

---

## Core Development Philosophy

### Always Understand Before Modifying
- Read existing implementation first
- Understand why code exists as it does
- Ask questions if logic is unclear
- Never assume; verify actual behavior

### Prefer Enhancement Over Redesign
- Small, focused improvements beat big rewrites
- Build on what works
- Incremental progress is safer and faster
- Redesigns introduce risk

### Do Not Remove Working Functionality
Unless replacing it with a **demonstrably better implementation**:
- Same or better performance
- Same or better reliability
- Same or better user experience
- Full backward compatibility

---

## Hard Constraints: Never Hardcode

These must **always** be configurable via environment variables or admin settings UI:

❌ **DO NOT HARDCODE:**
- LAN IP addresses (e.g., `172.16.1.139`)
- Port numbers (e.g., `3000`, `5432`, `8042`)
- API keys or credentials
- DICOM viewer URLs (OHIF, Weasis)
- Payment gateway credentials
- PACS/Orthanc configuration
- DICOM settings

✅ **USE INSTEAD:**
- Environment variables (`.env`)
- Admin settings database table
- Configuration management UI
- Runtime configuration loading

**Why?** Your system runs on different networks and environments. Hardcoding breaks portability and security.

---

## Prohibited Modifications

**NEVER modify these without explicit approval.**
See `/PROTECTED_FILES.md` for the exact, maintained list of billing/payment
files (🔴), radiology/PACS files (🟡), and shared/core files (🟢) — that file
is the source of truth; the categories below summarize it.

### Business Logic (Do Not Touch)
- Billing calculations and formulas
- Patient registration workflow
- Payment gateway integrations
- Financial reconciliation logic

### Permissions & Security
- User role definitions
- Permission assignments
- Access control rules
- Authentication flow (unless fixing bugs)

**New authenticated GET endpoint that returns data scoped to the caller's own
identity (`req.staffSession.subjectId`, `req.portalSession.subjectId`, or
equivalent)?** The service worker (`artifacts/diagnostic-erp/public/sw.js`)
caches every `GET /api/*` response by URL alone — it cannot tell your
response apart from anyone else's. On a shared hospital workstation, that
means the next person to log in can be served YOUR cached data before their
own request completes. You must add the endpoint's full path to
`NETWORK_ONLY_PREFIXES` in `sw.js` — see the comment block there for how, and
`artifacts/api-server/src/routes/personalEndpointCacheGuard.test.ts`, which
fails CI automatically if you forget. (This is not a hypothetical: this
exact bug shipped once already — see git history for "Fix CRITICAL: service
worker leaks personal data across staff/patients…".)

### Existing Business Rules
- Appointment scheduling rules
- Test procedure workflows
- Report generation flow
- Data retention policies

**Why?** These are core to your diagnostic center's operations. Changes cascade and affect real healthcare workflows.

---

## Architecture & Component Design

### Design All New Modules as Reusable
- Create components that can be used in multiple places
- Abstract configuration to props or env vars
- Avoid hardcoding business logic into components
- Document expected inputs/outputs

### Integrate with Existing Architecture
- Don't create parallel implementations
- Use existing database schema and ORM
- Reuse existing API patterns
- Build on established libraries and patterns

### Future Features Should Be AI-Ready
- Structure data for AI processing
- Use consistent naming conventions
- Design schemas for extensibility
- Document data structures clearly

---

## Optimization Targets

The Care ERP system is optimized for and must remain compatible with:

- **Synology Docker** deployment
- **PostgreSQL** database
- **Orthanc** DICOM storage
- **OHIF** web viewer
- **Weasis** desktop DICOM viewer
- **Standard DICOM modalities** (CT, MRI, XR, US, etc.)
- **LAN deployment** (not cloud-dependent)

When implementing new features:
1. Verify compatibility with all above technologies
2. Test on Synology Docker environment
3. Ensure PostgreSQL queries work efficiently
4. Respect DICOM standards
5. Support local network deployment

---

## Backward Compatibility is Non-Negotiable

Before releasing any change:
- Ensure existing users/workflows still work
- Support old data formats (with migration if needed)
- Don't break API contracts
- Document any deprecations clearly
- Provide migration guides if database changes

---

## User Interface Principles

### For All UI Components
- **Modern** — Current design patterns, not dated
- **Compact** — Efficient use of screen space
- **Professional** — Enterprise healthcare appearance
- **Minimal scrolling** — Information fits naturally
- **Responsive** — Works on desktop, tablet, mobile
- **Healthcare-focused** — Familiar to medical professionals

### Implementation
- Use existing design system if available
- Follow established component patterns
- Respect dark/light mode settings
- Ensure sufficient contrast for readability
- Mobile-first responsive design

---

## New Features Checklist

Before building any new feature:

### Design Phase
- [ ] Understand existing related modules
- [ ] Plan for reusability
- [ ] Design for extensibility
- [ ] Consider AI-readiness
- [ ] Sketch integration points

### Implementation
- [ ] Use environment variables for configuration
- [ ] Follow existing code patterns
- [ ] Add comprehensive tests
- [ ] Document any new concepts
- [ ] Consider long-term maintenance
- [ ] New GET endpoint returns caller-identity-scoped data? Add it to
      `NETWORK_ONLY_PREFIXES` in `sw.js` (see Permissions & Security above)

### Validation
- [ ] All tests pass locally
- [ ] Type checking passes
- [ ] Works on Synology Docker
- [ ] Backward compatible
- [ ] Configuration documented

### Before Commit
- [ ] Clear commit message explaining *why*
- [ ] Reasonable scope (single feature)
- [ ] No unnecessary changes
- [ ] Ready for production deployment

---

## Existing Infrastructure Must Be Verified

Before implementing new features:

1. **Check what exists** — Read current code thoroughly
2. **Understand dependencies** — What services does it rely on?
3. **Verify compatibility** — Will it work with Synology, PostgreSQL, Orthanc?
4. **Test integration** — Does it play nicely with existing features?
5. **Plan deployment** — How will it be configured in production?

Don't assume an infrastructure exists. Always verify.

---

## Refactoring Guidelines

Only refactor when it clearly improves:
- **Maintainability** — Code is easier to understand/modify
- **Performance** — Measurable speed improvements
- **Reliability** — Fewer bugs, better error handling

Do not refactor for:
- Personal code style preferences
- Theoretical purity
- Microoptimizations with negligible impact

### Before Refactoring
1. Have clear success metrics
2. Write tests first (if not existing)
3. Refactor in small steps
4. Verify each step doesn't break functionality
5. Document the improvements

---

## Testing & Quality

### Required Before Any Commit
- [ ] `pnpm test` passes (all 164+ tests)
- [ ] `pnpm typecheck` completes (acceptable error baseline)
- [ ] No new linting errors
- [ ] Feature works as intended

### For Production Code
- Always write tests for new features
- Update existing tests if behavior changes
- Test edge cases and error scenarios
- Verify on actual Synology Docker environment

---

## Documentation

### When to Write
- **Always:** For any new configuration variable or parameter
- **Always:** For any new environment variable requirement
- **Often:** For complex business logic
- **Rarely:** For obvious, self-documenting code

### What to Document
- Purpose of code block or function
- Configuration requirements
- Known limitations
- Integration points with other modules

### What NOT to Document
- How obvious code works (if it's obvious, it doesn't need explaining)
- Implementation details of private functions
- Temporary workarounds (remove instead of documenting)

---

## Deployment Checklist

### Before pushing to production:

1. **Code Review**
   - [ ] Changes align with principles
   - [ ] No hardcoded values
   - [ ] Tests pass
   - [ ] Types check

2. **Testing**
   - [ ] Local: Works on development machine
   - [ ] Docker: Works in Docker container
   - [ ] Database: Migrations work correctly
   - [ ] Integration: Works with other services

3. **Configuration**
   - [ ] All required env vars documented
   - [ ] Admin settings UI updated (if needed)
   - [ ] Default values sensible

4. **Monitoring**
   - [ ] Error logging in place
   - [ ] Health checks updated (if needed)
   - [ ] Performance acceptable

5. **Documentation**
   - [ ] Changes documented
   - [ ] Configuration steps clear
   - [ ] Rollback plan if needed

---

## Summary: The Care ERP Way

1. **Understand first** — Read existing code before changing
2. **Enhance, don't redesign** — Small improvements beat rewrites
3. **Keep it working** — Don't remove what's not broken
4. **Never hardcode** — Everything goes in .env or settings
5. **Respect constraints** — Billing, payments, permissions are hands-off
6. **Build reusable** — Think long-term, not just this sprint
7. **Stay compatible** — Existing workflows must continue working
8. **Verify infrastructure** — Check before assuming
9. **Write for production** — This is real healthcare software
10. **Think like a doctor** — Reliability > features

---

## When In Doubt

1. Ask a clarifying question
2. Read existing similar implementations
3. Write a small test to understand behavior
4. Propose change, wait for feedback
5. Implement conservatively

**Never assume. Always verify.**

---

*Last Updated: July 2, 2026*
*Repository: DrAbinash/care-on-synology1*
