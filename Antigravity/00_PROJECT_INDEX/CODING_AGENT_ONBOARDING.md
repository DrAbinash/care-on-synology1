# Coding Agent Onboarding Guide

Welcome! This guide is designed to make any future AI agent or developer fully productive in this codebase within 30 minutes.

---

## 1. Local Development Setup
- **Dependencies**: Install dependencies at the workspace root:
  ```bash
  pnpm install
  ```
- **Database Connection**: Set `DATABASE_URL` in `.env` to point to the local or NAS PostgreSQL database.
- **Typechecking**:
  ```bash
  pnpm run typecheck
  ```
- **Vite Dev Server**:
  ```bash
  pnpm run dev
  ```

---

## 2. Coding Conventions & Best Practices
- **Do not bypass Drizzle schemas**: Modify files under `lib/db/src/schema/` first and run raw SQL migrations on the target DB immediately if the environment is locked or remote.
- **Maintain comments**: Do not remove existing comments/docstrings.
- **Aesthetics & Premium UI**: Use Tailwind and Radix primitives. Build visually premium widgets with curated CSS gradients.
- **Safety Rule**: Keep AI actions editable. Radiologists must review and manually sign drafts before finalizing.

---

## 3. Database Migration Restore Procedures
- If the Synology schema becomes out of sync, locate the backup dump files in the root directory:
  - `current_schema_backup.sql`
  - `current_data_backup.sql`
- Restore using `psql`:
  ```bash
  psql -U erp -d diagnostic_erp -f current_schema_backup.sql
  ```
