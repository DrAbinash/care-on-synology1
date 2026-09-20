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
  isStampAccessionEnabled,
  modifyOrthancAccession,
  stampBlankAccessionForBill,
  STAMP_ACCESSION_FLAG,
} from "./stampAccessionFromBill";

const mockedFind = vi.mocked(findOrthancStudies);
const mockedFlag = vi.mocked(isFeatureEnabledServer);

describe("isStampAccessionEnabled", () => {
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

  it("env true wins", async () => {
    process.env[STAMP_ACCESSION_FLAG] = "true";
    expect(await isStampAccessionEnabled()).toBe(true);
  });
});

describe("stampBlankAccessionForBill", () => {
  const prevFlag = process.env[STAMP_ACCESSION_FLAG];
  const prevOrthanc = process.env.ORTHANC_URL;

  beforeEach(() => {
    process.env[STAMP_ACCESSION_FLAG] = "true";
    process.env.ORTHANC_URL = "http://orthanc.test:8042";
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
