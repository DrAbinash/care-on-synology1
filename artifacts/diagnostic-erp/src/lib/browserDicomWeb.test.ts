import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { withDicomWebAuth } from "./browserDicomWeb";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
  });
});

describe("withDicomWebAuth", () => {
  afterEach(() => {
    try { localStorage.removeItem("erp_session"); } catch { /* ignore */ }
  });

  it("leaves Orthanc / non-ERP URLs unchanged", () => {
    expect(withDicomWebAuth("http://172.16.1.139:8042/dicom-web/studies/1/series")).toBe(
      "http://172.16.1.139:8042/dicom-web/studies/1/series",
    );
  });

  it("appends staffToken only for the ERP DICOMweb proxy", () => {
    localStorage.setItem("erp_session", JSON.stringify({ token: "abc.jwt" }));
    const url = "/api/radiology/dicom-web/studies/1.2/series/1.3/instances/1.4/rendered?quality=80";
    expect(withDicomWebAuth(url)).toBe(`${url}&staffToken=abc.jwt`);
  });
});
