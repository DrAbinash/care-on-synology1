import "dotenv/config";
import { randomInt } from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * Super-admin PIN reset — EMERGENCY RECOVERY TOOL.
 *
 * Audit finding F-15: this script used to reset the most privileged account
 * to the hardcoded four-digit PIN '1234' with mustChangePin set to FALSE and
 * no post-recovery warning. Super-admins are exempt from the LAN-only login
 * restriction, so a leftover reset left the owner account remotely attackable
 * with a trivial PIN, indefinitely.
 *
 * Now: the PIN is either passed explicitly (--pin, validated) or generated
 * with the crypto RNG (6 digits, unbiased), mustChangePin is forced TRUE so
 * the next login demands a rotation, and the operator is told — in the
 * terminal — that this credential must be changed as soon as access is
 * regained. If DATABASE_URL points at anything that is not the approved
 * development database, the operator should already be unable to start the
 * server; this file adds no second guard of its own.
 */

const DEFAULT_EMAIL = "abinashsingh@gmail.com";
const PIN_PATTERN = /^\d{4,8}$/;

interface Args {
  email: string;
  pin: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { email: DEFAULT_EMAIL, pin: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email" && argv[i + 1]) {
      args.email = argv[++i];
    } else if (a === "--pin" && argv[i + 1]) {
      args.pin = argv[++i];
    } else if (a.startsWith("--email=")) {
      args.email = a.slice("--email=".length);
    } else if (a.startsWith("--pin=")) {
      args.pin = a.slice("--pin=".length);
    } else {
      console.error(`Unknown argument: ${a}`);
      console.error("usage: tsx scripts/src/reset-admin-pin.ts [--email <email>] [--pin <4-8 digits>]");
      process.exit(2);
    }
  }
  return args;
}

/** 6 digits from the crypto RNG — uniform, never a "memorable" default. */
function generatePin(): string {
  return String(100000 + randomInt(0, 900000));
}

function printRotationWarning(email: string) {
  const line = "=".repeat(72);
  console.log(`
${line}
RECOVERY CREDENTIAL — ROTATE IMMEDIATELY AFTER USE
${line}
The account ${email} is now a super_admin with every module permission
and must_change_pin = TRUE. Super-admins are exempt from LAN-only login,
so until the PIN is changed this is the single most privileged, remotely
reachable credential in the system.

Change the PIN from the app (the next login will force it), and never
leave a recovery PIN in place after access has been regained.
${line}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  let pin = args.pin;

  if (pin != null) {
    if (!PIN_PATTERN.test(pin)) {
      console.error(`Refusing --pin '${pin}': must be 4-8 digits.`);
      console.error("Omit --pin to have the script generate a strong random PIN instead.");
      process.exit(2);
    }
    if (pin.length < 6) {
      console.warn(
        `WARNING: a ${pin.length}-digit PIN is trivially brute-forceable. ` +
          "The app's lockout throttles attempts, but a longer PIN is strongly recommended.",
      );
    }
  } else {
    pin = generatePin();
  }

  console.log(`Resetting PIN for ${email}.`);
  console.log(
    `One-time recovery PIN (shown once, will be forced to rotate at next login): ${pin}`,
  );

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
        // F-15 (audit): forced rotation — the old script switched this OFF,
        // which left the hardcoded '1234' in place indefinitely.
        mustChangePin: true,
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
      mustChangePin: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    console.log(`User ${email} did not exist. Seeded new super_admin user.`);
  }

  printRotationWarning(email);

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to reset PIN:", err);
  process.exit(1);
});
