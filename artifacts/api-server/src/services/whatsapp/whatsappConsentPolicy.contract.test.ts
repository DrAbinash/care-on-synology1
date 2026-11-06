/**
 * Source contracts for the WhatsApp consent policy.
 *
 * consentDecision() is unit-tested for its logic; these pins guard the WIRING, which
 * is the part this codebase has repeatedly got wrong. Two fields on this very
 * settings page — marketingMessagesAllowed and monthlyMessageBudgetWarning — are
 * saved by the route and read by nothing, so the page shows a control that changes
 * no behaviour. A consent switch that is stored but never consulted would be worse
 * than no switch: it would look like compliance. These assertions fail if the rule
 * stops being reachable from the send path, the settings route, the schema or the
 * migration chain.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");

const OUTBOX = readFileSync(join(HERE, "WhatsAppOutbox.ts"), "utf8");
const WA_ROUTE = readFileSync(join(ROOT, "artifacts/api-server/src/routes/whatsapp.ts"), "utf8");
const DELIVERY_ROUTE = readFileSync(join(ROOT, "artifacts/api-server/src/routes/whatsappDelivery.ts"), "utf8");
const SCHEMA = readFileSync(join(ROOT, "lib/db/src/schema/whatsappSettings.ts"), "utf8");
const MIGRATIONS = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql"));

describe("WhatsApp consent policy — wiring", () => {
  it("1. the enqueue chokepoint decides consent through consentDecision()", () => {
    // Not just "the function exists": the call must be inside enqueueWhatsAppMessage,
    // so no caller can reach the provider without passing it.
    expect(OUTBOX).toContain("export function consentDecision(");
    const enqueueBody = OUTBOX.slice(
      OUTBOX.indexOf("export async function enqueueWhatsAppMessage"),
      OUTBOX.indexOf("// ── Dispatcher ──"),
    );
    expect(enqueueBody.length).toBeGreaterThan(1000);
    expect(enqueueBody).toContain("consentDecision({");
    expect(enqueueBody).toContain("s.requireConsent");
    expect(enqueueBody).toContain('reason: "consent_required"');
  });

  it("2. the refused patient is looked up by the link the caller already has", () => {
    // patientId when present (the authoritative link), last-ten digits otherwise —
    // patients.phone is stored local while normalizedPhone carries +91.
    const consentBlock = OUTBOX.slice(
      OUTBOX.indexOf("const purposeNeedsConsent"),
      OUTBOX.indexOf("if (!consentDecision({"),
    );
    expect(consentBlock).toContain("input.patientId");
    expect(consentBlock).toContain("right(${patientsTable.phone}, 10)");
  });

  it("3. the admin settings route can switch the policy", () => {
    expect(WA_ROUTE).toContain("body.requireConsent");
    expect(WA_ROUTE).toContain("updates.requireConsent");
  });

  it("4. the front-desk dialog is told the policy, so it never refuses on the UI's own guess", () => {
    expect(DELIVERY_ROUTE).toContain("whatsappSettingsTable.requireConsent");
    expect(DELIVERY_ROUTE).toContain("requireConsent: wa?.requireConsent ?? false");
  });

  it("5. the schema default is OFF (trial) and a migration creates the column", () => {
    // Asserted on the declared default, not a comment: the clinic's behaviour during
    // the trial is exactly this value.
    expect(SCHEMA).toMatch(/requireConsent:\s*boolean\("require_consent"\)\.notNull\(\)\.default\(false\)/);
    const creates = MIGRATIONS.filter((f) =>
      readFileSync(join(ROOT, "migrations", f), "utf8").includes("ADD COLUMN IF NOT EXISTS require_consent"),
    );
    expect(creates.length, "a whatsapp_settings column needs a migrations/*.sql file — db:push never runs on the NAS").toBeGreaterThan(0);
  });
});
