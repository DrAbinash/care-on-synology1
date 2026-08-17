/**
 * Typed field path for structured format values.
 * Storage key: `sectionId[::groupItemId]::fieldId`
 * Never parse that string ad-hoc — use parseFieldPath / serializeFieldPath.
 */

export type FieldPath = {
  sectionId: string;
  groupItemId?: string;
  fieldId: string;
};

const SEP = "::";

export function serializeFieldPath(path: FieldPath): string {
  if (path.groupItemId) {
    return `${path.sectionId}${SEP}${path.groupItemId}${SEP}${path.fieldId}`;
  }
  return `${path.sectionId}${SEP}${path.fieldId}`;
}

export function parseFieldPath(key: string): FieldPath {
  const parts = key.split(SEP);
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    return { sectionId: parts[0], groupItemId: parts[1], fieldId: parts[2] };
  }
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { sectionId: parts[0], fieldId: parts[1] };
  }
  throw new Error(`Invalid FieldPath key: ${key}`);
}

export function isFieldPathKey(key: string): boolean {
  try {
    parseFieldPath(key);
    return true;
  } catch {
    return false;
  }
}

export function fieldPathEquals(a: FieldPath, b: FieldPath): boolean {
  return a.sectionId === b.sectionId
    && a.fieldId === b.fieldId
    && (a.groupItemId ?? "") === (b.groupItemId ?? "");
}

export function fieldPathInScope(path: FieldPath, scope: { sectionId: string; groupItemId?: string }): boolean {
  if (path.sectionId !== scope.sectionId) return false;
  return (path.groupItemId ?? "") === (scope.groupItemId ?? "");
}
