/**
 * OpenAI Report Composer adapter — thin wrapper over shared OpenAI-compatible transport.
 * Fail-closed when OPENAI_API_KEY is unset (no clinical pipeline changes needed to enable).
 */
export { OpenAiComposerAdapter } from "./compatibleComposerAdapters";
