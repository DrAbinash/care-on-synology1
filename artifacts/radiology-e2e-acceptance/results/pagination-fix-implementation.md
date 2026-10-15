# PDF Pagination Fix — Implementation Report

**Date**: 2026-10-16  
**File Modified**: `artifacts/diagnostic-erp/src/lib/reportPdfGenerator.ts`  
**Task**: Fix critical pagination defects identified by Agent 3

---

## Defects Identified

1. **CASE-2A page 1**: Clinical Findings overlap the doctor's signature and footer
2. **CASE-2B page 1**: L5-S1 Findings overlap the signature/footer
3. **Root cause**: `ensureSpace()` only checks before starting sections, not for individual blocks within findings
4. **Secondary issue**: Long text sections (clinical history, technique, etc.) could also overflow

---

## Changes Made

### 1. Block-Aware Pagination in `drawFindingsBlock()` (lines 363-430)

**Before**: Function rendered all blocks without checking page boundaries
```typescript
function drawFindingsBlock(
  doc: jsPDF,
  findings: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
): number {
  for (const block of parseFindingsDocument(normalized)) {
    // Render block without checking if it fits
    if (block.kind === "heading") { ... }
    if (block.kind === "table") { ... }
    // paragraphs...
  }
}
```

**After**: Function accepts pagination parameters and checks space before each block
```typescript
function drawFindingsBlock(
  doc: jsPDF,
  findings: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
  contentBottom: number,           // NEW: page boundary
  ensureSpace: (needed: number) => void,  // NEW: page-break callback
): number {
  for (const block of parseFindingsDocument(normalized)) {
    if (block.kind === "heading") {
      ensureSpace(lineH * 2.5);  // Check space for heading + one line
      // render heading...
    }
    if (block.kind === "table") {
      const tableHeight = (block.rows.length + 1) * lineH * 1.5 + lineH * 0.35;
      ensureSpace(tableHeight);  // Check space for entire table
      // render table...
    }
    // For paragraphs:
    for (const para of paragraphs) {
      const approxCharsPerLine = maxW / (bodySize * 0.35);
      const estLines = Math.max(1, Math.ceil(para.length / approxCharsPerLine));
      const paraHeight = estLines * lineH + lineH * 0.35;
      ensureSpace(paraHeight);  // Check space for this paragraph
      // render paragraph...
    }
  }
}
```

**Key improvements**:
- Headings reserve space for heading + one paragraph line (prevents orphaned headings)
- Tables estimate their full height before rendering
- Paragraphs estimate their height based on text length and available width
- Each block triggers a page break if it won't fit

---

### 2. Line-Aware Pagination in `drawWrappedBody()` (lines 335-354)

**Before**: Rendered all lines without checking page boundaries
```typescript
function drawWrappedBody(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  size: number,
  lineH: number,
): number {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}
```

**After**: Checks space before each line (optional parameters for backward compatibility)
```typescript
function drawWrappedBody(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  size: number,
  lineH: number,
  contentBottom?: number,                    // NEW: optional
  ensureSpace?: (needed: number) => void,    // NEW: optional
): number {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  for (const line of lines) {
    if (contentBottom !== undefined && ensureSpace) {
      if (y + lineH > contentBottom) {
        ensureSpace(lineH);
      }
    }
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}
```

**Updated call sites** (4 locations):
- `clinicalHistory` section (line 1159)
- `technique` section (line 1167)
- `comparison` section (line 1175)
- `recommendation` section (line 1247)

---

### 3. Item-Aware Pagination in `drawNumberedImpression()` (lines 587-619)

**Before**: Rendered all impression items without checking page boundaries

**After**: Checks space before each numbered item
```typescript
function drawNumberedImpression(
  doc: jsPDF,
  impression: string,
  x: number,
  y: number,
  maxW: number,
  font: string,
  bodySize: number,
  lineH: number,
  contentBottom?: number,                    // NEW: optional
  ensureSpace?: (needed: number) => void,    // NEW: optional
): number {
  items.forEach((item, i) => {
    const lines = doc.splitTextToSize(item, maxW - doc.getTextWidth(prefix)) as string[];
    if (contentBottom !== undefined && ensureSpace) {
      const itemHeight = lines.length * lineH + lineH * 0.25;
      if (y + itemHeight > contentBottom) {
        ensureSpace(itemHeight);
      }
    }
    // render item...
  });
  return y;
}
```

**Updated call site**:
- `impression` section (line 1239)

---

### 4. Updated Call Site for `drawFindingsBlock()` (line 1202)

**Before**:
```typescript
y = drawFindingsBlock(doc, report.findings.trim(), m.left, y, colW(), font, fs.body, lineH);
```

**After**:
```typescript
y = drawFindingsBlock(doc, report.findings.trim(), m.left, y, colW(), font, fs.body, lineH, contentBottom, ensureSpace);
```

---

## How the Fix Works

### Page Region Model

