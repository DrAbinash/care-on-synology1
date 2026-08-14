import JSZip from "jszip";
import {
  istYyyymmdd,
  serializeDoctorsSeedCsv,
  serializeTestsSeedCsv,
  usbSeedReadme,
  type MasterDataSnapshot,
} from "@workspace/emergency-billing";

export function usbSeedZipFilename(at = new Date()): string {
  return `CARE_ULTRA_EMERGENCY_SEED_${istYyyymmdd(at)}.zip`;
}

export async function buildUsbSeedZip(snapshot: MasterDataSnapshot): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("README.txt", usbSeedReadme(snapshot));
  zip.file("seed/tests.csv", serializeTestsSeedCsv(snapshot.services));
  zip.file("seed/doctors.csv", serializeDoctorsSeedCsv(snapshot.doctors));
  zip.file("seed/CARE_EMERGENCY_MASTER_V1.json", `${JSON.stringify(snapshot, null, 2)}\n`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
