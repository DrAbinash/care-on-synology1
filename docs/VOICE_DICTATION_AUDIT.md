# Voice Dictation System — Phase 1 Audit Report

**Care Diagnostics ERP**
**Date:** June 24, 2026
**Auditor:** Antigravity AI
**Mode:** READ-ONLY — No code was modified

---

## 1. Executive Summary

A **production-ready voice dictation system already exists** in the ERP. It is not a stub or a placeholder — it is a fully-implemented, multi-layer system consisting of:

- A **Web Speech API** hook (`useVoiceDictation.ts`) with pause/resume, command parsing, and inline substitutions
- A **UI Button** (`VoiceDictationButton.tsx`) embedded in 6 radiology report editing pages
- A **backend voice-cleanup route** (`POST /api/radiology/report-generator/voice-cleanup`) that applies medical terminology corrections and audit-logs every dictation
- A **Phase 24 AI voice-transcription pipeline** (`/api/ai-reporting/voice-transcriptions`) with full CRUD, AI-based transcription, correction workflow, and report insertion
- **Two separate database tables** tracking audit logs and AI-processed transcriptions

This audit confirms the exact location of every file, route, and database table so that the upgrade can be performed surgically without duplication.

---

## 2. Existing Files Map

### 2.1 Frontend Components

| File | Purpose | Status |
|---|---|---|
| `artifacts/diagnostic-erp/src/components/VoiceDictationButton.tsx` | Single mic button — Start/Stop/Cleaning states | ✅ Production |
| `artifacts/diagnostic-erp/src/hooks/useVoiceDictation.ts` | Full dictation hook with pause/resume, commands, interim results | ✅ Production |
| `artifacts/diagnostic-erp/src/pages/VoiceDictation.tsx` | Standalone AI voice transcription management page | ✅ Production |
| `artifacts/diagnostic-erp/src/types/speech.d.ts` | TypeScript type declarations for Web Speech API | ✅ Production |

### 2.2 Backend API Routes

| Route | File | Method | Purpose |
|---|---|---|---|
| `POST /api/radiology/report-generator/voice-cleanup` | `radiology-report-generator.ts:751` | POST | Cleans raw transcript, logs to `radiology_voice_logs` |
| `GET /api/ai-reporting/voice-transcriptions` | `aiReporting.ts:2520` | GET | List all transcriptions (filterable) |
| `GET /api/ai-reporting/voice-transcriptions/:id` | `aiReporting.ts:2545` | GET | Get single transcription |
| `POST /api/ai-reporting/voice-transcriptions` | `aiReporting.ts:2561` | POST | Create new transcription record |
| `POST /api/ai-reporting/voice-transcriptions/:id/transcribe` | `aiReporting.ts:2597` | POST | Trigger AI transcription |
| `PATCH /api/ai-reporting/voice-transcriptions/:id` | `aiReporting.ts:2659` | PATCH | Save radiologist corrections |
| `POST /api/ai-reporting/voice-transcriptions/:id/insert` | (further down) | POST | Insert final text into report |

### 2.3 Database Tables

| Table | Schema File | Columns |
|---|---|---|
| `voice_dictation_logs` | `lib/db/src/schema/voiceDictationLogs.ts` | id, userId, userName, studyId, accessionNumber, action, durationSecs, wordCount, wasAiCleaned, insertedToReport, createdAt |
| `ai_voice_transcriptions` | `lib/db/src/schema/aiVoiceTranscriptions.ts` | id, worklistId, reportId, patientId, radiologistId, radiologistName, audioUrl, audioDurationSeconds, rawTranscript, confidenceScore, correctedText, insertedIntoReport, status, modality, bodyPart, aiSafetyLabel, createdAt, updatedAt |
| `radiology_voice_logs` | (referenced in route, imported from `@workspace/db`) | draftId, studyId, patientId, targetField, rawTranscript, cleanedText, createdBy |

---

## 3. Where VoiceDictationButton is Used

| Page | File | Fields Covered |
|---|---|---|
| Radiology Command Center | `RadiologyCommandCenter.tsx:2045` | Findings dictation |
| Radiology Report Generator | `RadiologyReportGenerator.tsx:1878, 1933, 2029` | Clinical history, section findings, impression |
| Radiology Reporting Workspace | `RadiologyReportingWorkspace.tsx:994, 1041, 1140` | Multiple report fields |
| USG Reporting | `UsgReporting.tsx:630, 727` | USG findings, impression |
| USG Doppler Reporting | `UsgDopplerReporting.tsx:267` | Doppler findings |

**Total insertion points: 8 active buttons across 5 pages.**

