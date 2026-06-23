/**
 * Radiology Report Generator API
 *
 * Provides template library, voice-text cleanup, HTML report generation,
 * draft save/restore, key image upload, and final report save integration.
 *
 * All endpoints require a valid staff session — mounted with requireStaffAuth
 * + requireStaffPermission("/orders") in routes/index.ts.
 *
 * Endpoints (relative to /api/radiology/report-generator):
 *   GET  /templates
 *   POST /voice-cleanup
 *   POST /generate
 *   POST /save-draft
 *   GET  /drafts
 *   GET  /drafts/:id
 *   POST /key-images           (multipart/form-data)
 *   GET  /key-images
 *   PUT  /key-images/:id
 *   DELETE /key-images/:id
 */

import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  radiologyReportDraftsTable,
  radiologyVoiceLogsTable,
  radiologyReportKeyImagesTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientsTable,
  radiologyTextMacrosTable,
  radiologyReportPreferencesTable,
  radiologyImageReferencesTable,
  radiologyNormalSnippetsTable,
  radiologistStylePreferencesTable,
  radiologyReportLifecycleLogTable,
  clinicSettingsTable,
  spinalMeasurementsTable,
  radiologySmartMacrosTable,
} from "@workspace/db/schema";
import { eq, and, desc, isNull, asc, ilike, or } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

// ── Upload directory ──────────────────────────────────────────────────────────

