/**
 * Behaviour, not bookkeeping: drives the real enqueueWhatsAppMessage() chokepoint
 * under a faked database and asserts what a send actually does under each consent
 * policy. Written because the first version of these tests guarded source text and
 * survived a mutant that deleted the consent decision entirely — `if (false &&
 * !consentDecision(...))` still contains the string "consentDecision(", so a grep
 * cannot see the rule being inert. Only calling it proves it runs.
 *
 * The mock is the package boundary (@workspace/db, @workspace/db/schema,
 * drizzle-orm), not the module's own internals, so everything above the DB stays real:
 * flag check, master switch, emergency pause, purpose toggles, normalization,
 * shadow/allowlist, the consent rule itself, and the idempotency insert.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => {
  const baseSettings = {
    id: 1, enabled: true, outboundMessagingEnabled: true, emergencyPaused: false,
    requireConsent: false, shadowMode: false, blockNonAllowlisted: false, testAllowlist: "[]",
    defaultCountryCode: "91", appointmentReminderEnabled: true, duesReminderEnabled: true,
    reportReadyMessagesEnabled: true, autoSendBillCreated: true, paymentMessagesEnabled: true,
    inboundProcessingEnabled: true, maxRetryAttempts: 5, retryDelayBaseSeconds: 30,
    dailyMessageLimit: 0, quietHoursStart: "", quietHoursEnd: "",
  };
  return {
    settings: { ...baseSettings },
    base: baseSettings,
    patients: [] as Array<{ consent: boolean }>,
    contacts: [] as Array<{ consentStatus: string }>,
    queried: [] as string[],
    inserted: false,
  };
});

const T = vi.hoisted(() => ({
  settings: { __t: "settings" }, contacts: { __t: "contacts" },
  patients: { __t: "patients" }, outbox: { __t: "outbox" },
  attempts: { __t: "attempts" }, numbers: { __t: "numbers" },
}));

vi.mock("@workspace/db/schema", () => ({
  waOutboxTable: T.outbox, waDeliveryAttemptsTable: T.attempts, waContactsTable: T.contacts,
  whatsappSettingsTable: T.settings, whatsappNumbersTable: T.numbers, patientsTable: T.patients,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: { __t: string }) => {
        H.queried.push(table.__t);
        const rows = table === T.settings
          ? [H.settings]
          : table === T.patients
            ? H.patients
            : table === T.contacts
              ? H.contacts
              : [];
        const finish = async () => rows;
        return { where: () => ({ limit: finish }), limit: finish };
      },
    }),
    insert: () => {
      H.inserted = true;
      return { values: () => ({ returning: async () => [{ id: 7 }] }) };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: () => "SQL", eq: () => "EQ", inArray: () => "IN", and: () => "AND", lte: () => "LTE", desc: () => "DESC",
}));

vi.mock("../../lib/featureFlags", () => ({ isFeatureEnabledServer: async () => true }));
vi.mock("../../lib/logger", () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

const { enqueueWhatsAppMessage } = await import("./WhatsAppOutbox");

const report = {
  recipientPhone: "9876543210",
  messagePurpose: "report_ready" as const,
  text: "Your MRI report is ready. View: https://caredeoghar.com/erp/share/report/x",
};

function reset(over: Partial<typeof H.base> = {}) {
  H.settings = { ...H.base, ...over };
  H.patients = [];
  H.contacts = [];
  H.queried = [];
  H.inserted = false;
}

describe("enqueueWhatsAppMessage — consent policy behaviour", () => {
  beforeEach(() => reset());

  it("sends with the policy off (the trial default) and does not even query the patient", async () => {
    const r = await enqueueWhatsAppMessage(report);
    expect(r.ok).toBe(true);
    expect(H.queried).not.toContain("patients");
    expect(H.inserted).toBe(true);
  });

  it("refuses a clinic-initiated send when consent is required and the patient has not given it", async () => {
    reset({ requireConsent: true });
    H.patients = [{ consent: false }];
    const r = await enqueueWhatsAppMessage(report);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("consent_required");
    // A refusal must not leave a queued row behind, or the dispatcher would later
    // send what the policy just refused.
    expect(H.inserted).toBe(false);
  });

  it("refuses when the recipient matches no patient row — no match is not consent", async () => {
    reset({ requireConsent: true });
    H.patients = [];
    const r = await enqueueWhatsAppMessage(report);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("consent_required");
  });

  it("sends once consent is on file", async () => {
    reset({ requireConsent: true });
    H.patients = [{ consent: true }];
    const r = await enqueueWhatsAppMessage(report);
    expect(r.ok).toBe(true);
    expect(H.queried).toContain("patients");
  });

  it("never gates a code the patient is waiting on, and never pays a query for it", async () => {
    reset({ requireConsent: true });
    const r = await enqueueWhatsAppMessage({ recipientPhone: "9876543210", messagePurpose: "otp", text: "123456" });
    expect(r.ok).toBe(true);
    expect(H.queried).not.toContain("patients");
  });

  it("still honours an opt-out while the policy is off", async () => {
    reset({ requireConsent: false });
    H.contacts = [{ consentStatus: "denied" }];
    const r = await enqueueWhatsAppMessage(report);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("consent_denied");
  });
});
