/**
 * @vitest-environment node
 *
 * Mocks document.body — this repo's vitest runs in node (no jsdom).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { dismissDialogThen, restoreBodyPointerEvents } from "./dialogDismiss";

function mockBody() {
  const style = {
    pointerEvents: "none",
    removeProperty: vi.fn((prop: string) => {
      if (prop === "pointer-events") style.pointerEvents = "";
    }),
  };
  vi.stubGlobal("document", {
    body: { style },
  });
  return style;
}

describe("dialogDismiss", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("restoreBodyPointerEvents clears stuck body pointer-events", () => {
    const style = mockBody();
    expect(style.pointerEvents).toBe("none");
    restoreBodyPointerEvents();
    expect(style.removeProperty).toHaveBeenCalledWith("pointer-events");
    expect(style.pointerEvents).toBe("");
  });

  it("dismissDialogThen closes immediately and defers after-callback", () => {
    vi.useFakeTimers();
    mockBody();
    const setOpen = vi.fn();
    const after = vi.fn();

    dismissDialogThen(setOpen, after, 350);

    expect(setOpen).toHaveBeenCalledWith(false);
    expect(after).not.toHaveBeenCalled();

    vi.advanceTimersByTime(349);
    expect(after).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("DayClose / MyDayClose wire dismissDialogThen (source contract)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dayClose = readFileSync(join(__dirname, "../pages/DayClose.tsx"), "utf8");
    const myClose = readFileSync(join(__dirname, "../pages/MyDayClose.tsx"), "utf8");
    expect(dayClose).toMatch(/dismissDialogThen\(setConfirmOpen/);
    expect(dayClose).toMatch(/closeConfirmDialog/);
    expect(myClose).toMatch(/dismissDialogThen\(setConfirmOpen/);
    expect(myClose).toMatch(/closeConfirmDialog/);
  });
});
