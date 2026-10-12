/**
 * The migration chain must leave a database the routes can actually use.
 * ==========================================================================
 * Every endpoint below reads a table with `db.select()`, which names every
 * column the Drizzle schema declares. Fifty-two of those columns — across six
 * tables, two of them whole tables — were declared and written by route code
 * but created by no migration, so on a database built the way the clinic builds
 * it (`db:bootstrap`, `care-db-patch-v2`) each request died on Postgres 42703
 * undefined_column / 42P01 undefined_table and the API answered HTTP 500.
 *
 * These are request-level on purpose. A source-text assertion ("some migration
 * mentions usage_count") is satisfied by a comment; only running the route
 * proves the column is in the database the deployment actually produced.
 *
 * lib/db/src/schema/migrationColumnParity.test.ts is the companion guard: it
 * fails for ANY table whose declared columns the chain does not create, so the
 * next schema change that skips its migration cannot land silently.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  purchaseInvoiceLineItemsTable,
  purchaseInvoicesTable,
  radiologyChocolateFindingsTable,
  radiologySnippetsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const marker = `VITESTPARITY-${randomUUID().slice(0, 8)}`;
const token = `vitest-token-${randomUUID()}`;

/** The two Postgres errors that mean "the schema the code expects is not there". */
const SCHEMA_ERROR = /does not exist|undefined_column|undefined_table|42703|42P01/i;

