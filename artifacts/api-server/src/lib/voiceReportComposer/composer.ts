/**
 * Voice Report Composer — Ollama structured change-plan generation.
 */
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import { hardenedLocalRequest } from "@workspace/ai-providers";
import { buildComposerPrompt, type ComposerContextInput } from "./contextBuilder";
import type { CatalogPhrase } from "./phraseCatalog";
import {
  catalogForPrompt,
  conceptsMatchingTail,
  fillLevelInPhrase,
  fillModifiersInPhrase,
  matchCatalogPhrases,
  phraseByConcept,
  severityPhraseForConcept,
} from "./phraseCatalog";
import {
  changePlan,
  observation,
  parseChangePlanJson,
  VOICE_COMPOSER_JSON_SCHEMA,
  type VoiceChangePlan,
  type VoiceObservation,
} from "./schema";
import { validateChangePlan } from "./validator";
import { buildDiagnostics, type ComposerDiagnostics } from "./diagnostics";
import { recordComposeLatency } from "./composerTelemetry";
import { extractBodyLevels, extractLevels, isPureLevelContinuation, normalizeComposerTranscript, splitDictationClauses } from "./transcriptNormalize";
import { smartDictationRegionSupported } from "./regions";
import { normalizePlanSections } from "./regionSections";
import {
  checkContradictions,
  type ComposerContradictionWarning,
} from "./contradictionCheck";
import { logger } from "../logger";
import {
  dictationFidelityError,
  verifyDictatedDetailPreserved,
} from "./dictationFidelity";

export type ComposeResult = {
  ok: boolean;
  plan?: VoiceChangePlan;
  error?: string;
  /** Advisory contradiction warnings (owner pick #2) — present only when
   *  non-empty; the client treats absence as clean. Clinical advisories for
   *  the radiologist's channel; never diagnostics, never logs. */
  warnings?: ComposerContradictionWarning[];
  diagnostics?: ComposerDiagnostics;
};

const SYNTHETIC_TEST_TRANSCRIPT =
  "Disc desiccation at L3-4 and L4-5 with mild diffuse disc bulge at L4-5.";

/** Deterministic phrase catalog — tests/demo/explicit radiologist phrase fallback only. */

/** Concept-family aliases so conversational tails resolve to real observations. */
const TAIL_ALIASES: Array<{ re: RegExp; concepts: string[] }> = [
  { re: /foraminal|narrowing/i, concepts: ["foraminal_stenosis", "foraminal_narrowing", "cervical_foraminal_stenosis"] },
  { re: /canal|central canal/i, concepts: ["canal_stenosis", "cervical_canal_stenosis", "dorsal_canal_stenosis"] },
  { re: /ligamentum/i, concepts: ["ligamentum_flavum_hypertrophy", "cervical_ligamentum_flavum"] },
  { re: /bulge/i, concepts: ["disc_bulge", "cervical_disc_bulge", "dorsal_disc_bulge"] },
  { re: /hernia/i, concepts: ["disc_herniation", "cervical_disc_herniation"] },
  { re: /desicca|hydrat/i, concepts: ["disc_desiccation", "cervical_disc_desiccation"] },
  { re: /modic|endplate/i, concepts: ["modic_changes", "cervical_modic"] },
  { re: /facet/i, concepts: ["facet_arthropathy", "cervical_facet_arthropathy"] },
  { re: /lordosis/i, concepts: ["loss_of_lordosis", "loss_of_cervical_lordosis"] },
  { re: /listhesis|spondylo/i, concepts: ["anterolisthesis", "cervical_spondylolisthesis"] },
  { re: /cord/i, concepts: ["cervical_cord_compression", "cord_signal_change"] },
  { re: /stenosis/i, concepts: ["canal_stenosis", "foraminal_stenosis", "cervical_canal_stenosis"] },
];

function conceptsForTail(tail: string, extras?: CatalogPhrase[]): string[] {
  const fromCatalog = conceptsMatchingTail(tail, extras);
  if (fromCatalog.length) return fromCatalog;
  for (const alias of TAIL_ALIASES) {
    if (alias.re.test(tail)) return alias.concepts;
  }
  return [];
}

/**
 * Concept family stem — "foraminal_stenosis" and "foraminal_narrowing" are the
 * same clinical family (the Quick Select concept key and the severity-template
 * key use different suffixes), so conversational tails must resolve across
 * both spellings. Shared with the contradiction checker (one stem, never two).
 */
export function conceptStem(c: string): string {
  let s = c.toLowerCase();
  // Family prefixes: "cervical_disc_bulge" and "disc_bulge" are the same
  // clinical family in different regions.
  s = s.replace(/^(cervical|lumbar|dorsal|brain)_/, "");
  // Family suffixes: "foraminal_stenosis" and "foraminal_narrowing" are the
  // same finding keyed two ways (tile key vs severity-template key).
  s = s.replace(/_(narrowing|stenosis|hypertrophy|changes|desiccation|arthropathy|fracture|compression)$/, "");
  return s;
}

