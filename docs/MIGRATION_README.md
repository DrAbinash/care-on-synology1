# Database Migrations & Production Deployment Guide

This guide explains how to manage database schema updates (migrations) and perform automated production deployments using the built-in non-interactive workflows.

---

## 🛠️ How it Works

Drizzle ORM is used for database schemas. The project uses standard SQL-based migrations generated from your TypeScript schemas.

1. **Local Schema Development**: The developer updates TypeScript files in `lib/db/src/schema/`.
2. **Migration Generation**: The developer runs the generate tool locally to generate SQL files inside the `lib/db/drizzle/` directory.
3. **Seeding (On-Premises / Production)**: To ensure that the existing live database tables (which were previously initialized without a migrations table) can adopt the Drizzle migrator safely without errors, our custom migration runner (`db-deploy.ts`) detects if the core database tables exist but the migration log table (`drizzle.__drizzle_migrations`) is empty. If so, it seeds the migration table to mark existing SQL files (`0000` to `0004`) as completed.
4. **Non-interactive Application**: Standard Drizzle ORM migrator runs all pending migrations sequentially.

---

## 💻 Commands

### 1. Generate Migrations (Development Only)
Run this command locally after modifying any TypeScript files in `lib/db/src/schema/`. This will generate SQL migration files and metadata in `lib/db/drizzle/`.
```bash
pnpm db:generate
```
*Note: If drizzle-kit cannot determine if a column was renamed or newly created, it will prompt you in the terminal. Answer these prompts and commit the resulting SQL/JSON files to your repository.*

### 2. Deploy Migrations (Non-Interactive)
Run this command in production or local environments to apply all pending migrations from the `lib/db/drizzle/` folder to the target database. It is 100% non-interactive.
```bash
pnpm db:deploy
```
*This requires `DATABASE_URL` (or the `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_HOST_PORT`, `DB_NAME` environment variables) to be set.*

### 3. Automated Synology Deployment
To update the application, apply database schema changes, and restart the production container stack on the Synology NAS:
```bash
./deploy-synology.sh
```

---

## 🛡️ Production Safety & Backups

Before running any automatic database changes on production:
1. **Take a Database Backup**: Always export a database dump before applying migrations.
   ```bash
   pg_dump -h <host> -U erp -d diagnostic_erp > db_backup_before_migration.sql
   ```
2. **No Automatic Destructive Changes**: Drizzle Kit generate/migrate will not drop tables or columns unless explicitly written in the migration SQL files.
3. **Environment Telemetry**: The migration runner prints database details (host, database name, masked password) and the environment name before starting. Double-check this output to confirm you are targeting the correct database.
