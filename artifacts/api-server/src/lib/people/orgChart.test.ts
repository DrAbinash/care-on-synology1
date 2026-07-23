import { describe, it, expect } from "vitest";
import { buildOrgChart, countReports, type OrgNode, type ReportingEdge } from "./orgChart";

const nodes: OrgNode[] = [
  { staffId: 1, name: "Alice", designation: "Director" },
  { staffId: 2, name: "Bob", designation: "Manager" },
  { staffId: 3, name: "Carol", designation: "Technician" },
  { staffId: 4, name: "Dan", designation: "Technician" },
  { staffId: 5, name: "Eve", designation: "Receptionist" }, // no supervisor → also a root
];

const edges: ReportingEdge[] = [
  { staffId: 2, supervisorStaffId: 1 }, // Bob → Alice
  { staffId: 3, supervisorStaffId: 2 }, // Carol → Bob
  { staffId: 4, supervisorStaffId: 2 }, // Dan → Bob
];

describe("buildOrgChart", () => {
  it("builds a forest with the correct roots and nesting", () => {
    const { roots } = buildOrgChart(nodes, edges);
    expect(roots.map((r) => r.name)).toEqual(["Alice", "Eve"]);
    const alice = roots.find((r) => r.name === "Alice")!;
    expect(alice.reports.map((r) => r.name)).toEqual(["Bob"]);
    const bob = alice.reports[0];
    expect(bob.reports.map((r) => r.name)).toEqual(["Carol", "Dan"]); // sorted
    expect(countReports(alice)).toBe(3); // Bob, Carol, Dan
  });

  it("is deterministic regardless of edge/node order", () => {
    const a = buildOrgChart(nodes, edges);
    const b = buildOrgChart([...nodes].reverse(), [...edges].reverse());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("ignores self-references and unknown nodes", () => {
    const { roots } = buildOrgChart(nodes, [
      { staffId: 1, supervisorStaffId: 1 }, // self — ignored
      { staffId: 3, supervisorStaffId: 999 }, // unknown supervisor — ignored
    ]);
    // With no valid edges everyone is a root
    expect(roots).toHaveLength(5);
  });

  it("defends against cycles (drops the edge that would close the loop)", () => {
    const cyc: ReportingEdge[] = [
      { staffId: 2, supervisorStaffId: 1 },
      { staffId: 1, supervisorStaffId: 2 }, // would create 1↔2 cycle
    ];
    const { roots } = buildOrgChart(nodes.slice(0, 2), cyc);
    // Exactly one of the two becomes the root; the tree is finite.
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(() => JSON.stringify(roots)).not.toThrow();
  });
});
