/**
 * knowledgeRetrieval.ts — deterministic section selection from the clinic's own radiology
 * documents, sized to the Composer's existing context budget.
 *
 * WHY DETERMINISTIC FIRST
 * The brief allows local embeddings only if measured retrieval justifies them, and a lexical
 * ranker is auditable: for any section in a prompt, the exact word in the radiologist's own
 * findings that pulled it can be named. A cosine score cannot answer "why is THIS rule in front of
 * my model" at a radiologist's pace, so this file has no embeddings, no vector store and no model.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not read the model's draft, the provisional normal templates, or anything but the
 * sentences the radiologist authored (`authoredSentences`, shared with the retirement rule so the
 * two can never disagree about what "his own words" means). It never edits a section: a partial
 * clinical rule is worse than none, so a section that does not fit is dropped whole. And it is an
 * offer, not a demand — when nothing fits, it returns an empty block and the compose runs exactly
 * as it did before this feature existed.
 */
import { authoredSentences } from "./baselineRetirement";
import { planComposerTextContext, type ComposerTextContextPlan } from "./composerContextBudget";
import { loadKnowledgeCorpus, type KnowledgeCorpus, type KnowledgeSection } from "./knowledgeCorpus";
import type { ComposerInputSnapshot, RagOverride } from "./types";
import { termOnlyDenied } from "./validateOutput";

/**
 * The gate. `isFeatureEnabledServer` returns false for an unknown key, so an unseeded flag means
 * the clinic runs exactly as it does today — RAG is OFF until someone turns it on deliberately.
 *
 * Read lazily, inside the call: the flag module pulls in `@workspace/db`, which throws at import
 * time when `DATABASE_URL` is unset. A composer that merely builds a prompt must not start
 * requiring a database because retrieval exists, and a flag that cannot be read is OFF — which is
 * both the default and the fail-safe.
 */
export const RAG_FEATURE_FLAG = "ff_radiology_ai_rag";

async function ragFlagOn(): Promise<boolean> {
  try {
    const { isFeatureEnabledServer } = await import("../featureFlags");
    return await isFeatureEnabledServer(RAG_FEATURE_FLAG);
  } catch {
    return false;
  }
}

const BRAIN = "mri-brain-v1.md";
const SPINE = "mri-ls-spine-v1.2.md";
const MASTER = "master-system-prompt-v4.md";

/**
 * The first line of every reference block. It is a safety instruction, not decoration: the model
 * is being shown clinical text that is NOT about this patient, which is the exact shape of a
 * hallucination source. The version stamp is what makes the quote traceable months later.
 */
export const REFERENCE_KNOWLEDGE_HEADER =
  "=== REFERENCE KNOWLEDGE — CARE'S OWN RADIOLOGY DOCUMENTS, NOT this patient's findings ===";

const REFERENCE_KNOWLEDGE_RULES =
  "These are the clinic's own reporting rules, retrieved for the examination being written.\n"
  + "They govern WORDING and INTERPRETATION only. They must not add any finding, side, level,\n"
  + "measurement or diagnosis that the supplied report does not already support, and nothing here\n"
  + "is evidence about this patient. The radiologist's supplied text remains the only clinical truth.";

/**
 * What a job records when reference knowledge was switched off for THAT JOB ONLY.
 *
 * Deliberately not the flag's sentence: `reference knowledge OFF (feature flag)` tells an auditor
 * the clinic runs without retrieval, which is a different fact and a different remedy. Naming the
 * operator's decision is what makes an A/B/C comparison readable afterwards, and it is also the
 * written proof that the global flag was left alone.
 */
export const REFERENCE_KNOWLEDGE_PER_JOB_OFF_NOTE =
  "reference knowledge OFF for this job — an authorized per-job override; the clinic-wide setting was not changed";

/** Words that carry no clinical signal and would match every document. */
const STOPWORDS = new Set([
  "there", "where", "these", "those", "with", "from", "have", "been", "were", "which", "their",
  "other", "both", "into", "than", "then", "when", "what", "that", "this", "over", "such", "also",
  "may", "can", "not", "and", "for", "are", "was", "per", "via", "all", "any", "but", "yet",
  "should", "would", "could", "while", "about", "being", "using", "used", "seen", "note",
]);

