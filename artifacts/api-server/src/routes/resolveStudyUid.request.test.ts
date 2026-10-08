/**
 * D1 — request-level proof of the StudyInstanceUID binding rule.
 *
 * WHY THIS FILE EXISTS NEXT TO THE PURE TESTS
 * studyUidBinding.test.ts proves the decision. It cannot prove that the route
 * actually reaches that decision, that the conditional UPDATE is the shape it
 * claims, or that study_uid_provenance is a real Postgres column that survives
 * the API. Those are exactly the three things a source-text grep passes while
 * production returns 500 (the failure this repository's harness was written
 * for). So this file executes POST /api/radiology/pacs-worklist/:id/
 * resolve-study-uid and GET .../pacs-worklist/:id against a real database.
 *
 * DATABASE_ONLY: skipped when DATABASE_URL is unset, like every
 * *.request.test.ts. CI provides the database, and CI is also the only place
 * migrations/zzzzzzzzzz_study_uid_provenance.sql is applied for real.
 *
 * Orthanc is deliberately NOT mocked. Every case here is a fail-closed case —
 * the resolver must write nothing — and with no archive configured the only way
 * it could write is by guessing, which is the defect. The positive binding case
 * (exact accession -> RESOLVED) is covered purely, where the candidate list can
 * be controlled exactly; inventing an HTTP stub would test the stub.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  radiologyWorklistTable,
  usersTable,
  portalSessionsTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { STUDY_UID_PROVENANCE } from "../lib/pacs/studyUidBinding";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)(
  "D1 resolve-study-uid writes nothing it cannot prove",
  () => {
    let app: Express;
    const marker = `d1uid-${randomUUID().slice(0, 8)}`;
    const token = `vitest-token-${randomUUID()}`;
    let userId = 0;
    const createdWorklistIds: number[] = [];

    beforeAll(async () => {
      app = await createTestApp();
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `D1 Uid ${marker}`,
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
      for (const id of createdWorklistIds) {
        await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
      }
      await db
        .delete(radiologyWorklistTable)
        .where(like(radiologyWorklistTable.patientName, `%${marker}%`))
        .catch(() => {});
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
      await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    }, 60_000);

    async function makeRow(fields: Partial<{
      accessionNumber: string;
      studyInstanceUID: string | null;
      studyUidProvenance: string | null;
      dicomPatientId: string | null;
    }>) {
      // accession_number is NOT NULL in the shipped DDL
      // (lib/db/drizzle/0000_dear_forge.sql:1545, and CI/bootstrap enforce it)
      // even though the Drizzle model declares it nullable — so an
      // "accession-less" row is the empty string, never SQL NULL.
      const [row] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `UNRESOLVED^TEST ${marker}`,
          modality: "MR",
          studyDate: "20260315",
          ...fields,
        })
        .returning();
      createdWorklistIds.push(row.id);
      return row;
    }

    const resolve = (id: number) =>
      request(app)
        .post(`/api/radiology/pacs-worklist/${id}/resolve-study-uid`)
        .set({ "Content-Type": "application/json", Authorization: `Bearer ${token}` })
        .send({});

    const readRow = async (id: number) => {
      const [wl] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, id));
      return wl;
    };

    test("a row with no accession is left unbound — no name search, no write", async () => {
      const row = await makeRow({ accessionNumber: "", studyInstanceUID: null });
      const res = await resolve(row.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("unresolved");
      expect(res.body.reason).toBe("no-strong-identifier");
      expect(res.body.studyInstanceUID).toBeNull();
      expect(res.body.updated).toBe(false);

      const after = await readRow(row.id);
      expect(after.studyInstanceUID).toBeNull();
      expect(after.studyUidProvenance).toBeNull();
    });

    test("a whitespace-only accession is the same no-identifier row, not a searchable one", async () => {
      // A modality or a manual booking can leave "   " behind. The resolver must
      // not treat that as an accession worth querying: a blank query degenerates
      // into the name/date search this change removed.
      const row = await makeRow({ accessionNumber: "   ", studyInstanceUID: null });
      const res = await resolve(row.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("unresolved");
      expect(res.body.reason).toBe("no-strong-identifier");
      expect(res.body.studyInstanceUID).toBeNull();
      expect(res.body.updated).toBe(false);

      const after = await readRow(row.id);
      expect(after.studyInstanceUID).toBeNull();
      expect(after.studyUidProvenance).toBeNull();
    });

    test("an accession with no archive behind it is left unbound, not guessed", async () => {
      const row = await makeRow({ accessionNumber: `ACC-${marker}-NOARCH`, studyInstanceUID: null });
      const res = await resolve(row.id);

      // 502 = the archive was unreachable; 200/unresolved = reachable but no
      // proven candidate. Both are correct fail-closed outcomes. Anything else,
      // or any UID on the row, means the resolver picked a study it could not
      // identify.
      expect([200, 502]).toContain(res.status);
      if (res.status === 200) {
        expect(["unresolved", "ambiguous", "conflict"]).toContain(res.body.status);
        expect(res.body.studyInstanceUID).toBeNull();
      }

      const after = await readRow(row.id);
      expect(after.studyInstanceUID).toBeNull();
      expect(after.studyUidProvenance).toBeNull();
    });

    test("D1-07 an already-bound row is never re-pointed", async () => {
      const row = await makeRow({
        accessionNumber: `ACC-${marker}-BOUND`,
        studyInstanceUID: `1.2.840.${marker}.existing`,
        studyUidProvenance: STUDY_UID_PROVENANCE.pacsIntake,
      });
      const res = await resolve(row.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("resolved");
      expect(res.body.studyInstanceUID).toBe(`1.2.840.${marker}.existing`);
      expect(res.body.provenance).toBe(STUDY_UID_PROVENANCE.pacsIntake);
      expect(res.body.reason).toBe("already-bound");
      expect(res.body.updated).toBe(false);

      const after = await readRow(row.id);
      expect(after.studyInstanceUID).toBe(`1.2.840.${marker}.existing`);
      expect(after.studyUidProvenance).toBe(STUDY_UID_PROVENANCE.pacsIntake);
    });

    test("D1-08 a historical binding stays unknown instead of being relabelled", async () => {
      // Exactly the shape every row in the clinic has today: a UID and no
      // provenance. It must remain usable AND remain unexplained.
      const row = await makeRow({
        accessionNumber: `ACC-${marker}-LEGACY`,
        studyInstanceUID: `1.2.840.${marker}.legacy`,
        studyUidProvenance: null,
      });
      const res = await resolve(row.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("resolved");
      expect(res.body.studyInstanceUID).toBe(`1.2.840.${marker}.legacy`);
      expect(res.body.provenance).toBeNull();

      const detail = await request(app)
        .get(`/api/radiology/pacs-worklist/${row.id}`)
        .set({ Authorization: `Bearer ${token}` });
      expect(detail.status).toBe(200);
      expect("studyUidProvenance" in detail.body).toBe(true);
      expect(detail.body.studyUidProvenance).toBeNull();
    });

    test("D1-12 a recorded provenance round-trips through the API", async () => {
      const row = await makeRow({
        accessionNumber: `ACC-${marker}-PROV`,
        studyInstanceUID: `1.2.840.${marker}.prov`,
        studyUidProvenance: STUDY_UID_PROVENANCE.accessionExact,
      });

      // The column exists in a real database and accepts the value the module
      // owns — this is the migration being executed, not asserted about.
      const after = await readRow(row.id);
      expect(after.studyUidProvenance).toBe(STUDY_UID_PROVENANCE.accessionExact);

      const detail = await request(app)
        .get(`/api/radiology/pacs-worklist/${row.id}`)
        .set({ Authorization: `Bearer ${token}` });
      expect(detail.status).toBe(200);
      expect(detail.body.studyInstanceUID).toBe(`1.2.840.${marker}.prov`);
      expect(detail.body.studyUidProvenance).toBe(STUDY_UID_PROVENANCE.accessionExact);
    });

    test("an unknown worklist id does not resolve to any study", async () => {
      const res = await resolve(999_999_999);
      expect(res.status).toBe(404);
      expect(res.body.studyInstanceUID ?? null).toBeNull();
    });
  },
);
