/**
 * The clinical acceptance specification, checked as data.
 *
 * What runs here is the spec's own integrity: the twenty cases §5 names, in order, each with a
 * structural expectation, a named blocker, a contract it discharges and an honest statement of
 * whether its clinical wording has been approved. Nothing here composes a report, and nothing here
 * can turn green by asserting that a case passed: every engine test below is skipped, on purpose,
 * until a composer exists to run it against.
 *
 * For Stage C: the skipped block at the bottom is the hook. Turning one of those tests into a real
 * assertion is how a case is discharged; deleting one is not.
 */
import { describe, expect, it } from "vitest";
import {
  CASE_CONTRACTS,
  CLINICAL_ACCEPTANCE_CASES,
  SELECTION_STATE_IDS,
  type StageBContract,
} from "./clinicalAcceptanceSpec";

/** §5's list, copied from the brief so a renamed or dropped case is a loud failure. */
const BRIEF_TITLES = [
  "Normal MRI Brain",
  "Subarachnoid hemorrhage",
  "Fazekas I plus cerebral atrophy",
  "Hydrocephalus",
  "Glioma recurrence plus cerebral edema",
  "MRI lumbar L4-L5 disc pathology",
  "Multiple lumbar abnormalities",
  "Cervical spinal canal measurements",
  "Bilateral lower-limb DVT",
  "Gallstones without cholecystitis",
  "Brain lesion plus independently directed shift",
  "Tile deselection and restoration",
  "Manual text protection",
  "Same selection, different click order",
  "Multiple compatible abnormalities",
  "Mutually exclusive severity grades",
  "Undo and redo",
  "Report re-opening and rehydration",
  "Draft versus published catalogue",
  "No AI dependency",
];

const CONTRACT_NAMES: readonly StageBContract[] = [
  "publication snapshot",
  "selection-state contract",
  "field-scoped combination contract",
  "publication validation contract",
];

