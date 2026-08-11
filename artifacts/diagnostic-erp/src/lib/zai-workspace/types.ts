// Z.ai RadReporting Workspace — domain types + pure rules
// Mirrors existing Care schema; all API calls go through real backend.

export type Modality = "XR" | "CT" | "MR" | "US" | "MG" | "DX" | "NM" | "PT" | "DOPPLER" | "ECHO" | "USG_OB";
export type StudyStatus = "received" | "in_progress" | "draft" | "prelim" | "final" | "amended";
export type Priority = "stat" | "urgent" | "routine" | "vip";
export type Criticality = "normal" | "mild" | "moderate" | "severe" | "critical";

export interface Patient { id: string; name: string; age: number; sex: "M" | "F" | "O"; uhid: string; phone?: string; referringDoctor: string; }
export interface Study { id: string; accession: string; studyInstanceUID: string; patient: Patient; modality: Modality; bodyPart: string; studyDescription: string; clinicalHistory: string; status: StudyStatus; priority: Priority; receivedAt: string; lockedBy?: string; lockExpiresAt?: string; priorCount: number; criticalFlag: boolean; aiDraftReady: boolean; tatMinutes: number; slaMinutes: number; series: number; images: number; }
export interface LintIssue { line: number; column: number; severity: "error" | "warning" | "info"; code: string; message: string; ruleId: string; fix?: string; }
export interface CopilotItem { id: string; kind: "critical" | "contradiction" | "suggestion" | "missing" | "measurement" | "recommendation" | "differential" | "ai-draft"; title: string; detail: string; insertText?: string; confidence: "low" | "medium" | "high"; band?: "routine" | "worth-a-look" | "attention"; source: string; }
export interface PriorStudy { id: string; date: string; modality: Modality; description: string; impression: string; compatibilityScore: number; }
export interface MeasurementRow { id: string; name: string; value: number; unit: string; priorValue?: number; delta?: number; source: "viewer" | "manual" | "ai"; inserted: boolean; }
export interface CriticalFinding { id: string; studyId: string; phrase: string; severity: Criticality; detectedAt: string; acknowledgedBy?: string; acknowledgedAt?: string; notifiedRecipient?: string; notifiedMethod?: "phone" | "whatsapp" | "in-person" | "email"; }

export type QuickSelectField = "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation";
export interface QuickSelectTile { id: string; field: QuickSelectField; scopeModality?: Modality; scopeBodyPart?: string; label: string; mnemonic?: string; category: "normal" | "abnormal" | "variant" | "critical"; sentence: string; favorite?: boolean; custom?: boolean; usageCount?: number; createdAt: string; updatedAt: string; }
export interface ReportFormat { id: string; name: string; modality: Modality; bodyPart: string; diagnosisTags: string[]; technique: string; findings: string; impression: string; recommendation: string; isCommon: boolean; custom?: boolean; usageCount?: number; createdAt: string; updatedAt: string; }
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

