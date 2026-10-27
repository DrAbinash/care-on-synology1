/**
 * localBurnedInOcr.ts — the on-premises half of the cloud image gate.
 *
 * WHY THE CHECK MUST NOT LEAVE THE CLINIC
 * `imageDeidentification` asks "does this raster show the patient's own
 * identifiers?" That question cannot be put to the cloud provider the answer is
 * meant to authorise, or the check would transmit the thing it is testing. So it
 * runs on the clinic's own Ollama vision model, the same one already used for
 * bill and ID-card OCR (`ocr/idCardOcrOllama.ts`), via
 * `resolveOllamaVisionForOcr()`.
 *
 * WHY IT VERIFIES LOCALITY BEFORE ASKING
 * "Ollama" is a name, not a guarantee. PR #907 established that locality comes
 * from the resolved endpoint, and a provider row labelled local can point at a
 * public host. If that happened here, every image under review would be sent to
 * that host for a privacy check whose whole purpose is to keep it local — a
 * leak that looks like a control. So the resolved endpoint is classified and
 * refused unless it is genuinely on-premises.
 *
 * WHY IT ANSWERS WITH AN ATTESTATION, NOT A STRING
 * Callers distinguish "I read the image and saw nothing" from "I could not read
 * the image", because only the first is evidence. A wrong guess here is the
 * difference between a blocked draft and a patient's name going to a vendor, so
 * every failure path returns `read: false` and the gate turns that into a
 * refusal.
 */
import { classifyEffectiveLocality, generateAiForTask } from "@workspace/ai-providers";
import { resolveOllamaVisionForOcr } from "../ocr/ocrProviderResolver";
import type { LocalOcrAttestation, LocalOcrRunner } from "./imageDeidentification";

/**
 * Ask for everything the picture says, not for clinical findings. A transcript
 * of visible text is what an overlay leaves behind; the model is not being
 * invited to interpret the study.
 */
const BURNED_IN_TEXT_PROMPT = [
  "You are transcribing text that is visible in a medical image. You are not reading the image clinically.",
  "Report EVERY piece of legible text you can see anywhere in the picture, including small corner and edge overlays,",
  "patient banners, facility names, dates, times, accession numbers, barcodes rendered as text, and any name.",
  "Answer in JSON only, no prose, in this exact shape:",
  '{"legible": true|false, "text": "all visible text, space separated"}',
  "Set \"legible\" to false if the image is blank, unreadable, or you cannot confidently transcribe it.",
  "Do not translate, expand, correct, complete or guess any text. Do not summarise. Transcribe only.",
].join("\n");

export type BurnedInOcrDeps = {
  /** Injectable so the gate can be exercised without a model. */
  resolveVision?: () => Promise<{ endpointUrl: string; model: string } | null>;
  runTask?: typeof generateAiForTask;
};

function asAttestation(raw: string): LocalOcrAttestation {
  // Anything other than the declared shape is "could not read", never "clean".
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { read: false, reason: "the local checker did not return a readable answer" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { read: false, reason: "the local checker returned malformed JSON" };
  }
  const o = parsed as { legible?: unknown; text?: unknown };
  if (typeof o.legible !== "boolean") {
    return { read: false, reason: "the local checker gave no legibility attestation" };
  }
  if (!o.legible) {
    return { read: false, reason: "the local checker could not read the image" };
  }
  // legible:true with a non-string text is a broken answer, not an empty one.
  if (typeof o.text !== "string") {
    return { read: false, reason: "the local checker attested legibility without a transcript" };
  }
  return { read: true, transcript: o.text };
}

/**
 * Build the runner the de-identification gate calls.
 *
 * Returns a runner even when no local vision model is configured: the runner
 * then answers `read: false`, and the gate refuses cloud egress. A clinic with
 * no local model does not get a silently weaker privacy control — it gets
 * text-only cloud AI, which is the honest outcome.
 */
export function createLocalBurnedInOcrRunner(deps: BurnedInOcrDeps = {}): LocalOcrRunner {
  const resolveVision = deps.resolveVision ?? resolveOllamaVisionForOcr;
  const runTask = deps.runTask ?? generateAiForTask;

  return async (imageBase64: string): Promise<LocalOcrAttestation> => {
    let vision: { endpointUrl: string; model: string } | null;
    try {
      vision = await resolveVision();
    } catch (err) {
      return { read: false, reason: `local vision lookup failed (${(err as Error)?.name ?? "Error"})` };
    }
    if (!vision?.endpointUrl?.trim() || !vision.model?.trim()) {
      return { read: false, reason: "no local vision model is configured" };
    }

    // The check is only a control if it stays on-premises.
    const locality = classifyEffectiveLocality("ollama", vision.endpointUrl).locality;
    if (locality !== "local") {
      return {
        read: false,
        reason:
          "the configured local model resolves to an off-premises endpoint, so it cannot be used to verify images before cloud transmission",
      };
    }

    let result: Awaited<ReturnType<typeof generateAiForTask>>;
    try {
      result = await runTask("burned_in_text_ocr", BURNED_IN_TEXT_PROMPT, [imageBase64], {
        provider: "ollama",
        model: vision.model,
        endpointUrl: vision.endpointUrl,
        maxTokens: 512,
      });
    } catch (err) {
      // The reason may echo an endpoint or credential, so it is categorised, not
      // interpolated — the caller only ever needs to know the check did not run.
      return { read: false, reason: `local vision call failed (${(err as Error)?.name ?? "Error"})` };
    }

    if (!result?.success) {
      return {
        read: false,
        reason:
          result?.execution?.attempted === false
            ? "the local model refused the request before answering"
            : "the local model did not answer",
      };
    }
    return asAttestation(result.text ?? "");
  };
}
