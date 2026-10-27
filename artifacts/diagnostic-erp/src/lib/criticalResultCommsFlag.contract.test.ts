/**
 * PR-5 — source-contract ratchet for ff_radiology_critical_result_comms.
 *
 * WHAT THIS ADDS ON TOP OF THE BEHAVIOURAL TESTS
 *   criticalResultCommsFlag.behaviour.test.ts drives the real store and proves
 *   the SLA clock and interrupt popup obey the flag. But most of this workflow's
 *   gate points are JSX renders — the Mark Critical Finding panel, the interrupt
 *   card, the SLA timer, the tracker page, three navigation surfaces — and this
 *   package has no DOM harness, so nothing can execute them. A render gate can
 *   therefore be deleted with every test still green. This file pins each one as
 *   a source contract instead.
 *
 * THE TWO THINGS IT RATCHETS
 *   1. Completeness — every gate point listed below is still present. Removing
 *      one, or moving it somewhere the string no longer matches, fails.
 *   2. Closure — the set of files that read the flag is EXACTLY the set listed.
 *      A new gate added elsewhere (a tenth surface nobody told the tracker
 *      page about) fails just as loudly, so the list cannot silently drift out
 *      of date in either direction.
 *
 * IT ALSO PINS WHAT THE FLAG MUST NOT TOUCH
 *   The detector (lib/criticalResults.ts), the pure finalize-safety aggregator
 *   (lib/finalizeSafety.ts), the PACS dashboard widget and the Critical Alerts
 *   Manager are all asserted flag-free. That is the other half of the contract:
 *   this flag makes a communication protocol optional, it does not blind
 *   detection, and it must not creep into neighbouring subsystems.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { CRITICAL_COMMS_FLAG, criticalCommsEnabled } from "./criticalResultCommsFlag";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
/** Line endings are normalised because this repo is checked out with
 *  core.autocrlf=true on the Windows dev box (CRLF in the working tree) and LF
 *  in CI. Without this, every multi-line needle below would pass on one and
 *  fail on the other. */
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8").replace(/\r\n/g, "\n");

/** Paths relative to src/, posix separators, so the expected lists below read
 *  the same on the Windows dev box and the Linux CI runner. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = resolve(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue;
      walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative(ERP_SRC, abs).split(sep).join("/"));
    }
  }
  return out;
}

const ALL_SOURCES = walk(ERP_SRC);
const filesContaining = (needle: string) =>
  ALL_SOURCES.filter((f) => read(f).includes(needle)).sort();

/** Every file that imperatively reads the flag through the single read point.
 *  The definition module and this file's own tests are excluded. */
