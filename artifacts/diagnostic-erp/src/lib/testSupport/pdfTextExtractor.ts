/**
 * PDF Text Extraction Helper for Tests
 * 
 * Parses jsPDF-generated PDF content streams to extract text with coordinates.
 * This is a test-only utility that doesn't require external dependencies.
 * 
 * Extracts: page number, text content, x/y coordinates
 */

export interface PdfTextItem {
  page: number;
  text: string;
  x: number;
  y: number;
}

/**
 * Extract all text items with coordinates from a jsPDF document.
 * Parses the PDF content stream to find text operations (Tj, TJ, ', ").
 */
export function extractTextFromJsPDF(doc: { output: (format: string) => string | ArrayBuffer }): PdfTextItem[] {
  const pdfString = doc.output("string") as string;
  const items: PdfTextItem[] = [];
  
  // Split into pages by looking for page markers
  // jsPDF uses /Type /Page for each page
  const pageMatches = pdfString.match(/\/Type\s*\/Page[^s]/g) || [];
  const pageCount = pageMatches.length;
  
  // Extract text operations from the entire PDF
  // Look for text showing operators: Tj, TJ, ', "
  // Format: (text) x y Td (text) Tj or similar
  
  // Simple regex to find text strings in PDF format
  // PDF text is encoded as (string) or <hexstring>
  const textPattern = /\(([^)]*)\)/g;
  let match;
  let currentPage = 1;
  let lastY = -1;
  
  // Find page boundaries by looking for page stream markers
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;
  let pageIndex = 0;
  
  while ((streamMatch = streamPattern.exec(pdfString)) !== null) {
    const streamContent = streamMatch[1];
    pageIndex++;
    
    // Look for text positioning and showing in this page's stream
    // Common patterns:
    // x y Td (text) Tj
    // (text) Tj
    // BT ... ET blocks
    
    const btPattern = /BT\s*([\s\S]*?)\s*ET/g;
    let btMatch;
    
    while ((btMatch = btPattern.exec(streamContent)) !== null) {
      const btContent = btMatch[1];
      
      // Extract text positioning: x y Td or x y TD
      const posPattern = /([\d.-]+)\s+([\d.-]+)\s+T[dD]/g;
      let posMatch;
      let currentX = 0;
      let currentY = 0;
      
      while ((posMatch = posPattern.exec(btContent)) !== null) {
        currentX = parseFloat(posMatch[1]);
        currentY = parseFloat(posMatch[2]);
      }
      
      // Extract text: (string) Tj or (string) '
      const textPattern2 = /\(([^)]*)\)\s*Tj/g;
      let textMatch;
      
      while ((textMatch = textPattern2.exec(btContent)) !== null) {
        const text = textMatch[1];
        if (text.trim()) {
          items.push({
            page: pageIndex,
            text: text,
            x: currentX,
            y: currentY,
          });
        }
      }
    }
  }
  
  return items;
}

/**
 * Extract all text content from a PDF (without coordinates).
 * Simpler version for content verification.
 */
export function extractAllText(doc: { output: (format: string) => string | ArrayBuffer }): string {
  const items = extractTextFromJsPDF(doc);
  return items.map(item => item.text).join(" ");
}

/**
 * Check if any text appears below a certain y coordinate (footer region).
 */
export function hasTextBelowY(doc: { output: (format: string) => string | ArrayBuffer }, yThreshold: number): boolean {
  const items = extractTextFromJsPDF(doc);
  return items.some(item => item.y < yThreshold);
}

/**
 * Get all text on a specific page.
 */
export function getTextOnPage(doc: { output: (format: string) => string | ArrayBuffer }, pageNum: number): string {
  const items = extractTextFromJsPDF(doc);
  return items
    .filter(item => item.page === pageNum)
    .map(item => item.text)
    .join(" ");
}
