import { describe, expect, it } from "vitest";
import { tesseractAssetOptions } from "./tesseractAssets";

describe("tesseractAssetOptions", () => {
  it("puts every asset under the deployed /erp/ base path", () => {
    const o = tesseractAssetOptions("/erp/");
    expect(o.workerPath).toBe("/erp/tesseract/worker.min.js");
    expect(o.corePath).toBe("/erp/tesseract/tesseract-core.wasm.js");
    expect(o.langPath).toBe("/erp/tesseract");
    expect(o.cachePath).toBe("/erp/tesseract");
    expect(o.gzip).toBe(true);
  });

  it("adds the missing slash without doubling one", () => {
    expect(tesseractAssetOptions("/erp").workerPath).toBe("/erp/tesseract/worker.min.js");
    expect(tesseractAssetOptions("/erp/").workerPath).toBe("/erp/tesseract/worker.min.js");
    expect(tesseractAssetOptions("/").workerPath).toBe("/tesseract/worker.min.js");
  });

  it("never emits a root-absolute path when the app is served from a sub-path", () => {
    // Those URLs belong to the clinic website, which answers them with its
    // index.html at HTTP 200 — Tesseract then reads HTML as a worker/lang file.
    for (const [k, v] of Object.entries(tesseractAssetOptions("/erp/"))) {
      if (typeof v === "string") expect(v, k).toMatch(/^\/erp\//);
    }
  });
});
