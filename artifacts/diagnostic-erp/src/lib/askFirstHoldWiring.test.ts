/**
 * Ask-first hold — the UI wirings the store cannot pin (PR #1105 follow-up,
 * 2026-10-21). The HOLD itself (nothing written while the Replace dialog is
 * outstanding; cancel = pure dismissal) is pinned at the store boundary in
 * askFirstHoldSemantics.test.ts. This file pins the four wirings around it
 * the same way composerApplyGate pins the Apply hook: the real component
 * sources are read and their contract asserted, so a wiring regression fails
 * here rather than only in a browser.
 *
 *   1. The Replace dialog names both sides: `replace-will-remove` lists the
 *      radiologist's own sentences (manualKept) plus the vacated row's
 *      wording, `replace-will-add` lists the tile's incoming — and the old
 *      defect (looking the INCOMING row up in the ledger, rendering the same
 *      sentence twice) must stay gone.
 *   2. The Quick Select review owns Escape wherever focus sits (a mouse click
 *      on a chip never focuses it) and a Radix popup layer above it still
 *      owns the key first.
 *   3. The workspace bare-Escape shortcut yields to whoever owns the key,
 *      BEFORE its own preventDefault, or it would swallow the key from the
 *      owner too.
 *   4. A blocked tile tells the truth about WHY: manual wording is
 *      distinguished from engine-caused absence by the provenance map, so an
 *      engine-side rewording never reads "you edited this".
 *   5. The RIS Study Queue bridges to the reporting workspace through the
 *      EXISTING radiology_worklist link — a Report action for linked studies
 *      (no second workflow invented), an honest hint for unlinked ones.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
// The api-server package sits beside diagnostic-erp under artifacts/.
const API_ROUTE = join(SRC, "..", "..", "api-server", "src", "routes", "radiology.ts");

const DIALOG = "components/radiology/zai-workspace/confirm-overwrite-dialog.tsx";
const STRIP = "components/radiology/zai-workspace/quick-select-strip.tsx";
const COMMANDS = "hooks/radiology-workspace/useWorkspaceCommands.ts";
const WORKLIST = "pages/RadiologyWorklist.tsx";

describe("Priority 2 — the Replace dialog names what will be removed and what will be written", () => {
  it("renders both panels with stable test ids", () => {
    const src = read(DIALOG);
    expect(src).toContain('data-testid="replace-will-remove"');
    expect(src).toContain('data-testid="replace-will-add"');
    expect(src).toContain("Replace will remove");
    expect(src).toContain("and will write");
  });

  it("REMOVE reads the radiologist's own sentences (manualKept) and the vacated row's wording", () => {
    const src = read(DIALOG);
    expect(src).toContain("pendingPatch.manualKept?.[field]");
    expect(src).toContain("vacatedRow?.lastRendered?.[field]");
  });

  it("ADD reads the tile's resolved incoming — and never the ledger look-up that showed one sentence twice", () => {
    const src = read(DIALOG);
    expect(src).toContain("pendingPatch.incoming?.[field]");
    // The old defect: `patches.find((p) => p.id === pendingPatch.id)` looked
    // the INCOMING row up in the ledger (the pending write had parked it
    // there), so Existing and New rendered the same sentence. Under the
    // Priority 1 hold the row was never parked, so that lookup is both
    // dishonest and broken — it must stay gone.
    expect(src).not.toContain("patches.find((p) => p.id === pendingPatch.id)");
  });

  it("an empty REMOVE list says so out loud instead of showing nothing", () => {
    const src = read(DIALOG);
    expect(src).toContain('data-testid="replace-removes-nothing"');
    expect(src).toContain("Nothing — the report keeps every sentence it has now.");
  });
});

describe("Priority 3 — Escape belongs to whoever owns it", () => {
  it("the review panel dismisses on document-level Escape, but a popup layer above it keeps the key", () => {
    const src = read(STRIP);
    expect(src).toContain('document.addEventListener("keydown", onDocKey, true)');
    // The yield: any open dialog/menu answers first; this listener steps aside.
    expect(src).toContain('document.querySelector(\'[role="dialog"], [role="menu"]\')');
    // The listener only exists while a review is open — it never runs otherwise.
    expect(src).toContain("if (reviewId == null) return;");
  });

  it("the workspace shortcut yields to the owner BEFORE preventDefault", () => {
    const src = read(COMMANDS);
    expect(src).toContain("escapeKeyOwner");
    const guard = src.indexOf('resolved.action === "escape"');
    const yieldCheck = src.indexOf("escapeKeyOwner(");
    const preventDefault = src.indexOf("e.preventDefault();", yieldCheck);
    expect(guard).toBeGreaterThan(-1);
    expect(yieldCheck).toBeGreaterThan(-1);
    expect(preventDefault).toBeGreaterThan(yieldCheck);
  });

  it("a blocked tile distinguishes the radiologist's edit from an engine-side rewording", () => {
    const src = read(STRIP);
    // The honest judge is the provenance map, not the byte-absence alone.
    expect(src).toContain("contributionProtected");
    expect(src).toContain("blockedChipManual");
    expect(src).toContain("your edited wording was kept");
    expect(src).toContain("changed by another report action");
    // The old label read as an accusation for every absence — engine-caused
    // ones included. It must stay gone.
    expect(src).not.toContain("manual kept");
  });
});

describe("RIS → worklist — the Study Queue reports through the existing worklist link", () => {
  it("the queue renders a Report action for linked studies and an honest hint for unlinked ones", () => {
    const src = read(WORKLIST);
    expect(src).toContain("s.worklistId != null");
    expect(src).toContain("reportingWorkspacePath(s.worklistId!)");
    expect(src).toContain("not in PACS queue");
    expect(src).toContain('data-testid={`ris-study-report-${s.id}`}');
  });

  it("the api route bridges the two id spaces without duplicating queue rows", () => {
    const src = readFileSync(API_ROUTE, "utf8");
    // A scalar subquery, not a LEFT JOIN: a study can never multiply queue rows.
    expect(src).toContain("SELECT MIN(");
    expect(src).toContain("worklistId");
    expect(src).toMatch(/scalar subquery|rather than a\n\s*LEFT JOIN/);
  });
});
