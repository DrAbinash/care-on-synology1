# Implementation Plan: USG Phase 8 — AI Sonologist Assistant

We will implement a production-grade AI Sonologist Assistant that integrates with the USG/Doppler reporting workflow to assist doctors without replacing them, never auto-finalizing, and keeping all recommendations editable.

---

## Proposed Changes

### Database Schema

We will safely extend the database to support per-radiologist learning preferences.

#### [NEW] [radiologistLearningSettings.ts](file:///c:/Users/abina/caredeoghar--antigravity/lib/db/src/schema/radiologistLearningSettings.ts)
* Create `radiologistLearningSettingsTable` to track learning permissions per radiologist:
  ```typescript
  import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
  import { staffTable } from "./staff";

  export const radiologistLearningSettingsTable = pgTable("radiologist_learning_settings", {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id),
    learningEnabled: boolean("learning_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
  ```

---

### Backend API Server

We will build the endpoints for draft generation, missing check checklists, quality reviews, copilot edits, voice post-processing, and learning settings.

#### [NEW] [sonologistAssistant.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/sonologistAssistant.ts)
* Create backend route handlers mounted under `/api/radiology-copilot/sonologist-assistant`:
  1. `GET /checklist/:studyId`: Inspect measurements matching the study category (OB, Pelvis, Abdomen, Doppler) and returns missing mandatory parameters.
  2. `GET /quality-review/:studyId`: Perform validation checks:
     * Gestational Age & EDD consistency (LMP vs Biometrics)
     * Left/Right measurements compatibility (e.g. check if right kidney length is set but left is null)
     * Contradictory findings (e.g. text says "normal gallbladder" but GB wall thickness measures >3mm)
     * Returns list of alerts marked `PASS`, `WARNING`, or `CRITICAL`.
  3. `POST /generate-drafts`: Synthesize findings draft, impression draft, follow-up suggestions, and prior comparison text using approved measurements.
  4. `POST /copilot-action`: Perform NLP optimizations: Suggest Wording, Improve Grammar, Standardize Terminology, Patient Summary, Refer Summary, and Differential Diagnoses (flagged clearly as AI recommendations).
  5. `POST /voice-integration`: Post-process voice text to expand abbreviations (e.g. BPD -> biparietal diameter), standardize terminology, and highlight uncertain phrases.
  6. `GET/POST /learning-settings`: Fetch and toggle learning options per radiologist.
  7. `POST /learn`: Extract template snippets from finalized reports if learning is enabled for the doctor.

#### [MODIFY] [index.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/index.ts)
* Register the new `/api/radiology-copilot/sonologist-assistant` router.

---

### Frontend Applications

We will implement the Sonologist Assistant Panel and place it side-by-side with the Report Editor.

#### [NEW] [SonologistAssistantPanel.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/components/SonologistAssistantPanel.tsx)
* Build a side panel containing tabs for:
  * **Clinical Assistant**: One-click generation of findings, impressions, recommendations, comparisons, and missing measurements checklists.
  * **Quality Checker**: Live visual alerts showing PASS, WARNING, and CRITICAL indicators for inconsistencies.
  * **Co-pilot Tab**: Quick buttons to edit and format the active text selection (grammar correction, terminology standardization, generating summaries, suggesting differentials).
  * **Voice Tab**: Audio post-processing controls (expand abbreviations, flag uncertainty).
  * **Learning Toggle**: Simple switch allowing the doctor to enable/disable templates learning.

#### [MODIFY] [UsgReporting.tsx](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/diagnostic-erp/src/pages/UsgReporting.tsx)
* Embed `<SonologistAssistantPanel>` side-by-side with the Report Editor textareas when editing a report draft.

---

## Verification Plan

### Automated Tests
- Run backend typechecks and frontend builds:
  ```bash
  pnpm run typecheck
  pnpm run build
  ```

### Manual Verification
1. Open the USG Reporting page.
2. Load an OB or Abdomen scan draft.
3. Verify the **AI Sonologist Assistant** panel appears beside the editor.
4. Test the **Quality Review** tab to ensure it detects impossible values or contradictions (e.g. setting CRL to an impossible number or leaving AFI missing).
5. Paste a draft and click **Improve Grammar** / **Standardize Terminology** to see AI changes in real-time.