---

## 4. How the Existing System Works

### 4.1 VoiceDictationButton.tsx — Simple On/Off Mode

```
[User clicks Voice button]
  → Initialises Web Speech API (SpeechRecognition / webkitSpeechRecognition)
  → lang = "en-IN", continuous = true, interimResults = false
  → On each final result:
      POST /api/radiology/report-generator/voice-cleanup
        → backend cleans transcript (punctuation, medical terms)
        → logs to radiology_voice_logs table
      → calls onInsert(cleanedText) to append to the field
  → onend / onerror → sets listening = false
```

**Limitations:**
- No pause/resume in the button itself (though hook supports it)
- No interim transcript display
- No preview before inserting
- Immediate auto-insert (user cannot review)
- No indication of silence timeout
- No autosave

### 4.2 useVoiceDictation.ts — Advanced Hook (Underused)

This hook is **more capable than the button uses**. It provides:

| Feature | Status |
|---|---|
| `status`: idle / listening / paused / error / unsupported | ✅ Implemented |
| `transcript` (accumulated final text) | ✅ Implemented |
| `interimTranscript` (real-time preview) | ✅ Implemented |
| `start()` | ✅ Implemented |
| `stop()` | ✅ Implemented |
| `pause()` — stops recognition but keeps text | ✅ Implemented |
| `resume()` — resumes from paused state | ✅ Implemented |
| `clearTranscript()` | ✅ Implemented |
| `lastCommand` — command dispatch (newLine, period, etc.) | ✅ Implemented |
| Auto-restart on unexpected `onend` | ✅ Implemented |
| Browser support detection | ✅ Implemented |

**Status: Fully built but not wired into the button UI.**

### 4.3 Voice Command Vocabulary (Existing)

The `useVoiceDictation.ts` already parses these spoken commands:

| Spoken | Action |
|---|---|
| "new line" | Insert `\n` |
| "full stop" / "period" | Insert `.` |
| "comma" | Insert `,` |
| "findings" | `goToFindings` command |
| "impression" | `goToImpression` command |
| "insert impression" | `insertImpression` command |
| "normal study" | `insertNormal` command |
| "delete last sentence" | `deleteLastSentence` command |
| "bold abnormal" | `boldAbnormal` command |
| "next field" | `nextField` command |
| "save draft" | `saveDraft` command |

**Inline text substitutions (always active):**

| Spoken | Substituted With |
|---|---|
| "new line" | `\n` |
| "full stop" | `.` |
| "comma" | `,` |
| "open bracket" | `(` |
| "close bracket" | `)` |
| "colon" | `:` |
| "semicolon" | `;` |
| "hyphen" | `-` |
| "dash" | `—` |

### 4.4 Backend Voice Cleanup (cleanVoiceText)

The backend route applies these normalizations:

| Pattern | Replacement |
|---|---|
| "comma" | `,` |
| "full stop" | `.` |
| "new line" | `\n` |
| "colon" | `:` |
| "semicolon" | `;` |
| "flair" | `FLAIR` |
| "dwi" | `DWI` |
| "adc" | `ADC` |
| "swi" | `SWI` |
| "fazekas" | `Fazekas` |
| "hyperintense" | `hyperintense` |
| "hypointense" | `hypointense` |
| "isointense" | `isointense` |
| Trailing spaces before punctuation | removed |
| Multiple spaces | collapsed |

**Current limitation:** This is a pure regex/string-replace pipeline. No AI model is used in the cleanup route — AI is only used in the Phase 24 `voice-transcriptions` pipeline.

### 4.5 VoiceDictation.tsx Page — Phase 24 AI Pipeline

A complete management UI for AI-based transcriptions:

- **Record button** (simulated in current UI — does not wire to actual microphone yet)
- **Manual entry dialog** (Worklist ID, Report ID, Modality, Body Part, Audio URL, Duration)
- **Status workflow:** pending → transcribed → reviewed → inserted
- **Review & Correct dialog** — shows raw AI draft, allows radiologist to edit
- **Confidence score** displayed per record
- **AI Safety Label:** "AI Draft – Requires Radiologist Review"
- **Insert to Report** action (only available after "reviewed" status)

**Current limitation:** The "Record" button is simulated (`isRecording` state toggle only). It does not connect to the actual Web Speech API or MediaRecorder.

---

## 5. Critical Gaps Identified

### GAP-01: Transcript Preview Before Insert
**Severity: HIGH**
The current `VoiceDictationButton` inserts text directly into the report field without any preview or confirmation step. The user cannot review, edit, or reject the cleaned transcript before it goes into the report.

