/**
 * Human-readable labels and report lines for viewer-imported measurements.
 * Fixes bare "linear: 7 mm" when no registry id is present.
 */

import { getMeasurement, resolveMeasurement } from "@workspace/measurements";

function dedupeUnit(value: string, unit: string): string {
  const u = unit.trim();
  if (!u) return "";
  const v = value.trim().toLowerCase();
  if (v.endsWith(u.toLowerCase())) return "";
  return u;
}

export type ViewerMeasurementRow = {
  measurementId?: string | null;
  measurementType: string;
  value: string;
  unit: string;
  sliceNumber: number | null;
};

const TYPE_LABELS: Record<string, string> = {
  linear: "Linear measurement",
  area: "Area measurement",
  volume: "Volume measurement",
  ellipse: "Elliptical measurement",
};

/** Best-effort anatomical / registry label for display and report insertion. */
export function formatViewerMeasurementLabel(m: ViewerMeasurementRow): string {
  if (m.measurementId) {
    const reg = getMeasurement(m.measurementId);
    if (reg?.displayName) return reg.displayName;
  }
  const typeRaw = (m.measurementType || "").trim();
  const resolved = typeRaw ? resolveMeasurement(typeRaw)?.definition : undefined;
  if (resolved && resolved.id.toLowerCase() !== typeRaw.toLowerCase()) {
    return resolved.displayName;
  }
  const kind = TYPE_LABELS[typeRaw.toLowerCase()];
  if (kind) {
    return m.sliceNumber != null ? `Slice ${m.sliceNumber} — ${kind}` : kind;
  }
  if (m.sliceNumber != null) return `Slice ${m.sliceNumber} measurement`;
  return typeRaw ? typeRaw.replace(/_/g, " ") : "Measurement";
}

/** Report line: "Label: value unit" */
export function formatViewerMeasurementLine(m: ViewerMeasurementRow): string {
  const label = formatViewerMeasurementLabel(m);
  const value = (m.value ?? "").trim();
  const unit = dedupeUnit(value, (m.unit ?? "").trim());
  const valuePart = [value, unit].filter(Boolean).join(" ").trim();
  return valuePart ? `${label}: ${valuePart}` : label;
}
