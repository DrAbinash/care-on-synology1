/**
 * resetAdminPin.test.ts — the recovery script must not ship a trivial PIN
 * with the change flag switched off (audit F-15 / security item S-4).
 *
 * The reset-admin-pin tool is the emergency path back into the most
 * privileged account in the system. As shipped, it reset the owner to the
 * literal PIN '1234', set must_change_pin to FALSE, and printed no warning —
 * and super-admins are exempt from LAN-only login, so a leftover reset left
 * the account remotely attackable with a trivial PIN indefinitely.
 *
 * Source pin (the script needs a live DATABASE_URL to execute, so behaviour
 * is covered by argument/validation structure instead):
 *  - no literal trivial PIN in the source;
 *  - the PIN comes from --pin (validated) or the crypto RNG;
 *  - mustChangePin is TRUE on both the update and the insert path;
 *  - the rotation warning is printed after a successful reset.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(HERE, "reset-admin-pin.ts"), "utf8").replace(/\r\n/g, "\n");

describe("the super-admin recovery script cannot leave a trivial PIN behind", () => {
  it("does not hardcode a literal PIN", () => {
    // Both comment styles are stripped first — the file's own history notes
    // quote the old value on purpose. `pin = "1234"` — the exact shipped
    // defect — and any sibling of it must not survive in executable source.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bpin\s*=\s*"\d{3,8}"/);
    expect(code).not.toContain("'1234'");
  });

  it("generates the PIN from the crypto RNG when none is supplied", () => {
    expect(src).toMatch(/import \{ randomInt \} from "node:crypto"/);
    expect(src).toMatch(/randomInt\(0, 900000\)/);
  });

  it("validates an explicit --pin (4-8 digits) and refuses anything else", () => {
    expect(src).toContain("PIN_PATTERN = /^\\d{4,8}$/");
    expect(src).toMatch(/Refusing --pin/);
  });

  it("forces mustChangePin on BOTH the update and the insert path", () => {
    // The old script set mustChangePin: false on both — the flag exists on
    // exactly two write sites; both must now say true.
    const writes = src.match(/mustChangePin:\s*(true|false)/g) ?? [];
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w === "mustChangePin: true")).toBe(true);
  });

  it("prints a rotation warning after the reset", () => {
    expect(src).toMatch(/printRotationWarning/);
    expect(src).toMatch(/ROTATE IMMEDIATELY AFTER USE/);
  });
});
