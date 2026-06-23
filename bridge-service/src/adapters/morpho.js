// IDEMIA / Morpho (MSO 1300, MorphoSmart) USB scanner adapter.
//
// REAL DEPLOYMENT:
//   1. Install the MorphoSmart MSO SDK on the workstation.
//   2. Use the MorphoSmart RDService (Windows) — exposes 127.0.0.1:11101.
//   3. Or use the C++ SDK via node-ffi-napi.
//   4. Run with BRIDGE_VENDOR=morpho
export default {
  threshold: 70,
  async status() { return { deviceConnected: false, error: "Morpho SDK not installed — see src/adapters/morpho.js" }; },
  async capture() { throw new Error("Morpho adapter not configured"); },
  async match() { return 0; },
};
