const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5432/diagnocenter' });
  try {
    await client.connect();
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
