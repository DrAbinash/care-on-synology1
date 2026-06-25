/**
 * usgExtractor.ts
 *
 * GE Ultrasound DICOM auto-measurement extraction service.
 *
 * Extraction pipeline (in order of confidence):
 *   1. DICOM Structured Report (SR) — highest confidence; parsed from dicomMetadata JSON
 *   2. DICOM tag values (PatientName, StudyDate, Manufacturer, etc.)
 *   3. Gemini Vision OCR on WADO image frames — for burned-in text
 *   4. Gemini text normalization fallback — if OCR image fetch fails
 *
 * SAFETY: Never auto-finalizes. All results land in `pending_review` status until
 * a radiologist explicitly approves them via the review endpoint.
 */

import { db } from "@workspace/db";
import {
  usgMeasurementsTable,
  usgExtractionLogsTable,
  usgExtractionSettingsTable,
  pacsSettingsTable,
  usgDopplerMeasurementsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { geminiUsgOcr, geminiNormalizeMeasurements, type UsgMeasurementJson } from "@workspace/integrations-gemini-ai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UsgExtractionInput {
  worklistId?: number;
  studyId?: number;
  studyInstanceUID: string;
  accessionNumber?: string;
  patientId?: number;
  dicomMetadataJson?: string;   // JSON string from the worklist row
  triggeredBy?: "auto" | "manual";
  triggeredByUserId?: number;
}

export interface UsgExtractionResult {
  measurementId: number;
  logId: number;
  status: "completed" | "failed";
  source: "dicom_sr" | "ocr" | "combined" | "manual";
  overallConfidence: "high" | "medium" | "low";
  measurements: Partial<UsgMeasurementJson>;
  error?: string;
}

// ── Admin settings helper ─────────────────────────────────────────────────────
// Uses the usg_extraction_settings singleton table (id=1).

export interface UsgAdminSettings {
  ocrEnabled: boolean;
  aiNormalizeEnabled: boolean;
  srPriorityMode: boolean;
  autoRejectLowConfidence: boolean;
  humanReviewRequired: boolean;
  autoFinalize: boolean;
  confidenceThreshold: number;      // 0.0–1.0, default 0.80
  lowConfidenceCutoff: number;      // 0.0–1.0, default 0.60
  maxFramesToOcr: number;
  geAeTitle: string;
  geIp: string;
  gePort: string;
}

const SETTINGS_DEFAULTS: UsgAdminSettings = {
  ocrEnabled: true,
  aiNormalizeEnabled: true,
  srPriorityMode: true,
  autoRejectLowConfidence: true,
  humanReviewRequired: true,
  autoFinalize: false,
  confidenceThreshold: 0.80,
  lowConfidenceCutoff: 0.60,
  maxFramesToOcr: 20,
  geAeTitle: "GE_USG",
  geIp: "",
  gePort: "11112",
};

export async function getUsgAdminSettings(): Promise<UsgAdminSettings> {
  try {
    const [row] = await db
      .select()
      .from(usgExtractionSettingsTable)
      .where(eq(usgExtractionSettingsTable.id, 1))
      .limit(1);

    if (!row) return SETTINGS_DEFAULTS;

    return {
      ocrEnabled:              row.ocrEnabled,
      aiNormalizeEnabled:      row.aiNormalizeEnabled,
      srPriorityMode:          row.srPriorityMode,
      autoRejectLowConfidence: row.autoRejectLowConfidence,
      humanReviewRequired:     row.humanReviewRequired,
      autoFinalize:            row.autoFinalize,
      confidenceThreshold:     row.confidenceThreshold,
      lowConfidenceCutoff:     row.lowConfidenceCutoff,
      maxFramesToOcr:          row.maxFramesToOcr,
      geAeTitle:               row.geAeTitle,
      geIp:                    row.geIp,
      gePort:                  row.gePort,
    };
  } catch {
    return SETTINGS_DEFAULTS;
  }
}

export async function saveUsgAdminSettings(settings: Partial<UsgAdminSettings>): Promise<void> {
  // Upsert: if row 1 exists update it, otherwise insert it.
  const [existing] = await db
    .select({ id: usgExtractionSettingsTable.id })
    .from(usgExtractionSettingsTable)
    .where(eq(usgExtractionSettingsTable.id, 1))
    .limit(1);

  if (existing) {
    await db
      .update(usgExtractionSettingsTable)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(usgExtractionSettingsTable.id, 1));
  } else {
    await db
      .insert(usgExtractionSettingsTable)
      .values({ id: 1, ...SETTINGS_DEFAULTS, ...settings });
  }
}

// ── DICOM metadata extractor ──────────────────────────────────────────────────

interface DicomMetaExtract {
  patientName?: string;
  patientId?: string;
  studyDate?: string;
  studyDescription?: string;
  modality?: string;
  manufacturer?: string;
  manufacturerModel?: string;
  institutionName?: string;
}

/**
 * Extract basic demographic / device fields from the dicomMetadata JSON string
 * stored on the worklist row. The JSON may be a DICOM-JSON object or a flat
 * key-value map — we handle both shapes defensively.
 */