/**
 * Vertebral-BODY findings name a single vertebra ("compression fracture of
 * L1", "Schmorl node at L2") — extractLevels would expand "L1" to the L1-L2
 * disc segment, which is correct for disc findings and WRONG for body
 * findings, so these concepts resolve their level through extractBodyLevels
 * instead (Dream 2; fixes the V1 compression_fracture segment expansion).
 */
const BODY_FINDING_RE = /fracture|schmorl|hemangioma|lytic|osseous/;

/** Does an existing observation match the correction tail (concept family + level)? */
function observationMatchesTail(
  obs: VoiceObservation,
  tailConcepts: string[],
  level: string | undefined,
): boolean {
  const conceptMatch =
    tailConcepts.some(
      (c) =>
        obs.concept === c
        || obs.concept.includes(c)
        || c.includes(obs.concept)
        || conceptStem(obs.concept) === conceptStem(c),
    )
    || tailConcepts.length === 0; // free-form tail: fall back to text overlap below
  if (!conceptMatch) return false;
  if (level && obs.level) return obs.level === level;
  return true; // no level dictated: any level of the same concept family matches
}

/** Grade words for graded findings ("type II" → "2", "Fazekas grade 1", digit stays). */
function extractGrade(transcript: string): string | null {
  const m = transcript.match(/(?:type|(?:fazekas\s*)?grade)\s*(I{1,3}|\d)\b/i);
  if (!m) return null;
  const g = m[1].toUpperCase();
  if (/^I+$/.test(g)) return String(g.length);
  return g;
}

function fillPhraseForObservation(opts: {
  template: { findingsText: string; impressionText?: string };
  level?: string | null;
  severity?: string | null;
  laterality?: string | null;
  grade?: string | null;
}): { findingsText: string; impressionText?: string } {
  let findings = fillLevelInPhrase(opts.template.findingsText, opts.level ?? null);
  findings = fillModifiersInPhrase(findings, {
    severity: opts.severity,
    laterality: opts.laterality,
    grade: opts.grade,
  });
  let impression: string | undefined;
  if (opts.template.impressionText) {
    let imp = fillLevelInPhrase(opts.template.impressionText, opts.level ?? null);
    imp = fillModifiersInPhrase(imp, {
      severity: opts.severity,
      laterality: opts.laterality,
      grade: opts.grade,
    });
    impression = imp;
  }
  return { findingsText: findings, impressionText: impression };
}

/**
 * Concept-targeted removal — "remove ligamentum flavum hypertrophy".
 * Resolves against prior observations ONLY (never invents a removal target);
 * ambiguous matches ask which one; nothing found says so instead of guessing.
 */
function composeRemoval(
  tail: string,
  priorObservations: VoiceObservation[],
  extras?: CatalogPhrase[],
): VoiceChangePlan {
  if (!priorObservations.length) {
    return changePlan({
      clarificationRequired: "Nothing to remove — no prior observations in this session",
    });
  }
  const tailConcepts = conceptsForTail(tail, extras);
  // Body findings keep their RAW vertebral level — "remove the L2 schmorl
  // node" must match the stored "L2", not the "L2-L3" a disc expansion
  // would derive from the same words.
  const level = (tailConcepts.some((c) => BODY_FINDING_RE.test(c))
    ? extractBodyLevels(tail)[0]
    : extractLevels(tail)[0]);
  const candidates = priorObservations.filter((o) =>
    observationMatchesTail(o, tailConcepts, level),
  );
  if (candidates.length === 0) {
    return changePlan({
      clarificationRequired: `Nothing matching "${tail}" was dictated — nothing removed`,
    });
  }
  if (candidates.length > 1) {
    return changePlan({
      clarificationRequired: `Which one — ${candidates.map((o) => o.findingsText.slice(0, 60)).join(" or ")}?`,
    });
  }
  const target = candidates[0];
  return changePlan({
    observations: [observation({
      concept: target.concept,
      level: target.level ?? null,
      findingsText: target.findingsText,
      impressionText: target.impressionText,
      operation: "remove",
      targetObservationId: target.id,
    })],
  });
}

/**
 * Severity / laterality / level update — "make L4-L5 narrowing moderate on the
 * left". The sentence is regenerated from the SAME template the original add
 * used (severity-parameterized phrases for stenosis families), so wording
 * never drifts and nothing outside the dictated modifiers changes.
 */
