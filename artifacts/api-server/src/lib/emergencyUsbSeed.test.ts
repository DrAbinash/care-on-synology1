import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { MASTER_FORMAT, stampMasterSnapshot } from "@workspace/emergency-billing";
import { buildUsbSeedZip, usbSeedZipFilename } from "./emergencyUsbSeed";

function sampleSnap() {
  return stampMasterSnapshot({
    syncedAt: "2026-08-14T11:35:00.000Z",
    services: [{ id: 1, code: "MRI-BR", name: "MRI Brain, contrast", category: "MRI", price: 4000, isActive: true }],
    doctors: [{ id: 2, name: 'Dr. "A" Patel', specialization: "Radiology" }],
    patients: [],
    staff: [{
      id: 1, name: "Owner", username: "owner", role: "super_admin",
      pinHash: "hash", maxDiscount: 100, permissions: null,
    }],
    discountReasons: [],
  });
}

describe("USB catalogue seed zip", () => {
  it("names the download with IST calendar date", () => {
    expect(usbSeedZipFilename(new Date("2026-08-14T18:30:00.000Z"))).toBe("CARE_ULTRA_EMERGENCY_SEED_20260815.zip");
  });

  it("contains tests.csv, doctors.csv, master JSON — not a billing CSV", async () => {
    const buf = await buildUsbSeedZip(sampleSnap());
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      "README.txt",
      "seed/",
      "seed/CARE_EMERGENCY_MASTER_V1.json",
      "seed/doctors.csv",
      "seed/tests.csv",
    ].sort());
    const tests = await zip.file("seed/tests.csv")!.async("string");
    expect(tests).toMatch(/^id,code,name,category,price,is_active\n/);
    expect(tests).not.toContain("emergency_transaction_uuid");
    const json = JSON.parse(await zip.file("seed/CARE_EMERGENCY_MASTER_V1.json")!.async("string"));
    expect(json.format).toBe(MASTER_FORMAT);
    expect(json.staff[0].pinHash).toBe("hash");
    const readme = await zip.file("README.txt")!.async("string");
    expect(readme).toMatch(/NOT a bill import/i);
  });
});
