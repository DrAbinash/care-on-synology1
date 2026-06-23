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

    // Recursive walker over ContentSequence items
    function walk(node: Record<string, unknown>): void {
      const cs = node["0040A730"] as { Value?: unknown[] } | undefined;
      const items = cs?.Value ?? [];
      for (const item of items) {
        const seq = item as Record<string, unknown>;
        const valueType = (seq["0040A040"] as { Value?: string[] })?.Value?.[0] ?? "";
        if (valueType === "NUM") {
          const conceptName = extractConceptName(seq);
          const { value, unit } = extractMeasuredValue(seq);
          if (conceptName && value) {
            measurements.push({ conceptName, value, unit, confidence: "high" });
          }
        }
        // Recurse
        walk(seq);
      }
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

    // ── Step 3: Gemini Vision OCR (if enabled and no perfect SR) ────────────
    let ocrResult: UsgMeasurementJson | null = null;
    let framesProcessed = 0;
    let framesFailed = 0;
    let rawOcrTexts: string[] = [];

    if (settings.ocrEnabled) {
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
    if (!ocrResult && settings.aiNormalizeEnabled && srMeasurements.length === 0) {
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
    // Priority: DICOM SR (high) > OCR (medium/low)
    const merged: Partial<UsgMeasurementJson> = { ...ocrResult };
    const perField: Record<string, string> = { ...(ocrResult?.perFieldConfidence ?? {}) };

    // SR values override OCR
    for (const [k, v] of Object.entries(srMapped)) {
      if (k === "extraMeasurements" || k === "perFieldConfidence" || k === "overallConfidence") continue;
      if (v && typeof v === "string") {
        (merged as Record<string, string>)[k] = v;
        perField[k] = "high";
      }
    }
    if (srMapped.extraMeasurements) {
      merged.extraMeasurements = { ...(ocrResult?.extraMeasurements ?? {}), ...srMapped.extraMeasurements };
    }

    const source: UsgExtractionResult["source"] =
      srFound && framesProcessed > 0 ? "combined" :
      srFound ? "dicom_sr" :
      framesProcessed > 0 ? "ocr" : "manual";

    // Overall confidence: high if SR found, medium if OCR processed frames, low otherwise
    const overallConfidence: "high" | "medium" | "low" =
      srFound ? "high" :
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
      })
      .returning();

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
