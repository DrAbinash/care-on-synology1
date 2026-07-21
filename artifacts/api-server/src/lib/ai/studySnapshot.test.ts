import { describe, it, expect } from "vitest";
import { computeContentHash, buildSnapshotManifest, decideRevision, type InstanceRef } from "./studySnapshot";

const inst = (seriesUid: string, sopUid: string, extra: Partial<InstanceRef> = {}): InstanceRef => ({ seriesUid, sopUid, ...extra });

describe("study snapshot — content hash integrity", () => {
  const a = [inst("S1", "I1"), inst("S1", "I2"), inst("S2", "I3")];

  it("is deterministic for the same instance set", () => {
    expect(computeContentHash("ST1", a)).toBe(computeContentHash("ST1", a));
  });

  it("is order-independent (reordering the same set yields the same hash)", () => {
    const shuffled = [a[2], a[0], a[1]];
    expect(computeContentHash("ST1", shuffled)).toBe(computeContentHash("ST1", a));
  });

  it("changes when an instance is added", () => {
    const more = [...a, inst("S2", "I4")];
    expect(computeContentHash("ST1", more)).not.toBe(computeContentHash("ST1", a));
  });

  it("changes when an instance is removed", () => {
    const fewer = [a[0], a[1]];
    expect(computeContentHash("ST1", fewer)).not.toBe(computeContentHash("ST1", a));
  });

  it("differs across studies with the same instances", () => {
    expect(computeContentHash("ST1", a)).not.toBe(computeContentHash("ST2", a));
  });

  it("builds a manifest with correct series/instance counts", () => {
    const m = buildSnapshotManifest("ST1", a);
    expect(m.seriesCount).toBe(2);
    expect(m.instanceCount).toBe(3);
    expect(m.contentHash).toBe(computeContentHash("ST1", a));
  });
});

describe("study snapshot — revision / late-series detection", () => {
  const base = buildSnapshotManifest("ST1", [inst("S1", "I1"), inst("S1", "I2")]);

  it("first snapshot is revision 1", () => {
    expect(decideRevision(null, base)).toEqual({ kind: "new", revision: 1, contentHash: base.contentHash });
  });

  it("unchanged content is a no-op", () => {
    const d = decideRevision({ contentHash: base.contentHash, revision: 1, instanceCount: 2 }, base);
    expect(d.kind).toBe("unchanged");
  });

  it("a late-arriving series produces a new revision, never an overwrite", () => {
    const withLateSeries = buildSnapshotManifest("ST1", [inst("S1", "I1"), inst("S1", "I2"), inst("S2", "I3")]);
    const d = decideRevision({ contentHash: base.contentHash, revision: 1, instanceCount: 2 }, withLateSeries);
    expect(d.kind).toBe("revision");
    if (d.kind === "revision") {
      expect(d.revision).toBe(2);
      expect(d.addedInstances).toBe(1);
      expect(d.removedInstances).toBe(0);
      expect(d.contentHash).toBe(withLateSeries.contentHash);
    }
  });
});
