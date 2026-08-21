/**
 * Earliest shared Local AI bootstrap for every CARE API process entrypoint.
 *
 * MUST be imported before cron / routes / workers can invoke generateAiResponse.
 * Binding only registers a resolver callback — it does not call Ollama or read
 * env at bind time (safe even when dotenv has not yet applied).
 *
 * Entry points that must import this first among CARE modules:
 *   - index.ts (HTTP + overnight drain)
 *   - worker.ts (background cron / overnight drain without Express)
 *   - app.ts (Express app construction)
 */
import { bindCanonicalOllamaRuntimeResolver } from "./lib/ai/bindOllamaRuntime";

bindCanonicalOllamaRuntimeResolver();
