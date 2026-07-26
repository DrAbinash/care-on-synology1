import { describe, expect, test, vi } from "vitest";

// POST /pathology-flag-preview — the result-entry grid's (ReportHub.tsx) own
// flag-suggestion call, permissioned for ordinary reporting staff (unlike
// the admin-only POST /pathology-registry/flag). Resolves the patient's
// sex/age server-side from patientId, then reuses the real
// @workspace/pathology flagValue()/resolveReferenceInterval() functions —
// deliberately NOT mocked here, since they're pure and this is exactly the
// computation the test needs to verify against real reference ranges
// (Hemoglobin: adult male 13.0-17.0 g/dL, adult female 12.0-15.0,
// criticalLow 7.0 — lib/pathology/src/catalog.ts).

let patientRow: { gender: string; dateOfBirth: string } | undefined;
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(patientRow ? [patientRow] : []),
      }),
    }),
  },
  patientsTable: {},
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: string, path: string) {
  const layer = router.stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

async function post(body: Record<string, unknown>) {
  const { pathologyFlagPreviewRouter } = await import("./pathologyFlagPreview");
  const handler = getRouteHandler(pathologyFlagPreviewRouter, "post", "/");
  const req = { body };
  const res = makeRes();
  await handler(req, res);
  return res;
}

// DOB for a person who just turned 30 today, in every timezone the test
// might run in.
function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

describe("POST /pathology-flag-preview", () => {
  test("400s when patientId is missing", async () => {
    const res = await post({ analyte: "Hemoglobin", value: "15" });
    expect(res.statusCode).toBe(400);
  });

  test("400s when analyte is missing", async () => {
    patientRow = { gender: "male", dateOfBirth: dobForAge(30) };
    const res = await post({ patientId: 1, value: "15" });
    expect(res.statusCode).toBe(400);
  });

  test("404s on an unresolvable analyte name", async () => {
    patientRow = { gender: "male", dateOfBirth: dobForAge(30) };
    const res = await post({ patientId: 1, analyte: "not a real test", value: "15" });
    expect(res.statusCode).toBe(404);
  });

  test("flags a normal adult male Hemoglobin as N, using the male reference range", async () => {
    patientRow = { gender: "male", dateOfBirth: dobForAge(30) };
    const res = await post({ patientId: 1, analyte: "Hemoglobin", value: "15.0" });
    expect(res.statusCode).toBe(200);
    expect(res.body.result.flag).toBe("N");
    expect(res.body.referenceRange.low).toBe(13.0);
    expect(res.body.referenceRange.high).toBe(17.0);
  });

  test("a value normal for an adult male flags high for an adult female (sex-aware range)", async () => {
    patientRow = { gender: "female", dateOfBirth: dobForAge(30) };
    const res = await post({ patientId: 1, analyte: "Hemoglobin", value: "15.5" });
    expect(res.statusCode).toBe(200);
    expect(res.body.result.flag).toBe("H");
    expect(res.body.referenceRange.low).toBe(12.0);
    expect(res.body.referenceRange.high).toBe(15.0);
  });

  test("flags a critically low Hemoglobin as LL regardless of the matched range", async () => {
    patientRow = { gender: "male", dateOfBirth: dobForAge(30) };
    const res = await post({ patientId: 1, analyte: "Hemoglobin", value: "6.0" });
    expect(res.statusCode).toBe(200);
    expect(res.body.result.flag).toBe("LL");
  });

  test("resolves a known alias (\"Hb\"), not just the canonical display name", async () => {
    patientRow = { gender: "male", dateOfBirth: dobForAge(30) };
    const res = await post({ patientId: 1, analyte: "Hb", value: "15.0" });
    expect(res.statusCode).toBe(200);
    expect(res.body.analyteId).toBe("HEMOGLOBIN");
  });

  test("no crash when the patient lookup finds no row — Hemoglobin has no sex-unbounded adult range, so the flag comes back unknown rather than a guess", async () => {
    patientRow = undefined;
    const res = await post({ patientId: 999, analyte: "Hemoglobin", value: "15.0" });
    expect(res.statusCode).toBe(200);
    expect(res.body.result.flag).toBe("");
    expect(res.body.result.status).toBe("unknown");
  });
});
