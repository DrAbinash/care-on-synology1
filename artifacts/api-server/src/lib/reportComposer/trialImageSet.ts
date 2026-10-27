/**
 * The picture set `POST /api/radiology/report-composer/vision-trial` is willing to run.
 *
 * Why this is a separate module: the route used to build the set inline — map every entry,
 * `filter` out the ones that failed the mime or size test, then `.slice(0, 6)` the survivors.
 * Seven pasted pictures became six, one unsupported type became the rest, and nothing in the
 * response, the audit or the prompt said so: `imageCount` reported the survivors
 * (`providers/deepseekVisionTrial.ts:163-269`) and the model was even told
 * "Image count: 6" (`:139`). An operator standing on this screen to decide whether a model can
 * read images was shown an answer to a different question than the one they asked.
 *
 * The rule applied here is the one this repository already chose for the same problem on the
 * comparison route: reject the whole set, never send a shortened one
 * (`routes/aiComparison.ts:44-46`, "Returns null when the set is rejected as a whole, never a
 * shortened list"). The ceilings are the route's own existing numbers — 6 pictures, 3.5 M base64
 * characters, jpeg/png/webp — so no new limit is invented and nothing an operator could send
 * before becomes sendable now. The change is only in what happens when a set breaks a rule.
 *
 * Extracted rather than left inline so the contract is asserted by running code. The router
 * itself cannot be imported in a test without a database — it pulls in the job queue and the
 * compose engine, which is why `routes/reportComposer.visionTrialGate.test.ts` is a static
 * guard — and a static guard on this function's *name* would not catch the behaviour returning.
 */

export const VISION_TRIAL_MAX_IMAGES = 6;
export const VISION_TRIAL_MAX_IMAGE_CHARS = 3_500_000;
export const VISION_TRIAL_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type TrialImageMime = (typeof VISION_TRIAL_ALLOWED_MIMES)[number];

export type TrialImage = {
  mimeType: TrialImageMime;
  base64: string;
  label?: string;
  filename?: string;
};

export type TrialImageSet =
  | {
      ok: true;
      images: TrialImage[];
      /** How many pictures the caller supplied, so a response can be read against the request. */
      suppliedCount: number;
      acceptedCount: number;
      droppedIndexes: number[];
    }
  | {
      ok: false;
      /** Names the rule that bit and the numbers behind it. Sent to the operator verbatim. */
      reason: string;
      suppliedCount: number;
      acceptedCount: 0;
      /** Indexes of the individual entries that broke a rule; empty on a count refusal. */
      droppedIndexes: number[];
    };

function isTrialImageMime(value: string): value is TrialImageMime {
  return (VISION_TRIAL_ALLOWED_MIMES as readonly string[]).includes(value);
}

/**
 * Normalise a browser-supplied picture set, or refuse the whole of it.
 *
 * `raw` is whatever `body.images` was. A missing or non-array value means "no pictures", which is
 * what the route has always treated it as — the UI's own trial runs that way
 * (`ReportComposerTestPanel.tsx:304-309` posts no images at all).
 */
export function normalizeTrialImageSet(raw: unknown): TrialImageSet {
  if (raw == null || !Array.isArray(raw)) {
    return { ok: true, images: [], suppliedCount: 0, acceptedCount: 0, droppedIndexes: [] };
  }

  const suppliedCount = raw.length;

  // The count ceiling is checked before anything is read, so a seventh picture cannot be
  // silently dropped on the way to validating the first six.
  if (suppliedCount > VISION_TRIAL_MAX_IMAGES) {
    return {
      ok: false,
      reason:
        `Send at most ${VISION_TRIAL_MAX_IMAGES} images — this request carried ${suppliedCount}. ` +
        `The trial never drops pictures on its own: an answer would describe fewer images than ` +
        `you selected.`,
      suppliedCount,
      acceptedCount: 0,
      droppedIndexes: [],
    };
  }

  const images: TrialImage[] = [];
  const droppedIndexes: number[] = [];
  const badMimes: string[] = [];
  let oversized = false;
  let emptyPayload = false;

  raw.forEach((entry, index) => {
    const record =
      entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!record) {
      droppedIndexes.push(index);
      emptyPayload = true;
      return;
    }

    const mime = String(record.mimeType ?? "image/jpeg");
    if (!isTrialImageMime(mime)) {
      droppedIndexes.push(index);
      if (!badMimes.includes(mime)) badMimes.push(mime);
      return;
    }

    const base64 = record.base64;
    if (typeof base64 !== "string" || base64.trim().length === 0) {
      droppedIndexes.push(index);
      emptyPayload = true;
      return;
    }
    const trimmed = base64.trim();
    if (trimmed.length > VISION_TRIAL_MAX_IMAGE_CHARS) {
      droppedIndexes.push(index);
      oversized = true;
      return;
    }

    const label = typeof record.label === "string" ? record.label.slice(0, 80) : undefined;
    const filename =
      typeof record.filename === "string" ? record.filename.slice(0, 120) : undefined;
    images.push({
      mimeType: mime,
      base64: trimmed,
      ...(label === undefined ? {} : { label }),
      ...(filename === undefined ? {} : { filename }),
    });
  });

  if (droppedIndexes.length > 0) {
    const which = droppedIndexes.map((i) => i + 1).join(", ");
    let rule: string;
    if (badMimes.length > 0) {
      rule =
        `"${badMimes.join('", "')}" is not an accepted type — this trial sends ` +
        `jpeg, png or webp only.`;
    } else if (oversized) {
      rule =
        `one or more pictures exceed ${VISION_TRIAL_MAX_IMAGE_CHARS} base64 characters.`;
    } else {
      rule = "one or more entries carry no image data.";
    }
    return {
      ok: false,
      reason:
        `Picture ${which} of ${suppliedCount} cannot be sent: ${rule} ` +
        `The trial refuses the whole set instead of answering a shorter one — ` +
        `select ${suppliedCount - droppedIndexes.length} pictures or fewer without that entry.`,
      suppliedCount,
      acceptedCount: 0,
      droppedIndexes,
    };
  }

  return {
    ok: true,
    images,
    suppliedCount,
    acceptedCount: images.length,
    droppedIndexes: [],
  };
}
