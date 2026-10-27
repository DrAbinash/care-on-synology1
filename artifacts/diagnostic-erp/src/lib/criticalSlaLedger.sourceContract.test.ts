/**
 * Source-contract ratchet for the critical-SLA session ledger and the Print nudge.
 *
 * The behaviour file (criticalSlaLedger.behaviour.test.ts) proves the store
 * semantics. Most of this feature, though, is wiring: a field that must be
 * classified as session state, a restore call after each of the TWO study-
 * transition reset paths, a live badge in the queue strip, a nudge gate inside
 * the print callback and a dialog that renders it. A wire can be cut with every
 * behavioural test still green, so each one is pinned here as a source
 * contract, exactly as criticalResultCommsFlag.contract.test.ts pins the flag
 * gates.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
/** CRLF-normalised for the same reason as the flag contract file: this repo is
 *  checked out with CRLF on the Windows dev box and LF in CI. */
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8").replace(/\r\n/g, "\n");

describe("store — the ledger and its re-projection", () => {
  const store = read("lib/zai-workspace/store.ts");

  it("declares and initialises criticalSlaStarts", () => {
    expect(store).toContain("criticalSlaStarts: Record<string, number>;");
    expect(store).toMatch(/notification: null, criticalSlaStartedAt: null, criticalSlaMinutes: 15, criticalSlaEscalated: false, criticalSlaStarts: \{\},/);
  });

  it("startCriticalSla writes the ledger entry only when the study has none", () => {
    // First detection fixes the timestamp; a restart on a study that already
    // has an entry would silently reset the clock — the exact defect the
    // ledger exists to close.
    expect(store).toContain("if (starts[id] == null) set({ criticalSlaStartedAt: now, criticalSlaEscalated: false, criticalSlaStarts: { ...starts, [id]: now } })");
  });

  it("selectStudy restores the incoming study's clock right after the reset", () => {
    const resetIdx = store.indexOf("selectStudy: (id) => {");
    expect(resetIdx).toBeGreaterThan(-1);
    const restoreIdx = store.indexOf("get().restoreCriticalSlaFor(id);", resetIdx);
    expect(restoreIdx).toBeGreaterThan(resetIdx);
  });

  it("restoreCriticalSlaFor recomputes escalation from real elapsed time", () => {
    expect(store).toContain("criticalSlaEscalated: Date.now() - startedAt >= get().criticalSlaMinutes * 60_000");
  });

  it("finalize retires the ledger entry with the clock", () => {
    expect(store).toMatch(/completeFinalize[\s\S]{0,400}delete starts\[id\]/);
  });

  it("clearCriticalSla retires the ledger entry too", () => {
    const idx = store.indexOf("clearCriticalSla: () => {");
    expect(idx).toBeGreaterThan(-1);
    expect(store.slice(idx, idx + 400)).toContain("delete starts[id]");
  });
});

describe("state classification — the ledger is session scope", () => {
  it("is deliberately OUTSIDE the clinical reset fields", () => {
    // The ACTIVE clock (criticalSlaStartedAt) is clinical and dies with the
    // switch. The ledger is queue-level session state — see
    // clinicalStateReset.hardening.test.ts SESSION_SCOPE_KEYS, which the
    // classification closure forces this decision into.
    const reset = read("lib/zai-workspace/clinicalStateReset.ts");
    expect(reset).not.toContain('"criticalSlaStarts"');
  });

  it("is classified as session scope in the hardening partition", () => {
    const hardening = read("lib/clinicalStateReset.hardening.test.ts");
    expect(hardening).toContain('"criticalSlaStarts",');
  });
});

describe("useDraftPersistence — the second transition path restores too", () => {
  it("calls restoreCriticalSlaFor after the route-param study reset", () => {
    // Worklist navigate / deep link / Back never call selectStudy; without
    // this call the clock would survive only queue-row switches.
    const dp = read("hooks/radiology-workspace/useDraftPersistence.ts");
    const resetIdx = dp.indexOf("useWorkspace.setState(studyTransitionReset(studyId));");
    const restoreIdx = dp.indexOf("useWorkspace.getState().restoreCriticalSlaFor(studyId);");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(resetIdx);
  });
});

