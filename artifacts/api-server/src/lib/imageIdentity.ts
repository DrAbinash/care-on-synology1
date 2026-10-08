/**
 * D2 — the image a radiologist was looking at, before it becomes clinical record.
 *
 * Every durable image identity in CARE starts as a *claim* from the browser: the
 * viewer says "Study X, Series Y, instance Z, frame N". The brief's rule is that
 * a claim is not evidence, so this module turns one into a verdict by asking the
 * PACS the only question that matters — does this SOPInstanceUID live inside this
 * SeriesInstanceUID inside this StudyInstanceUID, and how many frames does it
 * actually have — and by refusing to carry forward anything the answer does not
 * support.
 *
 * Three verdicts, deliberately not two:
 *   verified        the PACS named the instance and the chain agrees. The identity
 *                   is what the PACS said, not what the client said.
 *   contradicted    the PACS answered and the claim is wrong. The caller refuses
 *                   the write: this is a different study's image, a series that
 *                   does not hold that instance, or a frame outside the object.
 *   unverifiable    the PACS could not be asked (no URL, timeout, 401/5xx). The
 *                   caller keeps the artefact and stores NO DICOM identity. An
 *                   unknown anchor stays unknown; it is never a guess.
 *
 * The frame rule is the part that cannot be delegated to the viewer. A WADO-RS
 * URL ends in `/frames/1` for a single-frame instance whatever is displayed —
 * OHIF builds it that way (`platform/core/src/utils/getWADORSImageId.js:9-17`:
 * `frame = frame ? parseInt(frame) + 1 : 1`), so "1" there is a default in a URL,
 * not a statement about the object. Only the stored DICOM's (0028,0008)
 * NumberOfFrames can say whether a frame exists at all, so the frame number is
 * dropped for single-frame instances and range-checked for multi-frame ones.
 */
import {
  expectedStudyInstanceUidForDraft,
  RadiologyIdentityError,
} from "./radiologyIdentity";
import {
  orthancAuthHeaders,
  resolveOrthancBaseFromSources,
} from "./ai/studyImageFetch";
import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";

export type ImageIdentityClaim = {
  studyInstanceUID?: string | null;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  frameNumber?: number | null;
};

export type VerifiedIdentity = {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  /** Null when the instance is single-frame, or when no frame was named. */
  frameNumber: number | null;
};

export type IdentityVerdict =
  | {
      status: "verified";
      identity: VerifiedIdentity;
      /** False when the claim named a frame the object cannot have, or named none. */
      frameClaimDropped: boolean;
    }
  | { status: "contradicted"; code: string; message: string }
  | { status: "unverifiable"; code: string; message: string };

/** DICOM UID: dots and digits only, 1..64 characters (DICOM PS3.8 limits). */
const UID_RE = /^[0-9]{1,64}(\.[0-9]{1,64})*$/;

export function isDicomUid(value: unknown): value is string {
  return typeof value === "string" && UID_RE.test(value.trim());
}

export type InstanceLookupResult =
  | { ok: true; numberOfFrames: number | null }
  | { ok: false; reason: "not-found" | "unreachable" };

export type InstanceLookup = (args: {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  /** Null asks whether the series itself is in this study, with no image named. */
  sopInstanceUID: string | null;
}) => Promise<InstanceLookupResult>;

/**
 * The frame decision, on its own so it can be tested without a network.
 * `numberOfFrames` is what the PACS says the object holds; `null` means the PACS
 * answered but the tag is not there, which is treated as single-frame because
 * multi-frame DICOM requires (0028,0008).
 */
export function decideFrame(
  claimedFrame: number | null | undefined,
  numberOfFrames: number | null,
): { frameNumber: number | null; outOfRange: boolean; dropped: boolean } {
  const multiFrame = numberOfFrames != null && numberOfFrames > 1;
  if (claimedFrame == null) return { frameNumber: null, outOfRange: false, dropped: false };
  if (!multiFrame) {
    // Absent or 1-valued frame count ⇒ there is no frame axis to point at.
    return { frameNumber: null, outOfRange: false, dropped: true };
  }
  const n = Math.floor(claimedFrame);
  if (!Number.isFinite(n) || n < 1 || n > (numberOfFrames as number)) {
    return { frameNumber: null, outOfRange: true, dropped: true };
  }
  return { frameNumber: n, outOfRange: false, dropped: false };
}

/**
 * Ask Orthanc's DICOMweb endpoint for exactly one instance. The URL itself is the
 * ownership question — a 200 for
 * `/studies/{S}/series/{SE}/instances/{I}` can only mean that SOP is in that
 * series of that study, which is stronger than "this SOP exists somewhere".
 * With no SOP named, the same path one level up asks the only question that is
 * still answerable: is this series in this study.
 */
