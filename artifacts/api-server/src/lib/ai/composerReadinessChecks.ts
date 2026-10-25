/**
 * Report Composer readiness, as steps for the EXISTING AI verification screen.
 *
 * That screen proved the overnight image pipeline — Orthanc, /api/generate, the
 * draft route — and said nothing about the Composer, which is a different model,
 * a different timeout and a different failure mode: the Composer never errors, it
 * quietly returns a mechanical draft. A clinic could pass every step and still
 * read fallback drafts for months. These steps close that gap.
 *
 * They read settings and one model listing only — no inference, no images, no
 * patient data — so they run before the Orthanc gate and add no GPU time.
 *
 * Pure on purpose, mirroring aiPipelineSelfTestLogic: the caller owns the
 * database and the network, this owns the verdicts, so the verdicts can be tested
 * without either.
 */

export type ComposerReadinessStep = {
  id: string;
  group: string;
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
};

export type ComposerReadinessInput = {
  /** Provider Model Routing sends `report_composer` to; null when no route is saved. */
  routedProvider: string | null;
  /** Model that route names, when it names one. */
  routedModel: string | null;
  /** `resolveComposerRuntime().enabled` — Local AI on AND a composer model set. */
  enabled: boolean;
  /** `resolveComposerRuntime().model` — the Ollama composer model setting. */
  model: string;
  fallbackModel: string | null;
  endpoint: string;
  timeoutMs: number;
  /** The same LAN/SSRF guard composeEngine runs before it sends anything. */
  endpointGuardOk: boolean;
  /** The guard's own sentence when it refused — it already names the setting. */
  endpointGuardReason: string | null;
  /** Ollama /api/tags result, already fetched by the Runtime section. */
  reachable: boolean;
  installedModels: string[];
  probeError?: string | null;
};

const GROUP = "Report Composer";
const SETTINGS = "AI Reporting Settings → Local AI";

/**
 * The deploy-gate default the migration writes. A clinic that lowered it on
 * purpose still needs to see the number here: 45 s was measured losing every
 * contended dictation, and the Composer answers that by returning a mechanical
 * draft rather than an error.
 */
const APPROVED_TIMEOUT_MS = 90_000;

/**
 * Ollama lists full tags ("qwen3:14b"), the setting may hold a bare family name,
 * and composeEngine sends whichever string was saved — so both spellings have to
 * count as installed, or this step fails a working clinic.
 */
export function composerModelInstalled(model: string, installedModels: string[]): boolean {
  const want = (model ?? "").trim().toLowerCase();
  if (!want) return false;
  return (installedModels ?? []).some((m) => {
    const have = (m ?? "").trim().toLowerCase();
    return have === want || have.startsWith(`${want}:`);
  });
}

function skip(id: string, name: string, detail: string): ComposerReadinessStep {
  return { id, group: GROUP, name, status: "skip", detail };
}

