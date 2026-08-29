import { mergeTwoFormatsBySlot } from "@/lib/formatSlotMerge";

export type Modality = "XR" | "CT" | "MR" | "US" | "MG" | "DX" | "NM" | "PT" | "DOPPLER" | "ECHO" | "USG_OB";
export type StudyStatus = "received" | "in_progress" | "draft" | "prelim" | "final" | "amended";
export type Priority = "stat" | "urgent" | "routine" | "vip";
export type Criticality = "normal" | "mild" | "moderate" | "severe" | "critical";

export interface Patient { id: string; name: string; age: number; sex: "M" | "F" | "O"; uhid: string; phone?: string; referringDoctor: string; }
export interface Study { id: string; accession: string; studyInstanceUID: string; patient: Patient; modality: Modality; bodyPart: string; studyDescription: string; clinicalHistory: string; status: StudyStatus; priority: Priority; receivedAt: string; lockedBy?: string; lockExpiresAt?: string; priorCount: number; criticalFlag: boolean; aiDraftReady: boolean; tatMinutes: number; slaMinutes: number; series: number; images: number; }
export interface LintIssue { line: number; column: number; severity: "error" | "warning" | "info"; code: string; message: string; ruleId: string; fix?: string; }

// ── Per-study AI rules from content packs ────────────────────────────────────
// These are loaded from the YAML content packs and fed to runLintRules so the
// gutter marks (◌ △ ✕) fire per-study rules like "PNS/orbits not commented"
// or "acute infarct stated without diffusion descriptor" instead of just the
// 4 generic hardcoded rules.

export interface StudyCompletenessRule {
  id: string;
  glyph: "circle"; // ◌ — non-blocking nudge
  rule: string;    // plain-English description (e.g. "PNS/orbits not commented")
  message: string; // what to show in the gutter tooltip
  /** Optional: only fire if this keyword is ABSENT from the text */
  requiresAbsent?: string[];
  /** Optional: only fire if this keyword IS present in the text */
  requiresPresent?: string[];
}

export interface StudyContradictionRule {
  id: string;
  severity: "block" | "warn"; // ✕ block or △ warn
  glyph: "X" | "triangle";
  rule: string;
  message: string;
  /** Optional: fire if these keywords are ALL present */
  requiresAll?: string[];
  /** Optional: fire if any of these keywords are present */
  requiresAny?: string[];
  /** Optional: fire if ALL of these are absent */
  requiresAbsent?: string[];
}

export interface StudyAiRules {
  studyId: string;
  completenessRules: StudyCompletenessRule[];
  contradictionRules: StudyContradictionRule[];
}

// Cache of per-study rules loaded from the content-pack tiles API
let studyRulesCache: Map<string, StudyAiRules> | null = null;

/**
 * Fetch per-study AI rules from the content-pack tiles endpoint.
 * The rules are carried on each PackTile as completenessRules / contradictionRules.
 * Cached for 5 minutes.
 */
