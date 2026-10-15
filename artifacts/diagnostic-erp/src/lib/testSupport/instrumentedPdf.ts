/**
 * Instrumented jsPDF wrapper for testing.
 * 
 * Records all text drawing operations with coordinates and page numbers.
 * This is more reliable than parsing PDF binary output.
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
 * Create an instrumented jsPDF document that records all text operations.
 */
export function createInstrumentedPdf(...args: ConstructorParameters<typeof jsPDF>): InstrumentedDoc {
  const doc = new jsPDF(...args);
  const drawnTexts: DrawnText[] = [];
  
  // Store original text method
  const originalText = doc.text.bind(doc);
  
  // Override text method to record draws
  doc.text = function(...args: any[]) {
    // jsPDF.text has multiple signatures:
    // text(text, x, y)
    // text(text, x, y, options)
    // text([text, ...], x, y)
    
    let text: string;
    let x: number;
    let y: number;
    
    if (typeof args[0] === 'string') {
      text = args[0];
      x = args[1];
      y = args[2];
    } else if (Array.isArray(args[0])) {
      text = args[0].join('\n');
      x = args[1];
      y = args[2];
    } else {
      // Unknown signature, call original and don't record
      return originalText(...args);
    }
    
    // Record the draw
    drawnTexts.push({
      page: doc.getNumberOfPages(),
      text,
      x,
      y,
    });
    
    // Call original
    return originalText(...args);
  } as any;
  
  return { doc, drawnTexts };
}

/**
 * Get all text drawn on a specific page.
 */
export function getTextOnPage(instrumented: InstrumentedDoc, pageNum: number): DrawnText[] {
  return instrumented.drawnTexts.filter(t => t.page === pageNum);
}

/**
 * Get all text as a single string.
 */
export function getAllText(instrumented: InstrumentedDoc): string {
  return instrumented.drawnTexts.map(t => t.text).join(' ');
}

/**
 * Check if any text was drawn below a y threshold (footer region).
 */
export function hasTextBelowY(instrumented: InstrumentedDoc, yThreshold: number): boolean {
  return instrumented.drawnTexts.some(t => t.y > yThreshold);
}

/**
 * Find text items matching a pattern.
 */
export function findText(instrumented: InstrumentedDoc, pattern: string | RegExp): DrawnText[] {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  return instrumented.drawnTexts.filter(t => regex.test(t.text));
}
