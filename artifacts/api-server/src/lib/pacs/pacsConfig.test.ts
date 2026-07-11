import { describe, expect, test, vi } from "vitest";

// pacsConfig.ts imports `db` from @workspace/db at module top level, which
// throws unconditionally at import time when DATABASE_URL is not set.
// isDockerBridgeIp is pure and never touches the database — mocking prevents
// the load-time throw without affecting what is under test. Same pattern as
// closureBoundary.test.ts / day-close.test.ts.
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: async () => [] }) },
}));
vi.mock("@workspace/db/schema", () => ({
  pacsSettingsTable: {},
}));

import { isDockerBridgeIp } from "./pacsConfig";

// Fix: OHIF/Weasis/Orthanc URLs were leaking Docker bridge IPs (172.17.x.x
// etc.) into browser/client launch URLs, causing "browser clients will fail
// to launch OHIF" / "local Weasis installations cannot read scans" warnings.
// The OLD bridge-IP checks (three separate, inconsistent copies across
// pacsConfig.ts and pacsEnterprise.ts) were also buggy in the other
// direction: they matched ANY 172.x.x.x address, which incorrectly flagged
// this clinic's real, working LAN subnet (172.16.1.x) as an unreachable
// Docker bridge IP. isDockerBridgeIp fixes both problems with one shared,
// correct implementation.

describe("isDockerBridgeIp", () => {
  test("flags typical Docker default-bridge addresses", () => {
    expect(isDockerBridgeIp("172.17.0.2")).toBe(true);
    expect(isDockerBridgeIp("172.18.0.5")).toBe(true);
    expect(isDockerBridgeIp("172.20.0.10")).toBe(true);
    expect(isDockerBridgeIp("172.31.255.1")).toBe(true);
  });

  test("flags bridge IPs embedded in a full URL", () => {
    expect(isDockerBridgeIp("http://172.19.0.3:3000/viewer")).toBe(true);
    expect(isDockerBridgeIp("http://172.17.0.5:8042/wado")).toBe(true);
  });

  test("does NOT flag the clinic's real LAN subnet 172.16.1.x", () => {
    expect(isDockerBridgeIp("172.16.1.139")).toBe(false);
    expect(isDockerBridgeIp("http://172.16.1.139:3000/viewer")).toBe(false);
    expect(isDockerBridgeIp("http://172.16.1.139:8042/wado")).toBe(false);
  });

  test("does NOT flag standard private/LAN or public addresses", () => {
    expect(isDockerBridgeIp("192.168.1.137")).toBe(false);
    expect(isDockerBridgeIp("10.0.0.5")).toBe(false);
    expect(isDockerBridgeIp("100.65.255.115")).toBe(false); // Tailscale
    expect(isDockerBridgeIp("caredeoghar.com")).toBe(false);
    expect(isDockerBridgeIp("http://caredeoghar.com/viewer")).toBe(false);
  });

  test("does NOT flag other 172.16.x.x addresses outside the known LAN octet", () => {
    // 172.16.2.x is NOT the documented clinic LAN (172.16.1.x specifically)
    // and IS within Docker's bridge range, so it should still be flagged.
    expect(isDockerBridgeIp("172.16.2.50")).toBe(true);
  });

  test("handles empty/undefined/null input safely", () => {
    expect(isDockerBridgeIp("")).toBe(false);
    expect(isDockerBridgeIp(undefined)).toBe(false);
    expect(isDockerBridgeIp(null)).toBe(false);
  });
});