export function createOrthancInstanceLookup(opts: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): InstanceLookup {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async ({ studyInstanceUID, seriesInstanceUID, sopInstanceUID }) => {
    const rows = await db
      .select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value })
      .from(pacsSettingsTable);
    const val = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
    const base = resolveOrthancBaseFromSources({
      envInternal: process.env.ORTHANC_INTERNAL_URL,
      envPublic: process.env.ORTHANC_URL,
      orthancBaseUrl: val("orthanc_base_url"),
      orthancUrl: val("orthanc_url"),
      orthancDicomWebUrl: val("orthanc_dicomweb_url"),
    });
    if (!base) return { ok: false, reason: "unreachable" };
    const url =
      `${base}/dicom-web/studies/${encodeURIComponent(studyInstanceUID)}`
      + `/series/${encodeURIComponent(seriesInstanceUID)}`
      + (sopInstanceUID ? `/instances/${encodeURIComponent(sopInstanceUID)}` : "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { ...orthancAuthHeaders(), Accept: "application/dicom+json, application/json" },
        signal: controller.signal,
      }).catch(() => null);
      if (!res) return { ok: false, reason: "unreachable" };
      if (res.status === 404) return { ok: false, reason: "not-found" };
      if (!res.ok) return { ok: false, reason: "unreachable" };
      const body = (await res.json().catch(() => null)) as unknown;
      const entries = Array.isArray(body) ? body : body ? [body] : [];
      const first = entries[0] as Record<string, { Value?: unknown[] }> | undefined;
      const raw = first?.["00280008"]?.Value?.[0];
      const frames = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
      return { ok: true, numberOfFrames: Number.isFinite(frames) ? frames : null };
    } catch {
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Verify one claim about the displayed image against CARE's own record of the
 * study and against the PACS. Never throws for a policy outcome — the caller
 * branches on `status`. It throws only for a contradicted study, which the
 * existing IMAGE_STUDY_MISMATCH contract already reports as 409.
 */
export async function verifyImageIdentityClaim(args: {
  draftId: number;
  claim: ImageIdentityClaim;
  lookup?: InstanceLookup;
}): Promise<IdentityVerdict> {
  const study = (args.claim.studyInstanceUID ?? "").trim();
  const series = (args.claim.seriesInstanceUID ?? "").trim();
  const sop = (args.claim.sopInstanceUID ?? "").trim();

  const expected = await expectedStudyInstanceUidForDraft(args.draftId);
  if (!expected) {
    return {
      status: "unverifiable",
      code: "IMAGE_STUDY_UNKNOWN",
      message: "This report has no DICOM StudyInstanceUID of record, so no image can be anchored to it.",
    };
  }
  if (!study) {
    throw new RadiologyIdentityError(409, "IMAGE_STUDY_REQUIRED", "Selected images must include the study UID of the open study.");
  }
  if (study !== expected) {
    throw new RadiologyIdentityError(409, "IMAGE_STUDY_MISMATCH", "Selected image belongs to a different DICOM study than this report.");
  }
  if (!isDicomUid(series) || !isDicomUid(sop)) {
    return {
      status: "contradicted",
      code: "IMAGE_IDENTITY_INCOMPLETE",
      message: "An image anchor needs both a SeriesInstanceUID and a SOPInstanceUID.",
    };
  }

  const lookup = args.lookup ?? createOrthancInstanceLookup();
  const found = await lookup({ studyInstanceUID: expected, seriesInstanceUID: series, sopInstanceUID: sop });
  if (!found.ok) {
    if (found.reason === "not-found") {
      return {
        status: "contradicted",
        code: "IMAGE_SOP_NOT_IN_STUDY",
        message: "The PACS has no such image in this study and series, so it cannot be attached as one.",
      };
    }
    return {
      status: "unverifiable",
      code: "IMAGE_PACS_UNREACHABLE",
      message: "The PACS could not be asked whether this image belongs to the study.",
    };
  }

  const frame = decideFrame(args.claim.frameNumber, found.numberOfFrames);
  if (frame.outOfRange) {
    return {
      status: "contradicted",
      code: "IMAGE_FRAME_OUT_OF_RANGE",
      message: `That frame does not exist in this image (it holds ${found.numberOfFrames}).`,
    };
  }
  return {
    status: "verified",
    identity: { studyInstanceUID: expected, seriesInstanceUID: series, sopInstanceUID: sop, frameNumber: frame.frameNumber },
    frameClaimDropped: frame.dropped,
  };
}

/**
 * What a route stores for the DICOM identity columns, given a verdict.
 * contradicted → caller refuses the request; unverifiable → no identity at all.
 */
export function identityColumnsFor(verdict: IdentityVerdict): VerifiedIdentity | null {
  return verdict.status === "verified" ? verdict.identity : null;
}

/**
 * A writer that is not a report draft — an image annotation carries its own study
 * key and may legitimately name no image at all (a study-level teaching note).
 *
 * Same rule as a draft claim, different question set:
 *   no image claimed        nothing to ask, nothing to store beyond the study
 *   series with no SOP      the SOP is the authoritative element (D2-I3), so the
 *                           series is confirmed against the study and stored alone
 *   full chain              verified by the single-instance QIDO, as above
 *
 * `expectedStudyInstanceUID` is CARE's own record of the study when the caller
 * binds one; it wins over the claim, and a claim that disagrees is contradicted
 * rather than stored.
 */
export type InstanceChainVerdict =
  | { status: "no_image"; studyInstanceUID: string }
  | { status: "series_only"; studyInstanceUID: string; seriesInstanceUID: string }
  | { status: "verified"; identity: VerifiedIdentity }
  | {
      status: "unverifiable";
      studyInstanceUID: string;
      code: string;
      message: string;
    }
  | { status: "contradicted"; code: string; message: string };

export async function verifyInstanceChain(args: {
  studyInstanceUID: string | null | undefined;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  frameNumber?: number | null;
  expectedStudyInstanceUID?: string | null;
  lookup?: InstanceLookup;
}): Promise<InstanceChainVerdict> {
  const claim = (args.studyInstanceUID ?? "").trim();
  const expected = (args.expectedStudyInstanceUID ?? "").trim();
  const study = expected || claim;
  const series = (args.seriesInstanceUID ?? "").trim();
  const sop = (args.sopInstanceUID ?? "").trim();

  if (expected && claim !== expected) {
    return {
      status: "contradicted",
      code: "IMAGE_STUDY_MISMATCH",
      message: "Selected image belongs to a different DICOM study than this record.",
    };
  }

  if (!series && !sop) return { status: "no_image", studyInstanceUID: study };

  if (!isDicomUid(study)) {
    return {
      status: "contradicted",
      code: "IMAGE_STUDY_UID_INVALID",
      message: "The study named for this image is not a DICOM StudyInstanceUID.",
    };
  }
  if (!isDicomUid(series) || (sop && !isDicomUid(sop))) {
    return {
      status: "contradicted",
      code: "IMAGE_IDENTITY_INCOMPLETE",
      message: "An image anchor needs a SeriesInstanceUID, and the SOPInstanceUID when one is named.",
    };
  }

  const lookup = args.lookup ?? createOrthancInstanceLookup();
  const found = await lookup({
    studyInstanceUID: study,
    seriesInstanceUID: series,
    sopInstanceUID: sop || null,
  });
  if (!found.ok) {
    if (found.reason === "not-found") {
      return {
        status: "contradicted",
        code: sop ? "IMAGE_SOP_NOT_IN_STUDY" : "IMAGE_SERIES_NOT_IN_STUDY",
        message: sop
          ? "The PACS has no such image in this study and series, so it cannot be attached as one."
          : "The PACS has no such series in this study, so it cannot be attached as one.",
      };
    }
    return {
      status: "unverifiable",
      studyInstanceUID: study,
      code: "IMAGE_PACS_UNREACHABLE",
      message: "The PACS could not be asked whether this image belongs to the study.",
    };
  }

  if (!sop) return { status: "series_only", studyInstanceUID: study, seriesInstanceUID: series };

  const frame = decideFrame(args.frameNumber, found.numberOfFrames);
  if (frame.outOfRange) {
    return {
      status: "contradicted",
      code: "IMAGE_FRAME_OUT_OF_RANGE",
      message: `That frame does not exist in this image (it holds ${found.numberOfFrames}).`,
    };
  }
  return {
    status: "verified",
    identity: {
      studyInstanceUID: study,
      seriesInstanceUID: series,
      sopInstanceUID: sop,
      frameNumber: frame.frameNumber,
    },
  };
}

/**
 * The four DICOM columns a kept chain verdict writes. The caller has already
 * refused a contradicted verdict; every remaining status keeps the artefact, and
 * only what the PACS confirmed is stored.
 */
export function chainColumnsFor(
  verdict: Exclude<InstanceChainVerdict, { status: "contradicted" }>,
): {
  studyInstanceUid: string;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  frameNumber: number | null;
} {
  if (verdict.status === "verified") {
    return {
      studyInstanceUid: verdict.identity.studyInstanceUID,
      seriesInstanceUid: verdict.identity.seriesInstanceUID,
      sopInstanceUid: verdict.identity.sopInstanceUID,
      frameNumber: verdict.identity.frameNumber,
    };
  }
  if (verdict.status === "series_only") {
    return {
      studyInstanceUid: verdict.studyInstanceUID,
      seriesInstanceUid: verdict.seriesInstanceUID,
      sopInstanceUid: null,
      frameNumber: null,
    };
  }
  return {
    studyInstanceUid: verdict.studyInstanceUID,
    seriesInstanceUid: null,
    sopInstanceUid: null,
    frameNumber: null,
  };
}
