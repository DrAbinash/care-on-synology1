const { Client } = require('pg');
const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from ../../.env or .env in root
const rootEnvPath = path.join(__dirname, '../../.env');
if (fs.existsSync(rootEnvPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(rootEnvPath));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const connectionUrls = [
  // constructed from env
  `postgres://${process.env.DB_USER || 'erp'}:${process.env.DB_PASSWORD || 'changeme'}@localhost:${process.env.DB_HOST_PORT || 5400}/${process.env.DB_NAME || 'diagnostic_erp'}`,
  // standard fallback
  'postgres://postgres:postgres@localhost:5432/diagnostic_erp',
  // standard replit/dev environment
  process.env.DATABASE_URL
].filter(Boolean);

async function run() {
  for (const dbUrl of connectionUrls) {
    console.log('Trying to connect to:', dbUrl.replace(/\/\/.*@/, '//***:***@'));
    const client = new Client({ connectionString: dbUrl });
    try {
      await client.connect();
      console.log('Connected successfully!');
      
      const checkRes = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'default_start_page';
      `);
      
      if (checkRes.rows.length === 0) {
        console.log('default_start_page column does not exist. Adding it...');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS default_start_page text;');
        console.log('default_start_page column added successfully.');
      } else {
        console.log('default_start_page column already exists.');
      }
      await client.end();
      break; // Success, stop trying other URLs
    } catch (err) {
      console.error('Failed to connect or query with this URL:', err.message);
      try {
        await client.end();
      } catch (e) {}
    }
  }
}

run();
