import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../featureFlags", () => ({
  isFeatureEnabledServer: vi.fn(async () => false),
}));

vi.mock("./orthancStudyFind", () => ({
  findOrthancStudies: vi.fn(),
}));

import { db } from "@workspace/db";
import { isFeatureEnabledServer } from "../featureFlags";
import { findOrthancStudies } from "./orthancStudyFind";
import {
  compactAccessionForStamp,
  isStampAccessionEnabled,
  maybeStampAccessionsAfterBill,
  modifyOrthancAccession,
  stampBlankAccessionForBill,
  STAMP_ACCESSION_FLAG,
} from "./stampAccessionFromBill";

const mockedFind = vi.mocked(findOrthancStudies);
const mockedFlag = vi.mocked(isFeatureEnabledServer);

describe("isStampAccessionEnabled — database flag is authoritative", () => {
  const prev = process.env[STAMP_ACCESSION_FLAG];

  beforeEach(() => {
    if (prev === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prev;
    mockedFlag.mockReset();
  });

  it("defaults off", async () => {
    delete process.env[STAMP_ACCESSION_FLAG];
    mockedFlag.mockResolvedValue(false);
    expect(await isStampAccessionEnabled()).toBe(false);
  });

  it("A disabled database flag is NOT overridden by an enabled env var", async () => {
    // The exact production hazard: feature_flags carries an explicit
    // enabled=false row, and a stray STAMP_ACCESSION_FROM_BILL=true in .env
    // must not reactivate the Orthanc /studies/{id}/modify write path.
    mockedFlag.mockResolvedValue(false);
    for (const truthy of ["true", "1", "yes", "TRUE"]) {
      process.env[STAMP_ACCESSION_FLAG] = truthy;
      expect(await isStampAccessionEnabled()).toBe(false);
    }
  });

  it("only an explicit DB-enabled row can enable stamping", async () => {
    delete process.env[STAMP_ACCESSION_FLAG];
    mockedFlag.mockResolvedValue(true);
    expect(await isStampAccessionEnabled()).toBe(true);
    process.env[STAMP_ACCESSION_FLAG] = "true";
    expect(await isStampAccessionEnabled()).toBe(true);
    process.env[STAMP_ACCESSION_FLAG] = "yes";
    expect(await isStampAccessionEnabled()).toBe(true);
  });

  it("the env var remains a pure kill-switch on top of an enabled DB row", async () => {
    mockedFlag.mockResolvedValue(true);
    for (const off of ["0", "false", "no", "FALSE"]) {
      process.env[STAMP_ACCESSION_FLAG] = off;
      expect(await isStampAccessionEnabled()).toBe(false);
    }
  });
});

describe("A2 zero-Orthanc-write proof while the database disables stamping", () => {
  const prev = process.env[STAMP_ACCESSION_FLAG];
  const prevOrthanc = process.env.ORTHANC_URL;

  beforeEach(() => {
    process.env[STAMP_ACCESSION_FLAG] = "true"; // the hazardous env state
    process.env.ORTHANC_URL = "http://orthanc.test:8042";
    mockedFlag.mockResolvedValue(false); // the database says NO
    mockedFind.mockReset();
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prev;
    if (prevOrthanc === undefined) delete process.env.ORTHANC_URL;
    else process.env.ORTHANC_URL = prevOrthanc;
    vi.unstubAllGlobals();
  });

  it("stampBlankAccessionForBill performs zero archive writes — not even a find", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-DEAD",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-09-20",
    });

    expect(result).toEqual({ ok: true, stamped: false, reason: "flag_disabled" });
    expect(mockedFind).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("maybeStampAccessionsAfterBill returns before any bill/patient/study reads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await maybeStampAccessionsAfterBill({ billId: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedFind).not.toHaveBeenCalled();
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });
});

