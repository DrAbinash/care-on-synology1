/**
 * The Refine freshness round trip — the defect that made AI Refine unusable.
 *
 * A browser-measured failure, on synthetic CT Brain study 5 of the Word
 * replacement rig, model `qwen3:14b`, job 181 (`job_kind = SECTION_EDIT`):
 *
 *   stored `input_hash`  16c16133fad5bb5628ab377caaf0886e   (server, at enqueue)
 *   live   `input_hash` de835134c4d1d49d93bb29e49d644e9f   (same tab, unchanged report)
 *   `reportRevision`     2961d4522d65302c578b549f2a4e6d71  on BOTH sides
 *
 * Nothing in the report changed. The two hashes differed because the tab's
 * freshness recomputation is a second snapshot builder, and it left out the
 * fields that describe the REQUEST — the instruction it had typed (105 chars)
 * and the text it had selected (518 chars) — while `inputHash` still covers
 * them. The server's `isComposeJobStale` then reported the draft stale on sight,
 * the badge read "AI STALE", and `canApply` (`job.status === "READY"`) was false
 * forever: Accept worked, Apply never did.
 *
 * THE RULE THESE TESTS HOLD DOWN
 * The freshness recomputation must hash the snapshot the model was actually
 * shown. The tab supplies everything it can still see; the job hands back the
 * request-scoped half (`requestScopeOf` → `ComposeJobView.requestScope` →
 * `liveComposeSnapshot`).
 *
 * And the protection must NOT narrow: this file asserts stale=true for every
 * change a draft really can be invalidated by — protocol, region set, narrative,
 * observation severity/laterality, mode, key images — so a fix that simply
 * deleted the study-context axis would fail here. PR #656's own register lives in
 * api-server `pr656FreshnessHardening.test.ts` and stays green.
 *
 * Cross-package by design: `api-server`'s tsconfig sets `rootDir: "src"` and
 * refuses test imports outside it, so the client/server equivalence tests live on
 * this side (same as `composeStudyContext.test.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  computeSnapshotHashes as clientComputeSnapshotHashes,
  liveComposeSnapshot,
  type ComposerInputSnapshot,
} from "@/lib/reportComposer/types";
import {
  computeSnapshotHashes as serverComputeSnapshotHashes,
  isComposeJobStale,
  requestScopeOf,
  REQUEST_SCOPE_FIELDS,
} from "../../../../api-server/src/lib/reportComposer/snapshot";
import { ComposerInputSnapshotSchema } from "../../../../api-server/src/lib/reportComposer/types";

const CT_BRAIN_FINDINGS = [
  "Grey-White Differentiation:",
  "Maintained.",
  "",
  "Parenchyma:",
  "No focal hypo- or hyperdensity. No haemorrhage or infarct.",
].join("\n");

/** A Refine request exactly as the workspace freezes it: whole-report narrative,
 * plus the instruction the radiologist typed and the sections it selected. */
