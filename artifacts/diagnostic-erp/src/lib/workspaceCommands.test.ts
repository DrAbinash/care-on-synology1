import { describe, it, expect, vi } from "vitest";
import { WORKSPACE_COMMANDS, isWorkspaceCommand, createCommandDispatcher } from "./workspaceCommands";

// Ticket M1.5 Phase 9 — the centralized command dispatcher (future voice
// backend). Routing only; guards live in the handlers.

describe("command vocabulary", () => {
  it("exposes exactly the M1.5 command set plus the M1.6B2 voice additions", () => {
    expect([...WORKSPACE_COMMANDS]).toEqual([
      "save", "finalize", "next", "previous", "park", "refresh", "open-viewer", "focus-quick-search",
      "verify", "unpark", "reload-current", "focus-findings", "focus-impression", "close-panel",
    ]);
    expect(isWorkspaceCommand("next")).toBe(true);
    expect(isWorkspaceCommand("verify")).toBe(true);
    expect(isWorkspaceCommand("voice-magic")).toBe(false);
  });
});

describe("dispatch", () => {
  it("routes a known command to its handler exactly once", () => {
    const next = vi.fn();
    const d = createCommandDispatcher({ next });
    expect(d.dispatch("next")).toEqual({ executed: true, reason: null });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("unknown command names are rejected, not thrown", () => {
    const d = createCommandDispatcher({});
    expect(d.dispatch("self-destruct")).toEqual({ executed: false, reason: "unknown-command" });
  });

  it("a known command with no registered handler reports no-handler", () => {
    const d = createCommandDispatcher({ save: vi.fn() });
    expect(d.dispatch("park")).toEqual({ executed: false, reason: "no-handler" });
  });

  it("async handlers are fired without blocking dispatch", () => {
    let resolved = false;
    const d = createCommandDispatcher({
      finalize: async () => { await Promise.resolve(); resolved = true; },
    });
    expect(d.dispatch("finalize").executed).toBe(true);
    // dispatch returns synchronously; the handler settles on its own
    return Promise.resolve().then(() => expect(resolved).toBe(true));
  });

  it("commands() lists only commands with live handlers — the voice vocabulary", () => {
    const d = createCommandDispatcher({ save: vi.fn(), next: vi.fn(), refresh: vi.fn() });
    expect(d.commands()).toEqual(["save", "next", "refresh"]);
  });
});
