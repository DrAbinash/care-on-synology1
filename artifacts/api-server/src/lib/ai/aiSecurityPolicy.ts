/**
 * STAGE 1 PR-A2 — one place that decides how strict the AI image-egress policy is.
 *
 * WHY THIS EXISTS
 * PR-A (#1075) made patient pixels local-only and required a per-request clinician
 * attestation before any of them could reach a cloud provider. That was the right
 * Stage 1 rule, and the platform is not yet a multi-centre clinical system: it is
 * in development and clinical evaluation by its owner, who is also its primary
 * user, and he needs to compare local and cloud vision models without re-deploying.
 * The strictness therefore becomes a setting, not a constant.
 *
 * WHAT THIS IS NOT
 * It is not a permissions system and not a second settings subsystem. It reads the
 * `ai_provider_settings` `__global__` row that `routes/aiReporting.ts` already owns,
 * and the overnight cloud-vision opt-in that `clinicalConfigService` already owns.
 * It adds no table, no column, no route and no new flag: the mode *derives* the two
 * dependent flags, so there is no state where "Clinical" and "attestation off"
 * contradict each other.
 *
 * FAIL CLOSED, ON PURPOSE
 * Missing row, unreadable JSON, a value that is not one of the two modes, or a
 * database error on the read all resolve to `clinical`. A settings read that fails
 * must never be the reason an image leaves the building — that is the same rule
 * `parseOvernightOpsJson` applies to the nightly pipeline.
 */
import { db } from "@workspace/db";
import { aiProviderSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getOvernightOpsControls } from "./clinicalConfigService";

export const AI_SECURITY_MODES = ["development", "clinical"] as const;

export type AiSecurityMode = (typeof AI_SECURITY_MODES)[number];

/** Ruling: an absent or invalid mode is never the permissive one. */
export const FALLBACK_AI_SECURITY_MODE: AiSecurityMode = "clinical";

export type AiSecurityPolicy = {
  mode: AiSecurityMode;
  /**
   * The clinic's existing cloud-vision opt-in, kept as it is:
   * `overnight_ops_json.deepseekCloudVisionAllowed`, which the server already reads
   * as the opt-in for every cloud vendor. This module deliberately does not add a
   * second switch for the same thing.
   */
  cloudVisionAllowed: boolean;
  /**
   * Clinical: a person must attest each request that puts patient-derived images in
   * front of a cloud provider. Development: the admin's enablement is the decision,
   * so no per-request attestation is demanded of a single-user evaluation.
   */
  requireAttestation: boolean;
  /**
   * Clinical: a cloud image send whose audit row could not be written is refused as
   * a result, because an unprovable external send is the one thing this table exists
   * to make visible. Local sends are never blocked by an audit failure in either
   * mode — nothing left the clinic, so there is nothing to account for.
   */
  strictAudit: boolean;
};

/** Derived, never stored. Adding these as independent switches is what ruling 2 forbids. */
export function flagsForMode(mode: AiSecurityMode): {
  requireAttestation: boolean;
  strictAudit: boolean;
} {
  return mode === "development"
    ? { requireAttestation: false, strictAudit: false }
    : { requireAttestation: true, strictAudit: true };
}

export function parseAiSecurityMode(raw: unknown): AiSecurityMode {
  if (typeof raw !== "string") return FALLBACK_AI_SECURITY_MODE;
  const normalized = raw.trim().toLowerCase();
  return (AI_SECURITY_MODES as readonly string[]).includes(normalized)
    ? (normalized as AiSecurityMode)
    : FALLBACK_AI_SECURITY_MODE;
}

/** The mode as stored, before derivation — for the route's read-back and audit diff. */
export function readAiSecurityModeFromJson(settingsJson: string | null | undefined): AiSecurityMode {
  if (!settingsJson) return FALLBACK_AI_SECURITY_MODE;
  try {
    const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
    return parseAiSecurityMode(parsed.aiSecurityMode);
  } catch {
    return FALLBACK_AI_SECURITY_MODE;
  }
}

/**
 * The strictest answer this function can give, used when the settings read itself
 * fails. Written out rather than derived so that a future edit cannot make the
 * failure path permissive by accident.
 */
const STRICTEST_POLICY: AiSecurityPolicy = {
  mode: FALLBACK_AI_SECURITY_MODE,
  cloudVisionAllowed: false,
  requireAttestation: true,
  strictAudit: true,
};

