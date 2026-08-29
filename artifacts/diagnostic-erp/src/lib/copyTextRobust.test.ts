import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { copyTextRobust } from "./copyTextRobust";

describe("copyTextRobust", () => {
  beforeEach(() => {
    vi.stubGlobal("isSecureContext", false);
    const ta = {
      value: "",
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn(() => true),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to execCommand on insecure (HTTP LAN) contexts", async () => {
    const ok = await copyTextRobust("https://caredeoghar.com/api/public/booking/icici-pay/OB-1");
    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false for empty text", async () => {
    expect(await copyTextRobust("")).toBe(false);
  });
});
