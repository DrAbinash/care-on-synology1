import "dotenv/config";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
  const email = "abinashsingh@gmail.com";
  const pin = "1234";
  console.log(`Resetting PIN for ${email} to ${pin}...`);

  // 1. Dynamic schema synchronization for users table
  console.log("Ensuring users table schema is in sync with codebase...");
  
  // List of columns we must ensure exist
  const columnsToSync = [
    { name: "username", def: "username TEXT" },
    { name: "photo_data_url", def: "photo_data_url TEXT" },
    { name: "sidebar_theme", def: "sidebar_theme TEXT" },
    { name: "dicom_presets", def: "dicom_presets JSONB" },
    { name: "must_change_pin", def: "must_change_pin BOOLEAN NOT NULL DEFAULT FALSE" },
    { name: "remote_login_enabled", def: "remote_login_enabled BOOLEAN NOT NULL DEFAULT FALSE" },
    { name: "max_concurrent_sessions", def: "max_concurrent_sessions INTEGER NOT NULL DEFAULT 0" },
    { name: "failed_login_attempts", def: "failed_login_attempts INTEGER NOT NULL DEFAULT 0" },
    { name: "locked_until", def: "locked_until TIMESTAMPTZ" },
    { name: "is_active", def: "is_active BOOLEAN NOT NULL DEFAULT TRUE" },
    { name: "max_discount", def: "max_discount NUMERIC(5,2)" }
  ];

  for (const col of columnsToSync) {
    try {
      await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.def};`));
    } catch (err: any) {
      console.warn(`Could not add column ${col.name}: ${err.message}`);
    }
  }

  try {
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);`);
  } catch (err: any) {
    console.warn(`Could not create unique index on username: ${err.message}`);
  }

  // 2. Hash and update PIN
  const hash = await bcrypt.hash(pin, 12);

  const allModulePermissions = [
    "/", "/patients", "/orders", "/register", "/billing", "/doctors",
    "/report-generator", "/referrals", "/discounts", "/tests", "/payments",
    "/reports", "/inventory", "/accounting", "/settings",
  ];
  const permissionsJson = JSON.stringify(allModulePermissions);

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(usersTable)
      .set({
        role: "super_admin",
        permissions: permissionsJson,
        pin: hash,
        isActive: true,
        mustChangePin: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(usersTable.email, email));
    console.log(`PIN successfully updated in database for ${email}.`);
  } else {
    await db.insert(usersTable).values({
      name: "Dr Abinash Kumar",
      email,
      role: "super_admin",
      permissions: permissionsJson,
      pin: hash,
      isActive: true,
      mustChangePin: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    console.log(`User ${email} did not exist. Seeded new super_admin user.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to reset PIN:", err);
  process.exit(1);
});