/**
 * voiceCommandGrammar.ts — Ticket M1.6B2 Phase 4/7.
 *
 * Deterministic voice-command parser for the canonical Reporting Workspace.
 * A strict ALLOWLIST of patterns → typed intents; nothing outside the grammar
 * ever becomes executable, and parameters are carried as plain strings that
 * downstream code only inserts into report text fields — never interpreted.
 *
 * Pure module: no DOM, no network, no workflow logic. Safety classification
 * lives in voiceSafetyPolicy.ts; execution lives in the workspace adapter,
 * which routes workflow intents through the M1.5 command dispatcher.
 */

import { applyRadiologyVoiceLexicon } from "./voiceDictationLexicon";

// ── Intents ──────────────────────────────────────────────────────────────────

/** Workflow intents map 1:1 onto WORKSPACE_COMMANDS ids (M1.5 dispatcher). */
export type VoiceWorkflowCommand =
  | "save" | "finalize" | "verify" | "next" | "previous" | "park" | "unpark"
  | "refresh" | "reload-current" | "open-viewer"
  | "focus-findings" | "focus-impression" | "focus-quick-search" | "close-panel"
  | "generate-impression";

export type DictationTarget =
  | "findings"
  | "impression"
  | "recommendation"
  | "technique"
  | "clinicalHistory";

/** Viewer operations the embedded viewer really supports (M1.6B2 grounding:
 *  EmbeddedWadoViewer has zoom/frame/reset setters; window presets, pan and
 *  measurements do NOT exist → recognized but truthfully unsupported). */
export type ViewerOp = "next-image" | "previous-image" | "zoom-in" | "zoom-out" | "reset-view";

export type VoiceIntent =
  | { type: "workflow"; command: VoiceWorkflowCommand; reason?: string }
  | { type: "dictate"; target: DictationTarget; mode: "append" | "replace"; text: string }
  | { type: "quick-select"; action: "search" | "select" | "remove"; term: string }
  | { type: "quick-modifier"; property: "side" | "severity" | "level"; value: string }
  // MRI PR 4 — apply a multi-study combined template (e.g. "combine brain and
  // cervical"). The term is resolved to a known combination downstream; voice
  // never assembles arbitrary studies.
  | { type: "combination"; term: string }
  | { type: "viewer"; op: ViewerOp }
  | { type: "viewer-unsupported"; capability: string }
  | { type: "cancel" }
  // M1.6B3 — hands-free session control. "confirm" applies a pending
  // NON-high-risk preview (the session enforces that finalize can never be
  // confirmed by voice); sleep/wake pause and resume the hands-free loop.
  | { type: "confirm" }
  | { type: "handsfree"; action: "sleep" | "wake" };

export type ConfidenceBand = "CLEAR" | "AMBIGUOUS" | "UNRECOGNIZED";

/** Phase 7 structured parse result. studyId/sessionNonce/safety fields are
 *  bound by the voice session + safety policy, not here (parser stays pure). */
export interface ParsedVoiceCommand {
  rawTranscript: string;
  normalizedTranscript: string;
  intent: VoiceIntent | null;
  parameters: Record<string, string>;
  confidenceBand: ConfidenceBand;
  /** 1–3 human-readable suggestions when AMBIGUOUS/UNRECOGNIZED. */
  alternatives: string[];
  parseErrors: string[];
}

// ── Normalization ────────────────────────────────────────────────────────────

/** Conservative transcript normalization: case/whitespace/terminal punctuation
 *  and a few politeness fillers only. Never rewrites clinical content. */
export function normalizeTranscript(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/g, "")
    .replace(/^(please|okay|ok)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Conservative dictation-text normalization (Phase 9): radiology lexicon,
 *  spoken punctuation, optional first-capital + terminal period. Never
 *  reinterprets clinical meaning beyond known spoken aliases. */
export function normalizeDictationText(text: string, opts: { autoPunctuation: boolean }): string {
  let out = applyRadiologyVoiceLexicon(text);
  if (opts.autoPunctuation && out) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
    if (/[a-z0-9)]$/i.test(out)) out += ".";
  }
  return out;
}

// ── Grammar rules ────────────────────────────────────────────────────────────

type Rule = {
  pattern: RegExp;
  build: (m: RegExpMatchArray) => VoiceIntent;
  /** Example phrase for the help popover. */
  example: string;
  category: "Workflow" | "Dictation" | "Quick Select" | "Viewer" | "Voice";
};

const SIDES = new Set(["left", "right", "bilateral"]);
const SEVERITIES = new Set(["mild", "moderate", "severe"]);

/** Ordered — first match wins. Multi-word/verb-ful phrases sit above bare
 *  single words so "reload queue" hits refresh before "reload". */