describe("stampBlankAccessionForBill", () => {
  const prevFlag = process.env[STAMP_ACCESSION_FLAG];
  const prevOrthanc = process.env.ORTHANC_URL;

  beforeEach(() => {
    // Stamping logic tests run with the DATABASE flag enabled (the only way
    // it can now be enabled) and the env var unset.
    if (prevFlag === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prevFlag;
    process.env.ORTHANC_URL = "http://orthanc.test:8042";
    mockedFlag.mockResolvedValue(true);
    mockedFind.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prevFlag;
    if (prevOrthanc === undefined) delete process.env.ORTHANC_URL;
    else process.env.ORTHANC_URL = prevOrthanc;
    vi.unstubAllGlobals();
  });

  it("refuses multi-hit blank-accession Orthanc studies", async () => {
    mockedFind.mockResolvedValue({
      source: "ORTHANC_REST",
      rows: [
        {
          studyInstanceUID: "1.2.a",
          accessionNumber: "",
          patientName: "A",
          modality: "US",
          studyDate: "20260920",
          studyDescription: null,
          referringDoctor: null,
        },
        {
          studyInstanceUID: "1.2.b",
          accessionNumber: "",
          patientName: "A",
          modality: "US",
          studyDate: "20260920",
          studyDescription: null,
          referringDoctor: null,
        },
      ],
    });

    const result = await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-1",
      patientName: "Test Patient",
      modality: "USG",
      studyDate: "2026-09-20",
    });
    expect(result).toEqual({ ok: true, stamped: false, reason: "multi_hit" });
  });

  it("stamps single-hit empty accession and writes audit (loop guard on restamp)", async () => {
    mockedFind.mockResolvedValue({
      source: "ORTHANC_REST",
      rows: [
        {
          studyInstanceUID: "1.2.840.usg.1",
          accessionNumber: "",
          patientName: "Test Patient",
          modality: "US",
          studyDate: "20260920",
          studyDescription: null,
          referringDoctor: null,
        },
      ],
    });

    // alreadyStamped → empty audit rows first call
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue([]) } as never);

    const fetchMock = vi.mocked(fetch);
    // resolveOrthancStudyId
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ["orthanc-study-1"],
      } as Response)
      // readOrthancAccession — empty
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ MainDicomTags: { AccessionNumber: "" } }),
      } as Response)
      // modify
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "{}",
        status: 200,
      } as Response);

    const first = await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-USG-1",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-09-20",
    });
    expect(first.ok && first.stamped).toBe(true);
    if (first.ok && first.stamped) {
      expect(first.studyUid).toBe("1.2.840.usg.1");
      expect(first.matchedKey).toBe("singleHit");
    }

    // modify was called with Replace AccessionNumber
    const modifyCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/modify"),
    );
    expect(modifyCall).toBeTruthy();
    const modifyBody = JSON.parse(String(modifyCall![1]?.body));
    expect(modifyBody.Replace.AccessionNumber).toBe("BILL-USG-1");

    // Loop guard: alreadyStamped finds prior audit
    selectChain.limit.mockResolvedValueOnce([
      {
        id: 1,
        details: JSON.stringify({
          studyUid: "1.2.840.usg.1",
          billNumber: "BILL-USG-1",
        }),
      },
    ]);
    const second = await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-USG-1",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-09-20",
    });
    expect(second).toEqual({ ok: true, stamped: false, reason: "already_stamped" });
  });

  it("never overwrites a non-empty Orthanc accession", async () => {
    mockedFind.mockResolvedValue({
      source: "ORTHANC_REST",
      rows: [
        {
          studyInstanceUID: "1.2.840.usg.2",
          accessionNumber: "",
          patientName: "Test Patient",
          modality: "US",
          studyDate: "20260920",
          studyDescription: null,
          referringDoctor: null,
        },
      ],
    });
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ["orthanc-2"],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ MainDicomTags: { AccessionNumber: "EXISTING" } }),
      } as Response);

    const result = await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-X",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-09-20",
    });
    expect(result).toEqual({ ok: true, stamped: false, reason: "accession_already_set" });
  });
});