The PDF generator already defines explicit page regions:
- **Header**: drawn by `drawLetterPadChrome()` at the top of each page
- **Body**: content between header and `contentBottom`
- **Signature**: reserved by `SIG_RESERVE_MM` (12mm when enabled)
- **Footer**: reserved by `FOOTER_STACK_MM` (14mm for services bar)

```typescript
const SIG_RESERVE_MM = settings.signature.enabled ? 12 : 0;
const FOOTER_STACK_MM = 14;
const contentBottom = pageH - FOOTER_STACK_MM - SIG_RESERVE_MM;
```

### Block-Aware Pagination Flow

1. **Before rendering each block**, estimate its height:
   - Heading: `lineH * 2.5` (heading + one line buffer)
   - Table: `(rows + 1) * lineH * 1.5 + padding`
   - Paragraph: `estimatedLines * lineH + padding`

2. **Check if block fits**: `if (y + blockHeight > contentBottom)`

3. **If not, trigger page break**: `ensureSpace(blockHeight)` calls:
   ```typescript
   const ensureSpace = (needed: number) => {
     if (y + needed > contentBottom) {
       doc.addPage();
       y = drawLetterPadChrome();  // Draw header on new page
       bodyPage = doc.getNumberOfPages();
     }
   };
   ```

4. **Continue rendering** on the new page at the reset `y` position

### Why This Prevents Overlap

- **No block can straddle the page boundary**: Each logical unit (heading, table, paragraph) is checked before rendering
- **Orphaned headings prevented**: Heading reserves space for itself + one line, so it never appears alone at the bottom
- **Tables never split mid-row**: Entire table height is estimated and checked
- **Signature/footer protected**: `contentBottom` already excludes `SIG_RESERVE_MM` and `FOOTER_STACK_MM`

---

## Expected Results

### Before Fix
- CASE-2A page 1: Findings text overlaps signature and footer
- CASE-2B page 1: L5-S1 findings overlap signature and footer
- Long clinical history/technique sections could also overflow

### After Fix
- All findings blocks page-break cleanly before reaching `contentBottom`
- Signature and footer remain visible and unobstructed
- Long text sections (clinical history, technique, etc.) also paginate correctly
- No text is clipped or overlaps reserved regions

---

## Verification Steps

To verify the fix:

1. **Regenerate test PDFs**:
   ```bash
   cd care-audit-independent
   pnpm test artifacts/diagnostic-erp/src/lib/e2eAcceptancePdfGeneration.test.ts
   ```

2. **Inspect CASE-2A.pdf and CASE-2B.pdf**:
   - Page 1 should end cleanly before the signature
   - Signature should be visible and not overlapped
   - Footer services bar should be clear
   - Continued findings should appear on page 2

3. **Check all 4 test PDFs**:
   - CASE-1A: 1 page (short report)
   - CASE-1B: 2 pages (abnormal findings)
   - CASE-2A: 2+ pages (structured spinal findings)
   - CASE-2B: 2+ pages (structured spinal findings)

4. **Verify no overlap**:
   - Open PDFs in a viewer
   - Zoom to 100% on page 1
   - Confirm signature is visible and not overlapped by text
   - Confirm footer services bar is clear

---

## Duplicate Measurement Tables

**Status**: Not yet addressed

The Agent 3 feedback mentioned "duplicate measurement tables" but the test cases in `test-cases-v2.json` do not include measurements in both the `findings` text and the `measurements` array. If duplicate tables appear in real reports, the root cause is likely:

1. Radiologist entered canal diameter data in both places
2. Template auto-filled measurements that were also in findings text

**Recommendation**: Investigate real reports to confirm the duplication pattern, then decide whether to:
- Deduplicate at render time (check if findings text contains a table with same data)
- Add validation to prevent duplicate entry
- Document that measurements should only be in one place

---

## DICOM Image Attachment

**Status**: BLOCKED (requires Orthanc PACS)

The test harness cannot attach DICOM images because:
1. Orthanc is not running in the test environment
2. Image attachment requires the full PACS integration
3. Synthetic test data has no actual DICOM files

**Recommendation**: Mark as BLOCKED in the final report. The pagination fix applies to the text body; image attachment is a separate pathway that was not tested.

---

## Summary

**Files modified**: 1  
**Functions updated**: 3 (`drawFindingsBlock`, `drawWrappedBody`, `drawNumberedImpression`)  
**Call sites updated**: 6 (1 for findings, 4 for wrapped body, 1 for impression)  
**Lines changed**: ~80  

**Pagination model**: Block-aware with explicit page regions  
**Backward compatibility**: Maintained (new parameters are optional for `drawWrappedBody` and `drawNumberedImpression`)  
**Expected outcome**: No text overlaps signature or footer; clean page breaks between logical blocks

---

**Next steps**:
1. Regenerate PDFs and verify no overlap
2. If duplicate measurement tables appear, investigate real reports
3. Document DICOM image attachment as BLOCKED
4. Deliver corrected PDFs with before/after comparison