const ARTIFACT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY_IMAGE_DIR = path.resolve(ARTIFACT_ROOT, "data", "uploads", "radiology-key-images");

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.mkdir(KEY_IMAGE_DIR, { recursive: true });
        cb(null, KEY_IMAGE_DIR);
      } catch (e) {
        cb(e as Error, KEY_IMAGE_DIR);
      }
    },
    filename: (_req, file, cb) => {
      const ext = MIME_TO_EXT[file.mimetype] ?? ".jpg";
      cb(null, `rkg-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, and WebP images are accepted"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Template library ──────────────────────────────────────────────────────────

export interface ReportTemplate {
  templateId: string;
  modality: string;
  studyName: string;
  technique: string;
  sections: string[];
}

export const RADIOLOGY_TEMPLATES: Record<string, ReportTemplate> = {
  MRI_BRAIN_PLAIN: {
    templateId: "MRI_BRAIN_PLAIN",
    modality: "MRI",
    studyName: "MRI BRAIN PLAIN",
    technique:
      "MRI of brain has been performed on 3 Tesla MRI scanner with multi-sequence, multi-planar acquisition using standard T1, T2, FLAIR, DWI, ADC and SWI sequences studied in axial, sagittal and coronal planes.",
    sections: [
      "BRAIN PARENCHYMA",
      "WHITE MATTER",
      "VENTRICULAR SYSTEM / CSF SPACES",
      "POSTERIOR FOSSA",
      "MIDLINE STRUCTURES",
      "SELLAR / PARASELLAR REGION",
      "ORBITS / PNS / MASTOIDS",
      "VASCULAR FLOW VOIDS",
    ],
  },
  MRI_BRAIN_CONTRAST: {
    templateId: "MRI_BRAIN_CONTRAST",
    modality: "MRI",
    studyName: "MRI BRAIN WITH CONTRAST",
    technique:
      "MRI of brain has been performed on 3 Tesla MRI scanner with multi-sequence, multi-planar acquisition using standard T1, T2, FLAIR, DWI, ADC and SWI sequences followed by post-gadolinium T1W sequences in axial, sagittal and coronal planes.",
    sections: [
      "BRAIN PARENCHYMA",
      "WHITE MATTER",
      "VENTRICULAR SYSTEM / CSF SPACES",
      "POST-CONTRAST ENHANCEMENT",
      "POSTERIOR FOSSA",
      "MIDLINE STRUCTURES",
      "SELLAR / PARASELLAR REGION",
      "ORBITS / PNS / MASTOIDS",
    ],
  },
  MRI_STROKE_PROTOCOL: {
    templateId: "MRI_STROKE_PROTOCOL",
    modality: "MRI",
    studyName: "MRI BRAIN STROKE PROTOCOL",
    technique:
      "MRI brain stroke protocol performed on 3 Tesla MRI scanner using DWI, ADC, FLAIR, T2, T1, MRA (TOF) and SWI sequences in multiple planes.",
    sections: [
      "DWI / ADC",
      "FLAIR / T2",
      "SWI / SUSCEPTIBILITY",
      "MRA FINDINGS",
      "POSTERIOR FOSSA",
      "EXTRA-AXIAL SPACES",
      "MIDLINE STRUCTURES",
    ],
  },
  MRI_LS_SPINE: {
    templateId: "MRI_LS_SPINE",
    modality: "MRI",
    studyName: "MRI LUMBOSACRAL SPINE",
    technique:
      "MRI of lumbosacral spine has been performed on 3 Tesla MRI scanner with multi-sequence, multi-planar acquisition using standard T1, T2 and STIR sequences in sagittal and axial planes.",
    sections: [
      "ALIGNMENT & CURVATURE",
      "VERTEBRAL BODIES",
      "INTERVERTEBRAL DISCS",
      "SPINAL CANAL & CORD",
      "NEURAL FORAMINA",
      "CONUS / CAUDA EQUINA",
      "PARASPINAL SOFT TISSUES",
      "SACROILIAC JOINTS",
    ],
  },
  MRI_CERVICAL_SPINE: {
    templateId: "MRI_CERVICAL_SPINE",
    modality: "MRI",
    studyName: "MRI CERVICAL SPINE",
    technique:
      "MRI of cervical spine has been performed on 3 Tesla MRI scanner with multi-sequence, multi-planar acquisition using standard T1, T2 and STIR sequences in sagittal and axial planes.",
    sections: [
      "ALIGNMENT & CURVATURE",
      "VERTEBRAL BODIES",
      "INTERVERTEBRAL DISCS",
      "SPINAL CANAL & CORD",
      "NEURAL FORAMINA",
      "PARASPINAL SOFT TISSUES",
      "CRANIOCERVICAL JUNCTION",
    ],
  },
  MRI_DORSAL_SPINE: {
    templateId: "MRI_DORSAL_SPINE",
    modality: "MRI",
    studyName: "MRI DORSAL SPINE",
    technique:
      "MRI of dorsal spine has been performed on 3 Tesla MRI scanner with multi-sequence, multi-planar acquisition using standard T1, T2 and STIR sequences in sagittal and axial planes.",
    sections: [
      "ALIGNMENT & CURVATURE",
      "VERTEBRAL BODIES",
      "INTERVERTEBRAL DISCS",
      "SPINAL CANAL & CORD",
      "NEURAL FORAMINA",
      "PARASPINAL SOFT TISSUES",
    ],
  },
  MRI_WHOLE_SPINE: {
    templateId: "MRI_WHOLE_SPINE",
    modality: "MRI",
    studyName: "MRI WHOLE SPINE SCREENING",
    technique:
      "Whole spine MRI screening performed on 3 Tesla MRI scanner with standard T1 and T2 sequences in sagittal plane covering cervical, dorsal and lumbosacral spine.",
    sections: [
      "CERVICAL SPINE",
      "DORSAL SPINE",
      "LUMBOSACRAL SPINE",
      "SPINAL CORD",
      "ALIGNMENT OVERVIEW",
    ],
  },
  MRI_KNEE: {
    templateId: "MRI_KNEE",
    modality: "MRI",
    studyName: "MRI KNEE",
    technique:
      "MRI of knee has been performed on 3 Tesla MRI scanner with multi-sequence, multi-planar acquisition using standard T1, T2, PD, PD-FAT-SAT sequences in axial, sagittal and coronal planes.",
    sections: [
      "MEDIAL MENISCUS",
      "LATERAL MENISCUS",
      "ANTERIOR CRUCIATE LIGAMENT",
      "POSTERIOR CRUCIATE LIGAMENT",
      "MEDIAL COLLATERAL LIGAMENT",
      "LATERAL COLLATERAL LIGAMENT",
      "ARTICULAR CARTILAGE",
      "JOINT SPACE / EFFUSION",
      "BONES",
      "PATELLAR / EXTENSOR MECHANISM",
    ],
  },
  CT_BRAIN: {
    templateId: "CT_BRAIN",
    modality: "CT",
    studyName: "CT BRAIN",
    technique:
      "Non-contrast CT brain has been performed with axial sections (5 mm) and multiplanar reconstruction.",
    sections: [
      "CEREBRAL PARENCHYMA",
      "VENTRICULAR SYSTEM",
      "EXTRA-AXIAL SPACES",
      "POSTERIOR FOSSA",
      "MIDLINE STRUCTURES",
      "BONES / SCALP",
    ],
  },
  CT_BRAIN_TRAUMA: {
    templateId: "CT_BRAIN_TRAUMA",
    modality: "CT",
    studyName: "CT BRAIN TRAUMA",
    technique:
      "Non-contrast CT brain with bone and soft tissue algorithms has been performed with axial sections and multiplanar reconstruction for trauma evaluation.",
    sections: [
      "SCALP / SOFT TISSUE",
      "SKULL BONES",
      "EXTRA-AXIAL COLLECTIONS",
      "CEREBRAL PARENCHYMA",
      "VENTRICULAR SYSTEM",
      "POSTERIOR FOSSA",
      "MIDLINE SHIFT",
    ],
  },
  CT_CHEST: {
    templateId: "CT_CHEST",
    modality: "CT",
    studyName: "CT CHEST",
    technique:
      "CT chest has been performed with axial sections and multiplanar reconstruction in lung and mediastinal windows.",
    sections: [
      "LUNG PARENCHYMA",
      "BRONCHI / AIRWAYS",
      "PLEURA",
      "MEDIASTINUM",
      "CARDIAC SILHOUETTE",
      "CHEST WALL / RIBS",
      "UPPER ABDOMEN (imaged portion)",
    ],
  },
  HRCT_THORAX: {
    templateId: "HRCT_THORAX",
    modality: "CT",
    studyName: "HRCT THORAX",
    technique:
      "High-resolution CT thorax has been performed using thin sections (1 mm) in inspiration and expiration phases with multiplanar reconstruction in lung and mediastinal windows.",
    sections: [
      "LUNG PARENCHYMA — UPPER LOBES",
      "LUNG PARENCHYMA — MIDDLE / LINGULA",
      "LUNG PARENCHYMA — LOWER LOBES",
      "SECONDARY PULMONARY LOBULE PATTERN",
      "AIRSPACE DISEASE",
      "PLEURA",
      "MEDIASTINUM / LYMPH NODES",
      "CHEST WALL",
    ],
  },
  CT_ABDOMEN_PELVIS: {
    templateId: "CT_ABDOMEN_PELVIS",
    modality: "CT",
    studyName: "CT ABDOMEN AND PELVIS",
    technique:
      "CECT abdomen and pelvis performed in portovenous phase with oral and IV contrast; axial sections with coronal and sagittal reconstructions.",
    sections: [
      "LIVER",
      "GALL BLADDER / BILE DUCTS",
      "PANCREAS",
      "SPLEEN",
      "ADRENAL GLANDS",
      "KIDNEYS",
      "URINARY BLADDER",
      "BOWEL / MESENTERY",
      "LYMPH NODES",
      "PERITONEUM / ASCITES",
      "PELVIS (if included)",
      "BONES (imaged portion)",
    ],
  },
  CT_KUB: {
    templateId: "CT_KUB",
    modality: "CT",
    studyName: "CT KUB (NCCT)",
    technique:
      "Non-contrast CT of kidneys, ureters, and urinary bladder performed in supine position with axial sections and multiplanar reconstruction.",
    sections: [
      "RIGHT KIDNEY",
      "LEFT KIDNEY",
      "RIGHT URETER",
      "LEFT URETER",
      "URINARY BLADDER",
      "SURROUNDING STRUCTURES",
    ],
  },
  CT_NECK: {
    templateId: "CT_NECK",
    modality: "CT",
    studyName: "CT NECK",
    technique:
      "CECT neck performed with IV contrast in axial sections and multiplanar reconstruction.",
    sections: [
      "NECK SOFT TISSUES",
      "LYMPH NODES",
      "THYROID GLAND",
      "LARYNX / HYPOPHARYNX",
      "VESSELS",
      "BONES",
    ],
  },
  USG_ABDOMEN: {
    templateId: "USG_ABDOMEN",
    modality: "USG",
    studyName: "ULTRASOUND WHOLE ABDOMEN",
    technique:
      "Ultrasound examination of the whole abdomen performed using curvilinear probe (3.5–5 MHz) in B-mode.",
    sections: [
      "LIVER",
      "GALL BLADDER / CBD",
      "PANCREAS",
      "SPLEEN",
      "KIDNEYS",
      "URINARY BLADDER",
      "PROSTATE (if applicable)",
      "FREE FLUID / ASCITES",
    ],
  },
  USG_KUB: {
    templateId: "USG_KUB",
    modality: "USG",
    studyName: "ULTRASOUND KUB",
    technique:
      "Ultrasound examination of kidneys, urinary bladder, and prostate performed using curvilinear probe.",
    sections: [
      "RIGHT KIDNEY",
      "LEFT KIDNEY",
      "URINARY BLADDER",
      "PROSTATE / UTERUS",
      "PERINEPHRIC REGION",
    ],
  },
  USG_PELVIS: {
    templateId: "USG_PELVIS",
    modality: "USG",
    studyName: "ULTRASOUND PELVIS",
    technique:
      "Transabdominal pelvic ultrasound performed using curvilinear probe with adequate bladder distension.",
    sections: [
      "UTERUS",
      "ENDOMETRIUM",
      "OVARIES",
      "ADNEXA",
      "POUCH OF DOUGLAS",
      "URINARY BLADDER",
    ],
  },
  USG_OBSTETRIC: {
    templateId: "USG_OBSTETRIC",
    modality: "USG",
    studyName: "OBSTETRIC ULTRASOUND",
    technique:
      "Transabdominal obstetric ultrasound performed using curvilinear probe.",
    sections: [
      "FETAL BIOMETRY",
      "FETAL CARDIAC ACTIVITY",
      "FETAL POSITION / PRESENTATION",
      "PLACENTA",
      "AMNIOTIC FLUID",
      "CERVIX",
      "FETAL ANATOMY SURVEY",
    ],
  },
  USG_SCROTUM: {
    templateId: "USG_SCROTUM",
    modality: "USG",
    studyName: "ULTRASOUND SCROTUM",
    technique:
      "High-frequency ultrasound of the scrotum performed using linear probe (7–15 MHz) in B-mode with color Doppler.",
    sections: [
      "RIGHT TESTIS / EPIDIDYMIS",
      "LEFT TESTIS / EPIDIDYMIS",
      "VASCULARITY (Doppler)",
      "SCROTAL SAC / HYDROCELE",
    ],
  },
  USG_NECK_THYROID: {
    templateId: "USG_NECK_THYROID",
    modality: "USG",
    studyName: "ULTRASOUND NECK / THYROID",
    technique:
      "High-frequency ultrasound of the neck and thyroid performed using linear probe (7–15 MHz) in B-mode with color Doppler.",
    sections: [
      "RIGHT LOBE OF THYROID",
      "LEFT LOBE OF THYROID",
      "ISTHMUS",
      "PARATHYROID REGION",
      "CERVICAL LYMPH NODES",
      "VASCULARITY",
    ],
  },
  DOPPLER_LOWER_LIMB: {
    templateId: "DOPPLER_LOWER_LIMB",
    modality: "USG",
    studyName: "DOPPLER LOWER LIMB",
    technique:
      "Color duplex Doppler study of the bilateral lower limb arteries/veins performed using linear and curvilinear probes.",
    sections: [
      "RIGHT LOWER LIMB",
      "LEFT LOWER LIMB",
      "DEEP VENOUS SYSTEM",
      "SUPERFICIAL VENOUS SYSTEM",
      "ARTERIAL FLOW",
      "COMPRESSIBILITY / AUGMENTATION",
    ],
  },
  XRAY_CHEST_PA: {
    templateId: "XRAY_CHEST_PA",
    modality: "X-RAY",
    studyName: "X-RAY CHEST PA VIEW",
    technique:
      "Digital radiograph of the chest has been obtained in standard PA projection, erect position.",
    sections: [
      "LUNG FIELDS",
      "HILUM",
      "CARDIOMEDIASTINAL SILHOUETTE",
      "PLEURA / COSTOPHRENIC ANGLES",
      "DIAPHRAGM",
      "BONES / SOFT TISSUES",
    ],
  },
  XRAY_CERVICAL_SPINE: {
    templateId: "XRAY_CERVICAL_SPINE",
    modality: "X-RAY",
    studyName: "X-RAY CERVICAL SPINE",
    technique:
      "Digital radiographs of the cervical spine obtained in AP and lateral projections; oblique views if requested.",
    sections: [
      "ALIGNMENT",
      "VERTEBRAL BODIES",
      "DISC SPACES",
      "NEURAL FORAMINA",
      "POSTERIOR ELEMENTS",
      "SOFT TISSUES",
    ],
  },
  XRAY_LS_SPINE: {
    templateId: "XRAY_LS_SPINE",
    modality: "X-RAY",
    studyName: "X-RAY LUMBOSACRAL SPINE",
    technique:
      "Digital radiographs of the lumbosacral spine obtained in AP and lateral projections.",
    sections: [
      "ALIGNMENT / CURVATURE",
      "VERTEBRAL BODIES",
      "DISC SPACES",
      "SACROILIAC JOINTS",
      "POSTERIOR ELEMENTS",
      "SOFT TISSUES",
    ],
  },
  XRAY_KNEE: {
    templateId: "XRAY_KNEE",
    modality: "X-RAY",
    studyName: "X-RAY KNEE",
    technique:
      "Digital radiographs of the knee joint obtained in weight-bearing AP and lateral projections; skyline view if requested.",
    sections: [
      "JOINT SPACE",
      "FEMORAL CONDYLES",
      "TIBIAL PLATEAU",
      "PATELLA",
      "SOFT TISSUES",
    ],
  },
  XRAY_SHOULDER: {
    templateId: "XRAY_SHOULDER",
    modality: "X-RAY",
    studyName: "X-RAY SHOULDER",
    technique:
      "Digital radiographs of the shoulder obtained in AP and axillary / scapular-Y projections.",
    sections: [
      "GLENOHUMERAL JOINT SPACE",
      "HUMERUS",
      "ACROMIOCLAVICULAR JOINT",
      "CLAVICLE / SCAPULA",
      "SOFT TISSUES",
    ],
  },
  XRAY_PNS: {
    templateId: "XRAY_PNS",
    modality: "X-RAY",
    studyName: "X-RAY PARANASAL SINUSES",
    technique:
      "Digital radiographs of the paranasal sinuses obtained in Waters and Caldwell projections.",
    sections: [
      "MAXILLARY SINUSES",
      "FRONTAL SINUSES",
      "ETHMOID SINUSES",
      "SPHENOID SINUS",
      "NASAL SEPTUM",
      "SOFT TISSUES",
    ],
  },
  XRAY_ABDOMEN: {
    templateId: "XRAY_ABDOMEN",
    modality: "X-RAY",
    studyName: "X-RAY ABDOMEN",
    technique:
      "Digital radiograph of the abdomen obtained in erect and supine AP projections.",
    sections: [
      "BOWEL GAS PATTERN",
      "AIR-FLUID LEVELS",
      "FREE GAS",
      "CALCIFICATIONS",
      "SOLID ORGANS (visible)",
      "BONES (imaged portion)",
    ],
  },
};

// ── Voice cleanup ─────────────────────────────────────────────────────────────

function cleanVoiceText(raw: string): string {
  return String(raw ?? "")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bfull stop\b/gi, ".")
    .replace(/\bnew line\b/gi, "\n")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\bsemicolon\b/gi, ";")
    .replace(/\bflair\b/gi, "FLAIR")
    .replace(/\bdwi\b/gi, "DWI")
    .replace(/\badc\b/gi, "ADC")
    .replace(/\bswi\b/gi, "SWI")
    .replace(/\bfazekas\b/gi, "Fazekas")
    .replace(/\blacunar\b/gi, "lacunar")
    .replace(/\bthecal sac\b/gi, "thecal sac")
    .replace(/\bforaminal\b/gi, "foraminal")
    .replace(/\bhyperintense\b/gi, "hyperintense")
    .replace(/\bhypointense\b/gi, "hypointense")
    .replace(/\bisointense\b/gi, "isointense")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ── HTML report builder ───────────────────────────────────────────────────────

function escHtml(v: string): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Preference-aware section heading formatter
  function fmtHeading(text: string, headingCase: "all_caps" | "title_case"): string {
    if (headingCase === "all_caps") return text.toUpperCase();
    return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  function buildReportHtml(input: {
    patientName?: string;
    age?: string;
    sex?: string;
    patientId?: string;
    referringDoctor?: string;
    accessionNumber?: string;
    studyDate?: string;
    clinicalHistory?: string;
    findingsSections?: Record<string, string>;
    rawFindings?: string;
    impression?: string[];
    recommendation?: string;
    template: ReportTemplate;
    keyImages?: Array<{ imageUrl: string; caption: string; includeInReport: boolean }>;
    preferences?: {
      headingCase?: "all_caps" | "title_case";
      sectionSpacing?: "spaced" | "compact";
      impressionStyle?: "bulleted" | "numbered" | "plain";
      showEndOfReportFooter?: boolean;
      footerText?: string | null;
      headerLine1?: string | null;
      headerLine2Source?: "template_name" | "custom";
      headerLine2Custom?: string | null;
      printMode?: "letterhead" | "plain_paper";
    };
    clinicSettings?: {
      name: string; address: string; phone: string; email: string; logoDataUrl: string | null;
    };
  }): string {
    const t = input.template;
    const sections = input.findingsSections ?? {};
    const impressionBullets = (input.impression ?? []).filter(Boolean);
    const includedImages = (input.keyImages ?? []).filter((img) => img.includeInReport);
    const prefs = input.preferences ?? {};
    const hc = prefs.headingCase ?? "all_caps";
    const ss = prefs.sectionSpacing ?? "spaced";
    const ist = prefs.impressionStyle ?? "bulleted";
    const sp = ss === "compact" ? "2px" : "10px";
    const sp2 = ss === "compact" ? "4px" : "12px";

    const sectionsHtml = t.sections
      .map((name) => {
        const content = sections[name] ?? input.rawFindings ?? "";
        const title = fmtHeading(name, hc);
        return `<p style="margin:${sp} 0;"><strong><u>${escHtml(title)}</u></strong><br/>${escHtml(content).replaceAll("\n", "<br/>") || "<em style='color:#aaa;'>—</em>"}</p>`;
      })
      .join("\n");

    const imagesHtml =
      includedImages.length > 0
        ? `<h3 style="margin:${sp2} 0 ${sp};"><u>${fmtHeading("Key Images", hc)}</u></h3>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:8px 0;">
  ${includedImages
    .map(
      (img) => `  <figure style="margin:0;text-align:center;page-break-inside:avoid;">
      <img src="${escHtml(img.imageUrl)}" style="max-width:100%;max-height:220px;object-fit:contain;border:1px solid #ccc;border-radius:4px;" />
      <figcaption style="font-size:11px;color:#555;margin-top:4px;">${escHtml(img.caption)}</figcaption>
    </figure>`,
    )
    .join("\n")}
  </div>`
        : "";

    let impressionHtml = "";
    if (impressionBullets.length > 0) {
      if (ist === "numbered") {
        impressionHtml = `<ol style="margin:4px 0 0 22px;padding:0;">${impressionBullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ol>`;
      } else if (ist === "plain") {
        impressionHtml = `<p style="margin:4px 0;">${impressionBullets.map((b) => escHtml(b)).join("; ")}</p>`;
      } else {
        impressionHtml = `<ul style="margin:4px 0 0 18px;padding:0;">${impressionBullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>`;
      }
    } else {
      impressionHtml = `<p style="margin:4px 0;color:#aaa;"><em>Draft impression — not verified.</em></p>`;
    }

    const line2 = prefs.headerLine2Source === "custom" && prefs.headerLine2Custom
      ? prefs.headerLine2Custom
      : t.studyName;

    const isPlainPaper = prefs.printMode === "plain_paper";
    const c = input.clinicSettings;

    const ptHeader = isPlainPaper && c
      ? `<div style="text-align:center;margin-bottom:8px;">
        <h1 style="font-size:18px;margin:0 0 2px;letter-spacing:1px;">${escHtml(c.name)}</h1>
        <p style="font-size:11px;margin:0 0 1px;color:#333;">${escHtml(c.address)}</p>
        <p style="font-size:11px;margin:0 0 1px;color:#333;">Ph: ${escHtml(c.phone)}${c.email ? ` | Email: ${escHtml(c.email)}` : ""}</p>
        ${c.logoDataUrl ? `<img src="${escHtml(c.logoDataUrl)}" style="max-height:40px;margin:4px 0;" />` : ""}
        <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
      </div>`
      : "";

    const ptFooter = isPlainPaper && c
      ? `<div style="margin-top:12px;border-top:1px solid #999;padding-top:6px;">
        <p style="font-size:11px;color:#333;margin:0 0 2px;"><strong>${escHtml(c.name)}</strong></p>
        <p style="font-size:10px;color:#555;margin:0;">${escHtml(c.address)} | Ph: ${escHtml(c.phone)}</p>
        <p style="font-size:10px;color:#666;font-style:italic;margin:4px 0 0;">Please correlate with clinical history and findings. Report issued by authorized radiologist only.</p>
      </div>`
      : "";

    const headerHtml = prefs.headerLine1
      ? `<p style="margin:0 0 2px;"><strong>${escHtml(prefs.headerLine1)}</strong></p>
    <p style="margin:0 0 2px;"><strong>${escHtml(line2)}</strong></p>`
      : `<p style="margin:0 0 2px;"><strong>NAME: ${escHtml(input.patientName ?? "")} &nbsp;&nbsp; AGE/SEX: ${escHtml(input.age ?? "")}/${escHtml(input.sex ?? "")} &nbsp;&nbsp; UHID: ${escHtml(input.patientId ?? "")} &nbsp;&nbsp; ACC: ${escHtml(input.accessionNumber ?? "")}</strong></p>
    <p style="margin:0 0 2px;"><strong>REF. BY: ${escHtml(input.referringDoctor ?? "")} &nbsp;&nbsp; DATE: ${escHtml(input.studyDate ?? "")}</strong></p>`;

    const footerBlock = (!isPlainPaper && prefs.showEndOfReportFooter !== false)
      ? `<hr style="border:none;border-top:1px solid #999;margin:${sp2} 0 4px;" />
    ${prefs.footerText ? `<p style="font-size:11px;color:#444;margin:0 0 2px;">${escHtml(prefs.footerText)}</p>` : ""}
    <p style="font-size:11px;color:#666;font-style:italic;margin:0;">Please correlate with clinical history and findings. Report issued by authorized radiologist only.</p>`
      : "";

    const contentBody = `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111;max-width:720px;margin:0 auto;">
    ${headerHtml}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h2 style="text-align:center;text-decoration:underline;font-size:15px;margin:8px 0;"><strong>${escHtml(t.studyName)}</strong></h2>
    <h3 style="margin:${sp} 0 ${sp};"><u>${fmtHeading("Technique", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtml(t.technique)}</p>
    ${input.clinicalHistory ? `<h3 style="margin:${sp} 0 ${sp};"><u>${fmtHeading("Clinical History", hc)}</u></h3><p style="margin:0 0 ${sp};">${escHtml(input.clinicalHistory)}</p>` : ""}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h3 style="margin:${sp} 0 ${sp};"><u>${fmtHeading("Findings / Observation", hc)}</u></h3>
    ${sectionsHtml}
    ${imagesHtml}
    <h3 style="margin:${sp2} 0 ${sp};"><u>${fmtHeading("Impression", hc)}</u></h3>
    ${impressionHtml}
    <h3 style="margin:${sp2} 0 ${sp};"><u>${fmtHeading("Recommendation", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtml(input.recommendation ?? "Please correlate with clinical findings.")}</p>
    ${footerBlock}
  </div>`;

    if (!isPlainPaper) return contentBody.trim();

    return `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111;">
      ${ptHeader}
      ${contentBody}
      ${ptFooter}
    </div>`.trim();
  }

// ── Router ────────────────────────────────────────────────────────────────────

export const radiologyReportGeneratorRouter = Router();

// GET /templates
radiologyReportGeneratorRouter.get("/templates", (_req: Request, res: Response) => {
  res.json({ success: true, templates: Object.values(RADIOLOGY_TEMPLATES) });
});

// POST /voice-cleanup
const VoiceCleanupBody = z.object({
  rawTranscript: z.string().min(1).max(10_000),
  draftId: z.number().int().optional(),
  studyId: z.number().int().optional(),
  patientId: z.number().int().optional(),
  targetField: z.string().max(100).optional(),
});

radiologyReportGeneratorRouter.post("/voice-cleanup", async (req: StaffAuthRequest, res: Response) => {
  const parsed = VoiceCleanupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "rawTranscript is required" });
    return;
  }

  const { rawTranscript, draftId, studyId, patientId, targetField } = parsed.data;
  const cleanedText = cleanVoiceText(rawTranscript);
  const structuredPoints = cleanedText
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Audit log — fire-and-forget, do not block response
  void db
    .insert(radiologyVoiceLogsTable)
    .values({
      draftId: draftId ?? null,
      studyId: studyId ?? null,
      patientId: patientId ?? null,
      targetField: targetField ?? null,
      rawTranscript,
      cleanedText,
      createdBy: req.staffSession?.subjectName ?? null,
    })
    .catch(() => undefined);

  res.json({ success: true, cleanedText, structuredPoints });
});

// POST /generate — build HTML preview (does not persist)
const GenerateBody = z.object({
  templateId: z.string(),
  patientName: z.string().optional(),
  age: z.string().optional(),
  sex: z.string().optional(),
  patientId: z.union([z.string(), z.number()]).optional(),
  referringDoctor: z.string().optional(),
  accessionNumber: z.string().optional(),
  studyDate: z.string().optional(),
  clinicalHistory: z.string().optional(),
  findingsSections: z.record(z.string()).optional(),
  rawFindings: z.string().optional(),
  impression: z.array(z.string()).optional(),
  recommendation: z.string().optional(),
  keyImages: z
    .array(
      z.object({
        imageUrl: z.string(),
        caption: z.string().default(""),
        includeInReport: z.boolean().default(true),
      }),
    )
    .optional(),
  preferences: z.object({
    headingCase: z.enum(["all_caps", "title_case"]).optional(),
    sectionSpacing: z.enum(["spaced", "compact"]).optional(),
    impressionStyle: z.enum(["bulleted", "numbered", "plain"]).optional(),
    showEndOfReportFooter: z.boolean().optional(),
    footerText: z.string().optional().nullable(),
    headerLine1: z.string().optional().nullable(),
    headerLine2Source: z.enum(["template_name", "custom"]).optional(),
    headerLine2Custom: z.string().optional().nullable(),
    printMode: z.enum(["letterhead", "plain_paper"]).optional(),
  }).optional(),
});

radiologyReportGeneratorRouter.post("/generate", async (req: Request, res: Response) => {
  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;
  const template = RADIOLOGY_TEMPLATES[data.templateId] ?? Object.values(RADIOLOGY_TEMPLATES)[0]!;

  // Fetch clinic settings for plain-paper print mode
  let clinicSettings: { name: string; address: string; phone: string; email: string; logoDataUrl: string | null } | undefined;
  if (data.preferences?.printMode === "plain_paper") {
    const [clinic] = await db.select().from(clinicSettingsTable).limit(1);
    if (clinic) {
      clinicSettings = {
        name: clinic.name || "Care Diagnostics",
        address: clinic.address || "",
        phone: clinic.phone || "",
        email: clinic.email || "",
        logoDataUrl: clinic.logoDataUrl || null,
      };
    }
  }

  const html = buildReportHtml({
    ...data,
    patientId: data.patientId != null ? String(data.patientId) : undefined,
    template,
    preferences: data.preferences,
    clinicSettings,
  });

  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  res.json({
    success: true,
    title: template.studyName,
    formattedReportHtml: html,
    formattedReportText: text,
  });
});

// POST /save-draft
const SaveDraftBody = z.object({
  id: z.number().int().optional(),
  studyId: z.number().int().optional(),
  worklistId: z.number().int().optional(),
  patientId: z.number().int().optional(),
  templateId: z.string().optional(),
  modality: z.string().optional(),
  studyName: z.string().optional(),
  clinicalHistory: z.string().optional(),
  rawFindings: z.string().optional(),
  findingsSections: z.record(z.string()).optional(),
  impression: z.array(z.string()).optional(),
  recommendation: z.string().optional(),
  formattedReportHtml: z.string().optional(),
  formattedReportText: z.string().optional(),
});

radiologyReportGeneratorRouter.post("/save-draft", async (req: StaffAuthRequest, res: Response) => {
  const parsed = SaveDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request" });
    return;
  }

  const { id, ...rest } = parsed.data;
  const author = req.staffSession?.subjectName ?? null;

  const values = {
    studyId: rest.studyId ?? null,
    worklistId: rest.worklistId ?? null,
    patientId: rest.patientId ?? null,
    templateId: rest.templateId ?? null,
    modality: rest.modality ?? null,
    studyName: rest.studyName ?? null,
    clinicalHistory: rest.clinicalHistory ?? null,
    rawFindings: rest.rawFindings ?? null,
    findingsSections: rest.findingsSections
      ? JSON.stringify(rest.findingsSections)
      : null,
    impression: rest.impression ? JSON.stringify(rest.impression) : null,
    recommendation: rest.recommendation ?? null,
    formattedReportHtml: rest.formattedReportHtml ?? null,
    formattedReportText: rest.formattedReportText ?? null,
  };

  if (id) {
    const [updated] = await db
      .update(radiologyReportDraftsTable)
      .set(values)
      .where(eq(radiologyReportDraftsTable.id, id))
      .returning();
    res.json({ success: true, draft: updated });
  } else {
    const [created] = await db
      .insert(radiologyReportDraftsTable)
      .values({ ...values, createdBy: author })
      .returning();
    res.json({ success: true, draft: created });
  }
});

// GET /drafts — list recent drafts (optionally filtered by studyId or patientId)
radiologyReportGeneratorRouter.get("/drafts", async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? Number(req.query.studyId) : null;
  const patientId = req.query.patientId ? Number(req.query.patientId) : null;

  const conditions = [];
  if (studyId) conditions.push(eq(radiologyReportDraftsTable.studyId, studyId));
  if (patientId) conditions.push(eq(radiologyReportDraftsTable.patientId, patientId));

  const rows = await db
    .select()
    .from(radiologyReportDraftsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(radiologyReportDraftsTable.updatedAt))
    .limit(50);

  res.json({ success: true, drafts: rows });
});

// GET /drafts/:id
radiologyReportGeneratorRouter.get("/drafts/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ success: false, error: "Invalid id" }); return; }

  const [draft] = await db
    .select()
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, id));

  if (!draft) { res.status(404).json({ success: false, error: "Draft not found" }); return; }
  res.json({ success: true, draft });
});

// POST /key-images — multipart upload
radiologyReportGeneratorRouter.post(
  "/key-images",
  upload.single("image"),
  async (req: StaffAuthRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: "Image file is required" });
      return;
    }

    const imageUrl = `/uploads/radiology-key-images/${req.file.filename}`;
    const draftId = req.body.draftId ? Number(req.body.draftId) : null;
    const studyId = req.body.studyId ? Number(req.body.studyId) : null;
    const patientId = req.body.patientId ? Number(req.body.patientId) : null;

    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        studyId,
        patientId,
        accessionNumber: req.body.accessionNumber ?? null,
        imageUrl,
        thumbnailUrl: imageUrl,
        caption: req.body.caption ?? "",
        sortOrder: req.body.sortOrder ? Number(req.body.sortOrder) : 0,
        includeInReport: true,
        sourceType: "UPLOAD",
        createdBy: req.staffSession?.subjectName ?? null,
      })
      .returning();

    res.json({ success: true, item: row });
  },
);

// GET /key-images?draftId=&studyId=
radiologyReportGeneratorRouter.get("/key-images", async (req: Request, res: Response) => {
  const draftId = req.query.draftId ? Number(req.query.draftId) : null;
  const studyId = req.query.studyId ? Number(req.query.studyId) : null;

  const conditions = [];
  if (draftId) conditions.push(eq(radiologyReportKeyImagesTable.draftId, draftId));
  if (studyId) conditions.push(eq(radiologyReportKeyImagesTable.studyId, studyId));

  const rows = await db
    .select()
    .from(radiologyReportKeyImagesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(radiologyReportKeyImagesTable.sortOrder);

  res.json({ success: true, items: rows });
});

// PUT /key-images/:id
const UpdateKeyImageBody = z.object({
  caption: z.string().max(500).optional(),
  includeInReport: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

radiologyReportGeneratorRouter.put("/key-images/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ success: false, error: "Invalid id" }); return; }

  const parsed = UpdateKeyImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request" });
    return;
  }

  const [updated] = await db
    .update(radiologyReportKeyImagesTable)
    .set(parsed.data)
    .where(eq(radiologyReportKeyImagesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ success: false, error: "Image not found" }); return; }
  res.json({ success: true, item: updated });
});

// DELETE /key-images/:id
radiologyReportGeneratorRouter.delete("/key-images/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ success: false, error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(radiologyReportKeyImagesTable)
    .where(eq(radiologyReportKeyImagesTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ success: false, error: "Image not found" }); return; }

  // Best-effort file removal — ignore errors
  if (deleted.imageUrl) {
    const filename = path.basename(deleted.imageUrl);
    void fs.unlink(path.join(KEY_IMAGE_DIR, filename)).catch(() => undefined);
  }

  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// TEXT MACROS
// ════════════════════════════════════════════════════════════════════════════

// GET /macros — list macros for the authenticated user plus globals
radiologyReportGeneratorRouter.get("/macros", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const modality = String(req.query.modality || "").trim() || undefined;
  const query = db
    .select()
    .from(radiologyTextMacrosTable)
    .where(
      or(
        eq(radiologyTextMacrosTable.createdBy, userName),
        eq(radiologyTextMacrosTable.isGlobal, true),
      ),
    )
    .orderBy(asc(radiologyTextMacrosTable.sortOrder), desc(radiologyTextMacrosTable.createdAt));
  const rows = await query;
  const filtered = modality
    ? rows.filter((r) => !r.modality || r.modality === modality)
    : rows;
  res.json(filtered);
});

const CreateMacroSchema = z.object({
  shortcut: z.string().min(1).max(50),
  expansion: z.string().min(1).max(5000),
  modality: z.string().max(20).optional(),
  isGlobal: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// POST /macros — create a new macro
radiologyReportGeneratorRouter.post("/macros", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateMacroSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const data = parsed.data;
  const isGlobal = req.staffSession?.role === "super_admin" ? (data.isGlobal ?? false) : false;
  const [row] = await db.insert(radiologyTextMacrosTable).values({
    createdBy: userName,
    shortcut: data.shortcut,
    expansion: data.expansion,
    modality: data.modality || null,
    isGlobal,
    sortOrder: data.sortOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

const UpdateMacroSchema = z.object({
  shortcut: z.string().min(1).max(50).optional(),
  expansion: z.string().min(1).max(5000).optional(),
  modality: z.string().max(20).optional().nullable(),
  isGlobal: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// PUT /macros/:id — update a macro (owner or super-admin only)
radiologyReportGeneratorRouter.put("/macros/:id", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  const role = req.staffSession?.role;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologyTextMacrosTable).where(eq(radiologyTextMacrosTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const canEdit = existing.createdBy === userName || role === "super_admin";
  if (!canEdit) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpdateMacroSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const update: Record<string, unknown> = {};
  if (parsed.data.shortcut !== undefined) update.shortcut = parsed.data.shortcut;
  if (parsed.data.expansion !== undefined) update.expansion = parsed.data.expansion;
  if (parsed.data.modality !== undefined) update.modality = parsed.data.modality;
  if (parsed.data.isGlobal !== undefined && role === "super_admin") update.isGlobal = parsed.data.isGlobal;
  if (parsed.data.sortOrder !== undefined) update.sortOrder = parsed.data.sortOrder;
  const [row] = await db.update(radiologyTextMacrosTable).set(update).where(eq(radiologyTextMacrosTable.id, id)).returning();
  res.json(row);
});

// DELETE /macros/:id — delete a macro (owner or super-admin only)
radiologyReportGeneratorRouter.delete("/macros/:id", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  const role = req.staffSession?.role;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologyTextMacrosTable).where(eq(radiologyTextMacrosTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const canDelete = existing.createdBy === userName || role === "super_admin";
  if (!canDelete) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(radiologyTextMacrosTable).where(eq(radiologyTextMacrosTable.id, id));
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// REPORT PREFERENCES
// ════════════════════════════════════════════════════════════════════════════

const PreferencesSchema = z.object({
  headingCase: z.enum(["all_caps", "title_case"]),
  sectionSpacing: z.enum(["spaced", "compact"]),
  impressionStyle: z.enum(["bulleted", "numbered", "plain"]),
  showEndOfReportFooter: z.boolean(),
  footerText: z.string().max(500).optional(),
  headerLine1: z.string().max(200).optional(),
  headerLine2Source: z.enum(["template_name", "custom"]),
  headerLine2Custom: z.string().max(200).optional(),
  workspaceLayout: z.enum(["3_panel", "preview_first", "workflow"]),
  printMode: z.enum(["letterhead", "plain_paper"]).default("letterhead"),
});

// GET /preferences — fetch preferences for the authenticated user
radiologyReportGeneratorRouter.get("/preferences", async (req: StaffAuthRequest, res: Response) => {
  const userId = req.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(radiologyReportPreferencesTable).where(eq(radiologyReportPreferencesTable.userId, Number(userId)));
  if (rows.length === 0) {
    // Return defaults without creating a row yet
    res.json({
      headingCase: "all_caps",
      sectionSpacing: "spaced",
      impressionStyle: "bulleted",
      showEndOfReportFooter: true,
      footerText: null,
      headerLine1: null,
      headerLine2Source: "template_name",
      headerLine2Custom: null,
      workspaceLayout: "3_panel",
      printMode: "letterhead",
    });
    return;
  }
  res.json(rows[0]);
});

// PUT /preferences — create or update preferences
radiologyReportGeneratorRouter.put("/preferences", async (req: StaffAuthRequest, res: Response) => {
  const userId = req.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = PreferencesSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const data = parsed.data;
  const existing = await db.select().from(radiologyReportPreferencesTable).where(eq(radiologyReportPreferencesTable.userId, Number(userId)));
  if (existing.length === 0) {
    const [row] = await db.insert(radiologyReportPreferencesTable).values({
      userId: Number(userId),
      headingCase: data.headingCase,
      sectionSpacing: data.sectionSpacing,
      impressionStyle: data.impressionStyle,
      showEndOfReportFooter: data.showEndOfReportFooter,
      footerText: data.footerText || null,
      headerLine1: data.headerLine1 || null,
      headerLine2Source: data.headerLine2Source,
      headerLine2Custom: data.headerLine2Custom || null,
      workspaceLayout: data.workspaceLayout,
      printMode: data.printMode,
    }).returning();
    res.status(201).json(row);
    return;
  }
  const [row] = await db.update(radiologyReportPreferencesTable)
    .set({
      headingCase: data.headingCase,
      sectionSpacing: data.sectionSpacing,
      impressionStyle: data.impressionStyle,
      showEndOfReportFooter: data.showEndOfReportFooter,
      footerText: data.footerText || null,
      headerLine1: data.headerLine1 || null,
      headerLine2Source: data.headerLine2Source,
      headerLine2Custom: data.headerLine2Custom || null,
      workspaceLayout: data.workspaceLayout,
      printMode: data.printMode,
    })
    .where(eq(radiologyReportPreferencesTable.userId, Number(userId)))
    .returning();
  res.json(row);
});

// ════════════════════════════════════════════════════════════════════════════
// NORMAL SNIPPETS — one-click shortcuts for common normal reports
// ════════════════════════════════════════════════════════════════════════════

radiologyReportGeneratorRouter.get("/normal-snippets", async (req: StaffAuthRequest, res: Response) => {
  const modality = String(req.query.modality || "").trim() || undefined;
  const bodyPart = String(req.query.bodyPart || "").trim() || undefined;
  const query = db.select().from(radiologyNormalSnippetsTable).where(eq(radiologyNormalSnippetsTable.isGlobal, true)).orderBy(asc(radiologyNormalSnippetsTable.sortOrder));
  const rows = await query;
  const filtered = rows.filter((r) => {
    if (modality && r.modality && r.modality !== modality) return false;
    if (bodyPart && r.bodyPart && r.bodyPart !== bodyPart) return false;
    return true;
  });
  res.json(filtered);
});

const NormalSnippetSchema = z.object({
  shortcut: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  modality: z.string().max(20).optional(),
  bodyPart: z.string().max(30).optional(),
  text: z.string().min(1).max(5000),
  impression: z.string().max(2000).optional(),
  recommendation: z.string().max(2000).optional(),
  isGlobal: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

radiologyReportGeneratorRouter.post("/normal-snippets", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  const role = req.staffSession?.role;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = NormalSnippetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const data = parsed.data;
  const isGlobal = role === "super_admin" ? (data.isGlobal ?? false) : false;
  const [row] = await db.insert(radiologyNormalSnippetsTable).values({
    shortcut: data.shortcut,
    label: data.label,
    modality: data.modality || null,
    bodyPart: data.bodyPart || null,
    text: data.text,
    impression: data.impression || null,
    recommendation: data.recommendation || null,
    isGlobal,
    createdBy: userName,
    sortOrder: data.sortOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

// ════════════════════════════════════════════════════════════════════════════
// IMAGE REFERENCES — key image pointers for reports
// ════════════════════════════════════════════════════════════════════════════

radiologyReportGeneratorRouter.get("/image-references", async (req: Request, res: Response) => {
  const draftId = req.query.draftId ? Number(req.query.draftId) : null;
  const studyId = req.query.studyId ? Number(req.query.studyId) : null;
  if (!draftId && !studyId) { res.status(400).json({ error: "draftId or studyId required" }); return; }
  const conds = [];
  if (draftId) conds.push(eq(radiologyImageReferencesTable.draftId, draftId));
  if (studyId) conds.push(eq(radiologyImageReferencesTable.studyId, studyId));
  const rows = await db.select().from(radiologyImageReferencesTable).where(conds.length ? and(...conds) : undefined).orderBy(asc(radiologyImageReferencesTable.createdAt));
  res.json(rows);
});

const ImageRefSchema = z.object({
  draftId: z.number().int(),
  studyId: z.number().int().optional(),
  seriesNumber: z.string().max(20).optional(),
  imageNumber: z.string().max(20).optional(),
  description: z.string().min(1).max(500),
});

radiologyReportGeneratorRouter.post("/image-references", async (req: StaffAuthRequest, res: Response) => {
  const parsed = ImageRefSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const [row] = await db.insert(radiologyImageReferencesTable).values({
    draftId: parsed.data.draftId,
    studyId: parsed.data.studyId ?? null,
    seriesNumber: parsed.data.seriesNumber ?? null,
    imageNumber: parsed.data.imageNumber ?? null,
    description: parsed.data.description,
  }).returning();
  res.status(201).json(row);
});

radiologyReportGeneratorRouter.delete("/image-references/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(radiologyImageReferencesTable).where(eq(radiologyImageReferencesTable.id, id));
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// RADIOLOGIST STYLE PREFERENCES — AI impression style settings
// ════════════════════════════════════════════════════════════════════════════

const StylePreferencesSchema = z.object({
  impressionStyle: z.enum(["concise", "detailed", "academic", "diagnostic"]),
  terminologyLevel: z.enum(["simple", "standard", "advanced"]),
  autoNumberImpressions: z.boolean(),
  includeDifferential: z.boolean(),
  includeMeasurements: z.boolean(),
});

radiologyReportGeneratorRouter.get("/style-preferences", async (req: StaffAuthRequest, res: Response) => {
  const userId = req.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(radiologistStylePreferencesTable).where(eq(radiologistStylePreferencesTable.userId, Number(userId)));
  if (rows.length === 0) {
    res.json({ impressionStyle: "concise", terminologyLevel: "standard", autoNumberImpressions: true, includeDifferential: false, includeMeasurements: false });
    return;
  }
  res.json(rows[0]);
});

radiologyReportGeneratorRouter.put("/style-preferences", async (req: StaffAuthRequest, res: Response) => {
  const userId = req.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = StylePreferencesSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const data = parsed.data;
  const existing = await db.select().from(radiologistStylePreferencesTable).where(eq(radiologistStylePreferencesTable.userId, Number(userId)));
  if (existing.length === 0) {
    const [row] = await db.insert(radiologistStylePreferencesTable).values({
      userId: Number(userId),
      ...data,
    }).returning();
    res.status(201).json(row);
    return;
  }
  const [row] = await db.update(radiologistStylePreferencesTable).set(data).where(eq(radiologistStylePreferencesTable.userId, Number(userId))).returning();
  res.json(row);
});

// ════════════════════════════════════════════════════════════════════════════
// REPORT LIFECYCLE LOG — audit trail for report edits/amendments/reprints
// ════════════════════════════════════════════════════════════════════════════

radiologyReportGeneratorRouter.get("/lifecycle-log", async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? Number(req.query.studyId) : null;
  const draftId = req.query.draftId ? Number(req.query.draftId) : null;
  if (!studyId && !draftId) { res.status(400).json({ error: "studyId or draftId required" }); return; }
  const conds = [];
  if (studyId) conds.push(eq(radiologyReportLifecycleLogTable.studyId, studyId));
  if (draftId) conds.push(eq(radiologyReportLifecycleLogTable.draftId, draftId));
  const rows = await db.select().from(radiologyReportLifecycleLogTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(radiologyReportLifecycleLogTable.createdAt));
  res.json(rows);
});

radiologyReportGeneratorRouter.post("/log-action", async (req: StaffAuthRequest, res: Response) => {
  const parsed = z.object({
    studyId: z.number().int(),
    draftId: z.number().int().optional(),
    action: z.string().min(1),
    oldValue: z.string().optional(),
    newValue: z.string().optional(),
    details: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const data = parsed.data;
  const [row] = await db.insert(radiologyReportLifecycleLogTable).values({
    studyId: data.studyId,
    draftId: data.draftId ?? null,
    action: data.action,
    actorId: req.staffSession?.subjectId ? Number(req.staffSession.subjectId) : null,
    actorName: req.staffSession?.subjectName || "unknown",
    oldValue: data.oldValue ?? null,
    newValue: data.newValue ?? null,
    details: data.details ?? null,
  }).returning();
  res.status(201).json(row);
});

// ══════════════════════════════════════════════════════════════════════════════════
// SPINAL MEASUREMENTS — per-vertebral-level canal/cord tracking for MRI spine
// ══════════════════════════════════════════════════════════════════════════════════

radiologyReportGeneratorRouter.get("/spinal-measurements", async (req: StaffAuthRequest, res: Response) => {
  const studyId = req.query.studyId ? Number(req.query.studyId) : null;
  const draftId = req.query.draftId ? Number(req.query.draftId) : null;
  if (!studyId && !draftId) { res.status(400).json({ error: "studyId or draftId required" }); return; }
  const conds = [];
  if (studyId) conds.push(eq(spinalMeasurementsTable.studyId, studyId));
  if (draftId) conds.push(eq(spinalMeasurementsTable.draftId, draftId));
  const rows = await db.select().from(spinalMeasurementsTable).where(conds.length ? and(...conds) : undefined).orderBy(asc(spinalMeasurementsTable.vertebraLevel));
  res.json(rows);
});

const SpinalMeasurementSchema = z.object({
  studyId: z.number().int(),
  draftId: z.number().int().optional(),
  patientId: z.number().int().optional(),
  worklistId: z.number().int().optional(),
  vertebraLevel: z.string().min(1).max(10),
  canalAP: z.string().max(20).optional(),
  canalTransverse: z.string().max(20).optional(),
  canalArea: z.string().max(20).optional(),
  cordAP: z.string().max(20).optional(),
  cordTransverse: z.string().max(20).optional(),
  cordArea: z.string().max(20).optional(),
  discHeight: z.string().max(20).optional(),
  stenosisGrade: z.enum(["none", "mild", "moderate", "severe"]).optional(),
  stenosisNotes: z.string().max(500).optional(),
  leftForaminal: z.enum(["normal", "mild", "moderate", "severe"]).optional(),
  rightForaminal: z.enum(["normal", "mild", "moderate", "severe"]).optional(),
  alignment: z.enum(["normal", "kyphosis", "lordosis", "scoliosis", "listhesis"]).optional(),
  alignmentNotes: z.string().max(500).optional(),
});

// POST /spinal-measurements — create or replace (upsert per vertebraLevel + studyId)
radiologyReportGeneratorRouter.post("/spinal-measurements", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = SpinalMeasurementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  // Check existing for this study + level
  const existing = await db.select({ id: spinalMeasurementsTable.id }).from(spinalMeasurementsTable).where(
    and(eq(spinalMeasurementsTable.studyId, d.studyId), eq(spinalMeasurementsTable.vertebraLevel, d.vertebraLevel))
  );
  if (existing.length > 0) {
    const [row] = await db.update(spinalMeasurementsTable).set({
      draftId: d.draftId ?? null,
      patientId: d.patientId ?? null,
      worklistId: d.worklistId ?? null,
      canalAP: d.canalAP ?? null,
      canalTransverse: d.canalTransverse ?? null,
      canalArea: d.canalArea ?? null,
      cordAP: d.cordAP ?? null,
      cordTransverse: d.cordTransverse ?? null,
      cordArea: d.cordArea ?? null,
      discHeight: d.discHeight ?? null,
      stenosisGrade: d.stenosisGrade ?? "none",
      stenosisNotes: d.stenosisNotes ?? null,
      leftForaminal: d.leftForaminal ?? "normal",
      rightForaminal: d.rightForaminal ?? "normal",
      alignment: d.alignment ?? "normal",
      alignmentNotes: d.alignmentNotes ?? null,
      measuredBy: userName,
      measuredAt: new Date(),
    }).where(eq(spinalMeasurementsTable.id, existing[0].id)).returning();
    res.json(row);
    return;
  }
  const [row] = await db.insert(spinalMeasurementsTable).values({
    studyId: d.studyId,
    draftId: d.draftId ?? null,
    patientId: d.patientId ?? null,
    worklistId: d.worklistId ?? null,
    vertebraLevel: d.vertebraLevel,
    canalAP: d.canalAP ?? null,
    canalTransverse: d.canalTransverse ?? null,
    canalArea: d.canalArea ?? null,
    cordAP: d.cordAP ?? null,
    cordTransverse: d.cordTransverse ?? null,
    cordArea: d.cordArea ?? null,
    discHeight: d.discHeight ?? null,
    stenosisGrade: d.stenosisGrade ?? "none",
    stenosisNotes: d.stenosisNotes ?? null,
    leftForaminal: d.leftForaminal ?? "normal",
    rightForaminal: d.rightForaminal ?? "normal",
    alignment: d.alignment ?? "normal",
    alignmentNotes: d.alignmentNotes ?? null,
    measuredBy: userName,
    measuredAt: new Date(),
  }).returning();
  res.status(201).json(row);
});

radiologyReportGeneratorRouter.delete("/spinal-measurements/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(spinalMeasurementsTable).where(eq(spinalMeasurementsTable.id, id));
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════════
// SMART MACROS — measurement-aware text expansions
// ══════════════════════════════════════════════════════════════════════════════════

radiologyReportGeneratorRouter.get("/smart-macros", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const modality = String(req.query.modality || "").trim() || undefined;
  const bodyPart = String(req.query.bodyPart || "").trim() || undefined;
  const query = db
    .select()
    .from(radiologySmartMacrosTable)
    .where(
      or(
        eq(radiologySmartMacrosTable.createdBy, userName),
        eq(radiologySmartMacrosTable.isGlobal, true),
      ),
    )
    .orderBy(asc(radiologySmartMacrosTable.sortOrder), desc(radiologySmartMacrosTable.createdAt));
  const rows = await query;
  const filtered = rows.filter((r) => {
    if (modality && r.modality && r.modality !== modality) return false;
    if (bodyPart && r.bodyPart && r.bodyPart !== bodyPart) return false;
    return true;
  });
  res.json(filtered);
});

const SmartMacroSchema = z.object({
  shortcut: z.string().min(1).max(50),
  expansion: z.string().min(1).max(5000),
  modality: z.string().max(20).optional(),
  bodyPart: z.string().max(30).optional(),
  isMeasurementMacro: z.boolean().optional(),
  measurementParams: z.string().max(2000).optional(),
  autoSuggestOn: z.boolean().optional(),
  isGlobal: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

radiologyReportGeneratorRouter.post("/smart-macros", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = SmartMacroSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const data = parsed.data;
  const isGlobal = req.staffSession?.role === "super_admin" ? (data.isGlobal ?? false) : false;
  const [row] = await db.insert(radiologySmartMacrosTable).values({
    createdBy: userName,
    shortcut: data.shortcut,
    expansion: data.expansion,
    modality: data.modality || null,
    bodyPart: data.bodyPart || null,
    isMeasurementMacro: data.isMeasurementMacro ?? false,
    measurementParams: data.measurementParams || null,
    autoSuggestOn: data.autoSuggestOn ?? false,
    isGlobal,
    sortOrder: data.sortOrder ?? 0,
  }).returning();
  res.status(201).json(row);
});

const UpdateSmartMacroSchema = z.object({
  shortcut: z.string().min(1).max(50).optional(),
  expansion: z.string().min(1).max(5000).optional(),
  modality: z.string().max(20).optional().nullable(),
  bodyPart: z.string().max(30).optional().nullable(),
  isMeasurementMacro: z.boolean().optional(),
  measurementParams: z.string().max(2000).optional().nullable(),
  autoSuggestOn: z.boolean().optional(),
  isGlobal: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

radiologyReportGeneratorRouter.put("/smart-macros/:id", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  const role = req.staffSession?.role;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologySmartMacrosTable).where(eq(radiologySmartMacrosTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const canEdit = existing.createdBy === userName || role === "super_admin";
  if (!canEdit) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpdateSmartMacroSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const update: Record<string, unknown> = {};
  if (parsed.data.shortcut !== undefined) update.shortcut = parsed.data.shortcut;
  if (parsed.data.expansion !== undefined) update.expansion = parsed.data.expansion;
  if (parsed.data.modality !== undefined) update.modality = parsed.data.modality;
  if (parsed.data.bodyPart !== undefined) update.bodyPart = parsed.data.bodyPart;
  if (parsed.data.isMeasurementMacro !== undefined) update.isMeasurementMacro = parsed.data.isMeasurementMacro;
  if (parsed.data.measurementParams !== undefined) update.measurementParams = parsed.data.measurementParams;
  if (parsed.data.autoSuggestOn !== undefined) update.autoSuggestOn = parsed.data.autoSuggestOn;
  if (parsed.data.isGlobal !== undefined && role === "super_admin") update.isGlobal = parsed.data.isGlobal;
  if (parsed.data.sortOrder !== undefined) update.sortOrder = parsed.data.sortOrder;
  const [row] = await db.update(radiologySmartMacrosTable).set(update).where(eq(radiologySmartMacrosTable.id, id)).returning();
  res.json(row);
});

radiologyReportGeneratorRouter.delete("/smart-macros/:id", async (req: StaffAuthRequest, res: Response) => {
  const userName = req.staffSession?.subjectName;
  const role = req.staffSession?.role;
  if (!userName) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologySmartMacrosTable).where(eq(radiologySmartMacrosTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const canDelete = existing.createdBy === userName || role === "super_admin";
  if (!canDelete) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(radiologySmartMacrosTable).where(eq(radiologySmartMacrosTable.id, id));
  res.json({ success: true });
});