export function extractDicomMetadata(metadataJson: string): DicomMetaExtract {
  try {
    const obj = JSON.parse(metadataJson) as Record<string, unknown>;

    // DICOM-JSON format uses tag addresses like "00100010": { "Value": [...] }
    function tag(t: string): string {
      const entry = obj[t] as { Value?: unknown[] } | undefined;
      const val = entry?.Value?.[0];
      if (!val) return "";
      if (typeof val === "string") return val;
      if (typeof val === "object" && val !== null) {
        const v = val as Record<string, string>;
        // PN (PersonName) component groups
        if (v.Alphabetic) return v.Alphabetic.replace(/\^/g, " ").trim();
      }
      return String(val);
    }

    // Also support flat key-value format (what our ingestion endpoint passes)
    function flat(key: string): string {
      const v = obj[key];
      return typeof v === "string" ? v : "";
    }

    return {
      patientName:      tag("00100010") || flat("patientName"),
      patientId:        tag("00100020") || flat("patientId"),
      studyDate:        tag("00080020") || flat("studyDate"),
      studyDescription: tag("00081030") || flat("studyDescription"),
      modality:         tag("00080060") || flat("modality"),
      manufacturer:     tag("00080070") || flat("manufacturer"),
      manufacturerModel: tag("00081090") || flat("manufacturerModelName"),
      institutionName:  tag("00080080") || flat("institutionName"),
    };
  } catch {
    return {};
  }
}

// ── DICOM SR parser ───────────────────────────────────────────────────────────

interface SrMeasurement {
  conceptName: string;
  value: string;
  unit: string;
  confidence: "high";
  vessel?: string;
  side?: string;
  path: string;
  sopInstanceUID?: string;
  seriesInstanceUID?: string;
}

interface DicomDopplerMeasurement {
  vesselName: string;
  side: "left" | "right" | "bilateral" | "midline" | "unknown";
  psv?: string;
  edv?: string;
  ri?: string;
  pi?: string;
  sdRatio?: string;
}

/**
 * Parse DICOM Structured Report measurement sequences from DICOM-JSON.
 * SR measurements get confidence=high because they come from the machine directly.
 *
 * We look for:
 *  - Sequence items under ContentSequence (0040,A730) with ValueType=NUM
 *  - ConceptNameCodeSequence for the measurement label
 *  - MeasuredValueSequence for the numeric value + unit
 */
export function parseDicomSr(metadataJson: string): SrMeasurement[] {
  const measurements: SrMeasurement[] = [];
  try {
    const obj = JSON.parse(metadataJson) as Record<string, unknown>;
    const docSopUid = (obj["00080018"] as { Value?: string[] })?.Value?.[0] || "";
    const docSeriesUid = (obj["0008000E"] as { Value?: string[] })?.Value?.[0] || "";

    // Recursive walker over ContentSequence items carrying vessel and side contexts
    function walk(node: Record<string, unknown>, currentPath = "ContentSequence", currentVessel = "unknown", currentSide = "unknown"): void {
      const cs = node["0040A730"] as { Value?: unknown[] } | undefined;
      const items = cs?.Value ?? [];
      items.forEach((item, index) => {
        const seq = item as Record<string, unknown>;
        const path = `${currentPath}[${index}]`;
        const valueType = (seq["0040A040"] as { Value?: string[] })?.Value?.[0] ?? "";
        
        let vessel = currentVessel;
        let side = currentSide;

        const conceptName = extractConceptName(seq);

        // Update context if we encounter vessel or side codes
        if (conceptName.match(/umbilical artery|middle cerebral artery|uterine artery|renal artery|vessel|artery|vein/i)) {
          vessel = conceptName;
        }
        if (conceptName.match(/right|lt|rt|left/i)) {
          side = conceptName.match(/right|rt/i) ? "right" : "left";
        }

        if (valueType === "NUM") {
          const { value, unit } = extractMeasuredValue(seq);
          if (conceptName && value) {
            measurements.push({
              conceptName,
              value,
              unit,
              confidence: "high",
              vessel,
              side,
              path,
              sopInstanceUID: docSopUid,
              seriesInstanceUID: docSeriesUid
            });
          }
        }
        // Recurse
        walk(seq, path, vessel, side);
      });
    }

    function extractConceptName(seq: Record<string, unknown>): string {
      const cns = (seq["0040A043"] as { Value?: unknown[] })?.Value?.[0] as Record<string, unknown> | undefined;
      if (!cns) return "";
      const code  = (cns["00080104"] as { Value?: string[] })?.Value?.[0] ?? "";
      return code;
    }

    function extractMeasuredValue(seq: Record<string, unknown>): { value: string; unit: string } {
      const mvs = (seq["0040A300"] as { Value?: unknown[] })?.Value?.[0] as Record<string, unknown> | undefined;
      if (!mvs) return { value: "", unit: "" };
      const numVal = (mvs["0040A30A"] as { Value?: number[] })?.Value?.[0];
      const unitSeq = (mvs["004008EA"] as { Value?: unknown[] })?.Value?.[0] as Record<string, unknown> | undefined;
      const unit = (unitSeq?.["00080100"] as { Value?: string[] })?.Value?.[0] ?? "";
      return { value: numVal !== undefined ? String(numVal) : "", unit };
    }

    walk(obj);
  } catch {
    // Non-fatal — we'll fall back to OCR
  }
  return measurements;
}

export interface GePrivateProvenance {
  value: string;
  tag: string;
  rawVal: string;
  xmlPath?: string;
  privateCreator?: string;
}

