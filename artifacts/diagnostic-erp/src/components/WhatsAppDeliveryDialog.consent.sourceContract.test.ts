/**
 * Source contract — the WhatsApp consent gate is a policy, not a hard-coded wall.
 *
 * Measured on production 2026-11-03: 9,491 patients have a reachable phone number and
 * 18 have whatsapp_consent = true. With the refusal unconditional, the front desk hit
 * "No WhatsApp consent — tick the one-time override" on 99.8% of patients, which is
 * why the feature produced zero sends in the delivery audit table. The clinic's
 * decision is to run the trial without demanding consent, so the refusal has to be
 * conditional on the policy the SERVER enforces (it defaults off) rather than on a
 * client-side guess — and both the toggle and the pre-ticked registration box must
 * survive a future switch back to strict consent with no data migration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIALOG = readFileSync(join(SRC, "components/WhatsAppDeliveryDialog.tsx"), "utf8");
const BILLING_DESK = readFileSync(join(SRC, "pages/BillingDesk.tsx"), "utf8");
const REGISTER = readFileSync(join(SRC, "pages/Register.tsx"), "utf8");
const FORM = readFileSync(join(SRC, "components/RegisterPatientForm.tsx"), "utf8");

describe("WhatsApp delivery dialog — consent is policy-driven", () => {
  it("1. reads the policy from the server instead of assuming it", () => {
    expect(DIALOG).toContain("requireConsent?: boolean");
    expect(DIALOG).toContain("setRequireConsent(s.requireConsent === true)");
    // Unknown/absent = not required, matching whatsapp_settings.require_consent's
    // default. A settings payload from before the column must not start refusing.
    expect(DIALOG).toContain("useState(false)");
  });

  it("2. refuses only while the policy is on", () => {
    expect(DIALOG).toContain("if (requireConsent && !whatsappConsent && !overrideConsent) {");
    // The unconditional wall this replaces.
    expect(DIALOG).not.toContain("if (!whatsappConsent && !overrideConsent) {");
  });

  it("3. offers the override checkbox only while the policy is on", () => {
    expect(DIALOG).toContain("{requireConsent && !whatsappConsent && (");
    // With consent not required, a send must not be audited as an override — the
    // audit table would otherwise fill with consent_override=true rows that were
    // never exceptions to anything.
    expect(DIALOG).toContain("!whatsappConsent && overrideConsent");
  });
});

describe("registration — consent is recorded automatically, not demanded", () => {
  it("4. every new-patient form starts with WhatsApp updates ON", () => {
    expect(BILLING_DESK).not.toContain("whatsappConsent: false");
    expect(BILLING_DESK).toContain("whatsappConsent: true");
    expect(REGISTER).toContain("whatsappConsent: true");
  });

  it("5. the box says it is ON and that unchecking is a decline", () => {
    // Wording matters here: the stored value means "did not decline at
    // registration", so the label must not claim the patient was asked and agreed.
    expect(FORM).toContain("WhatsApp updates are ON for this patient");
    expect(FORM).toContain("Uncheck if the patient declines");
    expect(FORM).toContain("data-testid=\"register-whatsapp-consent\"");
  });
});
