import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve DATABASE_URL from process.env or build from pieces (compatible with Synology/Docker env vars)
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  const user = process.env.DB_USER || "erp";
  const password = process.env.DB_PASSWORD || "changeme";
  const host = process.env.DB_HOST || "db";
  const port = process.env.DB_HOST_PORT || "5432";
  const dbName = process.env.DB_NAME || "diagnostic_erp";
  connectionString = `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

if (!connectionString) {
  console.error("❌ Error: DATABASE_URL or database environment variables are not set.");
  process.exit(1);
}

// Security: parse connection details to show environment, masking the password
function printSafeEnvironment(connStr: string) {
  try {
    const url = new URL(connStr.replace("postgresql://", "http://").replace("postgres://", "http://"));
    const host = url.host;
    const dbName = url.pathname.replace("/", "");
    const user = url.username;
    console.log("==========================================");
    console.log("🛠️   DATABASE DEPLOYMENT TELEMETRY");
    console.log("==========================================");
    console.log(`Database Host: ${host}`);
    console.log(`Database Name: ${dbName}`);
    console.log(`Database User: ${user}`);
    console.log(`Environment:   ${process.env.NODE_ENV || "development"}`);
    console.log("==========================================\n");
  } catch {
    console.log("Database connection: Custom format (masked)");
  }
}

async function run() {
  printSafeEnvironment(connectionString!);

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (err: any) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }

  try {
    // 1. Cleanup old public migrations table if it exists (from previous incorrect runs)
    await client.query(`DROP TABLE IF EXISTS "public"."__drizzle_migrations";`);

    // 2. Ensure drizzle schema exists
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);

    // 3. Check if the Drizzle migrations table exists in the drizzle schema
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'drizzle' 
        AND table_name = '__drizzle_migrations'
      );
    `);
    
    // In Drizzle, the table name is under the 'drizzle' schema by default.
    // If it doesn't exist, we'll check if the db already has tables. If it does, we must seed the migrations
    // table to mark existing migrations as completed so they are not run again.
    const hasMigrationTable = tableCheck.rows[0]?.exists;

    // Check if core tables already exist in public schema (indicating an existing database)
    const coreTableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'clinic_settings'
      );
    `);
    const hasCoreTables = coreTableCheck.rows[0]?.exists;

    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    const journalPath = path.join(migrationsFolder, "meta/_journal.json");
    
    if (!fs.existsSync(journalPath)) {
      throw new Error(`Can't find meta/_journal.json file at ${journalPath}`);
    }
    
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const entries = journal.entries || [];

    // Query current records in drizzle.__drizzle_migrations if it exists
    let seededCount = 0;
    if (hasMigrationTable) {
      const currentMigrations = await client.query(`SELECT hash FROM drizzle.__drizzle_migrations;`);
      seededCount = currentMigrations.rowCount || 0;
    }

    if (hasCoreTables && seededCount === 0) {
      console.log("ℹ️  Existing database detected but 'drizzle.__drizzle_migrations' is empty or missing.");
      console.log("⚙️  Creating 'drizzle.__drizzle_migrations' and seeding existing migration history...");

      // Create drizzle.__drizzle_migrations table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
          "id" serial PRIMARY KEY,
          "hash" text NOT NULL,
          "created_at" bigint
        );
      `);

      // Compute and insert the hashes for existing migrations to mark them as completed
      for (const entry of entries) {
        const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (fs.existsSync(migrationPath)) {
          const sqlContent = fs.readFileSync(migrationPath, "utf-8");
          const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");
          
          await client.query(
            `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2);`,
            [hash, entry.when]
          );
          console.log(`  ✓ Marked as completed: ${entry.tag}`);
        }
      }
      console.log("✓ Seeding complete. Existing migrations successfully registered.");
    }

    // 4. Run standard Drizzle Migrator to apply any new/pending migrations
    console.log("🚀 Running Drizzle migrator for pending changes...");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    
    console.log("✅ Database deployment completed successfully.");
  } catch (err: any) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
