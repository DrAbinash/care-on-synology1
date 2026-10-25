/**
 * Source contracts for the OHIF window/level fix — ERP side (PR "key image
 * window level", leg 2 of 2).
 *
 * The chain the audit defect lived in: the radiologist adjusts window/level in
 * OHIF, clicks "Add Current OHIF Image", and every link of the chain dropped the
 * window — the anchor carried identity only, the attach body carried identity
 * only, and the from-pacs route fetched Orthanc's render with no `window`
 * argument, so the frozen evidence was rendered under the PACS's own default
 * windowing, not the window the finding was seen through.
 *
 * Leg 1 (care-pacs, merged) makes the anchor carry the VOI of the same viewport
 * the identity came from. These contracts pin THIS side: the fields survive the
 * bridge validation, reach the request builder, are accepted by the route
 * schema, are passed to the rendered fetch as Orthanc's three-token `window`
 * argument, and are persisted as provenance beside the pixels they shaped.
 *
 * Pure behaviour is pinned where the units live:
 *   - diagnostic-erp ohifViewerBridge.test.ts (validOhifVoi, anchor → context)
 *   - diagnostic-erp pacsImagePicker.test.ts (buildViewerStillBody windowing)
 *   - api-server reportPresentation.test.ts (orthancRenderedWindowParam)
 * These contracts pin the WIRING between those units, because a window that
 * dies between two correct functions is the defect this fixes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, "..", "routes");
const ERP_LIB = join(HERE, "..", "..", "..", "diagnostic-erp", "src", "lib");
const REPORT_IMAGES = join(HERE, "..", "lib", "reportImages.ts");
const ROUTE_FILE = join(ROUTES, "radiology-report-generator.ts");
const HOOK_FILE = join(
  HERE, "..", "..", "..", "diagnostic-erp", "src",
  "hooks", "radiology-workspace", "useOhifViewerBridge.ts",
);
const read = (p: string) => readFileSync(p, "utf8");

describe("PR window-level — the window reaches the frozen pixels", () => {
  const route = read(ROUTE_FILE);
  const reportImages = read(REPORT_IMAGES);

  it("the from-pacs schema accepts the window as the pair it must be", () => {
    expect(route).toContain("windowWidth: z.number().finite().positive()");
    expect(route).toContain("windowCenter: z.number().finite()");
    expect(route).toContain("windowWidth and windowCenter travel together");
  });

  it("the route passes the window to the rendered fetch", () => {
    const fetchCall = route.indexOf("const rendered = await fetchPrintImageBytes");
    expect(fetchCall).toBeGreaterThan(-1);
    const windowing = route.indexOf("const windowing = orthancRenderedWindowParam(claim)");
    expect(windowing).toBeGreaterThan(-1);
    expect(windowing).toBeLessThan(fetchCall);
    // The fetch receives it as its second argument.
    expect(route).toMatch(/fetchPrintImageBytes\(\{[\s\S]*?\},\s*windowing\)/);
  });

  it("the route persists the window as provenance beside the pixels", () => {
    expect(route).toContain("const viewportSnapshotJson = windowing");
    expect(route).toContain("version: 1, windowWidth: windowing.windowWidth");
    expect(route).toMatch(/viewportSnapshotJson,?\s*\n\s*capturedAt/);
  });

  it("the rendered fetch builds Orthanc's three-token window argument", () => {
    // WadoRsRetrieveRendered.cpp parses `window` as exactly center,width,shape
    // with shape ∈ {linear, linear-exact, sigmoid} — anything else is a 400.
    expect(reportImages).toMatch(/`\$\{wc\},\$\{ww\},linear`/);
    expect(reportImages).toMatch(/window:\s*windowParam/);
  });

  it("the rendered fetch has no second-argument default — the window must be explicit", () => {
    expect(reportImages).toMatch(
      /fetchPrintImageBytes\(ref: \{[\s\S]*?\}, windowing\?: RenderedWindowing \| null\)/,
    );
  });
});

describe("PR window-level — the window survives the ERP chain", () => {
  const bridge = read(join(ERP_LIB, "ohifViewerBridge.ts"));
  const picker = read(join(ERP_LIB, "pacsImagePicker.ts"));
  const hook = read(HOOK_FILE);
  const observationAnchor = read(join(ERP_LIB, "observationAnchor.ts"));

  it("the bridge validates the anchor's window before letting it flow", () => {
    expect(bridge).toContain("export function validOhifVoi");
    // The acceptance rule, in the source's own words: a non-number, non-finite,
    // or non-positive width is dropped — never repaired.
    expect(bridge).toContain('typeof ww !== "number" || !Number.isFinite(ww) || ww <= 0');
    expect(bridge).toContain('typeof wc !== "number" || !Number.isFinite(wc)');
    expect(bridge).toMatch(
      /\.\.\.\(voi \? \{ windowWidth: voi\.windowWidth, windowCenter: voi\.windowCenter \} : \{\}\)/,
    );
  });

  it("the viewport context carries the window the anchor named", () => {
    expect(observationAnchor).toContain("windowWidth?: number;");
    expect(observationAnchor).toContain("windowCenter?: number;");
  });

  it("the request builder sends the window only as a validated pair", () => {
    expect(picker).toContain("function viewerWindowing");
    expect(picker).toMatch(
      /\.\.\.\(voi \? \{ windowWidth: voi\.windowWidth, windowCenter: voi\.windowCenter \} : \{\}\)/,
    );
  });

  it("the attach hook threads the anchor's window into the request body", () => {
    expect(hook).toContain("windowWidth: ref.windowWidth ?? null");
    expect(hook).toContain("windowWidth: a.windowWidth ?? null");
  });
});
