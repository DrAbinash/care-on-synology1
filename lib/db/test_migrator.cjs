const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { migrate } = require("drizzle-orm/node-postgres/migrator");
const path = require("path");

async function run() {
  const adminPool = new Pool({
    connectionString: "postgresql://erp:changeme@100.65.255.115:5400/postgres"
  });
  
  try {
    console.log("Re-creating temporary database test_migrations_db...");
    await adminPool.query("DROP DATABASE IF EXISTS test_migrations_db;");
    await adminPool.query("CREATE DATABASE test_migrations_db;");
  } catch (err) {
    console.error("Failed to setup test db:", err.message);
    await adminPool.end();
    return;
  }
  await adminPool.end();

  const testPool = new Pool({
    connectionString: "postgresql://erp:changeme@100.65.255.115:5400/test_migrations_db"
  });
  
  try {
    const db = drizzle(testPool);
    console.log("Running migrator... this may take up to 30 seconds due to network roundtrips...");
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "./drizzle") });
    
    console.log("Querying __drizzle_migrations table...");
    const res = await testPool.query("SELECT * FROM __drizzle_migrations ORDER BY id ASC;");
    console.log("=== MIGRATIONS TABLE CONTENT ===");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("Migration failed:", err.message);
  } finally {
    await testPool.end();
    
    // Clean up
    const adminPool2 = new Pool({
      connectionString: "postgresql://erp:changeme@100.65.255.115:5400/postgres"
    });
    await adminPool2.query("DROP DATABASE IF EXISTS test_migrations_db;");
    await adminPool2.end();
    console.log("Cleaned up test database.");
  }
}

run();
