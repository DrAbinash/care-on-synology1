/**
 * @vitest-environment node
 *
 * S1 — the fields that say WHO called an internal radiology route.
 *
 * The gate in routes/internal-radiology.ts accepts the server-to-server key or
 * any active staff session, and the clinic cannot narrow that without first
 * knowing what its people actually call. These helpers build the log line for
 * that measurement, so the two things that must never be in it are impossible to
 * put in by accident: the credential (which IS a live session) and a patient
 * pointer (which rides in paths like `/patients/214/contact` and in every query
 * string on the router).
 *
 * Pure: no database, no Express, no pino.
 */
import { describe, expect, it } from "vitest";
import {
  callerCategoryOf,
  routeCallerFields,
  routeForAudit,
} from "./routeCallerAudit";

describe("routeForAudit — a route shape, never an identifier", () => {
  it("masks a numeric path segment", () => {
    expect(routeForAudit("GET", "/api/internal/radiology/radiology/worklist/214"))
      .toBe("GET /api/internal/radiology/radiology/worklist/:id");
  });

  it("masks the patient pointer in the path", () => {
    expect(routeForAudit("GET", "/api/internal/radiology/patients/214/contact"))
      .toBe("GET /api/internal/radiology/patients/:id/contact");
  });

  it("masks an alphabetic UHID after the person collection", () => {
    // CARE UHIDs are not required to contain a digit, so shape-masking alone
    // would have logged the patient's identifier verbatim.
    expect(routeForAudit("GET", "/api/internal/radiology/patients/ABH77/contact"))
      .toBe("GET /api/internal/radiology/patients/:id/contact");
  });

  it("drops the query string and the fragment entirely", () => {
    // accessionNumber, uhid and patient name all travel as query parameters on
    // this router.
    const line = routeForAudit(
      "GET",
      "/api/internal/radiology/radiology/resolve-open?accessionNumber=ACC-2026-441&uhid=ABH77#frag",
    );
    expect(line).toBe("GET /api/internal/radiology/radiology/resolve-open");
    expect(line).not.toContain("ACC-2026-441");
    expect(line).not.toContain("ABH77");
    expect(line).not.toContain("frag");
  });

  it("keeps a static route readable", () => {
    expect(routeForAudit("POST", "/api/internal/radiology/radiology/report-status"))
      .toBe("POST /api/internal/radiology/radiology/report-status");
    expect(routeForAudit("get", "/api/internal/radiology/dicom-agent/config"))
      .toBe("GET /api/internal/radiology/dicom-agent/config");
  });

  it("normalises slashes and an absent path", () => {
    expect(routeForAudit("GET", "//api//internal//")).toBe("GET /api/internal");
    expect(routeForAudit("GET", "")).toBe("GET /");
  });

  it("masks a UUID job id but keeps the action segment", () => {
    expect(routeForAudit("PATCH", "/api/internal/dicom/pull-jobs/6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f/claim"))
      .toBe("PATCH /api/internal/dicom/pull-jobs/:id/claim");
  });
});

describe("callerCategoryOf — the category, not the person", () => {
  it("names the automation lane", () => {
    expect(callerCategoryOf({ viaInternalKey: true })).toBe("internal-key");
  });

  it("names a staff role", () => {
    expect(callerCategoryOf({ staffRole: "radiologist" })).toBe("staff:radiologist");
    expect(callerCategoryOf({ staffRole: "Super Admin" })).toBe("staff:super_admin");
  });

  it("sanitises rather than echoes an unexpected role", () => {
    // A role string is operator data; free text must not reach the log line.
    // Same [a-z0-9_] alphabet `normalizeRole` uses, so the two agree.
    const label = callerCategoryOf({ staffRole: "Dr. José  A.ñes <script>" });
    expect(label).toBe("staff:dr_jos_a_es_script");
    expect(label).toMatch(/^staff:[a-z0-9_]+$/);
    expect(label).not.toMatch(/[.<> ]/);
  });

  it("falls back to a fixed label when no role is known", () => {
    expect(callerCategoryOf({ staffRole: null })).toBe("staff:unknown-role");
    expect(callerCategoryOf({ staffRole: "   " })).toBe("staff:unknown-role");
    expect(callerCategoryOf({})).toBe("staff:unknown-role");
  });
});

describe("routeCallerFields — the closed field set", () => {
  it("carries route, caller and outcome, and nothing else", () => {
    // A future caller that wants to log a body, a token or a subject name has to
    // change this signature, which is where the review happens.
    const fields = routeCallerFields({
      method: "POST",
      url: "/api/internal/radiology/radiology/studies",
      caller: callerCategoryOf({ viaInternalKey: true }),
      outcome: "allowed",
    });
    expect(Object.keys(fields).sort()).toEqual(["caller", "outcome", "route"]);
    expect(fields).toEqual({
      route: "POST /api/internal/radiology/radiology/studies",
      caller: "internal-key",
      outcome: "allowed",
    });
  });

  it("produces no field value that could carry the credential or a patient", () => {
    const token = "Bearer vitest-secret-session-token-9f3a";
    const fields = routeCallerFields({
      method: "GET",
      url: `/api/internal/radiology/patients/4112/contact?uhid=UHID4112&name=Sharma&authorization=${token}`,
      caller: callerCategoryOf({ staffRole: "typist" }),
      outcome: "allowed",
    });
    const serialised = JSON.stringify(fields);
    expect(serialised).not.toContain("vitest-secret-session-token-9f3a");
    expect(serialised).not.toContain("4112");
    expect(serialised).not.toContain("Sharma");
    expect(serialised).not.toContain("UHID4112");
    expect(serialised).toBe(
      '{"route":"GET /api/internal/radiology/patients/:id/contact","caller":"staff:typist","outcome":"allowed"}',
    );
  });
});