function composeUpdate(
  update: { tail: string; severity?: "mild" | "moderate" | "severe"; laterality?: "left" | "right" | "bilateral"; level?: string },
  priorObservations: VoiceObservation[],
  extras?: CatalogPhrase[],
): VoiceChangePlan {
  const tailConcepts = conceptsForTail(update.tail, extras);
  // Body findings keep their RAW vertebral level — update.level arrives from
  // the normalizer's DISC expansion, so re-derive it from the tail words for
  // body concepts (an explicit dictated pair survives unchanged).
  const bodyLevel = (tailConcepts.some((c) => BODY_FINDING_RE.test(c))
    ? extractBodyLevels(`${update.tail} ${update.level ?? ""}`)[0]
    : undefined);
  const level = bodyLevel ?? update.level ?? extractLevels(update.tail)[0];
  const candidates = priorObservations.filter((o) =>
    observationMatchesTail(o, tailConcepts, level),
  );
  if (candidates.length > 1) {
    return changePlan({
      clarificationRequired: `Which one — ${candidates.map((o) => o.findingsText.slice(0, 60)).join(" or ")}?`,
    });
  }

  // No prior observation: a fresh finding dictated WITH modifiers ("there is
  // moderate narrowing on the left at L4-L5") composes as an add, exactly like
  // dictating the finding outright. Never invented: the concept must still
  // resolve to a catalog phrase.
  const target = candidates[0] ?? null;
  const concept = target?.concept ?? tailConcepts[0];
  if (!concept) {
    return changePlan({
      clarificationRequired: `Could not resolve "${update.tail}" to a known finding — restate it`,
    });
  }

  // Restated modifiers win; unstated ones are PRESERVED from the target — a
  // side-only correction must never silently drop the dictated severity, and
  // a severity-only correction must never drop the dictated side.
  const severity = update.severity ?? (target?.severity as string | null) ?? null;
  const laterality = update.laterality ?? (target?.laterality as string | null) ?? null;
  const effectiveLevel = level ?? target?.level ?? null;

  const severityTemplate = severityPhraseForConcept(concept);
  const plainTemplate = phraseByConcept(concept, extras);
  const template = severityTemplate ?? plainTemplate;
  if (!template) {
    if (target) {
      // Unknown concept template (Ollama-authored observation): only swap the
      // dictated severity words inside the existing sentence; never reword.
      let findingsText = target.findingsText;
      if (severity) {
        findingsText = findingsText.replace(/\b(mild|moderate|severe)\b/gi, severity);
      }
      if (laterality) {
        const hadSide = /\bleft\b|\bright\b|\bbilateral\b/i.test(findingsText);
        if (hadSide) {
          findingsText = findingsText
            .replace(/\bleft\b/gi, laterality)
            .replace(/\bright\b/gi, laterality)
            .replace(/\bbilateral\b/gi, laterality);
        } else {
          return changePlan({
            clarificationRequired: `Cannot set side on "${target.findingsText.slice(0, 60)}" — restate the finding with the side`,
          });
        }
      }
      return changePlan({
        observations: [observation({
          id: target.id,
          concept: target.concept,
          level: effectiveLevel,
          severity,
          laterality,
          findingsText,
          impressionText: target.impressionText,
          operation: "update",
          targetObservationId: target.id,
          anatomicalSection: target.anatomicalSection,
          conflictGroup: target.conflictGroup,
        })],
      });
    }
    return changePlan({
      clarificationRequired: `Could not resolve "${update.tail}" to a known finding — restate it`,
    });
  }

  const grade = extractGrade(update.tail) ?? extractGrade(target?.findingsText ?? "") ?? null;
  const filled = fillPhraseForObservation({
    template: { findingsText: template.findingsText, impressionText: template.impressionText },
    level: effectiveLevel,
    severity,
    laterality,
    grade,
  });

  const baseGroup = (template as { conflictGroup?: string; anatomicalSection?: string }).conflictGroup
    ?? (template as { conflictGroup?: string; anatomicalSection?: string }).anatomicalSection;
  const levelKey = (effectiveLevel ?? "").replace(/\s+/g, "").toUpperCase();

  return changePlan({
    observations: [observation({
      id: target?.id,
      concept,
      level: effectiveLevel,
      severity,
      laterality,
      findingsText: filled.findingsText,
      impressionText: filled.impressionText,
      anatomicalSection: (template as { anatomicalSection?: string }).anatomicalSection
        ?? target?.anatomicalSection,
      conflictGroup: levelKey && baseGroup ? `${baseGroup}_${levelKey}` : baseGroup ?? target?.conflictGroup,
      baselineReplaces: (template as { baselineReplaces?: string }).baselineReplaces ?? target?.baselineReplaces,
      operation: target ? "update" : "add",
      targetObservationId: target?.id,
    })],
  });
}

