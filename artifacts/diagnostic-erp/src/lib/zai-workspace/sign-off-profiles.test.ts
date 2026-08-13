import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RADIOLOGIST_NAME,
  loadProfiles,
} from "./sign-off-profiles";

const SK = "zai-rad-signoff-v1";

describe("sign-off profiles — clinic radiologist default", () => {
  afterEach(() => {
    try { localStorage.removeItem(SK); } catch { /* ignore */ }
  });

  it("defaults to Dr. Sugandha Priyadarshini when nothing is stored", () => {
    const profiles = loadProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.every((p) => p.signerName === DEFAULT_RADIOLOGIST_NAME)).toBe(true);
  });

  it("replaces leftover Abinash placeholder profiles", () => {
    localStorage.setItem(SK, JSON.stringify([
      { id: "so_1", modality: "MR", signerName: "Dr. Abinash", signerCredentials: "MD", isDefault: true, createdAt: "2020-01-01" },
    ]));
    const profiles = loadProfiles();
    expect(profiles.every((p) => p.signerName === DEFAULT_RADIOLOGIST_NAME)).toBe(true);
  });
});
