/**
 * Instrumented jsPDF wrapper for testing.
 *
 * Records every text draw with the page it landed on and its mm coordinates, so
 * pagination assertions are made against the renderer's real output positions
 * rather than a parse of the PDF byte stream.
 */
import { jsPDF } from "jspdf";

export interface DrawnText {
  page: number;
  text: string;
  x: number;
  y: number;
}

export interface InstrumentedDoc {
  doc: jsPDF;
  drawnTexts: DrawnText[];
}

/**
 * jsPDF declares `text()` as one fixed-arity signature, so a forwarding wrapper
 * must spread a tuple rather than an untyped array — spreading `any[]` into it
 * is TS2556. Deriving the parameter list from jsPDF keeps every supported call
 * shape, including the ones jspdf-autotable draws table cells through.
 */
type TextCall = Parameters<jsPDF["text"]>;

export function createInstrumentedPdf(
  ...args: ConstructorParameters<typeof jsPDF>
): InstrumentedDoc {
  const doc = new jsPDF(...args);
  const drawnTexts: DrawnText[] = [];
  const originalText = doc.text.bind(doc);

  doc.text = (...call: TextCall): jsPDF => {
    const [content, x, y] = call;
    drawnTexts.push({
      // getCurrentPageInfo, not getNumberOfPages: the generator walks back over
      // earlier pages with setPage() to stamp the footer and watermark, and
      // those draws would otherwise all be blamed on the last page.
      page: doc.getCurrentPageInfo().pageNumber,
      text: typeof content === "string" ? content : content.join("\n"),
      x,
      y,
    });
    return originalText(...call);
  };

  return { doc, drawnTexts };
}

/** All text drawn on one page, in draw order. */
export function getTextOnPage(
  { drawnTexts }: Pick<InstrumentedDoc, "drawnTexts">,
  pageNum: number,
): DrawnText[] {
  return drawnTexts.filter((t) => t.page === pageNum);
}

/**
 * Every drawn string, in draw order, as one searchable blob. Prose is drawn
 * word-by-word, so whitespace runs are collapsed — otherwise a phrase spread
 * across several draws can never be matched.
 */
export function getAllText({ drawnTexts }: Pick<InstrumentedDoc, "drawnTexts">): string {
  return drawnTexts
    .map((t) => t.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
