/**
 * Text Ollama call for background report composition (no DICOM pixels).
 */
import { resolveComposerRuntime } from "../voiceReportComposer/runtimeConfig";
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import {
  ComposerInputSnapshot,
  ComposerDraftOutput,
  parseComposerDraftJson,
} from "./types";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import type { AiComposeJobKind } from "@workspace/db/schema";

export type ComposeRunResult = {
  ok: boolean;
  draft?: ComposerDraftOutput;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  safeError?: string;
  rawLength?: number;
};

function buildSystemPrompt(kind: AiComposeJobKind): string {
  return [
    "You are a radiology report composition assistant.",
    "The radiologist has already supplied the clinical observations.",
    "Your job is to organize, rephrase, and structure those observations into a polished radiology report.",
    "NEVER invent pathology, laterality, spinal levels, measurements, grades, or recommendations not supported by the input.",
    "Remove contradictory normal statements only when the input pathology clearly replaces them.",
    "Preserve unrelated normal anatomy.",
    "Return ONLY valid JSON with keys: findings, impression, recommendation, unresolvedQuestions, warnings.",
    kind === "IMPRESSION"
      ? "Generate or refine Impression only from the supplied Findings; leave findings unchanged in the JSON (copy input findings)."
      : "",
    kind === "SELECTION_EDIT" || kind === "SECTION_EDIT" || kind === "REPHRASE" || kind === "SHORTEN" || kind === "EXPAND" || kind === "TRANSLATE"
      ? "Apply the instruction only to the selected/target text. Preserve meaning, laterality, levels, and numbers."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildUserPrompt(kind: AiComposeJobKind, snapshot: ComposerInputSnapshot): string {
  const obs = (snapshot.observations ?? [])
    .map((o) => {
      // Compact clinical line:
      //   [source] Region | Anatomical Section | Level | Concept | Laterality
      // then a Findings line, then (if present) an Impression line.
      // Empty pieces are omitted. Internal metadata (slotKey, conflictGroup,
      // bundleId, sectionsOwned) is intentionally omitted — the composer needs
      // clinical identity, not ownership bookkeeping.
      const head: string[] = [];
      if (o.region) head.push(o.region);
      if (o.anatomicalSection) head.push(o.anatomicalSection);
      if (o.level) head.push(o.level);
      head.push(o.concept);
      if (o.laterality) head.push(o.laterality);
      const header = `- [${o.source ?? "obs"}] ${head.join(" | ")}`;
      const findings = o.findingsText?.trim() ?? "";
      const impression = o.impressionText?.trim();
      if (impression) {
        return `${header}\n  Findings: ${findings}\n  Impression: ${impression}`;
      }
      return `${header}\n  ${findings}`;
    })
    .join("\n");

  if (kind === "SELECTION_EDIT" || kind === "REPHRASE" || kind === "SHORTEN" || kind === "EXPAND" || kind === "TRANSLATE" || kind === "SECTION_EDIT") {
    return JSON.stringify(
      {
        jobKind: kind,
        instruction: snapshot.instruction ?? kind,
        targetLanguage: snapshot.targetLanguage,
        selectionField: snapshot.selectionField,
        selectionText: snapshot.selectionText,
        groundingFindings: (snapshot.findings ?? "").slice(0, 1200),
        groundingImpression: (snapshot.impression ?? "").slice(0, 600),
        observations: (snapshot.observations ?? []).slice(0, 12),
      },
      null,
      0,
    );
  }

  // ─── Canonical STUDY CONTEXT block ────────────────────────────────────
  // Render only non-empty pieces. Region / family / spineSegment / bodyPart /
  // protocol / reportTitle all come from the resolved ReportingStudyContext
  // (no DICOM re-parsing). `studyType` (= DICOM StudyDescription) is included
  // as secondary descriptive provenance only — it never overrides resolved
  // CARE context.
  const studyCtxLines: string[] = [];
  if (snapshot.modality) studyCtxLines.push(`Modality: ${snapshot.modality}`);
  if (snapshot.region) studyCtxLines.push(`Primary region: ${snapshot.region}`);
  const additionalRegions = (snapshot.regions ?? []).filter(
    (r) => r && r !== snapshot.region,
  );
  if (additionalRegions.length > 0) {
    studyCtxLines.push(`Additional regions: ${additionalRegions.join(", ")}`);
  }
  if (snapshot.bodyPart) studyCtxLines.push(`Body part: ${snapshot.bodyPart}`);
  if (snapshot.family) studyCtxLines.push(`Family: ${snapshot.family}`);
  if (snapshot.spineSegment) studyCtxLines.push(`Spine segment: ${snapshot.spineSegment}`);
  if (snapshot.protocol) studyCtxLines.push(`Protocol: ${snapshot.protocol}`);
  if (snapshot.reportTitle) studyCtxLines.push(`Report title: ${snapshot.reportTitle}`);
  if (snapshot.studyType) studyCtxLines.push(`DICOM study description: ${snapshot.studyType}`);
  if ((snapshot.templateSections ?? []).length > 0) {
    studyCtxLines.push(`Template sections: ${(snapshot.templateSections ?? []).join(", ")}`);
  }
  const studyCtxBlock = studyCtxLines.length > 0
    ? ["STUDY CONTEXT", ...studyCtxLines].join("\n")
    : "";

  return [
    studyCtxBlock || "STUDY CONTEXT\n(none)",
    "",
    "Clinical history:",
    snapshot.clinicalHistory || "(none)",
    "",
    "Current technique:",
    snapshot.technique || "(none)",
    "",
    "Current Findings:",
    snapshot.findings || "(empty)",
    "",
    "Current Impression:",
    snapshot.impression || "(empty)",
    "",
    "Current Recommendation:",
    snapshot.recommendation || "(empty)",
    "",
    "Canonical observations (deduped):",
    obs || "(none)",
    "",
    kind === "IMPRESSION"
      ? "Task: Generate Impression only from Findings/observations."
      : "Task: Compose full Findings, Impression, and optional Recommendation.",
  ].join("\n");
}

async function callOllama(opts: {
  endpoint: string;
  model: string;
  system: string;
  user: string;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
}): Promise<{ ok: boolean; text?: string; safeError?: string }> {
  try {
    const res = await fetch(`${opts.endpoint.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        format: "json",
        options: { temperature: opts.temperature, num_ctx: opts.numCtx },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, safeError: `ollama_http_${res.status}` };
    }
    const json = (await res.json()) as { message?: { content?: string }; response?: string };
    const text = json.message?.content ?? json.response ?? "";
    if (!text.trim()) return { ok: false, safeError: "empty_model_response" };
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ollama_error";
    if (/abort|timeout/i.test(msg)) return { ok: false, safeError: "ollama_timeout" };
    return { ok: false, safeError: "ollama_unreachable" };
  }
}

/** Deterministic fallback when model unavailable — organizes supplied observations only. */
export { deterministicComposeFromSnapshot } from "./deterministicCompose";

export async function runReportComposer(opts: {
  kind: AiComposeJobKind;
  snapshot: ComposerInputSnapshot;
  allowDeterministicFallback?: boolean;
}): Promise<ComposeRunResult> {
  const started = Date.now();
  const runtime = await resolveComposerRuntime(true);
  if (!runtime.enabled || !runtime.model) {
    if (opts.allowDeterministicFallback !== false) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
      };
    }
    return { ok: false, safeError: "composer_model_not_configured", latencyMs: Date.now() - started };
  }

  const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
  if (!guard.ok) {
    return { ok: false, safeError: "composer_endpoint_blocked", latencyMs: Date.now() - started };
  }

  const system = buildSystemPrompt(opts.kind);
  const user = buildUserPrompt(opts.kind, opts.snapshot);
  const primary = await callOllama({
    endpoint: runtime.endpoint,
    model: runtime.model,
    system,
    user,
    numCtx: runtime.numCtx,
    temperature: runtime.temperature,
    timeoutMs: runtime.timeoutMs,
  });

  let text = primary.text;
  let model = runtime.model;
  let fallbackUsed = false;
  if (!primary.ok && runtime.fallbackModel) {
    const fb = await callOllama({
      endpoint: runtime.endpoint,
      model: runtime.fallbackModel,
      system,
      user,
      numCtx: runtime.numCtx,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
    });
    if (fb.ok) {
      text = fb.text;
      model = runtime.fallbackModel;
      fallbackUsed = true;
    } else {
      return {
        ok: false,
        safeError: primary.safeError ?? fb.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: runtime.model,
        fallbackUsed: true,
      };
    }
  } else if (!primary.ok) {
    if (opts.allowDeterministicFallback !== false) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        safeError: primary.safeError,
      };
    }
    return {
      ok: false,
      safeError: primary.safeError ?? "compose_failed",
      latencyMs: Date.now() - started,
      model: runtime.model,
    };
  }

  const draft = parseComposerDraftJson(text ?? "");
  if (!draft) {
    return {
      ok: false,
      safeError: "malformed_json",
      latencyMs: Date.now() - started,
      model,
      fallbackUsed,
      rawLength: text?.length ?? 0,
    };
  }

  // Micro-edit: ensure proposed findings/impression only change selection field when possible
  if (opts.kind !== "FULL_REPORT" && opts.kind !== "IMPRESSION" && opts.snapshot.selectionText) {
    if (opts.snapshot.selectionField === "FINDINGS") {
      draft.findings = draft.findings || opts.snapshot.selectionText;
      draft.impression = opts.snapshot.impression;
      draft.recommendation = opts.snapshot.recommendation;
    } else if (opts.snapshot.selectionField === "IMPRESSION") {
      draft.impression = draft.impression || opts.snapshot.selectionText;
      draft.findings = opts.snapshot.findings;
      draft.recommendation = opts.snapshot.recommendation;
    } else if (opts.snapshot.selectionField === "RECOMMENDATION") {
      draft.recommendation = draft.recommendation || opts.snapshot.selectionText;
      draft.findings = opts.snapshot.findings;
      draft.impression = opts.snapshot.impression;
    }
  }
  if (opts.kind === "IMPRESSION") {
    draft.findings = opts.snapshot.findings;
    if (!draft.recommendation) draft.recommendation = opts.snapshot.recommendation;
  }

  return {
    ok: true,
    draft,
    model,
    fallbackUsed,
    latencyMs: Date.now() - started,
    rawLength: text?.length ?? 0,
  };
}
