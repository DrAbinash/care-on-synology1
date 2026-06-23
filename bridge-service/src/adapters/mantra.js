// Mantra MFS100 USB scanner adapter (popular in India for Aadhaar workflows).
//
// REAL DEPLOYMENT:
//   1. Install the MFS100 RD service driver from Mantra (Windows installer).
//   2. The MFS100 driver itself exposes an HTTP service on 127.0.0.1:11100
//      — this adapter simply proxies to it.
//   3. Run with BRIDGE_VENDOR=mantra
//
// We call the local RD service (no Node SDK needed).
const RD_BASE = process.env.MANTRA_RD_BASE ?? "http://127.0.0.1:11100";

export default {
  threshold: 60,

  async status() {
    try {
      const r = await fetch(`${RD_BASE}/`, { method: "RDSERVICE" });
      return { deviceConnected: r.ok, deviceModel: "MFS100" };
    } catch (e) {
      return { deviceConnected: false, error: e.message };
    }
  },

  async capture() {
    // The MFS100 RD service uses an XML-based PID block over HTTP CAPTURE method.
    // This is a sketch — fill in PIDOPTIONS XML for your environment.
    const pidOpts = `<PidOptions ver="1.0"><Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" otp="" wadh="" posh=""/></PidOptions>`;
    const r = await fetch(`${RD_BASE}/rd/capture`, { method: "CAPTURE", body: pidOpts, headers: { "Content-Type": "text/xml" } });
    if (!r.ok) throw new Error(`MFS100 capture failed: ${r.status}`);
    const xml = await r.text();
    // Extract <Data> block from XML and base64-encode the PID record.
    const dataMatch = xml.match(/<Data[^>]*>([^<]+)<\/Data>/);
    const qualMatch = xml.match(/qScore="(\d+)"/);
    if (!dataMatch) throw new Error("MFS100 returned no fingerprint data");
    return { template: dataMatch[1], quality: qualMatch ? Number(qualMatch[1]) : null };
  },

  async match(/* a, b */) {
    // Mantra recommends server-side matching with their match SDK or a third-party
    // ISO/IEC 19794-2 minutiae matcher. Plug it in here.
    throw new Error("Mantra matcher not configured — install Mantra MFS Match SDK");
  },
};