const IMPERATIVE_GATE_FILES = filesContaining("criticalCommsEnabled").filter(
  (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && f !== "lib/criticalResultCommsFlag.ts",
);

/** Navigation surfaces using the repo's declarative catalog field instead. */
const DECLARATIVE_GATE_FILES = filesContaining(`featureFlag: "${CRITICAL_COMMS_FLAG}"`);

describe("ff_radiology_critical_result_comms — gate closure", () => {
  it("reads the flag from exactly one module", () => {
    // If a second definition appeared, the gate points could disagree.
    // Test files are excluded because THIS file's own source contains the
    // pattern below as a literal, and would otherwise match itself.
    const definers = ALL_SOURCES.filter(
      (f) =>
        !f.endsWith(".test.ts") &&
        !f.endsWith(".test.tsx") &&
        /export function criticalCommsEnabled/.test(read(f)),
    );
    expect(definers).toEqual(["lib/criticalResultCommsFlag.ts"]);
    expect(typeof criticalCommsEnabled).toBe("function");
  });

  it("the imperative gate set is exactly the enumerated workflow surfaces", () => {
    // B-10 deleted the Command Center's parallel copy of this workflow: it was a
    // second authoring surface, and a critical-result checklist that can flip a
    // flag and write a note into a signed report is authoring. The console keeps
    // no copy, so it needs no gate — and the flag now governs one workflow, not
    // two. See "the command center holds no copy to gate" below, which is the
    // assertion that stops this shrinking list from being read as an achievement.
    //
    // The SLA PR added useWorkspaceExportShare.ts: the critical-finding
    // communication NUDGE at Print. It reads the flag because it is workflow,
    // not detection — with the flag off there is no checklist to consult and no
    // SLA clock, so the nudge would name an obligation this centre does not run.
    expect(IMPERATIVE_GATE_FILES).toEqual([
      "components/radiology/workspace/ReportCanvas.tsx",
      "components/radiology/workspace/WorkspaceOverlays.tsx",
      "components/radiology/workspace/WorkspaceTopBar.tsx",
      "hooks/radiology-workspace/useStudyFinalize.ts",
      "hooks/radiology-workspace/useWorkspaceExportShare.ts",
      "lib/copilotCriticalModule.ts",
      "lib/zai-workspace/store.ts",
      "pages/CriticalFindings.tsx",
    ]);
  });

  it("the declarative gate set is exactly the three navigation surfaces", () => {
    expect(DECLARATIVE_GATE_FILES).toEqual([
      "components/Layout.tsx",
      "lib/globalCommandCatalog.ts",
      "pages/Radiology.tsx",
    ]);
  });

  it("defaults OFF in FEATURE_FLAG_DEFAULTS so a cold start cannot show the workflow", () => {
    // Before GET /api/feature-flags resolves, isFeatureEnabled falls back to
    // this table. A `true` here would flash the whole workflow on every boot.
    const src = read("lib/staffSession.ts");
    expect(src).toMatch(new RegExp(`${CRITICAL_COMMS_FLAG}:\\s*false,`));
  });
});

describe("ff_radiology_critical_result_comms — each gate point still present", () => {
  const cases: { file: string; needle: string; what: string }[] = [
    {
      file: "lib/copilotCriticalModule.ts",
      needle: "if (!criticalCommsEnabled()) return [];",
      what: "the copilot advisory module stays silent — its advice points at controls that are not rendered",
    },
    {
      file: "lib/zai-workspace/store.ts",
      needle: "const ci = criticalCommsEnabled() ? items.filter",
      what: "recomputeCopilot starts no SLA clock and pushes no interrupt",
    },
    {
      file: "hooks/radiology-workspace/useStudyFinalize.ts",
      needle: "const gatedCriticalHits = criticalCommsOn ? criticalHits : [];",
      what: "detector hits are withheld from computeFinalizeSafety",
    },
    {
      file: "hooks/radiology-workspace/useStudyFinalize.ts",
      needle: "criticalHits: gatedCriticalHits.map(h => ({ label: h.label })),",
      what: "BOTH finalize gates receive the withheld list, not the raw detector output",
    },
    {
      file: "hooks/radiology-workspace/useStudyFinalize.ts",
      needle: "criticalNote: criticalNote || (criticalCommsOn && criticalHits.length > 0",
      what: "a hidden detector never writes auto-derived text into the signed record",
    },
    {
      file: "hooks/radiology-workspace/useWorkspaceExportShare.ts",
      needle: "if (criticalCommsEnabled() && !contentLocked) {",
      what: "the print nudge — a critical finding the checklist does not record as communicated asks before printing",
    },
    {
      file: "components/radiology/workspace/ReportCanvas.tsx",
      needle: '{criticalCommsEnabled() && (\n                    <div className="flex flex-col gap-2 border rounded-md p-3 bg-red-50/40 border-red-100" data-testid="critical-finding-panel">',
      what: "the Mark Critical Finding panel + communication checklist",
    },
    {
      file: "components/radiology/workspace/WorkspaceOverlays.tsx",
      needle: "{criticalCommsEnabled() && <InterruptChannelCard />}",
      what: "the interrupt popup",
    },
    {
      file: "components/radiology/workspace/WorkspaceTopBar.tsx",
      needle: "{criticalCommsEnabled() && criticalSlaStartedAt && <CriticalSlaTimer />}",
      what: "the 15-minute SLA timer",
    },
    {
      file: "pages/CriticalFindings.tsx",
      needle: "enabled: criticalCommsEnabled(),",
      what: "the tracker page never fires a request that would 404",
    },
    {
      file: "pages/CriticalFindings.tsx",
      needle: "if (!criticalCommsEnabled()) {",
      what: "a bookmarked URL resolves to a 'switched off' notice, not a dead link",
    },
    {
      file: "components/Layout.tsx",
      needle: `path: "/radiology/critical-findings"`,
      what: "the sidebar leaf still points at the tracker route",
    },
    {
      file: "lib/globalCommandCatalog.ts",
      needle: "export function isCommandActionVisible",
      what: "the Ctrl+K palette filters on the declarative flag at render time",
    },
  ];

  for (const c of cases) {
    it(`${c.file} gates ${c.what}`, () => {
      expect(read(c.file)).toContain(c.needle);
    });
  }

  it("the command center holds no copy to gate", () => {
    // Shrinking IMPERATIVE_GATE_FILES above proves nothing on its own: a deleted
    // control satisfies an empty list as well as a gated one does. So the
    // removal is asserted as a property of the file that is still routed here —
    // no flag read, no auto-detect, no checklist, no note that could reach a
    // signed report. If the workflow is ever copied back onto this console, the
    // gate-set test fails AND this one does.
    const cc = read("pages/RadiologyCommandCenter.tsx");
    expect(cc).not.toContain("criticalCommsEnabled");
    expect(cc).not.toContain("criticalCommsOn");
    expect(cc).not.toContain("Critical Communication Checklist");
    expect(cc).not.toContain("checklistComm");
    expect(cc).not.toContain("setIsCritical");
    expect(cc).not.toContain("criticalNote");
    expect(cc).toContain("@deprecated");
  });

  it("the sidebar, palette and hub card all carry the same flag literal", () => {
    expect(read("components/Layout.tsx")).toContain(
      `path: "/radiology/critical-findings",   icon: AlertCircle,    label: "Critical Findings", featureFlag: "${CRITICAL_COMMS_FLAG}"`,
    );
    expect(read("lib/globalCommandCatalog.ts")).toContain(
      `page("rad-critical", "Critical Findings", "/radiology/critical-findings"`,
    );
    expect(read("pages/Radiology.tsx")).toContain(`featureFlag: "${CRITICAL_COMMS_FLAG}"`);
  });
});

describe("ff_radiology_critical_result_comms — what it must NOT touch", () => {
  it("leaves the detector unflagged", () => {
    // Detection is clinical information about the report text. A centre that
    // does not run the communication protocol must still be told that a report
    // describes an acute infarct.
    expect(read("lib/criticalResults.ts")).not.toContain("criticalCommsEnabled");
    expect(read("lib/criticalResults.ts")).not.toContain(CRITICAL_COMMS_FLAG);
  });

  it("keeps finalizeSafety.ts pure — the gate lives at the call site", () => {
    // computeFinalizeSafety / criticalFindingBlocksFinalize are pure and
    // root-testable. Putting the flag inside them would make their output depend
    // on a module-level variable and break finalizeSafety.critical.test.ts.
    const src = read("lib/finalizeSafety.ts");
    expect(src).not.toContain("criticalCommsEnabled");
    expect(src).not.toContain(CRITICAL_COMMS_FLAG);
    expect(src).not.toContain("staffSession");
  });

  it("keeps runCopilotAnalysis pure so the rail's informational item survives", () => {
    // types.ts is the pure analysis core. If the flag were read in there, the
    // "Critical finding detected" rail item would disappear with the workflow —
    // which is the detector/workflow conflation this PR exists to avoid.
    const src = read("lib/zai-workspace/types.ts");
    expect(src).not.toContain("criticalCommsEnabled");
    expect(src).not.toContain(CRITICAL_COMMS_FLAG);
  });

  it("the store still publishes the rail items unconditionally", () => {
    // `set({ copilotItems: items })` must sit OUTSIDE the flag ternary, or
    // switching the workflow off would also empty the copilot rail.
    const src = read("lib/zai-workspace/store.ts");
    const ciIdx = src.indexOf("const ci = criticalCommsEnabled() ? items.filter");
    const setIdx = src.indexOf("set({ copilotItems: items });", ciIdx);
    expect(ciIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(ciIdx);
    // and the ternary's false branch is an empty list, not a skipped assignment
    expect(src.slice(ciIdx, setIdx)).toContain(": [];");
  });

  it("leaves the PACS dashboard critical-alerts widget alone", () => {
    // Different endpoint (/api/radiology/critical-findings), different table
    // (radiology_critical_findings), explicitly out of scope.
    expect(read("pages/PacsDashboard.tsx")).not.toContain(CRITICAL_COMMS_FLAG);
    expect(read("pages/PacsDashboard.tsx")).toContain("/api/radiology/critical-findings");
  });

  it("leaves the Critical Alerts Manager alone", () => {
    // A third, separate subsystem: /api/radiology-workflow/critical-alerts.
    expect(read("pages/CriticalAlertsManager.tsx")).not.toContain(CRITICAL_COMMS_FLAG);
    expect(read("pages/CriticalAlertsManager.tsx")).toContain("/api/radiology-workflow/critical-alerts");
  });

  it("deletes nothing — no gate point drops a table, a column or a row", () => {
    for (const f of [...IMPERATIVE_GATE_FILES, ...DECLARATIVE_GATE_FILES]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
      expect(src, f).not.toMatch(/criticalFindingsTable/);
    }
  });
});
