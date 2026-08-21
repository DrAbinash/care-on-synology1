import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  bindOllamaRuntimeEndpointResolver,
  isEphemeralLoopbackOllamaUrl,
  preferClinicOllamaEndpoint,
  resetOllamaRuntimeEndpointResolverForTests,
  resolveOllamaInferenceEndpoint,
  formatFetchNetworkError,
} from "@workspace/ai-providers";
import {
  assertEndpointResolutionIdentity,
  normalizeEndpointIdentity,
} from "./endpointResolutionInvariant";
import {
  deriveRadiologyJobConsumerHealth,
  getRadiologyJobConsumerHeartbeat,
  markRadiologyJobConsumerRegistered,
  recordRadiologyJobCronTick,
  resetRadiologyJobConsumerHeartbeatForTests,
} from "../radiologyJobConsumerHeartbeat";

const CLINIC = "http://172.16.1.140:11434";
const TEST_EPHEMERAL = "http://127.0.0.1:65102";

describe("preferClinicOllamaEndpoint — clinic wins over test/loopback", () => {
  it("rejects ephemeral loopback when clinic URL is configured", () => {
    const r = preferClinicOllamaEndpoint({
      clinicOrRuntimeUrl: CLINIC,
      candidateUrl: TEST_EPHEMERAL,
    });
    expect(r.endpointUrl).toBe(CLINIC);
    expect(r.rejectedCandidate).toBe(TEST_EPHEMERAL);
    expect(r.rejectReason).toMatch(/ephemeral_loopback/);
  });

  it("clinic settings win over a divergent provider-settings mirror", () => {
    const r = preferClinicOllamaEndpoint({
      clinicOrRuntimeUrl: CLINIC,
      candidateUrl: "http://192.168.1.250:11434",
    });
    expect(r.endpointUrl).toBe(CLINIC);
    expect(r.source).toBe("clinic_runtime");
  });

  it("does not treat standard localhost:11434 as ephemeral", () => {
    expect(isEphemeralLoopbackOllamaUrl("http://127.0.0.1:11434")).toBe(false);
    expect(isEphemeralLoopbackOllamaUrl(TEST_EPHEMERAL)).toBe(true);
  });
});

describe("resolveOllamaInferenceEndpoint — binder + no test leak", () => {
  beforeEach(() => {
    resetOllamaRuntimeEndpointResolverForTests();
  });
  afterEach(() => {
    resetOllamaRuntimeEndpointResolverForTests();
  });

  it("bound clinic runtime wins over an ephemeral override", async () => {
    bindOllamaRuntimeEndpointResolver(async () => ({
      endpointUrl: CLINIC,
      model: "qwen3-vl:8b",
    }));
    const r = await resolveOllamaInferenceEndpoint({ endpointUrl: TEST_EPHEMERAL });
    expect(r.endpointUrl).toBe(CLINIC);
    expect(r.rejectedCandidate).toBe(TEST_EPHEMERAL);
  });

  it("health and inference resolve identical endpoint when binder is set", async () => {
    bindOllamaRuntimeEndpointResolver(async () => ({
      endpointUrl: CLINIC,
      model: "qwen3-vl:8b",
    }));
    const health = CLINIC;
    const inference = await resolveOllamaInferenceEndpoint();
    const overnight = CLINIC;
    const inv = assertEndpointResolutionIdentity({
      resolvedHealthEndpoint: health,
      resolvedInferenceEndpoint: inference.endpointUrl,
      resolvedOvernightEndpoint: overnight,
    });
    expect(inv.ok).toBe(true);
    expect(normalizeEndpointIdentity(inference.endpointUrl)).toBe(
      normalizeEndpointIdentity(health),
    );
  });
});

describe("assertEndpointResolutionIdentity", () => {
  it("fails closed on mismatch and surfaces all three URLs", () => {
    const inv = assertEndpointResolutionIdentity({
      resolvedHealthEndpoint: CLINIC,
      resolvedInferenceEndpoint: TEST_EPHEMERAL,
      resolvedOvernightEndpoint: CLINIC,
    });
    expect(inv.ok).toBe(false);
    if (inv.ok) return;
    expect(inv.code).toBe("ENDPOINT_RESOLUTION_MISMATCH");
    expect(inv.resolvedHealthEndpoint).toBe(CLINIC);
    expect(inv.resolvedInferenceEndpoint).toBe(TEST_EPHEMERAL);
    expect(inv.resolvedOvernightEndpoint).toBe(CLINIC);
  });

  it("normalizes trailing slashes", () => {
    const inv = assertEndpointResolutionIdentity({
      resolvedHealthEndpoint: `${CLINIC}/`,
      resolvedInferenceEndpoint: CLINIC,
      resolvedOvernightEndpoint: `${CLINIC}/`,
    });
    expect(inv.ok).toBe(true);
  });
});

describe("formatFetchNetworkError — surface ECONNREFUSED target", () => {
  it("includes cause address:port and intended URL", () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause: Error }).cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:65102"),
      { code: "ECONNREFUSED", address: "127.0.0.1", port: 65102 },
    );
    const msg = formatFetchNetworkError(err, `${CLINIC}/api/chat`);
    expect(msg).toMatch(/ECONNREFUSED/);
    expect(msg).toMatch(/127\.0\.0\.1:65102/);
    expect(msg).toMatch(/172\.16\.1\.140:11434/);
  });
});

describe("STARVED vs HELD_LEGACY — queue health", () => {
  beforeEach(() => {
    resetRadiologyJobConsumerHeartbeatForTests();
  });

  it("held legacy jobs do not cause STARVED", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:01:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 0, // eligible
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 2455,
      running: 0,
      nightWindow: true,
      eligibleDueAi: 0,
      heldLegacyDue: 2455,
      now: new Date("2026-08-17T20:01:10Z"),
    });
    expect(r.status).toBe("HELD_LEGACY");
    expect(r.detail).toMatch(/HELD LEGACY/i);
  });

  it("genuinely eligible unclaimed jobs can cause STARVED", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:01:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 12,
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 2455,
      running: 0,
      nightWindow: true,
      eligibleDueAi: 12,
      heldLegacyDue: 2443,
      now: new Date("2026-08-17T20:01:10Z"),
    });
    expect(r.status).toBe("STARVED");
    expect(r.detail).toMatch(/eligible/i);
  });
});
