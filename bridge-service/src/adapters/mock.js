// Mock adapter — for development and demos.
// Generates a "fingerprint" by hashing a fingerprint id you can choose at
// capture time via the BRIDGE_MOCK_FINGER env var (or defaults to "default").
// Use this to test the full enrollment + identification flow on a machine
// without any USB scanner attached.
import crypto from "node:crypto";

const FINGER = () => process.env.BRIDGE_MOCK_FINGER ?? "default";

export default {
  threshold: 80,
  async status() {
    return { deviceConnected: true, deviceModel: "mock-sensor", firmware: "v0" };
  },
  async capture() {
    // Simulate a sensor read taking ~200ms
    await new Promise((r) => setTimeout(r, 200));
    const finger = FINGER();
    const template = crypto.createHash("sha256").update(`mock:${finger}`).digest("base64");
    return { template, quality: 95 };
  },
  async match(a, b) {
    // Mock matcher: exact equality → 100, otherwise 0
    return a === b ? 100 : 0;
  },
};
