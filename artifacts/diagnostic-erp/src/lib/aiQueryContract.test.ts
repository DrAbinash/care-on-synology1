/**
 * aiQueryContract.test.ts — PR1 wiring contracts (source-level).
 *
 * This repo's test environment has no browser/DOM, so frontend-to-backend
 * wiring is enforced the same way canonicalWorkspaceRouting.test.ts and
 * platform-contract.test.ts do it: by reading the real source files and
 * failing loudly if a dead wire ever reappears.
 *
 * Contracts:
 *  1. POST /api/ai-reporting/query is called ONLY through the typed client
 *     (lib/aiReportingClient.ts) — no page may hand-roll the request again,
 *     which is how the promptText/prompt mismatch shipped unnoticed.
 *  2. The prior-studies fetch always goes through buildPriorStudiesPath (the
 *     canonical, /api-prefixed, authenticated path) — never a raw
 *     un-prefixed fetch() that bypasses the Vite proxy and auth header.
 *  3. The backend actually implements GET /prior-studies on the copilot
 *     router, permission-gated, so contract 2 has a live counterpart.
 *  4. Both prior panels render a real error state (with retry) distinct from
 *     the empty state, and the workspace passes the current study for
 *     server-side self-exclusion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // artifacts/diagnostic-erp/src/lib
const ERP_SRC = resolve(HERE, "..");
const REPO = resolve(HERE, "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const SRC_FILES = walk(ERP_SRC);

describe("AI query endpoint — single typed entry point", () => {
  it("only lib/aiReportingClient.ts CALLS /api/ai-reporting/query (doc comments may mention it)", () => {
    const callSite = /(?:post|fetch)\s*(?:<[^>]*>)?\s*\(\s*[`"']\/api\/ai-reporting\/query/;
    const offenders = SRC_FILES.filter((f) => callSite.test(read(f)))
      .map((f) => f.replace(ERP_SRC + "/", ""))
      .filter((f) => f !== "lib/aiReportingClient.ts");
    expect(offenders).toEqual([]);
  });

  it("every former promptText call site now uses the typed client", () => {
    for (const rel of [
      "pages/RadiologyReportingWorkspace.legacy.tsx",
      "pages/RadiologyCommandCenter.tsx",
      "pages/DicomViewer.tsx",
      "components/NeuroPromptPanel.tsx",
    ]) {
      expect(read(resolve(ERP_SRC, rel))).toContain("queryAiReporting");
    }
  });

  it("the client sends the canonical promptText field (typed request)", () => {
    const client = read(resolve(ERP_SRC, "lib/aiReportingClient.ts"));
    expect(client).toContain("AiReportingQueryRequest");
    expect(client).toContain("/api/ai-reporting/query");
  });

  it("the server accepts promptText with legacy prompt fallback and rejects an empty effective prompt", () => {
    const route = read(resolve(REPO, "artifacts/api-server/src/routes/aiReporting.ts"));
    expect(route).toContain("AiReportingQueryRequestSchema.safeParse");
    expect(route).toContain("(promptText ?? prompt)");
    expect(route).toMatch(/No prompt provided/);
    // The silent generic fallback that dropped the radiologist's findings must
    // stay dead in the /query handler specifically (other endpoints keep their
    // own prompt flows and are out of PR1 scope). Slice the handler out:
    const start = route.indexOf('router.post("/query"');
    expect(start).toBeGreaterThan(-1);
    const end = route.indexOf("router.", start + 1);
    const queryHandler = route.slice(start, end === -1 ? undefined : end);
    expect(queryHandler).not.toContain('|| "Provide a detailed radiology report');
  });
});

describe("Prior-studies wiring", () => {
  it("no raw un-prefixed fetch of prior-studies anywhere (must use buildPriorStudiesPath)", () => {
    const offenders = SRC_FILES.filter((f) => {
      const src = read(f);
      // any reference to the endpoint without the /api prefix, or any direct
      // fetch() of it that would skip the auth header
      return /[`"']\/radiology-copilot\/prior-studies/.test(src) || /fetch\([^)]*prior-studies/.test(src);
    }).map((f) => f.replace(ERP_SRC + "/", ""));
    expect(offenders).toEqual([]);
  });

  it("both prior panels go through the canonical path builder", () => {
    expect(read(resolve(ERP_SRC, "components/radiology/ComparisonPanel.tsx"))).toContain("buildPriorStudiesPath");
    expect(read(resolve(ERP_SRC, "components/RadiologyCopilotPanel.tsx"))).toContain("buildPriorStudiesPath");
  });

  it("backend implements GET /prior-studies on the copilot router, permission-gated", () => {
    const route = read(resolve(REPO, "artifacts/api-server/src/routes/radiologyCopilot.ts"));
    expect(route).toContain('"/prior-studies"');
    expect(route).toContain('requireStaffPermission("/radiology")');
    expect(route).toContain("PriorStudiesQuerySchema");
    expect(route).toContain("mergePriorStudies");
  });

  it("panels render a distinct error state with retry — never error-as-empty", () => {
    const comparison = read(resolve(ERP_SRC, "components/radiology/ComparisonPanel.tsx"));
    expect(comparison).toContain("derivePriorPanelState");
    expect(comparison).toContain("comparison-panel-error");
    expect(comparison).toContain("Retry");
    const copilot = read(resolve(ERP_SRC, "components/RadiologyCopilotPanel.tsx"));
    expect(copilot).toContain("copilot-prior-error");
    expect(copilot).toContain("Retry");
  });

  it("workspaces pass the current study for server-side self-exclusion", () => {
    expect(read(resolve(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"))).toMatch(/excludeStudyId=\{(studyId|entry\?\.studyId)/);
    expect(read(resolve(ERP_SRC, "pages/UsgCompanionWorkspace.tsx"))).toMatch(/excludeStudyId=\{studyId/);
  });
});

describe("AI output stays advisory (draft-only safety)", () => {
  it("command center never silently overwrites typed findings with the AI draft", () => {
    const src = read(resolve(ERP_SRC, "pages/RadiologyCommandCenter.tsx"));
    const guarded = /!rawFindings\.trim\(\)\s*\|\|\s*\n?\s*window\.confirm/.test(src.replace(/\s+/g, " "));
    expect(guarded).toBe(true);
  });
});
