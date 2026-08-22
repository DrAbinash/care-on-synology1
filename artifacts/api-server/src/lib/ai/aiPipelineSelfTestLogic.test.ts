import { describe, it, expect } from "vitest";
import {
  assertDiagnosticReportPhiSafe,
  buildFullCareStages,
  buildProviderOnlyStages,
  deriveSelfTestFinal,
  parseDraftSections,
  selfTestSafetyContract,
} from "./aiPipelineSelfTestLogic";
import { classifyShadowDraftUsability } from "./shadowDraftUsability";

describe("aiPipelineSelfTestLogic", () => {
  it("parseDraftSections extracts findings/impression candidates", () => {
    const p = parseDraftSections(
      "FINDINGS:\n- Ventricles normal.\n- No hemorrhage.\n\nIMPRESSION:\nNo acute infarct.",
    );
    expect(p.parserSuccess).toBe(true);
    expect(p.candidateCount).toBeGreaterThanOrEqual(2);
    expect(p.jsonParseOk).toBeNull();
  });

  it("detects JSON parse failure separately from section parse", () => {
    const p = parseDraftSections("{ not valid json");
    expect(p.looksLikeJson).toBe(true);
    expect(p.jsonParseOk).toBe(false);
  });

  it("represents provider pass + parser fail with explicit stages", () => {
    const stages = buildFullCareStages({
      imageFetchOk: true,
      imageFetchMs: 100,
      providerReturned: true,
      providerElapsedMs: 18400,
      httpStatus: 200,
      safeError: null,
      parserSuccess: false,
      candidateCount: 0,
      jsonParseOk: false,
    });
    const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
    expect(byId.provider_request?.status).toBe("pass");
    expect(byId.provider_response_received?.status).toBe("pass");
    expect(byId.provider_response_received?.detail).toBe("YES");
    expect(byId.json_parse?.status).toBe("fail");
    expect(byId.final_shape?.status).toBe("fail");
  });

  it("represents provider fail at ~30s without collapsing into parser", () => {
    const stages = buildFullCareStages({
      imageFetchOk: true,
      imageFetchMs: 200,
      providerReturned: false,
      providerElapsedMs: 30100,
      httpStatus: 502,
      safeError: "TIMEOUT_OR_ABORT",
      parserSuccess: null,
      candidateCount: null,
      jsonParseOk: null,
    });
    const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
    expect(byId.provider_request?.status).toBe("fail");
    expect(byId.provider_request?.detail).toContain("30.1");
    expect(byId.provider_response_received?.detail).toBe("NO");
    expect(byId.json_parse?.status).toBe("not_reached");
    expect(byId.candidate_extract?.status).toBe("not_reached");
  });

  it("provider-only stops before parser/trust", () => {
    const stages = buildProviderOnlyStages({
      imageFetchOk: true,
      imageFetchMs: 50,
      providerReturned: true,
      providerElapsedMs: 12000,
      httpStatus: 200,
      safeError: null,
    });
    const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
    expect(byId.json_parse?.status).toBe("skip");
    expect(byId.trust_grounding?.status).toBe("skip");
  });

  it("1-image provider pass + 6-image provider fail → PARTIAL", () => {
    const r = deriveSelfTestFinal({
      noMri: false,
      directGeneratePass: true,
      directChatPass: true,
      providerOnly1Pass: true,
      providerOnly6Pass: false,
      fullCare1Pass: true,
      fullCare6Pass: false,
    });
    expect(r.final).toBe("PARTIAL");
    expect(r.summary).toMatch(/6 image|normal draft image count/i);
  });

  it("direct pass + provider fail → PARTIAL/FAIL", () => {
    const r = deriveSelfTestFinal({
      noMri: false,
      directGeneratePass: true,
      directChatPass: true,
      providerOnly1Pass: false,
      providerOnly6Pass: false,
      fullCare1Pass: false,
      fullCare6Pass: false,
    });
    expect(r.final).toBe("PARTIAL");
    expect(r.summary).toMatch(/Direct vision healthy/i);
  });

  it("provider pass + full CARE parser fail → PARTIAL at parser", () => {
    const r = deriveSelfTestFinal({
      noMri: false,
      directGeneratePass: true,
      directChatPass: true,
      providerOnly1Pass: true,
      providerOnly6Pass: true,
      fullCare1Pass: false,
      fullCare6Pass: false,
    });
    expect(r.final).toBe("PARTIAL");
    expect(r.summary).toMatch(/parser|final_shape/i);
  });

  it("empty output is never READY (shadow usability)", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 0,
      degraded: true,
      imageCount: 0,
    });
    expect(u.clinicalStatus).toBe("EMPTY");
    expect(u.clinicalStatus).not.toBe("READY");
    expect(u.usable).toBe(false);
  });

  it("copied diagnostic report rejects base64/PHI blobs", () => {
    const clean = assertDiagnosticReportPhiSafe(
      "AI PIPELINE SELF-TEST\nimageCount: 1\ntotalImageBytes: 15001\n",
    );
    expect(clean.ok).toBe(true);
    const dirty = assertDiagnosticReportPhiSafe(
      `data:image/jpeg;base64,${"A".repeat(100)}`,
    );
    expect(dirty.ok).toBe(false);
  });

  it("self-test safety contract never writes/finalizes clinical reports", () => {
    const s = selfTestSafetyContract();
    expect(s.writesClinicalReport).toBe(false);
    expect(s.finalizesReport).toBe(false);
    expect(s.bulkEnqueuesOvernight).toBe(false);
    expect(s.diagnosticOnly).toBe(true);
  });
});
