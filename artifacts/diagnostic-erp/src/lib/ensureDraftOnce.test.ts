import { describe, expect, it, vi } from "vitest";
import { createEnsureDraftOnce, isMeaningfulReportEdit } from "./ensureDraftOnce";

describe("createEnsureDraftOnce", () => {
  it("returns existing draft without calling create", async () => {
    const createDraft = vi.fn(async () => 99);
    const ensure = createEnsureDraftOnce({
      getDraftId: () => 12,
      createDraft,
    });
    await expect(ensure()).resolves.toBe(12);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("creates exactly once when draft is missing", async () => {
    let id: number | null = null;
    const createDraft = vi.fn(async () => {
      id = 42;
      return 42;
    });
    const ensure = createEnsureDraftOnce({
      getDraftId: () => id,
      createDraft,
    });
    await expect(ensure()).resolves.toBe(42);
    await expect(ensure()).resolves.toBe(42);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent first edits (race)", async () => {
    let id: number | null = null;
    let resolveCreate!: (v: number) => void;
    const createDraft = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveCreate = (v) => {
            id = v;
            resolve(v);
          };
        }),
    );
    const ensure = createEnsureDraftOnce({
      getDraftId: () => id,
      createDraft,
    });
    const p1 = ensure();
    const p2 = ensure();
    const p3 = ensure();
    expect(createDraft).toHaveBeenCalledTimes(1);
    resolveCreate(77);
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([77, 77, 77]);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("opening/looking alone is not this helper's job — empty fields are not meaningful", () => {
    expect(isMeaningfulReportEdit({})).toBe(false);
    expect(isMeaningfulReportEdit({ findings: "   " })).toBe(false);
    expect(isMeaningfulReportEdit({ findings: "Disc bulge" })).toBe(true);
    expect(isMeaningfulReportEdit({ impression: "Normal" })).toBe(true);
    expect(isMeaningfulReportEdit({ technique: "T1 T2" })).toBe(true);
    expect(isMeaningfulReportEdit({ recommendation: "Follow up" })).toBe(true);
  });
});