function refineSnapshot(overrides: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return ComposerInputSnapshotSchema.parse({
    studyId: 5,
    worklistId: 5,
    reportId: null,
    modality: "CT",
    region: "CT Brain Plain",
    regions: ["CT Brain Plain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "CT Brain Plain",
    reportTitle: "CT Brain",
    clinicalHistory: "",
    technique: "Axial non-contrast CT of the brain, skull base to vertex.",
    findings: CT_BRAIN_FINDINGS,
    impression: "Normal CT Brain. No acute intracranial pathology.",
    recommendation: "Clinical correlation is advised.",
    observations: [],
    jobKindHint: "SECTION_EDIT",
    aiMode: "TEXT_ONLY",
    selectedKeyImages: [],
    instruction: "Make this sentence shorter and plainer, keep every clinical fact: Grey-White Differentiation:\nMaintained.",
    selectionText: "FINDINGS:\nGrey-White Differentiation:\nMaintained.\n\nIMPRESSION:\nNormal CT Brain.",
    selectionField: "FINDINGS",
    ...overrides,
  });
}

/**
 * Everything the tab can still see after the draft lands — the shape
 * `useReportComposer` rebuilds. The request-scoped fields are absent here for
 * the same reason they were absent in the browser: the Refine box has been
 * cleared and the text selection is gone.
 */
function liveTabState(snap: ComposerInputSnapshot): ComposerInputSnapshot {
  return {
    modality: snap.modality,
    region: snap.region,
    regions: snap.regions,
    bodyPart: snap.bodyPart,
    family: snap.family,
    spineSegment: snap.spineSegment,
    studyType: snap.studyType,
    protocol: snap.protocol,
    reportTitle: snap.reportTitle,
    clinicalHistory: snap.clinicalHistory,
    technique: snap.technique,
    findings: snap.findings,
    impression: snap.impression,
    recommendation: snap.recommendation,
    observations: snap.observations,
    jobKindHint: snap.jobKindHint,
    aiMode: snap.aiMode,
    selectedKeyImages: snap.selectedKeyImages,
  };
}

/** The server's own stale verdict, fed the way `evaluateJobFreshness` feeds it. */
function staleVerdict(
  stored: ReturnType<typeof serverComputeSnapshotHashes>,
  current: { reportRevision: string; findingsHash: string; impressionHash: string; inputHash?: string },
): boolean {
  return isComposeJobStale({
    jobStatus: "READY",
    storedReportRevision: stored.reportRevision,
    storedFindingsHash: stored.findingsHash,
    storedImpressionHash: stored.impressionHash,
    storedInputHash: stored.inputHash,
    current: {
      findingsHash: current.findingsHash ?? stored.findingsHash,
      impressionHash: current.impressionHash ?? stored.impressionHash,
      reportRevision: current.reportRevision,
      ...(current.inputHash === undefined ? {} : { inputHash: current.inputHash }),
    },
  }).stale;
}

describe("Refine freshness: the tab re-hashes the snapshot the model was shown", () => {
  it("reproduces the stored inputHash when the request scope comes back on the job view", async () => {
    const frozen = refineSnapshot();
    const stored = serverComputeSnapshotHashes(frozen);
    // What GET /jobs/:id and GET /latest hand the tab, via JSON.
    const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);

    const live = await clientComputeSnapshotHashes(liveComposeSnapshot(liveTabState(frozen), viewScope));

    expect(viewScope.instruction).toBe(frozen.instruction);
    expect(live.inputHash).toBe(stored.inputHash);
    expect(live.reportRevision).toBe(stored.reportRevision);
    expect(staleVerdict(stored, live)).toBe(false);
  });

  it("pins the defect: the same live tab state WITHOUT the request scope is permanently stale", async () => {
    const frozen = refineSnapshot();
    const stored = serverComputeSnapshotHashes(frozen);
    const before = await clientComputeSnapshotHashes(liveTabState(frozen));

    // The measurement from job 181, in miniature: narrative hashes agree, the
    // snapshot hash does not, so READY → STALE_READY with nothing changed.
    expect(before.reportRevision).toBe(stored.reportRevision);
    expect(before.inputHash).not.toBe(stored.inputHash);
    expect(staleVerdict(stored, before)).toBe(true);
  });

  it("leaves a plain whole-report draft exactly as fresh as it was (no scope, no change)", async () => {
    const frozen = refineSnapshot({ instruction: undefined, selectionText: undefined, selectionField: undefined, jobKindHint: "FULL_REPORT" });
    const stored = serverComputeSnapshotHashes(frozen);
    const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);
    const live = await clientComputeSnapshotHashes(liveComposeSnapshot(liveTabState(frozen), viewScope));

    expect(live.inputHash).toBe(stored.inputHash);
    expect(staleVerdict(stored, live)).toBe(false);
  });

  it("pins REQUEST_SCOPE_FIELDS to the hashed fields this tab cannot recompute", () => {
    // The list is the whole fix. If a field joins `inputHash` as request-scoped
    // and is not listed here, every draft carrying it goes stale on arrival
    // again; if a field is live state and IS listed, the frozen value would mask
    // a real change. Both directions fail this assertion.
    expect([...REQUEST_SCOPE_FIELDS].sort()).toEqual([
      "additionalReports",
      "instruction",
      "selectionText",
      "templateSections",
    ]);

    const live = liveTabState(refineSnapshot({ templateSections: ["FINDINGS", "IMPRESSION"] }));
    for (const field of REQUEST_SCOPE_FIELDS) {
      expect(Object.keys(live)).not.toContain(field);
    }

    // …and each one genuinely participates in the hash, so the merge is not
    // carrying dead weight.
    const base = refineSnapshot();
    const values: Record<string, unknown> = {
      selectionText: "something else was selected",
      instruction: "a different instruction",
      templateSections: ["IMPRESSION"],
      additionalReports: [{ worklistId: 9, label: "Other", findings: "x", impression: "y" }],
    };
    for (const field of REQUEST_SCOPE_FIELDS) {
      const changed = serverComputeSnapshotHashes({ ...base, [field]: values[field] });
      expect(changed.inputHash, `${field} must be covered by inputHash`).not.toBe(
        serverComputeSnapshotHashes({ ...base, [field]: undefined }).inputHash,
      );
    }
  });

  it("carries a COMBINE draft's supplied reports too, not just the instruction", async () => {
    const frozen = refineSnapshot({
      jobKindHint: "COMBINE",
      additionalReports: [
        {
          worklistId: 7,
          reportId: null,
          studyInstanceUid: null,
          label: "Previous MRI",
          modality: "MR",
          region: "Brain",
          findings: "Old infarct left MCA territory.",
          impression: "Chronically.",
        },
      ],
    });
    const stored = serverComputeSnapshotHashes(frozen);
    const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);

    const live = await clientComputeSnapshotHashes(liveComposeSnapshot(liveTabState(frozen), viewScope));
    expect(live.inputHash).toBe(stored.inputHash);

    // …and a draft composed against one version of the other report does not
    // stay applicable after that report is edited.
    const edited = await clientComputeSnapshotHashes(
      liveComposeSnapshot(liveTabState(frozen), {
        ...viewScope,
        additionalReports: (viewScope.additionalReports ?? []).map((r) => ({ ...r, findings: "New haemorrhagic transformation." })),
      }),
    );
    expect(staleVerdict(stored, edited)).toBe(true);
  });
});

