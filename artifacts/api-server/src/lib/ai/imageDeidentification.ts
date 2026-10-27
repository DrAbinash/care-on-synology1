/**
 * imageDeidentification.ts — the gate that decides whether a pixel may leave the
 * clinic.
 *
 * WHY THIS EXISTS
 * Until now CARE had no answer to this question at all: `dicomRedaction.ts`
 * records `DICOM_REDACTION_PERFORMED = false` and says plainly that "No code path
 * scrubs a prompt or masks a pixel today". A PACS-rendered JPEG carries no DICOM
 * tags, but it can carry two other things: identifier text the modality burned
 * INTO the picture (routine on ultrasound, where the patient's name sits in the
 * corner), and container metadata (EXIF / PNG tEXt) that a render step may have
 * copied across. The old posture in `gatewayPrivacy.ts` was the literal string
 * `"not_verified"` on every return path — honest, but it meant cloud image egress
 * could never be authorised, only refused.
 *
 * THE RULE THIS ENFORCES
 * "If burned-in identifiers cannot be reliably excluded, block cloud
 * transmission." So the posture is three-valued and only ONE of them sends:
 *
 *   clean              — the local check read the image and found no identifier
 *   identifiers_found  — the local check found one; blocked
 *   not_verified       — the local check could not attest (no model, unreadable
 *                        image, malformed answer); BLOCKED, not waved through
 *
 * `not_verified` blocking is the whole point. A vision model that returns an
 * empty transcript because it was never running is indistinguishable from a
 * genuinely blank image, so "OCR said nothing" cannot be treated as "the image
 * contains nothing" unless the checker also attests that it could read the
 * picture.
 *
 * WHY THE CHECK RUNS LOCALLY
 * The check cannot be performed by the cloud provider it is authorising — that
 * would mean sending the image to find out whether the image may be sent. It runs
 * on the clinic's own Ollama vision model, so the PHI stays on-premises and only
 * a verified-clean raster goes out.
 *
 * WHY IT MATCHES THE PATIENT'S OWN IDENTIFIERS
 * Generic PHI patterns over an OCR transcript produce both misses (a name is just
 * a word) and false alarms (a hospital name, a date on a scale). The request
 * already belongs to one known patient, so the precise question is: does THIS
 * image contain THIS patient's name, date of birth, ID or accession? That is a
 * high-precision match, and it is the reason the caller must resolve the
 * identifiers server-side rather than trusting anything the browser sends.
 *
 * The re-encoded bytes — never the input bytes — are what the caller is allowed
 * to hand to a provider. The original DICOM stays in Orthanc, untouched: this
 * module only ever narrows what may leave.
 */
import { detectPhiCategories } from "@workspace/ai-providers";

export type DeidPosture = "clean" | "identifiers_found" | "not_verified";

export type CloudImageMime = "image/jpeg" | "image/png" | "image/webp";

/**
 * The identifiers that belong to the patient this image is of. Every field is
 * optional: an unconfigured clinic cannot be blamed for a missing MRN, but a
 * field that IS present and IS found in the image blocks egress.
 */
export type PatientIdentifiers = {
  patientName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  patientId?: string | null;
  mrn?: string | null;
  accessionNumber?: string | null;
  /** Free-text tokens that must never appear in an outgoing image. */
  extraForbiddenTerms?: string[];
};

export type LocalOcrAttestation =
  | {
      /** The checker read the picture and this is everything it could see. */
      read: true;
      transcript: string;
    }
  | {
      /** The checker could not read the picture — reason is for the operator. */
      read: false;
      reason: string;
    };

export type LocalOcrRunner = (imageBase64: string, mimeType: CloudImageMime) => Promise<LocalOcrAttestation>;

export type DeidentifyResult =
  | {
      ok: true;
      posture: "clean";
      /** Metadata-free re-encoded bytes. The ONLY thing safe to send. */
      base64: string;
      mimeType: CloudImageMime;
      bytesIn: number;
      bytesOut: number;
      /** Categories matched were none; kept for the audit row. */
      matched: [];
    }
  | {
      ok: false;
      posture: DeidPosture;
      safeError: string;
      detail: string;
      /** Category names only — never the matched value, which is itself PHI. */
      matched: string[];
    };

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function fail(posture: DeidPosture, safeError: string, detail: string, matched: string[] = []): DeidResultFail {
  return { ok: false, posture, safeError, detail, matched } as DeidResultFail;
}