export function deterministicCompose(ctx: ComposerContextInput): VoiceChangePlan | null {
  const normalized = normalizeComposerTranscript(ctx.transcript, ctx.priorObservations);
  if (normalized.clarificationRequired) {
    return changePlan({ clarificationRequired: normalized.clarificationRequired });
  }

  const transcript = normalized.text.trim();
  if (!transcript) return null;

  // Radiologist-authored findings join every resolution below — dictating,
  // correcting and removing a custom finding behave exactly like a built-in.
  const extras = ctx.customPhrases ?? [];

  if (normalized.removalTail) {
    return composeRemoval(normalized.removalTail, ctx.priorObservations ?? [], extras);
  }

  if (normalized.update) {
    return composeUpdate(normalized.update, ctx.priorObservations ?? [], extras);
  }

  if (normalized.isNegation) {
    const last = ctx.priorObservations?.slice(-1)[0];
    if (!last) {
      return changePlan({
        clarificationRequired: "Nothing to negate — no prior observation",
      });
    }
    return changePlan({
      observations: [observation({
        concept: last.concept,
        operation: "remove",
        targetObservationId: last.id,
        findingsText: last.findingsText,
      })],
    });
  }

  if (ctx.generateImpressionOnly) {
    const lines = (ctx.findingsText ?? "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s && !/\b(normal|unremarkable|maintained|no acute)\b/i.test(s));
    if (!lines.length) return null;
    return changePlan({
      impressionUpdate: lines.slice(0, 4).join(" "),
      clarificationRequired: null,
    });
  }

  if (normalized.correctionLevel && ctx.priorObservations?.length) {
    const target = ctx.priorObservations.find((o) =>
      o.concept.includes("disc") || o.concept.includes("bulge"),
    );
    if (target) {
      const catalogHits = matchCatalogPhrases(transcript, extras);
      const hit = catalogHits[0];
      const template = (hit ? { findingsText: hit.findingsText, impressionText: hit.impressionText } : null)
        ?? phraseByConcept(target.concept, extras)
        ?? { findingsText: transcript, impressionText: undefined };
      const filled = fillPhraseForObservation({
        template,
        level: normalized.correctionLevel,
        severity: null,
        laterality: null,
        grade: extractGrade(transcript),
      });
      return changePlan({
        observations: [observation({
          id: target.id,
          concept: target.concept,
          level: normalized.correctionLevel,
          findingsText: filled.findingsText,
          impressionText: filled.impressionText,
          operation: "update",
          targetObservationId: target.id,
          anatomicalSection: hit?.anatomicalSection ?? target.anatomicalSection,
          conflictGroup: hit?.conflictGroup ?? target.conflictGroup,
        })],
      });
    }
  }

  // Overlap guard: "central canal stenosis" fires BOTH the generic canal_stenosis
  // and the cervical_canal_stenosis templates. When hits share a concept stem
  // (same clinical family), keep the MOST SPECIFIC concept only, so a dictated
  // finding never lands twice in two wordings.
  const keepMostSpecific = <T extends { concept: string }>(hits: T[]): T[] => {
    const seenStems = new Map<string, T>();
    for (const hit of hits) {
      const stem = conceptStem(hit.concept);
      const incumbent = seenStems.get(stem);
      if (!incumbent || hit.concept.length > incumbent.concept.length) {
        seenStems.set(stem, hit);
      }
    }
    return [...seenStems.values()];
  };

  // Levels, severity, laterality and grade used to be pooled from the WHOLE
  // transcript and then stamped on every matched concept, so the fallback paired
  // every finding with every level. "Disc desiccation at L3-4 and L4-5, diffuse
  // disc bulge at L4-5, and ligamentum flavum hypertrophy at L4-5" produced SIX
  // observations — two of them dictating a bulge and a ligamentum hypertrophy at
  // L3-L4 that nobody said. A level invented by a composer is not a formatting
  // slip; it is a finding on a signed spine report.
  //
  // So attribute within the clause the finding was actually spoken in. A comma is
  // the boundary between findings; "and" is NOT — "desiccation at L3-4 and L4-5"
  // is one finding at two levels, and splitting it in half would discard L4-5.
  //
  // A bare level list ("... at L3-4, L4-5 and L5-S1") continues the finding
  // already being dictated, so it folds into that finding — dropping it would
  // lose dictated levels just as surely as inventing them. Nothing else folds:
  // a clause naming any other words is a separate statement, possibly a finding
  // this catalog does not know, and folding it would hand that clause's level to
  // the previous finding. "Disc bulge at L4-5, arachnoid cyst at T9-T10" must not
  // become a disc bulge at T9-T10.
  const units: { text: string; hits: ReturnType<typeof matchCatalogPhrases> }[] = [];
  for (const clause of splitDictationClauses(transcript)) {
    const hits = keepMostSpecific(matchCatalogPhrases(clause, extras));
    if (!hits.length) {
      if (units.length && isPureLevelContinuation(clause)) {
        units[units.length - 1]!.text += " " + clause;
      }
      continue;
    }
    units.push({ text: clause, hits });
  }

  const observations: VoiceObservation[] = [];
  const unresolved: string[] = [];

  for (const unit of units) {
    const clause = unit.text;
    const hits = unit.hits;
    const levels = extractLevels(clause);
    const severity = /\b(mild|minimal|moderate|severe|marked)\b/i.test(clause)
      ? (clause.match(/\b(mild|minimal|moderate|severe|marked)\b/i)?.[1] ?? null)
      : null;
    const laterality = /\bleft\b|\bright\b|\bbilateral\b|\bboth\b/i.test(clause)
      ? (clause.match(/\bleft\b|\bright\b|\bbilateral\b|\bboth\b/i)?.[0] ?? null)
      : null;
    const grade = extractGrade(clause);

    // One finding owning several levels, and several findings sharing one level,
    // are both unambiguous. Two or more findings with two or more levels inside
    // the SAME clause cannot be attributed, and the old answer was to
    // cross-multiply them. Ask instead — the rule contextBuilder.ts already gives
    // the model path: "If level reference is ambiguous, set clarificationRequired
    // and observations=[]". Nothing partial is emitted, because a plan that
    // resolved half a sentence and guessed the rest would read as complete.
    if (hits.length > 1 && levels.length > 1) {
      unresolved.push(
        `"${clause.trim()}" — ${hits.map((h) => h.concept.replace(/_/g, " ")).join(", ")} `
        + `were heard at ${levels.join(", ")}`,
      );
      continue;
    }

    for (const hit of hits) {
      const severityTemplate = severityPhraseForConcept(hit.concept);
      const template = severityTemplate
        ? { findingsText: severityTemplate.findingsText, impressionText: severityTemplate.impressionText }
        : { findingsText: hit.findingsText, impressionText: hit.impressionText };
      if (levels.length > 1 && /disc|bulge|desiccation|stenosis|narrowing|modic|endplate|facet|ligamentum/i.test(hit.concept)) {
        for (const lv of levels) {
          const filled = fillPhraseForObservation({
            template,
            level: lv,
            severity,
            laterality,
            grade,
          });
          observations.push(observation({
            id: `obs_${hit.concept}_${lv}`,
            concept: hit.concept,
            level: lv,
            severity,
            laterality,
            findingsText: filled.findingsText,
            impressionText: filled.impressionText,
            anatomicalSection: hit.anatomicalSection,
            conflictGroup: `${hit.conflictGroup ?? hit.anatomicalSection}_${lv}`,
            baselineReplaces: hit.baselineReplaces,
            operation: "add",
          }));
        }
      } else {
        // Body findings resolve their level from the RAW vertebra dictation
        // ("fracture of L1" stays L1); disc findings keep the segment expansion
        // that has always served them.
        const isBodyFinding = BODY_FINDING_RE.test(hit.concept);
        const lv = isBodyFinding
          ? extractBodyLevels(clause)[0] ?? null
          : levels[0] ?? null;
        const filled = fillPhraseForObservation({
          template,
          level: lv,
          severity,
          laterality,
          grade,
        });
        observations.push(observation({
          id: lv ? `obs_${hit.concept}_${lv}` : `obs_${hit.concept}`,
          concept: hit.concept,
          level: lv,
          severity,
          laterality,
          findingsText: filled.findingsText,
          impressionText: filled.impressionText,
          anatomicalSection: hit.anatomicalSection,
          conflictGroup: lv ? `${hit.conflictGroup ?? hit.anatomicalSection}_${lv}` : hit.conflictGroup,
          baselineReplaces: hit.baselineReplaces,
          operation: "add",
        }));
      }
    }
  }

  if (unresolved.length) {
    return changePlan({
      clarificationRequired:
        `Which level belongs to which finding? ${unresolved.join("; ")}. `
        + "Dictate them one at a time, or separate them with a comma, so each finding keeps its own level.",
    });
  }

  if (!observations.length) return null;

  return changePlan({
    observations,
    removeConflictingBaselineConcepts: observations
      .map((o) => (o as VoiceObservation & { baselineReplaces?: string }).baselineReplaces)
      .filter(Boolean) as string[],
    impressionCandidates: observations.map((o) => o.impressionText).filter(Boolean) as string[],
    clarificationRequired: null,
  });
}

/**
 * One repair attempt for a malformed model response. The model is warm and
 * already holds the transcript in context; asking it ONCE to re-emit strict
 * JSON usually saves the full Retry round-trip (~35 s). Exactly one attempt —
 * never a loop — and the repaired plan faces the SAME validation +
 * dictated-detail fidelity gates as a first-pass plan: a repair is a second
 * chance for the model, never for the rules.
 */
function buildRepairPrompt(originalPrompt: string, invalidOutput: string): string {
  // Truncate: a malformed response can be arbitrarily long garbage, and the
  // repair only needs enough of it for the model to recognise its own shape.
  const trimmed = invalidOutput.trim();
  const shown = !trimmed
    ? "(empty response)"
    : trimmed.length > 2000
      ? `${trimmed.slice(0, 2000)}…`
      : trimmed;
  return [
    originalPrompt,
    "",
    "YOUR PREVIOUS RESPONSE WAS NOT VALID JSON for the required schema:",
    shown,
    "",
    "Return ONLY a corrected, complete JSON object matching the schema exactly.",
    "No markdown, no explanations, no trailing text — the response must parse as JSON.",
  ].join("\n");
}

/**
 * A provider failure with a PHI-safe reason code. The reason NEVER carries the
 * prompt, the model response or the transcript — all clinical text. It classifies
 * WHY the composer could not answer so the operator can tell a slow model apart
 * from a missing fallback model apart from a refused connection.
 *
 * The caught error is deliberately not logged: `res.json()` on a non-JSON body
 * throws a SyntaxError whose message embeds a fragment of that body, which is
 * model-generated clinical text.
 */
class ComposerProviderError extends Error {
  constructor(readonly reason: string, readonly model: string) {
    super(`composer provider failure: ${reason}`);
    this.name = "ComposerProviderError";
  }
}

async function ollamaGenerateJson(
  endpoint: string,
  model: string,
  prompt: string,
  opts: { numCtx: number; temperature: number; timeoutMs: number },
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const requestOnce = async (format: "json" | typeof VOICE_COMPOSER_JSON_SCHEMA): Promise<string> => {
    // SECURITY: Bind to validated IP and reject redirects (PHI egress — voice transcript).
    const { response: res } = await hardenedLocalRequest(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format,
        // qwen3 (and any thinking-capable model) defaults to reasoning mode,
        // which under `format:"json"` emits an unbounded chain-of-thought and
        // never returns the JSON inside the 45s budget — the measured cause of
        // "Local composer unavailable". The composer wants a structured mapping,
        // not a differential-diagnosis essay, so reasoning is disabled here.
        think: false,
        // Hold the model in memory for 30 minutes after the last request
        // (Ollama's default lease is 5): a cold model pays a reload before the
        // first token — the AI-PC probe measured 19.4 s reload / 55.7 s total
        // after eviction (docs/smart-dictation-deployment-recommendations.md).
        // The lease dies naturally if another model (vision) needs the memory,
        // so it must ride WITH the 90 s budget, never instead of it.
        keep_alive: "30m",
        options: {
          num_ctx: opts.numCtx,
          temperature: opts.temperature,
        },
      }),
    });
    if (!res.ok) {
      throw new ComposerProviderError(res.status === 404 ? "model_not_found" : `http_${res.status}`, model);
    }
    const data = (await res.json()) as { response?: string };
    return (data.response ?? "").trim();
  };
  try {
    // Structured-output enforcement: send the real zod-mirroring JSON schema
    // (previously defined in schema.ts but never sent — the benchmark showed
    // 68% of the primary's clinically-correct plans carrying nulls Ollama was
    // never told were illegal) so the model cannot emit wrong-typed fields in
    // the first place. Servers without structured-output support (Ollama <
    // v0.5) refuse the object with a 4xx; one retry with the plain
    // format:"json" keeps them working, and parseChangePlanJson's null
    // normalization then tolerates whatever the model emits. A missing model
    // (404) is NOT retried — the failure is the model, not the request shape.
    try {
      return await requestOnce(VOICE_COMPOSER_JSON_SCHEMA);
    } catch (err) {
      if (err instanceof ComposerProviderError && /^http_4/.test(err.reason)) {
        return await requestOnce("json");
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof ComposerProviderError) throw err;
    // An aborted fetch surfaces as a DOMException/AbortError; classify the timeout.
    throw new ComposerProviderError(ac.signal.aborted ? "timeout" : "network", model);
  } finally {
    clearTimeout(timer);
  }
}

