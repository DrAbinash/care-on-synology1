import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

// Ticket D8 — canonical chain resolution. The pure core (analyzeChain) is
// tested directly; resolveReportVersion runs against a scriptable db mock
// whose query order mirrors the real drizzle call sequence.

let plainReportScript: unknown[][];
let linkageScript: unknown[][];

vi.mock("@workspace/db/schema", () => ({
  patientReportsTable: { __name: "patient_reports", id: "id", patientId: "patient_id", status: "status", reportNumber: "report_number", signedByName: "signed_by_name", signedAt: "signed_at", createdAt: "created_at" },
  patientReportAmendmentsTable: { __name: "patient_report_amendments", originalReportId: "original_report_id", amendedReportId: "amended_report_id", rootReportId: "root_report_id", sequenceNumber: "sequence_number" },
}));

vi.mock("@workspace/db", () => {
  const rowsFor = (tbl: { __name?: string }): unknown[] => {
    if (tbl?.__name === "patient_reports") return plainReportScript.length > 0 ? (plainReportScript.shift() as unknown[]) : [];
    if (tbl?.__name === "patient_report_amendments") return linkageScript.length > 0 ? (linkageScript.shift() as unknown[]) : [];
    return [];
  };
  return {
    db: {
      select: () => ({
        from: (tbl: { __name?: string }) => ({
          where: () => ({
            then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl)),
            limit: async () => rowsFor(tbl),
            orderBy: () => ({
              then: (resolve: (v: unknown) => void) => resolve(rowsFor(tbl)),
              limit: async () => rowsFor(tbl),
            }),
          }),
        }),
      }),
    },
  };
});

import { analyzeChain, resolveReportVersion, type ChainLinkRow } from "./radiologyReportVersion";

const T1 = new Date("2026-07-11T09:00:00Z");
const T2 = new Date("2026-07-12T09:00:00Z");

function link(overrides: Partial<ChainLinkRow>): ChainLinkRow {
  return {
    originalReportId: 900, amendedReportId: 909, rootReportId: 900,
    originalDocumentId: "0ROOT", amendedDocumentId: "AONE",
    sequenceNumber: 1, reason: "laterality corrected", amendedByName: "Dr. Sen", createdAt: T1,
    ...overrides,
  };
}
const L1 = link({});
const L2 = link({ originalReportId: 909, amendedReportId: 915, originalDocumentId: "AONE", amendedDocumentId: "ATWO", sequenceNumber: 2, reason: "measurement corrected", amendedByName: "Dr. Rao", createdAt: T2 });

const row = (id: number, status = "verified", patientId = 12) => ({
  id, patientId, status, reportNumber: `RPT-${id}`, signedByName: "Dr. X", signedAt: T1, createdAt: T1,
});

beforeEach(() => {
  plainReportScript = [];
  linkageScript = [];
});

// ── analyzeChain (pure) ──────────────────────────────────────────────────────

describe("analyzeChain — valid chains", () => {
  it("no links → single-version chain anchored at the report", () => {
    const a = analyzeChain([], 900);
    expect(a).toMatchObject({ ok: true, warnings: [], versionIds: [900], rootReportId: 900, latestReportId: 900 });
  });

  it("one amendment", () => {
    const a = analyzeChain([L1], 900);
    expect(a.ok).toBe(true);
    expect(a.versionIds).toEqual([900, 909]);
    expect(a.latestReportId).toBe(909);
  });

  it("multiple amendments, input order irrelevant", () => {
    const a = analyzeChain([L2, L1], 915);
    expect(a.ok).toBe(true);
    expect(a.versionIds).toEqual([900, 909, 915]);
    expect(a.orderedLinks.map((l) => l.sequenceNumber)).toEqual([1, 2]);
  });
});

