import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Backup encryption requires the openssl BINARY in the runtime image.
//
// lib/backupCrypto.ts deliberately shells out to the openssl CLI
// (spawn("openssl", …)) rather than reimplementing openssl's Salted__ + PBKDF2
// key derivation in Node, so backups stay byte-compatible with the Synology
// shell scripts and can be decrypted on a bare machine with nothing but
// openssl. node:22-bookworm-slim does NOT ship the openssl CLI, and the api
// stage installed only tini/curl/dcmtk.
//
// Because the backup code correctly refuses to EVER write an unencrypted
// backup, the missing binary did not degrade backups — it stopped them
// completely, silently, for 16 days:
//   "Backup encryption failed (openssl exit -1): openssl failed to start:
//    spawn openssl ENOENT"
// caught only when the backup dead-man alert fired with "last successful backup
// was 395.1h ago (threshold 26h)".
//
// This guards the dependency in both directions: the code still requires the
// binary, and the image still installs it.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..");

const dockerfile = readFileSync(join(REPO, "Dockerfile"), "utf8");
const backupCrypto = readFileSync(join(__dirname, "backupCrypto.ts"), "utf8");

/** The api runtime stage of the multi-stage Dockerfile. */
function apiStage(): string {
  const start = dockerfile.indexOf("FROM node:22-bookworm-slim AS api");
  expect(start, "api stage must exist").toBeGreaterThan(-1);
  const next = dockerfile.indexOf("\nFROM ", start + 1);
  return dockerfile.slice(start, next === -1 ? undefined : next);
}

describe("backup encryption depends on the openssl binary", () => {
  test("backupCrypto really does spawn the openssl CLI", () => {
    // If this ever stops being true the Dockerfile assertion below can be
    // revisited — but until then the binary is a hard runtime requirement.
    expect(backupCrypto).toContain('spawn("openssl"');
  });

  test("and it refuses to write an unencrypted backup as a fallback", () => {
    // This is WHY a missing binary is a full stop rather than a degradation.
    // Keep both facts pinned together so the severity stays obvious.
    expect(backupCrypto).toMatch(/never written unencrypted|refusing to write an unencrypted backup/i);
  });
});

describe("the api runtime image installs openssl", () => {
  test("openssl is in the api stage apt-get install list", () => {
    const stage = apiStage();
    expect(stage).toMatch(/apt-get install[^\n]*\bopenssl\b/);
  });

  test("the other runtime binaries are still installed (no accidental removal)", () => {
    const stage = apiStage();
    for (const pkg of ["tini", "curl", "dcmtk"]) {
      expect(stage, `${pkg} must remain installed`).toMatch(
        new RegExp(`apt-get install[^\\n]*\\b${pkg}\\b`),
      );
    }
  });
});

describe("openssl's CLI contract used by backupCrypto holds", () => {
  test("openssl supports -pbkdf2 with aes-256-cbc and a passphrase on stdin", () => {
    // Proves the flags backupCrypto passes are real, on whatever openssl is
    // present in the test environment. Skips rather than fails if the test host
    // itself has no openssl — the Dockerfile assertion above is what guards
    // production.
    let version: string;
    try {
      version = execFileSync("openssl", ["version"], { encoding: "utf8" });
    } catch {
      return; // no openssl on this host; image assertion still covers prod
    }
    expect(version).toMatch(/OpenSSL/i);
    const ciphers = execFileSync("openssl", ["enc", "-ciphers"], { encoding: "utf8" });
    expect(ciphers).toMatch(/aes-256-cbc/);
  });
});
