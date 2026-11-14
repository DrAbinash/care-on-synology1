/**
 * Z.AI audit item 22 — the composer must say WHICH EXAMINATION WAS BOOKED and
 * WHAT WAS ACTUALLY PERFORMED, as two separate statements.
 *
 * `ComposerIdentityStrip` printed one string: `canonicalDemography.studyDescription`,
 * which `mergeReportDemography` builds as `pick(erp.studyDescription, erp.testName, …)`
 * — the worklist's own description whenever it has one. So the line beside the
 * editor could read "MRI BRAIN + CX SCR" while the bill says `MRI Brain`, and the
 * radiologist had no way to tell which of the two it was, or whether the scanner
 * had sent anything at all. The booked/performed difference is already computed
 * elsewhere (`resolveAutoStudyRegion`'s `scopeProposal`, `studyReportingReadiness`)
 * and then discarded by the strip; this module only puts the three facts beside
 * each other, in the precedence the rest of CARE already uses.
 *
 * Detection and wording only. Nothing here gates, rewrites, or chooses a region —
 * the disagreement is the same question `ReportingScopeConfirmStrip` already asks,
 * and answering it stays that strip's job.
 */
import { studyReportingReadiness } from "./studyReportingReadiness";
import type { StudyScopeProposal } from "./studyRegion";

/**
 * Tokens the RIS puts in front of every examination name. `MR`/`MRI` and
 * `XR`/`DX`/`CR` are one modality spelled two ways, so each maps to a family:
 * a study row that says `MR BRAIN` beside a bill of `MRI Brain` agrees, and
 * one that says `CT BRAIN` does not.
 */
const MODALITY_FAMILIES: Record<string, string> = {
  MR: "MR",
  MRI: "MR",
  CT: "CT",
  US: "US",
  XR: "XR",
  DX: "XR",
  CR: "XR",
  NM: "NM",
  PET: "PET",
  RF: "RF",
  MG: "MG",
};

export type ComposerAcquisitionState = "awaiting" | "described" | "unlabelled";

export type ComposerScopeDisplay = {
  /** The examination the bill booked. Falls back to the merged description. */
  booked: string;
  /** True when `booked` is the billed catalogue name, not a stand-in for it. */
  bookedIsBilled: boolean;
  acquisition: {
    state: ComposerAcquisitionState;
    /** One short line: what the modality actually delivered. */
    label: string;
    /** Tooltip: where the label came from. */
    detail: string;
  };
  /** The two name different examinations. Never silent, never a gate. */
  notice: string | null;
};

export type ComposerScopeInput = {
  /** `tests.name` behind the study's order line — what was booked. */
  billedTestName?: string | null;
  /** `radiology_worklist.study_description` — what the study row says. */
  worklistStudyDescription?: string | null;
  modality?: string | null;
  /** The worklist row's lifecycle status, read by `studyReportingReadiness`. */
  status?: string | null;
  /** The body-part tag, tooltip only. */
  bodyPart?: string | null;
  /** The live booked-vs-performed reading from `resolveAutoStudyRegion`. */
  scopeProposal?: StudyScopeProposal | null;
  /** The merged demography description — the fallback when the bill names nothing. */
  mergedDescription?: string | null;
};

/**
 * "MRI BRAIN + CX SCR" and "BRAIN MRI + CX SCR" are one examination spelled two
 * ways; "MRI BRAIN" and "MRI BRAIN + CX SCR" are not, and neither are
 * "MRI BRAIN" and "CT BRAIN". Comparing the sorted word sets after dropping the
 * modality token — and the modality families beside it — is the whole rule: a
 * substring test would call the second pair "the same, plus detail", which is
 * exactly the addition the radiologist is being asked to confirm.
 */
function words(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

function examTokens(value: string): string[] {
  return words(value).filter((t) => !(t in MODALITY_FAMILIES));
}

function modalityFamilies(value: string): string[] {
  return [...new Set(words(value).map((t) => MODALITY_FAMILIES[t]).filter(Boolean))].sort();
}

function sameExam(a: string, b: string): boolean {
  const fa = modalityFamilies(a);
  const fb = modalityFamilies(b);
  // A name that spells no modality cannot contradict one that does — most
  // worklist descriptions never say, and shouting about every one of them
  // would bury the case that matters.
  if (fa.length > 0 && fb.length > 0 && fa.join("+") !== fb.join("+")) return false;
  const ta = examTokens(a);
  const tb = examTokens(b);
  if (ta.length === 0 || tb.length === 0) return true;
  if (ta.length !== tb.length) return false;
  const sa = [...ta].sort();
  const sb = [...tb].sort();
  return sa.every((t, i) => t === sb[i]);
}

export function describeComposerStudyScope(input: ComposerScopeInput): ComposerScopeDisplay {
  const billed = (input.billedTestName ?? "").trim();
  const merged = (input.mergedDescription ?? "").trim();
  const acquired = (input.worklistStudyDescription ?? "").trim();
  const bodyPart = (input.bodyPart ?? "").trim().replace(/_/g, " ");

  const booked = billed || merged;
  const readiness = studyReportingReadiness({ status: input.status });

  let acquisition: ComposerScopeDisplay["acquisition"];
  if (readiness.state === "awaiting-acquisition") {
    // The honest statement is that nothing has been performed yet — an
    // acquisition description on a booked row is the worklist's guess, not a
    // record of pixels.
    acquisition = {
      state: "awaiting",
      label: "No images received from the machine yet",
      detail: "Booked examination only — the modality has not sent a study for this appointment.",
    };
  } else if (acquired) {
    acquisition = {
      state: "described",
      label: acquired,
      detail: bodyPart ? `Acquisition description from the study row · body part ${bodyPart}` : "Acquisition description from the study row",
    };
  } else {
    acquisition = {
      state: "unlabelled",
      label: "Images received — the study carries no examination name",
      detail: "The worklist row has no StudyDescription, so the booked name below is not proof of what was acquired.",
    };
  }

  // The region-level reading is the one CARE already trusts enough to ask about,
  // so it leads when it has something to say.
  const proposal = input.scopeProposal ?? null;
  let notice: string | null = null;
  if (acquisition.state === "described" && proposal && proposal.addedRegions.length > 0) {
    notice = `Booked ${proposal.billedRegions.join(" + ")} — the study covers ${proposal.performedRegions.join(" + ")}`;
  } else if (
    acquisition.state === "described" &&
    booked &&
    acquired &&
    !sameExam(booked, acquired)
  ) {
    notice = `Booked ${booked} — the study row says ${acquired}`;
  }

  return { booked, bookedIsBilled: Boolean(billed), acquisition, notice };
}