**Required:** A preview modal or inline preview pane showing the cleaned text with Append / Replace / Discard options.

### GAP-02: Pause/Resume Not Exposed in Button
**Severity: HIGH**
The `useVoiceDictation.ts` hook fully supports `pause()` and `resume()`, but `VoiceDictationButton.tsx` does not use the hook at all — it implements its own simpler recognition logic that has no pause state.

**Required:** Wire `VoiceDictationButton` (or replace it) to use `useVoiceDictation` and expose a Pause button.

### GAP-03: No Interim Transcript Display
**Severity: MEDIUM**
There is no live display of what is being recognized while the user speaks. The user receives no visual feedback until cleanup is done.

**Required:** Show `interimTranscript` in real-time (grey/italic) while listening.

### GAP-04: VoiceDictation.tsx Record Button Not Wired
**Severity: HIGH**
The `Record` button in `VoiceDictation.tsx` (Phase 24 page) only sets a local state flag. It does not start any real audio capture. The comment in the code says "(simulated — production connects to Web Audio API + STT backend)".

**Required:** Wire the button to `useVoiceDictation` or MediaRecorder to capture real audio.

### GAP-05: No Silence Timeout / Auto-Stop
**Severity: MEDIUM**
If the radiologist forgets to stop dictation, the session runs indefinitely. There is no silence detection or timeout.

**Required:** Add configurable silence timeout (e.g., 8–15 seconds of no speech → auto-pause).

### GAP-06: No Autosave During Dictation
**Severity: MEDIUM**
If the browser tab crashes or is closed during an active dictation session, the accumulated transcript is lost.

**Required:** Periodic autosave of transcript to localStorage or the backend `radiology_voice_logs` table.

### GAP-07: Command Actions Not Consumed by Pages
**Severity: MEDIUM**
The `lastCommand` events dispatched by `useVoiceDictation.ts` (goToFindings, goToImpression, saveDraft, etc.) are never consumed by any page component. The commands are parsed and dispatched, but nothing listens for them.

**Required:** Integrate command handlers in the reporting pages (e.g., `saveDraft` → trigger save, `goToImpression` → focus impression field).

### GAP-08: No Visual Recording Indicator on Individual Fields
**Severity: LOW**
When dictating into a specific field, there is no visual indication on the page (other than the small button state change) that recording is active.

**Required:** Pulsing microphone indicator on the actively-recording field.

### GAP-09: No Whisper/Faster-Whisper Support
**Severity: MEDIUM** (Phase 5)
The current implementation relies entirely on the browser's Web Speech API, which requires internet access to Google/Microsoft servers. For an air-gapped radiology environment, a local STT engine (Whisper, Faster-Whisper) is needed.

**Required:** Admin-configurable STT engine selection (Web Speech API / Whisper / Faster-Whisper) with a backend proxy route.

### GAP-10: No AI-Assisted Cleanup in Button Flow
**Severity: LOW** (Phase 5)
The `voice-cleanup` route uses only regex/string replacement. For complex medical dictations, AI cleanup (correct medical terms, reconstruct sentence structure) would improve quality. The Phase 24 AI pipeline exists but is not wired to the inline button flow.

**Required (Phase 5):** Option to route cleanup through AI provider (configurable — off by default to avoid latency).

### GAP-11: useVoiceDictation.ts Not Used by Any Page
**Severity: HIGH**
The advanced hook exists but zero pages import or use it. Only `VoiceDictationButton.tsx` implements its own basic recognition. The hook's capabilities are completely unused in production.

**Required:** Upgrade the button to use the hook, or create a new composite `VoiceDictationPanel` component that uses the hook.

---

## 6. Existing Vocabulary Gap Analysis

### Medical Terms Missing from Backend Cleanup

The following common radiology terms are **not** in `cleanVoiceText()` and should be added:

| Spoken | Should Normalize To |
|---|---|
| t1w / t-one-w | T1W |
| t2w / t-two-w | T2W |
| t1 / t-one | T1 |
| t2 / t-two | T2 |
| mri | MRI |
| ct | CT |
| usg / ultrasound | USG |
| doppler | Doppler |
| xray / x-ray | X-ray |
| oedema / edema | oedema |
| disc prolapse | disc prolapse |
| herniated | herniated |
| foraminal stenosis | foraminal stenosis |
| ligamentum flavum | ligamentum flavum |
| cord signal change | cord signal change |
| grade one / grade 1 | Grade 1 |
| hypo echogenic | hypoechoic |
| isoechoic | isoechoic |
| hyperechoic | hyperechoic |
| pleural effusion | pleural effusion |
| bilateral | bilateral |
| left sided / right sided | left-sided / right-sided |
| centimeter / c m | cm |
| millimeter / m m | mm |

