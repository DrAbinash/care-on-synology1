import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Payment-path observability — no silent failures.
//
// Three `catch {}` blocks in IciciPaymentProvider swallowed JSON.parse failures
// on gateway responses, and one in bills.ts swallowed a failed payment-log
// expiry UPDATE. recordPaymentDiagnostic() is only wired to the "initiate"
// stage, so on the status-check and refund paths a malformed gateway response
// produced NO diagnostic, NO log, and silently read as "not successful" —
// a successful payment reported as failed, or an accepted refund lost.
//
// Source-contract style (no gateway calls): pins that each parse failure is
// logged with its stage, and that no bare `catch {}` returns to these files.

const __dirname = dirname(fileURLToPath(import.meta.url));
const icici = readFileSync(join(__dirname, "IciciPaymentProvider.ts"), "utf8");
const bills = readFileSync(join(__dirname, "..", "..", "routes", "bills.ts"), "utf8");

describe("IciciPaymentProvider — gateway parse failures are never silent", () => {
  test("no bare swallowed catch blocks remain in the provider", () => {
    expect(icici).not.toMatch(/catch\s*\{\s*\}/);
  });

  test("each of the three parse sites logs with its stage", () => {
    for (const stage of ["initiate", "status", "refund"]) {
      expect(icici, `stage ${stage} must log its parse failure`).toContain(`stage: "${stage}"`);
    }
    // All three log through the shared logger, with a bounded response snippet
    // (never the unbounded raw body).
    const warns = icici.match(/logger\.warn\(/g) ?? [];
    expect(warns.length).toBeGreaterThanOrEqual(3);
    const snippets = icici.match(/responseSnippet: \w+\.slice\(0, 500\)/g) ?? [];
    expect(snippets.length).toBe(3);
  });

  test("the status-check misread is called out explicitly", () => {
    // This is the one that can report a SUCCESSFUL payment as failed.
    expect(icici).toContain("treating as not-successful");
  });
});

describe("bills.ts — payment-log expiry failures are never silent", () => {
  test("the expiry check logs instead of swallowing", () => {
    expect(bills).toContain('"Payment-log expiry check failed"');
    expect(bills).toContain("req.log?.warn?.({ err, txnRef, logId: logRecord.id }");
  });
});
