import { describe, expect, test, vi, beforeEach } from "vitest";

// usgTemplateStore must be fail-open: report generation can never break
// because of the canonical-table lookup — worst case it returns null and the
// renderer uses the built-in skeleton (the exact pre-consolidation output).

let selectRows: Array<Record<string, unknown>>;
let shouldThrow: boolean;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => {
        if (shouldThrow) throw new Error("simulated DB outage");
        return {
          where: () => ({
            orderBy: () => ({ limit: async () => selectRows }),
            then: (resolve: (v: unknown) => void) => resolve(selectRows),
          }),
        };
      },
    }),
  },
  structuredReportTemplatesTable: {
    modality: "modality", studyType: "study_type", isActive: "is_active",
    defaultFindings: "default_findings", updatedAt: "updated_at",
  },
}));

vi.mock("./logger", () => ({ logger: { warn: vi.fn() } }));

beforeEach(() => {
  selectRows = [];
  shouldThrow = false;
});

describe("fetchUsgSkeletonOverride", () => {
  test("returns the active row's defaultFindings", async () => {
    selectRows = [{ defaultFindings: "CUSTOM ${bpd} SKELETON" }];
    const { fetchUsgSkeletonOverride } = await import("./usgTemplateStore");
    expect(await fetchUsgSkeletonOverride("OB_GROWTH")).toBe("CUSTOM ${bpd} SKELETON");
  });

  test("returns null when no row exists", async () => {
    const { fetchUsgSkeletonOverride } = await import("./usgTemplateStore");
    expect(await fetchUsgSkeletonOverride("KUB")).toBeNull();
  });

  test("returns null for a blank/whitespace skeleton", async () => {
    selectRows = [{ defaultFindings: "   " }];
    const { fetchUsgSkeletonOverride } = await import("./usgTemplateStore");
    expect(await fetchUsgSkeletonOverride("THYROID")).toBeNull();
  });

  test("fail-open: returns null instead of throwing on DB errors", async () => {
    shouldThrow = true;
    const { fetchUsgSkeletonOverride } = await import("./usgTemplateStore");
    expect(await fetchUsgSkeletonOverride("BREAST")).toBeNull();
  });
});

describe("fetchCustomizedUsgTemplateIds", () => {
  test("returns the set of active USG studyTypes", async () => {
    selectRows = [{ studyType: "OB_GROWTH" }, { studyType: "KUB" }, { studyType: null }];
    const { fetchCustomizedUsgTemplateIds } = await import("./usgTemplateStore");
    const ids = await fetchCustomizedUsgTemplateIds();
    expect(ids.has("OB_GROWTH")).toBe(true);
    expect(ids.has("KUB")).toBe(true);
    expect(ids.size).toBe(2);
  });

  test("fail-open: returns an empty set on DB errors", async () => {
    shouldThrow = true;
    const { fetchCustomizedUsgTemplateIds } = await import("./usgTemplateStore");
    expect((await fetchCustomizedUsgTemplateIds()).size).toBe(0);
  });
});
