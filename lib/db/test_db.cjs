const { Pool } = require('pg');

async function check() {
  const connectionString = 'postgresql://erp:changeme@100.65.255.115:5400/diagnostic_erp';
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(`SELECT id, name, username, role, permissions FROM users;`);
    console.log("=== USERS IN DATABASE ===");
    console.log(res.rows);
  } catch (err) {
    console.error("Database connection failed:", err.message);
  } finally {
    await pool.end();
  }
}

check();