const RULES: Rule[] = [
  // Voice-layer control
  { category: "Voice", example: "cancel", pattern: /^(cancel|never ?mind|dismiss|stop listening)$/, build: () => ({ type: "cancel" }) },
  { category: "Voice", example: "confirm (non-finalize previews)", pattern: /^(confirm( command)?|yes confirm|go ahead)$/, build: () => ({ type: "confirm" }) },
  { category: "Voice", example: "go to sleep (hands-free)", pattern: /^(go to sleep|pause listening)$/, build: () => ({ type: "handsfree", action: "sleep" }) },
  { category: "Voice", example: "wake up (hands-free)", pattern: /^(wake up|resume listening)$/, build: () => ({ type: "handsfree", action: "wake" }) },

  // Workflow — explicit phrases first
  { category: "Workflow", example: "open study / open viewer", pattern: /^(open (the )?(study|viewer|images?)|launch (the )?viewer)$/, build: () => ({ type: "workflow", command: "open-viewer" }) },
  { category: "Workflow", example: "save draft", pattern: /^save( (the )?(draft|report))?$/, build: () => ({ type: "workflow", command: "save" }) },
  { category: "Workflow", example: "finalize / sign report", pattern: /^(finali[sz]e( (the )?report)?|sign( (the )?report)?|sign off)$/, build: () => ({ type: "workflow", command: "finalize" }) },
  { category: "Workflow", example: "verify report", pattern: /^(verify( (the )?report)?|countersign)$/, build: () => ({ type: "workflow", command: "verify" }) },
  { category: "Workflow", example: "next study", pattern: /^next( (study|patient|case))?$/, build: () => ({ type: "workflow", command: "next" }) },
  { category: "Workflow", example: "previous study", pattern: /^(previous( (study|patient|case))?|go back|last study)$/, build: () => ({ type: "workflow", command: "previous" }) },
  { category: "Workflow", example: "park study (reason…)", pattern: /^(park|skip)( (this )?(study|case|patient))?( (?<reason>.+))?$/, build: (m) => ({ type: "workflow", command: "park", reason: m.groups?.reason?.trim() || undefined }) },
  { category: "Workflow", example: "unpark study", pattern: /^(unpark( (this )?(study|case))?|resume parked( study)?)$/, build: () => ({ type: "workflow", command: "unpark" }) },
  { category: "Workflow", example: "refresh queue", pattern: /^(refresh( (the )?queue)?|reload (the )?queue)$/, build: () => ({ type: "workflow", command: "refresh" }) },
  { category: "Workflow", example: "reload current study", pattern: /^reload( (the )?(current( study)?|study|this study))?$/, build: () => ({ type: "workflow", command: "reload-current" }) },
  { category: "Workflow", example: "focus findings", pattern: /^(focus (on )?findings|go to findings|findings field)$/, build: () => ({ type: "workflow", command: "focus-findings" }) },
  { category: "Workflow", example: "focus impression", pattern: /^(focus (on )?impression|go to impression|impression field)$/, build: () => ({ type: "workflow", command: "focus-impression" }) },
  { category: "Workflow", example: "focus quick search", pattern: /^(focus )?(quick ?search|open search|search)$/, build: () => ({ type: "workflow", command: "focus-quick-search" }) },
  { category: "Workflow", example: "close panel", pattern: /^close( (the )?(panel|preview|diagnostics))?$/, build: () => ({ type: "workflow", command: "close-panel" }) },
  { category: "Workflow", example: "generate impression", pattern: /^(generate impression|create impression|write impression)$/, build: () => ({ type: "workflow", command: "generate-impression" }) },

  // Text entry — dictation into report fields (append by default; replace
  // needs the explicit word AND downstream confirmation).
  { category: "Dictation", example: "add finding <text>", pattern: /^(add|append) findings? (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "findings", mode: "append", text: m.groups!.text }) },
  { category: "Dictation", example: "replace findings with <text>", pattern: /^replace findings? with (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "findings", mode: "replace", text: m.groups!.text }) },
  { category: "Dictation", example: "impression <text>", pattern: /^(add |append )?impression (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "impression", mode: "append", text: m.groups!.text }) },
  { category: "Dictation", example: "replace impression with <text>", pattern: /^replace impression with (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "impression", mode: "replace", text: m.groups!.text }) },
  { category: "Dictation", example: "add recommendation <text>", pattern: /^(add |append )?recommendations? (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "recommendation", mode: "append", text: m.groups!.text }) },
  { category: "Dictation", example: "technique <text>", pattern: /^(add |append )?technique (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "technique", mode: "append", text: m.groups!.text }) },
  { category: "Dictation", example: "replace technique with <text>", pattern: /^replace technique with (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "technique", mode: "replace", text: m.groups!.text }) },
  { category: "Dictation", example: "clinical history <text>", pattern: /^(add |append )?(clinical history|history) (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "clinicalHistory", mode: "append", text: m.groups!.text }) },
  { category: "Dictation", example: "replace history with <text>", pattern: /^replace (clinical )?history with (?<text>.+)$/, build: (m) => ({ type: "dictate", target: "clinicalHistory", mode: "replace", text: m.groups!.text }) },

  // Quick Select
  { category: "Quick Select", example: "search finding <term>", pattern: /^search (for )?findings? (?<term>.+)$/, build: (m) => ({ type: "quick-select", action: "search", term: m.groups!.term }) },
  { category: "Quick Select", example: "select finding <term>", pattern: /^select findings? (?<term>.+)$/, build: (m) => ({ type: "quick-select", action: "select", term: m.groups!.term }) },
  { category: "Quick Select", example: "remove finding <term>", pattern: /^(remove|deselect) findings? (?<term>.+)$/, build: (m) => ({ type: "quick-select", action: "remove", term: m.groups!.term }) },
  { category: "Quick Select", example: "laterality left/right/bilateral", pattern: /^(laterality (?<v1>\w+)|(?<v2>left|right|bilateral)( side)?)$/, build: (m) => ({ type: "quick-modifier", property: "side", value: (m.groups?.v1 ?? m.groups?.v2 ?? "").trim() }) },
  { category: "Quick Select", example: "severity mild/moderate/severe", pattern: /^severity (?<v>.+)$/, build: (m) => ({ type: "quick-modifier", property: "severity", value: m.groups!.v.trim() }) },
  { category: "Quick Select", example: "level <value> / location <value>", pattern: /^(level|location) (?<v>.+)$/, build: (m) => ({ type: "quick-modifier", property: "level", value: m.groups!.v.trim() }) },

  // Study combinations (MRI PR 4) — verb-led so it never collides with dictation.
  { category: "Quick Select", example: "combine brain and cervical", pattern: /^(combine|combined study|combination) (?<term>.+)$/, build: (m) => ({ type: "combination", term: m.groups!.term.trim() }) },

  // Viewer — REAL operations (embedded viewer setters exist)
  { category: "Viewer", example: "next image", pattern: /^next (image|slice|frame)$/, build: () => ({ type: "viewer", op: "next-image" }) },
  { category: "Viewer", example: "previous image", pattern: /^previous (image|slice|frame)$/, build: () => ({ type: "viewer", op: "previous-image" }) },
  { category: "Viewer", example: "zoom in / zoom out", pattern: /^zoom in$/, build: () => ({ type: "viewer", op: "zoom-in" }) },
  { category: "Viewer", example: "zoom out", pattern: /^zoom out$/, build: () => ({ type: "viewer", op: "zoom-out" }) },
  { category: "Viewer", example: "reset view", pattern: /^reset (the )?(view|zoom|image)$/, build: () => ({ type: "viewer", op: "reset-view" }) },

  // Viewer — recognized but NOT supported by the embedded viewer (no window
  // presets / pan API / measurement tools exist — never fake support).
  { category: "Viewer", example: "window brain/bone — not supported", pattern: /^window (?<preset>\w+)$/, build: (m) => ({ type: "viewer-unsupported", capability: `window preset "${m.groups!.preset}"` }) },
  { category: "Viewer", example: "pan — not supported", pattern: /^pan( .+)?$/, build: () => ({ type: "viewer-unsupported", capability: "voice-driven pan" }) },
  { category: "Viewer", example: "length measurement — not supported", pattern: /^(length measurement|measure( .+)?)$/, build: () => ({ type: "viewer-unsupported", capability: "measurements" }) },
];

