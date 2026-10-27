/**
 * Client-side source contract for the chain re-audit (bill desk → demography →
 * name of test → technique → findings → impression → recommendation → print).
 *
 * The behavioural halves live in the unit files beside the modules
 * (reportDemography.test.ts — the age as-of parity; radiologyReportPreviewHtml
 * / radiologyReportPrintLiveMerge — the stale-map guard and the chrome heading
 * case). This file pins hook and component wiring that the node-environment
 * suites cannot mount cheaply.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), "utf8");

const studySetup = read("../hooks/useReportingStudySetup.ts");
const demographyCard = read("../components/radiology/ReportDemographyCard.tsx");
const accordionBuilder = read("../hooks/radiology-workspace/useAccordionPropsBuilder.ts");
const clinicalUi = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const topBar = read("../components/radiology/workspace/WorkspaceTopBar.tsx");
const exportShare = read("../hooks/radiology-workspace/useWorkspaceExportShare.ts");

describe("technique — the auto-protocol one-shot waits for the study's identity", () => {
  it("the once-per-study token is not spent while identity is still unresolved", () => {
    const effect = studySetup.slice(
      studySetup.indexOf("Auto protocol once per study"),
      studySetup.indexOf("Auto protocol once per study") + 2200,
    );
    const guardAt = effect.indexOf("if (!hasIdentitySignal) return;");
    const burnAt = effect.indexOf("autoProtocolForStudyRef.current = studyId");
    expect(guardAt).toBeGreaterThan(0);
    expect(burnAt).toBeGreaterThan(0);
    // The guard must run BEFORE the one-shot is spent — otherwise a deep-linked
    // study whose queue row is filtered out seeds no Technique, silently.
    expect(guardAt).toBeLessThan(burnAt);
    // The signal itself must be able to come from the detail read's fields,
    // not just the queue row's region/billed name.
    expect(effect).toContain("Boolean((modality ?? \"\").trim())");
    expect(effect).toContain("Boolean((studyDescription ?? \"\").trim())");
  });
});

describe("demography — no surface presents the numeric patient PK as an identifier", () => {
  it("the workspace card's ID line stops at the UHID", () => {
    const line = demographyCard.slice(
      demographyCard.indexOf('ID:</span>'),
      demographyCard.indexOf('ID:</span>') + 200,
    );
    expect(line).toContain('value.uhid || "—"');
    expect(line).not.toContain("value.patientId");
  });

  it("the accordion's patient code does not fall back to the numeric PK", () => {
    expect(accordionBuilder).toContain("canonicalDemography.uhid || null");
    expect(accordionBuilder).not.toContain("canonicalDemography.uhid || canonicalDemography.patientId");
  });
});

describe("technique context — dictation reads the study detail when the queue row is absent", () => {
  it("the voice composer's modality and title fall back to the detail read", () => {
    const composer = clinicalUi.slice(
      clinicalUi.indexOf("const voiceComposer = useVoiceComposer"),
      clinicalUi.indexOf("const voiceComposer = useVoiceComposer") + 700,
    );
    expect(composer).toContain("workflow.currentRow?.modality ?? worklistDetailQ.data?.modality");
    expect(composer).toContain("workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription");
  });

  it("smart dictation's modality and title fall back to the detail read", () => {
    const smart = clinicalUi.slice(
      clinicalUi.indexOf("const smartDictation = useSmartDictation"),
      clinicalUi.indexOf("const smartDictation = useSmartDictation") + 900,
    );
    expect(smart).toContain("workflow.currentRow?.modality ?? worklistDetailQ.data?.modality");
    expect(smart).toContain("workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription");
  });

  it("the smart-dictation panel's exam label no longer hardcodes MRI", () => {
    expect(topBar).toContain('examLabel={workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription ?? "MRI"}');
  });
});

describe("print — the first print of a never-saved study does not create two drafts", () => {
  it("runPrintLikeFinal uses the id its own mandatory save just returned", () => {
    expect(exportShare).toContain("saved ?? await ensureDraftOnce()");
  });
});

describe("print — the critical-comms nudge reads the live moment, not the debounce", () => {
  it("the detection runs on readWorkspaceClinicalTexts() like every other print gate", () => {
    // The window stops at the callback's end — an EARLIER callback also ends
    // with runPrintLikeFinal, and a first-index end anchor would slice empty.
    const nudge = exportShare.slice(
      exportShare.indexOf("criticalCommsEnabled() && !contentLocked"),
      exportShare.lastIndexOf("await runPrintLikeFinal();"),
    );
    expect(nudge).toContain("const live = readWorkspaceClinicalTexts()");
    expect(nudge).toContain("detectCriticalFindings(live.findingsText");
  });
});