export function composerReadinessSteps(input: ComposerReadinessInput): ComposerReadinessStep[] {
  const steps: ComposerReadinessStep[] = [];
  const model = (input.model ?? "").trim();
  const routed = (input.routedProvider ?? "").trim();
  // Only the Ollama arm reads the model setting, the /api/tags listing, the LAN
  // guard and the fallback model. A route to a cloud provider makes all four
  // irrelevant, and asserting on them would report a fault that cannot occur.
  const ollamaArm = !routed || routed === "ollama";
  const routedElsewhere = `report_composer is routed to ${routed} — this screen checks the Ollama composer path.`;

  // ── 1. Is a composer model configured at all? ─────────────────────────────
  if (!ollamaArm) {
    steps.push({
      id: "composer-model",
      group: GROUP,
      name: "Composer model configured",
      status: "pass",
      detail: `Model Routing sends report_composer to ${routed}${
        input.routedModel ? ` (${input.routedModel})` : ""
      }.`,
    });
  } else if (!model) {
    steps.push({
      id: "composer-model",
      group: GROUP,
      name: "Composer model configured",
      status: "fail",
      detail: `No Report Composer model is set, so every compose returns a mechanical fallback draft. Set one in ${SETTINGS}.`,
    });
  } else if (!input.enabled) {
    steps.push({
      id: "composer-model",
      group: GROUP,
      name: "Composer model configured",
      status: "fail",
      detail: `${model} is set but the Local AI Assistant is switched off, so compose never reaches it. Enable it in ${SETTINGS}.`,
    });
  } else {
    steps.push({
      id: "composer-model",
      group: GROUP,
      name: "Composer model configured",
      status: "pass",
      detail: `${model} · provider ${routed || "ollama"} · endpoint ${input.endpoint || "(none)"}`,
    });
  }

  // ── 2. Is that model actually on the server? ──────────────────────────────
  if (!ollamaArm) {
    steps.push(skip("composer-model-installed", "Composer model installed", routedElsewhere));
  } else if (!model) {
    steps.push(skip("composer-model-installed", "Composer model installed", "Nothing to look up — no composer model is set."));
  } else if (!input.reachable) {
    steps.push({
      id: "composer-model-installed",
      group: GROUP,
      name: "Composer model installed",
      status: "fail",
      detail: `Cannot list models at ${input.endpoint || "(no endpoint)"} — ${input.probeError || "unreachable"}.`,
    });
  } else if (composerModelInstalled(model, input.installedModels)) {
    steps.push({
      id: "composer-model-installed",
      group: GROUP,
      name: "Composer model installed",
      status: "pass",
      detail: `${model} is present on the server (${input.installedModels.length} model(s) listed).`,
    });
  } else {
    steps.push({
      id: "composer-model-installed",
      group: GROUP,
      name: "Composer model installed",
      status: "fail",
      // Naming what IS installed is the whole value of this step: the fix is
      // either a pull or a one-word change to the setting, and the operator
      // cannot tell which without the list.
      detail: `${model} is NOT on the server. Installed: ${
        input.installedModels.length ? input.installedModels.slice(0, 12).join(", ") : "(none listed)"
      }. Pull it, or point the setting at one of these in ${SETTINGS}.`,
    });
  }

  // ── 3. Effective compose timeout (every provider arm uses this one) ────────
  const seconds = Math.round((input.timeoutMs ?? 0) / 1000);
  steps.push({
    id: "composer-timeout",
    group: GROUP,
    name: "Effective compose timeout",
    status: seconds * 1000 >= APPROVED_TIMEOUT_MS ? "pass" : "fail",
    detail:
      seconds * 1000 >= APPROVED_TIMEOUT_MS
        ? `${seconds}s`
        : `${seconds}s — below the approved ${APPROVED_TIMEOUT_MS / 1000}s default. A compose that exceeds it returns a mechanical draft, not an error. Raise Timeout (sec) in ${SETTINGS}.`,
  });

  // ── 4. Would the endpoint guard let compose send at all? ──────────────────
  if (!ollamaArm) {
    steps.push(skip("composer-endpoint-guard", "Local / LAN endpoint allowed", routedElsewhere));
  } else if (input.endpointGuardOk) {
    steps.push({
      id: "composer-endpoint-guard",
      group: GROUP,
      name: "Local / LAN endpoint allowed",
      status: "pass",
      detail: `${input.endpoint || "(no endpoint)"} clears the SSRF/LAN guard.`,
    });
  } else {
    steps.push({
      id: "composer-endpoint-guard",
      group: GROUP,
      name: "Local / LAN endpoint allowed",
      status: "fail",
      // The guard's reason already names the setting to change; inventing a
      // shorter one here would send the operator somewhere else.
      detail: input.endpointGuardReason || `The guard refused ${input.endpoint || "(no endpoint)"}.`,
    });
  }

  // ── 5. Fallback model: configured, and would it actually answer? ──────────
  const fallback = (input.fallbackModel ?? "").trim();
  if (!ollamaArm) {
    steps.push(skip("composer-fallback-model", "Composer fallback model", routedElsewhere));
  } else if (!fallback) {
    steps.push({
      id: "composer-fallback-model",
      group: GROUP,
      name: "Composer fallback model",
      // Not a fault — but the operator has to know that a failed compose goes
      // straight to the mechanical draft with nothing tried in between.
      status: "pass",
      detail: `None configured — a failed compose goes straight to the mechanical draft. Optional: set one in ${SETTINGS}.`,
    });
  } else if (!input.reachable) {
    steps.push(skip("composer-fallback-model", "Composer fallback model", `${fallback} set, but the server could not be reached to check it.`));
  } else if (composerModelInstalled(fallback, input.installedModels)) {
    steps.push({
      id: "composer-fallback-model",
      group: GROUP,
      name: "Composer fallback model",
      status: "pass",
      detail: `${fallback} is set and present on the server.`,
    });
  } else {
    steps.push({
      id: "composer-fallback-model",
      group: GROUP,
      name: "Composer fallback model",
      status: "fail",
      detail: `${fallback} is set but NOT on the server, so the retry after a failed compose fails too and the draft is mechanical. Pull it, or clear the setting in ${SETTINGS}.`,
    });
  }

  return steps;
}
