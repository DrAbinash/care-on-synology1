import { parseFieldPath, serializeFieldPath, type FieldPath } from "./fieldPath";
import type {
  FieldValue,
  FormatField,
  FormatOption,
  FormatSection,
  MutexGroupDef,
  StructuredFormatDoc,
  StructuredValues,
} from "./types";

function optionOf(field: FormatField, value: FieldValue | undefined): FormatOption | undefined {
  if (value == null || value === false || value === "") return undefined;
  if (Array.isArray(value)) {
    return field.options.find((o) => o.id === value[0] || o.value === value[0]);
  }
  const raw = String(value);
  return field.options.find((o) => o.id === raw || o.value === raw || o.label === raw);
}

function isNormalValue(field: FormatField, value: FieldValue | undefined): boolean {
  if (field.type === "normal_abnormal") {
    const v = String(value ?? "").toLowerCase();
    return v === "normal" || v === "true" && field.label.toLowerCase().includes("normal");
  }
  const opt = optionOf(field, value);
  if (!opt) return false;
  if (opt.severity === "normal") return true;
  return /\bnormal\b/i.test(`${opt.id} ${opt.value} ${opt.label}`) && !/\babnormal\b/i.test(`${opt.id} ${opt.value} ${opt.label}`);
}

function isAbnormalValue(field: FormatField, value: FieldValue | undefined): boolean {
  if (value == null || value === false || value === "") return false;
  if (isNormalValue(field, value)) return false;
  if (field.type === "text" || field.type === "textarea" || field.type === "number" || field.type === "measurement") {
    return asFilled(value);
  }
  return true;
}

function asFilled(value: FieldValue | undefined): boolean {
  if (value == null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function fieldsInScope(doc: StructuredFormatDoc, path: FieldPath): FormatSection | undefined {
  return doc.sections.find((s) => s.id === path.sectionId);
}

function mutexIdFor(field: FormatField, value: FieldValue | undefined): string | undefined {
  const opt = optionOf(field, value);
  return opt?.mutexGroup || field.mutexGroup;
}

function groupDef(doc: StructuredFormatDoc, id: string | undefined): MutexGroupDef | undefined {
  if (!id) return undefined;
  return doc.mutexGroups.find((g) => g.id === id);
}

/**
 * Apply a field value and enforce mutex:
 *  - exclusive: clear other fields in the same section+item sharing the mutex group
 *  - normal-clears-abnormal: selecting Normal clears pathology in that item; pathology clears Normal
 *
 * Mutex is always scoped to one anatomical instance (section + optional group item),
 * never across levels.
 */
export function applyFieldValue(
  doc: StructuredFormatDoc,
  values: StructuredValues,
  path: FieldPath,
  nextValue: FieldValue,
): StructuredValues {
  const section = fieldsInScope(doc, path);
  if (!section) {
    return { ...values, [serializeFieldPath(path)]: nextValue };
  }
  const field = section.fields.find((f) => f.id === path.fieldId);
  if (!field) {
    return { ...values, [serializeFieldPath(path)]: nextValue };
  }

  const next: StructuredValues = { ...values, [serializeFieldPath(path)]: nextValue };
  const thisMutex = mutexIdFor(field, nextValue) || field.mutexGroup;
  const def = groupDef(doc, thisMutex);
  const mode = def?.mode
    ?? (field.type === "normal_abnormal" ? "normal-clears-abnormal" : "exclusive");

  const sameScope = (other: FormatField) => {
    const otherPath: FieldPath = { sectionId: section.id, groupItemId: path.groupItemId, fieldId: other.id };
    return serializeFieldPath(otherPath);
  };

  if (!asFilled(nextValue)) return next;

  // Always: Normal vs pathology at the same anatomical instance.
  if (isNormalValue(field, nextValue) || mode === "normal-clears-abnormal") {
    if (isNormalValue(field, nextValue)) {
      for (const other of section.fields) {
        if (other.id === field.id) continue;
        const key = sameScope(other);
        if (isAbnormalValue(other, next[key])) delete next[key];
      }
    }
  }
  if (isAbnormalValue(field, nextValue)) {
    for (const other of section.fields) {
      if (other.id === field.id) continue;
      const key = sameScope(other);
      if (isNormalValue(other, next[key])) delete next[key];
    }
  }

  if (thisMutex && mode === "exclusive") {
    for (const other of section.fields) {
      if (other.id === field.id) continue;
      const key = sameScope(other);
      const otherMutex = mutexIdFor(other, next[key]) || other.mutexGroup;
      if (otherMutex === thisMutex && asFilled(next[key])) {
        if (other.type === "multi_select") next[key] = [];
        else delete next[key];
      }
    }
    // Same field: exclusive options (radio / single_select already one value;
    // multi_select drops sibling option ids in the same mutex group)
    if (field.type === "multi_select" && Array.isArray(nextValue)) {
      const kept: string[] = [];
      for (const id of nextValue.map(String)) {
        const opt = field.options.find((o) => o.id === id || o.value === id);
        if (!opt) continue;
        if (opt.mutexGroup && opt.mutexGroup === thisMutex && kept.length > 0) continue;
        kept.push(opt.id);
      }
      next[serializeFieldPath(path)] = kept;
    }
  }

  return next;
}

export function applyFieldValueKey(
  doc: StructuredFormatDoc,
  values: StructuredValues,
  key: string,
  nextValue: FieldValue,
): StructuredValues {
  return applyFieldValue(doc, values, parseFieldPath(key), nextValue);
}
