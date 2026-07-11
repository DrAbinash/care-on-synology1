# Contributing to Care ERP

Thank you for contributing to Care ERP, a production diagnostic center management system.

---

## Quick Start

### Before You Code
1. Read **DEVELOPMENT_PRINCIPLES.md** (required!)
2. Understand the existing implementation
3. Check if something similar already exists
4. Ask questions before starting

### Making Changes
1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make small, focused changes
3. Test locally: `pnpm test`
4. Type check: `pnpm typecheck`
5. Commit with detailed message explaining *why*
6. Push and create PR

---

## The 5-Minute Rules

### ✅ DO
- Read existing code before modifying
- Use environment variables for all configuration
- Write tests for new features
- Keep changes small and focused
- Test on Docker before pushing
- Explain your reasoning in commit messages

### ❌ DON'T
- Hardcode IPs, ports, API keys, credentials
- Modify billing, payment, or permission logic
- Remove working features without replacement
- Create parallel implementations
- Refactor without clear improvement
- Commit without tests passing

---

## Commits Should Include

```
[Feature|Fix|Refactor] Short description

- What changed and why
- How existing code was affected
- Any configuration changes needed
- Any tests added or modified
```

**Example:**
```
Feature: Add DICOM download to reception command center

- Added download button to image list
- Uses existing DICOM storage API
- No database changes
- Added tests for download endpoint
- Requires no new configuration
```

---

## Configuration

### Adding a New Setting?

1. Add to `.env.example`:
   ```
   # FEATURE_NAME: Description
   FEATURE_NAME_SETTING=value
   ```

2. Load in code:
   ```typescript
   const setting = process.env.FEATURE_NAME_SETTING || 'default';
   ```

3. Document in CONTRIBUTING.md

### No Hardcoded:
- ❌ `const ip = "192.168.1.137"`
- ✅ `const ip = process.env.ORTHANC_HOST || 'localhost'`

---

## Testing

### Before Every Commit
```bash
pnpm test       # Must pass (164+ tests)
pnpm typecheck  # Review any new errors
```
Run `pnpm typecheck` from the repo root, not a filtered package command (e.g. `pnpm --filter @workspace/api-server run typecheck`) — the root script builds shared `lib/*` packages first, and skipping that step produces hundreds of misleading false-positive errors.

### Writing Tests
- Test new features
- Test edge cases
- Update existing tests if behavior changes
- Keep tests focused and readable

---

## Pull Requests

When you create a PR:

1. **Description** — Explain what changed and why
2. **Tests** — All tests pass locally
3. **Documentation** — Config changes documented
4. **Backward Compatible** — Existing workflows still work
5. **No Hardcoded Values** — All configurable

### PR Checklist
```
- [ ] Tested locally
- [ ] All tests pass
- [ ] Typecheck passes
- [ ] No hardcoded values
- [ ] Configuration documented
- [ ] Backward compatible
- [ ] Clear commit messages
```

---

## Common Scenarios

### "I want to change billing logic"
**No.** Billing is off-limits. See DEVELOPMENT_PRINCIPLES.md section "Prohibited Modifications."

### "Should I redesign the dashboard?"
**Enhancement first.** Make the current dashboard better before redesigning. See DEVELOPMENT_PRINCIPLES.md section "Prefer Enhancement Over Redesign."

### "How do I add a configuration option?"
1. Add to `.env.example` with comment
2. Load via `process.env.YOUR_OPTION`
3. Provide sensible default
4. Document the option

### "Can I remove this old code?"
**Only if** replacing it with something demonstrably better AND it's fully backward compatible.

### "I found a better library for X"
**Compare first:**
- Performance impact?
- Maintenance status?
- Break any existing code?
- Docker/Synology compatible?
- Then propose in an issue

---

## Deployment

Care ERP runs on:
- Synology Docker
- PostgreSQL database
- Orthanc DICOM storage
- OHIF/Weasis viewers
- Local network (LAN)

### Before Pushing to Production
1. Test in Docker: `docker-compose up`
2. Verify database migrations
3. Check configuration requirements
4. Ensure backward compatibility
5. Write clear deployment notes

---

## Questions?

1. Check **DEVELOPMENT_PRINCIPLES.md** first
2. Review similar existing code
3. Ask in an issue before starting major work
4. Read existing PR descriptions for patterns

---

## Code Style

### TypeScript
- Use types explicitly
- No `any` without comment
- Follow existing patterns
- Run typecheck before commit

### React
- Functional components
- Use hooks (React 19)
- Follow existing component structure
- Keep components reusable

### SQL/Drizzle ORM
- Use Drizzle ORM (not raw SQL)
- Write type-safe queries
- Add migrations for schema changes
- Test queries on PostgreSQL

---

## Maintenance

Care ERP is production software serving real healthcare operations. Your contribution helps doctors provide better patient care.

- Be conservative with changes
- Prioritize reliability over features
- Test thoroughly before deployment
- Document what you change

---

*Last Updated: July 2, 2026*
