import { describe, it, expect } from "vitest";
import { buildProviderChain, type CapabilityRow } from "./capabilityLogic";

const local: CapabilityRow = { provider: "ollama", model: "medgemma", modelDigest: "d1", isLocal: true, phiEligible: true, caps: { vision: true, groundedJson: true } };
const cloudPhi: CapabilityRow = { provider: "gemini", model: "g", modelDigest: null, isLocal: false, phiEligible: true, caps: { vision: true, groundedJson: true } };
const cloudNoPhi: CapabilityRow = { provider: "openai", model: "o", modelDigest: null, isLocal: false, phiEligible: false, caps: { vision: true, groundedJson: true } };
const textOnly: CapabilityRow = { provider: "ollama", model: "gpt-oss", modelDigest: null, isLocal: true, phiEligible: true, caps: { vision: false, groundedJson: true } };

describe("provider chain building (G7)", () => {
  it("orders local providers first", () => {
    const chain = buildProviderChain([cloudPhi, local], {}, false);
    expect(chain[0].provider).toBe("ollama");
  });

  it("filters out models lacking a required capability (vision)", () => {
    const chain = buildProviderChain([local, textOnly], { vision: true }, false);
    expect(chain.map((c) => c.model)).toEqual(["medgemma"]);
  });

  it("excludes non-PHI-eligible cloud models when PHI is present", () => {
    const chain = buildProviderChain([local, cloudPhi, cloudNoPhi], {}, true);
    expect(chain.map((c) => c.provider)).toContain("ollama");
    expect(chain.map((c) => c.provider)).toContain("gemini");
    expect(chain.map((c) => c.provider)).not.toContain("openai"); // cloud, not PHI-eligible
  });

  it("allows non-PHI cloud models when no PHI is present", () => {
    const chain = buildProviderChain([cloudNoPhi], {}, false);
    expect(chain.map((c) => c.provider)).toEqual(["openai"]);
  });

  it("keeps the pinned digest on each choice", () => {
    const chain = buildProviderChain([local], {}, true);
    expect(chain[0].modelDigest).toBe("d1");
  });
});
