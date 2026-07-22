// Patient-matching decision tests. matchPatient takes its DB executor as a
// parameter, so we inject a fake executor and never touch a real database.
// DATABASE_URL is set to a dummy value before the (dynamic) import so lib/db's
// import-time guard passes; the pg Pool is created lazily and never connects
// because every query goes through the injected fake.
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test_integration";

let matchPatient: typeof import("./patientMatching").matchPatient;
let scoreCandidate: typeof import("./patientMatching").scoreCandidate;

beforeAll(async () => {
  const mod = await import("./patientMatching");
  matchPatient = mod.matchPatient;
  scoreCandidate = mod.scoreCandidate;
});

// Fake Drizzle executor: every terminal `.limit()` resolves the next queued
// result. matchPatient issues exactly two `.limit()` calls per run.
function execWith(queue: unknown[][]) {
  let i = 0;
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(queue[i++] ?? []),
    update: () => chain,
    set: () => chain,
  };
  return chain as never;
}

const P = (over: Record<string, unknown> = {}) => ({
  id: 10, patientId: "P-00010", firstName: "Rajesh", lastName: "Kumar",
  phone: "9876543210", gender: "M", ageValue: 34, ...over,
});

describe("scoreCandidate", () => {
  const input = { sourceSystem: "HOPE", sourcePatientId: "U1", name: "Rajesh Kumar", phone: "9876543210", age: 34, gender: "M" };
  it("scores an exact identity at the top", () => {
    const { score, reasons } = scoreCandidate(input, P());
    expect(score).toBe(100);
    expect(reasons).toContain("mobile_exact");
    expect(reasons).toContain("name_exact");
    expect(reasons).toContain("gender_match");
  });
  it("scores a shared-phone different-name lower and flags name_differs", () => {
    const { score, reasons } = scoreCandidate(input, P({ firstName: "Sunita", lastName: "Devi", gender: "F", ageValue: 30 }));
    expect(reasons).toContain("mobile_exact");
    expect(reasons).toContain("name_differs");
    expect(score).toBeLessThan(80);
  });
});

describe("matchPatient", () => {
  const base = { sourceSystem: "HOPE", sourcePatientId: "UHID-1", name: "Rajesh Kumar", phone: "9876543210", age: 34, gender: "M" };

  it("returns confirmed_existing on a prior confirmed link with consistent demographics", async () => {
    const exec = execWith([
      [{ id: 1, carePatientId: 10, linkStatus: "confirmed" }],
      [P()],
    ]);
    const r = await matchPatient(exec, base);
    expect(r.outcome).toBe("confirmed_existing");
    expect(r.carePatientId).toBe(10);
    expect(r.confidence).toBe(100);
  });

  it("BLOCKS as conflict when a confirmed link's demographics contradict the incoming patient", async () => {
    const exec = execWith([
      [{ id: 1, carePatientId: 10, linkStatus: "confirmed" }],
      [P({ firstName: "Sunita", lastName: "Devi", phone: "1112223333", gender: "F" })],
    ]);
    const r = await matchPatient(exec, base);
    expect(r.outcome).toBe("conflict");
    expect(r.conflictReason).toMatch(/review/i);
  });

  it("returns probable (mobile_name) when phone AND name match an existing patient — never auto-confirmed", async () => {
    const exec = execWith([[], [P({ id: 20, patientId: "P-00020" })]]);
    const r = await matchPatient(exec, base);
    expect(r.outcome).toBe("probable");
    expect(r.method).toBe("mobile_name");
    expect(r.confidence).toBeLessThan(100); // requires staff confirmation
    expect(r.candidates[0].carePatientId).toBe(20);
  });

  it("does NOT merge a same-name/different-phone patient — no phone candidate → new", async () => {
    // Phone query returns nothing (different mobile), and name alone is never a key.
    const exec = execWith([[], []]);
    const r = await matchPatient(exec, base);
    expect(r.outcome).toBe("no_match");
    expect(r.candidates).toHaveLength(0);
  });

  it("surfaces a shared-family-phone as low-confidence probable (mobile_only), not a silent merge", async () => {
    const exec = execWith([[], [P({ id: 21, patientId: "P-00021", firstName: "Sunita", lastName: "Devi", gender: "F", ageValue: 31 })]]);
    const r = await matchPatient(exec, base);
    expect(r.outcome).toBe("probable");
    expect(r.method).toBe("mobile_only");
    expect(r.candidates[0].reasons).toContain("name_differs");
  });
});
