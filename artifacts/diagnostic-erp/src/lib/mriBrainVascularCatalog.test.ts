/**
 * mriBrainVascularCatalog.test.ts — the booking side of vascular reporting
 * (mra/mrv spec §2, §24 audit).
 *
 * Two failure modes matter here, and they are opposite: under-resolving leaves a
 * dedicated MRA booked as a plain brain study with no vessel panel, and
 * over-resolving puts an intracranial arterial tree on a lower-limb angiography
 * report. The tests therefore assert both directions, and they assert that a real
 * but site-less booking stops resolution instead of falling through to a guess.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AMBIGUOUS_VASCULAR_ROWS,
  CONFIRMED_VASCULAR_ROWS,
  LIVE_EXPORT_ONLY_VASCULAR_NAMES,
  NON_CEREBRAL_VASCULAR_CODES,
  VASCULAR_CATALOG_EVIDENCE_DATE,
  VASCULAR_CATALOG_EVIDENCE_SOURCE,
  VASCULAR_DOMAINS,
  emptyVascularRoles,
  hasVascularContent,
  isVascularDedicated,
  resolveVascularComposition,
  screeningRoleFromBilling,
  vascularCompositionSummary,
} from "@/lib/mriBrainVascularCatalog";

function resolve(over: Record<string, string>) {
  return resolveVascularComposition({ modality: "MR", ...over });
}

/** Names the repository itself books, for independent corroboration. */
function seedNames(): Set<string> {
  const path = fileURLToPath(new URL("../../../../scripts/src/import-test-catalog.ts", import.meta.url));
  const src = readFileSync(path, "utf8");
  const block = src.slice(src.indexOf("MRI_TESTS"));
  return new Set(
    [...block.matchAll(/\["([A-Z0-9][^\"]*?)",\s*\d+(?:\.\d+)?\]/g)].map((m) => m[1]!.trim()),
  );
}

describe("evidence discipline (spec §24)", () => {
  it("carries the export it came from on every confirmed row", () => {
    for (const row of CONFIRMED_VASCULAR_ROWS) {
      expect(row.evidenceSource).toBe(VASCULAR_CATALOG_EVIDENCE_SOURCE);
      expect(row.evidenceDate).toBe(VASCULAR_CATALOG_EVIDENCE_DATE);
    }
    expect(VASCULAR_CATALOG_EVIDENCE_SOURCE).toMatch(/\.csv$/);
  });

  it("corroborates every confirmed billed name against the repository seed", () => {
    const names = seedNames();
    const exportOnly = new Set(LIVE_EXPORT_ONLY_VASCULAR_NAMES.map((r) => r.name));
    for (const row of CONFIRMED_VASCULAR_ROWS) {
      const inSeed = names.has(row.name);
      const declared = exportOnly.has(row.name);
      expect(inSeed || declared, `${row.name} is neither in the seed nor declared export-only`).toBe(true);
      expect(inSeed && declared, `${row.name} is declared export-only but the seed has it`).toBe(false);
    }
  });

  it("keeps confirmed rows, site-less bookings and other-site codes in separate lists", () => {
    const confirmed = new Set(CONFIRMED_VASCULAR_ROWS.map((r) => r.code));
    for (const row of AMBIGUOUS_VASCULAR_ROWS) {
      expect(confirmed.has(row.code), row.code).toBe(false);
      expect(row.reason.length, row.code).toBeGreaterThan(20);
    }
    for (const code of NON_CEREBRAL_VASCULAR_CODES) {
      expect(confirmed.has(code), code).toBe(false);
    }
  });
});

