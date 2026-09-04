/** localStorage preference for AI Report Assistant minimized state. */
export const AI_ASSISTANT_MINIMIZED_KEY = "care_ai_assistant_minimized";

/**
 * - stored "0" → expanded
 * - stored "1" → minimized
 * - missing / other → minimized (first visit default)
 */
export function readAiAssistantMinimizedPreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
): boolean {
  try {
    const v = storage?.getItem(AI_ASSISTANT_MINIMIZED_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
    return true;
  } catch {
    return true;
  }
}

export function writeAiAssistantMinimizedPreference(
  storage: Pick<Storage, "setItem"> | null | undefined,
  minimized: boolean,
): void {
  try {
    storage?.setItem(AI_ASSISTANT_MINIMIZED_KEY, minimized ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
}
