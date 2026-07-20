import { describe, it, expect } from "vitest";
import { cosineSimilarity, parseEmbedding, serializeEmbedding } from "./embeddings";

describe("cosineSimilarity", () => {
  it("is 1 for identical direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 5])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  it("returns 0 for mismatched lengths, empty, or zero vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("parseEmbedding / serializeEmbedding round-trip", () => {
  it("round-trips a valid vector", () => {
    const v = [0.1, -0.2, 0.3];
    expect(parseEmbedding(serializeEmbedding(v))).toEqual(v);
  });

  it("returns null for missing or malformed input", () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding("")).toBeNull();
    expect(parseEmbedding("not json")).toBeNull();
    expect(parseEmbedding("[]")).toBeNull();
    expect(parseEmbedding('["a","b"]')).toBeNull();
    expect(parseEmbedding('{"x":1}')).toBeNull();
  });
});