describe("analyzeChain — corruption detection (never repaired silently)", () => {
  it("fork: duplicate sequence number", () => {
    const a = analyzeChain([L1, link({ amendedReportId: 911, amendedDocumentId: "AFORK" })], 900);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_fork_duplicate_sequence"))).toBe(true);
    expect(a.latestReportId).toBe(900); // falls back to the anchor
  });

  it("missing link: sequence gap", () => {
    const a = analyzeChain([L2], 915);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_missing_sequence:1"))).toBe(true);
  });

  it("broken continuity: link does not chain from the previous amendment", () => {
    const badL2 = link({ originalReportId: 908, amendedReportId: 915, sequenceNumber: 2 });
    const a = analyzeChain([L1, badL2], 900);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_broken_link"))).toBe(true);
  });

  it("cycle: a report id repeats along the walk", () => {
    const cycle = link({ originalReportId: 909, amendedReportId: 900, sequenceNumber: 2 });
    const a = analyzeChain([L1, cycle], 900);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_cycle:900"))).toBe(true);
  });

  it("self-link", () => {
    const a = analyzeChain([link({ amendedReportId: 900 })], 900);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_self_link"))).toBe(true);
  });

  it("mixed roots", () => {
    const a = analyzeChain([L1, link({ ...L2, rootReportId: 555 })], 900);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_mixed_roots"))).toBe(true);
  });

  it("anchor not in the chain", () => {
    const a = analyzeChain([L1], 777);
    expect(a.ok).toBe(false);
    expect(a.warnings.some((w) => w.startsWith("chain_anchor_not_in_chain"))).toBe(true);
  });
});