describe("modifyOrthancAccession payload", () => {
  it("POSTs Replace AccessionNumber to /studies/{id}/modify", async () => {
    process.env.ORTHANC_URL = "http://orthanc.test:8042";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    await modifyOrthancAccession("abc", "BILL-9");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://orthanc.test:8042/studies/abc/modify",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });
});

describe("compactAccessionForStamp", () => {
  it("writes the separator-free key the worklist published", () => {
    // The whole chain keys on this string: ERP books ACC-20261111-US-046, the
    // worklist file carries ACC20261111US046, and intake links an arrival back
    // by the same separator-free value. Stamping the bill number instead left
    // the study to be re-matched by demographics.
    expect(compactAccessionForStamp("ACC-20261111-US-046")).toBe("ACC20261111US046");
    expect(compactAccessionForStamp("acc-20261111-cr-031")).toBe("ACC20261111CR031");
    expect(compactAccessionForStamp("  ACC-2026-11-11-US-046  ")).toBe("ACC20261111US046");
  });

  it("returns nothing rather than a truncated key", () => {
    // mwlAccession's >16 fallback keeps the TAIL, which is a 16-char string
    // that matches no accession at all. Half a key is worse than no key: it
    // would be trusted by every accession match downstream.
    expect(compactAccessionForStamp("ACC-20261111-BMD-001")).toBe(""); // 17 compacted
    expect(compactAccessionForStamp("ACC-20261111-CR-1000")).toBe(""); // 17 compacted
    expect(compactAccessionForStamp("")).toBe("");
    expect(compactAccessionForStamp("   ")).toBe("");
    expect(compactAccessionForStamp(null)).toBe("");
    expect(compactAccessionForStamp(undefined)).toBe("");
  });

  it("takes exactly the 16-byte boundary the SH tag allows", () => {
    // ACC + 20261111 + US + 999 is the last sequence number that still fits.
    expect(compactAccessionForStamp("ACC-20261111-US-999")).toBe("ACC20261111US999");
    expect(compactAccessionForStamp("ACC-20261111-US-1000")).toBe(""); // 17 compacted
    expect(compactAccessionForStamp("ACC-20261111-MR-1000")).toBe(""); // 17 compacted
  });
});

describe("stampBlankAccessionForBill — which value reaches (0008,0050)", () => {
  const prevFlag = process.env[STAMP_ACCESSION_FLAG];
  const prevOrthanc = process.env.ORTHANC_URL;

  /** One blank-accession Orthanc study, single hit, nothing stamped before. */
  const mockBlankSingleHit = () => {
    mockedFind.mockResolvedValue({
      source: "ORTHANC_REST",
      rows: [
        {
          studyInstanceUID: "1.2.840.usg.7",
          accessionNumber: "",
          patientName: "Test Patient",
          modality: "US",
          studyDate: "20261111",
          studyDescription: null,
          referringDoctor: null,
        },
      ],
    });
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    } as never);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue([]) } as never);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ["orthanc-7"] } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ MainDicomTags: { AccessionNumber: "" } }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" } as Response);
  };

  const stampedAccession = () => {
    const modifyCall = vi
      .mocked(fetch)
      .mock.calls.find((c) => String(c[0]).includes("/modify"));
    expect(modifyCall).toBeTruthy();
    return JSON.parse(String(modifyCall![1]?.body)).Replace.AccessionNumber as string;
  };

  beforeEach(() => {
    if (prevFlag === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prevFlag;
    process.env.ORTHANC_URL = "http://orthanc.test:8042";
    mockedFlag.mockResolvedValue(true);
    mockedFind.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env[STAMP_ACCESSION_FLAG];
    else process.env[STAMP_ACCESSION_FLAG] = prevFlag;
    if (prevOrthanc === undefined) delete process.env.ORTHANC_URL;
    else process.env.ORTHANC_URL = prevOrthanc;
    vi.unstubAllGlobals();
  });

  it("stamps the accession when the caller knows it", async () => {
    mockBlankSingleHit();
    const result = await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-USG-7",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-11-11",
      accessionNumber: "ACC-20261111-US-046",
    });
    expect(result.ok && result.stamped).toBe(true);
    expect(stampedAccession()).toBe("ACC20261111US046");
  });

  it("still stamps the bill number when no accession was passed", async () => {
    // A bill with no USG accession must keep the pre-existing behaviour; the
    // study is then linked by demographics, as it always was.
    mockBlankSingleHit();
    await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-USG-7",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-11-11",
    });
    expect(stampedAccession()).toBe("BILL-USG-7");
  });

  it("falls back to the bill number for an accession that cannot fit SH", async () => {
    // Never a truncated accession, and never a skipped stamp: the bill number
    // is at least a real, searchable CARE identifier.
    mockBlankSingleHit();
    await stampBlankAccessionForBill({
      billId: 1,
      billNumber: "BILL-USG-7",
      patientName: "Test Patient",
      modality: "US",
      studyDate: "2026-11-11",
      accessionNumber: "ACC-20261111-BMD-001",
    });
    expect(stampedAccession()).toBe("BILL-USG-7");
  });
});
