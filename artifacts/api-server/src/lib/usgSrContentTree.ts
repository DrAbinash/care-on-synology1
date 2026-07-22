/**
 * usgSrContentTree — standards-compliant DICOM SR content-tree parser (P3.4).
 *
 * The existing usgExtractor.parseDicomSr walks ContentSequence for NUM values but
 * reads only the code meaning and hardcodes frame 1. This module parses the full
 * SR content tree from DICOM-JSON, handling the value types used by ultrasound
 * measurement SRs (CONTAINER / NUM / CODE / TEXT / UIDREF / IMAGE / SCOORD /
 * SCOORD3D / COMPOSITE), and — crucially — resolves each NUM measurement's
 * referenced image SOP + frame + SCOORD caliper (the TID-1400 pattern
 * NUM → INFERRED FROM SCOORD → SELECTED FROM IMAGE). Pure, no DB, no network,
 * fully fixture-testable. Frame numbers are NEVER fabricated — a NUM with no
 * referenced image yields imageRef=undefined.
 */

// DICOM-JSON tag helpers ------------------------------------------------------
type Json = Record<string, unknown>;
interface TagVal { Value?: unknown[]; vr?: string }

function arr(o: Json | undefined, tag: string): unknown[] {
  return (o?.[tag] as TagVal | undefined)?.Value ?? [];
}
function str(o: Json | undefined, tag: string): string {
  const v = arr(o, tag)[0];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && (v as Record<string, string>).Alphabetic) return (v as Record<string, string>).Alphabetic;
  return String(v);
}
function numTag(o: Json | undefined, tag: string): number | null {
  const v = arr(o, tag)[0];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}
function firstItem(o: Json | undefined, tag: string): Json | undefined {
  const v = arr(o, tag)[0];
  return v && typeof v === "object" ? (v as Json) : undefined;
}

// Codes -----------------------------------------------------------------------
export interface SrCode { value: string; scheme: string; meaning: string }

function codeFromItem(item: Json | undefined): SrCode | undefined {
  if (!item) return undefined;
  const value = str(item, "00080100");
  const scheme = str(item, "00080102");
  const meaning = str(item, "00080104");
  if (!value && !meaning) return undefined;
  return { value, scheme, meaning };
}
function conceptName(item: Json): SrCode | undefined {
  return codeFromItem(firstItem(item, "0040A043")); // ConceptNameCodeSequence
}

// Referenced image ------------------------------------------------------------
export interface SrImageRef {
  sopClassUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number | null;
}
function imageRefFrom(item: Json): SrImageRef | undefined {
  const ref = firstItem(item, "00081199"); // ReferencedSOPSequence
  if (!ref) return undefined;
  const frame = numTag(ref, "00081160");   // ReferencedFrameNumber (may be multi-valued; take first)
  return {
    sopClassUID: str(ref, "00081150") || undefined,
    sopInstanceUID: str(ref, "00081155") || undefined,
    frameNumber: frame,
  };
}

// SCOORD ----------------------------------------------------------------------
export interface SrScoord {
  graphicType: string;      // POINT | POLYLINE | CIRCLE | ELLIPSE | MULTIPOINT
  graphicData: number[];    // pixel coordinates
  imageRef?: SrImageRef;    // the image the coordinates live on
}

export type SrValueType =
  | "CONTAINER" | "NUM" | "CODE" | "TEXT" | "UIDREF"
  | "IMAGE" | "SCOORD" | "SCOORD3D" | "COMPOSITE"
  | "DATETIME" | "DATE" | "TIME" | "PNAME" | "UNKNOWN";

export interface SrNode {
  valueType: SrValueType;
  relationship: string;
  concept?: SrCode;
  num?: { value: number; unit?: SrCode };
  code?: SrCode;
  text?: string;
  uidref?: string;
  image?: SrImageRef;
  scoord?: SrScoord;
  children: SrNode[];
  path: string;
}

