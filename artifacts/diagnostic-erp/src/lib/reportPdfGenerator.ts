/**
 * Unified Radiology Report PDF Generator
 *
 * Shared across all reporting pages (USG, Fetal, Echo, Radiology, Doppler, etc.)
 * Provides configurable print settings: font, margins, header, footer, disclaimer, paper size.
 *
 * Usage:
 *   import { generateReportPDF, type PrintSettings, type ReportData } from "@/lib/reportPdfGenerator";
 *   const settings = loadPrintSettings();
 *   generateReportPDF(reportData, settings, clinicInfo);
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type PrintSettings = {
  paperSize: "A4" | "A5" | "Letter";
  orientation: "portrait" | "landscape";
  fontSize: "small" | "medium" | "large";
  fontFamily: "helvetica" | "times";
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  header: {
    enabled: boolean;
    title: string;
    logo: string | null;
    showDate: boolean;
    showAccession: boolean;
  };
  footer: {
    enabled: boolean;
    disclaimer: string;
    showPageNumber: boolean;
  };
  watermark: string;
  watermarkOpacity: number;
  /** Report section layout order — list which sections appear and in what order */
  layout: Array<"patientBox" | "clinicalHistory" | "technique" | "comparison" | "measurements" | "findings" | "keyImages" | "impression" | "recommendation">;
  /** Per-section visibility toggles */
  show: {
    patientBox: boolean;
    clinicalHistory: boolean;
    technique: boolean;
    comparison: boolean;
    measurements: boolean;
    findings: boolean;
    keyImages: boolean;
    impression: boolean;
    recommendation: boolean;
  };
  /** Digital signature block at the bottom of the report */
  signature: {
    enabled: boolean;
    name: string;
    qualification: string;
    registrationNo: string;
    imageDataUrl: string | null;
    showQualification: boolean;
    showRegistrationNo: boolean;
  };
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperSize: "A4",
  orientation: "portrait",
  fontSize: "medium",
  fontFamily: "helvetica",
  margins: { top: 15, bottom: 20, left: 15, right: 15 },
  header: {
    enabled: true,
    title: "CARE DIAGNOSTICS",
    logo: null,
    showDate: true,
    showAccession: true,
  },
  footer: {
    enabled: true,
    disclaimer: "This report is for diagnostic purposes only. Please correlate with clinical findings.",
    showPageNumber: true,
  },
  watermark: "",
  watermarkOpacity: 0.1,
  layout: ["patientBox", "clinicalHistory", "technique", "comparison", "measurements", "findings", "keyImages", "impression", "recommendation"],
  show: {
    patientBox: true,
    clinicalHistory: true,
    technique: true,
    comparison: true,
    measurements: true,
    findings: true,
    keyImages: true,
    impression: true,
    recommendation: true,
  },
  signature: {
    enabled: true,
    name: "Dr. Sugandha Priyadarshini",
    qualification: "MBBS, MD(Radiology)",
    registrationNo: "",
    imageDataUrl: null,
    showQualification: true,
    showRegistrationNo: false,
  },
};

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem("radiology_print_settings");
    if (!raw) return DEFAULT_PRINT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    return { ...DEFAULT_PRINT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  localStorage.setItem("radiology_print_settings", JSON.stringify(settings));
}

export type PrintClinic = {
  name?: string | null;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoDataUrl?: string | null;
} | null;

export type ReportData = {
  patientName?: string;
  age?: string;
  sex?: string;
  accessionNumber?: string;
  studyDate?: string;
  referringDoctor?: string;
  modality?: string;
  bodyPart?: string;
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  recommendation?: string;
  technique?: string;
  comparison?: string;
  measurements?: Array<{ label: string; value: string }>;
  /** Optional array of key-image data URLs (base64 JPEG/PNG) */
  keyImages?: string[];
  reportTitle?: string;
  printedBy?: string;
};