type DeidResultFail = Extract<DeidentifyResult, { ok: false }>;

/**
 * Normalise a token for matching: case-fold, and drop punctuation and spacing
 * that a raster would render differently from the structured record ("Dr. Abc
 * Xyz" vs "abc xyz", "12/04/1980" vs "12-04-1980").
 */
function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Date renderings a modality might burn in, all folded to comparable forms. */
function dateOfBirthVariants(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return [foldForMatch(iso)];
  const [, y, mo, d] = m;
  const out = new Set<string>();
  for (const cand of [
    `${y}-${mo}-${d}`,
    `${y}/${mo}/${d}`,
    `${d}/${mo}/${y}`,
    `${d}-${mo}-${y}`,
    `${mo}/${d}/${y}`,
    `${d}${mo}${y}`,
    `${y}${mo}${d}`,
  ]) {
    const f = foldForMatch(cand);
    if (f) out.add(f);
  }
  return [...out];
}

function nameTokens(identifiers: PatientIdentifiers): string[] {
  const out = new Set<string>();
  const push = (raw?: string | null) => {
    const f = foldForMatch(raw ?? "");
    if (!f) return;
    out.add(f);
    // A single surname must match on its own: burned-in overlays commonly show
    // "SINGH, ABINASH" or just the surname above the name line.
    for (const part of f.split(" ")) if (part.length >= 3) out.add(part);
  };
  push(identifiers.patientName);
  push(identifiers.firstName);
  push(identifiers.lastName);
  return [...out];
}

function exactIdentifierTerms(identifiers: PatientIdentifiers): Array<{ label: string; forms: string[] }> {
  const terms: Array<{ label: string; forms: string[] }> = [];
  const add = (label: string, raw?: string | null) => {
    const f = foldForMatch(raw ?? "");
    if (f.length >= 3) terms.push({ label, forms: [f] });
  };
  add("patient_id", identifiers.patientId);
  add("mrn", identifiers.mrn);
  add("accession_number", identifiers.accessionNumber);
  if (identifiers.dateOfBirth?.trim()) {
    terms.push({ label: "date_of_birth", forms: dateOfBirthVariants(identifiers.dateOfBirth) });
  }
  for (const t of identifiers.extraForbiddenTerms ?? []) add("forbidden_term", t);
  return terms;
}

/**
 * Match the transcript against this patient's own identifiers.
 *
 * Names shorter than 3 folded characters are ignored on purpose: "an", "dr", a
 * single initial produce more false blocks than real catches, and a full given
 * name is what actually appears in a burned-in overlay.
 */
export function matchBurnedInIdentifiers(
  transcript: string,
  identifiers: PatientIdentifiers,
): string[] {
  const hay = foldForMatch(transcript);
  if (!hay) return [];
  const matched = new Set<string>();

  for (const token of nameTokens(identifiers)) {
    if (token.length < 3) continue;
    if (hay.includes(token)) matched.add("patient_name");
  }
  for (const { label, forms } of exactIdentifierTerms(identifiers)) {
    if (forms.some((f) => hay.includes(f))) matched.add(label);
  }
  // The generic patterns are a backstop for identifiers the clinic did not
  // configure (a phone number, an address, an external referral name).
  for (const cat of detectPhiCategories(transcript)) matched.add(cat);

  return [...matched];
}

/**
 * Re-encode the raster so no container metadata survives, and prove it.
 *
 * sharp only preserves metadata when `withMetadata()` is called, so a plain
 * decode→encode drops EXIF and PNG text chunks. That is asserted here rather
 * than assumed: if the pipeline cannot re-encode (an unreadable or non-raster
 * payload) the caller gets `not_verified`, not a pass.
 */
