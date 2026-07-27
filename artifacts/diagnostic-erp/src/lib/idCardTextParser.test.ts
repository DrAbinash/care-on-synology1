import { describe, expect, test } from "vitest";
import { parseIdCardText } from "./idCardTextParser";

describe("parseIdCardText", () => {
  test("extracts father name + address from Aadhaar-like OCR text", () => {
    const raw = `
Unique Identification Authority of India
AADHAAR
Name: RAMESH KUMAR
Father Name: SURESH KUMAR
DOB: 12/05/1985
Gender: Male
Address: H.No 12, Village Rampura, Dist Jaipur, Rajasthan - 302001
1234 5678 9012
`;
    const p = parseIdCardText(raw);
    expect(p.documentType).toBe("Aadhaar");
    expect(p.guardianName.toUpperCase()).toContain("SURESH");
    expect(p.address.toLowerCase()).toMatch(/rampura|jaipur/);
    expect(p.idNumber).toBe("123456789012");
    expect(p.gender).toBe("male");
    expect(p.dob).toBe("1985-05-12");
    expect(p.confidencePercent).toBeLessThan(95); // never auto-fill tier
  });

  test("returns empty-ish result for garbage text", () => {
    const p = parseIdCardText("abc\nxyz");
    expect(p.guardianName || p.address || p.idNumber).toBeFalsy();
  });
});
