import { describe, it, expect } from "vitest";
const fs = require("fs");
const path = require("path");
const { defaultLiteralForType } = require("./db-schema-verify.cjs");

// Regression coverage for the incident where care-db-patch-v2 schema
// verification failed because payment_logs.amount and .error_message
// were missing on the live Synology DB, and `--repair` mode generated
// invalid SQL (`numeric ... DEFAULT ''`) trying to fix it.

describe("db-schema-verify repair-mode defaults", () => {
  it("never uses an empty-string default for numeric/decimal columns", () => {
    expect(defaultLiteralForType("numeric(10, 2)")).toBe("0");
    expect(defaultLiteralForType("numeric")).toBe("0");
    expect(defaultLiteralForType("integer")).toBe("0");
    expect(defaultLiteralForType("bigint")).toBe("0");
    expect(defaultLiteralForType("real")).toBe("0");
  });

  it("uses type-appropriate defaults for other common families", () => {
    expect(defaultLiteralForType("boolean")).toBe("false");
    expect(defaultLiteralForType("jsonb")).toBe("'{}'::jsonb");
    expect(defaultLiteralForType("timestamp with time zone")).toBe("now()");
  });

  it("still defaults to an empty string for text columns", () => {
    expect(defaultLiteralForType("text")).toBe("''");
    expect(defaultLiteralForType("varchar(50)")).toBe("''");
  });
});

describe("payment_logs schema stays in sync with amount/error_message", () => {
  const indexTs = fs.readFileSync(
    path.join(__dirname, "../artifacts/api-server/src/index.ts"),
    "utf8"
  );
  const drizzleSchema = fs.readFileSync(
    path.join(__dirname, "../lib/db/src/schema/paymentLogs.ts"),
    "utf8"
  );

  it("Drizzle source schema declares amount and errorMessage", () => {
    expect(drizzleSchema).toMatch(/amount:\s*numeric/);
    expect(drizzleSchema).toMatch(/errorMessage:\s*text/);
  });

  it("API startup migrations backfill amount and error_message with idempotent ALTER TABLE statements", () => {
    // Guards against the exact drift that broke care-db-patch-v2: an old
    // CREATE TABLE IF NOT EXISTS payment_logs (...) predating these columns
    // means CREATE TABLE alone can never add them to an existing table.
    expect(indexTs).toMatch(
      /ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS amount NUMERIC\(10, ?2\) NOT NULL DEFAULT 0;/
    );
    expect(indexTs).toMatch(
      /ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS error_message TEXT;/
    );
  });
});

describe("radiology_worklist accession_number is no longer a unique/required field", () => {
  const indexTs = fs.readFileSync(
    path.join(__dirname, "../artifacts/api-server/src/index.ts"),
    "utf8"
  );
  const worklistSchema = fs.readFileSync(
    path.join(__dirname, "../lib/db/src/schema/radiologyWorklist.ts"),
    "utf8"
  );

  it("Drizzle source no longer marks accessionNumber as notNull, and drops its unique index", () => {
    // Guards against the exact incident: bad/duplicate DICOM accession
    // numbers (e.g. a referring doctor's name) crashing study intake with
    // "duplicate key value violates unique constraint radiology_worklist_accession_uq".
    expect(worklistSchema).not.toMatch(/accessionNumber:\s*text\("accession_number"\)\.notNull\(\)/);
    expect(worklistSchema).not.toMatch(/uniqueIndex\("radiology_worklist_accession_uq"\)/);
    // study_instance_uid is the real identifier and must be uniquely indexed instead.
    expect(worklistSchema).toMatch(/uniqueIndex\("radiology_worklist_uid_uq"\)/);
  });

  it("API startup migration relaxes accession_number and enforces study_instance_uid uniqueness idempotently", () => {
    expect(indexTs).toMatch(
      /ALTER TABLE radiology_worklist ALTER COLUMN accession_number DROP NOT NULL;/
    );
    expect(indexTs).toMatch(/DROP INDEX IF EXISTS radiology_worklist_accession_uq;/);
    expect(indexTs).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS radiology_worklist_uid_uq/
    );
    // Must be guarded so pre-existing duplicate UIDs can't abort the whole
    // startup migration batch (same class of bug as the gstin incident).
    expect(indexTs).toMatch(/EXCEPTION WHEN unique_violation THEN/);
  });
});
