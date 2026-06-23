const { Pool } = require('pg');

async function check() {
  const connectionString = 'postgresql://erp:changeme@100.65.255.115:5400/diagnostic_erp';
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'clinic_settings'
      ORDER BY column_name;
    `);
    console.log("=== CLINIC SETTINGS COLUMNS ===");
    res.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}`);
    });
  } catch (err) {
    console.error("Database connection failed:", err.message);
  } finally {
    await pool.end();
  }
}

check();