function parseNode(item: Json, path: string): SrNode {
  const valueType = (str(item, "0040A040").toUpperCase() || "UNKNOWN") as SrValueType;
  const relationship = str(item, "0040A010");
  const node: SrNode = { valueType, relationship, concept: conceptName(item), children: [], path };

  switch (valueType) {
    case "NUM": {
      const mvs = firstItem(item, "0040A300"); // MeasuredValueSequence
      const value = numTag(mvs, "0040A30A");    // NumericValue
      if (value != null) node.num = { value, unit: codeFromItem(firstItem(mvs, "004008EA")) };
      break;
    }
    case "CODE":
      node.code = codeFromItem(firstItem(item, "0040A168")); // ConceptCodeSequence
      break;
    case "TEXT":
      node.text = str(item, "0040A160"); // TextValue
      break;
    case "UIDREF":
      node.uidref = str(item, "0040A124"); // UID
      break;
    case "IMAGE":
      node.image = imageRefFrom(item);
      break;
    case "SCOORD": {
      const graphicData = arr(item, "00700022").map((n) => Number(n)).filter((n) => !isNaN(n));
      node.scoord = { graphicType: str(item, "00700023"), graphicData };
      break;
    }
    default:
      break;
  }

  // Recurse into ContentSequence.
  const items = arr(item, "0040A730");
  node.children = items.map((c, i) => parseNode(c as Json, `${path}[${i}]`));

  // A SCOORD's referenced image is a child IMAGE (SELECTED FROM).
  if (node.scoord && !node.scoord.imageRef) {
    const img = node.children.find((c) => c.valueType === "IMAGE" && c.image);
    if (img?.image) node.scoord.imageRef = img.image;
  }
  return node;
}

/** Parse a DICOM-JSON SR instance into a content-node tree (root's children). */
export function parseSrContentTree(metadataJson: string | Json): SrNode[] {
  let obj: Json;
  try {
    obj = typeof metadataJson === "string" ? (JSON.parse(metadataJson) as Json) : metadataJson;
  } catch {
    return [];
  }
  const items = arr(obj, "0040A730");
  return items.map((c, i) => parseNode(c as Json, `ContentSequence[${i}]`));
}

// Flattened measurements with resolved provenance -----------------------------
export interface SrFlatMeasurement {
  concept?: SrCode;
  conceptText: string;
  value: number;
  unit?: SrCode;
  unitText: string;
  laterality?: string;
  findingSite?: SrCode;
  imageRef?: SrImageRef;   // resolved referenced image SOP + frame (never fabricated)
  scoord?: SrScoord;       // caliper coordinates, when present
  path: string;
}

const LATERALITY_MEANINGS = /\b(right|left|bilateral|midline)\b/i;

function findInSubtree(node: SrNode, pred: (n: SrNode) => boolean): SrNode | undefined {
  if (pred(node)) return node;
  for (const c of node.children) {
    const hit = findInSubtree(c, pred);
    if (hit) return hit;
  }
  return undefined;
}
function collectCodes(node: SrNode, out: SrNode[] = []): SrNode[] {
  if (node.valueType === "CODE") out.push(node);
  for (const c of node.children) collectCodes(c, out);
  return out;
}

/** Flatten all NUM measurements, resolving each one's referenced image + caliper
 *  and any laterality / finding-site codes in its subtree. */
export function collectSrMeasurements(roots: SrNode[]): SrFlatMeasurement[] {
  const out: SrFlatMeasurement[] = [];

  function walk(node: SrNode): void {
    if (node.valueType === "NUM" && node.num) {
      // Prefer a SCOORD (caliper) in the subtree; fall back to a bare IMAGE ref.
      const scoordNode = findInSubtree(node, (n) => n !== node && n.valueType === "SCOORD" && !!n.scoord?.imageRef);
      const imageNode = findInSubtree(node, (n) => n !== node && n.valueType === "IMAGE" && !!n.image);
      const scoord = scoordNode?.scoord;
      const imageRef = scoord?.imageRef ?? imageNode?.image;

      // Laterality / finding-site from CODE descendants.
      let laterality: string | undefined;
      let findingSite: SrCode | undefined;
      for (const codeNode of collectCodes(node)) {
        const cm = codeNode.concept?.meaning?.toLowerCase() ?? "";
        if (/laterality|side/.test(cm) && codeNode.code) {
          const m = codeNode.code.meaning.match(LATERALITY_MEANINGS);
          if (m) laterality = m[1].toLowerCase();
        }
        if (/finding site|anatomic|site/.test(cm) && codeNode.code) findingSite = codeNode.code;
      }
      // Fallback: laterality embedded in the concept meaning itself.
      if (!laterality) {
        const m = (node.concept?.meaning ?? "").match(LATERALITY_MEANINGS);
        if (m) laterality = m[1].toLowerCase();
      }

      out.push({
        concept: node.concept,
        conceptText: node.concept?.meaning || node.concept?.value || "",
        value: node.num.value,
        unit: node.num.unit,
        unitText: node.num.unit?.meaning || node.num.unit?.value || "",
        laterality,
        findingSite,
        imageRef,
        scoord,
        path: node.path,
      });
    }
    for (const c of node.children) walk(c);
  }

  for (const r of roots) walk(r);
  return out;
}

/** Convenience: parse + flatten in one call. */
export function extractSrMeasurements(metadataJson: string | Json): SrFlatMeasurement[] {
  return collectSrMeasurements(parseSrContentTree(metadataJson));
}