// Lint rules — pure, runnable on every keystroke
export function runLintRules(text: string, ctx: { modality: Modality; sex: "M" | "F" | "O" | undefined }): LintIssue[] {
  const issues: LintIssue[] = [];
  text.split("\n").forEach((line, idx) => {
    const ln = idx + 1;
    if (ctx.sex === "M" && /\b(uterus|ovary|cervix|endometrium)\b/i.test(line)) issues.push({ line:ln, column:0, severity:"error", code:"SEX_MISMATCH", message:"Female organ mentioned for male patient", ruleId:"laterality.sex-organ", fix:"Verify patient sex" });
    if (ctx.sex === "F" && /\b(prostate|testis|epididymis)\b/i.test(line)) issues.push({ line:ln, column:0, severity:"error", code:"SEX_MISMATCH", message:"Male organ mentioned for female patient", ruleId:"laterality.sex-organ", fix:"Verify patient sex" });
    if (/\bright\b/gi.test(line) && /\bleft\b/gi.test(line) && line.length < 200) issues.push({ line:ln, column:0, severity:"warning", code:"BILATERAL_AMBIGUITY", message:"Both 'right' and 'left' in single sentence", ruleId:"laterality.bilateral" });
    if (/___/.test(line)) { const col = line.indexOf("___"); issues.push({ line:ln, column:col, severity:"warning", code:"UNFILLED_PLACEHOLDER", message:"Measurement placeholder not filled", ruleId:"completeness.placeholder" }); }
    for (const { pattern, phrase } of CRITICAL_PATTERNS) { const m = pattern.exec(line); if (m) { const before = line.slice(Math.max(0,m.index-30), m.index); if (!/no |without |absence of |no evidence of /i.test(before)) { issues.push({ line:ln, column:m.index, severity:"error", code:"CRITICAL_FINDING", message:`Critical finding: ${phrase}`, ruleId:"critical.write-time" }); break; } } }
  });
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
export interface MergeResult { technique: string; techniqueSentences: MergeSentence[]; findings: string; impression: string; recommendation: string; findingsMerged: MergeFieldResult; impressionMerged: MergeFieldResult; recommendationMerged: MergeFieldResult; stats: { commonSentencesDiscarded: number; addedFromA: number; addedFromB: number; totalFinal: number; }; }
function splitSentences(t: string): string[] { return t?.trim() ? t.replace(/\s+/g," ").trim().split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/).map(s=>s.trim()).filter(Boolean) : []; }
function norm(s: string): string { return s.toLowerCase().replace(/\s+/g," ").replace(/___+/g,"___").replace(/[^a-z0-9\s]/g,"").trim(); }
function mergeField(fa: string, fb: string): MergeFieldResult {
  const sa = splitSentences(fa), sb = splitSentences(fb), nbSet = new Set(sb.map(norm));
  const sentences: MergeSentence[] = [], discarded: string[] = [], seen = new Set<string>();
  let common=0, a=0, b=0;
  for (const s of sa) { const n = norm(s); if (nbSet.has(n)) { sentences.push({text:s,source:"common"}); seen.add(n); common++; for (const bs of sb) if (norm(bs)===n) discarded.push(bs); } else { sentences.push({text:s,source:"from-a"}); seen.add(n); a++; } }
  for (const s of sb) { const n = norm(s); if (!seen.has(n)) { sentences.push({text:s,source:"from-b"}); seen.add(n); b++; } }
  return { text: sentences.map(s=>s.text).join(" "), sentences, common, addedFromA:a, addedFromB:b, discarded };
}
export function mergeTwoFormats(a: ReportFormat, b: ReportFormat): MergeResult {
  const tA = a.technique.trim(), tB = b.technique.trim();
  const sameTech = norm(tA) === norm(tB);
  const technique = sameTech ? tA : tA + " " + tB;
  const techniqueSentences: MergeSentence[] = sameTech ? [{text:tA, source:"common"}] : [{text:tA, source:"from-a"}, {text:tB, source:"from-b"}];
  const fm = mergeField(a.findings, b.findings), im = mergeField(a.impression, b.impression), rm = mergeField(a.recommendation, b.recommendation);
  return { technique, techniqueSentences, findings: fm.text, impression: im.text, recommendation: rm.text, findingsMerged: fm, impressionMerged: im, recommendationMerged: rm,
    stats: { commonSentencesDiscarded: fm.common+im.common+rm.common, addedFromA: fm.addedFromA+im.addedFromA+rm.addedFromA, addedFromB: fm.addedFromB+im.addedFromB+rm.addedFromB, totalFinal: fm.sentences.length+im.sentences.length+rm.sentences.length } };
}

// Snippet macro expansion
export function expandMacro(macro: SnippetMacro, values: Record<string,string>): string { let r = macro.template; for (const v of macro.variables) { r = r.replace(new RegExp(`\\{${v.name}\\}`,"g"), values[v.name] ?? v.default ?? "___"); } return r; }
export function detectMacroTrigger(text: string, macros: SnippetMacro[]): { macro: SnippetMacro; startPos: number } | null { const m = text.match(/:([a-z][a-z0-9_]*)$/i); if (!m) return null; const macro = macros.find(mc => mc.trigger.toLowerCase() === m![1].toLowerCase()); return macro ? { macro, startPos: text.length - m[0].length } : null; }

// Preload heuristic — fires at 80% findings completion
const TYP: Record<Modality, number> = { XR:200, CT:400, MR:500, US:300, MG:250, DX:200, NM:200, PT:200, DOPPLER:300, ECHO:350, USG_OB:400 };
export function getFindingsCompletionPct(text: string, m: Modality): number { return Math.min(100, Math.round((text.trim().length / (TYP[m] ?? 300)) * 100)); }
export function shouldPreloadNext(text: string, m: Modality, done: boolean): boolean { return !done && getFindingsCompletionPct(text, m) >= 80; }