describe("analyzeChain — performance sanity", () => {
  it("validates a 200-link chain quickly", () => {
    const links: ChainLinkRow[] = [];
    for (let i = 1; i <= 200; i++) {
      links.push(link({
        originalReportId: 899 + i, amendedReportId: 900 + i, sequenceNumber: i,
        originalDocumentId: `D${i - 1}`, amendedDocumentId: `D${i}`,
      }));
    }
    const t0 = performance.now();
    for (let n = 0; n < 50; n++) {
      const a = analyzeChain(links, 900);
      expect(a.ok).toBe(true);
      expect(a.latestReportId).toBe(1100);
    }
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

// ── resolveReportVersion (db-backed) ─────────────────────────────────────────

describe("resolveReportVersion — resolution policy", () => {
  it("unknown report → null", async () => {
    plainReportScript = [[]];
    expect(await resolveReportVersion(1, { mode: "latest" })).toBeNull();
  });

  it("no chain → serves the requested row as version 1 of 1", async () => {
    plainReportScript = [[row(900)]];
    linkageScript = [[], []];
    const r = await resolveReportVersion(900, { mode: "latest", includeChain: true });
    expect(r).toMatchObject({
      requestedReportId: 900, resolvedReportId: 900, rootReportId: 900, latestReportId: 900,
      superseded: false, resolvedSuperseded: false, sequenceNumber: 1, totalVersions: 1,
      amendmentReason: null, resolutionReason: "no_chain", warnings: [],
    });
    expect(r!.chain).toEqual([]);
  });

  it("requested ROOT resolves to latest (deep chain)", async () => {
    plainReportScript = [[row(900)], [row(900), row(909), row(915)]];
    linkageScript = [[], [L1], [L1, L2]];
    const r = await resolveReportVersion(900, { mode: "latest", includeChain: true });
    expect(r).toMatchObject({
      resolvedReportId: 915, rootReportId: 900, latestReportId: 915,
      superseded: true, resolvedSuperseded: false, sequenceNumber: 3, totalVersions: 3,
      amendmentReason: "measurement corrected", latestAmendmentReason: "measurement corrected",
      resolutionReason: "resolved_to_latest",
    });
    expect(r!.chain!.map((c) => c.reportId)).toEqual([900, 909, 915]);
    expect(r!.chain![2].isLatest).toBe(true);
    expect(r!.links!.length).toBe(2);
  });

  it("requested MIDDLE revision resolves to latest", async () => {
    plainReportScript = [[row(909)], [row(900), row(909), row(915)]];
    linkageScript = [[L1], [L2], [L1, L2]];
    const r = await resolveReportVersion(909, { mode: "latest" });
    expect(r).toMatchObject({ resolvedReportId: 915, superseded: true, resolvedSuperseded: false, resolutionReason: "resolved_to_latest" });
  });

  it("requesting the tip is already latest", async () => {
    plainReportScript = [[row(915)], [row(900), row(909), row(915)]];
    linkageScript = [[L2], [], [L1, L2]];
    const r = await resolveReportVersion(915, { mode: "latest" });
    expect(r).toMatchObject({ resolvedReportId: 915, superseded: false, resolvedSuperseded: false, sequenceNumber: 3, resolutionReason: "already_latest" });
  });

  it("explicit historical access: mode=specific serves the exact row, truthfully marked superseded", async () => {
    plainReportScript = [[row(900)], [row(900), row(909), row(915)]];
    linkageScript = [[], [L1], [L1, L2]];
    const r = await resolveReportVersion(900, { mode: "specific" });
    expect(r).toMatchObject({
      resolvedReportId: 900, superseded: true, resolvedSuperseded: true,
      sequenceNumber: 1, totalVersions: 3, resolutionReason: "explicit_specific",
    });
  });

  it("mode=root serves the chain root from any version", async () => {
    plainReportScript = [[row(915)], [row(900), row(909), row(915)]];
    linkageScript = [[L2], [], [L1, L2]];
    const r = await resolveReportVersion(915, { mode: "root" });
    expect(r).toMatchObject({ resolvedReportId: 900, resolvedSuperseded: true, sequenceNumber: 1, resolutionReason: "explicit_root" });
  });
});

describe("resolveReportVersion — deliverable-status gating (patient surfaces)", () => {
  it("tip not yet deliverable → newest QUALIFYING version newer than the requested one", async () => {
    plainReportScript = [[row(900)], [row(900), row(909, "verified"), row(915, "draft")]];
    linkageScript = [[], [L1], [L1, L2]];
    const r = await resolveReportVersion(900, { mode: "latest", deliverableStatuses: ["verified", "delivered"] });
    expect(r).toMatchObject({ resolvedReportId: 909, resolvedSuperseded: true, resolutionReason: "resolved_to_latest" });
  });

  it("no newer version deliverable → requested row itself, marked latest_not_deliverable", async () => {
    plainReportScript = [[row(900)], [row(900), row(909, "draft"), row(915, "draft")]];
    linkageScript = [[], [L1], [L1, L2]];
    const r = await resolveReportVersion(900, { mode: "latest", deliverableStatuses: ["verified", "delivered"] });
    expect(r).toMatchObject({ resolvedReportId: 900, superseded: true, resolvedSuperseded: true, resolutionReason: "latest_not_deliverable" });
  });

  it("never resolves to a version OLDER than the requested one", async () => {
    // 909 requested; only the ROOT is deliverable — must stay on 909.
    plainReportScript = [[row(909)], [row(900, "delivered"), row(909, "verified"), row(915, "draft")]];
    linkageScript = [[L1], [L2], [L1, L2]];
    const r = await resolveReportVersion(909, { mode: "latest", deliverableStatuses: ["verified", "delivered"] });
    expect(r!.resolvedReportId).toBe(909);
    expect(r!.resolutionReason).toBe("latest_not_deliverable");
  });
});

describe("resolveReportVersion — corrupt chains fail safe to the requested row", () => {
  it("missing patient_reports row for a chain member", async () => {
    plainReportScript = [[row(900)], [row(900), row(909)]]; // 915 row missing
    linkageScript = [[], [L1], [L1, L2]];
    const r = await resolveReportVersion(900, { mode: "latest" });
    expect(r).toMatchObject({ resolvedReportId: 900, resolutionReason: "chain_corrupt_fallback", superseded: false });
    expect(r!.warnings.some((w) => w.startsWith("chain_missing_report_row:915"))).toBe(true);
  });

  it("cross-patient link", async () => {
    plainReportScript = [[row(900)], [row(900), { ...row(909), patientId: 99 }, row(915)]];
    linkageScript = [[], [L1], [L1, L2]];
    const r = await resolveReportVersion(900, { mode: "latest" });
    expect(r!.resolvedReportId).toBe(900);
    expect(r!.resolutionReason).toBe("chain_corrupt_fallback");
    expect(r!.warnings.some((w) => w.startsWith("chain_cross_patient:909"))).toBe(true);
  });

  it("linkage corruption (gap) even under mode=latest", async () => {
    plainReportScript = [[row(915)], [row(900), row(915)]];
    linkageScript = [[L2], [], [L2]]; // sequence 1 missing
    const r = await resolveReportVersion(915, { mode: "latest" });
    expect(r!.resolvedReportId).toBe(915);
    expect(r!.resolutionReason).toBe("chain_corrupt_fallback");
    expect(r!.warnings.some((w) => w.startsWith("chain_missing_sequence"))).toBe(true);
  });
});