describe("the clinical acceptance specification is complete, honest about what it cannot execute, and bound to the contracts", () => {
  it("is exactly the twenty cases §5 names, in the order it names them", () => {
    expect(CLINICAL_ACCEPTANCE_CASES.map((c) => c.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `T${i + 1}`),
    );
    expect(CLINICAL_ACCEPTANCE_CASES.map((c) => c.title)).toEqual(BRIEF_TITLES);
    // A duplicate id would let one case be silently replaced by another.
    expect(new Set(CLINICAL_ACCEPTANCE_CASES.map((c) => c.id)).size).toBe(20);
  });

  it("claims no case has passed, and cannot be edited into claiming one", () => {
    // The single-member status set is the guard: widening it is a Stage C act, and this assertion
    // fails the moment any case is marked as anything other than specified-and-not-executed.
    const statuses = new Set(CLINICAL_ACCEPTANCE_CASES.map((c) => c.status));
    expect([...statuses]).toEqual(["specified-not-executed"]);
    for (const c of CLINICAL_ACCEPTANCE_CASES) {
      expect(c.blockedBy.join("|"), `${c.id} names what must exist before it can run`).toContain("composer");
      expect(c.expected.length, `${c.id} states at least one property`).toBeGreaterThanOrEqual(2);
      expect(c.selection.length, `${c.id} states what the radiologist does`).toBeGreaterThanOrEqual(1);
      expect(c.wordingNote.length, `${c.id} explains its wording provenance`).toBeGreaterThan(0);
    }
  });

  it("puts no clinical words in a radiologist's mouth", () => {
    // No case quotes a sentence, because inventing clinical prose to make a fixture pass is the
    // failure §5 forbids. If a case ever does quote one, it must be ratified first — this
    // assertion is what makes quoting casually impossible.
    for (const c of CLINICAL_ACCEPTANCE_CASES) {
      expect(c.quotedSentences ?? [], `${c.id} quotes no unapproved clinical sentence`).toHaveLength(0);
      expect(["structural-only", "awaiting-radiologist-review"], `${c.id} states its wording honestly`)
        .toContain(c.wording);
    }
    const awaiting = CLINICAL_ACCEPTANCE_CASES.filter((c) => c.wording === "awaiting-radiologist-review");
    expect(awaiting.map((c) => c.id)).toEqual(["T2", "T3", "T5", "T10"]);
    // The four are the cases whose expected OUTCOME is a clinical claim (which normals a
    // hemorrhage retires, the consolidated Fazekas line, recurrence-versus-edema, and asserting a
    // negative), as distinct from cases whose expectation is a mechanism.
    expect(CLINICAL_ACCEPTANCE_CASES.filter((c) => c.wording === "structural-only")).toHaveLength(16);
  });

  it("covers all seven selection states, all three fields and both direction of the contract map", () => {
    const discharges = CLINICAL_ACCEPTANCE_CASES.map((c) => c.discharges.join(" | ")).join(" | ");
    for (const state of SELECTION_STATE_IDS) {
      expect(discharges, `selection state ${state} has at least one acceptance case`).toContain(`selection state ${state}`);
    }
    for (const field of ["findings", "impression", "recommendation", "technique", "identity"]) {
      expect(CLINICAL_ACCEPTANCE_CASES.filter((c) => (c.fields as readonly string[]).includes(field)).length,
        `the ${field} field is exercised by at least one case`).toBeGreaterThan(0);
    }

    // Case → contract: every case names at least one, and every name is a real contract.
    for (const c of CLINICAL_ACCEPTANCE_CASES) {
      const named = CASE_CONTRACTS[c.id];
      expect(named, `${c.id} is mapped to a Stage B contract`).toBeDefined();
      expect(named!.length, `${c.id} names at least one contract`).toBeGreaterThan(0);
      for (const name of named!) {
        expect(CONTRACT_NAMES, `${c.id} names a real contract`).toContain(name);
      }
    }
    // Contract → case: the mapping has no orphan keys and no contract without coverage. The exact
    // counts are a census, so losing a case from a contract is visible rather than implied.
    expect(Object.keys(CASE_CONTRACTS).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))).toEqual(
      CLINICAL_ACCEPTANCE_CASES.map((c) => c.id),
    );
    const census = new Map<string, number>();
    for (const names of Object.values(CASE_CONTRACTS)) {
      for (const n of names) census.set(n, (census.get(n) ?? 0) + 1);
    }
    expect([...census.entries()].sort()).toEqual([
      ["field-scoped combination contract", 5],
      ["publication snapshot", 8],
      ["publication validation contract", 9],
      ["selection-state contract", 14],
    ]);
  });

  it("keeps the register of measured defects tied to the cases that must empty it", () => {
    // PR #1014's nine order-dependent pairs are not a story about the past until a case has to
    // close them. T14 is that case, and the register itself is named from the measurement, not
    // re-derived here.
    const t14 = CLINICAL_ACCEPTANCE_CASES.find((c) => c.id === "T14");
    expect(t14?.expected.join(" ")).toMatch(/register of nine order-dependent pairs is empty/);
    const t5 = CLINICAL_ACCEPTANCE_CASES.find((c) => c.id === "T5");
    expect(t5?.wording, "pair nine is the one whose clinical wording is still open")
      .toBe("awaiting-radiologist-review");
    // T12 and T16 are the deselection and exclusivity halves of the same measured hole.
    expect(CLINICAL_ACCEPTANCE_CASES.filter((c) => c.discharges.join("|").includes("restore"))
      .map((c) => c.id).length, "the restore set is exercised by more than one case").toBeGreaterThan(1);
  });
});

// ── The engine hook: one skipped test per case, generated from the spec ────────────────────────
// These are the fixtures §5 asks for. They are skipped because the deterministic composer does not
// exist and the v4 catalogue holds no clinical content, so there is nothing to compose and nothing
// to compose it FROM. A skipped test is an honest placeholder for a case that must eventually run;
// a passing one would be a fabricated clinical claim.
describe("clinical acceptance executed against the reporting engine (Stage C — specification only)", () => {
  for (const c of CLINICAL_ACCEPTANCE_CASES) {
    it.skip(`${c.id} ${c.title}`, () => {
      // Compose the report for `c.selection` from the published catalogue and assert every
      // property in `c.expected`. Cases marked awaiting-radiologist-review additionally require
      // the owner's sign-off on the sentence they describe, which no amount of code can supply.
      expect(c.expected.length, "the case has assertions to run").toBeGreaterThan(0);
      expect(true, "no composer exists yet").toBe(false);
    });
  }
});