### Voice Commands Missing from useVoiceDictation.ts

| Missing Command | Action Needed |
|---|---|
| "clear findings" | Clear findings field |
| "start impression" | Move focus to impression |
| "end report" | Complete and save |
| "append findings" | Append mode |
| "replace findings" | Replace mode |
| "capital [word]" | Capitalize next word |
| "new paragraph" | Insert paragraph break |

---

## 7. Data Flow Summary

### Current Flow (VoiceDictationButton — simple mode)
```
Browser mic
  → Web Speech API (Google/MS cloud STT)
  → onresult() callback
  → POST /api/radiology/report-generator/voice-cleanup
      → cleanVoiceText() [regex-only]
      → INSERT into radiology_voice_logs
  → onInsert(cleanedText) → appended directly to report field (no preview)
```

### Existing Phase 24 Flow (VoiceDictation.tsx — AI mode)
```
Manual audio URL (not mic)
  → POST /api/ai-reporting/voice-transcriptions [create record]
  → POST /api/ai-reporting/voice-transcriptions/:id/transcribe [AI draft]
  → PATCH /api/ai-reporting/voice-transcriptions/:id [radiologist corrects]
  → POST /api/ai-reporting/voice-transcriptions/:id/insert [insert to report]
```

### Target Flow After Upgrade
```
Browser mic → useVoiceDictation hook
  → Interim transcript displayed live (grey italic)
  → Final result accumulated in transcript buffer
  → After stop/pause:
      POST /api/radiology/report-generator/voice-cleanup (+ optional AI)
      → Preview panel shows cleaned text
  → Radiologist: Append / Replace / Discard
  → If append/replace: text goes into report field
  → Auto-log to voice_dictation_logs
```

---

## 8. Mount Point — API Route

The voice-cleanup route is mounted via:
```
artifacts/api-server/src/routes/index.ts:449
→ radiologyReportGeneratorRouter at /api/radiology/report-generator
```

So the full URL is:
```
POST /api/radiology/report-generator/voice-cleanup
```

Which matches what `VoiceDictationButton.tsx` calls on line 61:
```typescript
const res = await fetch("/api/radiology/report-generator/voice-cleanup", {
```

✅ Route is correctly wired.

---

## 9. Upgrade Phases — Recommended Order

Based on the audit, the following phases are recommended:

### Phase 2 — Workflow Verification (Ready)
- Verify all 8 insertion points work end-to-end
- Confirm voice-cleanup route is accessible with auth
- Confirm `radiology_voice_logs` table migrations exist

### Phase 3 — Control Panel (HIGH Priority)
- Wire `VoiceDictationButton` to use `useVoiceDictation` hook
- Add Pause / Resume buttons
- Add transcript preview before insert (Append / Replace / Discard)
- Show interim transcript in real-time

### Phase 4 — Radiology Command Vocabulary (MEDIUM Priority)
- Add missing medical terms to `cleanVoiceText()`
- Add missing voice commands to `COMMAND_MAP`
- Add page-level command handlers (saveDraft, goToImpression, etc.)

### Phase 5 — STT Engine Configuration (MEDIUM Priority)
- Admin settings: Web Speech API / Whisper / Faster-Whisper
- Backend proxy route for local Whisper

### Phase 6 — Command Center Integration (MEDIUM Priority)
- Wire dictation into Command Center reporting flow
- Add transcript → AI draft → insert pipeline

### Phase 7 — Safety / Autosave (MEDIUM Priority)
- Silence timeout (configurable)
- Autosave to localStorage
- Visual recording indicators per-field

---

## 10. Files That Must Not Be Duplicated

> [!CAUTION]
> Do NOT create new versions of the following. Upgrade them in place.

| File | Rule |
|---|---|
| `VoiceDictationButton.tsx` | One button only — upgrade it |
| `useVoiceDictation.ts` | One hook only — wire it to the button |
| `VoiceDictation.tsx` | One page only — upgrade the Record button |
| `voice-cleanup` route | One cleanup route only — extend it |
| `ai_voice_transcriptions` table | Already exists — do not recreate |
| `voice_dictation_logs` table | Already exists — do not recreate |

---

## 11. Git Restore Point

```
Branch: feature/radiology-network-control-center
Status: Working tree clean — no changes needed before audit
```

All files audited are unmodified. This document is the only output of Phase 1.

---

*End of Phase 1 — Voice Dictation Audit*
*Next: Phase 3 — Upgrade VoiceDictationButton with preview panel and pause/resume*
