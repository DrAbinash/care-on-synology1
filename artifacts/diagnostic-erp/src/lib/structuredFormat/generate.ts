import { fillStructuredTemplate } from "../structuredFindings";
import { parseFieldPath, serializeFieldPath, type FieldPath } from "./fieldPath";
import { allNormalFindingsMap, fillItemTokens } from "./adapter";
import {
  severityToken,
  type CombineMode,
  type FieldValue,
  type FormatField,
  type FormatOption,
  type FormatSection,
  type GeneratedContribution,
  type ImpressionCandidate,
  type StructuredFormatDoc,
  type StructuredValues,
} from "./types";

function asString(v: FieldValue | undefined): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(String).filter(Boolean).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "";
  return String(v);
}

function selectedOptionIds(field: FormatField, value: FieldValue | undefined): string[] {
  if (value == null || value === false || value === "") return [];
  if (field.type === "checkbox" || field.type === "toggle") {
    return value === true || value === "true" || value === "yes" ? [field.options[0]?.id].filter(Boolean) as string[] : [];
  }
  if (field.type === "multi_select") {
    const ids = Array.isArray(value) ? value.map(String) : String(value).split(",").map((s) => s.trim());
    return ids.filter((id) => field.options.some((o) => o.id === id || o.value === id));
  }
  const raw = String(value);
  const hit = field.options.find((o) => o.id === raw || o.value === raw);
  return hit ? [hit.id] : [];
}

function optionById(field: FormatField, id: string): FormatOption | undefined {
  return field.options.find((o) => o.id === id || o.value === id);
}

function isNormalOption(opt: FormatOption | undefined): boolean {
  if (!opt) return false;
  if (opt.severity === "normal") return true;
  const v = `${opt.value} ${opt.label} ${opt.id}`.toLowerCase();
  return /\bnormal\b/.test(v) && !/\babnormal\b/.test(v);
}

function combinePhrases(phrases: string[], mode: CombineMode | undefined): string {
  const parts = phrases.map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const m = mode ?? "separate_sentences";
  if (m === "separate_sentences") return parts.join(" ");
  const stripped = parts.map((p) => p.replace(/[.;]+$/g, "").trim());
  if (m === "comma_list") return `${stripped.join(", ")}.`;
  if (stripped.length === 2) return `${stripped[0]} and ${stripped[1]}.`;
  return `${stripped.slice(0, -1).join(", ")}, and ${stripped[stripped.length - 1]}.`;
}

function tokenContext(
  doc: StructuredFormatDoc,
  section: FormatSection,
  groupItemId: string | undefined,
  values: StructuredValues,
): Record<string, string> {
  const ctx: Record<string, string> = {};
  if (section.repeat && groupItemId) {
    const group = doc.repeatingGroupDefs.find((g) => g.id === section.repeat!.groupId);
    const item = group?.items.find((i) => i.id === groupItemId);
    if (group && item) ctx[group.itemToken || "level"] = item.label;
  }
  for (const field of section.fields) {
    const path: FieldPath = { sectionId: section.id, groupItemId, fieldId: field.id };
    const key = serializeFieldPath(path);
    const raw = values[key];
    const ids = selectedOptionIds(field, raw);
    const token = field.token || field.id;
    if (field.type === "measurement" || field.type === "number") {
      ctx.measurement = asString(raw);
      if (field.unit) ctx.unit = field.unit;
      if (field.token) ctx[field.token] = asString(raw);
      continue;
    }
    if (field.type === "text" || field.type === "textarea") {
      if (field.token) ctx[field.token] = asString(raw);
      continue;
    }
    const opts = ids.map((id) => optionById(field, id)).filter(Boolean) as FormatOption[];
    if (opts.length === 0) continue;
    if (field.token === "severity" || token === "severity") {
      ctx.severity = severityToken(opts[0]?.severity);
    } else if (field.token === "side" || field.type === "laterality") {
      ctx.side = opts.map((o) => o.label).join("/");
    } else if (field.token === "grade" || field.type === "grade") {
      ctx.grade = opts[0]?.label ?? "";
    } else if (field.token === "root") {
      ctx.root = opts.map((o) => o.label).join("/");
    }
    if (field.token && !ctx[field.token]) {
      ctx[field.token] = opts.map((o) => o.label).join(", ");
    }
  }
  return ctx;
}

function renderOptionSentence(opt: FormatOption, ctx: Record<string, string>): string {
  const tpl = (opt.outputSentence ?? "").trim();
  if (tpl) return fillStructuredTemplate(tpl, ctx);
  if (isNormalOption(opt)) return "";
  return "";
}

