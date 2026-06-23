const { Client } = require('pg');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from ../../.env
if (fs.existsSync('../../.env')) {
  const envConfig = dotenv.parse(fs.readFileSync('../../.env'));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/diagnostic_erp';

async function run() {
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const res = await client.query('SELECT icici_merchant_id, icici_aggregator_id, icici_secret_key, gateway, online_booking_enabled FROM clinic_settings LIMIT 1;');
    console.log('Result:', res.rows[0]);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