async function stripContainerMetadata(
  base64: string,
  mimeType: CloudImageMime,
): Promise<{ ok: true; base64: string; bytesIn: number; bytesOut: number } | { ok: false; reason: string }> {
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    return { ok: false, reason: "image re-encode unavailable (sharp not loadable)" };
  }
  const input = Buffer.from(base64, "base64");
  if (input.length === 0) return { ok: false, reason: "image payload is empty" };
  if (input.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `image payload exceeds ${MAX_IMAGE_BYTES} bytes` };
  }
  try {
    // No withMetadata(): EXIF/PNG tEXt/jPEG COM are dropped on write.
    const out = await sharp(input, { failOn: "none" })
      .rotate()
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    const meta = await sharp(out).metadata();
    if (meta.format !== "jpeg") return { ok: false, reason: "re-encode did not produce JPEG" };
    // Prove the drop rather than trusting it: EXIF and IFD are the fields a PACS
    // render would carry a name in.
    const md: Record<string, unknown> = (meta as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
    if (md.exif || md.icc_profile || md.ifd0) {
      return { ok: false, reason: "metadata survived re-encode" };
    }
    return { ok: true, base64: out.toString("base64"), bytesIn: input.length, bytesOut: out.length };
  } catch (err) {
    return { ok: false, reason: `re-encode failed: ${(err as Error)?.message ?? String(err)}` };
  }
}

/**
 * Prepare one image for cloud egress, or refuse it.
 *
 * `runLocalOcr` is injected rather than imported so the gate is testable without
 * a model, and so a deployment with no local vision model gets an honest
 * `not_verified` refusal instead of an accidental pass.
 */
export async function deidentifyImageForCloudEgress(opts: {
  base64: string;
  mimeType: string;
  identifiers: PatientIdentifiers;
  runLocalOcr: LocalOcrRunner;
}): Promise<DeidentifyResult> {
  const mime = opts.mimeType.toLowerCase();
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    // A DICOM dataset must never be handed here at all; this is defence in
    // depth behind assertNoRawDicomPayload, not a substitute for it.
    return fail("not_verified", "cloud_image_mime_not_allowed", `Refused non-raster payload (${opts.mimeType}).`);
  }

  const stripped = await stripContainerMetadata(opts.base64, mime as CloudImageMime);
  if (!stripped.ok) {
    return fail("not_verified", "cloud_image_not_verifiable", stripped.reason);
  }

  const attestation = await opts.runLocalOcr(
    stripped.base64,
    "image/jpeg",
  );
  if (!attestation.read) {
    return fail(
      "not_verified",
      "cloud_image_not_verifiable",
      `Burned-in identifiers could not be excluded: ${attestation.reason}. The image stays on-premises.`,
    );
  }

  const matched = matchBurnedInIdentifiers(attestation.transcript, opts.identifiers);
  if (matched.length > 0) {
    // Report categories, never the matched text — the value is itself PHI and an
    // audit row or a toast must not become a second leak.
    return fail(
      "identifiers_found",
      "cloud_image_burned_in_identifiers",
      `Patient identifiers are visible in the image (${matched.join(", ")}). Cloud transmission is blocked; use a local model or select a different image.`,
      matched,
    );
  }

  return {
    ok: true,
    posture: "clean",
    base64: stripped.base64,
    mimeType: "image/jpeg",
    bytesIn: stripped.bytesIn,
    bytesOut: stripped.bytesOut,
    matched: [],
  };
}

/**
 * Apply the gate to every image a job wants to send. Fails closed as a set: one
 * unverifiable image blocks the whole request rather than silently dropping to
 * the images that passed, because a partial image set would change what the
 * report claims.
 */
export async function deidentifyImagesForCloudEgress(opts: {
  images: Array<{ base64: string; mimeType: string }>;
  identifiers: PatientIdentifiers;
  runLocalOcr: LocalOcrRunner;
}): Promise<{ ok: true; images: Array<{ base64: string; mimeType: CloudImageMime }> } | { ok: false; safeError: string; detail: string }> {
  const out: Array<{ base64: string; mimeType: CloudImageMime }> = [];
  for (let i = 0; i < opts.images.length; i += 1) {
    const r = await deidentifyImageForCloudEgress({
      base64: opts.images[i].base64,
      mimeType: opts.images[i].mimeType,
      identifiers: opts.identifiers,
      runLocalOcr: opts.runLocalOcr,
    });
    if (!r.ok) {
      return {
        ok: false,
        safeError: r.safeError,
        detail: `Image ${i + 1} of ${opts.images.length}: ${r.detail}`,
      };
    }
    out.push({ base64: r.base64, mimeType: r.mimeType });
  }
  return { ok: true, images: out };
}