function renderField(
  field: FormatField,
  value: FieldValue | undefined,
  ctx: Record<string, string>,
): { findings: string; impressions: ImpressionCandidate[]; fieldPathKey: string } {
  const dummyPath = "";
  const ids = selectedOptionIds(field, value);
  if (field.type === "text" || field.type === "textarea") {
    const t = asString(value).trim();
    return { findings: t, impressions: [], fieldPathKey: dummyPath };
  }
  if (field.type === "measurement" || field.type === "number") {
    const n = asString(value).trim();
    if (!n) return { findings: "", impressions: [], fieldPathKey: dummyPath };
    const unit = field.unit ? ` ${field.unit}` : "";
    const tpl = field.options[0]?.outputSentence;
    const text = tpl
      ? fillStructuredTemplate(tpl, { ...ctx, measurement: n, unit: field.unit ?? "" })
      : `${field.label} ${n}${unit}`.trim();
    return { findings: text, impressions: [], fieldPathKey: dummyPath };
  }

  const sentences: string[] = [];
  const impressions: ImpressionCandidate[] = [];
  for (const id of ids) {
    const opt = optionById(field, id);
    if (!opt) continue;
    const finding = renderOptionSentence(opt, ctx);
    if (finding) sentences.push(finding);
    const weight = opt.impressionWeight ?? 0;
    const impTpl = (opt.impressionSentence ?? "").trim();
    if (weight > 0 && impTpl) {
      impressions.push({
        text: fillStructuredTemplate(impTpl, ctx),
        weight,
        fieldPathKey: dummyPath,
        optionId: opt.id,
        canonicalKey: opt.canonicalKey,
      });
    }
  }
  return {
    findings: combinePhrases(sentences, field.combineMode),
    impressions: impressions.filter((c) => c.text.trim()),
    fieldPathKey: dummyPath,
  };
}

function sectionsForMapKey(
  doc: StructuredFormatDoc,
  mapKey: string,
): Array<{ section: FormatSection; groupItemId?: string }> {
  const out: Array<{ section: FormatSection; groupItemId?: string }> = [];
  for (const section of doc.sections) {
    if (!section.repeat) {
      if (section.label === mapKey) out.push({ section });
      continue;
    }
    const group = doc.repeatingGroupDefs.find((g) => g.id === section.repeat!.groupId);
    const item = group?.items.find((i) => i.label === mapKey);
    if (item) out.push({ section, groupItemId: item.id });
  }
  return out;
}

/**
 * Generate findingsMap + impression candidates from current values.
 * Empty/normal scopes keep template normal text.
 */
export function generateFromValues(
  doc: StructuredFormatDoc,
  values: StructuredValues,
): GeneratedContribution {
  const base = allNormalFindingsMap(doc);
  const impressionCandidates: ImpressionCandidate[] = [];
  const techniqueParts: string[] = [];
  const recParts: string[] = [];
  if ((doc.technique ?? "").trim()) techniqueParts.push(doc.technique!.trim());

  for (const mapKey of Object.keys(base)) {
    const scopes = sectionsForMapKey(doc, mapKey);
    const findingParts: string[] = [];
    let abnormal = false;

    for (const { section, groupItemId } of scopes) {
      const ctx = tokenContext(doc, section, groupItemId, values);
      const fieldTexts: string[] = [];
      let sectionAbnormal = false;

      for (const field of section.fields) {
        const path: FieldPath = { sectionId: section.id, groupItemId, fieldId: field.id };
        const key = serializeFieldPath(path);
        const rendered = renderField(field, values[key], ctx);
        const ids = selectedOptionIds(field, values[key]);
        const opts = ids.map((id) => optionById(field, id)).filter(Boolean) as FormatOption[];
        const normalish = opts.length > 0 && opts.every(isNormalOption);
        if (rendered.findings && !normalish) {
          fieldTexts.push(rendered.findings);
          sectionAbnormal = true;
        }
        for (const c of rendered.impressions) {
          impressionCandidates.push({ ...c, fieldPathKey: key });
        }
      }

      if (section.contributesTo.includes("technique") && fieldTexts.length) {
        techniqueParts.push(fieldTexts.join(" "));
      }
      if (section.contributesTo.includes("recommendation") && fieldTexts.length) {
        recParts.push(fieldTexts.join(" "));
      }

      if (sectionAbnormal) {
        abnormal = true;
        findingParts.push(fieldTexts.join(" "));
      }
    }

    if (abnormal) {
      base[mapKey] = { normal: false, text: findingParts.filter(Boolean).join(" ").trim() };
    }
  }

  impressionCandidates.sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));

  const findingsText = Object.values(base)
    .map((v) => v.text.trim())
    .filter(Boolean)
    .join("\n");

  return {
    findingsMap: base,
    findingsText,
    techniqueText: techniqueParts.join("\n"),
    impressionCandidates,
    recommendationText: recParts.join("\n"),
  };
}

export function setNormalForMapKey(
  doc: StructuredFormatDoc,
  values: StructuredValues,
  mapKey: string,
): StructuredValues {
  const next = { ...values };
  for (const { section, groupItemId } of sectionsForMapKey(doc, mapKey)) {
    for (const field of section.fields) {
      const key = serializeFieldPath({ sectionId: section.id, groupItemId, fieldId: field.id });
      delete next[key];
    }
  }
  return next;
}

export function setNormalForSection(
  doc: StructuredFormatDoc,
  values: StructuredValues,
  sectionId: string,
): StructuredValues {
  const next = { ...values };
  for (const key of Object.keys(next)) {
    try {
      const p = parseFieldPath(key);
      if (p.sectionId === sectionId) delete next[key];
    } catch {
      /* ignore */
    }
  }
  return next;
}

export { fillItemTokens };
