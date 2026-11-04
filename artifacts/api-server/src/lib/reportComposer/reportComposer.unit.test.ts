import { describe, it, expect } from "vitest";
import { detectClinicalSignificance } from "./clinicalSignificance";
import { computeSnapshotHashes, dedupeObservations, hashText } from "./snapshot";
import { validateComposerOutput } from "./validateOutput";
import { buildTrackedChanges, materializeAcceptedText } from "./trackedChanges";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import {
  parseComposerSnapshot,
  resolveRagOverride,
  encodeRagOverrideEnvelope,
  decodeRagOverrideEnvelope,
  type ComposerInputSnapshot,
} from "./types";
import { parseComposerDraftJson, normalizeComposerDraftText } from "./types";

/**
 * The output contract, fed with strings a real model actually returned through
 * this path (recorded 2026-10-11, gemma3:12b, synthetic cases). Both carried the
 * printer's own markers: `**Findings:**` for emphasis, and a `TECHNIQUE:` line
 * copied out of the context block. Left in, the first prints asterisks on the
 * patient's report on the screen and Word surfaces, and the second makes a nested
 * TECHNIQUE heading inside Findings on paper.
 */
describe("draft text normalisation — what the printer must not be handed", () => {
  const CT_RAW = [
    "Contrast-enhanced CT of the abdomen and pelvis was performed.",
    "",
    "**Findings:**",
    "",
    "Dilated, fluid-filled appendix measuring 9 mm in diameter with wall enhancement.",
  ].join("\n");

  const DOPPLER_RAW = [
    "TECHNIQUE: Grey-scale, compression and colour Doppler of the right lower limb deep veins.",
    "",
    "FINDINGS:",
    "",
    "Non-compressible thrombus is present in the right common femoral vein.",
  ].join("\n");

  it("removes markdown emphasis but keeps the sentence it wrapped", () => {
    const out = normalizeComposerDraftText(CT_RAW);
    expect(out).not.toContain("**");
    expect(out).toContain("Dilated, fluid-filled appendix measuring 9 mm in diameter");
    // A "Findings:" label is a heading to the printer; a nested FINDINGS heading is
    // not a section the radiologist authored, so it goes.
    expect(out).not.toMatch(/^findings\s*:?\s*$/im);
  });

  it("removes an echoed TECHNIQUE/FINDINGS label from any position", () => {
    const out = normalizeComposerDraftText(DOPPLER_RAW);
    expect(out).not.toMatch(/TECHNIQUE/i);
    expect(out).not.toMatch(/^findings\s*:?\s*$/im);
    // The clinical sentence, its side and its vessel all survive.
    expect(out).toContain("Non-compressible thrombus is present in the right common femoral vein.");
  });

  it("leaves authored sub-headings and the canal table exactly as written", () => {
    const authored = [
      "Alignment:",
      "Normal lumbar lordosis maintained.",
      "",
      "Canal Diameter:",
      "| Level | AP Canal (mm) |",
      "| L4-L5 | 9 |",
    ].join("\n");
    expect(normalizeComposerDraftText(authored)).toBe(authored);
  });

  it("keeps the sentence when only the label was echoed", () => {
    // The asymmetry is the safety property: a technique copy is deleted, a finding
    // is never deleted — its label is removed and the words stay.
    expect(normalizeComposerDraftText("FINDINGS: Broad-based disc bulge at L4-L5."))
      .toBe("Broad-based disc bulge at L4-L5.");
    expect(normalizeComposerDraftText("TECHNIQUE: Multiplanar multisequence MRI."))
      .toBe("");
  });

  it("reaches the parsed draft, so no provider can bypass it", () => {
    const draft = parseComposerDraftJson(
      JSON.stringify({ findings: DOPPLER_RAW, impression: "Right common femoral DVT.", recommendation: "" }),
    );
    expect(draft?.findings).not.toMatch(/TECHNIQUE/i);
    expect(draft?.impression).toBe("Right common femoral DVT.");
  });
});