/**
 * Read once per send. No cache: the owner's ruling is that changing the setting
 * changes server-side behaviour, and `getGlobalSettings()` / `getOvernightOpsControls()`
 * already read the row per call. A cached policy would make the Settings screen a
 * decoration instead of a control.
 */
export async function resolveAiSecurityPolicy(): Promise<AiSecurityPolicy> {
  let mode: AiSecurityMode = FALLBACK_AI_SECURITY_MODE;
  let modeReadFailed = false;
  try {
    const [row] = await db
      .select({ settingsJson: aiProviderSettingsTable.settingsJson })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "__global__"))
      .limit(1);
    mode = readAiSecurityModeFromJson(row?.settingsJson);
  } catch {
    modeReadFailed = true;
    mode = FALLBACK_AI_SECURITY_MODE;
  }

  let cloudVisionAllowed = false;
  try {
    const ops = await getOvernightOpsControls();
    // Both keys, exactly as `gatewayInferenceProvider` reads them today: the stored
    // key is named for DeepSeek but the server has always treated it as the
    // cloud-vision opt-in for every vendor. Reading only the named key would create
    // a second, narrower meaning for the same setting.
    cloudVisionAllowed =
      ops.deepseekCloudVisionAllowed === true ||
      (ops as { cloudVisionAllowed?: boolean }).cloudVisionAllowed === true;
  } catch {
    cloudVisionAllowed = false;
  }

  // A settings read that failed cannot open a door even in the mode that allows
  // cloud testing: without knowing the mode, the only safe answer is the strict one
  // with the opt-in forced off.
  if (modeReadFailed) return STRICTEST_POLICY;

  return { mode, cloudVisionAllowed, ...flagsForMode(mode) };
}

/**
 * PR-A2B — what an INTERACTIVE send must hand `generateAiResponse` so the egress
 * gate can judge it.
 *
 * WHY THIS IS A FUNCTION AND NOT FOUR INLINE ARGUMENTS
 * PR-A built the gate and PR-A2 built the mode, and both were correct — then three
 * routes called the execution layer with neither (`/draft`, `/query`, `/image-review`
 * through `executeInteractiveAiCall`, plus `/api/ai-comparison/run` directly), so
 * `cloudVisionAllowed` arrived as `undefined`, the gate's first term refused, and
 * Development mode could not send a single pixel to a cloud model. The defect was
 * never the policy: it was that the policy had no owner on the interactive path, so
 * every call site was free to forget it. One function, called by the layer that
 * makes the send, is what stops the fourth route forgetting the same way.
 *
 * WHAT IT DELIBERATELY DOES NOT ACCEPT
 * A caller-supplied `cloudVisionAllowed`. The value is read from the clinic's own
 * row on every call, so a browser body cannot authorise an image leaving the
 * building. `attestedBy` is the one input that comes from a person, and the route
 * passes the identity from ITS session, not from the request: a client cannot
 * attest in somebody else's name.
 */
export type InteractiveImageEgress = {
  /** Spread straight into `generateAiResponse`'s options. */
  options: {
    cloudVisionAllowed: boolean;
    requireAttestation: boolean;
    consentAttestedPerRequest: boolean;
    imageSourceTypes?: readonly string[];
  };
  attested: boolean;
  /** The mode this send was judged by, or null when nothing egressed. */
  mode: AiSecurityMode | null;
};

/**
 * A send with no pixels is not an egress decision: `assertCloudImageEgress` returns
 * before it reads any of these terms. Written out rather than resolved so a
 * text-only keystroke costs two database reads it cannot use — and so the inert
 * answer is the strict one, in case a future caller spreads this into a path that
 * does look.
 */
const NO_IMAGE_EGRESS: InteractiveImageEgress = {
  options: {
    cloudVisionAllowed: false,
    requireAttestation: true,
    consentAttestedPerRequest: false,
  },
  attested: false,
  mode: null,
};

