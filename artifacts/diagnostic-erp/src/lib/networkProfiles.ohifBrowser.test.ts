import { describe, expect, it } from "vitest";
import {
  ohifBaseForProfile,
  ohifBrowserBaseUrl,
  ohifLanProxyBaseUrl,
} from "./networkProfiles";

describe("ohifBrowserBaseUrl / LAN profile", () => {
  it("LAN profile uses HTTPS clinic OHIF hostname, not HTTP :3010", () => {
    expect(ohifBrowserBaseUrl()).toBe("https://ohif.caredeoghar.com");
    expect(ohifBaseForProfile("LAN")).toBe("https://ohif.caredeoghar.com");
    expect(ohifBaseForProfile("LAN")).not.toMatch(/^http:\/\//i);
    expect(ohifBaseForProfile("LAN")).not.toContain(":3010");
  });

  it("Tailscale profile remains HTTP host:port fallback", () => {
    const ts = ohifBaseForProfile("TAILSCALE");
    expect(ts).toMatch(/^http:\/\//);
    expect(ts).toContain(":3010");
  });

  it("LAN DICOMweb proxy helper stays on HTTP :3010 (OHIF nginx → Orthanc)", () => {
    expect(ohifLanProxyBaseUrl()).toMatch(/^http:\/\//);
    expect(ohifLanProxyBaseUrl()).toMatch(/:3010$/);
  });
});