/**
 * Duplication is a style defect, not a clinical mutation, so it is a warning the
 * radiologist sees — never a silent deletion and never a refused draft. The
 * example is the CT case above, which stated the fat stranding twice.
 */
describe("verbatim repetition is advisory, not destructive", () => {
  const SENTENCE = "Periappendiceal fat stranding is noted in the right iliac fossa.";

  function snap(): ComposerInputSnapshot {
    return parseComposerSnapshot({
      modality: "CT", region: "Abdomen", family: "abdomen",
      findings: SENTENCE, impression: "", recommendation: "", observations: [],
    });
  }

  it("warns when the same sentence appears twice", () => {
    const v = validateComposerOutput(snap(), {
      findings: `${SENTENCE}\n\nThe liver, spleen and kidneys are unremarkable.\n\n${SENTENCE}`,
      impression: "", recommendation: "", unresolvedQuestions: [], warnings: [],
    });
    expect(v.warnings.join("\n")).toMatch(/repeated a sentence verbatim/);
    // Advisory: it must not fail the draft.
    expect(v.errors).not.toContain("duplicated_sentence");
    // Both copies are still there for the radiologist to decide about.
    expect(v.ok).toBe(true);
  });

  it("says nothing when a sentence appears once", () => {
    const v = validateComposerOutput(snap(), {
      findings: SENTENCE, impression: "", recommendation: "", unresolvedQuestions: [], warnings: [],
    });
    expect(v.warnings.join("\n")).not.toMatch(/repeated a sentence verbatim/);
  });
});

/**
 * The inversion no grounding check can see. "No intracranial haemorrhage" is in
 * the input, so the word "haemorrhage" is grounded — a draft that returns
 * "Haemorrhage is present" passes every keyword test while reversing the medicine.
 */
describe("a finding the radiologist denied cannot come back asserted", () => {
  const brain = parseComposerSnapshot({
    modality: "MR", region: "Brain", family: "brain",
    findings: "Restricted diffusion in the left middle cerebral artery territory.\nNo intracranial haemorrhage.",
    impression: "", recommendation: "", observations: [],
  });

  it("fails the draft that turned the denial into a positive", () => {
    const v = validateComposerOutput(brain, {
      findings: "An intracranial haemorrhage is present with early mass effect.",
      impression: "Haemorrhage.", recommendation: "", unresolvedQuestions: [], warnings: [],
    });
    expect(v.errors).toContain("denied_finding_asserted");
    expect(v.ok).toBe(false);
  });

  it("passes the denial through, in the model's own words", () => {
    const v = validateComposerOutput(brain, {
      findings: "Restricted diffusion in the left middle cerebral artery territory. No intracranial haemorrhage is identified.",
      impression: "Restricted diffusion in the left middle cerebral artery territory.",
      recommendation: "", unresolvedQuestions: [], warnings: [],
    });
    expect(v.errors).not.toContain("denied_finding_asserted");
    expect(v.ok).toBe(true);
  });

  it("accepts a negative worded the other way round", () => {
    const v = validateComposerOutput(brain, {
      findings: "Haemorrhage was not seen on the diffusion or susceptibility sequences.",
      impression: "", recommendation: "", unresolvedQuestions: [], warnings: [],
    });
    expect(v.errors).not.toContain("denied_finding_asserted");
  });

  it("is silent when the input never denied anything", () => {
    const plain = parseComposerSnapshot({
      modality: "MR", region: "Brain", family: "brain",
      findings: "Restricted diffusion in the left middle cerebral artery territory.",
      impression: "", recommendation: "", observations: [],
    });
    const v = validateComposerOutput(plain, {
      findings: "Acute infarct in the left middle cerebral artery territory with haemorrhagic transformation.",
      impression: "", recommendation: "", unresolvedQuestions: [], warnings: [],
    });
    // Here the invention is caught by grounding, not by denial — the two gates
    // must not be confused, and this one must not fire.
    expect(v.errors).not.toContain("denied_finding_asserted");
    expect(v.errors).toContain("unsupported_abnormality");
  });
});

