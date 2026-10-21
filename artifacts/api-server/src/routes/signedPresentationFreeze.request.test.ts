/**
 * PR-B — a signed report's signer block and template are frozen with it.
 * NOT COMMITTED scratch harness lives outside this file; this file is the shipped test.
 *
 * The property under test is narrow and clinical: after a report has been signed,
 * editing the clinic's institutional style row — or naming another template in the
 * print URL — must not change what the signed document says about who signed it.
 * Measured on main before this rule existed, flipping the live flags re-rendered a
 * VERIFIED report's PDF (683,448 → 681,386 bytes) without `Reg. No:` or either
 * timestamp, and one published throwaway template erased the signer's name,
 * qualification and registration number altogether.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable,
  patientReportsTable,
  portalSessionsTable,
  radiologyInstitutionalStylesTable,
  radiologyReportPresentationFreezeTable,
  signaturesTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { resolveTemplateForRender } from "../lib/presentationTemplateStore";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

const REG_NO = `REG-FREEZE-${randomUUID().slice(0, 6).toUpperCase()}`;
const SIGNER_NAME = `Dr. Freeze Probe ${randomUUID().slice(0, 6)}`;

describe.skipIf(!dbReady)("signed report presentation freeze — request level", () => {
  let app: Express;
  const marker = randomUUID().slice(0, 8);
  const signerToken = `freeze-token-${randomUUID()}`;
  let patientId = 0;
  let testId = 0;
  let signatureId = 0;
  const reportIds: number[] = [];
  let styleRowId = 0;
  /** The style row exactly as the rig had it, so nothing is left edited. */
  let styleBefore: typeof radiologyInstitutionalStylesTable.$inferSelect | null = null;

  async function makeStaff(name: string, token: string) {
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${name.replace(/\W+/g, "-").toLowerCase()}@vitest.invalid`,
        username: `${name}-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/reports:verify", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return user.id;
  }

  /** The six signer display flags on the clinic's one live style row. */
  async function setStyleFlags(flags: Record<string, boolean>) {
    await db.update(radiologyInstitutionalStylesTable).set(flags).where(eq(radiologyInstitutionalStylesTable.id, styleRowId));
  }

  async function newDraft(title: string): Promise<number> {
    const res = await request(app)
      .post("/api/patient-reports")
      .set("Authorization", `Bearer ${signerToken}`)
      .send({
        type: "radiology",
        patientId,
        testId,
        title,
        body: "Synthetic findings for the presentation-freeze probe.",
        impression: "Synthetic impression.",
      });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`POST /api/patient-reports → ${res.status}: ${res.text}`);
    }
    reportIds.push(res.body.id);
    return res.body.id as number;
  }

  async function printHtml(id: number, query = "") {
    const res = await request(app)
      .get(`/api/patient-reports/${id}/print${query}`)
      .set("Authorization", `Bearer ${signerToken}`);
    expect(res.status).toBe(200);
    return String(res.text);
  }

  async function freezeRow(id: number) {
    const [row] = await db
      .select()
      .from(radiologyReportPresentationFreezeTable)
      .where(eq(radiologyReportPresentationFreezeTable.reportId, id));
    return row ?? null;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await makeStaff(SIGNER_NAME, signerToken);

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `FREEZE-${marker}`,
        firstName: "Freeze",
        lastName: `Probe ${marker}`,
        dateOfBirth: "1970-03-04",
        gender: "male",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `MRIF${marker.slice(0, 4).toUpperCase()}`,
        price: "1000",
        category: "Radiology",
        department: "Radiology",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;

    const [sig] = await db
      .insert(signaturesTable)
      .values({
        name: SIGNER_NAME,
        role: "Radiologist",
        qualification: "MD Radiodiagnosis",
        registrationNo: REG_NO,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    signatureId = sig.id;

    // The renderer reads the clinic's single style row with an unordered limit(1), so
    // the test needs it to be exactly one row and to know what it was beforehand.
    const rows = await db.select().from(radiologyInstitutionalStylesTable).limit(2);
    if (rows.length > 1) throw new Error(`expected at most one institutional style row, found ${rows.length}`);
    if (rows.length === 1) {
      styleRowId = rows[0].id;
      styleBefore = { ...rows[0] };
    } else {
      const [created] = await db
        .insert(radiologyInstitutionalStylesTable)
        .values({ presetName: `Freeze Probe ${marker}` })
        .returning();
      styleRowId = created.id;
    }
    await setStyleFlags({
      showRadiologistName: true,
      showDegree: true,
      showRegNumber: true,
      showDigitalSignature: true,
      showTimestamp: true,
      showQrVerification: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (styleBefore) {
      await db
        .update(radiologyInstitutionalStylesTable)
        .set({
          presetName: styleBefore.presetName,
          fontSize: styleBefore.fontSize,
          spacing: styleBefore.spacing,
          showRadiologistName: styleBefore.showRadiologistName,
          showDegree: styleBefore.showDegree,
          showRegNumber: styleBefore.showRegNumber,
          showDigitalSignature: styleBefore.showDigitalSignature,
          showTimestamp: styleBefore.showTimestamp,
          showQrVerification: styleBefore.showQrVerification,
        })
        .where(eq(radiologyInstitutionalStylesTable.id, styleRowId));
    } else if (styleRowId) {
      await db.delete(radiologyInstitutionalStylesTable).where(eq(radiologyInstitutionalStylesTable.id, styleRowId));
    }
    for (const id of reportIds) {
      await db.delete(radiologyReportPresentationFreezeTable).where(eq(radiologyReportPresentationFreezeTable.reportId, id));
      await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id));
    }
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId));
    await db.delete(testsTable).where(eq(testsTable.id, testId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, signerToken));
    await db.delete(usersTable).where(eq(usersTable.name, SIGNER_NAME));
  });

  it("captures the six flags into the freeze snapshot at the signing event", async () => {
    const id = await newDraft("Freeze probe capture");
    const signed = await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });
    expect(signed.status).toBe(200);

    const freeze = await freezeRow(id);
    expect(freeze, "signing must write a presentation freeze").not.toBeNull();
    const snap = freeze!.snapshot as { signerDisplay?: Record<string, unknown> };
    expect(snap.signerDisplay).toMatchObject({
      showRadiologistName: true,
      showDegree: true,
      showRegNumber: true,
      showDigitalSignature: true,
      showTimestamp: true,
      showQrVerification: true,
    });
    expect(new Date(String(snap.signerDisplay!.capturedAt)).toISOString()).toBe(snap.signerDisplay!.capturedAt);
  });

  it("a signed report keeps printing its signer identity after the clinic turns those lines off", async () => {
    const id = await newDraft("Freeze probe signed");
    await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });

    const beforeHtml = await printHtml(id, "?preview=true");
    expect(beforeHtml).toContain("Reg. No:");
    expect(beforeHtml).toContain(SIGNER_NAME);

    await setStyleFlags({ showRadiologistName: false, showRegNumber: false, showTimestamp: false });

    const afterHtml = await printHtml(id, "?preview=true");
    expect(afterHtml).toContain("Reg. No:");
    expect(afterHtml).toContain(SIGNER_NAME);
  });

  it("control: a signed report with NO freeze row still follows the clinic's live style", async () => {
    // The reports signed before this capture existed keep today's behaviour — and
    // proving that here is what shows the frozen snapshot, not some other mechanism,
    // is what protects the signed one above.
    const id = await newDraft("Freeze probe fallback");
    await setStyleFlags({ showRadiologistName: true, showRegNumber: true, showTimestamp: true });
    await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });
    expect(await printHtml(id, "?preview=true")).toContain("Reg. No:");

    await db
      .delete(radiologyReportPresentationFreezeTable)
      .where(eq(radiologyReportPresentationFreezeTable.reportId, id));
    await setStyleFlags({ showRadiologistName: false, showRegNumber: false, showTimestamp: false });

    const live = await printHtml(id, "?preview=true");
    expect(live).not.toContain("Reg. No:");
    expect(live).not.toContain(SIGNER_NAME);
  });

  it("?template= cannot restyle or blank out a signed report, and still works on a draft", async () => {
    const signedId = await newDraft("Freeze probe pinned");
    await setStyleFlags({ showRadiologistName: true, showRegNumber: true, showTimestamp: true });
    await request(app)
      .post(`/api/patient-reports/${signedId}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });
    const draftId = await newDraft("Freeze probe unpinned");

    const freeze = await freezeRow(signedId);
    expect(freeze).not.toBeNull();

    // Publish a template that hides the whole signature block, built from the
    // definition this report was signed under so it is a valid definition — the same
    // shape measured live on main, where it erased the name, qualification and
    // registration number from a VERIFIED report's PDF.
    const PROBE = "pi-probe";
    await db.execute(sql`
      insert into radiology_presentation_templates
        (template_key, version, display_name, description, org_scope, copy_type, status,
         renderer_version, is_system, created_by, definition)
      select ${PROBE}, 1, 'Freeze probe template', 'hides the signature block',
             'clinic', 'standard', 'published', 1, false, 'freeze-probe',
             jsonb_set(snapshot->'definition', '{signature,show}', 'false'::jsonb)
      from radiology_report_presentation_freeze where report_id = ${signedId}
      on conflict do nothing`);

    const pinned = await resolveTemplateForRender({ explicit: `${PROBE}@1`, reportId: signedId, copyType: "standard" });
    expect(pinned.templateKey).toBe(freeze!.templateKey);

    const over = await printHtml(signedId, `?preview=true&template=${PROBE}`);
    expect(over).toContain("Reg. No:");
    expect(over).toContain(SIGNER_NAME);

    // A draft has nothing frozen, so the same parameter still reaches it.
    const draftTemplate = await resolveTemplateForRender({ explicit: `${PROBE}@1`, reportId: draftId, copyType: "standard" });
    expect(draftTemplate.templateKey).toBe(PROBE);
    expect(await freezeRow(draftId)).toBeNull();

    await db.execute(sql`delete from radiology_presentation_templates where template_key = ${PROBE}`);
  });

  it("a later signature edit cannot rewrite the snapshot that was already taken", async () => {
    const id = await newDraft("Freeze probe immutable");
    await setStyleFlags({ showRadiologistName: true, showDegree: true, showRegNumber: true, showTimestamp: true, showDigitalSignature: true, showQrVerification: true });
    await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });
    const first = await freezeRow(id);
    expect(first).not.toBeNull();

    // A second sign event on the same row must not re-capture today's configuration
    // over the signed moment's — the snapshot is written once.
    await setStyleFlags({ showRadiologistName: false, showDegree: false, showRegNumber: false });
    await db.update(patientReportsTable)
      .set({ status: "draft", signatureId: null, signedAt: null })
      .where(eq(patientReportsTable.id, id));
    await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });

    const again = await freezeRow(id);
    expect(again!.createdAt.getTime()).toBe(first!.createdAt.getTime());
    const snap = again!.snapshot as { signerDisplay?: { showRegNumber?: boolean } };
    expect(snap.signerDisplay!.showRegNumber).toBe(true);
  });

  it("the freeze is per report, not global", async () => {
    await setStyleFlags({ showRadiologistName: true, showDegree: true, showRegNumber: true, showTimestamp: true, showDigitalSignature: true, showQrVerification: true });
    const a = await newDraft("Freeze probe per-report A");
    const b = await newDraft("Freeze probe per-report B");
    await request(app).post(`/api/patient-reports/${a}/sign`).set("Authorization", `Bearer ${signerToken}`).send({ signatureId });
    await setStyleFlags({ showRadiologistName: false, showDegree: false, showRegNumber: false, showTimestamp: false, showDigitalSignature: false, showQrVerification: false });
    await request(app).post(`/api/patient-reports/${b}/sign`).set("Authorization", `Bearer ${signerToken}`).send({ signatureId });

    const snapA = (await freezeRow(a))!.snapshot as { signerDisplay: Record<string, unknown> };
    const snapB = (await freezeRow(b))!.snapshot as { signerDisplay: Record<string, unknown> };
    expect(snapA.signerDisplay.showRegNumber).toBe(true);
    expect(snapB.signerDisplay.showRegNumber).toBe(false);

    // and each renders from its own snapshot
    expect(await printHtml(a, "?preview=true")).toContain("Reg. No:");
    expect(await printHtml(b, "?preview=true")).not.toContain("Reg. No:");
  });

  // ── Print Preview ± typography (the same freeze rule, one step at a time) ───
  // The client control sends `fontSizeSteps`/`spacingSteps` on this very URL.
  // Only executing the route shows the two halves actually meet: a unit test on
  // `buildInstitutionalStyleCss` would stay green while the route dropped the
  // query, exactly like the billing endpoint that returned 500 behind a passing
  // source-text assertion.

  /**
   * The institutional body rule's font size. The document carries more than one
   * rule matching `body, .body` — the template's own, then the institutional
   * overrides appended last — so the LAST one is the one under test.
   */
  function bodyFont(html: string): string {
    const all = Array.from(html.matchAll(/body, \.body \{([^}]*)\}/g));
    const last = all[all.length - 1];
    if (!last) throw new Error("no institutional body rule in the rendered print HTML");
    const m = /font-size:\s*([^;!]+)/.exec(last[1]);
    if (!m) throw new Error("institutional body rule carries no font-size");
    return m[1].trim();
  }

  async function setStyleType(fontSize: string, spacing: string) {
    await db
      .update(radiologyInstitutionalStylesTable)
      .set({ fontSize, spacing })
      .where(eq(radiologyInstitutionalStylesTable.id, styleRowId));
  }

  it("an unsigned report served from the print route renders the stepped size", async () => {
    await setStyleType("standard", "standard");
    const id = await newDraft("Format probe unsigned");
    const base = await printHtml(id, "?preview=true");
    const smaller = await printHtml(id, "?preview=true&fontSizeSteps=-2");
    const larger = await printHtml(id, "?preview=true&fontSizeSteps=2&spacingSteps=1");

    expect(bodyFont(base)).toBe("14px");
    expect(bodyFont(smaller)).toBe("12px");
    expect(bodyFont(larger)).toBe("16px");

    // The clinic prints on the CARE letter-pad, whose chrome pins
    // `.letterpad .body { font-size: 10pt !important }` at higher specificity
    // than the rule above AND is appended after it. Measured in Chromium: with
    // only the Style-row rule present, the report body stayed at 13.3333px for
    // every step — the control moved a declaration nothing read. So a stepped
    // letter-pad report must also carry the step against that pin. Asserted
    // conditionally because which template is active is clinic data, not a
    // constant this rig controls.
    if (smaller.includes('class="report-wrapper letterpad"')) {
      expect(smaller).toContain("body .letterpad .body { font-size: calc(10pt - 2px) !important; }");
      expect(base).not.toContain("calc(10pt");
    }

    // The step moved the body text without touching the clinic's row.
    const [row] = await db
      .select({ fontSize: radiologyInstitutionalStylesTable.fontSize })
      .from(radiologyInstitutionalStylesTable)
      .where(eq(radiologyInstitutionalStylesTable.id, styleRowId));
    expect(row.fontSize).toBe("standard");
  });

  it("a signed report is served the same bytes whatever the URL asks for", async () => {
    await setStyleType("standard", "standard");
    const id = await newDraft("Format probe signed");
    await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });
    expect(await freezeRow(id)).not.toBeNull();

    const asSigned = await printHtml(id, "?preview=true");
    expect(bodyFont(asSigned)).toBe("14px");
    for (const q of ["&fontSizeSteps=-4", "&fontSizeSteps=4&spacingSteps=4", "&fontSizeSteps=999"]) {
      expect(bodyFont(await printHtml(id, `?preview=true${q}`)), `nudge ${q} must not reach a signed report`)
        .toBe("14px");
    }
  });

  it("control: a signed report whose freeze row is gone still refuses the nudge", async () => {
    // The freeze read is best-effort (`.catch(() => null)`), so refusing only on
    // a freeze row would let a database hiccup resize a document that was
    // authorized at a size. `isSignedArtifact` is the second witness.
    await setStyleType("standard", "standard");
    const id = await newDraft("Format probe freeze lost");
    await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId });
    await db
      .delete(radiologyReportPresentationFreezeTable)
      .where(eq(radiologyReportPresentationFreezeTable.reportId, id));
    expect(await freezeRow(id)).toBeNull();

    expect(bodyFont(await printHtml(id, "?preview=true&fontSizeSteps=-3"))).toBe("14px");

    // And the same row, put back to a draft, does take the step — proving the
    // refusal above comes from the signature and not from something stuck.
    await db
      .update(patientReportsTable)
      .set({ status: "draft", signedAt: null, signatureId: null })
      .where(eq(patientReportsTable.id, id));
    expect(bodyFont(await printHtml(id, "?preview=true&fontSizeSteps=-3"))).toBe("11px");
  });
});
