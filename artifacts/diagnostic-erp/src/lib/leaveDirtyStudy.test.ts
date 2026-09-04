import { describe, expect, it, vi } from "vitest";
import { leaveDirtyStudy } from "./leaveDirtyStudy";

const idle = { dirty: false, saving: false, finalizing: false, viewerLaunching: false, transitioning: false };

describe("leaveDirtyStudy", () => {
  it("navigates when clean", async () => {
    const result = await leaveDirtyStudy({
      guards: idle,
      promptDirty: async () => "stay",
      saveAndConfirm: async () => true,
      discardLocal: () => {},
    });
    expect(result).toEqual({ action: "navigate" });
  });

  it("blocks busy and does not navigate", async () => {
    const onBlocked = vi.fn();
    const result = await leaveDirtyStudy({
      guards: { ...idle, saving: true },
      promptDirty: async () => "discard",
      saveAndConfirm: async () => true,
      discardLocal: () => {},
      onBlocked,
    });
    expect(result.action).toBe("stay");
    expect(onBlocked).toHaveBeenCalled();
  });

  it("Stay leaves study untouched", async () => {
    const saveAndConfirm = vi.fn(async () => true);
    const discardLocal = vi.fn();
    const result = await leaveDirtyStudy({
      guards: { ...idle, dirty: true },
      promptDirty: async () => "stay",
      saveAndConfirm,
      discardLocal,
    });
    expect(result).toEqual({ action: "stay", reason: "cancelled" });
    expect(saveAndConfirm).not.toHaveBeenCalled();
    expect(discardLocal).not.toHaveBeenCalled();
  });

  it("Discard leaves without saving", async () => {
    const saveAndConfirm = vi.fn(async () => true);
    const discardLocal = vi.fn();
    const result = await leaveDirtyStudy({
      guards: { ...idle, dirty: true },
      promptDirty: async () => "discard",
      saveAndConfirm,
      discardLocal,
    });
    expect(result).toEqual({ action: "navigate" });
    expect(saveAndConfirm).not.toHaveBeenCalled();
    expect(discardLocal).toHaveBeenCalledTimes(1);
  });

  it("Save & leave waits for successful save then navigates", async () => {
    const saveAndConfirm = vi.fn(async () => true);
    const result = await leaveDirtyStudy({
      guards: { ...idle, dirty: true },
      promptDirty: async () => "save_and_leave",
      saveAndConfirm,
      discardLocal: () => {},
    });
    expect(result).toEqual({ action: "navigate" });
    expect(saveAndConfirm).toHaveBeenCalledTimes(1);
  });

  it("failed save prevents navigation", async () => {
    const result = await leaveDirtyStudy({
      guards: { ...idle, dirty: true },
      promptDirty: async () => "save_and_leave",
      saveAndConfirm: async () => false,
      discardLocal: () => {},
    });
    expect(result).toEqual({ action: "stay", reason: "save_failed" });
  });
});