describe("clinicalSignificance — deterministic", () => {
  it("flags laterality change", () => {
    const r = detectClinicalSignificance("right foraminal stenosis", "left foraminal stenosis");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Laterality/i.test(x))).toBe(true);
  });

  it("flags spinal level change", () => {
    const r = detectClinicalSignificance("L4-5 disc bulge", "L3-4 disc bulge");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Spinal level/i.test(x))).toBe(true);
  });

  it("flags measurement change", () => {
    const r = detectClinicalSignificance("lesion measures 5 mm", "lesion measures 15 mm");
    expect(r.significant).toBe(true);
  });

  it("flags negation/polarity change", () => {
    const r = detectClinicalSignificance("no significant disc bulge", "significant disc bulge present");
    expect(r.significant).toBe(true);
  });

  it("is quiet for pure rephrase without tokens", () => {
    const r = detectClinicalSignificance(
      "Mild degenerative changes are noted.",
      "There are mild degenerative changes.",
    );
    expect(r.significant).toBe(false);
  });

  // mra/mrv §21: AI may propose a vascular observation; it may not finalise a vascular
  // diagnosis. Each pair below is the exact escalation the spec forbids, and each one has
  // to arrive as a clinically-significant change the radiologist must accept by name.
  it("flags an added vascular conclusion (§21)", () => {
    const escalations: Array<[string, string]> = [
      ["The intracranial arteries are normal.", "There is an aneurysm at the ACom region."],
      ["Non-visualization of the right MCA M1.", "Occlusion of the right MCA M1."],
      [
        "Segmental flow gap in the right transverse sinus.",
        "Occlusive dural venous sinus thrombosis of the right transverse sinus.",
      ],
      [
        "Moyamoya pattern of the terminal ICAs.",
        "Findings are diagnostic of Moyamoya disease.",
      ],
      ["Unruptured aneurysm of the ACom region.", "Ruptured aneurysm of the ACom region."],
      [
        "Eccentric crescentic T1 hyperintense signal in the left cervical ICA.",
        "Acute dissection of the left cervical ICA.",
      ],
    ];
    for (const [before, after] of escalations) {
      const r = detectClinicalSignificance(before, after);
      expect(r.significant, `${before} → ${after}`).toBe(true);
      expect(
        r.reasons.some((x) => /Vascular conclusion/i.test(x)),
        `${before} → ${after}`,
      ).toBe(true);
    }
  });

  it("stays quiet when the vascular conclusion was already in the report", () => {
    const r = detectClinicalSignificance(
      "Occlusion of the left MCA M1.",
      "There is occlusion of the left MCA M1.",
    );
    expect(r.reasons).toEqual([]);
    expect(r.significant).toBe(false);
  });

  it("flags a stenosis percentage the report did not carry (§21)", () => {
    const r = detectClinicalSignificance(
      "Focal luminal narrowing of the left carotid bulb.",
      "Severe (70%) stenosis of the left carotid bulb.",
    );
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /added: 70/i.test(x))).toBe(true);
    expect(r.reasons.some((x) => /Vascular conclusion/i.test(x))).toBe(false);
  });
});

