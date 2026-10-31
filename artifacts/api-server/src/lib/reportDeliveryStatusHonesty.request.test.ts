/**
 * reportDeliveryStatusHonesty.request.test.ts — is a delivery that produced NO
 * evidence still recorded as delivered? Executed against real Postgres.
 *
 * PR #1245 introduced `whatsappSendVerdict()` (lib/reportDeliveryReceipts.ts)
 * and applied it to the INTERACTIVE share route
 * (routes/patient-reports.ts `POST /:id/share`). `ok:true` from the WhatsApp
 * sender means three different things and only one of them is a send:
 *   sent    — Meta returned a provider message id,
 *   queued  — `wa_outbox` holds it; nothing has confirmed anything,
 *   failed  — refused, or suppressed by shadow mode (never sendable).
 *
 * The suspicion is that the DURABLE paths were never converted. This file drives
 * them for real and asserts on what the database ends up saying:
 *
 *   1. QUEUED IS NOT SENT — `radiologyJobHandlers.ts` (redelivery job) does
 *      `sendOk = result.ok` and then inserts `report_shares.status:"sent"` and
 *      flips `patient_reports.status` to "delivered".
 *   2. SUPPRESSED IS NOT SENT — same handler, `{ok:true, skipped:true}` shape
 *      (shadow mode): a message that will never be sent is booked as delivered.
 *   3. RENDER FAILURE IS NOT DELIVERY — the handler's email branch passes
 *      `html: artifact?.html ?? ""`, and `src/email.ts:666` substitutes a
 *      content-free body for an empty `html` and still returns ok:true.
 *      NOTE measured honestly: `buildReportArtifact()` can only return null when
 *      `patient_reports` has no such row at render time, which the handler
 *      already ruled out a few lines earlier — so the *null* state itself is not
 *      constructible from DB rows alone (reported UNPROVEN). What IS executed is
 *      the value the handler passes in that case (`""`) against the real mailer,
 *      plus the real render as a control.
 *   4. PDF BEFORE BYTES — `GET /:id/pdf` logs the share and stamps the report
 *      delivered BEFORE `await renderHtmlToPdf()`, so a failed render still
 *      reads as a delivery. Headless Chromium WORKS on this machine (the test
 *      proves a real 200 + PDF bytes as a control first), so the render failure
 *      is injected at that one seam (`lib/htmlToPdf`) — every DB write below it
 *      is the route's own.
 *
 * SAFETY: nothing leaves this machine. WhatsApp is driven only in states that
 * never reach a dispatcher (quiet-hours defer → the inline claim loses; shadow
 * mode → suppressed at enqueue), the settings row carries NO credential
 * (accessToken/phoneNumberId forced empty), and `nodemailer` is replaced by an
 * in-process recording sink so no SMTP connection is ever attempted. Fixture
 * rows are marker-scoped and removed in afterAll; `whatsapp_settings`,
 * `email_settings` and `feature_flags` are snapshotted and restored exactly.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  patientsTable,
  testsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientReportsTable,
  reportSharesTable,
  radiologyRedeliveryObligationsTable,
  auditLogsTable,
  whatsappSettingsTable,
  waOutboxTable,
  emailSettingsTable,
  featureFlagsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { invalidateFeatureFlagCache } from "./featureFlags";
import { istHourMinute } from "./istDate";
import { recipientFingerprint } from "./redeliveryRules";
import { whatsappSendVerdict } from "./reportDeliveryReceipts";
import { RADIOLOGY_JOB_HANDLERS, REDELIVERY_SEND_JOB } from "./radiologyJobHandlers";
import { buildReportArtifact } from "../routes/patient-reports";
import { sendReportEmail } from "../email";
import type { RadiologyJobRow } from "./radiologyJobs";

// ── Fault/seam injection (hoisted so the vi.mock factories can see them) ──────
// `pdfRenderFails` simulates headless Chromium dying AFTER the route has already
// written its delivery bookkeeping — the exact window test 4 is about. With the
// flag off the real renderer runs, so the route is proven to work normally first.
const pdfFault = vi.hoisted(() => ({ fails: false }));
vi.mock("./htmlToPdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./htmlToPdf")>();
  return {
    ...actual,
    renderHtmlToPdf: async (html: string) => {
      if (pdfFault.fails) throw new Error("VITEST INJECTED: Chromium exited before producing PDF bytes");
      return actual.renderHtmlToPdf(html);
    },
  };
});

// An in-process mail sink: `sendReportEmail()` runs unchanged, but the transport
// records instead of talking to a server. No credential exists to use.
// `omitMessageId` reproduces an SMTP server that accepted the message and named it
// nothing — the state that must NOT be booked as a delivery.
const mailSink = vi.hoisted(() => ({
  messages: [] as Array<{ from?: string; to?: string; subject?: string; html?: string }>,
  omitMessageId: false,
}));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: { from?: string; to?: string; subject?: string; html?: string }) => {
        mailSink.messages.push(msg);
        return mailSink.omitMessageId
          ? {}
          : { messageId: `vitest-local-sink-${mailSink.messages.length}` };
      },
    }),
  },
}));

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("report delivery status honesty — executed against real DB state", () => {
  let app: Express;
  const marker = `vd-${randomUUID().slice(0, 12)}`;
  const token = `vitest-token-${randomUUID()}`;
  const auth = { Authorization: `Bearer ${token}` };
  const today = new Date().toISOString().slice(0, 10);

  /** Two distinct synthetic phones so the queued and the suppressed drives
   *  cannot share an idempotency key. 10 digits → normalizePhone prefixes the
   *  country code, and the ALLOWLIST stores the normalized form. */
  const phoneQueuedRaw = `6${randomUUID().replace(/\D/g, "").slice(0, 9)}`;
  const phoneShadowRaw = `7${randomUUID().replace(/\D/g, "").slice(0, 9)}`;
  const phoneQueuedNorm = `91${phoneQueuedRaw}`;
  const phoneShadowNorm = `91${phoneShadowRaw}`;
  const emailRecipient = `vd-${marker}@example.invalid`;
  const allRecipients = [phoneQueuedRaw, phoneQueuedNorm, phoneShadowRaw, phoneShadowNorm, emailRecipient];

  let patientId = 0;
  let otherPatientId = 0;
  let userId = 0;
  let testId = 0;
  let studyId = 0;
  let worklistId = 0;
  const reportIds: number[] = [];
  const obligationIds: number[] = [];
  const shareIds: number[] = [];

  // Snapshots to restore byte-for-byte.
  let waSettingsId = 0;
  let waSettingsPrior: Record<string, unknown> | null = null;
  let waSettingsCreated = false;
  let flagPrior: boolean | null = null;
  let emailSettingsId = 0;
  let emailSettingsPrior: Record<string, unknown> | null = null;

  /** IST clock window straddling "now", so the outbox defers the row instead of
   *  sending it — that is what makes a real `{ok:true}` WITHOUT a message id. */
  function quietHoursAroundNow(): { start: string; end: string } {
    const { hour, minute } = istHourMinute(new Date());
    const nowMin = hour * 60 + minute;
    const fmt = (m: number) => {
      const mod = ((m % 1440) + 1440) % 1440;
      return `${String(Math.floor(mod / 60)).padStart(2, "0")}:${String(mod % 60).padStart(2, "0")}`;
    };
    return { start: fmt(nowMin - 90), end: fmt(nowMin + 90) };
  }

  async function setWaSettings(cols: Record<string, unknown>): Promise<void> {
    await db
      .update(whatsappSettingsTable)
      .set({
        // No credential is ever present, and both shapes tested here stop
        // before a dispatcher could run; the dispatcher is not started by this
        // harness at all.
        accessToken: "",
        appSecret: "",
        phoneNumberId: "",
        templateName: "",
        enabled: true,
        outboundMessagingEnabled: true,
        reportReadyMessagesEnabled: true,
        emergencyPaused: false,
        blockNonAllowlisted: true,
        defaultCountryCode: "91",
        dailyMessageLimit: 0,
        maxRetryAttempts: 5,
        quietHoursStart: "",
        quietHoursEnd: "",
        ...cols,
      } as never)
      .where(eq(whatsappSettingsTable.id, waSettingsId));
  }

  async function newPatient(tag: string) {
    const [row] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker.toUpperCase()}-${tag}`,
        firstName: "Verity",
        lastName: `${tag} ${marker}`,
        dateOfBirth: "1975-03-04",
        gender: "male",
        phone: tag === "A" ? phoneQueuedRaw : phoneShadowRaw,
      })
      .returning();
    return row.id;
  }

  async function newVerifiedReport(tag: string): Promise<number> {
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker.toUpperCase()}-${tag}`,
        type: "radiology",
        patientId,
        testId,
        studyId: worklistId,
        title: `MRI Brain ${tag} ${marker}`,
        body: `<p>CLINICAL-CONTENT-${tag}-${marker}: No acute intracranial abnormality.</p>`,
        impression: `IMPRESSION-${marker}`,
        status: "verified",
        signedByName: "Dr. Verity Singh",
        signedAt: new Date(),
        verifiedByName: "Dr. Verity Singh",
        verifiedAt: new Date(),
        createdBy: `vitest:${marker}`,
      })
      .returning();
    reportIds.push(row.id);
    return row.id;
  }

  /** The prior delivery the duty is owed from: a `report_shares` row carrying the
   *  raw recipient (obligations never store it). */
  async function newSourceShare(reportId: number, channel: string, recipient: string): Promise<number> {
    const [row] = await db
      .insert(reportSharesTable)
      .values({ reportId, channel, recipient, sharedBy: `vitest-origin:${marker}`, status: "sent", errorMessage: null })
      .returning();
    shareIds.push(row.id);
    return row.id;
  }

  async function newObligation(args: {
    reportId: number;
    channel: string;
    recipient: string;
    sourceShareId: number;
  }): Promise<number> {
    const [row] = await db
      .insert(radiologyRedeliveryObligationsTable)
      .values({
        rootReportId: args.reportId,
        reportId: args.reportId,
        sequenceNumber: 1,
        channel: args.channel,
        recipientMasked: `${args.channel.slice(0, 2)}:**${marker.slice(-4)}`,
        recipientFingerprint: recipientFingerprint(args.channel, args.recipient),
        status: "queued",
        sourceShareId: args.sourceShareId,
        sourceReportId: args.reportId,
      })
      .returning();
    obligationIds.push(row.id);
    return row.id;
  }

  /** The single executed call every numbered test drives. */
  async function runRedeliveryHandler(obligationId: number) {
    const job = {
      id: 1,
      operationType: REDELIVERY_SEND_JOB,
      entityType: "radiology_redelivery_obligation",
      entityId: obligationId,
      payload: { obligationId },
      retryCount: 0,
      maxRetries: 3,
      status: "processing",
      idempotencyKey: null,
    } satisfies RadiologyJobRow;
    return RADIOLOGY_JOB_HANDLERS[REDELIVERY_SEND_JOB](job);
  }

  async function readObligation(id: number) {
    const [row] = await db.select().from(radiologyRedeliveryObligationsTable).where(eq(radiologyRedeliveryObligationsTable.id, id));
    return row;
  }

  async function readReport(id: number) {
    const [row] = await db
      .select({ status: patientReportsTable.status, deliveredAt: patientReportsTable.deliveredAt })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, id));
    return row;
  }

  async function readOutbox(phoneNorm: string) {
    const [row] = await db
      .select({ id: waOutboxTable.id, status: waOutboxTable.status, providerMessageId: waOutboxTable.providerMessageId, suppressedReason: waOutboxTable.suppressedReason, attemptCount: waOutboxTable.attemptCount, lockedBy: waOutboxTable.lockedBy, nextAttemptAt: waOutboxTable.nextAttemptAt })
      .from(waOutboxTable)
      .where(eq(waOutboxTable.recipientPhone, phoneNorm));
    return row ?? null;
  }

  /** Share rows the JOB itself wrote (the source share is tagged vitest-origin). */
  async function sharesFor(reportId: number, channel: string) {
    const rows = await db
      .select({ id: reportSharesTable.id, channel: reportSharesTable.channel, status: reportSharesTable.status, sharedBy: reportSharesTable.sharedBy, errorMessage: reportSharesTable.errorMessage, recipient: reportSharesTable.recipient })
      .from(reportSharesTable)
      .where(eq(reportSharesTable.reportId, reportId));
    return rows.filter((r: { channel: string; sharedBy: string | null }) => r.channel === channel && r.sharedBy === "redelivery-job");
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. DeliveryProbe ${marker}`,
        email: `vd-${marker}@vitest.invalid`,
        username: `vd-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const [t] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `VD${marker.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = t.id;

    patientId = await newPatient("A");
    otherPatientId = await newPatient("B");

    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "acquired",
        accessionNumber: `ACC-${marker}`,
        patientId,
        testId,
      } as never)
      .returning();
    studyId = study.id;

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "REPORT_FINAL",
        patientName: `Verity A ${marker}`,
        patientId,
        studyId,
        accessionNumber: `ACC-${marker}`,
        studyInstanceUID: `1.2.840.vd.${marker}`,
      } as never)
      .returning();
    worklistId = wl.id;

    // ── whatsapp_settings: snapshot or create, restore exactly afterwards.
    const [prior] = await db.select().from(whatsappSettingsTable).limit(1);
    if (prior) {
      waSettingsPrior = { ...prior };
      waSettingsId = prior.id;
    } else {
      const [created] = await db.insert(whatsappSettingsTable).values({}).returning();
      waSettingsId = created.id;
      waSettingsCreated = true;
    }

    // ── the WhatsApp feature flag must be on for the enqueue chokepoint to run.
    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, "ff_whatsapp_cloud_api"));
    flagPrior = flag ? flag.enabled : null;
    if (flag) {
      await db.update(featureFlagsTable).set({ enabled: true }).where(eq(featureFlagsTable.key, "ff_whatsapp_cloud_api"));
    } else {
      await db.insert(featureFlagsTable).values({ key: "ff_whatsapp_cloud_api", enabled: true, description: `vitest ${marker}` } as never);
    }
    invalidateFeatureFlagCache();

    // ── email_settings: `getTransporter()` only builds a transport when BOTH
    //    smtpHost and smtpUser are non-empty. Whatever the row holds is
    //    overwritten with an unusable sink address so a stored real credential
    //    is never reachable, and nodemailer itself is mocked in-process, so no
    //    SMTP connection is possible. Prior row is restored in afterAll.
    const priorMailRows = await db.select().from(emailSettingsTable).limit(1);
    if (priorMailRows[0]) {
      emailSettingsId = priorMailRows[0].id;
      emailSettingsPrior = { ...priorMailRows[0] };
      await db
        .update(emailSettingsTable)
        .set({ smtpHost: "sink.invalid.test", smtpPort: "2525", smtpUser: "vitest-sink@invalid", smtpPassword: "", smtpSecure: false, fromAddress: `vitest@${marker}.invalid`, adminEmail: "" } as never)
        .where(eq(emailSettingsTable.id, emailSettingsId));
    } else {
      const [mailRow] = await db
        .insert(emailSettingsTable)
        .values({
          smtpHost: "sink.invalid.test",
          smtpPort: "2525",
          smtpUser: "vitest-sink@invalid",
          smtpPassword: "",
          smtpSecure: false,
          fromAddress: `vitest@${marker}.invalid`,
          fromName: "Vitest Sink",
          adminEmail: "",
        })
        .returning();
      emailSettingsId = mailRow.id;
    }

    // The job builds a patient link from this; it is only ever a string in the
    // message body, nothing is fetched from it.
    process.env.PUBLIC_BASE_URL = "https://reports.vitest.invalid";
  }, 180_000);

  afterAll(async () => {
    delete process.env.PUBLIC_BASE_URL;

    invalidateFeatureFlagCache();
    if (flagPrior === null) {
      await db.delete(featureFlagsTable).where(eq(featureFlagsTable.key, "ff_whatsapp_cloud_api")).catch(() => {});
    } else {
      await db.update(featureFlagsTable).set({ enabled: flagPrior }).where(eq(featureFlagsTable.key, "ff_whatsapp_cloud_api")).catch(() => {});
    }
    invalidateFeatureFlagCache();

    if (waSettingsPrior) {
      await db.update(whatsappSettingsTable).set(waSettingsPrior as never).where(eq(whatsappSettingsTable.id, waSettingsId)).catch(() => {});
    } else if (waSettingsCreated) {
      await db.delete(whatsappSettingsTable).where(eq(whatsappSettingsTable.id, waSettingsId)).catch(() => {});
    }

    // Only outbox rows addressed to this run's synthetic numbers.
    await db.delete(waOutboxTable).where(inArray(waOutboxTable.recipientPhone, allRecipients)).catch(() => {});

    if (emailSettingsPrior) {
      await db.update(emailSettingsTable).set(emailSettingsPrior as never).where(eq(emailSettingsTable.id, emailSettingsId)).catch(() => {});
    } else {
      await db.delete(emailSettingsTable).where(eq(emailSettingsTable.id, emailSettingsId)).catch(() => {});
    }

    for (const id of obligationIds) {
      await db.delete(radiologyRedeliveryObligationsTable).where(eq(radiologyRedeliveryObligationsTable.id, id)).catch(() => {});
    }
    await db.delete(reportSharesTable).where(inArray(reportSharesTable.reportId, reportIds)).catch(() => {});
    for (const id of shareIds) {
      await db.delete(reportSharesTable).where(eq(reportSharesTable.id, id)).catch(() => {});
    }
    for (const id of reportIds) {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, String(id))).catch(() => {});
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id)).catch(() => {});
    }
    await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    for (const pid of [patientId, otherPatientId]) {
      await db.delete(patientsTable).where(eq(patientsTable.id, pid)).catch(() => {});
    }
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 1. QUEUED IS NOT SENT
  // ─────────────────────────────────────────────────────────────────────────
  it("1. a WhatsApp send the outbox only QUEUED must not book the obligation sent or the report delivered", async () => {
    const qh = quietHoursAroundNow();
    // shadowMode OFF and the number allowlisted → the message really is enqueued
    // as `queued`; quiet hours push next_attempt_at forward, so the inline claim
    // loses and `sendReportWhatsapp()` answers {ok:true} with NO messageId.
    await setWaSettings({
      shadowMode: false,
      testAllowlist: JSON.stringify([phoneQueuedNorm]),
      quietHoursStart: qh.start,
      quietHoursEnd: qh.end,
    });

    const reportId = await newVerifiedReport("Q");
    const sourceShareId = await newSourceShare(reportId, "whatsapp", phoneQueuedRaw);
    const obligationId = await newObligation({ reportId, channel: "whatsapp", recipient: phoneQueuedRaw, sourceShareId });

    const result = await runRedeliveryHandler(obligationId);

    const outbox = await readOutbox(phoneQueuedNorm);
    const obligation = await readObligation(obligationId);
    const report = await readReport(reportId);
    const jobShares = await sharesFor(reportId, "whatsapp");
    const observed = {
      handlerResult: result,
      obligationStatus: obligation?.status,
      obligationFailureReason: obligation?.failureReason,
      reportStatus: report?.status,
      reportDeliveredAt: report?.deliveredAt ? "SET" : null,
      jobShareRows: jobShares,
      outbox: outbox
        ? { status: outbox.status, providerMessageId: outbox.providerMessageId, suppressedReason: outbox.suppressedReason, lockedBy: outbox.lockedBy }
        : null,
    };
    const evidence = `OBSERVED ${JSON.stringify(observed)} (quiet hours ${qh.start}-${qh.end} IST)`;

    // Fixture guard: the send really was accepted-but-unconfirmed.
    expect(outbox, `${evidence} — no wa_outbox row was created, so the send never happened`).not.toBeNull();
    expect(outbox!.status, `${evidence} — expected an un-dispatched outbox row`).toBe("queued");
    expect(outbox!.providerMessageId, `${evidence} — a provider message id would make this a real send`).toBeNull();
    expect(whatsappSendVerdict({ ok: true, messageId: outbox!.providerMessageId }), `${evidence}`).toBe("queued");

    // The honest outcome the clinic should see: nothing booked as delivered.
    expect(["sent", "completed"], `${evidence}`).not.toContain(obligation?.status);
    expect(jobShares.filter((s: { status: string }) => s.status === "sent"), `${evidence}`).toHaveLength(0);
    expect(report?.status, `${evidence}`).toBe("verified");
    expect(report?.deliveredAt, `${evidence}`).toBeNull();
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. SUPPRESSED IS NOT SENT
  // ─────────────────────────────────────────────────────────────────────────
  it("2. a shadow-mode SUPPRESSED WhatsApp send must not be booked sent/delivered at all", async () => {
    await setWaSettings({
      shadowMode: true,
      // This number is deliberately NOT on the allowlist → enqueue suppresses it
      // (`suppressed_reason = shadow_mode`) and it can never be dispatched.
      testAllowlist: JSON.stringify([phoneQueuedNorm]),
      quietHoursStart: "",
      quietHoursEnd: "",
    });

    const reportId = await newVerifiedReport("S");
    const sourceShareId = await newSourceShare(reportId, "whatsapp", phoneShadowRaw);
    const obligationId = await newObligation({ reportId, channel: "whatsapp", recipient: phoneShadowRaw, sourceShareId });

    const result = await runRedeliveryHandler(obligationId);

    const outbox = await readOutbox(phoneShadowNorm);
    const obligation = await readObligation(obligationId);
    const report = await readReport(reportId);
    const jobShares = await sharesFor(reportId, "whatsapp");
    const observed = {
      handlerResult: result,
      obligationStatus: obligation?.status,
      reportStatus: report?.status,
      reportDeliveredAt: report?.deliveredAt ? "SET" : null,
      jobShareRows: jobShares,
      outbox: outbox ? { status: outbox.status, providerMessageId: outbox.providerMessageId, suppressedReason: outbox.suppressedReason } : null,
    };
    const evidence = `OBSERVED ${JSON.stringify(observed)}`;

    // Fixture guard: the message was suppressed, i.e. will never reach anyone.
    expect(outbox, `${evidence} — no outbox row, fixture did not reach the sender`).not.toBeNull();
    expect(outbox!.status, `${evidence}`).toBe("suppressed");
    expect(outbox!.suppressedReason, `${evidence}`).toBe("shadow_mode");
    expect(whatsappSendVerdict({ ok: true, skipped: true, messageId: outbox!.providerMessageId }), `${evidence}`).toBe("failed");

    expect(["sent", "completed"], `${evidence}`).not.toContain(obligation?.status);
    expect(jobShares.filter((s: { status: string }) => s.status === "sent"), `${evidence}`).toHaveLength(0);
    expect(report?.status, `${evidence}`).toBe("verified");
    expect(report?.deliveredAt, `${evidence}`).toBeNull();
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. RENDER FAILURE IS NOT DELIVERY
  // ─────────────────────────────────────────────────────────────────────────
  it("3a. an email send whose body is empty (what the handler passes when the artifact is null) must not be accepted as delivered", async () => {
    // Control through the REAL renderer, so the empty case below is attributable
    // to the render and not to a fixture that never worked.
    const reportId = await newVerifiedReport("E1");
    const artifact = await buildReportArtifact(reportId, { surface: "email", versionMode: "specific" });
    const realRenderHtml = artifact?.html ?? null;
    const clinicalMarker = `CLINICAL-CONTENT-E1-${marker}`;

    // `radiologyJobHandlers.ts` handed the mailer `artifact?.html ?? ""` — an
    // artifact that is null (render failure) reached email.ts as exactly "".
    const beforeEmpty = mailSink.messages.length;
    const emptyResult = await sendReportEmail({ to: emailRecipient, subject: `Amended Report E1 ${marker}`, html: "", patientName: "Verity A", reportNumber: `RPT-${marker}-E1` });
    const emptyBodySent = mailSink.messages.length > beforeEmpty ? (mailSink.messages[beforeEmpty].html ?? "") : null;
    const fullResult = await sendReportEmail({ to: emailRecipient, subject: `Amended Report E1 full ${marker}`, html: realRenderHtml ?? "", patientName: "Verity A", reportNumber: `RPT-${marker}-E1` });
    const evidence = `OBSERVED realRenderChars=${realRenderHtml?.length ?? null} realRenderCarriesClinicalText=${!!realRenderHtml?.includes(clinicalMarker)} emptyResult=${JSON.stringify(emptyResult)} emptyBodySent=${JSON.stringify(emptyBodySent)} fullResult=${JSON.stringify(fullResult)}`;

    // An empty report body is refused and NOTHING reaches the transport — the
    // content-free sentence that used to be substituted in its place is gone.
    expect(emptyResult.ok, `${evidence} — an empty report body is not a delivery`).toBe(false);
    expect(emptyResult.error, `${evidence}`).toBe("report_body_unavailable");
    expect(emptyBodySent, `${evidence} — an unrenderable report must never reach a patient`).toBeNull();
    // The same call with a real render goes, and names itself: the evidence the
    // delivery bookkeeping now requires.
    expect(fullResult.ok, `${evidence}`).toBe(true);
    expect(fullResult.messageId, `${evidence} — an accepted send must carry SMTP acceptance evidence`).toBeTruthy();
    expect(
      mailSink.messages[mailSink.messages.length - 1]?.html ?? "",
      `${evidence} — the mail the patient would get`,
    ).toContain(clinicalMarker);
  }, 180_000);

  it("3b. the redelivery email branch books a delivery only on SMTP acceptance evidence, and an accepted send IS one", async () => {
    await setWaSettings({ shadowMode: true, testAllowlist: JSON.stringify([phoneQueuedNorm]), quietHoursStart: "", quietHoursEnd: "" });

    const reportId = await newVerifiedReport("E2");
    const sourceShareId = await newSourceShare(reportId, "email", emailRecipient);
    const obligationId = await newObligation({ reportId, channel: "email", recipient: emailRecipient, sourceShareId });

    const before = mailSink.messages.length;
    const result = await runRedeliveryHandler(obligationId);
    const mail = mailSink.messages[before] ?? null;

    const obligation = await readObligation(obligationId);
    const report = await readReport(reportId);
    const jobShares = await sharesFor(reportId, "email");
    const observed = {
      handlerResult: result,
      obligationStatus: obligation?.status,
      reportStatus: report?.status,
      reportDeliveredAt: report?.deliveredAt ? "SET" : null,
      jobShareRows: jobShares,
      mailCarriedReportBody: mail ? (mail.html ?? "").includes(`CLINICAL-CONTENT-E2-${marker}`) : null,
    };
    const evidence = `OBSERVED ${JSON.stringify(observed)}`;

    // The control half: with a real render the mail does carry the report.
    expect(mail, `${evidence} — no email was handed to the transport`).not.toBeNull();
    expect(mail!.html ?? "", `${evidence}`).toContain(`CLINICAL-CONTENT-E2-${marker}`);

    // THE RULE THIS FILE EXISTS FOR — evidence, not optimism. Before the fix
    // `sendReportEmail()` returned `{ok:true}` with NO field that could carry
    // delivery evidence, so this branch could not tell a real send from test 3a's
    // content-free one and booked both as delivered. It now reads the SMTP
    // acceptance id: a message the server named is a delivery (asserted below),
    // and one it did not is not. Test 3a is the other half of that sentence.
    expect(
      mail!.html ?? "",
      `${evidence} — an email booked as delivered must contain the report`,
    ).toContain(`CLINICAL-CONTENT-E2-${marker}`);
    expect(jobShares.filter((s: { status: string }) => s.status === "sent"), `${evidence}`).toHaveLength(1);
    expect(obligation?.status, `${evidence}`).toBe("completed");
    expect(report?.status, `${evidence}`).toBe("delivered");
  }, 180_000);

  it("3c. an email accepted without a message id is NOT booked as delivered", async () => {
    // The evidence half of 3b, executed: the same route, the same obligation, with
    // the transport answering as an SMTP server that took the message but named it
    // nothing. `sendReportEmail` has no id to return, so nothing may be booked.
    await setWaSettings({ shadowMode: true, testAllowlist: JSON.stringify([phoneQueuedNorm]), quietHoursStart: "", quietHoursEnd: "" });

    const reportId = await newVerifiedReport("E3");
    const sourceShareId = await newSourceShare(reportId, "email", emailRecipient);
    const obligationId = await newObligation({ reportId, channel: "email", recipient: emailRecipient, sourceShareId });

    // Nodemailer's real success shape, minus the id — not a hand-invented error.
    mailSink.omitMessageId = true;
    try {
      await runRedeliveryHandler(obligationId);
    } finally {
      mailSink.omitMessageId = false;
    }

    const obligation = await readObligation(obligationId);
    const report = await readReport(reportId);
    const jobShares = await sharesFor(reportId, "email");
    const evidence = `OBSERVED obligation=${obligation?.status} report=${report?.status} shares=${JSON.stringify(jobShares)}`;
    expect(jobShares.filter((s: { status: string }) => s.status === "sent"), `${evidence}`).toHaveLength(0);
    expect(["sent", "completed"], `${evidence}`).not.toContain(obligation?.status);
    expect(report?.status, `${evidence}`).toBe("verified");
    expect(report?.deliveredAt, `${evidence}`).toBeNull();
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 4. PDF BEFORE BYTES
  // ─────────────────────────────────────────────────────────────────────────
  it("4. GET /:id/pdf must not log a pdf share or stamp delivered before PDF bytes exist", async () => {
    const reportId = await newVerifiedReport("P");

    // Control: the route renders normally with the real renderer, so the state
    // below is attributable to the render and not to a broken fixture.
    const ok = await request(app).get(`/api/patient-reports/${reportId}/pdf`).set(auth);
    const okBytes = Buffer.isBuffer(ok.body) ? ok.body.length : String(ok.text ?? "").length;
    expect(ok.status, `control render failed (status ${ok.status}, ${String(ok.text ?? "").slice(0, 200)})`).toBe(200);
    expect(okBytes, "control produced no PDF bytes").toBeGreaterThan(1000);
    await db.delete(reportSharesTable).where(eq(reportSharesTable.reportId, reportId)).catch(() => {});
    await db.update(patientReportsTable).set({ status: "verified", deliveredAt: null }).where(eq(patientReportsTable.id, reportId));

    // Fault: headless Chromium dies before producing bytes.
    pdfFault.fails = true;
    let res: { status: number; text: string; body: unknown } | null = null;
    try {
      res = await request(app).get(`/api/patient-reports/${reportId}/pdf`).set(auth);
    } catch (err) {
      res = { status: 0, text: String(err), body: null };
    } finally {
      pdfFault.fails = false;
    }

    const shares = await db
      .select({ id: reportSharesTable.id, channel: reportSharesTable.channel, status: reportSharesTable.status, errorMessage: reportSharesTable.errorMessage })
      .from(reportSharesTable)
      .where(eq(reportSharesTable.reportId, reportId));
    const report = await readReport(reportId);
    const evidence = `OBSERVED http=${res?.status} shares=${JSON.stringify(shares)} report=${JSON.stringify(report)}`;

    // No PDF reached the caller…
    expect(res!.status, `${evidence} — the route unexpectedly returned a PDF`).toBeGreaterThanOrEqual(400);

    // …so nothing may claim it did.
    expect(shares.filter((s: { channel: string }) => s.channel === "pdf"), `${evidence}`).toHaveLength(0);
    expect(report?.status, `${evidence}`).toBe("verified");
    expect(report?.deliveredAt, `${evidence}`).toBeNull();
  }, 240_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 5. (supporting) the link the WhatsApp re-delivery message carries
  // ─────────────────────────────────────────────────────────────────────────
  it("5. the patient link the job sends must be openable by a patient without staff auth", async () => {
    // Same drive as test 1 (the send is queued, so nothing leaves the machine),
    // then what the job actually put in the patient's message.
    const qh = quietHoursAroundNow();
    await setWaSettings({
      shadowMode: false,
      testAllowlist: JSON.stringify([phoneQueuedNorm]),
      quietHoursStart: qh.start,
      quietHoursEnd: qh.end,
    });

    const reportId = await newVerifiedReport("L");
    const sourceShareId = await newSourceShare(reportId, "whatsapp", phoneQueuedRaw);
    const obligationId = await newObligation({ reportId, channel: "whatsapp", recipient: phoneQueuedRaw, sourceShareId });
    await runRedeliveryHandler(obligationId);

    const [outboxRow] = await db
      .select({ payloadJson: waOutboxTable.payloadJson })
      .from(waOutboxTable)
      .where(eq(waOutboxTable.recipientPhone, phoneQueuedNorm));
    const payload = outboxRow?.payloadJson ?? "";
    const staffRouteCalled = payload.includes("/api/patient-reports/");
    const [reportTokenRow] = await db
      .select({ token: patientReportsTable.publicToken, expiresAt: patientReportsTable.publicTokenExpiresAt })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportId));
    const token = reportTokenRow?.token ?? null;
    const anonymous = token
      ? await request(app).get(`/api/p/r/${token}/pdf`)
      : { status: 0, text: "no token was minted", body: null };
    const evidence =
      `OBSERVED payloadHasStaffRoute=${staffRouteCalled} payloadHasPublicTokenLink=${payload.includes("/api/p/r/")} ` +
      `token=${token ? token.slice(0, 6) + "…" : null} expiresAt=${reportTokenRow?.expiresAt ? "SET" : null} ` +
      `anonymousOpenStatus=${anonymous.status}`;

    // The link the patient is handed is the tokenized public door, and it opens
    // for someone with no staff session at all.
    expect(staffRouteCalled, `${evidence} — the job sent a staff-authenticated URL` ).toBe(false);
    expect(token, `${evidence} — no public token on the report the job delivered`).not.toBeNull();
    expect(anonymous.status, `${evidence} — a patient tapping the link did not get their report`)
      .toBe(200);
    const bytes = Buffer.isBuffer(anonymous.body) ? anonymous.body.length : String(anonymous.text ?? "").length;
    expect(bytes, `${evidence} — the patient link served no PDF bytes`).toBeGreaterThan(1000);

    // The staff PDF route stays staff-only — fixing the link must not open it.
    const staffRouteAnonymous = await request(app).get(`/api/patient-reports/${reportId}/pdf`);
    expect([401, 403], `OBSERVED staff route anonymous status=${staffRouteAnonymous.status}`).toContain(staffRouteAnonymous.status);
  }, 180_000);
});
