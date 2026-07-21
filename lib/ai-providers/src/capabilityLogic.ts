/**
 * Capability chain — pure logic (Phase P2 / Gate G7).
 * No DB. Unit-tested directly. The DB-backed loaders live in capabilityRegistry.ts.
 */
export interface RequiredCapabilities {
  vision?: boolean;
  groundedJson?: boolean;
  longContext?: boolean;
}

export interface ProviderChoice {
  provider: string;
  model: string;
  modelDigest: string | null;
  isLocal: boolean;
  phiEligible: boolean;
}

export interface CapabilityRow extends ProviderChoice {
  caps: RequiredCapabilities;
}

/**
 * Order candidates local-first, filter by required capabilities and — when PHI
 * is present — by PHI-eligibility. Local models are always PHI-eligible (on-prem);
 * cloud models must be explicitly marked. Pure.
 */
export function buildProviderChain(
  candidates: CapabilityRow[],
  required: RequiredCapabilities,
  phiPresent: boolean,
  preferred?: { provider: string; model?: string },
): ProviderChoice[] {
  const eligible = candidates.filter((c) => {
    const caps = c.caps ?? {};
    if (required.vision && !caps.vision) return false;
    if (required.groundedJson && !caps.groundedJson) return false;
    if (required.longContext && !caps.longContext) return false;
    if (phiPresent && !c.isLocal && !c.phiEligible) return false; // PHI egress guard
    return true;
  });
  eligible.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    const ap = preferred && a.provider === preferred.provider ? -1 : 0;
    const bp = preferred && b.provider === preferred.provider ? -1 : 0;
    return ap - bp;
  });
  return eligible.map(({ provider, model, modelDigest, isLocal, phiEligible }) => ({ provider, model, modelDigest, isLocal, phiEligible }));
}