describe("snapshot immutability / hashing", () => {
  it("same content → same revision", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "L4-5 bulge",
      impression: "Disc bulge",
      recommendation: "",
      observations: [{ concept: "bulge", findingsText: "L4-5 diffuse disc bulge", source: "quick-select", level: "L4-L5" }],
    });
    const a = computeSnapshotHashes(snap);
    const b = computeSnapshotHashes({ ...snap });
    expect(a.reportRevision).toBe(b.reportRevision);
    expect(a.inputHash).toBe(b.inputHash);
  });

  it("edit changes revision", () => {
    const a = computeSnapshotHashes(parseComposerSnapshot({ findings: "L4-5", impression: "", recommendation: "", observations: [] }));
    const b = computeSnapshotHashes(parseComposerSnapshot({ findings: "L3-4", impression: "", recommendation: "", observations: [] }));
    expect(a.reportRevision).not.toBe(b.reportRevision);
  });

  it("dedupes identical observations", () => {
    const out = dedupeObservations([
      { concept: "bulge", findingsText: "L4-5 bulge", level: "L4-L5", source: "quick-select" },
      { concept: "bulge", findingsText: "L4-5 bulge", level: "L4-L5", source: "macro" },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("validateComposerOutput — no invented pathology", () => {
  it("rejects unsupported hemorrhage in brain draft", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "Fazekas 2 white matter changes. Prominent ventricles.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "fazekas", findingsText: "Fazekas grade 2", source: "quick-select" },
        { concept: "ventricles", findingsText: "prominent ventricles/CSF spaces", source: "quick-select" },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression: "Acute hemorrhage and infarct with Fazekas 2.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.unsupportedMentions.length).toBeGreaterThan(0);
  });

  it("accepts grounded LS spine findings", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "No significant disc bulge.",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "bulge", findingsText: "L4-5 diffuse disc bulge", source: "quick-select" },
        { concept: "desiccation", findingsText: "L5-S1 disc desiccation", source: "quick-select" },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snap, "FULL_REPORT");
    const v = validateComposerOutput(snap, draft);
    expect(v.ok).toBe(true);
  });

  it("refuses a vascular diagnosis the observations never stated (§21)", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings:
        "Segmental flow gap in the right transverse sinus. The left MCA M1 is not visualized on the angiographic acquisition.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "mrv_vessel_transverse_sinus",
          findingsText: "Segmental flow gap in the right transverse sinus",
          source: "structured",
        },
        {
          concept: "mra_vessel_mca_m1",
          findingsText: "The left MCA M1 is not visualized on the angiographic acquisition",
          source: "structured",
        },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression:
        "Occlusive dural venous sinus thrombosis of the right transverse sinus with venous infarction, and left MCA M1 occlusion.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    // A flow gap is not a thrombosis and non-visualisation is not an occlusion (§12, §18).
    expect(v.unsupportedMentions).toEqual(
      expect.arrayContaining(["thrombosis", "occlusion", "dural venous sinus"]),
    );
  });

  it("refuses moyamoya disease when only the pattern was recorded (§21)", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "Moyamoya pattern of the bilateral terminal ICAs with lenticulostriate collaterals.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "mra_moyamoya_pattern",
          findingsText: "Moyamoya pattern of the bilateral terminal ICAs",
          impressionText: "Moyamoya pattern of the bilateral terminal ICAs",
          source: "structured",
        },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression: "Moyamoya disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.unsupportedMentions).toContain("moyamoya disease");
  });

  it("accepts the vascular conclusion the radiologist already recorded", () => {
    const snap: ComposerInputSnapshot = parseComposerSnapshot({
      findings: "Occlusive thrombus within the superior sagittal sinus.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "mrv_vessel_sss",
          findingsText: "Occlusive thrombus within the superior sagittal sinus",
          // The conclusion the radiologist selected, which is what makes the impression
          // line a restatement rather than an invention.
          impressionText: "Occlusive dural venous sinus thrombosis of the superior sagittal sinus",
          source: "structured",
        },
      ],
    });
    const v = validateComposerOutput(snap, {
      findings: snap.findings,
      impression: "Occlusive dural venous sinus thrombosis of the superior sagittal sinus.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.unsupportedMentions).toEqual([]);
  });
});