describe.skipIf(!hasDatabaseUrl())("routes on a migration-built database", () => {
  let app: Express;
  let userId = 0;
  let snippetId = 0;
  let findingId = 0;
  let invoiceId = 0;
  const createdSnippetIds: number[] = [];
  const createdFindingIds: number[] = [];

  /** supertest chains `.set` onto the request, not onto the agent — so bind per verb. */
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const as = () => ({
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string) => auth(request(app).post(url)),
    put: (url: string) => auth(request(app).put(url)),
  });

  /**
   * Asserts the status and, on a 5xx, says whether the database was the cause —
   * several of these handlers swallow the real error into a generic sentence
   * ("Failed to save invoice"), and the sentence alone is not evidence.
   */
  const ok = (res: request.Response, expected: number, label: string) => {
    const detail = JSON.stringify(res.body ?? res.text ?? "").slice(0, 300);
    if (res.status >= 500) {
      expect(
        SCHEMA_ERROR.test(detail),
        `${label}: HTTP ${res.status} — schema gap? ${detail}`,
      ).toBe(false);
      expect.unreachable(`${label}: HTTP ${res.status} ${detail}`);
    }
    expect(res.status, `${label} :: ${detail}`).toBe(expected);
    return res.body;
  };

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Parity ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/inventory", "/settings", "/report-generator"]),
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    if (createdSnippetIds.length) {
      await db.delete(radiologySnippetsTable).where(inArray(radiologySnippetsTable.id, createdSnippetIds));
    }
    if (createdFindingIds.length) {
      await db.delete(radiologyChocolateFindingsTable).where(inArray(radiologyChocolateFindingsTable.id, createdFindingIds));
    }
    if (invoiceId) {
      await db.delete(purchaseInvoiceLineItemsTable).where(eq(purchaseInvoiceLineItemsTable.invoiceId, invoiceId));
      await db.delete(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, invoiceId));
    }
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  // ── reads: each of these SELECTs names every declared column of its table ──

  it("GET /api/radiology/report-formats answers (radiology_snippets clinical_history_text, usage_count)", async () => {
    ok(await as().get("/api/radiology/report-formats"), 200, "report-formats list");
  });

  it("GET /api/radiology/chocolate-findings answers (radiology_chocolate_findings ownership columns)", async () => {
    ok(await as().get("/api/radiology/chocolate-findings"), 200, "chocolate findings list");
  });

  it("GET /api/radiology/institutional-style answers (radiology_institutional_styles presentation columns)", async () => {
    const body = ok(await as().get("/api/radiology/institutional-style"), 200, "institutional style");
    // The route substitutes a built-in default when no row exists; either way the
    // presentation fields the report template reads must be in the response.
    expect(body).toHaveProperty("imagePlacement");
    expect(body).toHaveProperty("headerRuleEnabled");
  });

  it("GET /api/purchase-invoices answers (purchase_invoices exists at all)", async () => {
    ok(await as().get("/api/purchase-invoices"), 200, "purchase invoices list");
  });

  // ── writes: a column that only reads is not the contract ──

  it("a new report format stores and returns its own clinical history", async () => {
    const body = ok(
      await as().post("/api/radiology/report-formats").send({
        name: `Parity ${marker}`,
        modality: "MR",
        bodyPart: "brain",
        clinicalHistory: "Progressive memory decline over eight months. No anticoagulant therapy.",
        findings: "No acute intracranial abnormality.",
      }),
      201,
      "report format create",
    );
    snippetId = Number(body.id);
    createdSnippetIds.push(snippetId);
    expect(body.clinicalHistory).toBe("Progressive memory decline over eight months. No anticoagulant therapy.");
    expect(body.usageCount).toBe(0);
  });

  it("using a format counts the use (usage_count is writable, not just readable)", async () => {
    expect(snippetId, "the format above must have been created").toBeGreaterThan(0);
    const body = ok(await as().post(`/api/radiology/report-formats/${snippetId}/use`), 200, "report format use");
    expect(body.usageCount).toBe(1);
  });

  it("a finding tile stores the ownership contract it was written with", async () => {
    const body = ok(
      await as().post("/api/radiology/chocolate-findings").send({
        modality: "MR",
        bodyPart: `brain-${marker}`,
        groupName: "Parity",
        shortName: "Parity normal",
        findingText: "No acute intracranial abnormality.",
        clientKey: `parity-${marker}`,
        anatomicalSection: "cerebrum",
        conflictGroup: "acute",
        baselineReplaces: "No acute intracranial abnormality.",
        supportsLaterality: true,
        sectionsOwned: "findings,impression",
      }),
      201,
      "chocolate finding create",
    );
    findingId = body.id;
    createdFindingIds.push(findingId);
    expect(body).toMatchObject({
      clientKey: `parity-${marker}`,
      anatomicalSection: "cerebrum",
      conflictGroup: "acute",
      baselineReplaces: "No acute intracranial abnormality.",
      supportsLaterality: true,
      sectionsOwned: "findings,impression",
    });
  });

  it("a tile written before the contract reads back as nothing declared, never as invented ownership", async () => {
    const rows = ok(await as().get("/api/radiology/chocolate-findings?modality=MR"), 200, "chocolate findings read");
    const mine = rows.find((r: { id: number }) => r.id === findingId);
    expect(mine.sectionsOwned).toBe("findings,impression");
    const legacy = rows.find((r: { id: number }) => r.id !== findingId);
    if (legacy) {
      // '' is the schema's own default for a tile that pre-dates the columns.
      expect(legacy.anatomicalSection).toBe("");
      expect(legacy.sectionsOwned).toBe("findings");
    }
  });

  it("a scanned supplier invoice and its lines can be created and read back", async () => {
    const body = ok(
      await as().post("/api/purchase-invoices").send({
        invoiceNumber: `PARITY-${marker}`,
        invoiceDate: "2026-10-12",
        vendorNameRaw: "Medplus Surgical Supplies",
        subtotal: 1800,
        gstAmount: 180,
        totalAmount: 1980,
        ocrConfidence: "medium",
        ocrConfidencePercent: 72,
        notes: `synthetic parity fixture ${marker}`,
        lineItems: [
          {
            descriptionRaw: "Nitrile examination gloves, box of 100",
            quantity: 12,
            unitCost: 150,
            lineTotal: 1800,
            matchConfidence: 88.5,
            lotNumber: "LOT-PARITY",
            expiryDate: "2028-01-31",
          },
        ],
      }),
      201,
      "purchase invoice create",
    );
    invoiceId = body.invoice.id;
    expect(body.invoice.status).toBe("draft");
    expect(body.invoice.vendorNameRaw).toBe("Medplus Surgical Supplies");
    expect(body.lines).toHaveLength(1);

    const read = ok(await as().get(`/api/purchase-invoices/${invoiceId}`), 200, "purchase invoice read");
    expect(read.lineItems[0].lotNumber).toBe("LOT-PARITY");
    expect(Number(read.lineItems[0].matchConfidence)).toBe(88.5);
  });

  it("the USG pipeline switch can actually be turned off and stays off", async () => {
    ok(await as().put("/api/usg-extraction/settings").send({ pipelineEnabled: false }), 200, "usg settings write");
    const body = ok(await as().get("/api/usg-extraction/settings"), 200, "usg settings read");
    expect(body.pipelineEnabled).toBe(false);
    // Leave the singleton as the rest of the suite expects it.
    ok(await as().put("/api/usg-extraction/settings").send({ pipelineEnabled: true }), 200, "usg settings restore");
  });
});
