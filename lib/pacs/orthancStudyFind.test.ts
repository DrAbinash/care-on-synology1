/**
 * A1 — Orthanc study discovery request-shape and read-only proof.
 *
 * WHY THIS FILE EXISTS
 * The live study search shipped for months with `QueryRetrieveLevel` — a
 * DIMSE C-FIND construct — buried inside the REST `Query` object, while the
 * top-level `Level` field already carries the retrieve level. Orthanc rejects
 * the query and every consumer silently degrades: worklist UID backfill (the
 * UID EmbeddedWadoViewer launches OHIF on), ephemeral ORTHANC_ONLY rows,
 * resolve-study-uid and the (dead) accession-stamping lookup. A source grep
 * cannot prove what bytes actually leave this process, so these tests capture
 * the outgoing POST /tools/find body via a fetch stub.
 *
 * READ-ONLY GUARANTEE
 * The owner's instruction for this fix is explicit: repairing discovery must
 * not accidentally activate DICOM-writing operations. The call-log assertion
 * below proves a discovery call touches exactly one endpoint — /tools/find —
 * and never /studies/{id}/modify or any other write path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findOrthancStudies,
  orthancEphemeralWorklistId,
} from "../../artifacts/api-server/src/lib/pacs/orthancStudyFind";

const source = readFileSync(
  join(__dirname, "../../artifacts/api-server/src/lib/pacs/orthancStudyFind.ts"),
  "utf8",
);

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

let captured: CapturedRequest[];
let respondWith: { status: number; json: unknown };
let fetchError: Error | null;

function installFetchStub() {
  captured = [];
  fetchError = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (fetchError) throw fetchError;
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(respondWith.json), {
      status: respondWith.status,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

beforeEach(() => {
  process.env.ORTHANC_URL = "http://orthanc:8042";
  process.env.ORTHANC_USERNAME = "user";
  process.env.ORTHANC_PASSWORD = "pass";
  respondWith = { status: 200, json: [] };
  installFetchStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ORTHANC_URL;
  delete process.env.ORTHANC_USERNAME;
  delete process.env.ORTHANC_PASSWORD;
});

describe("A1 findOrthancStudies request shape", () => {
  it("sends the retrieve level top-level and keeps the C-FIND construct out of Query", async () => {
    await findOrthancStudies({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      patientName: "kumar",
      modality: "MR",
      limit: 50,
    });

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("http://orthanc:8042/tools/find");
    expect(req.method).toBe("POST");
    const body = req.body as Record<string, unknown>;
    expect(body.Level).toBe("Study");
    expect(body.Query).toEqual({
      StudyDate: "20260101-20260131",
      PatientName: "*kumar*",
      ModalitiesInStudy: "MR",
    });
    // The DIMSE C-FIND tag must never return to the REST query object.
    expect(Object.keys(body.Query as Record<string, unknown>)).not.toContain(
      "QueryRetrieveLevel",
    );
    expect(body.Expand).toBe(true);
    // Overshoot window: limit + 50 for client-side exact filtering.
    expect(body.Limit).toBe(100);
  });

  it("wildcards accession and study-description searches", async () => {
    await findOrthancStudies({ accessionNumber: "ACC-2026-01-01", limit: 10 });
    await findOrthancStudies({ studyDescription: "brain", limit: 10 });

    const acc = (captured[0]!.body as Record<string, { AccessionNumber?: string }>);
    expect(acc.Query.AccessionNumber).toBe("*ACC-2026-01-01*");
    const desc = (captured[1]!.body as Record<string, { StudyDescription?: string }>);
    expect(desc.Query.StudyDescription).toBe("*brain*");
  });

  it("authenticates with basic auth when credentials are configured", async () => {
    await findOrthancStudies({ limit: 10 });
    const req = captured[0]!;
    expect(req.headers.Authorization).toBe(
      `Basic ${Buffer.from("user:pass").toString("base64")}`,
    );
  });

  it("keeps multi-modality filters client-side instead of in the query", async () => {
    await findOrthancStudies({ modality: "US,MR", limit: 100 });
    const body = captured[0]!.body as Record<string, Record<string, unknown>>;
    expect(body.Query).toEqual({});
    expect(body.Query.ModalitiesInStudy).toBeUndefined();
  });
});

describe("A1 read-only guarantee", () => {
  it("touches exactly one endpoint — /tools/find — and no DICOM-write route", async () => {
    await findOrthancStudies({
      dateExact: "2026-10-21",
      patientName: "demo",
      limit: 100,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("http://orthanc:8042/tools/find");
    // Explicit tripwires: a discovery call must never reach an Orthanc write
    // path (stamping uses /studies/{id}/modify; purge has its own query).
    const writeRoutes = captured.filter((r) =>
      /\/studies\/[^/]+\/(modify|store|anonymize|split|merge)$|\/instances\/[^/]+\/(modify|store|anonymize)$|\/modalities\/[^/]+\/store$/.test(
        r.url,
      ),
    );
    expect(writeRoutes).toEqual([]);
    // And no source-level write call was smuggled into the module either.
    expect(source).not.toContain("/modify");
    expect(source).not.toContain("QueryRetrieveLevel");
  });
});

describe("A1 row mapping and error behaviour", () => {
  it("maps expanded study rows and skips UID-less entries", async () => {
    respondWith = {
      status: 200,
      json: [
        {
          MainDicomTags: {
            StudyInstanceUID: "1.2.840.1.20261021.1",
            AccessionNumber: "ACC-2026-10-21-MR-01",
            StudyDate: "20261021",
            StudyDescription: "MRI LS SPINE",
            ReferringPhysicianName: "DR^RAM",
            ModalitiesInStudy: "MR\\SR",
          },
          PatientMainDicomTags: { PatientName: "RAMESH^KUMAR" },
        },
        {
          MainDicomTags: { StudyInstanceUID: "", AccessionNumber: "ACC-X" },
          PatientMainDicomTags: { PatientName: "NO UID" },
        },
      ],
    };

    const out = await findOrthancStudies({ limit: 100 });
    expect(out.source).toBe("ORTHANC_REST");
    expect(out.error).toBeUndefined();
    expect(out.rows).toHaveLength(1);
    const hit = out.rows[0]!;
    expect(hit.studyInstanceUID).toBe("1.2.840.1.20261021.1");
    expect(hit.accessionNumber).toBe("ACC-2026-10-21-MR-01");
    expect(hit.patientName).toBe("RAMESH^KUMAR");
    expect(hit.modality).toBe("MR\\SR");
    expect(hit.studyDate).toBe("2026-10-21");
    expect(hit.studyDescription).toBe("MRI LS SPINE");
    expect(hit.referringDoctor).toBe("DR^RAM");
  });

  it("applies the client-side modality whitelist", async () => {
    respondWith = {
      status: 200,
      json: [
        {
          MainDicomTags: { StudyInstanceUID: "1.1", ModalitiesInStudy: "MR" },
        },
        {
          MainDicomTags: { StudyInstanceUID: "1.2", ModalitiesInStudy: "CT" },
        },
      ],
    };
    const out = await findOrthancStudies({ modality: "US,MR", limit: 100 });
    expect(out.rows.map((r) => r.studyInstanceUID)).toEqual(["1.1"]);
  });

  it("enforces the caller limit after mapping", async () => {
    respondWith = {
      status: 200,
      json: Array.from({ length: 30 }, (_, i) => ({
        MainDicomTags: { StudyInstanceUID: `1.2.3.${i}` },
      })),
    };
    const out = await findOrthancStudies({ limit: 7 });
    expect(out.rows).toHaveLength(7);
  });

  it("returns NONE without a fetch when ORTHANC_URL is unset", async () => {
    delete process.env.ORTHANC_URL;
    const out = await findOrthancStudies({ limit: 10 });
    expect(out).toEqual({
      rows: [],
      source: "NONE",
      error: "ORTHANC_URL not configured",
    });
    expect(captured).toHaveLength(0);
  });

  it("reports archive errors without throwing and writes nothing", async () => {
    respondWith = { status: 400, json: { error: "bad request" } };
    const out = await findOrthancStudies({ limit: 10 });
    expect(out.rows).toEqual([]);
    expect(out.source).toBe("ORTHANC_REST");
    expect(out.error).toContain("400");
  });

  it("reports transport failures without throwing", async () => {
    fetchError = new Error("connect ECONNREFUSED");
    const out = await findOrthancStudies({ limit: 10 });
    expect(out.rows).toEqual([]);
    expect(out.source).toBe("ORTHANC_REST");
    expect(out.error).toBe("connect ECONNREFUSED");
  });
});

describe("orthancEphemeralWorklistId", () => {
  it("returns stable negative ids", () => {
    const uid = "1.2.840.113619.2.55.3.604688119.968.1756543210.123";
    expect(orthancEphemeralWorklistId(uid)).toBeLessThan(0);
    expect(orthancEphemeralWorklistId(uid)).toBe(orthancEphemeralWorklistId(uid));
  });
});
