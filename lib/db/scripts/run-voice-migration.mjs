import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = readFileSync(
  path.join(__dirname, "../drizzle/voice_tables_migration.sql"),
  "utf8"
);

const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 30000 });

async function main() {
  console.log("Connecting to:", DATABASE_URL?.replace(/:([^:@]+)@/, ":***@"));
  await client.connect();
  console.log("Connected. Running migration...\n");
  const result = await client.query(sql);
  // result is array of results for multi-statement SQL
  const rows = Array.isArray(result) ? result.at(-1)?.rows : result.rows;
  if (rows?.length) {
    console.log("\nVerification:");
    for (const row of rows) {
      console.log(`  ✅ ${row.table_name}: ${row.row_count} rows`);
    }
  }
  console.log("\n✅ Migration complete.");
  await client.end();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