describe("tracked changes — data not HTML", () => {
  it("builds REPLACE with clinical significance when level changes", () => {
    const changes = buildTrackedChanges({
      jobId: 1,
      model: "test",
      originalFindings: "L4-5 disc bulge",
      originalImpression: "",
      originalRecommendation: "",
      draft: {
        findings: "L3-4 disc bulge",
        impression: "Disc bulge at L3-4",
        recommendation: "",
        unresolvedQuestions: [],
        warnings: [],
      },
    });
    expect(changes.some((c) => c.field === "FINDINGS" && c.clinicalSignificance)).toBe(true);
    expect(changes.every((c) => c.source === "AI_COMPOSER")).toBe(true);
    expect(JSON.stringify(changes)).not.toMatch(/<span|style=/i);
  });

  it("materialize uses only ACCEPTED changes", () => {
    const text = materializeAcceptedText({
      currentFindings: "A",
      currentImpression: "B",
      currentRecommendation: "",
      changes: [
        {
          id: "1",
          source: "AI_COMPOSER",
          changeType: "REPLACE",
          field: "FINDINGS",
          originalText: "A",
          proposedText: "NEW",
          reviewState: "PENDING",
          clinicalSignificance: false,
          clinicalSignificanceReasons: [],
          createdAt: new Date().toISOString(),
        },
        {
          id: "2",
          source: "AI_COMPOSER",
          changeType: "REPLACE",
          field: "IMPRESSION",
          originalText: "B",
          proposedText: "IMP",
          reviewState: "ACCEPTED",
          clinicalSignificance: false,
          clinicalSignificanceReasons: [],
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(text.findings).toBe("A");
    expect(text.impression).toBe("IMP");
  });
});

describe("hashText", () => {
  it("normalizes whitespace", () => {
    expect(hashText("a  b")).toBe(hashText("a b"));
  });
});

/**
 * PER-JOB REFERENCE-KNOWLEDGE (RAG) OVERRIDE — the request contract.
 *
 * WHY THIS IS A PURE FUNCTION
 * The gate that decides whether one compose may run with retrieval switched off is an
 * authorization decision, and the two doors that can start a compose job (the queue worker and
 * the workspace's `process-now`) must give the SAME answer for the same job. So the decision is
 * made once, at the HTTP boundary, from the staff session, and is then only *carried* — never
 * recomputed — down to the run. That is what makes it testable without a database, and what keeps
 * a second door from re-deciding with a session it no longer has.
 *
 * WHAT THESE CASES REFUSE TO LET HAPPEN
 *  - a clinical request that fails because of an experimental field (a refused override falls
 *    back to `default`; it never errors);
 *  - an override smuggled in by a caller with no grant;
 *  - a request that never mentions the field looking different, in the job row or to the model,
 *    from one submitted before the field existed.
 */
describe("resolveRagOverride — on / off / default, and who may ask", () => {
  it("absent means default, for an authorized caller exactly as for an unauthorized one", () => {
    for (const authorized of [true, false]) {
      const c = resolveRagOverride(undefined, authorized);
      expect(c).toEqual({
        requested: null,
        effective: "default",
        honoured: false,
        ignoredReason: null,
        needsRecording: false,
      });
    }
  });

  it("an explicit \"default\" asks for nothing, so nothing is recorded", () => {
    const c = resolveRagOverride("default", true);
    expect(c.effective).toBe("default");
    expect(c.honoured).toBe(false);
    expect(c.needsRecording).toBe(false);
  });

  it("on and off are honoured only for an authorized caller", () => {
    for (const asked of ["on", "off"] as const) {
      const c = resolveRagOverride(asked, true);
      expect(c.effective).toBe(asked);
      expect(c.honoured).toBe(true);
      expect(c.ignoredReason).toBeNull();
      expect(c.needsRecording).toBe(true);
    }
  });

  it("an unauthorized on/off runs exactly as the clinic default and records that it was ignored", () => {
    // The fall-back is the point: the report still gets composed, the flag is untouched, and the
    // job row says in as many words that the override did not take effect.
    const c = resolveRagOverride("off", false);
    expect(c.effective).toBe("default");
    expect(c.honoured).toBe(false);
    expect(c.ignoredReason).toBe("not authorized");
    expect(c.needsRecording).toBe(true);

    const on = resolveRagOverride("on", false);
    expect(on.effective).toBe("default");
    expect(on.ignoredReason).toBe("not authorized");
  });

  it("a value CARE does not understand never changes the run", () => {
    for (const junk of ["yes", "true", "OFF!", "", "   ", "0ff"]) {
      const c = resolveRagOverride(junk, true);
      expect(c.effective).toBe("default");
      expect(c.honoured).toBe(false);
    }
    // A real string is still worth auditing, so an unrecognized one IS recorded.
    expect(resolveRagOverride("yes", true).needsRecording).toBe(true);
    expect(resolveRagOverride("yes", true).ignoredReason).toBe("unrecognized");
  });

  it("the field is case- and whitespace-tolerant, and a non-string is not a request", () => {
    expect(resolveRagOverride(" OFF ", true).effective).toBe("off");
    expect(resolveRagOverride("On", true).effective).toBe("on");
    for (const notAString of [true, 1, {}, [], null, ["off"]]) {
      expect(resolveRagOverride(notAString, true).effective).toBe("default");
    }
  });

  it("the override is a job setting, not clinical input: it never enters the snapshot identity", () => {
    // `inputHash` is what the browser re-computes to prove the draft it is accepting is the one the
    // model saw. An override living inside the hashed snapshot would make every override job read
    // as STALE to a client that has no idea the field exists.
    const base = {
      findings: "L4-5 bulge",
      impression: "Disc bulge",
      recommendation: "",
      observations: [] as never[],
    };
    const stripped = parseComposerSnapshot({ ...base, ragOverride: "off" } as never) as Record<string, unknown>;
    expect(stripped.ragOverride).toBeUndefined();
    expect(computeSnapshotHashes(parseComposerSnapshot(base as never)).inputHash).toBe(
      computeSnapshotHashes(parseComposerSnapshot({ ...base, ragOverride: "off" } as never) as never).inputHash,
    );
  });
});

/**
 * THE ENVELOPE THAT CARRIES THE DECISION FROM THE REQUEST TO THE QUEUE WORKER.
 *
 * A compose job is not composed by the request that created it: the durable path is a background
 * worker (and a second door, `process-now`), which has no staff session left on it. So the decision
 * made at the HTTP boundary has to survive in the row. `ai_report_compose_jobs` has no column for
 * it, and this deliberately does not add one: the JSON the composer already writes for its own
 * audit (`validation_json`, surfaced as `job.validation.provenance`) is the existing mechanism, and
 * a control the worker reads back is the same kind of record.
 *
 * A job that asked for nothing must not gain a byte of this envelope — that is what keeps the
 * default path byte-identical to the one that shipped in #1261.
 */
describe("the ragOverride envelope in the job row", () => {
  it("nothing was asked, so nothing is written", () => {
    expect(encodeRagOverrideEnvelope(resolveRagOverride(undefined, true))).toBeNull();
    expect(encodeRagOverrideEnvelope(resolveRagOverride("default", true))).toBeNull();
    expect(decodeRagOverrideEnvelope(null)).toBeNull();
  });

  it("a honoured override round-trips through the row", () => {
    for (const asked of ["on", "off"] as const) {
      const json = encodeRagOverrideEnvelope(resolveRagOverride(asked, true))!;
      expect(decodeRagOverrideEnvelope(json)).toEqual(resolveRagOverride(asked, true));
    }
  });

  it("an ignored request round-trips too — that is the audit trail", () => {
    const json = encodeRagOverrideEnvelope(resolveRagOverride("off", false))!;
    const back = decodeRagOverrideEnvelope(json);
    expect(back).toEqual(resolveRagOverride("off", false));
    expect(back?.effective).toBe("default");
    expect(back?.ignoredReason).toBe("not authorized");
  });

  it("a row whose JSON is anything else answers null rather than throwing", () => {
    // The decode runs on every compose, including rows written by builds that predate this field,
    // rows holding a validation result, and rows whose text was truncated by an operator. None of
    // them may turn a clinical request into a failed job.
    for (const junk of [undefined, "", "not json", "[]", '{"ragOverride":{"effective":"MAYBE"}}']) {
      expect(decodeRagOverrideEnvelope(junk)).toBeNull();
    }
  });

  it("a real validation result never loses its own meaning to the envelope", () => {
    // The worker overwrites this column with the validation object when the run settles, so the
    // envelope must be readable ONLY from a row that has not settled, and a validation object must
    // not decode as a control.
    const validation = JSON.stringify({ ok: true, warnings: [], provenance: { provider: "ollama" } });
    expect(decodeRagOverrideEnvelope(validation)).toBeNull();
  });
});