describe("resolveVascularComposition", () => {
  it("books the neck AND cerebral study as two dedicated arterial domains", () => {
    const r = resolve({ code: "MRI005", name: "MRA OF NECK AND CEREBRAL VESSELS" });
    expect(r.composition).toBe("mra-intracranial-dedicated");
    expect(r.roles.mraIntracranial).toBe("dedicated");
    expect(r.roles.mraNeck).toBe("dedicated");
    expect(r.provenance).toBe("catalog-code");
    expect(r.ambiguous).toBe(false);
    expect(vascularCompositionSummary(r)).toContain("catalog code MRI005");
  });

  it("keeps a brain-plus-angiography booking arterial and intracranial only", () => {
    const r = resolve({ code: "MRI009", name: "MRI BRAIN + ANGIO" });
    expect(isVascularDedicated(r.roles, "mraIntracranial")).toBe(true);
    expect(r.roles.mraNeck).toBe("absent");
    expect(r.roles.mrv).toBe("absent");
  });

  it("never grows a circle of Willis panel on a neck-only vascular booking", () => {
    for (const row of CONFIRMED_VASCULAR_ROWS.filter((x) => x.composition === "mra-neck-dedicated")) {
      const r = resolve({ code: row.code, name: row.name });
      expect(r.roles.mraNeck, row.code).toBe("dedicated");
      expect(r.roles.mraIntracranial, row.code).toBe("absent");
      expect(r.roles.mrv, row.code).toBe("absent");
    }
  });

  it("stops on a real angiography booking that names no site", () => {
    for (const row of AMBIGUOUS_VASCULAR_ROWS) {
      const r = resolve({ code: row.code, name: row.name });
      expect(r.ambiguous, row.code).toBe(true);
      expect(r.composition, row.code).toBe("unknown");
      expect(hasVascularContent(r.roles), row.code).toBe(false);
      expect(r.evidenceSource, row.code).toBe(VASCULAR_CATALOG_EVIDENCE_SOURCE);
    }
  });

  it("excludes angiography and venography at other body sites", () => {
    for (const code of NON_CEREBRAL_VASCULAR_CODES) {
      const r = resolve({ code, name: "MRI RENAL ANGIOGRAPHY" });
      expect(hasVascularContent(r.roles), code).toBe(false);
      expect(r.composition, code).toBe("unknown");
      expect(r.note, code).toMatch(/another site/);
    }
  });

  it("resolves spelled-out cerebral wording as an alias and says so", () => {
    const r = resolve({ name: "MRI BRAIN WITH MRA CIRCLE OF WILLIS" });
    expect(r.provenance).toBe("heuristic-alias");
    expect(r.roles.mraIntracranial).toBe("dedicated");
    expect(r.note).toMatch(/not from a catalog code/);
  });

  it("resolves an intracranial venous booking as dedicated MRV", () => {
    const r = resolve({ name: "MRV BRAIN DURAL VENOUS SINUS" });
    expect(r.roles.mrv).toBe("dedicated");
    expect(r.roles.mraIntracranial).toBe("absent");
  });

  it("leaves a plain brain study with every vascular domain absent", () => {
    const r = resolve({ code: "MRI001", name: "MRI BRAIN" });
    expect(r.composition).toBe("brain-only");
    expect(r.roles).toEqual(emptyVascularRoles());
    expect(hasVascularContent(r.roles)).toBe(false);
  });

  it("resolves nothing for an unknown booking or a non-MR modality", () => {
    expect(resolve({ code: "ZZZ999", name: "SOMETHING ELSE" }).composition).toBe("unknown");
    const ct = resolveVascularComposition({ modality: "CT", code: "MRI009", name: "MRI BRAIN + ANGIO" });
    expect(ct.composition).toBe("unknown");
    expect(hasVascularContent(ct.roles)).toBe(false);
  });

  it("never proposes the basic screening role from billing (spec §14)", () => {
    expect(screeningRoleFromBilling()).toBe("absent");
    for (const row of CONFIRMED_VASCULAR_ROWS) {
      const r = resolve({ code: row.code, name: row.name });
      expect(r.roles.mraBasicScreening, row.code).toBe("absent");
    }
    for (const domain of VASCULAR_DOMAINS) expect(domain).toBeTruthy();
  });
});
