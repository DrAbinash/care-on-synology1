import pg from "pg";
import { BOOTSTRAP_SQL } from "./schema";

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL must be set for Emergency Billing (dedicated DS225+ database)");
}

export const pool = new Pool({
  connectionString: url,
  max: 10,
  application_name: "care-emergency-billing",
});

pool.on("error", (err) => {
  const safe = err.message.replace(/postgres(?:ql)?:\/\/[^@]+@[^\s/]*/gi, "postgres://***");
  console.error("[emergency-db]", safe);
});

export async function bootstrapSchema(): Promise<void> {
  await pool.query(BOOTSTRAP_SQL);
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('master_data_last_synced_at', '')
     ON CONFLICT (key) DO NOTHING`,
  );
  const user = process.env.EMERGENCY_BOOTSTRAP_USERNAME?.trim().toLowerCase();
  const pin = process.env.EMERGENCY_BOOTSTRAP_PIN;
  if (user && pin) {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM cached_staff`);
    if (Number(rows[0]?.n || 0) === 0) {
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash(pin, 12);
      await pool.query(
        `INSERT INTO cached_staff (id, name, username, role, pin_hash, max_discount)
         VALUES (0, 'Owner (bootstrap)', $1, 'super_admin', $2, 100)`,
        [user, hash],
      );
      console.warn("[emergency] seeded bootstrap owner from EMERGENCY_BOOTSTRAP_* (empty staff cache only)");
    }
  }
}