describe("worklist strip — the queue remembers the clock", () => {
  const strip = read("components/radiology/zai-workspace/worklist-strip.tsx");

  it("reads the session ledger and the SLA window from the store", () => {
    expect(strip).toContain("s => s.criticalSlaStarts");
    expect(strip).toContain("s => s.criticalSlaMinutes");
  });

  it("renders a per-row badge only when THIS study has a live clock", () => {
    expect(strip).toContain("data-testid={`queue-row-crit-sla-${s.id}`}");
    expect(strip).toContain("const critStart = critStarts[s.id] ?? null;");
  });

  it("keeps the static triangle for a criticalFlag row with no session clock", () => {
    // No start time → no fake elapsed number. The honest fallback is the
    // pre-existing triangle, not an invented timer.
    expect(strip).toContain(") : s.criticalFlag ? (");
    expect(strip).toContain("Critical finding flagged on this study");
  });

  it("ticks only while at least one clock runs", () => {
    // The strip is mounted for every workspace session; an idle interval would
    // be pure cost for every queue without critical findings.
    expect(strip).toContain("if (critCount === 0) return;");
    expect(strip).toContain("setCritNow(Date.now())");
  });

  it("does NOT read the comms flag — emptiness is the gate", () => {
    // Entries are written only under the flag, so an empty ledger IS the
    // off-state. A flag read here would add an eighth imperative gate point
    // for no behavioural difference (closure pinned in the flag contract).
    expect(strip).not.toContain("criticalCommsEnabled");
  });
});

describe("print nudge — the gate, the dialog, the wiring", () => {
  const hook = read("hooks/radiology-workspace/useWorkspaceExportShare.ts");
  const overlays = read("components/radiology/workspace/WorkspaceOverlays.tsx");
  const clinicalUi = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");

  it("gates on the flag, the content lock, the detector AND the checklist", () => {
    expect(hook).toContain("if (criticalCommsEnabled() && !contentLocked) {");
    // The detector reads the LIVE texts (re-audit): the debounced mirrors let
    // a finding typed in the 300 ms window before the click dodge the reminder.
    expect(hook).toContain("const live = readWorkspaceClinicalTexts();");
    expect(hook).toContain("detectCriticalFindings(live.findingsText, [live.impressionText])");
    expect(hook).toContain("if (hits.length > 0 && !checklistComm.phoned) {");
  });

  it("reads the elapsed time from the session ledger, never invents it", () => {
    expect(hook).toContain("ws.criticalSlaStarts[ws.activeStudyId] ?? null");
    // Null elapsed is an honest "no clock is running", carried through:
    expect(hook).toContain("elapsedMinutes: start != null ? Math.max(0, Math.floor((Date.now() - start) / 60_000)) : null");
  });

  it("nudge declines into the unchanged print path", () => {
    expect(hook).toContain("await runPrintLikeFinal();");
    // and "Print anyway" clears the nudge before running the same print
    expect(hook).toMatch(/confirmedPrintLikeFinal[\s\S]{0,200}setPrintCriticalNudge\(null\);[\s\S]{0,120}await runPrintLikeFinal\(\);/);
  });

  it("the clinical UI feeds the hook the same checklist the finalize gate reads", () => {
    const idx = clinicalUi.indexOf("contentLocked: signedContentLocked,");
    expect(idx).toBeGreaterThan(-1);
    expect(clinicalUi.slice(idx, idx + 80)).toContain("checklistComm,");
  });

  it("the dialog renders under the flag with both exits", () => {
    expect(overlays).toContain("criticalCommsEnabled() && printCriticalNudge && (");
    expect(overlays).toContain('data-testid="print-critical-nudge"');
    expect(overlays).toContain("Communicate first");
    expect(overlays).toContain('data-testid="print-critical-nudge-print-anyway"');
  });
});