/** Stem to 6 letters so "infarct"/"infarction" and "ventricles"/"ventricular" are one concept. */
function stem(word: string): string {
  return word.length <= 6 ? word : word.slice(0, 6);
}

/** A word in a section's own heading says more about what the section governs than a word in its body. */
const TITLE_WEIGHT = 2;

function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/**
 * Which documents this examination may be written against.
 *
 * The examination's own document leads; the master prompt's cross-cutting rules (non-invention,
 * source priority) follow. An examination CARE has no document for gets the master rules only —
 * retrieving an MRI brain protocol for an unknown study would be a clinical claim about it.
 *
 * Two gates, both measured before being written (a cervical-spine case and a CT brain each pulled
 * an MRI document they had no rules in):
 *  - `mri-*` documents are MRI documents. Their rules name sequences — DWI, ADC, SWI, STIR — and
 *    quoting one into a CT, X-ray or ultrasound report describes an acquisition the patient did not
 *    have. A missing modality fails this gate, which is the safe direction.
 *  - CARE owns one spine document and it is LUMBOSACRAL. `family: "spine"` does not say which
 *    level, and cervical/dorsal wording used to reach it, so a cervical report would have been
 *    governed by rules about L4-L5 and the lumbosacral canal AP table.
 */
function eligibleFiles(snapshot: ComposerInputSnapshot): string[] {
  const fam = (snapshot.family ?? "").toLowerCase();
  const region = [snapshot.region ?? "", ...(snapshot.regions ?? [])].join(" ").toLowerCase();
  const mod = (snapshot.modality ?? "").toUpperCase();
  const isMRI = mod === "MR" || mod === "MRI";
  const exam: string[] = [];
  if (isMRI && (fam === "brain" || /brain|cerebr|cerebell|ventricul|sellar|posterior fossa|infratentorial/.test(region))) {
    exam.push(BRAIN);
  }
  if (isMRI && /lumbosacral|\blumb|sacr(al|um)\b|\bls\s*spine\b|lumbosacral\s*spine/.test(region)) {
    exam.push(SPINE);
  }
  return [...exam, MASTER];
}

export type RetrievedPassage = {
  address: string;
  file: string;
  id: number;
  title: string;
  version: string;
  chars: number;
  score: number;
};

export type RetrievedKnowledge = {
  /** The text to append to the user prompt. "" means retrieval contributed nothing. */
  block: string;
  passages: RetrievedPassage[];
  /** What was chosen and why — recorded with the job, never shown as a clinical finding. */
  reason: string;
  queryTerms: string[];
};

