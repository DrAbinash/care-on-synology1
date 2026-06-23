import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableCell, TableRow, WidthType, BorderStyle, convertInchesToTwip,
  Header, Footer, PageNumber,
} from "docx";
import fs from "node:fs";

const headingOpts = { bold: true, size: 28, color: "1a1a1a", font: "Calibri" };
const subheadingOpts = { bold: true, size: 24, color: "1a1a1a", font: "Calibri" };
const bodyOpts = { size: 22, color: "333333", font: "Calibri" };

function h1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { after: 240 } });
}
function h2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { after: 200, before: 300 } });
}
function h3(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { after: 160, before: 240 } });
}
function p(...children: (string | TextRun)[]): Paragraph {
  const runs = children.map((c) => (typeof c === "string" ? new TextRun({ text: c, ...bodyOpts }) : c));
  return new Paragraph({ children: runs, spacing: { after: 160 } });
}
function b(text: string): TextRun {
  return new TextRun({ text, bold: true, ...bodyOpts });
}
function i(text: string): TextRun {
  return new TextRun({ text, italics: true, ...bodyOpts });
}
function code(text: string): TextRun {
  return new TextRun({ text, font: "Courier New", size: 20, color: "444444" });
}

function table(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map((h) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, ...bodyOpts })] })],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          },
        })),
      }),
      ...rows.map((row) => new TableRow({
        children: row.map((cell) => new TableCell({
          children: [new Paragraph({ text: cell, ...bodyOpts })],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
          },
        })),
      })),
    ],
  });
}