export async function resolveInteractiveImageEgress(args: {
  imageCount: number;
  /**
   * Per-image `source_type` for pixels the SERVER resolved (frames pulled from
   * Orthanc by a study UID it read off its own worklist row are `DICOM`). Omit
   * them when the bytes arrived in a request body: `assertCloudImageEgress` reads
   * an omission as unprovenanced, which is the honest answer and costs nothing in
   * Development mode and everything in Clinical.
   */
  imageSourceTypes?: readonly string[] | null;
  /** The authenticated session's subject reference, when the clinician confirmed. */
  attestedBy?: string | null;
}): Promise<InteractiveImageEgress> {
  if (args.imageCount <= 0) return NO_IMAGE_EGRESS;

  const policy = await resolveAiSecurityPolicy();
  const attested = typeof args.attestedBy === "string" && args.attestedBy.trim() !== "";
  const sources = args.imageSourceTypes ?? [];
  return {
    attested,
    mode: policy.mode,
    options: {
      cloudVisionAllowed: policy.cloudVisionAllowed,
      // Omitting the term would also mean "required" inside the gate; it is passed
      // explicitly so this file remains the only place the mode is interpreted.
      requireAttestation: policy.requireAttestation,
      consentAttestedPerRequest: attested,
      ...(sources.length > 0 ? { imageSourceTypes: sources } : {}),
    },
  };
}

/**
 * Server-side allowlist for the global settings blob (ruling 10).
 *
 * The route used to persist `{ ...previous, ...incomingBody }`, which meant any key
 * a client invented landed in the row. That was harmless while every reader picked
 * named keys; it is not harmless once a security mode lives in the same object,
 * because `"developmen"` or `"dev"` would then be a policy value the server has to
 * interpret. So keys are filtered and typed here, and an unknown key is refused with
 * a 400 rather than silently dropped — a silently dropped key reads as "saved" to the
 * person who sent it.
 */
export type GlobalSettingsPatchResult =
  | { ok: true; patch: Record<string, unknown>; modeChanged: boolean }
  | { ok: false; error: string };

const GLOBAL_BOOLEAN_KEYS = [
  "enabled",
  "includeDemographics",
  "anonymize",
  "cloudTextPhiAllowed",
] as const;

const GLOBAL_STRING_KEYS = ["defaultPrompt", "defaultPromptTemplate"] as const;

const GLOBAL_ENUM_KEYS = ["aiSecurityMode"] as const;

const GLOBAL_OTHER_KEYS = ["defaultProvider", "allowedRoles"] as const;

const GLOBAL_ALLOWED_KEYS = new Set<string>([
  ...GLOBAL_BOOLEAN_KEYS,
  ...GLOBAL_STRING_KEYS,
  ...GLOBAL_ENUM_KEYS,
  ...GLOBAL_OTHER_KEYS,
]);

export function sanitizeGlobalSettingsPatch(
  incoming: unknown,
): GlobalSettingsPatchResult {
  if (incoming == null || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { ok: false, error: "global must be an object" };
  }
  const body = incoming as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !GLOBAL_ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    return { ok: false, error: `Unsupported global setting key(s): ${unknown.join(", ")}` };
  }

  const patch: Record<string, unknown> = {};
  for (const key of GLOBAL_BOOLEAN_KEYS) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") {
        return { ok: false, error: `${key} must be boolean` };
      }
      patch[key] = body[key];
    }
  }
  for (const key of GLOBAL_STRING_KEYS) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "string") {
        return { ok: false, error: `${key} must be a string` };
      }
      patch[key] = body[key].slice(0, 20000);
    }
  }
  if (body.defaultProvider !== undefined) {
    if (typeof body.defaultProvider !== "string") {
      return { ok: false, error: "defaultProvider must be a string" };
    }
    patch.defaultProvider = body.defaultProvider.trim().slice(0, 60);
  }
  if (body.allowedRoles !== undefined) {
    if (!Array.isArray(body.allowedRoles) || body.allowedRoles.some((r) => typeof r !== "string")) {
      return { ok: false, error: "allowedRoles must be an array of strings" };
    }
    patch.allowedRoles = (body.allowedRoles as string[]).map((r) => r.trim().slice(0, 40));
  }

  // The security mode is the one key whose invalid value cannot be stored as written:
  // it is normalised here so the row can only ever hold one of the two modes.
  if (body.aiSecurityMode !== undefined) {
    const raw = body.aiSecurityMode;
    if (typeof raw !== "string") return { ok: false, error: "aiSecurityMode must be a string" };
    const normalized = raw.trim().toLowerCase();
    if (!(AI_SECURITY_MODES as readonly string[]).includes(normalized)) {
      return {
        ok: false,
        error: `aiSecurityMode must be one of: ${AI_SECURITY_MODES.join(", ")}`,
      };
    }
    patch.aiSecurityMode = normalized;
  }

  return { ok: true, patch, modeChanged: body.aiSecurityMode !== undefined };
}
