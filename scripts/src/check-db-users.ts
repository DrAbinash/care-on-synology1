import pg from "pg";

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: "postgres://postgres:postgres@localhost:5432/postgres" });
  try {
    await client.connect();
    const res = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false;");
    console.log("Databases in postgres server:");
    console.table(res.rows);
    
    // Now let's inspect the tables of each database if we can, or just print them.
    for (const row of res.rows) {
      const dbName = row.datname;
      if (dbName === "postgres" || dbName.startsWith("pg_")) continue;
      
      const dbClient = new Client({ connectionString: `postgres://postgres:postgres@localhost:5432/${dbName}` });
      try {
        await dbClient.connect();
        const tablesRes = await dbClient.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';");
        console.log(`\nTables in ${dbName}:`);
        console.table(tablesRes.rows);
        
        // Check if users table exists
        const hasUsers = tablesRes.rows.some((r: any) => r.table_name === "users");
        if (hasUsers) {
          const usersRes = await dbClient.query("SELECT id, name, email, role, pin, is_active FROM users;");
          console.log(`Users in ${dbName}:`);
          console.table(usersRes.rows);
        }
        await dbClient.end();
      } catch (err: any) {
        console.error(`Failed to read db ${dbName}: ${err.message}`);
        try { await dbClient.end(); } catch {}
      }
    }
    await client.end();
  } catch (err: any) {
    console.error("Failed to connect:", err.message);
  }
}

main().catch(console.error);
