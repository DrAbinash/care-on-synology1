// ZKTeco USB scanner adapter (e.g. ZK4500, ZK9500, SLK20R).
//
// REAL DEPLOYMENT:
//   1. Install the ZKFinger SDK on the workstation (Windows: ZKFinger-Reader-Setup.exe).
//   2. Install the Node binding:  npm install zkteco-fingerprint
//      (or use the official C++ bindings via node-ffi-napi)
//   3. Replace the stubs below with real SDK calls.
//   4. Run with BRIDGE_VENDOR=zkteco
//
// The shape of capture()/match() is fixed; only the body needs to be filled in.
export default {
  threshold: 75, // ZKFinger typical match score threshold

  async status() {
    // const sdk = await import("zkteco-fingerprint");
    // const dev = sdk.openDevice();
    // return { deviceConnected: !!dev, deviceModel: dev?.model ?? "ZK", firmware: dev?.fw };
    return { deviceConnected: false, error: "ZKFinger SDK not installed — see src/adapters/zkteco.js" };
  },

  async capture() {
    // const sdk = await import("zkteco-fingerprint");
    // const tmpl = await sdk.captureTemplate({ timeoutMs: 8000 });
    // return { template: tmpl.toString("base64"), quality: tmpl.quality };
    throw new Error("ZKTeco adapter not configured. Install ZKFinger SDK and update src/adapters/zkteco.js");
  },

  async match(/* aBase64, bBase64 */) {
    // const sdk = await import("zkteco-fingerprint");
    // return sdk.matchTemplates(Buffer.from(aBase64, "base64"), Buffer.from(bBase64, "base64"));
    return 0;
  },
};
