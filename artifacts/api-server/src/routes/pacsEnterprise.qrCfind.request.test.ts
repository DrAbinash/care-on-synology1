/**
 * A1 (second site) — request-level proof that the PACS query/retrieve search
 * page's Orthanc REST branch sends a canonical /tools/find body.
 *
 * The /qr-cfind route carried its own copy of the malformed study query — the
 * DIMSE C-FIND retrieve-level tag placed inside the REST `Query` object —
 * duplicating the defect fixed in lib/pacs/orthancStudyFind.ts. Strategy 2
 * (findscu) legitimately uses `QueryRetrieveLevel=STUDY` as a DIMSE -k key;
 * that line must survive this fix untouched. These tests capture the actual
 * outgoing HTTP request so the two transports cannot regress into each other
 * again.
 *
 * DATABASE_ONLY: skipped when DATABASE_URL is unset, like every
 * *.request.test.ts (staff auth needs the portal sessions table).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import { usersTable, portalSessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const source = readFileSync(join(__dirname, "./pacsEnterprise.ts"), "utf8");

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("A1 /qr-cfind Orthanc REST branch request shape", () => {
  let app: Express;
  const marker = `qrcfind-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;

  let captured: Array<{ url: string; method: string; body: unknown }>;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `QR Cfind ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology"]),
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
  }, 60_000);

  afterAll(async () => {
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  }, 60_000);

  beforeEach(() => {
    process.env.ORTHANC_URL = "http://orthanc:8042";
    process.env.ORTHANC_USERNAME = "";
    process.env.ORTHANC_PASSWORD = "";
    captured = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      captured.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.endsWith("/tools/find")) {
        return new Response(
          JSON.stringify([
            {
              MainDicomTags: {
                StudyInstanceUID: "1.2.840.1.20261021.qr.1",
                AccessionNumber: "ACC-QR-01",
                StudyDate: "20261021",
                StudyDescription: "MRI BRAIN",
                ReferringPhysicianName: "DR^SITA",
                ModalitiesInStudy: "MR",
              },
              PatientMainDicomTags: { PatientName: "GEETA^DEVI" },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORTHANC_URL;
    delete process.env.ORTHANC_USERNAME;
    delete process.env.ORTHANC_PASSWORD;
  });

  const get = (query: string) =>
    request(app)
      .get(`/api/radiology/qr-cfind?${query}`)
      .set({ Authorization: `Bearer ${token}` });

  test("sends Level top-level and a C-FIND-free Query, and maps the archive answer", async () => {
    const res = await get(
      "dateFrom=2026-01-01&dateTo=2026-01-31&patientName=kumar&modality=MR",
    );
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ORTHANC_REST");

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("http://orthanc:8042/tools/find");
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.Level).toBe("Study");
    expect(body.Query).toEqual({
      StudyDate: "20260101-20260131",
      PatientName: "*kumar*",
      ModalitiesInStudy: "MR",
    });
    expect(Object.keys(body.Query as Record<string, unknown>)).not.toContain(
      "QueryRetrieveLevel",
    );

    const study = res.body.studies[0] as Record<string, unknown>;
    expect(study.studyInstanceUID).toBe("1.2.840.1.20261021.qr.1");
    expect(study.accessionNumber).toBe("ACC-QR-01");
    expect(study.patientName).toBe("GEETA^DEVI");
    expect(study.referringDoctor).toBe("DR^SITA");
    expect(res.body.total).toBe(1);
  });

  test("read-only: a search touches only /tools/find — no DICOM-write route", async () => {
    await get("date=2026-10-21&accessionNumber=ACC-1");
    const writeRoutes = captured.filter((r) =>
      /\/studies\/[^/]+\/(modify|store|anonymize|split|merge)$|\/modalities\/[^/]+\/store$/.test(r.url),
    );
    expect(writeRoutes).toEqual([]);
  });

  test("findscu's DIMSE -k QueryRetrieveLevel key is preserved (correct usage, different transport)", () => {
    expect(source).toContain('"-k", "QueryRetrieveLevel=STUDY"');
    // …while the REST branch must never carry the C-FIND tag in a Query object.
    expect(source).not.toContain('QueryRetrieveLevel: "STUDY"');
  });
});