export function retrieveReferenceKnowledge(
  snapshot: ComposerInputSnapshot,
  opts: { maxChars: number; maxPassages?: number; corpus?: KnowledgeCorpus },
): RetrievedKnowledge {
  const empty: RetrievedKnowledge = { block: "", passages: [], reason: "", queryTerms: [] };
  const corpus = opts.corpus ?? loadKnowledgeCorpus();

  if (!corpus.available || !corpus.dir) {
    return { ...empty, reason: `reference knowledge unavailable — ${corpus.reason}` };
  }

  const authored = authoredSentences(snapshot);
  if (authored.length === 0) {
    return { ...empty, reason: "no authored findings to retrieve for — reference knowledge skipped" };
  }

  const files = eligibleFiles(snapshot);
  const candidates = corpus.sections.filter((s) => files.includes(s.file));
  if (candidates.length === 0) {
    return { ...empty, reason: `no document for this examination (${files.join(", ")}) — reference knowledge skipped` };
  }

  // The query: only the radiologist's own sentences.
  const rawQuery = new Set<string>();
  for (const sentence of authored) for (const t of terms(sentence)) rawQuery.add(t);
  if (rawQuery.size === 0) {
    return { ...empty, reason: "no authored findings to retrieve for — reference knowledge skipped" };
  }

  // A denial must not retrieve the rule for making the finding it denies.
  //
  // `termOnlyDenied` is the Composer's OWN grounding rule (validateOutput.ts): a word counts only
  // when some authored sentence states it without a negation cue. Sharing that one rule is the
  // point — retrieval and grounding disagreeing about whether the radiologist committed to
  // "restricted diffusion" would mean the pass that chooses the reference text is more permissive
  // than the pass that polices the output. "No restricted diffusion." therefore contributes no
  // diffusion term to the query, and a report whose every authored term is denied retrieves
  // nothing rather than a positive-pathology rule.
  const authoredText = authored.join("\n");
  const query = new Set<string>();
  const denied: string[] = [];
  for (const t of rawQuery) {
    if (termOnlyDenied(authoredText, t)) denied.push(t);
    else query.add(t);
  }
  if (query.size === 0) {
    return {
      ...empty,
      queryTerms: [...rawQuery],
      reason:
        `every authored finding is stated in the negative (${denied.sort().join(", ")}) `
        + "— no positive-pathology reporting rule retrieved",
    };
  }

  const sectionTerms = new Map<string, Set<string>>();
  const titleTerms = new Map<string, Set<string>>();
  for (const s of candidates) {
    sectionTerms.set(s.address, terms(`${s.title}\n${s.text}`));
    titleTerms.set(s.address, terms(s.title));
  }

  // Inverse-document-frequency over THIS examination's document set, so "ventricular" steers the
  // choice and "report" does not.
  const df = new Map<string, number>();
  for (const set of sectionTerms.values()) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = (t: string): number => Math.log((candidates.length + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  const scored = candidates
    .map((s) => {
      const set = sectionTerms.get(s.address)!;
      const title = titleTerms.get(s.address)!;
      let raw = 0;
      for (const t of query) {
        if (!set.has(t)) continue;
        // The heading is what the radiologist would recognise as the section's subject, so a word
        // in it counts twice. Without this a long topical rule (ACUTE ISCHEMIC INFARCTION) loses to
        // any short section that merely mentions the same words in passing, and the passage shown
        // is not the one that governs the finding the report actually states.
        raw += idf(t) * (title.has(t) ? TITLE_WEIGHT : 1);
      }
      const score = raw / Math.sqrt(Math.max(1, set.size));
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Examination document before the master rules, then address — so ties never depend on
      // Map iteration order or on how the corpus cache happened to fill.
      const fa = files.indexOf(a.s.file);
      const fb = files.indexOf(b.s.file);
      if (fa !== fb) return fa - fb;
      return a.s.address.localeCompare(b.s.address);
    });

  if (scored.length === 0) {
    return { ...empty, queryTerms: [...query], reason: "no section matched the authored findings" };
  }

  const maxPassages = opts.maxPassages ?? 4;
  const chosen: KnowledgeSection[] = [];
  for (const { s } of scored) {
    if (chosen.length >= maxPassages) break;
    const trial = buildBlock([...chosen, s]);
    if (trial.length > opts.maxChars) continue; // whole sections only, so keep looking or stop
    chosen.push(s);
  }

  if (chosen.length === 0) {
    return {
      ...empty,
      queryTerms: [...query],
      reason: `the top reference section did not fit the ${opts.maxChars}-character headroom — nothing was added`,
    };
  }

  return {
    block: buildBlock(chosen),
    passages: chosen.map((s) => ({
      address: s.address,
      file: s.file,
      id: s.id,
      title: s.title,
      version: s.version,
      chars: s.chars,
      score: scored.find((x) => x.s.address === s.address)!.score,
    })),
    reason: `${chosen.length} section(s) retrieved from ${[...new Set(chosen.map((c) => c.file))].join(", ")}`,
    queryTerms: [...query],
  };
}

function buildBlock(sections: KnowledgeSection[]): string {
  const body = sections
    .map((s) => `[${s.address} v=${s.version.slice(0, 12)}] ${s.headerLine}\n${s.text}`)
    .join("\n\n");
  return `${REFERENCE_KNOWLEDGE_HEADER}\n${REFERENCE_KNOWLEDGE_RULES}\n\n${body}`;
}

export type ReferenceKnowledgeOutcome = {
  /** The prompt to send — the input prompt when RAG is off or contributed nothing. */
  userPrompt: string;
  /** The context plan for THAT prompt, so the caller sends one plan and one truth. */
  plan: ComposerTextContextPlan;
  passages: RetrievedPassage[];
  /** What happened, in one line, for the job record and the ON/OFF measurement. */
  note: string;
};

/**
 * Size reference knowledge against the request CARE is already going to send.
 *
 * The order is the whole point. The radiologist's report is planned FIRST, on its own, and its
 * verdict is final: if it does not fit, that is the existing refusal and RAG has no part in it.
 * Only the spare window left over is offered to the documents, and the plan is recomputed with the
 * block appended — because the shipped planner also grows the output reserve with the input, the
 * recompute is not a formality. When the recompute says it no longer fits, sections are dropped
 * (never shortened, never the report) until it does, and if none fit the prompt is returned
 * untouched. RAG can therefore never turn a sendable request into a refused one, and never costs
 * the report a character.
 */
export async function applyReferenceKnowledge(opts: {
  snapshot: ComposerInputSnapshot;
  systemPrompt: string;
  userPrompt: string;
  transport: "ollama" | "cloud";
  configuredNumCtx?: number;
  /** Test/measurement seam; when omitted the feature flag decides. */
  enabled?: boolean;
  /**
   * PER-JOB OVERRIDE — `on` / `off` for THIS request only, decided and authorized by the caller
   * (`resolveRagOverride`, and `default` for anything that was not honoured). It outranks `enabled`
   * and outranks the flag, in both directions, because the flag is the clinic's setting and this is
   * the clinician's one report. `default` (or omitted) is byte-for-byte the behaviour that shipped
   * before it existed: the flag decides, and nothing is read or written anywhere else.
   *
   * An override of `off` never reads the flag at all, so a job can be switched off on a database
   * that is unreachable — and, more to the point, on a clinic whose flag says on.
   */
  override?: RagOverride;
  corpus?: KnowledgeCorpus;
  maxPassages?: number;
}): Promise<ReferenceKnowledgeOutcome> {
  const basePlan = planComposerTextContext({
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    transport: opts.transport,
    configuredNumCtx: opts.configuredNumCtx,
  });

  const override = opts.override ?? "default";
  const on =
    override === "on" ? true
    : override === "off" ? false
    : (opts.enabled ?? (await ragFlagOn()));
  const off = { userPrompt: opts.userPrompt, plan: basePlan, passages: [] as RetrievedPassage[] };
  if (!on) {
    // Two different no's, and a reviewer months later must be able to tell them apart: the
    // clinic's, and one operator's for one job. The wording of the flag answer is pinned by
    // `knowledgeBudget.test.ts` / `knowledgeStatusIsReported.test.ts`, so only the new branch is
    // added here.
    return {
      ...off,
      note: override === "off" ? REFERENCE_KNOWLEDGE_PER_JOB_OFF_NOTE : "reference knowledge OFF (feature flag)",
    };
  }
  // A request that does not fit on its own is the report's own problem: RAG must not be the
  // reason a compose is refused, and must not be given room that the report itself needs.
  if (!basePlan.fits) return { ...off, note: "no headroom — the report alone already exceeds the context" };

  const spareTokens = basePlan.ceilingTokens - basePlan.requiredTokens;
  if (spareTokens <= 0) return { ...off, note: "no headroom left by the context planner" };

  let cap = Math.max(0, spareTokens * 4);
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = retrieveReferenceKnowledge(opts.snapshot, {
      maxChars: cap,
      maxPassages: opts.maxPassages,
      corpus: opts.corpus,
    });
    if (r.passages.length === 0) {
      return { ...off, note: r.reason };
    }
    const candidate = opts.userPrompt + "\n\n" + r.block;
    const plan = planComposerTextContext({
      systemPrompt: opts.systemPrompt,
      userPrompt: candidate,
      transport: opts.transport,
      configuredNumCtx: opts.configuredNumCtx,
    });
    if (plan.fits) {
      return {
        userPrompt: candidate,
        plan,
        passages: r.passages,
        note: `${r.passages.length} reference section(s) added within ${cap} chars of headroom`,
      };
    }
    cap = Math.floor(cap / 2);
    if (cap < 200) break;
  }

  return { ...off, note: "no reference section fit the remaining context — report sent unchanged" };
}