export async function fetchStudyAiRules(modality?: string, bodyPart?: string): Promise<StudyAiRules[]> {
  if (studyRulesCache && studyRulesCache.size > 0) return Array.from(studyRulesCache.values());
  try {
    const qs = new URLSearchParams();
    if (modality) qs.set("modality", modality);
    const res = await fetch(`/api/radiology/content-pack-tiles?${qs}`, { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json();
    const rules: StudyAiRules[] = [];
    const byPack = new Map<string, { completeness: StudyCompletenessRule[]; contradiction: StudyContradictionRule[] }>();
    for (const tile of data.tiles || []) {
      // The tile carries completenessRules/contradictionRules from the YAML finding
      if (tile.completenessRules?.length || tile.contradictionRules?.length) {
        const packId = tile.packId || "default";
        if (!byPack.has(packId)) byPack.set(packId, { completeness: [], contradiction: [] });
        const entry = byPack.get(packId)!;
        if (tile.completenessRules) entry.completeness.push(...tile.completenessRules);
        if (tile.contradictionRules) entry.contradiction.push(...tile.contradictionRules);
      }
    }
    for (const [packId, { completeness, contradiction }] of byPack) {
      rules.push({
        studyId: packId,
        completenessRules: completeness,
        contradictionRules: contradiction,
      });
    }
    studyRulesCache = new Map(rules.map(r => [r.studyId, r]));
    return rules;
  } catch {
    return [];
  }
}
export interface CopilotItem { id: string; kind: "critical" | "contradiction" | "suggestion" | "missing" | "measurement" | "recommendation" | "differential" | "ai-draft"; title: string; detail: string; insertText?: string; confidence: "low" | "medium" | "high"; band?: "routine" | "worth-a-look" | "attention"; source: string; }
export interface PriorStudy { id: string; date: string; modality: Modality; description: string; impression: string; compatibilityScore: number; }
export interface MeasurementRow { id: string; name: string; value: number; unit: string; priorValue?: number; delta?: number; source: "viewer" | "manual" | "ai"; inserted: boolean; }
export interface CriticalFinding { id: string; studyId: string; phrase: string; severity: Criticality; detectedAt: string; acknowledgedBy?: string; acknowledgedAt?: string; notifiedRecipient?: string; notifiedMethod?: "phone" | "whatsapp" | "in-person" | "email"; }

export type QuickSelectField = "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation";
export interface QuickSelectTile { id: string; field: QuickSelectField; scopeModality?: Modality; scopeBodyPart?: string; label: string; mnemonic?: string; category: "normal" | "abnormal" | "variant" | "critical"; sentence: string; impressionSentence?: string; favorite?: boolean; custom?: boolean; usageCount?: number; createdAt: string; updatedAt: string; anatomicalSection?: string; conflictGroup?: string; baselineReplaces?: string; properties?: string; }
export interface ReportFormat {
  id: string;
  name: string;
  modality: Modality;
  bodyPart: string;
  diagnosisTags: string[];
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  /** Printed heading below demography (not the library display name). */
  reportTitle?: string;
  /** Optional protocol / sub-technique scope (e.g. Screening, Plain, Contrast). */
  protocolScope?: string;
  /**
   * Technique fragment merge markers. Untagged formats fall back to regex
   * screening re-attachment. Tagged sentences union by dedupeKey; preserve
   * flagged fragments always survive.
   */
  techniqueFragments?: Array<{ text: string; dedupeKey: string; preserve?: boolean }>;
  isCommon: boolean;
  custom?: boolean;
  favorite?: boolean;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}
export interface SnippetMacro { id: string; trigger: string; label: string; template: string; variables: { name: string; label: string; default?: string; options?: string[] }[]; scopeModality?: Modality; scopeBodyPart?: string; custom?: boolean; createdAt: string; updatedAt: string; }
export interface SignOffProfile { id: string; modality: Modality; signerName: string; signerCredentials: string; isDefault?: boolean; signatureId?: string; createdAt: string; }

// Per-patient accent (pre-attentive wrong-patient detection)
export function patientAccent(id: string) { let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; const hue=h%360; return { hue, bg:`hsl(${hue},70%,96%)`, ring:`hsl(${hue},65%,55%)`, text:`hsl(${hue},70%,30%)` }; }
export function modalityAccent(m: Modality | string | undefined | null) {
  const map: Record<string, string> = {
    XR: "oklch(0.6 0.12 60)", CT: "oklch(0.55 0.18 220)", MR: "oklch(0.55 0.18 280)",
    US: "oklch(0.6 0.15 180)", MG: "oklch(0.65 0.18 330)", DX: "oklch(0.6 0.12 60)",
    NM: "oklch(0.55 0.18 140)", PT: "oklch(0.6 0.2 30)", DOPPLER: "oklch(0.6 0.15 200)",
    ECHO: "oklch(0.6 0.18 0)", USG_OB: "oklch(0.6 0.15 180)",
  };
  const key = String(m ?? "XR").toUpperCase();
  const color = map[key] ?? map.XR;
  return { color, label: key || "XR" };
}

// Critical patterns (mirrors criticalFindingsAlert.ts)
export const CRITICAL_PATTERNS: { pattern: RegExp; phrase: string; severity: Criticality }[] = [
  { pattern: /acute (intracranial )?hemorrhage/i, phrase: "Acute hemorrhage", severity: "critical" },
  { pattern: /acute infarct|acute stroke|mca territory infarct/i, phrase: "Acute infarct", severity: "critical" },
  { pattern: /mass effect with midline shift/i, phrase: "Mass effect with midline shift", severity: "critical" },
  { pattern: /tumor recurrence|recurrent (glioma|tumor)/i, phrase: "Tumor recurrence", severity: "critical" },
  { pattern: /pneumothorax/i, phrase: "Pneumothorax", severity: "critical" },
  { pattern: /aortic dissection/i, phrase: "Aortic dissection", severity: "critical" },
  { pattern: /pulmonary embolism/i, phrase: "Pulmonary embolism", severity: "critical" },
  { pattern: /bi-rads\s*(4|5|6)/i, phrase: "BI-RADS 4+ — suspicious for malignancy", severity: "severe" },
  { pattern: /interval increase in size|disease progression/i, phrase: "Interval progression of known malignancy", severity: "critical" },
  { pattern: /acute hydrocephalus/i, phrase: "Acute hydrocephalus", severity: "critical" },
];

// Lint rules — pure. Callers should debounce or defer the input text
// (see useDebouncedValue in findings editor / reporting workspace).
// Now accepts optional per-study rules from the YAML content packs.
export function runLintRules(
  text: string,
  ctx: { modality: Modality; sex: "M" | "F" | "O" | undefined },
  studyRules?: StudyAiRules[],
): LintIssue[] {
  const issues: LintIssue[] = [];
  const fullText = text;
  text.split("\n").forEach((line, idx) => {
    const ln = idx + 1;
    if (ctx.sex === "M" && /\b(uterus|ovary|cervix|endometrium)\b/i.test(line)) issues.push({ line:ln, column:0, severity:"error", code:"SEX_MISMATCH", message:"Female organ mentioned for male patient", ruleId:"laterality.sex-organ", fix:"Verify patient sex" });
    if (ctx.sex === "F" && /\b(prostate|testis|epididymis)\b/i.test(line)) issues.push({ line:ln, column:0, severity:"error", code:"SEX_MISMATCH", message:"Male organ mentioned for female patient", ruleId:"laterality.sex-organ", fix:"Verify patient sex" });
    if (/\bright\b/gi.test(line) && /\bleft\b/gi.test(line) && line.length < 200) issues.push({ line:ln, column:0, severity:"warning", code:"BILATERAL_AMBIGUITY", message:"Both 'right' and 'left' in single sentence", ruleId:"laterality.bilateral" });
    if (/___/.test(line)) { const col = line.indexOf("___"); issues.push({ line:ln, column:col, severity:"warning", code:"UNFILLED_PLACEHOLDER", message:"Measurement placeholder not filled", ruleId:"completeness.placeholder" }); }
    for (const { pattern, phrase } of CRITICAL_PATTERNS) { const m = pattern.exec(line); if (m) { const before = line.slice(Math.max(0,m.index-30), m.index); if (!/no |without |absence of |no evidence of /i.test(before)) { issues.push({ line:ln, column:m.index, severity:"error", code:"CRITICAL_FINDING", message:`Critical finding: ${phrase}`, ruleId:"critical.write-time" }); break; } } }
  });

  // ── Per-study content-pack rules ──────────────────────────────────────────
  // These fire against the FULL text (not per-line) because completeness rules
  // like "PNS/orbits not commented" need to check the entire findings section.
  if (studyRules && studyRules.length > 0) {
    for (const study of studyRules) {
      // Completeness rules (◌ — non-blocking nudge, severity "info")
      for (const rule of study.completenessRules) {
        const textLower = fullText.toLowerCase();
        let shouldFire = true;
        // requiresAbsent: fire only if these keywords are ABSENT
        if (rule.requiresAbsent) {
          for (const kw of rule.requiresAbsent) {
            if (textLower.includes(kw.toLowerCase())) { shouldFire = false; break; }
          }
        }
        // requiresPresent: fire only if these keywords ARE present
        if (shouldFire && rule.requiresPresent) {
          for (const kw of rule.requiresPresent) {
            if (!textLower.includes(kw.toLowerCase())) { shouldFire = false; break; }
          }
        }
        if (shouldFire) {
          // Parse the plain-English rule for simple keyword-based heuristics
          // e.g. "PNS/orbits not commented" → fire if "pns" not in text AND "orbit" not in text
          const ruleText = (rule.rule || "").toLowerCase();
          if (ruleText.includes("not commented") || ruleText.includes("not mentioned")) {
            // Extract the subject — e.g. "pns/orbits" from "PNS/orbits not commented"
            const subjectMatch = ruleText.match(/^([a-z\/\s]+?)\s+not\s+(commented|mentioned)/);
            if (subjectMatch) {
              const subjects = subjectMatch[1].split(/[\/\s]+/).filter(s => s.length > 2);
              const anyPresent = subjects.some(s => textLower.includes(s));
              if (!anyPresent && fullText.trim().length > 50) {
                issues.push({
                  line: 1, column: 0, severity: "info",
                  code: "STUDY_COMPLETENESS",
                  message: rule.message,
                  ruleId: rule.id,
                  fix: rule.message,
                });
              }
            }
          }
        }
      }

      // Contradiction rules (✕ block or △ warn)
      for (const rule of study.contradictionRules) {
        const textLower = fullText.toLowerCase();
        let shouldFire = true;
        if (rule.requiresAll) {
          for (const kw of rule.requiresAll) {
            if (!textLower.includes(kw.toLowerCase())) { shouldFire = false; break; }
          }
        }
        if (shouldFire && rule.requiresAny) {
          shouldFire = rule.requiresAny.some(kw => textLower.includes(kw.toLowerCase()));
        }
        if (shouldFire && rule.requiresAbsent) {
          for (const kw of rule.requiresAbsent) {
            if (textLower.includes(kw.toLowerCase())) { shouldFire = false; break; }
          }
        }
        if (shouldFire) {
          // Parse the plain-English rule for common contradiction patterns
          const ruleText = (rule.rule || "").toLowerCase();
          // "acute infarct" without DWI/ADC descriptor
          if (ruleText.includes("without dwi") && textLower.includes("acute infarct")) {
            if (!textLower.includes("dwi") && !textLower.includes("diffusion") && !textLower.includes("adc")) {
              issues.push({
                line: 1, column: 0,
                severity: rule.severity === "block" ? "error" : "warning",
                code: "STUDY_CONTRADICTION",
                message: rule.message,
                ruleId: rule.id,
              });
            }
          }
          // "any abnormal finding present AND normal-study impression used"
          if (ruleText.includes("normal-study impression") || ruleText.includes("normal impression")) {
            const hasAbnormal = /abnormal|hemorrhage|infarct|tumor|mass|lesion|fracture|edema|hydrocephalus/i.test(fullText);
            const hasNormalImpression = /no acute|normal study|no abnormality|no evidence of/i.test(fullText);
            if (hasAbnormal && hasNormalImpression) {
              issues.push({
                line: 1, column: 0,
                severity: rule.severity === "block" ? "error" : "warning",
                code: "STUDY_CONTRADICTION",
                message: rule.message,
                ruleId: rule.id,
              });
            }
          }
          // "laterality != impression laterality" — check if findings say right but impression says left
          if (ruleText.includes("laterality") || ruleText.includes("side differs")) {
            const findingsRight = /\bright\b/i.test(fullText) && !/no |without |absence of /i.test(fullText.slice(0, fullText.toLowerCase().indexOf("right")));
            const findingsLeft = /\bleft\b/i.test(fullText) && !/no |without |absence of /i.test(fullText.slice(0, fullText.toLowerCase().indexOf("left")));
            const impressionRight = /\bright\b/i.test(fullText);
            const impressionLeft = /\bleft\b/i.test(fullText);
            if ((findingsRight && impressionLeft && !impressionRight) || (findingsLeft && impressionRight && !impressionLeft)) {
              issues.push({
                line: 1, column: 0,
                severity: rule.severity === "block" ? "error" : "warning",
                code: "STUDY_CONTRADICTION",
                message: rule.message,
                ruleId: rule.id,
              });
            }
          }
        }
      }
    }
  }
  return issues;
}

export function runCopilotAnalysis(ctx: { findingsText: string; impressionText: string; modality: Modality; sex: "M" | "F" | "O" | undefined; measurements: MeasurementRow[]; hasPrior: boolean }): CopilotItem[] {
  const items: CopilotItem[] = [];
  const li = runLintRules(ctx.findingsText + "\n" + ctx.impressionText, { modality: ctx.modality, sex: ctx.sex });
  li.filter(i => i.code === "CRITICAL_FINDING").forEach(i => items.push({ id:`crit-${i.line}`, kind:"critical", title:"Critical finding detected", detail:i.message, confidence:"high", band:"attention", source:`Line ${i.line}` }));
  li.filter(i => i.code === "SEX_MISMATCH").forEach(i => items.push({ id:`sex-${i.line}`, kind:"contradiction", title:"Sex / organ mismatch", detail:i.message, confidence:"high", band:"attention", source:`Line ${i.line}` }));
  li.filter(i => i.code === "UNFILLED_PLACEHOLDER").forEach(i => items.push({ id:`ph-${i.line}`, kind:"missing", title:"Placeholder unfilled", detail:i.message, confidence:"high", band:"worth-a-look", source:`Line ${i.line}` }));
  if (!ctx.impressionText.trim()) items.push({ id:"missing-impression", kind:"missing", title:"Impression empty", detail:"Press Ctrl+I to AI-draft from findings.", confidence:"high", band:"attention", source:"Impression editor" });
  if (ctx.modality === "MG" && !/bi-rads/i.test(ctx.impressionText)) items.push({ id:"birads-gate", kind:"missing", title:"BI-RADS category required", detail:"Add BI-RADS 0-6 for mammography.", confidence:"high", band:"attention", source:"Finalize gate" });
  const pending = ctx.measurements.filter(m => !m.inserted);
  if (pending.length > 0) items.push({ id:"pending-measurements", kind:"measurement", title:`${pending.length} measurements pending`, detail:pending.map(m => `${m.name}: ${m.value}${m.unit}`).join(" · "), insertText:pending.map(m => `${m.name}: ${m.value}${m.unit}`).join(", "), confidence:"high", band:"worth-a-look", source:"Viewer" });
  if (ctx.hasPrior && !/comparison|prior|previous|interval/i.test(ctx.findingsText)) items.push({ id:"missing-comparison", kind:"suggestion", title:"Prior available — comparison not mentioned", detail:"Add a comparison statement.", insertText:"Comparison made with prior study dated ____. ", confidence:"medium", band:"worth-a-look", source:"Priors" });
  if (!/recommend|follow-up|correlation|referral/i.test(ctx.impressionText)) items.push({ id:"missing-rec", kind:"recommendation", title:"Recommendation missing", detail:"Add a follow-up recommendation.", confidence:"medium", band:"worth-a-look", source:"Recommendation" });
  return items;
}

export function computeQualityScore(ctx: { findingsText: string; impressionText: string; measurements: MeasurementRow[]; issues: LintIssue[] }) {
  const bd: { category: string; status: "pass" | "warn" | "fail" }[] = [];
  const hasF = ctx.findingsText.trim().length > 30, hasI = ctx.impressionText.trim().length > 10;
  const ph = (ctx.findingsText.match(/_{2,}/g) || []).length, pm = ctx.measurements.filter(m => !m.inserted).length;
  bd.push({ category: "Completeness", status: !hasF || !hasI ? "fail" : ph > 0 || pm > 0 ? "warn" : "pass" });
  const sm = ctx.issues.filter(i => i.code === "SEX_MISMATCH").length;
  bd.push({ category: "Consistency", status: sm > 0 ? "fail" : "pass" });
  const cr = ctx.issues.filter(i => i.code === "CRITICAL_FINDING").length;
  bd.push({ category: "Critical", status: cr > 0 ? "warn" : "pass" });
  const f = bd.filter(b => b.status === "fail").length, w = bd.filter(b => b.status === "warn").length;
  return { score: Math.max(0, Math.min(100, Math.round(100 - (f * 25 + w * 10)))), breakdown: bd };
}

// Merge algorithm
export interface MergeSentence { text: string; source: "common" | "from-a" | "from-b"; }
export interface MergeFieldResult { text: string; sentences: MergeSentence[]; common: number; addedFromA: number; addedFromB: number; discarded: string[]; }
export interface MergeResult { clinicalHistory: string; clinicalHistorySentences: MergeSentence[]; technique: string; techniqueSentences: MergeSentence[]; findings: string; impression: string; recommendation: string; findingsMerged: MergeFieldResult; impressionMerged: MergeFieldResult; recommendationMerged: MergeFieldResult; stats: { commonSentencesDiscarded: number; addedFromA: number; addedFromB: number; totalFinal: number; }; combinedReportTitle?: string | null; }
export function mergeTwoFormats(a: ReportFormat, b: ReportFormat): MergeResult {
  return mergeTwoFormatsBySlot(a, b);
}

// Snippet macro expansion
export function expandMacro(macro: SnippetMacro, values: Record<string,string>): string { let r = macro.template; for (const v of macro.variables) { r = r.replace(new RegExp(`\\{${v.name}\\}`,"g"), values[v.name] ?? v.default ?? "___"); } return r; }
export function detectMacroTrigger(text: string, macros: SnippetMacro[]): { macro: SnippetMacro; startPos: number } | null { const m = text.match(/:([a-z][a-z0-9_]*)$/i); if (!m) return null; const macro = macros.find(mc => mc.trigger.toLowerCase() === m![1].toLowerCase()); return macro ? { macro, startPos: text.length - m[0].length } : null; }

// Preload heuristic — fires at 80% findings completion
const TYP: Record<Modality, number> = { XR:200, CT:400, MR:500, US:300, MG:250, DX:200, NM:200, PT:200, DOPPLER:300, ECHO:350, USG_OB:400 };
export function getFindingsCompletionPct(text: string, m: Modality): number { return Math.min(100, Math.round((text.trim().length / (TYP[m] ?? 300)) * 100)); }
export function shouldPreloadNext(text: string, m: Modality, done: boolean): boolean { return !done && getFindingsCompletionPct(text, m) >= 80; }