const FONT_SIZES = {
  small: { body: 9, heading: 12, title: 14, patient: 9, header: 10, footer: 8, disclaimer: 8 },
  medium: { body: 10, heading: 13, title: 15, patient: 10, header: 11, footer: 9, disclaimer: 8 },
  large: { body: 11, heading: 14, title: 16, patient: 11, header: 12, footer: 9, disclaimer: 8 },
};

export function generateReportPDF(
  report: ReportData,
  settings: PrintSettings,
  clinic: PrintClinic,
): void {
  const fmt = settings.paperSize;
  const sizes: Record<string, number[]> = {
    A4: [210, 297],
    A5: [148, 210],
    Letter: [216, 279],
  };
  const [w, h] = sizes[fmt] ?? sizes.A4;
  const isLand = settings.orientation === "landscape";
  const doc = new jsPDF({
    unit: "mm",
    format: fmt.toLowerCase(),
    orientation: isLand ? "landscape" : "portrait",
  });

  const pageW = isLand ? h : w;
  const pageH = isLand ? w : h;
  const m = settings.margins;
  const contentW = pageW - m.left - m.right;
  const fs = FONT_SIZES[settings.fontSize];
  const font = settings.fontFamily;
  doc.setFont(font);

  let y = m.top;

  // ── HEADER ──
  if (settings.header.enabled) {
    const headerH = 8;
    doc.setFontSize(fs.header);
    doc.setFont(font, "bold");
    const clinicName = settings.header.title || clinic?.name || "CARE DIAGNOSTICS";
    doc.text(clinicName, pageW / 2, y + 4, { align: "center" });

    if (clinic?.tagline) {
      doc.setFont(font, "normal");
      doc.setFontSize(fs.header - 1);
      doc.text(clinic.tagline, pageW / 2, y + 7, { align: "center" });
    }

    if (clinic?.logoDataUrl) {
      try {
        doc.addImage(clinic.logoDataUrl, "PNG", m.left, y, 14, 14);
      } catch { /* ignore broken logo */ }
    }

    doc.setFontSize(fs.header - 2);
    doc.setFont(font, "normal");
    const addr = clinic?.address ?? "";
    if (addr) {
      doc.text(addr, pageW / 2, y + 11, { align: "center", maxWidth: contentW });
    }
    const contact = [clinic?.phone, clinic?.email].filter(Boolean).join("  \u00b7  ");
    if (contact) {
      doc.text(contact, pageW / 2, y + 15, { align: "center" });
    }

    doc.setDrawColor(200);
    doc.setLineWidth(0.3);
    doc.line(m.left, y + 18, pageW - m.right, y + 18);
    y += 22;
  } else {
    y += 2;
  }

  // ── TITLE ──
  const title = report.reportTitle || "Radiology Report";
  doc.setFontSize(fs.title);
  doc.setFont(font, "bold");
  doc.text(title, pageW / 2, y + 3, { align: "center" });
  y += 8;

  // ── LAYOUT-DRIVEN SECTIONS ──
  for (const section of settings.layout) {
    if (!settings.show[section]) continue;

    const addPageIfNeeded = (neededHeight: number) => {
      if (y + neededHeight > pageH - m.bottom - 10) {
        doc.addPage();
        y = m.top;
      }
    };

    switch (section) {
      case "patientBox": {
        if (!report.patientName && !report.age && !report.sex && !report.accessionNumber && !report.studyDate && !report.referringDoctor && !report.modality && !report.bodyPart) break;
        doc.setFontSize(fs.patient);
        doc.setFont(font, "bold");
        doc.text("Patient Demographics", m.left, y + 3);
        doc.setFont(font, "normal");
        const boxLines: string[] = [];
        if (report.patientName) boxLines.push(`Patient: ${report.patientName}`);
        if (report.age || report.sex) boxLines.push(`${report.age ?? ""} ${report.sex ?? ""}`.trim());
        if (report.accessionNumber && settings.header.showAccession) boxLines.push(`Accession: ${report.accessionNumber}`);
        if (report.studyDate && settings.header.showDate) boxLines.push(`Date: ${report.studyDate}`);
        if (report.referringDoctor) boxLines.push(`Referring Doctor: ${report.referringDoctor}`);
        if (report.modality) boxLines.push(`Modality: ${report.modality}`);
        if (report.bodyPart) boxLines.push(`Body Part: ${report.bodyPart}`);
        const boxText = boxLines.join("  \u00b7  ");
        doc.text(boxText, m.left, y + 8, { maxWidth: contentW });
        y += 14;
        doc.setDrawColor(200);
        doc.line(m.left, y, pageW - m.right, y);
        y += 4;
        break;
      }
      case "clinicalHistory": {
        if (!report.clinicalHistory) break;
        const lines = doc.splitTextToSize(report.clinicalHistory, contentW);
        addPageIfNeeded(10 + lines.length * (fs.body * 0.4));
        doc.setFontSize(fs.heading);
        doc.setFont(font, "bold");
        doc.text("Clinical History:", m.left, y + 3);
        doc.setFont(font, "normal");
        doc.setFontSize(fs.body);
        doc.text(lines, m.left, y + 7);
        y += 7 + lines.length * (fs.body * 0.4);
        y += 4;
        break;
      }
      case "technique": {
        if (!report.technique) break;
        const lines = doc.splitTextToSize(report.technique, contentW);
        addPageIfNeeded(10 + lines.length * (fs.body * 0.4));
        doc.setFontSize(fs.heading);
        doc.setFont(font, "bold");
        doc.text("Technique:", m.left, y + 3);
        doc.setFont(font, "normal");
        doc.setFontSize(fs.body);
        doc.text(lines, m.left, y + 7);
        y += 7 + lines.length * (fs.body * 0.4);
        y += 4;
        break;
      }
      case "comparison": {
        if (!report.comparison) break;
        const lines = doc.splitTextToSize(report.comparison, contentW);
        addPageIfNeeded(10 + lines.length * (fs.body * 0.4));
        doc.setFontSize(fs.heading);
        doc.setFont(font, "bold");
        doc.text("Comparison:", m.left, y + 3);
        doc.setFont(font, "normal");
        doc.setFontSize(fs.body);
        doc.text(lines, m.left, y + 7);
        y += 7 + lines.length * (fs.body * 0.4);
        y += 4;
        break;
      }
      case "measurements": {
        if (!report.measurements || report.measurements.length === 0) break;
        addPageIfNeeded(40);
        autoTable(doc, {
          startY: y,
          head: [["Measurement", "Value"]],
          body: report.measurements.map((m) => [m.label, m.value]),
          styles: { fontSize: fs.body, font: font, cellPadding: 1.5 },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
          margin: { left: m.left, right: m.right },
          tableWidth: "auto",
        });
        y = (doc as any).lastAutoTable?.finalY ?? y + 30;
        y += 4;
        break;
      }
      case "findings": {
        if (!report.findings) break;
        const lines = doc.splitTextToSize(report.findings, contentW);
        addPageIfNeeded(10 + lines.length * (fs.body * 0.4));
        doc.setFontSize(fs.heading);
        doc.setFont(font, "bold");
        doc.text("Findings:", m.left, y + 3);
        doc.setFont(font, "normal");
        doc.setFontSize(fs.body);
        doc.text(lines, m.left, y + 7);
        y += 7 + lines.length * (fs.body * 0.4);
        y += 4;
        break;
      }
      case "keyImages": {
        if (!report.keyImages || report.keyImages.length === 0) break;
        const imgWidth = (contentW - 8) / 2;
        const imgHeight = 35;
        let imgX = m.left;
        let imgY = y;
        for (let i = 0; i < report.keyImages.length; i++) {
          const img = report.keyImages[i];
          if (!img) continue;
          if (imgY + imgHeight > pageH - m.bottom - 15) {
            doc.addPage();
            imgY = m.top;
            imgX = m.left;
          }
          try {
            const ext = img.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
            doc.addImage(img, ext, imgX, imgY, imgWidth, imgHeight);
            imgX += imgWidth + 4;
            if (imgX + imgWidth > pageW - m.right) {
              imgX = m.left;
              imgY += imgHeight + 4;
            }
          } catch { /* skip broken image */ }
        }
        y = imgY + imgHeight + 6;
        break;
      }
      case "impression": {
        if (!report.impression) break;
        const lines = doc.splitTextToSize(report.impression, contentW);
        addPageIfNeeded(10 + lines.length * (fs.body * 0.4));
        doc.setFontSize(fs.heading);
        doc.setFont(font, "bold");
        doc.text("Impression:", m.left, y + 3);
        doc.setFont(font, "normal");
        doc.setFontSize(fs.body);
        doc.text(lines, m.left, y + 7);
        y += 7 + lines.length * (fs.body * 0.4);
        y += 4;
        break;
      }
      case "recommendation": {
        if (!report.recommendation) break;
        const lines = doc.splitTextToSize(report.recommendation, contentW);
        addPageIfNeeded(10 + lines.length * (fs.body * 0.4));
        doc.setFontSize(fs.heading);
        doc.setFont(font, "bold");
        doc.text("Recommendation:", m.left, y + 3);
        doc.setFont(font, "normal");
        doc.setFontSize(fs.body);
        doc.text(lines, m.left, y + 7);
        y += 7 + lines.length * (fs.body * 0.4);
        y += 4;
        break;
      }
    }
  }

  // ── SIGNATURE BLOCK ──
  if (settings.signature.enabled) {
    const sig = settings.signature;
    const sigHeight = 25;
    if (y + sigHeight > pageH - m.bottom - 10) {
      doc.addPage();
      y = m.top;
    }

    // Signature line
    doc.setDrawColor(100);
    doc.setLineWidth(0.3);
    const lineY = y + 12;
    const lineWidth = 60;
    doc.line(pageW - m.right - lineWidth, lineY, pageW - m.right, lineY);

    // Signature image if available
    if (sig.imageDataUrl) {
      try {
        const imgW = 30;
        const imgH = 15;
        doc.addImage(sig.imageDataUrl, "PNG", pageW - m.right - lineWidth, y - 2, imgW, imgH);
      } catch { /* skip broken signature image */ }
    }

    // Name (bold)
    doc.setFontSize(fs.body);
    doc.setFont(font, "bold");
    doc.text(sig.name, pageW - m.right, lineY + 4, { align: "right" });

    // Qualification & Registration
    const details: string[] = [];
    if (sig.showQualification && sig.qualification) details.push(sig.qualification);
    if (sig.showRegistrationNo && sig.registrationNo) details.push(`Reg. No: ${sig.registrationNo}`);

    if (details.length > 0) {
      doc.setFontSize(fs.body - 1);
      doc.setFont(font, "normal");
      doc.text(details.join(" | "), pageW - m.right, lineY + 8, { align: "right" });
    }

    y += sigHeight;
  }

  // ── FOOTER / DISCLAIMER ──
  const footerY = pageH - m.bottom;
  if (settings.footer.enabled) {
    doc.setDrawColor(200);
    doc.line(m.left, footerY - 6, pageW - m.right, footerY - 6);
    doc.setFontSize(fs.disclaimer);
    doc.setFont(font, "italic");
    const discLines = doc.splitTextToSize(settings.footer.disclaimer, contentW);
    doc.text(discLines, m.left, footerY - 2);
    if (settings.footer.showPageNumber) {
      doc.setFont(font, "normal");
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Page ${i} of ${pageCount}`, pageW - m.right, footerY - 2, { align: "right" });
      }
    }
  }

  // ── WATERMARK ──
  if (settings.watermark) {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(40);
      doc.setTextColor(200, 200, 200);
      doc.setFont(font, "bold");
      doc.text(settings.watermark, pageW / 2, pageH / 2, { align: "center", angle: 45 });
      doc.setTextColor(0, 0, 0);
    }
  }

  // ── SAVE ──
  const filename = (report.accessionNumber || report.patientName || "report")
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .toLowerCase();
  doc.save(`${filename}.pdf`);
}
