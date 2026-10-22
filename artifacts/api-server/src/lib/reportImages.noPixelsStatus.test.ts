/**
 * reportImages — the no-pixels honesty contract (audit 3.7):
 *  - a fetch Orthanc refused is "failed";
 *  - a cell the export budget skipped is "budget";
 *  - both keep their place and their SOP identity, and neither ever claims
 *    pixels it does not have;
 *  - the reasons are LOGGED, so an operator chasing black squares finally has
 *    a server-side trace.
 *
 * The db is FIFO-scripted (two references); global fetch is stubbed to one
 * success and one failure — the same harness shape the pacs suites use.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const selectScript: { name: string; rows: unknown[] }[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { __name?: string }) => ({
        where: () => ({
          orderBy: async () => {
            const entry = selectScript.find((s) => s.name === tbl?.__name);
            return entry ? entry.rows : [];
          },
          async then(resolve: (v: unknown) => void) {
            const entry = selectScript.find((s) => s.name === tbl?.__name);
            resolve(entry ? entry.rows : []);
          },
        }),
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  radiologyImageReferencesTable: { __name: "radiology_image_references" },
  radiologyReportDraftsTable: { __name: "radiology_report_drafts" },
}));
vi.mock("./pacs/pacsConfig", () => ({ getRadiologyConfig: async () => ({}) }));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");

function ref(i: number, order: number) {
  return {
    id: i,
    draftId: 7,
    description: `IMG ${i}`,
    studyInstanceUid: `1.2.3.${i}`,
    seriesInstanceUid: `1.2.3.${i}.1`,
    sopInstanceUid: `1.2.3.${i}.2`,
    frameNumber: null,
    displayOrder: order,
    isKeyImage: i === 1,
    createdBy: null,
    presentationJson: null,
  };
}

let fetchCalls: { path: string }[];

beforeEach(() => {
  process.env.ORTHANC_INTERNAL_URL = "http://orthanc-internal:8042";
  process.env.ORTHANC_USERNAME = "u";
  process.env.ORTHANC_PASSWORD = "p";
  fetchCalls = [];
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url as string).pathname;
    fetchCalls.push({ path });
    if (path.endsWith("/rendered") && path.includes("1.2.3.2.")) {
      return new Response("nope", { status: 500 });
    }
    return new Response(Buffer.from(JPEG, "base64"), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.ORTHANC_INTERNAL_URL;
});

describe("buildKeyImageModel — the no-pixels reason travels with the cell", async () => {
  const { buildKeyImageModel } = await import("./reportImages");

  it("a fetched cell carries pixels and no status", () => {
    const model = buildKeyImageModel(ref(1, 0), "data:image/jpeg;base64,AAA", null);
    expect(model.src).toBe("data:image/jpeg;base64,AAA");
    expect(model.imageFetchStatus).toBeNull();
    expect(model.isKeyImage).toBe(true);
  });

  it("a failed fetch is marked failed and keeps the hydrate identity", () => {
    const model = buildKeyImageModel(ref(2, 1), null, "failed");
    expect(model.src).toBe("");
    expect(model.imageFetchStatus).toBe("failed");
    expect(model.sopInstanceUid).toBe("1.2.3.2.2");
  });

  it("a budget skip is marked budget — never accused of being unreadable", () => {
    const model = buildKeyImageModel(ref(3, 2), null, "budget");
    expect(model.src).toBe("");
    expect(model.imageFetchStatus).toBe("budget");
  });
});

describe("resolveDraftKeyImages — every reference is attempted, failures are explicit", async () => {
  const { resolveDraftKeyImages } = await import("./reportImages");

  it("marks the refused fetch failed, the good one fetched, keeps display order", async () => {
    selectScript.length = 0;
    selectScript.push({
      name: "radiology_image_references",
      rows: [ref(1, 1), ref(2, 0)],
    });
    const models = await resolveDraftKeyImages(7);
    expect(models).toHaveLength(2);
    // Document order follows the reference list (the renderer, not the
    // resolver, is who sorts by displayOrder — pinned in reportPresentation).
    expect(models.map((m) => m.displayOrder)).toEqual([1, 0]);
    const failed = models.find((m) => m.displayOrder === 0)!; // ref(2)
    const good = models.find((m) => m.displayOrder === 1)!; // ref(1)
    expect(failed.imageFetchStatus).toBe("failed");
    expect(failed.src).toBe("");
    expect(good.imageFetchStatus).toBeNull();
    expect(good.src).toContain("data:image/jpeg;base64,");
    // Every reference got a real fetch attempt — nothing silently skipped.
    expect(fetchCalls).toHaveLength(2);
  });
});
