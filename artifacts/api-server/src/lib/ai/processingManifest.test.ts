import { describe, it, expect } from "vitest";
import { computeInputHash, type ManifestInputs } from "./processingManifest";

const base: ManifestInputs = {
  snapshotContentHash: "hash-abc",
  modelVersion: "shadow-stub-v0",
  promptVersion: "none-p1",
  knowledgePackVersion: "unversioned-p1",
  rulesVersion: "unversioned-p1",
  measurementEngineVersion: "lib-measurements-p1",
  imageSelection: [
    { seriesUid: "S1", sopUid: "I1", frameNumber: 1 },
    { seriesUid: "S2", sopUid: "I2", frameNumber: 1 },
  ],
};

describe("processing manifest — input hash reproducibility", () => {
  it("is identical for identical inputs", () => {
    expect(computeInputHash(base)).toBe(computeInputHash({ ...base }));
  });

  it("is independent of image-selection ordering", () => {
    const reordered: ManifestInputs = { ...base, imageSelection: [base.imageSelection[1], base.imageSelection[0]] };
    expect(computeInputHash(reordered)).toBe(computeInputHash(base));
  });

  it("changes when the snapshot content hash changes", () => {
    expect(computeInputHash({ ...base, snapshotContentHash: "hash-xyz" })).not.toBe(computeInputHash(base));
  });

  it("changes when the model version changes (drives reprocessing)", () => {
    expect(computeInputHash({ ...base, modelVersion: "gateway-v1" })).not.toBe(computeInputHash(base));
  });

  it("changes when the prompt version changes", () => {
    expect(computeInputHash({ ...base, promptVersion: "v2" })).not.toBe(computeInputHash(base));
  });

  it("changes when the selected image set changes", () => {
    const extra: ManifestInputs = { ...base, imageSelection: [...base.imageSelection, { seriesUid: "S3", sopUid: "I3", frameNumber: 1 }] };
    expect(computeInputHash(extra)).not.toBe(computeInputHash(base));
  });
});