// ── Ambiguity detection ──────────────────────────────────────────────────────

/** Verb-less "finding <term>" could mean select / add / search — never guess. */
const AMBIGUOUS_FINDING = /^findings? (?<term>.+)$/;

// ── Parser ───────────────────────────────────────────────────────────────────

export interface ParseOptions {
  /** Raw engine confidence 0..1 when the provider supplies one (Web Speech
   *  does). Used ONLY to demote a grammar match to AMBIGUOUS — never shown
   *  as a percentage (it is not calibrated). */
  providerConfidence?: number | null;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function parseVoiceTranscript(raw: string, opts: ParseOptions = {}): ParsedVoiceCommand {
  const normalized = normalizeTranscript(raw);
  const base = {
    rawTranscript: raw,
    normalizedTranscript: normalized,
    parameters: {} as Record<string, string>,
  };

  if (!normalized) {
    return { ...base, intent: null, confidenceBand: "UNRECOGNIZED", alternatives: [], parseErrors: ["Empty transcript"] };
  }

  for (const rule of RULES) {
    const m = normalized.match(rule.pattern);
    if (!m) continue;
    const intent = rule.build(m);

    // Parameter validation for enumerated modifier values.
    if (intent.type === "quick-modifier" && intent.property === "side" && !SIDES.has(intent.value)) {
      return {
        ...base, intent: null, confidenceBand: "AMBIGUOUS",
        alternatives: ["laterality left", "laterality right", "laterality bilateral"],
        parseErrors: [`"${intent.value}" is not a laterality`],
      };
    }
    if (intent.type === "quick-modifier" && intent.property === "severity" && !SEVERITIES.has(intent.value)) {
      return {
        ...base, intent: null, confidenceBand: "AMBIGUOUS",
        alternatives: ["severity mild", "severity moderate", "severity severe"],
        parseErrors: [`"${intent.value}" is not a severity`],
      };
    }

    const parameters: Record<string, string> = {};
    if (intent.type === "dictate") parameters.text = intent.text;
    if (intent.type === "quick-select") parameters.term = intent.term;
    if (intent.type === "combination") parameters.term = intent.term;
    if (intent.type === "quick-modifier") parameters[intent.property] = intent.value;
    if (intent.type === "workflow" && intent.reason) parameters.reason = intent.reason;
    if (intent.type === "viewer-unsupported") parameters.capability = intent.capability;

    // A clean grammar match with LOW engine confidence must not silently
    // execute — demote to AMBIGUOUS and let the user confirm the reading.
    const conf = opts.providerConfidence;
    if (typeof conf === "number" && conf >= 0 && conf < LOW_CONFIDENCE_THRESHOLD) {
      return {
        ...base, intent, parameters, confidenceBand: "AMBIGUOUS",
        alternatives: [describeIntent(intent)],
        parseErrors: ["Low speech-engine confidence — confirm the interpreted command"],
      };
    }

    return { ...base, intent, parameters, confidenceBand: "CLEAR", alternatives: [], parseErrors: [] };
  }

  // Verb-less finding phrase: multiple plausible readings → offer them all.
  const amb = normalized.match(AMBIGUOUS_FINDING);
  if (amb?.groups?.term) {
    const term = amb.groups.term;
    return {
      ...base, intent: null, confidenceBand: "AMBIGUOUS",
      alternatives: [`select finding ${term}`, `add finding ${term}`, `search finding ${term}`],
      parseErrors: ["Say select / add / search before the finding"],
    };
  }

  return {
    ...base, intent: null, confidenceBand: "UNRECOGNIZED",
    alternatives: ['Say "save", "next study", "add finding <text>" — see the voice help for the full list'],
    parseErrors: [`No matching command for "${normalized}"`],
  };
}

// ── Descriptions (preview + help popover) ────────────────────────────────────

export function describeIntent(intent: VoiceIntent): string {
  switch (intent.type) {
    case "workflow": {
      const labels: Record<VoiceWorkflowCommand, string> = {
        save: "Save draft", finalize: "Finalize report", verify: "Verify (countersign) report",
        next: "Next study", previous: "Previous study", park: "Park study", unpark: "Unpark study",
        refresh: "Refresh queue", "reload-current": "Reload current study",
        "open-viewer": "Open study in viewer", "focus-findings": "Focus findings",
        "focus-impression": "Focus impression", "focus-quick-search": "Focus quick search",
        "close-panel": "Close panel", "generate-impression": "Generate impression",
      };
      return labels[intent.command] + (intent.reason ? ` — reason: ${intent.reason}` : "");
    }
    case "dictate":
      return `${intent.mode === "replace" ? "REPLACE" : "Append to"} ${intent.target}: “${intent.text}”`;
    case "quick-select":
      return `${intent.action === "remove" ? "Remove" : intent.action === "select" ? "Select" : "Search"} quick finding “${intent.term}”`;
    case "quick-modifier":
      return `Set ${intent.property} = ${intent.value} on the last selected finding`;
    case "combination":
      return `Apply combined study template “${intent.term}”`;
    case "viewer": {
      const ops: Record<ViewerOp, string> = {
        "next-image": "Viewer: next image", "previous-image": "Viewer: previous image",
        "zoom-in": "Viewer: zoom in", "zoom-out": "Viewer: zoom out", "reset-view": "Viewer: reset view",
      };
      return ops[intent.op];
    }
    case "viewer-unsupported":
      return `Viewer ${intent.capability} — not supported by the embedded viewer`;
    case "cancel":
      return "Cancel";
    case "confirm":
      return "Confirm the pending command";
    case "handsfree":
      return intent.action === "sleep" ? "Hands-free: go to sleep" : "Hands-free: wake up";
  }
}

/** The single source for the voice help popover — derived from the grammar. */
export function describeVoiceGrammar(): Array<{ category: string; examples: string[] }> {
  const byCategory = new Map<string, string[]>();
  for (const rule of RULES) {
    byCategory.set(rule.category, [...(byCategory.get(rule.category) ?? []), rule.example]);
  }
  return [...byCategory.entries()].map(([category, examples]) => ({ category, examples }));
}
