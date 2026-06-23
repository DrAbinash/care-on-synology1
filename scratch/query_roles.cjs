const { Pool } = require('./lib/db/node_modules/pg');

async function check() {
  const connectionString = 'postgresql://erp:changeme@100.65.255.115:5400/diagnostic_erp';
  const pool = new Pool({ connectionString });
  try {
    const rolesRes = await pool.query(`SELECT DISTINCT role FROM users;`);
    console.log("=== DISTINCT ROLES IN users TABLE ===");
    console.log(rolesRes.rows);

    const permRolesRes = await pool.query(`SELECT DISTINCT role FROM role_permissions;`);
    console.log("=== DISTINCT ROLES IN role_permissions TABLE ===");
    console.log(permRolesRes.rows);
  } catch (err) {
    console.error("Database query failed:", err.message);
  } finally {
    await pool.end();
  }
}

check();