export async function composeVoiceChangePlan(
  ctx: ComposerContextInput,
  opts?: {
    requestId?: string;
    usePhraseFallback?: boolean;
  },
): Promise<ComposeResult> {
  const t0 = Date.now();
  const requestId = opts?.requestId ?? "local";
  const { resolveComposerRuntime } = await import("./runtimeConfig");
  const runtime = await resolveComposerRuntime();

  const region = ctx.region ?? "";
  const transcriptLength = ctx.transcript.trim().length;

  if (!smartDictationRegionSupported(region)) {
    return {
      ok: false,
      error: "Smart Dictation is supported on the six MRI examinations only (Brain, LS Spine, Cervical Spine, Whole Spine screening)",
      diagnostics: buildDiagnostics({
        requestId,
        model: runtime.model || "none",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const normalized = normalizeComposerTranscript(ctx.transcript, ctx.priorObservations);
  if (normalized.clarificationRequired) {
    return {
      ok: false,
      error: normalized.clarificationRequired,
      diagnostics: buildDiagnostics({
        requestId,
        model: runtime.model || "none",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const effectiveCtx = { ...ctx, transcript: normalized.text };

  const validationInput = {
    findingsText: ctx.findingsText ?? "",
    impressionText: ctx.impressionText ?? "",
    generateImpressionOnly: ctx.generateImpressionOnly,
  };

  if (opts?.usePhraseFallback) {
    const det = deterministicCompose(effectiveCtx);
    if (!det || det.clarificationRequired) {
      return {
        ok: false,
        error: det?.clarificationRequired ?? "Phrase fallback could not map dictation",
        diagnostics: buildDiagnostics({
          requestId,
          model: "phrase_catalog",
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          phraseFallback: true,
          endpointSource: runtime.endpointSource,
        }),
      };
    }
    const v = validateChangePlan({ plan: det, ...validationInput });
    if (!v.ok) {
      return {
        ok: false,
        error: v.reason ?? "Validation failed",
        diagnostics: buildDiagnostics({
          requestId,
          model: "phrase_catalog",
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          phraseFallback: true,
          endpointSource: runtime.endpointSource,
        }),
      };
    }
    // Mandatory preservation: whatever the transcript dictated — measurements,
    // levels, laterality, severity — must survive into the findings the plan
    // writes. The catalog has no measurement wording, so a measured dictation
    // through the phrase fallback is REFUSED here (dictation preserved for
    // review) instead of silently losing the number.
    const detFidelity = verifyDictatedDetailPreserved(ctx.transcript, det);
    if (!detFidelity.ok) {
      return {
        ok: false,
        error: dictationFidelityError(detFidelity.dropped),
        diagnostics: buildDiagnostics({
          requestId,
          model: "phrase_catalog",
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          schemaOk: true,
          phraseFallback: true,
          endpointSource: runtime.endpointSource,
          failureReason: "dictated_detail_dropped",
        }),
      };
    }
    // Clinical contradiction check (advisory — never blocks): the catalog
    // path faces the same review-time warnings as the LLM path, so a
    // superseded severity or a flipped side is named wherever it arose.
    const warnings = checkContradictions({
      plan: det,
      findingsText: ctx.findingsText,
      impressionText: ctx.impressionText,
      priorObservations: ctx.priorObservations,
    });
    return {
      ok: true,
      plan: det,
      ...(warnings.length ? { warnings } : {}),
      diagnostics: buildDiagnostics({
        requestId,
        model: "phrase_catalog",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: true,
        schemaOk: true,
        phraseFallback: true,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  if (!runtime.enabled || !runtime.model) {
    return {
      ok: false,
      error: "Report Composer model not configured — dictation preserved",
      diagnostics: buildDiagnostics({
        requestId,
        model: "none",
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
  if (!guard.ok) {
    return {
      ok: false,
      error: "Local composer unavailable — dictation preserved",
      diagnostics: buildDiagnostics({
        requestId,
        model: runtime.model,
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationOk: false,
        endpointSource: runtime.endpointSource,
        failureReason: "endpoint_refused",
      }),
    };
  }

  // Custom findings join the LLM's prompt vocabulary for the same exam families,
  // so an authored finding is dictatable through the local-AI path too — the
  // prompt stays the single catalog the model may choose wording from.
  const catalogBlock = catalogForPrompt(region, ctx.customPhrases);
  const prompt = buildComposerPrompt(effectiveCtx, catalogBlock);
  const endpoint = guard.url.origin;
  // Authored phrases carry their own anatomicalSection values (Settings →
  // Radiology → Voice); they join the allowed vocabulary below so a section
  // the radiologist taught is never stripped from the plan.
  const customSectionKeys = (ctx.customPhrases ?? [])
    .map((p) => p.anatomicalSection)
    .filter((s): s is string => Boolean(s && s.trim()));

  let raw = "";
  let modelUsed = runtime.model;
  let fallbackUsed = false;
  let primaryReason = "unknown";
  let fallbackReason: string | undefined;

  try {
    raw = await ollamaGenerateJson(endpoint, runtime.model, prompt, runtime);
  } catch (err) {
    primaryReason = err instanceof ComposerProviderError ? err.reason : "unknown";
    if (runtime.fallbackModel) {
      try {
        raw = await ollamaGenerateJson(endpoint, runtime.fallbackModel, prompt, runtime);
        modelUsed = runtime.fallbackModel;
        fallbackUsed = true;
      } catch (err2) {
        fallbackReason = err2 instanceof ComposerProviderError ? err2.reason : "unknown";
        logger.warn(
          {
            requestId,
            region,
            endpointSource: runtime.endpointSource,
            model: runtime.model,
            fallbackModel: runtime.fallbackModel,
            failureReasons: `${primaryReason},${fallbackReason}`,
            transcriptLength,
            latencyMs: Date.now() - t0,
          },
          "voiceReportComposer: local provider failed on both models",
        );
        return {
          ok: false,
          error: "Local composer unavailable — dictation preserved",
          diagnostics: buildDiagnostics({
            requestId,
            model: modelUsed,
            region,
            transcriptLength,
            latencyMs: Date.now() - t0,
            validationOk: false,
            fallbackUsed,
            endpointSource: runtime.endpointSource,
            failureReason: `${primaryReason},${fallbackReason}`,
          }),
        };
      }
    } else {
      logger.warn(
        {
          requestId,
          region,
          endpointSource: runtime.endpointSource,
          model: runtime.model,
          failureReasons: primaryReason,
          transcriptLength,
          latencyMs: Date.now() - t0,
        },
        "voiceReportComposer: local provider failed, no fallback configured",
      );
      return {
        ok: false,
        error: "Local composer unavailable — dictation preserved",
        diagnostics: buildDiagnostics({
          requestId,
          model: modelUsed,
          region,
          transcriptLength,
          latencyMs: Date.now() - t0,
          validationOk: false,
          endpointSource: runtime.endpointSource,
          failureReason: primaryReason,
        }),
      };
    }
  }

  const tParse = Date.now();
  let plan = parseChangePlanJson(raw);
  let repairUsed = false;
  if (!plan) {
    // ONE repair attempt — the warm model re-emits strict JSON instead of the
    // radiologist waiting for a full Retry round-trip. A repair transport
    // failure is not a provider failure: the schema_invalid verdict below is
    // the truth the operator needs.
    repairUsed = true;
    try {
      const repairedRaw = await ollamaGenerateJson(
        endpoint,
        modelUsed,
        buildRepairPrompt(prompt, raw),
        runtime,
      );
      plan = parseChangePlanJson(repairedRaw);
    } catch {
      // Repair attempt failed to even answer — fall through to schema_invalid.
    }
  }
  if (!plan) {
    return {
      ok: false,
      error: "Invalid structured response — dictation preserved",
      diagnostics: buildDiagnostics({
        requestId,
        model: modelUsed,
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationMs: 0,
        validationOk: false,
        schemaOk: false,
        fallbackUsed,
        endpointSource: runtime.endpointSource,
        failureReason: "schema_invalid",
        repairUsed,
      }),
    };
  }

  // Region section vocabulary: the model was TAUGHT the region's canonical
  // anatomicalSection keys in the prompt; this verifies it. A near-miss
  // spelling canonicalizes onto the real key; anything invented (the
  // "Spinal Canal" / "Sellar Region" failure documented in
  // z_fix_radiology_smart_findings_sections.sql) collapses to "" — the
  // report's Additional Observations catch-all — never a fake section.
  // First-pass and repaired plans funnel through this same `plan`, so the
  // repair path faces the identical rule. Findings text is never touched.
  plan = normalizePlanSections(plan, region, customSectionKeys);

  const v = validateChangePlan({ plan, ...validationInput });
  const validationMs = Date.now() - tParse;
  if (!v.ok) {
    return {
      ok: false,
      error: v.reason ?? "Validation failed",
      diagnostics: buildDiagnostics({
        requestId,
        model: modelUsed,
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationMs,
        validationOk: false,
        schemaOk: true,
        fallbackUsed,
        endpointSource: runtime.endpointSource,
      }),
    };
  }

  // Mandatory preservation: whatever the transcript dictated — measurements,
  // levels, laterality, severity — must survive into the findings this plan
  // writes. The benchmark showed plans that were clinically sound but silently
  // dropped a dictated value (right concept, right level, right target — and
  // no "9.2" anywhere). Refusing keeps the dictation visible for review;
  // nothing is ever dropped silently, and nothing is invented to fill the gap.
  const fidelity = verifyDictatedDetailPreserved(ctx.transcript, plan);
  if (!fidelity.ok) {
    return {
      ok: false,
      error: dictationFidelityError(fidelity.dropped),
      diagnostics: buildDiagnostics({
        requestId,
        model: modelUsed,
        region,
        transcriptLength,
        latencyMs: Date.now() - t0,
        validationMs,
        validationOk: false,
        schemaOk: true,
        fallbackUsed,
        endpointSource: runtime.endpointSource,
        failureReason: "dictated_detail_dropped",
      }),
    };
  }

  // Warmth telemetry: a latency jump far above the recent baseline is the
  // measured signature of a model eviction (keep_alive dies when vision claims
  // the GPU). Naming it in the logs saves the operator chasing a healthy
  // composer after every vision workload. PHI-safe: numbers and model only.
  recordComposeLatency(modelUsed, Date.now() - t0, requestId);

  // Clinical contradiction check (advisory — never blocks): the plan still
  // ships; the warnings ride next to it so the radiologist reviews them
  // BEFORE Apply. Runs after validation and fidelity — a plan worth warning
  // about is a plan that would otherwise have applied cleanly.
  const warnings = checkContradictions({
    plan,
    findingsText: ctx.findingsText,
    impressionText: ctx.impressionText,
    priorObservations: ctx.priorObservations,
  });

  return {
    ok: true,
    plan,
    ...(warnings.length ? { warnings } : {}),
    diagnostics: buildDiagnostics({
      requestId,
      model: modelUsed,
      region,
      transcriptLength,
      latencyMs: Date.now() - t0,
      validationMs,
      validationOk: true,
      schemaOk: true,
      fallbackUsed,
      endpointSource: runtime.endpointSource,
      repairUsed,
    }),
  };
}

export { SYNTHETIC_TEST_TRANSCRIPT };
