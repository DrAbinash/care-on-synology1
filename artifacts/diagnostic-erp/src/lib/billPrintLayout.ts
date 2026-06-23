import { loadPaperSize, persistPaperSize } from "@/lib/paperSize";

export type BillLayout = "classic" | "compact" | "minimal";

export const BILL_LAYOUTS: {
  id: BillLayout;
  label: string;
  description: string;
}[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Blue header & colour-coded totals",
  },
  {
    id: "compact",
    label: "Compact",
    description: "Black & white, works on any printer",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "No table borders, maximum density",
  },
];

const KEY = "diagnosticErp:billPrintLayout";
const BILL_LAYOUTS_VALUES = ["classic", "compact", "minimal"] as const;

export function getBillPrintLayout(): BillLayout {
  return loadPaperSize(KEY, BILL_LAYOUTS_VALUES, "classic");
}

export function setBillPrintLayout(layout: BillLayout): void {
  persistPaperSize(KEY, layout);
}

export type BillPaperSize = "A4" | "A5";

const PAPER_KEY = "diagnosticErp:billPaperSize";
const BILL_PAPER_SIZES = ["A4", "A5"] as const;

export function getBillPaperSize(): BillPaperSize {
  return loadPaperSize(PAPER_KEY, BILL_PAPER_SIZES, "A5");
}

export function setBillPaperSize(size: BillPaperSize): void {
  persistPaperSize(PAPER_KEY, size);
}

export function getAutoBillPaperSize(testCount: number, manualSize?: BillPaperSize): BillPaperSize {
  if (manualSize === "A4" || manualSize === "A5") return manualSize;
  return testCount >= 6 ? "A4" : "A5";
}

// ── Per-layout style helpers ──────────────────────────────────────────────────

export type LayoutStyles = {
  accentColor: string;
  accentText: string;
  headerBorderColor: string;
  headerBorderWidth: string;
  tableHeaderBg: string;
  tableHeaderColor: string;
  tableHeaderPad: string;
  tableRowAltBg: (i: number) => string;
  tableRowBorderBottom: string;
  tableCellBorder: string;
  totalRowBg: string;
  totalRowColor: string;
  totalRowBorder: string;
  sectionLabel: string;
};

export function getLayoutStyles(layout: BillLayout): LayoutStyles {
  switch (layout) {
    case "compact":
      return {
        accentColor: "#111",
        accentText: "#fff",
        headerBorderColor: "#111",
        headerBorderWidth: "2px",
        tableHeaderBg: "#f0f0f0",
        tableHeaderColor: "#111",
        tableHeaderPad: "5px 8px",
        tableRowAltBg: () => "white",
        tableRowBorderBottom: "1px solid #bbb",
        tableCellBorder: "1px solid #bbb",
        totalRowBg: "#e8e8e8",
        totalRowColor: "#111",
        totalRowBorder: "2px solid #444",
        sectionLabel: "9px",
      };
    case "minimal":
      return {
        accentColor: "#444",
        accentText: "#000",
        headerBorderColor: "#666",
        headerBorderWidth: "1.5px",
        tableHeaderBg: "transparent",
        tableHeaderColor: "#111",
        tableHeaderPad: "4px 6px",
        tableRowAltBg: () => "transparent",
        tableRowBorderBottom: "1px solid #ddd",
        tableCellBorder: "none",
        totalRowBg: "transparent",
        totalRowColor: "#111",
        totalRowBorder: "1.5px solid #555",
        sectionLabel: "9px",
      };
    default: // classic
      return {
        accentColor: "#1e40af",
        accentText: "#fff",
        headerBorderColor: "#1e40af",
        headerBorderWidth: "2px",
        tableHeaderBg: "#1e40af",
        tableHeaderColor: "#fff",
        tableHeaderPad: "7px 10px",
        tableRowAltBg: (i) => (i % 2 === 0 ? "#f8fafc" : "white"),
        tableRowBorderBottom: "1px solid #e2e8f0",
        tableCellBorder: "none",
        totalRowBg: "#1e40af",
        totalRowColor: "#fff",
        totalRowBorder: "none",
        sectionLabel: "10px",
      };
  }
}
