import { describe, expect, it } from "vitest";
import { doctorMatchesQuery } from "./doctorSearch";

const abinash = {
  id: 42,
  name: "DR.ABINASH KUMAR MBBS,MS(G.SURGERY.MCh(NEURO) NEUROSURGEON",
  specialization: "NEUROSURGEON",
};

describe("doctorMatchesQuery", () => {
  it("matches partial word inside a name token (abi → abinash)", () => {
    expect(doctorMatchesQuery(abinash, "abi")).toBe(true);
    expect(doctorMatchesQuery(abinash, "ABI")).toBe(true);
  });

  it("matches multi-token queries", () => {
    expect(doctorMatchesQuery(abinash, "abi neuro")).toBe(true);
    expect(doctorMatchesQuery(abinash, "abi cardiology")).toBe(false);
  });

  it("matches by id", () => {
    expect(doctorMatchesQuery(abinash, "42")).toBe(true);
    expect(doctorMatchesQuery(abinash, "#42")).toBe(true);
  });

  it("empty query matches everyone", () => {
    expect(doctorMatchesQuery(abinash, "   ")).toBe(true);
  });
});
