/**
 * workspaceCommands.ts — Ticket M1.5 Phase 9
 *
 * ONE centralized command dispatcher for the canonical Reporting Workspace.
 * Every workflow action — keyboard shortcut today, voice command later —
 * resolves to a named command and goes through dispatch(), so there is a
 * single choke point for guards, telemetry, and (later) a voice backend.
 * Deliberately zero-dependency and framework-free; the workspace registers
 * its handlers at render time.
 *
 * This is the FOUNDATION only — no voice recognition here (explicitly out of
 * M1.5 scope).
 */

export const WORKSPACE_COMMANDS = [
  "save",
  "finalize",
  "next",
  "previous",
  "park",
  "refresh",
  "open-viewer",
  "focus-quick-search",
  // M1.6B2 — added for the voice layer; buttons/keyboard reach the same
  // handlers, so every entry here stays a single choke point per action.
  "verify",
  "unpark",
  "reload-current",
  "focus-findings",
  "focus-impression",
  "close-panel",
  // R2.0 — Ctrl+1..6 USG practical-template quick-select (Whole Abdomen, KUB,
  // Pregnancy, Doppler, Breast, Thyroid). No-op outside the workspace's
  // ultrasound mode; handlers own that guard, same as every other command.
  "select-template-1",
  "select-template-2",
  "select-template-3",
  "select-template-4",
  "select-template-5",
  "select-template-6",
] as const;

export type WorkspaceCommand = (typeof WORKSPACE_COMMANDS)[number];

export function isWorkspaceCommand(value: string): value is WorkspaceCommand {
  return (WORKSPACE_COMMANDS as readonly string[]).includes(value);
}

export type CommandHandler = () => void | Promise<void>;

export interface DispatchResult {
  /** True when a handler ran (it may still no-op internally per its guards). */
  executed: boolean;
  /** Why nothing ran: unknown command name or no handler registered. */
  reason: "unknown-command" | "no-handler" | null;
}

export interface CommandDispatcher {
  dispatch(command: string): DispatchResult;
  /** Commands with a live handler — the future voice backend's vocabulary. */
  commands(): WorkspaceCommand[];
}

/**
 * Build a dispatcher over the given handlers. Handlers own their OWN guards
 * (busy/locked checks) — the dispatcher only routes, so guard behavior stays
 * identical whether an action arrives via button, key, or (later) voice.
 */
export function createCommandDispatcher(
  handlers: Partial<Record<WorkspaceCommand, CommandHandler>>,
): CommandDispatcher {
  return {
    dispatch(command: string): DispatchResult {
      if (!isWorkspaceCommand(command)) return { executed: false, reason: "unknown-command" };
      const handler = handlers[command];
      if (!handler) return { executed: false, reason: "no-handler" };
      void handler();
      return { executed: true, reason: null };
    },
    commands(): WorkspaceCommand[] {
      return WORKSPACE_COMMANDS.filter((c) => Boolean(handlers[c]));
    },
  };
}