describe("Refine freshness: what is still blocked", () => {
  const cases: Array<[string, Partial<ComposerInputSnapshot>]> = [
    ["Plain → Contrast on an unchanged report", { protocol: "CT Brain Contrast" }],
    ["the screening region is dropped from the request", { regions: [] }],
    ["the printed heading changes", { reportTitle: "CT Head" }],
    ["the modality changes", { modality: "MR" }],
    ["the radiologist edits Findings while the model is thinking", { findings: CT_BRAIN_FINDINGS + "\n\nAdditional: Small right frontal arachnoid cyst." }],
    ["the Impression changes", { impression: "Early hydrocephalus." }],
    ["a key image is added to the request", { aiMode: "SELECTED_IMAGES", selectedKeyImages: [{ keyImageId: 41, caption: "Axial FLAIR" }] }],
    ["the technique is rewritten", { technique: "Contrast-enhanced CT of the brain." }],
  ];

  for (const [label, change] of cases) {
    it(`${label} — still STALE, with the request scope restored`, async () => {
      const frozen = refineSnapshot();
      const stored = serverComputeSnapshotHashes(frozen);
      const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);
      const live = await clientComputeSnapshotHashes(
        liveComposeSnapshot(liveTabState(refineSnapshot(change)), viewScope),
      );
      expect(staleVerdict(stored, live)).toBe(true);
    });
  }

  it("an observation that changes under the same narrative still blocks", async () => {
    const frozen = refineSnapshot({
      observations: [{ concept: "fazekas", region: "brain", source: "quick-select", findingsText: "Fazekas grade 1." }],
    });
    const stored = serverComputeSnapshotHashes(frozen);
    const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);
    const live = await clientComputeSnapshotHashes(
      liveComposeSnapshot(
        {
          ...liveTabState(refineSnapshot({
            observations: [{ concept: "fazekas", region: "brain", source: "quick-select", findingsText: "Fazekas grade 2." }],
          })),
        },
        viewScope,
      ),
    );
    expect(staleVerdict(stored, live)).toBe(true);
  });

  it("a laterality flip inside the same slot blocks, even though the prose is identical", async () => {
    const frozen = refineSnapshot({
      observations: [{ concept: "renal_calcus", region: "kidney", laterality: "left", source: "quick-select", findingsText: "Calculus in the kidney." }],
    });
    const stored = serverComputeSnapshotHashes(frozen);
    const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);
    const live = await clientComputeSnapshotHashes(
      liveComposeSnapshot(
        liveTabState(refineSnapshot({
          observations: [{ concept: "renal_calcus", region: "kidney", laterality: "right", source: "quick-select", findingsText: "Calculus in the kidney." }],
        })),
        viewScope,
      ),
    );
    expect(staleVerdict(stored, live)).toBe(true);
  });

  it("a DIFFERENT instruction on the same report is a different job, not a fresh draft of the old one", async () => {
    const frozen = refineSnapshot();
    const stored = serverComputeSnapshotHashes(frozen);
    const viewScope = requestScopeOf(JSON.parse(JSON.stringify(frozen)) as ComposerInputSnapshot);
    // The tab's live scope always comes from the job it is checking, so a second
    // Refine request cannot inherit the first one's hash.
    const second = refineSnapshot({ instruction: "Translate the findings into Hindi." });
    const secondHashes = serverComputeSnapshotHashes(second);
    expect(secondHashes.inputHash).not.toBe(stored.inputHash);

    const live = await clientComputeSnapshotHashes(liveComposeSnapshot(liveTabState(frozen), viewScope));
    expect(live.inputHash).toBe(stored.inputHash);
    expect(live.inputHash).not.toBe(secondHashes.inputHash);
  });
});