const doc = new Document({
  sections: [{
    properties: {
      page: { margin: { top: convertInchesToTwip(1), right: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1) } },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({ children: [new TextRun({ text: "Care Diagnostics \u2014 TextRad-Inspired Radiology Reporting Integration", size: 18 })] })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({ text: "Page ", alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })],
      }),
    },
    children: [
      new Paragraph({
        text: "TextRad-Inspired Feature Integration Document",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
      new Paragraph({
        text: "Care Diagnostics Diagnostic ERP \u2014 Radiology Report Generator Enhancement",
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      p("Version 1.0 \u2014 May 2026"),
      p("This document describes the complete integration of TextRad-inspired features into the existing Care Diagnostics Radiology Report Generator. All features are built, tested, and deployed within the existing pnpm monorepo architecture."),

      h1("1. Executive Summary"),
      p("The Radiology Report Generator in Care Diagnostics has been enhanced with five major TextRad-inspired feature groups that improve radiologist workflow efficiency, report consistency, and user experience:"),
      p("1. \u00a0\u00a0", b("Text Macros"), " \u2014 User-defined shortcut expansions for rapid dictation and typing."),
      p("2. \u00a0\u00a0", b("Report Preferences"), " \u2014 Per-user formatting controls for heading case, spacing, impression style, headers, and footers."),
      p("3. \u00a0\u00a0", b("Workspace Layouts"), " \u2014 Three layout modes (3-Panel, Preview-First, Workflow) with localStorage persistence."),
      p("4. \u00a0\u00a0", b("Enhanced Template Library"), " \u2014 Modality filter pills, live search with result counts, and recently-used tracking."),
      p("5. \u00a0\u00a0", b("Enhanced Dictation"), " \u2014 Full-screen overlay with real-time transcript display and insert-into-report capability."),
      p("All features integrate cleanly into the existing ", code("/radiology/report-generator"), " page and ", code("radiology_report_drafts"), " table without modifying PACS, DICOM, or worklist infrastructure."),

      h1("2. Architecture Overview"),
      h2("2.1 Database Schema Additions"),
      p("Two new tables were added to the existing ", code("lib/db/src/schema/radiologyReportGenerator.ts"), " schema file:"),
      h3("radiology_text_macros"),
      table(
        ["Column", "Type", "Description"],
        [
          ["id", "SERIAL PRIMARY KEY", "Auto-incrementing identifier"],
          ["created_by", "TEXT NOT NULL", "Staff username / full name who created the macro"],
          ["shortcut", "TEXT NOT NULL", "Trigger text (e.g. .pol)"],
          ["expansion", "TEXT NOT NULL", "Full replacement text"],
          ["modality", "TEXT", "Optional filter: MRI | CT | USG | X-RAY"],
          ["is_global", "BOOLEAN DEFAULT FALSE", "Admin-created macros visible to all users"],
          ["sort_order", "INTEGER DEFAULT 0", "Display ordering"],
          ["created_at / updated_at", "TIMESTAMPTZ", "Audit timestamps"],
        ],
      ),
      h3("radiology_report_preferences"),
      table(
        ["Column", "Type", "Description"],
        [
          ["id", "SERIAL PRIMARY KEY", "Auto-incrementing identifier"],
          ["user_id", "INTEGER NOT NULL UNIQUE", "FK to staff.id \u2014 one row per user"],
          ["heading_case", "TEXT DEFAULT 'all_caps'", "Section heading case: all_caps | title_case"],
          ["section_spacing", "TEXT DEFAULT 'spaced'", "Section spacing: spaced | compact"],
          ["impression_style", "TEXT DEFAULT 'bulleted'", "Impression format: bulleted | numbered | plain"],
          ["show_end_of_report_footer", "BOOLEAN DEFAULT TRUE", "Toggle disclaimer footer"],
          ["footer_text", "TEXT", "Optional text above disclaimer"],
          ["header_line_1", "TEXT", "Institution/department header line"],
          ["header_line_2_source", "TEXT DEFAULT 'template_name'", "Line 2 source: template_name | custom"],
          ["header_line_2_custom", "TEXT", "Custom line 2 text"],
          ["workspace_layout", "TEXT DEFAULT '3_panel'", "Preferred layout: 3_panel | preview_first | workflow"],
          ["created_at / updated_at", "TIMESTAMPTZ", "Audit timestamps"],
        ],
      ),

      h2("2.2 Backend API Endpoints"),
      p("All new endpoints are mounted under ", code("/api/radiology/report-generator"), " in ", code("artifacts/api-server/src/routes/radiology-report-generator.ts"), ". They inherit the existing ", code("requireStaffAuth + requireStaffPermission(\"/orders\")"), " middleware chain."),
      table(
        ["Method", "Endpoint", "Description", "Auth"],
        [
          ["GET", "/macros", "List macros for user + globals", "Staff"],
          ["POST", "/macros", "Create a new macro", "Staff"],
          ["PUT", "/macros/:id", "Update a macro (owner or super-admin)", "Staff"],
          ["DELETE", "/macros/:id", "Delete a macro (owner or super-admin)", "Staff"],
          ["GET", "/preferences", "Fetch current user's preferences", "Staff"],
          ["PUT", "/preferences", "Create or update preferences", "Staff"],
        ],
      ),
      p("The existing ", code("POST /generate"), " endpoint was extended to accept an optional ", code("preferences"), " object, which is passed into the preference-aware ", code("buildReportHtml"), " function."),

      h2("2.3 Startup Migrations"),
      p("Both tables are created via ", code("CREATE TABLE IF NOT EXISTS"), " inside the existing ", code("runStartupMigrations()"), " function in ", code("artifacts/api-server/src/index.ts"), ". This guarantees the schema exists on every server startup without requiring manual migration runs."),

      h1("3. Feature Specifications"),

      h2("3.1 Phase 1: Text Macros"),
      h3("Purpose"),
      p("Radiologists repeatedly type the same phrases (e.g., \"polydipsia, polyuria, and polyphagia\"). Text macros let them define a shortcut (e.g., ", code(".pol"), ") that expands inline in any text field."),
      h3("User Flow"),
      p("1. \u00a0\u00a0Click the ", b("Macros"), " button in the report generator header."),
      p("2. \u00a0\u00a0The macro manager modal opens, showing existing macros."),
      p("3. \u00a0\u00a0Enter a shortcut (e.g. ", code(".hcc"), ") and expansion text, optionally select a modality filter."),
      p("4. \u00a0\u00a0Click the + button to save."),
      p("5. \u00a0\u00a0In any report field (Clinical History, Findings, Impression, Recommendation), type the shortcut followed by Space or Enter \u2014 it expands immediately."),
      h3("Security"),
      p("\u2022 Macros are scoped per-user by ", code("createdBy"), " (staff subjectName)."),
      p("\u2022 Super-admins can create ", code("isGlobal = true"), " macros visible to all users."),
      p("\u2022 Edit/delete operations verify ownership or super-admin role server-side."),
      p("\u2022 Expansion is limited to 2000 characters to prevent accidental abuse."),

      h2("3.2 Phase 2: Report Preferences"),
      h3("Purpose"),
      p("Different radiologists and institutions have different report formatting conventions. Preferences let each user control how the generated HTML report looks without changing templates."),
      h3("Settings Available"),
      table(
        ["Setting", "Options", "Effect"],
        [
          ["Heading Case", "ALL CAPS / Title Case", "Changes section headings (TECHNIQUE, FINDINGS, etc.)"],
          ["Section Spacing", "Spaced / Compact", "Margin between sections (10px vs 2px)"],
          ["Impression Style", "Bulleted / Numbered / Plain", "List formatting in Impression section"],
          ["End-of-Report Footer", "On / Off", "Show/hide disclaimer and optional footer text"],
          ["Footer Text", "Custom string", "Line above disclaimer (e.g. department name)"],
          ["Header Line 1", "Custom string", "Replaces patient demographics header (institution name)"],
          ["Header Line 2", "Template name / Custom", "Second header line content"],
        ],
      ),
      h3("User Flow"),
      p("1. \u00a0\u00a0Click ", b("Preferences"), " in the report generator header."),
      p("2. \u00a0\u00a0The preferences modal opens with current settings."),
      p("3. \u00a0\u00a0Toggle heading case, spacing, impression style, footer options, and header lines."),
      p("4. \u00a0\u00a0Click ", b("Save Preferences"), " \u2014 persisted to the database and applied immediately to the next report generation."),

      h2("3.3 Phase 3: Workspace Layouts"),
      h3("Purpose"),
      p("Radiologists work differently: some want editor + preview side-by-side, some want a wide preview, and trainees benefit from a guided 3-step workflow. Three layout modes accommodate all use cases."),
      h3("Layout Modes"),
      table(
        ["Layout", "Description", "Best For"],
        [
          ["3-Panel", "Template sidebar (left) + Editor (center) + Preview (right)", "Power users who need full context"],
          ["Preview-First", "Wider preview pane with condensed sidebar", "Review-focused workflows"],
          ["Workflow", "Guided 3-step: Template \u2192 Enter Findings \u2192 Preview & Save", "Trainees and structured reporting"],
        ],
      ),
      h3("User Flow"),
      p("1. \u00a0\u00a0Three layout toggle buttons sit in the page header: 3-Panel, Preview, Workflow."),
      p("2. \u00a0\u00a0Click any button \u2014 layout switches instantly."),
      p("3. \u00a0\u00a0Preference is saved to ", code("localStorage"), " (key: ", code("rrg_layout"), ") and synced with the database preference row."),
      p("4. \u00a0\u00a0In Workflow mode, a step indicator bar shows progress: 1. Select Template \u2192 2. Enter Findings \u2192 3. Preview & Save."),

      h2("3.4 Phase 4: Enhanced Template Library"),
      h3("Purpose"),
      p("The existing template selector was a basic dropdown. The enhanced library adds modality filtering, search, and recently-used tracking for faster template selection."),
      h3("Features"),
      p("\u2022 ", b("Modality Pills:"), " Horizontal pill buttons (All, Recent, CT, MRI, USG, X-RAY) with live counts."),
      p("\u2022 ", b("Live Search:"), " Search box filters templates by study name and technique in real time."),
      p("\u2022 ", b("Recently Used:"), " The \"Recent\" pill shows the last 10 selected templates."),
      p("\u2022 ", b("Result Counter:"), " Header shows \"N results\" so users know when filters are too narrow."),
      p("\u2022 ", b("Technique Preview:"), " Each template row shows the technique description in muted text."),
      h3("User Flow"),
      p("1. \u00a0\u00a0The template library is always visible in the left sidebar."),
      p("2. \u00a0\u00a0Type in the search box to filter."),
      p("3. \u00a0\u00a0Click a modality pill to narrow by modality."),
      p("4. \u00a0\u00a0Click any template row \u2014 it becomes selected, is added to Recent, and search/pill filters reset."),

      h2("3.5 Phase 5: Enhanced Dictation"),
      h3("Purpose"),
      p("The existing per-field VoiceDictationButton works well for small snippets, but radiologists often dictate entire paragraphs. The enhanced dictation overlay provides a full-screen, real-time transcript experience."),
      h3("Features"),
      p("\u2022 ", b("Full-Screen Overlay:"), " Modal covers the entire screen with a dark backdrop, eliminating distractions."),
      p("\u2022 ", b("Real-Time Transcript:"), " Interim results are shown live as the user speaks."),
      p("\u2022 ", b("Start / Stop / Clear / Insert:"), " Four control buttons for full session management."),
      p("\u2022 ", b("Insert into Report:"), " On click, the cleaned transcript is appended to the Clinical History field."),
      p("\u2022 ", b("Fallback:"), " If Web Speech API is unavailable, the user can type directly into the transcript box."),
      h3("User Flow"),
      p("1. \u00a0\u00a0Click the ", b("Dictate"), " button in the header."),
      p("2. \u00a0\u00a0The overlay opens with a large textarea and a Start Listening button."),
      p("3. \u00a0\u00a0Click Start \u2014 the microphone activates and transcript appears live."),
      p("4. \u00a0\u00a0Click Stop when finished."),
      p("5. \u00a0\u00a0Click Insert into Report \u2014 the transcript is appended to Clinical History."),
      p("6. \u00a0\u00a0The existing per-field VoiceDictationButton remains available for quick snippets."),

      h1("4. Implementation Details"),
      h2("4.1 File Changes Summary"),
      table(
        ["File", "Change Type", "Description"],
        [
          ["lib/db/src/schema/radiologyReportGenerator.ts", "Add", "New tables: radiology_text_macros, radiology_report_preferences"],
          ["lib/db/src/schema/index.ts", "Add", "Export new tables"],
          ["artifacts/api-server/src/index.ts", "Add", "Startup migration SQL for both tables"],
          ["artifacts/api-server/src/routes/radiology-report-generator.ts", "Add/Modify", "New endpoints + preference-aware buildReportHtml + fmtHeading helper"],
          ["artifacts/diagnostic-erp/src/pages/RadiologyReportGenerator.tsx", "Rewrite", "Complete integration of all 5 phases with new state, UI, and effects"],
        ],
      ),

      h2("4.2 buildReportHtml Enhancement"),
      p("The existing ", code("buildReportHtml"), " function was enhanced to accept an optional ", code("preferences"), " object. It now uses two helper functions:"),
      p("\u2022 ", code("fmtHeading(text, headingCase)"), " \u2014 Converts section names to ALL CAPS or Title Case."),
      p("\u2022 Dynamic spacing variables (", code("sp"), ", ", code("sp2"), ") \u2014 Set to 2px/4px for compact or 10px/12px for spaced."),
      p("\u2022 Conditional header block \u2014 If ", code("headerLine1"), " is set, it replaces the default patient demographics header with a two-line institutional header."),
      p("\u2022 Conditional footer block \u2014 If ", code("showEndOfReportFooter"), " is true, the disclaimer and optional footer text are rendered."),
      p("\u2022 Impression style switch \u2014 Renders <ul>, <ol>, or plain <p> based on ", code("impressionStyle"), "."),

      h2("4.3 Security & Authorization"),
      p("All new endpoints follow the existing security model:"),
      p("\u2022 ", code("requireStaffAuth"), " validates the Bearer token and loads the user record."),
      p("\u2022 ", code("requireStaffPermission(\"/orders\")"), " gates access to the radiology module."),
      p("\u2022 Macro ownership is enforced by comparing ", code("createdBy"), " (staff subjectName) with the authenticated session."),
      p("\u2022 Super-admin bypass allows editing/deleting any macro and creating global macros."),
      p("\u2022 No patient data is exposed through macro or preference endpoints."),

      h1("5. Testing Checklist"),
      table(
        ["Test", "Status"],
        [
          ["Typecheck passes for all workspace packages (api-server, diagnostic-erp, etc.)", "PASS"],
          ["Startup migrations create tables on first boot", "PASS"],
          ["GET /macros returns user macros + globals", "PASS"],
          ["POST /macros creates a macro with correct owner", "PASS"],
          ["PUT /macros/:id rejects non-owner non-super-admin", "PASS"],
          ["DELETE /macros/:id rejects non-owner non-super-admin", "PASS"],
          ["GET /preferences returns defaults for new users", "PASS"],
          ["PUT /preferences creates row on first save", "PASS"],
          ["Report generation applies heading case, spacing, impression style", "PASS"],
          ["Layout toggle persists in localStorage", "PASS"],
          ["Template search filters by name and technique", "PASS"],
          ["Modality pills show correct counts", "PASS"],
          ["Recently used templates track correctly", "PASS"],
          ["Dictation overlay starts/stops/clears/inserts correctly", "PASS"],
          ["Inline macro expansion works on Space and Enter", "PASS"],
        ],
      ),

      h1("6. Future Enhancements"),
      p("The following features are natural extensions of this integration and are documented here for roadmap planning:"),
      p("\u2022 ", b("Template Upload (DOCX/PDF):"), " Allow users to upload branded Word/PDF templates. AI detects placeholder locations (patient name, age, findings) and fills the report content into the template body."),
      p("\u2022 ", b("AI Macro Suggestions:"), " Based on the user's most common phrases, suggest new macros automatically."),
      p("\u2022 ", b("Macro Sharing:"), " Allow radiologists to share macros within a department."),
      p("\u2022 ", b("Custom CSS Themes:"), " Let users upload a custom stylesheet for report preview."),
      p("\u2022 ", b("Keyboard Shortcuts:"), " Add global shortcuts (e.g. Ctrl+M for macros, Ctrl+P for preferences)."),
      p("\u2022 ", b("Mobile-Optimized Dictation:"), " Improve the dictation overlay for tablet-based reporting."),

      h1("7. Deployment Notes"),
      p("\u2022 No new environment variables are required."),
      p("\u2022 The existing ", code("ENABLE_SCHEDULERS"), " and ", code("DATABASE_URL"), " secrets continue to work."),
      p("\u2022 Tables are created automatically via startup migrations \u2014 no manual migration step needed."),
      p("\u2022 The frontend is a single-file component update \u2014 no new build artifacts or route changes."),
      p("\u2022 All changes are backward-compatible: existing drafts and reports continue to work."),

      new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "\u2014 End of Document \u2014", italics: true, size: 20, color: "666666" }),
      ]}),
    ],
  }],
});

const outPath = "./TextRad_Feature_Integration_Document.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("Document written to:", outPath);
});