export function parseGePrivateTagsWithProvenance(metadataJson: string): {
  mapped: Record<string, string>;
  provenance: Record<string, GePrivateProvenance>;
} {
  const mapped: Record<string, string> = {};
  const provenance: Record<string, GePrivateProvenance> = {};
  
  try {
    const obj = JSON.parse(metadataJson) as Record<string, unknown>;
    
    for (const [tagKey, tagData] of Object.entries(obj)) {
      if (typeof tagData !== "object" || tagData === null) continue;
      const valEntry = tagData as { Value?: unknown[]; vr?: string };
      const rawVal = valEntry.Value?.[0];
      if (!rawVal) continue;

      const strVal = String(rawVal);
      const creator = (obj[tagKey.slice(0, 4) + "0010"] as { Value?: string[] })?.Value?.[0] || 
                      (tagKey.startsWith("0029") || tagKey.startsWith("0019") ? "Siemens_Samsung_USG" :
                       tagKey.startsWith("2001") || tagKey.startsWith("200d") || tagKey.startsWith("200D") ? "Philips_USG" : "Private_USG");

      const isPrivateTag =
        tagKey.startsWith("0079") ||
        tagKey.startsWith("0009") ||
        tagKey.startsWith("0021") ||
        tagKey.startsWith("0029") ||
        tagKey.startsWith("0019") ||
        tagKey.startsWith("2001") ||
        tagKey.startsWith("200d") ||
        tagKey.startsWith("200D") ||
        tagKey.startsWith("0033");

      if (isPrivateTag) {
        if (strVal.includes("<") && strVal.includes(">")) {
          // Parse XML tags like <Measurement Name="BPD" Value="7.4" Unit="cm"/> or <BPD>74</BPD>
          const MAP: [RegExp, string][] = [
            [/<Measurement\s+[^>]*Name="BPD"[^>]*Value="([^"]+)"[^>]*>/i, "bpd"],
            [/<BPD>([^<]+)<\/BPD>/i, "bpd"],
            [/<Measurement\s+[^>]*Name="HC"[^>]*Value="([^"]+)"[^>]*>/i, "hc"],
            [/<HC>([^<]+)<\/HC>/i, "hc"],
            [/<Measurement\s+[^>]*Name="AC"[^>]*Value="([^"]+)"[^>]*>/i, "ac"],
            [/<AC>([^<]+)<\/AC>/i, "ac"],
            [/<Measurement\s+[^>]*Name="FL"[^>]*Value="([^"]+)"[^>]*>/i, "fl"],
            [/<FL>([^<]+)<\/FL>/i, "fl"],
            [/<Measurement\s+[^>]*Name="CRL"[^>]*Value="([^"]+)"[^>]*>/i, "crl"],
            [/<CRL>([^<]+)<\/CRL>/i, "crl"],
            [/<Measurement\s+[^>]*Name="FHR"[^>]*Value="([^"]+)"[^>]*>/i, "fhr"],
            [/<FHR>([^<]+)<\/FHR>/i, "fhr"],
            [/<Measurement\s+[^>]*Name="AFI"[^>]*Value="([^"]+)"[^>]*>/i, "liquorAfi"],
            [/<AFI>([^<]+)<\/AFI>/i, "liquorAfi"],
            [/<Measurement\s+[^>]*Name="Endometrium"[^>]*Value="([^"]+)"[^>]*>/i, "endometrium"],
            [/<Endometrium>([^<]+)<\/Endometrium>/i, "endometrium"],
          ];

          for (const [re, key] of MAP) {
            const m = strVal.match(re);
            if (m) {
              mapped[key] = m[1];
              provenance[key] = {
                value: m[1],
                tag: tagKey,
                rawVal: strVal,
                xmlPath: m[0],
                privateCreator: creator,
              };
            }
          }
        } else {
          // Key-value text dump structure (e.g. "BPD=74.2mm\nHC=280mm")
          const lines = strVal.split(/[\r\n]+/);
          for (const line of lines) {
            const parts = line.split("=");
            if (parts.length === 2) {
              const k = parts[0].trim().toLowerCase();
              const v = parts[1].trim();
              const standardKeys: Record<string, string> = {
                bpd: "bpd",
                hc: "hc",
                ac: "ac",
                fl: "fl",
                crl: "crl",
                fhr: "fhr",
                afi: "liquorAfi",
              };
              const mappedKey = standardKeys[k];
              if (mappedKey) {
                mapped[mappedKey] = v;
                provenance[mappedKey] = {
                  value: v,
                  tag: tagKey,
                  rawVal: line,
                  privateCreator: creator,
                };
              }
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return { mapped, provenance };
}

export function parseGePrivateTags(metadataJson: string): Record<string, string> {
  return parseGePrivateTagsWithProvenance(metadataJson).mapped;
}

/**
 * Group Doppler measurements (PSV, EDV, RI, PI) from extracted DICOM SR elements.
 */
export function extractDopplerFromSr(srItems: SrMeasurement[]): DicomDopplerMeasurement[] {
  const dopplers: Record<string, DicomDopplerMeasurement> = {};

  for (const sr of srItems) {
    const name = sr.conceptName.toLowerCase();
    
    const isPsv = /\bpsv\b/i.test(name) || name.includes("peak systolic") || name.includes("11726-7");
    const isEdv = /\bedv\b/i.test(name) || name.includes("end diastolic") || name.includes("11653-3");
    const isRi = /\bri\b/i.test(name) || name.includes("resistive index") || name.includes("12008-9");
    const isPi = /\bpi\b/i.test(name) || name.includes("pulsatility index") || name.includes("12006-3");
    const isSd = /\bs\/d\b/i.test(name) || name.includes("systolic/diastolic") || name.includes("12144-0");

    if (isPsv || isEdv || isRi || isPi || isSd) {
      let vessel = sr.vessel || "unknown";
      let side: "left" | "right" | "bilateral" | "midline" | "unknown" = "unknown";
      
      const sideStr = (sr.side || "").toLowerCase() || name;
      if (sideStr.includes("right") || sideStr.includes("rt")) side = "right";
      else if (sideStr.includes("left") || sideStr.includes("lt")) side = "left";
      
      if (vessel === "unknown") {
        if (name.includes("umbilical")) vessel = "Umbilical Artery";
        else if (name.includes("cerebral") || name.includes("mca")) vessel = "Middle Cerebral Artery";
        else if (name.includes("uterine")) vessel = "Uterine Artery";
        else if (name.includes("renal")) vessel = "Renal Artery";
      }

      const valStr = sr.value + (sr.unit ? ` ${sr.unit}` : "");
      const key = `${vessel}_${side}`.toLowerCase();

      if (!dopplers[key]) {
        dopplers[key] = {
          vesselName: vessel,
          side,
        };
      }

      if (isPsv) dopplers[key].psv = valStr;
      if (isEdv) dopplers[key].edv = valStr;
      if (isRi) dopplers[key].ri = valStr;
      if (isPi) dopplers[key].pi = valStr;
      if (isSd) dopplers[key].sdRatio = valStr;
    }
  }

  return Object.values(dopplers);
}

/**
 * Map raw SR concept names (SNOMED/DICOM codes or labels) to our JSON keys.
 */
function mapSrToJson(srItems: SrMeasurement[]): Partial<UsgMeasurementJson> & Record<string, string> {
  const result: Partial<UsgMeasurementJson> & Record<string, string> = {
    extraMeasurements: {},
    perFieldConfidence: {},
    overallConfidence: srItems.length > 0 ? "high" : "low",
  } as Partial<UsgMeasurementJson> & Record<string, string>;

  // Mapping table: SR concept name patterns → our JSON field keys
  const MAP: [RegExp, keyof UsgMeasurementJson][] = [
    [/bpd|biparietal/i,              "bpd"],
    [/\bhc\b|head circumference/i,   "hc"],
    [/\bac\b|abdominal circum/i,     "ac"],
    [/\bfl\b|femur length/i,         "fl"],
    [/\bcrl\b|crown.rump/i,          "crl"],
    [/efw|estimated fetal weight/i,  "efw"],
    [/\bga\b|gestational age/i,      "ga"],
    [/\bedd\b|due date/i,            "edd"],
    [/\bfhr\b|fetal heart rate/i,    "fhr"],
    [/uterus|uterine/i,              "uterusSize"],
    [/endometr/i,                    "endometrium"],
    [/right ovary|rt ovary/i,        "rightOvary"],
    [/left ovary|lt ovary/i,         "leftOvary"],
    [/liver/i,                       "liverSize"],
    [/spleen/i,                      "spleenSize"],
    [/right kidney|rt kidney/i,      "rightKidney"],
    [/left kidney|lt kidney/i,       "leftKidney"],
    [/\bcbd\b|common bile/i,         "cbd"],
    [/gall.?bladder wall|gb wall/i,  "gbWall"],
    [/prostate/i,                    "prostateVolume"],
    [/placenta/i,                    "placentaPosition"],
    [/\bafi\b|amniotic|liquor/i,     "liquorAfi"],
    [/presentation/i,                "fetalPresentation"],
    [/follicle/i,                    "follicles"],
    [/adnex/i,                       "adnexalLesion"],
  ];

  for (const sr of srItems) {
    const display = sr.value + (sr.unit ? ` ${sr.unit}` : "");
    let matched = false;
    for (const [re, key] of MAP) {
      if (re.test(sr.conceptName)) {
        (result as Record<string, string>)[key as string] = display;
        (result.perFieldConfidence as Record<string, string>)[key as string] = "high";
        matched = true;
        break;
      }
    }
    if (!matched && result.extraMeasurements) {
      (result.extraMeasurements as Record<string, string>)[sr.conceptName] = display;
    }
  }
  return result;
}

// ── WADO frame fetcher ────────────────────────────────────────────────────────

/**
 * Fetch a rendered JPEG/PNG frame from WADO-URI and return it as base64.
 * Returns null if the WADO base URL is not configured or the fetch fails.
 */
async function fetchWadoFrame(
  wadoBaseUrl: string,
  studyInstanceUID: string,
  seriesInstanceUID: string,
  sopInstanceUID: string,
  frameNumber = 1,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const url = `${wadoBaseUrl.replace(/\/$/, "")}?requestType=WADO&studyUID=${studyInstanceUID}&seriesUID=${seriesInstanceUID}&objectUID=${sopInstanceUID}&frameNumber=${frameNumber}&contentType=image/jpeg`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { base64, mimeType: mimeType.split(";")[0].trim() };
  } catch {
    return null;
  }
}

/**
 * Fetch series list + first N SOP Instance UIDs for a study via WADO-RS metadata.
 * Returns an empty array if DICOMweb base URL is not configured.
 */
async function fetchStudyInstances(
  dicomWebBase: string,
  studyInstanceUID: string,
  maxFrames = 3,
): Promise<{ seriesUID: string; sopUID: string }[]> {
  try {
    const base = dicomWebBase.replace(/\/$/, "");
    const seriesUrl = `${base}/studies/${studyInstanceUID}/series`;
    const sRes = await fetch(seriesUrl, {
      headers: { Accept: "application/dicom+json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!sRes.ok) return [];

    const series = (await sRes.json()) as Record<string, { Value?: unknown[] }>[];
    const result: { seriesUID: string; sopUID: string }[] = [];

    for (const s of series) {
      if (result.length >= maxFrames) break;
      const seriesUID = (s["0020000E"]?.Value?.[0] as string) ?? "";
      if (!seriesUID) continue;

      const instanceUrl = `${base}/studies/${studyInstanceUID}/series/${seriesUID}/instances`;
      const iRes = await fetch(instanceUrl, {
        headers: { Accept: "application/dicom+json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!iRes.ok) continue;

      const instances = (await iRes.json()) as Record<string, { Value?: unknown[] }>[];
      for (const inst of instances.slice(0, maxFrames - result.length)) {
        const sopUID = (inst["00080018"]?.Value?.[0] as string) ?? "";
        if (sopUID) result.push({ seriesUID, sopUID });
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ── Main extraction orchestrator ──────────────────────────────────────────────

export async function runUsgExtraction(input: UsgExtractionInput): Promise<UsgExtractionResult> {
  const startMs = Date.now();
  const { studyInstanceUID, accessionNumber, worklistId, studyId, patientId, dicomMetadataJson } = input;

  // Create extraction log row (pending)
  const [logRow] = await db
    .insert(usgExtractionLogsTable)
    .values({
      worklistId: worklistId ?? null,
      studyInstanceUID,
      accessionNumber: accessionNumber ?? null,
      extractionType: "combined",
      status: "running",
      triggeredBy: input.triggeredBy ?? "auto",
      triggeredByUserId: input.triggeredByUserId ?? null,
    })
    .returning();

  const logId = logRow.id;

  try {
    const settings = await getUsgAdminSettings();

    // ── Step 1: DICOM metadata fields ────────────────────────────────────────
    const meta = dicomMetadataJson ? extractDicomMetadata(dicomMetadataJson) : {};

    // ── Step 2: DICOM SR parse ───────────────────────────────────────────────
    let srMeasurements: SrMeasurement[] = [];
    let srJson: string | undefined;
    if (dicomMetadataJson) {
      srMeasurements = parseDicomSr(dicomMetadataJson);
      if (srMeasurements.length > 0) {
        srJson = JSON.stringify(srMeasurements);
        logger.info({ logId, srCount: srMeasurements.length }, "USG: DICOM SR measurements found");
      }
    }

    const srMapped = mapSrToJson(srMeasurements);
    const srFound = srMeasurements.length > 0;

    // ── Step 2.5: GE Private Tags parse ──────────────────────────────────────
    const gePrivateResult = dicomMetadataJson ? parseGePrivateTagsWithProvenance(dicomMetadataJson) : { mapped: {}, provenance: {} };
    const gePrivateMapped = gePrivateResult.mapped;
    const gePrivateFound = Object.keys(gePrivateMapped).length > 0;

    // ── Step 3: Gemini Vision OCR (if enabled and no high-fidelity source found)
    let ocrResult: UsgMeasurementJson | null = null;
    let framesProcessed = 0;
    let framesFailed = 0;
    let rawOcrTexts: string[] = [];
    const provenanceMap: Record<string, any> = {};

    let mainSopUid = "";
    let mainSeriesUid = "";
    let srSopUid = "";
    let srSeriesUid = "";

    try {
      if (dicomMetadataJson) {
        const rootObj = JSON.parse(dicomMetadataJson);
        mainSopUid = rootObj["00080018"]?.Value?.[0] || "";
        mainSeriesUid = rootObj["0008000E"]?.Value?.[0] || "";
        srSopUid = mainSopUid;
        srSeriesUid = mainSeriesUid;
      }
    } catch {}

    const skipOcr = srFound || gePrivateFound;

    if (settings.ocrEnabled && !skipOcr) {
      // Get WADO base URLs from pacs_settings
      const pacsRows = await db
        .select()
        .from(pacsSettingsTable)
        .where(eq(pacsSettingsTable.category, "viewer"));
      const pacsMap = new Map(pacsRows.map((r) => [r.key, r.value ?? ""]));
      const wadoBase    = pacsMap.get("wado_uri_base_url") || pacsMap.get("wado_base_url") || "";
      const dicomWebBase = pacsMap.get("dicom_web_base_url") || "";

      if (wadoBase && dicomWebBase) {
        const instances = await fetchStudyInstances(dicomWebBase, studyInstanceUID, settings.maxFramesToOcr);
        logger.info({ logId, instanceCount: instances.length }, "USG: fetching WADO frames for OCR");

        for (const inst of instances) {
          try {
            const frame = await fetchWadoFrame(wadoBase, studyInstanceUID, inst.seriesUID, inst.sopUID);
            if (!frame) { framesFailed++; continue; }
            const ocr = await geminiUsgOcr(frame.base64, frame.mimeType);
            framesProcessed++;
            if (ocr.rawText) rawOcrTexts.push(ocr.rawText);
            
            // Record provenance for fields extracted in this frame!
            for (const [k, v] of Object.entries(ocr)) {
              if (k === "extraMeasurements" || k === "perFieldConfidence" || k === "rawText") continue;
              if (v && typeof v === "string" && (!ocrResult || !ocrResult[k as keyof UsgMeasurementJson])) {
                provenanceMap[k] = {
                  studyInstanceUID,
                  seriesInstanceUID: inst.seriesUID,
                  sopInstanceUID: inst.sopUID,
                  frameNumber: 1,
                  sourceType: "OCR",
                  sourceLabel: k.toUpperCase(),
                  sourceConfidence: ocr.perFieldConfidence?.[k] || "medium",
                  sourcePath: "Frame 1",
                  rawExtractedValue: v,
                  normalizedValue: v,
                  unit: k === "fhr" ? "bpm" : "mm",
                  extractedAt: new Date().toISOString(),
                  extractedByEngineVersion: "1.5.0"
                };
              }
            }

            if (!ocrResult) {
              ocrResult = ocr;
            } else {
              // Merge: take first non-empty value per field
              for (const k of Object.keys(ocrResult) as (keyof UsgMeasurementJson)[]) {
                if (k === "extraMeasurements" || k === "perFieldConfidence" || k === "rawText") continue;
                if (!(ocrResult[k] as string) && (ocr[k] as string)) {
                  (ocrResult[k] as string) = ocr[k] as string;
                  if (ocr.perFieldConfidence[k as string]) {
                    ocrResult.perFieldConfidence[k as string] = ocr.perFieldConfidence[k as string];
                  }

                  // Also record provenance here because this frame is supplying the value!
                  provenanceMap[k as string] = {
                    studyInstanceUID,
                    seriesInstanceUID: inst.seriesUID,
                    sopInstanceUID: inst.sopUID,
                    frameNumber: 1,
                    sourceType: "OCR",
                    sourceLabel: (k as string).toUpperCase(),
                    sourceConfidence: ocr.perFieldConfidence?.[k as string] || "medium",
                    sourcePath: "Frame 1",
                    rawExtractedValue: ocr[k as keyof UsgMeasurementJson],
                    normalizedValue: ocr[k as keyof UsgMeasurementJson],
                    unit: k === "fhr" ? "bpm" : "mm",
                    extractedAt: new Date().toISOString(),
                    extractedByEngineVersion: "1.5.0"
                  };
                }
              }
              // Merge extra measurements
              Object.assign(ocrResult.extraMeasurements, ocr.extraMeasurements);
            }
          } catch (err) {
            framesFailed++;
            logger.warn({ err, logId }, "USG OCR frame failed");
          }
        }
      } else {
        logger.info({ logId }, "USG: WADO/DICOMweb URLs not configured — skipping image OCR");
      }
    }

    // ── Step 4: AI normalization fallback ────────────────────────────────────
    // If OCR failed entirely but we have SR text or metadata, normalize via Gemini
    let aiNormalized = false;
    if (!ocrResult && settings.aiNormalizeEnabled && srMeasurements.length === 0 && !gePrivateFound) {
      const rawText = [
        meta.studyDescription ?? "",
        meta.manufacturer ?? "",
        dicomMetadataJson?.slice(0, 2000) ?? "",
      ].join("\n");
      if (rawText.trim()) {
        ocrResult = await geminiNormalizeMeasurements(rawText);
        aiNormalized = true;
      }
    }

    // ── Step 5: Merge all sources ────────────────────────────────────────────
    // Priority: DICOM SR (high) > GE Private Tags (high) > OCR (medium/low)
    const merged: Partial<UsgMeasurementJson> = { ...ocrResult };
    const perField: Record<string, string> = { ...(ocrResult?.perFieldConfidence ?? {}) };

    const MAP: [RegExp, keyof UsgMeasurementJson][] = [
      [/bpd|biparietal/i,              "bpd"],
      [/\bhc\b|head circumference/i,   "hc"],
      [/\bac\b|abdominal circum/i,     "ac"],
      [/\bfl\b|femur length/i,         "fl"],
      [/\bcrl\b|crown.rump/i,          "crl"],
      [/efw|estimated fetal weight/i,  "efw"],
      [/\bga\b|gestational age/i,      "ga"],
      [/\bedd\b|due date/i,            "edd"],
      [/\bfhr\b|fetal heart rate/i,    "fhr"],
      [/uterus|uterine/i,              "uterusSize"],
      [/endometr/i,                    "endometrium"],
      [/right ovary|rt ovary/i,        "rightOvary"],
      [/left ovary|lt ovary/i,         "leftOvary"],
      [/liver/i,                       "liverSize"],
      [/spleen/i,                      "spleenSize"],
      [/right kidney|rt kidney/i,      "rightKidney"],
      [/left kidney|lt kidney/i,       "leftKidney"],
      [/\bcbd\b|common bile/i,         "cbd"],
      [/gall.?bladder wall|gb wall/i,  "gbWall"],
      [/prostate/i,                    "prostateVolume"],
      [/placenta/i,                    "placentaPosition"],
      [/\bafi\b|amniotic|liquor/i,     "liquorAfi"],
      [/presentation/i,                "fetalPresentation"],
      [/follicle/i,                    "follicles"],
      [/adnex/i,                       "adnexalLesion"],
    ];

    // GE Private values override OCR
    for (const [k, v] of Object.entries(gePrivateMapped)) {
      if (v && typeof v === "string") {
        (merged as Record<string, string>)[k] = v;
        perField[k] = "high";

        const prov = gePrivateResult.provenance[k];
        provenanceMap[k] = {
          studyInstanceUID,
          seriesInstanceUID: mainSeriesUid || undefined,
          sopInstanceUID: mainSopUid || undefined,
          frameNumber: 1,
          sourceType: "GE_PRIVATE_TAG",
          sourceLabel: k.toUpperCase(),
          sourceConfidence: "high",
          sourcePath: prov ? `${prov.tag} - creator: ${prov.privateCreator || "GE_USG"}` : "GE Private Tag",
          rawExtractedValue: prov ? prov.rawVal : v,
          normalizedValue: v,
          unit: prov?.xmlPath ? (prov.xmlPath.match(/Unit="([^"]+)"/) || [])[1] : undefined,
          extractedAt: new Date().toISOString(),
          extractedByEngineVersion: "1.5.0"
        };
      }
    }

    // SR values override GE Private & OCR
    for (const [k, v] of Object.entries(srMapped)) {
      if (k === "extraMeasurements" || k === "perFieldConfidence" || k === "overallConfidence") continue;
      if (v && typeof v === "string") {
        (merged as Record<string, string>)[k] = v;
        perField[k] = "high";

        const srItem = srMeasurements.find(sr => {
          for (const [re, key] of MAP) {
            if (key === k && re.test(sr.conceptName)) return true;
          }
          return false;
        });

        provenanceMap[k] = {
          studyInstanceUID,
          seriesInstanceUID: srItem?.seriesInstanceUID || srSeriesUid || undefined,
          sopInstanceUID: srItem?.sopInstanceUID || srSopUid || undefined,
          frameNumber: 1,
          sourceType: "DICOM_SR",
          sourceLabel: k.toUpperCase(),
          sourceConfidence: "high",
          sourcePath: srItem?.path || "ContentSequence",
          rawExtractedValue: srItem?.value || v,
          normalizedValue: v,
          unit: srItem?.unit || undefined,
          extractedAt: new Date().toISOString(),
          extractedByEngineVersion: "1.5.0"
        };
      }
    }

    if (srMapped.extraMeasurements) {
      merged.extraMeasurements = { ...(ocrResult?.extraMeasurements ?? {}), ...srMapped.extraMeasurements };
    }

    const source: UsgExtractionResult["source"] =
      (srFound || gePrivateFound) && framesProcessed > 0 ? "combined" :
      srFound ? "dicom_sr" :
      gePrivateFound ? "dicom_sr" :
      framesProcessed > 0 ? "ocr" : "manual";

    const overallConfidence: "high" | "medium" | "low" =
      srFound || gePrivateFound ? "high" :
      framesProcessed > 0 ? "medium" : "low";

    // ── Step 6: Persist measurements ─────────────────────────────────────────
    const [measRow] = await db
      .insert(usgMeasurementsTable)
      .values({
        worklistId: worklistId ?? null,
        studyId: studyId ?? null,
        studyInstanceUID,
        accessionNumber: accessionNumber ?? null,
        patientId: patientId ?? null,
        extractionRunId: logId,
        source,
        overallConfidence,
        bpd:           (merged as Record<string, string>).bpd          ?? null,  bpdConfidence:  perField.bpd          ?? null,
        hc:            (merged as Record<string, string>).hc           ?? null,  hcConfidence:   perField.hc           ?? null,
        ac:            (merged as Record<string, string>).ac           ?? null,  acConfidence:   perField.ac           ?? null,
        fl:            (merged as Record<string, string>).fl           ?? null,  flConfidence:   perField.fl           ?? null,
        crl:           (merged as Record<string, string>).crl          ?? null,  crlConfidence:  perField.crl          ?? null,
        efw:           (merged as Record<string, string>).efw          ?? null,  efwConfidence:  perField.efw          ?? null,
        ga:            (merged as Record<string, string>).ga           ?? null,  gaConfidence:   perField.ga           ?? null,
        edd:           (merged as Record<string, string>).edd          ?? null,  eddConfidence:  perField.edd          ?? null,
        fhr:           (merged as Record<string, string>).fhr          ?? null,  fhrConfidence:  perField.fhr          ?? null,
        placentaPosition:   (merged as Record<string, string>).placentaPosition   ?? null,
        liquorAfi:          (merged as Record<string, string>).liquorAfi           ?? null,
        fetalPresentation:  (merged as Record<string, string>).fetalPresentation   ?? null,
        uterusSize:         (merged as Record<string, string>).uterusSize          ?? null,  uterusSizeConfidence:  perField.uterusSize   ?? null,
        endometrium:        (merged as Record<string, string>).endometrium         ?? null,  endometriumConfidence: perField.endometrium   ?? null,
        rightOvary:         (merged as Record<string, string>).rightOvary          ?? null,  rightOvaryConfidence:  perField.rightOvary    ?? null,
        leftOvary:          (merged as Record<string, string>).leftOvary           ?? null,  leftOvaryConfidence:   perField.leftOvary     ?? null,
        follicles:          (merged as Record<string, string>).follicles            ?? null,
        adnexalLesion:      (merged as Record<string, string>).adnexalLesion       ?? null,
        liverSize:          (merged as Record<string, string>).liverSize            ?? null,  liverSizeConfidence:   perField.liverSize     ?? null,
        spleenSize:         (merged as Record<string, string>).spleenSize           ?? null,  spleenSizeConfidence:  perField.spleenSize    ?? null,
        rightKidney:        (merged as Record<string, string>).rightKidney          ?? null,  rightKidneyConfidence: perField.rightKidney   ?? null,
        leftKidney:         (merged as Record<string, string>).leftKidney           ?? null,  leftKidneyConfidence:  perField.leftKidney    ?? null,
        cbd:                (merged as Record<string, string>).cbd                  ?? null,  cbdConfidence:         perField.cbd           ?? null,
        gbWall:             (merged as Record<string, string>).gbWall               ?? null,  gbWallConfidence:      perField.gbWall        ?? null,
        prostateVolume:     (merged as Record<string, string>).prostateVolume       ?? null,  prostateVolumeConfidence: perField.prostateVolume ?? null,
        extraMeasurementsJson: JSON.stringify(merged.extraMeasurements ?? {}),
        manufacturer:        meta.manufacturer       ?? null,
        manufacturerModel:   meta.manufacturerModel  ?? null,
        institutionName:     meta.institutionName    ?? null,
        studyDescription:    meta.studyDescription   ?? null,
        studyDate:           meta.studyDate          ?? null,
        status: "pending_review",
        provenanceJson:      JSON.stringify(provenanceMap),
        engineVersion:       "1.5.0",
      })
      .returning();

    // ── Step 6.5: Persist Doppler measurements if found ──────────────────────
    const dopplerItems = extractDopplerFromSr(srMeasurements);
    for (const dop of dopplerItems) {
      const dopProv: Record<string, any> = {};
      const fields: ("psv" | "edv" | "ri" | "pi" | "sdRatio")[] = ["psv", "edv", "ri", "pi", "sdRatio"];
      let waveformSopInstanceUid = "";
      let waveformFrameNumber: number | null = null;

      for (const field of fields) {
        if (dop[field]) {
          const matchedSr = srMeasurements.find(sr => {
            const name = sr.conceptName.toLowerCase();
            const isFld = 
              field === "psv" ? (/\bpsv\b/i.test(name) || name.includes("peak systolic")) :
              field === "edv" ? (/\bedv\b/i.test(name) || name.includes("end diastolic")) :
              field === "ri" ? (/\bri\b/i.test(name) || name.includes("resistive index")) :
              field === "pi" ? (/\bpi\b/i.test(name) || name.includes("pulsatility index")) :
              (/\bs\/d\b/i.test(name) || name.includes("systolic/diastolic"));
            return isFld && (sr.vessel || "unknown") === dop.vesselName && (sr.side || "unknown") === dop.side;
          });

          if (matchedSr) {
            waveformSopInstanceUid = matchedSr.sopInstanceUID || "";
            dopProv[field] = {
              studyInstanceUID,
              seriesInstanceUID: matchedSr.seriesInstanceUID || undefined,
              sopInstanceUID: matchedSr.sopInstanceUID || undefined,
              frameNumber: 1,
              sourceType: "DICOM_SR",
              sourceLabel: `${dop.vesselName} ${field.toUpperCase()}`,
              sourceConfidence: "high",
              sourcePath: matchedSr.path,
              rawExtractedValue: matchedSr.value,
              normalizedValue: matchedSr.value,
              unit: matchedSr.unit,
              extractedAt: new Date().toISOString(),
              extractedByEngineVersion: "1.5.0",
              vesselName: dop.vesselName,
              laterality: dop.side
            };
          }
        }
      }

      await db.insert(usgDopplerMeasurementsTable).values({
        worklistId: worklistId ?? null,
        studyInstanceUID,
        accessionNumber: accessionNumber ?? null,
        patientId: patientId ?? null,
        extractionRunId: logId,
        vesselName: dop.vesselName,
        side: dop.side,
        psv: dop.psv ?? null,
        edv: dop.edv ?? null,
        ri: dop.ri ?? null,
        pi: dop.pi ?? null,
        sdRatio: dop.sdRatio ?? null,
        confidence: "high",
        source: "dicom_sr",
        status: "pending_review",
        waveformSopInstanceUid: waveformSopInstanceUid || null,
        waveformFrameNumber: waveformFrameNumber,
        provenanceJson: JSON.stringify(dopProv),
        engineVersion: "1.5.0",
      });
    }

    // ── Step 7: Mark log as completed ────────────────────────────────────────
    const durationMs = Date.now() - startMs;
    await db
      .update(usgExtractionLogsTable)
      .set({
        status: "completed",
        framesProcessed,
        framesFailed,
        srFound,
        aiNormalized,
        durationMs,
        rawOcrTextJson: rawOcrTexts.length > 0 ? JSON.stringify(rawOcrTexts) : null,
        rawSrJson: srJson ?? null,
        provenanceJson: JSON.stringify(provenanceMap),
        completedAt: new Date(),
      })
      .where(eq(usgExtractionLogsTable.id, logId));

    logger.info(
      { logId, measId: measRow.id, source, overallConfidence, durationMs },
      "USG extraction completed",
    );

    return {
      measurementId: measRow.id,
      logId,
      status: "completed",
      source,
      overallConfidence,
      measurements: merged,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, logId }, "USG extraction failed");

    await db
      .update(usgExtractionLogsTable)
      .set({
        status: "failed",
        errorMessage: msg,
        durationMs: Date.now() - startMs,
        completedAt: new Date(),
      })
      .where(eq(usgExtractionLogsTable.id, logId));

    return { measurementId: 0, logId, status: "failed", source: "manual", overallConfidence: "low", measurements: {}, error: msg };
  }
}
