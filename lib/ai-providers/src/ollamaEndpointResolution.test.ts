import { describe, expect, it } from "vitest";
import {
  isEphemeralLoopbackOllamaUrl,
  preferClinicOllamaEndpoint,
  formatFetchNetworkError,
} from "./index";

describe("preferClinicOllamaEndpoint", () => {
  it("clinic LAN URL wins over 127.0.0.1 ephemeral test port", () => {
    const r = preferClinicOllamaEndpoint({
      clinicOrRuntimeUrl: "http://172.16.1.140:11434",
      candidateUrl: "http://127.0.0.1:65102",
    });
    expect(r.endpointUrl).toBe("http://172.16.1.140:11434");
    expect(isEphemeralLoopbackOllamaUrl("http://127.0.0.1:65102")).toBe(true);
  });
});

describe("formatFetchNetworkError", () => {
  it("surfaces undici cause port separately from intended URL", () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause: Error }).cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:65102"),
      { code: "ECONNREFUSED", address: "127.0.0.1", port: 65102 },
    );
    const msg = formatFetchNetworkError(err, "http://172.16.1.140:11434/api/chat");
    expect(msg).toContain("65102");
    expect(msg).toContain("172.16.1.140:11434");
  });
});
