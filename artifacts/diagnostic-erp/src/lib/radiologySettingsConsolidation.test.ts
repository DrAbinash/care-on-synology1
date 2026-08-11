import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Radiology settings consolidation", () => {
  const app = read("src/App.tsx");
  const layout = read("src/components/Layout.tsx");
  const center = read("src/pages/RadiologySettingsCenter.tsx");
  const catalog = read("src/lib/settingsHubCatalog.ts");

  it("sidebar USG group no longer lists USG Admin / Quick Select settings", () => {
    expect(layout).not.toMatch(/path: "\/radiology\/usg-admin-settings"/);
    expect(layout).not.toMatch(/path: "\/settings\/radiology-quick-select"/);
    expect(layout).toContain('path: "/settings/radiology"');
  });

  it("legacy settings URLs redirect into Settings → Radiology tabs", () => {
    expect(app).toContain("RedirectToRadiologySettings");
    expect(app).toMatch(/usg-admin-settings[\s\S]*tab="usg-extraction"/);
    expect(app).toMatch(/usg\/settings[\s\S]*tab="usg-extraction"/);
    expect(app).toMatch(/radiology-quick-select[\s\S]*tab="quick-select"/);
    expect(app).toMatch(/ai-reporting-settings[\s\S]*tab="reporting"/);
    expect(app).toMatch(/modality-management[\s\S]*tab="modalities"/);
    expect(app).toMatch(/agent-setup[\s\S]*tab="sync"/);
  });

  it("Settings Center includes Overview, Sync, USG, Quick Select, Deployment tabs", () => {
    for (const tab of ["overview", "sync", "usg-extraction", "quick-select", "deployment", "mwl"]) {
      expect(center).toContain(`value="${tab}"`);
    }
    expect(center).toContain("RadiologyAdminOverviewPanel");
    expect(center).toContain("RadiologyDeploymentPanel");
    expect(center).toContain("RadiologyQuickSelectSettings");
    expect(center).toContain("UsgExtractionPanel");
  });

  it("does not hardcode care-orthanc as the live Orthanc internal URL", () => {
    // No literal displayed value; explanatory wording must not invent Docker DNS as configured.
    expect(center).not.toMatch(/>http:\/\/care-orthanc:8042</);
    expect(center).toMatch(/never invent a Docker service hostname|View resolved value on Deployment/);
  });

  it("hub catalog deep-links into settings tabs for USG and Quick Select", () => {
    expect(catalog).toContain("/settings/radiology?tab=usg-extraction");
    expect(catalog).toContain("/settings/radiology?tab=quick-select");
    expect(catalog).not.toContain('path: "/settings/radiology-quick-select"');
  });
});
