const { Pool } = require("../lib/db/node_modules/pg");

async function main() {
  const connectionString = "postgresql://erp:changeme@100.65.255.115:5400/diagnostic_erp";
  console.log(`Connecting to database at ${connectionString}...`);
  
  const pool = new Pool({ connectionString });
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS "radiology_config_changes" (
        "id" serial PRIMARY KEY,
        "key" text NOT NULL,
        "category" text NOT NULL,
        "old_value" text,
        "new_value" text,
        "reason" text,
        "changed_by" integer,
        "changed_by_name" text,
        "changed_at" timestamp with time zone NOT NULL DEFAULT now()
      );
    `;
    console.log("Executing query...");
    await pool.query(query);
    console.log("Table radiology_config_changes created successfully!");
  } catch (err) {
    console.error("DB Query error:", err.message);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
