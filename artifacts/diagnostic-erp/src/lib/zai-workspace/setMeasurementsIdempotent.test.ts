import { describe, expect, it } from "vitest";
import { useWorkspace } from "./store";

describe("setMeasurements idempotency (React #185 guard)", () => {
  it("does not replace measurements when content is unchanged", () => {
    const store = useWorkspace.getState();
    const rows = [
      { id: "vm-1", name: "Canal AP", value: 12, unit: "mm", source: "viewer" as const, inserted: false },
      { id: "vm-2", name: "Disc height", value: 4, unit: "mm", source: "viewer" as const, inserted: true },
    ];
    store.setMeasurements(rows);
    const first = useWorkspace.getState().measurements;
    store.setMeasurements([...rows]);
    expect(useWorkspace.getState().measurements).toBe(first);
  });

  it("updates when a field changes", () => {
    const store = useWorkspace.getState();
    store.setMeasurements([{ id: "vm-1", name: "Canal AP", value: 12, unit: "mm", source: "viewer", inserted: false }]);
    const first = useWorkspace.getState().measurements;
    store.setMeasurements([{ id: "vm-1", name: "Canal AP", value: 10, unit: "mm", source: "viewer", inserted: false }]);
    const second = useWorkspace.getState().measurements;
    expect(second).not.toBe(first);
    expect(second[0]?.value).toBe(10);
  });
});
