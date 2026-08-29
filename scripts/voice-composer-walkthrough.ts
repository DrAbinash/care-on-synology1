/**
 * CLI walkthrough for Voice Report Composer — MRI LS Spine incremental dictation.
 */
import { deterministicCompose } from "../artifacts/api-server/src/lib/voiceReportComposer/composer";
import { applyChangePlan } from "../artifacts/diagnostic-erp/src/lib/voiceReportComposer/applyChangePlan";
import type { VoiceObservation } from "../artifacts/diagnostic-erp/src/lib/voiceReportComposer/types";

const normalLsFindings =
  "Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. Disc spaces are maintained. No acute fracture. Conus medullaris at L1 with normal appearance. Cauda equina nerve roots are normally distributed. Paraspinal soft tissues are unremarkable. Sacroiliac joints are normal.";

const transcripts = [
  "Loss of lumbar lordosis.",
  "Disc desiccation at L3-4 and L4-5.",
  "Diffuse disc bulge at L4-5 with anterior thecal sac compression and bilateral nerve root impingement.",
  "Ligamentum flavum hypertrophy in lower lumbar levels.",
];

let narrative = {
  clinicalHistory: "",
  technique: "MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 4 mm.",
  findings: normalLsFindings,
  impression: "Normal MRI lumbo-sacral spine. No acute bony or disc abnormality.",
  recommendation: "Clinical correlation. Follow-up as clinically indicated.",
};
let provenance: Record<string, Record<string, string[]>> = {};
let activeObservations: VoiceObservation[] = [];

const lines: string[] = [];
const log = (s: string) => lines.push(s);

log("=== ORIGINAL NORMAL LS FINDINGS ===");
log(narrative.findings);
log("");

for (const transcript of transcripts) {
  log(`--- TRANSCRIPT: "${transcript}" ---`);
  const plan = deterministicCompose({
    transcript,
    region: "LS Spine",
    modality: "MR",
    findingsText: narrative.findings,
    priorObservations: activeObservations,
  });
  if (!plan) {
    log("No plan generated");
    continue;
  }
  log(`CHANGE PLAN: ${JSON.stringify(plan, null, 2)}`);
  const result = applyChangePlan({
    narrative,
    provenance,
    plan,
    activeObservations,
  });
  if (!result.ok) {
    log(`BLOCKED: ${result.error}`);
    continue;
  }
  narrative = result.narrative!;
  provenance = result.provenance as typeof provenance;
  activeObservations = result.activeObservations ?? [];
  log("FINDINGS AFTER APPLY:");
  log(narrative.findings);
  log("");
}

const impPlan = deterministicCompose({
  transcript: "generate impression",
  region: "LS Spine",
  findingsText: narrative.findings,
  generateImpressionOnly: true,
});
if (impPlan) {
  const impResult = applyChangePlan({ narrative, provenance, plan: impPlan, activeObservations });
  if (impResult.ok) {
    narrative = impResult.narrative!;
    log("=== FINAL IMPRESSION ===");
    log(narrative.impression);
  }
}

log("=== FINAL FINDINGS ===");
log(narrative.findings);

console.log(lines.join("\n"));
