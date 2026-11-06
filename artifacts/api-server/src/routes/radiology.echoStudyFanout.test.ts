/**
 * The paid echo that never reached a machine.
 *
 * "ECHO" (id 405) and " ECHO FETAL" (id 383) are billed under department
 * Cardiology — Dr. Sugandha's counter — but the catalogue binds both to device
 * "USG GE E9 Voluson" and to room "USG ROOM NO. 1", the same machine and the
 * same room that perform every ultrasound study. The study fan-out asked only
 * the department, so from ~30 Sep 2026 an echoed bill produced no
 * radiology_studies row, no worklist item and nothing on the Voluson: measured
 * 152 paid bills with no study behind them. The four other Cardiology rows
 * (ECG, "ECG.", "ECG EMG", TMT, "Electrocardiogram / ECG") carry no device at
 * all and must stay out.
 *
 * Sections A and B test the rule; section C runs the real fan-out and the real
 * reconciliation sweep over a stub database, because a grep of the route source
 * cannot catch a membership decision that is wrong at runtime.
 */
import { describe, expect, it, vi } from "vitest";
import {
  canonicalRadiologyDepartment,
  canonicalRadiologyDepartmentForDevice,
  radiologyFamilyForOrderTest,
} from "../lib/radiologyDepartments";

// The seven rows in production `modalities` (measured 2026-11-05), verbatim.
const PRODUCTION_DEVICES = [
  "USG GE E9 Voluson",
  "USG GE S-10 Voluson",
  "X-RAY SIEMENS 500ma",
  "X-RAY GE ADVANTAGE DIGITAL",
  "MAMMOGRAPHY",
  "MRI UNITED 3 Tesla",
  "OPG",
] as const;

// The dicom_modalities station matrix as configured in production: one active
// auto-worklist row per modality.
const PRODUCTION_STATIONS: Record<string, string> = {
  CR: "FILMPLUS",
  CT: "ct99",
  MR: "UIH",
  US: "Voluson",
};

describe("A. a device name says which radiology family it is", () => {
  it("every real device answers with its own family", () => {
    expect(canonicalRadiologyDepartmentForDevice("USG GE E9 Voluson")).toBe("USG");
    expect(canonicalRadiologyDepartmentForDevice("USG GE S-10 Voluson")).toBe("USG");
    expect(canonicalRadiologyDepartmentForDevice("X-RAY SIEMENS 500ma")).toBe("X-Ray");
    expect(canonicalRadiologyDepartmentForDevice("X-RAY GE ADVANTAGE DIGITAL")).toBe("X-Ray");
    expect(canonicalRadiologyDepartmentForDevice("MAMMOGRAPHY")).toBe("Mammography");
    expect(canonicalRadiologyDepartmentForDevice("MRI UNITED 3 Tesla")).toBe("MRI");
  });

  it("a device outside the radiology workflow stays outside", () => {
    // OPG is a real machine in this clinic and is in no radiology workflow today;
    // an unrecognised name must not be guessed into one.
    expect(canonicalRadiologyDepartmentForDevice("OPG")).toBeNull();
    expect(canonicalRadiologyDepartmentForDevice("ECHOCARDIOGRAPHY CART")).toBeNull();
    expect(canonicalRadiologyDepartmentForDevice(null)).toBeNull();
    expect(canonicalRadiologyDepartmentForDevice("")).toBeNull();
  });

  it("only the leading token claims the family", () => {
    // "MRI MAMMOGRAPHY" is an MRI of the breast, not a mammography unit.
    expect(canonicalRadiologyDepartmentForDevice("MRI MAMMOGRAPHY 3T")).toBe("MRI");
    expect(canonicalRadiologyDepartmentForDevice("SIEVENT MRI 3 TESLA")).toBeNull();
  });

  it("case, padding and separator shapes do not matter", () => {
    expect(canonicalRadiologyDepartmentForDevice("  usg ge e9 voluson ")).toBe("USG");
    expect(canonicalRadiologyDepartmentForDevice("X_RAY GE")).toBe("X-Ray");
    expect(canonicalRadiologyDepartmentForDevice("X RAY GE")).toBe("X-Ray");
    expect(canonicalRadiologyDepartmentForDevice("Mri United 3 Tesla")).toBe("MRI");
  });
});

describe("B. one predicate decides membership, for every consumer", () => {
  it("the department wins when it already is radiology", () => {
    expect(
      radiologyFamilyForOrderTest({ department: "USG", deviceName: "MRI UNITED 3 Tesla" }),
    ).toBe("USG");
  });

  it("the device answers when the department is only a counter", () => {
    // The two echo rows as they are actually stored.
    expect(
      radiologyFamilyForOrderTest({ department: "Cardiology", deviceName: "USG GE E9 Voluson" }),
    ).toBe("USG");
  });

  it("a cardiology test with no device behind it is not imaging", () => {
    for (const name of ["ECG", "ECG EMG", "TMT", "Electrocardiogram / ECG"]) {
      expect(
        radiologyFamilyForOrderTest({ department: "Cardiology", deviceName: null }),
        name,
      ).toBeNull();
    }
    expect(radiologyFamilyForOrderTest({ department: "Pathology", deviceName: null })).toBeNull();
  });

  it("a dirty radiology department is still canonicalized, unchanged behaviour", () => {
    expect(
      radiologyFamilyForOrderTest({ department: " x-ray ", deviceName: null }),
    ).toBe("X-Ray");
    expect(canonicalRadiologyDepartment("Cardiology")).toBeNull();
  });
});

// ── C. runtime: the real fan-out and the real sweep over a stub database ────

type OrderTestRow = {
  orderTestId: number;
  testId: number;
  testName: string;
  department: string | null;
  roomNumber: string | null;
  deviceName: string | null;
};

const harness: {
  orderTests: OrderTestRow[];
  reconcileRows: Array<OrderTestRow & { orderId: number; patientId: number; billId: number }>;
  inserted: Array<Record<string, unknown>>;
  published: Array<Record<string, unknown>>;
  /** When set, the insert for this testId rejects with a Drizzle-wrapped 23505. */
  duplicateTestId: number | null;
} = {
  orderTests: [],
  reconcileRows: [],
  inserted: [],
  published: [],
  duplicateTestId: null,
};

// Exactly how drizzle-orm surfaces a unique violation: the constraint name is on
// the cause, and `message` is only the query echo.
function drizzleUniqueViolation(constraint: string): Error {
  const cause: Error & { code?: string; constraint?: string } = new Error(
    `duplicate key value violates unique constraint "${constraint}"`,
  );
  cause.code = "23505";
  cause.constraint = constraint;
  const wrapper: Error & { cause?: unknown } = new Error(
    'Failed query: insert into "radiology_studies" ("accession_number") values ($1) returning "id"\nparams: ACC-20261106-US-001',
  );
  wrapper.name = "DrizzleQueryError";
  wrapper.cause = cause;
  return wrapper;
}

const CHAIN_METHODS = ["from", "innerJoin", "leftJoin", "rightJoin", "where", "orderBy", "limit", "for", "groupBy"];

function makeQuery(rows: () => unknown[]): unknown {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(rows()).then(onFulfilled);
      }
      if (prop === "insert") {
        return () => makeInsert();
      }
      if (prop === "execute") {
        return async () => ({ rows: [{ n: 1 }] });
      }
      if (CHAIN_METHODS.includes(prop)) return () => self;
      return () => self;
    },
  });
  return self;
}

function makeInsert(): unknown {
  const holder: Record<string, unknown> = {};
  const self = new Proxy(holder, {
    get(_t, prop: string) {
      if (prop === "values") {
        return (v: Record<string, unknown>) => {
          harness.inserted.push(v);
          return self;
        };
      }
      if (prop === "returning") {
        return async () => {
          const v = harness.inserted[harness.inserted.length - 1] ?? {};
          if (harness.duplicateTestId !== null && v.testId === harness.duplicateTestId) {
            throw drizzleUniqueViolation("radiology_studies_order_test_uq");
          }
          return [{ id: 90000 + harness.inserted.length, accessionNumber: v.accessionNumber, referringDoctor: v.referringDoctor }];
        };
      }
      return () => self;
    },
  });
  return self;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => makeQuery(() => harness.orderTests),
    selectDistinct: () => makeQuery(() => harness.reconcileRows),
    insert: () => makeInsert(),
    execute: async () => ({ rows: [{ n: 1 }] }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}));

vi.mock("../lib/pacs/resolveScheduledStationAeTitle", () => ({
  resolveScheduledStationAeTitle: async ({ modality }: { modality: string }) => ({
    aeTitle: PRODUCTION_STATIONS[modality] ?? null,
    source: "modality_registry",
    reason: "ok",
  }),
}));

vi.mock("../lib/pacs/publishRadiologyStudyToMwl", () => ({
  publishRadiologyStudyToMwl: async (opts: Record<string, unknown>) => {
    harness.published.push(opts);
  },
}));

vi.mock("../lib/radiologistAssignment", () => ({
  assignRadiologistToStudy: async () => ({ assigned: false }),
}));

const warnCalls: Array<{ msg: string; payload: Record<string, unknown> }> = [];
vi.mock("../lib/logger", () => ({
  logger: {
    warn: (payload: Record<string, unknown>, msg: string) => warnCalls.push({ msg, payload }),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Imported after the mocks are registered (vi.mock is hoisted).
const { generateStudiesForOrder, reconcileMissingStudies, uniqueViolationConstraint } = await import("./radiology");

const ECHO_ORDER_TESTS: OrderTestRow[] = [
  { orderTestId: 501, testId: 405, testName: "ECHO", department: "Cardiology", roomNumber: "USG ROOM NO. 1", deviceName: "USG GE E9 Voluson" },
  { orderTestId: 502, testId: 383, testName: " ECHO FETAL", department: "Cardiology", roomNumber: "USG ROOM NO. 1", deviceName: "USG GE E9 Voluson" },
  { orderTestId: 503, testId: 404, testName: "ECG", department: "Cardiology", roomNumber: "Cardiology Room No. 6", deviceName: null },
  { orderTestId: 504, testId: 141, testName: "TMT", department: "Cardiology", roomNumber: "Cardiology Room No. 6", deviceName: null },
  { orderTestId: 505, testId: 384, testName: "USG LOWER ABDOMEN", department: "USG", roomNumber: "USG ROOM NO. 1", deviceName: "USG GE E9 Voluson" },
];

function resetHarness(): void {
  harness.orderTests = [];
  harness.reconcileRows = [];
  harness.inserted = [];
  harness.published = [];
  harness.duplicateTestId = null;
}

describe("C. the fan-out turns a billed echo into an ultrasound study", () => {
  it("echo becomes a US study in the USG family, and the Voluson is told", async () => {
    resetHarness();
    harness.orderTests = ECHO_ORDER_TESTS;

    const created = await generateStudiesForOrder({
      billId: 7001,
      orderId: 8001,
      patientId: 1234,
      priority: "routine",
    });

    expect(created.map((c) => c.testName).sort()).toEqual([" ECHO FETAL", "ECHO", "USG LOWER ABDOMEN"]);
    const echoStudy = harness.inserted.find((r) => r.testId === 405)!;
    expect(echoStudy.modality).toBe("US");
    expect(echoStudy.department).toBe("USG");
    expect(echoStudy.roomNumber).toBe("USG ROOM NO. 1");
    expect(echoStudy.status).toBe("scheduled");
    // An echo accession is an ultrasound accession — the sequence the sonographer
    // and the DICOM C-FIND both key on.
    expect(String(echoStudy.accessionNumber)).toContain("-US-");

    const echoMwl = harness.published.find((p) => p.testId === 405)!;
    expect(echoMwl.modality).toBe("US");
    expect(echoMwl.stationAeTitle).toBe("Voluson");
    expect(echoMwl.procedureName).toBe("ECHO");
  });

  it("ECG and TMT are still not imaging, and the skip is named in the log", async () => {
    resetHarness();
    harness.orderTests = ECHO_ORDER_TESTS;
    warnCalls.length = 0;

    const created = await generateStudiesForOrder({
      billId: 7002,
      orderId: 8002,
      patientId: 1234,
      priority: "routine",
    });

    expect(created.map((c) => c.testName).sort()).toEqual([" ECHO FETAL", "ECHO", "USG LOWER ABDOMEN"]);
    expect(harness.inserted.filter((r) => r.testId === 404)).toHaveLength(0);
    expect(harness.inserted.filter((r) => r.testId === 141)).toHaveLength(0);

    // The desk's question is "why is this paid test on no worklist?", so the
    // skip must name the test, its counter and the device (or absence of one).
    const skipped = warnCalls.find((c) => /skipped by the study fan-out/.test(c.msg));
    expect(skipped).toBeDefined();
    expect(String(skipped!.msg)).toContain("no radiology device bound");
    expect(skipped!.payload.skipped).toEqual([
      { orderTestId: 503, testName: "ECG", department: "Cardiology", deviceName: null },
      { orderTestId: 504, testName: "TMT", department: "Cardiology", deviceName: null },
    ]);
  });

  it("a radiology study for a working department is untouched by the rule", async () => {
    resetHarness();
    harness.orderTests = [ECHO_ORDER_TESTS[4]];

    const created = await generateStudiesForOrder({
      billId: 7003,
      orderId: 8003,
      patientId: 1234,
      priority: "routine",
    });

    expect(created).toHaveLength(1);
    expect(harness.inserted[0].department).toBe("USG");
    expect(harness.inserted[0].modality).toBe("US");
    // Single radiology test on the bill: the clerk's description is still trusted.
    expect(harness.published[0].stationAeTitle).toBe("Voluson");
  });

  it("an order of USG + echo is two examinations, so neither borrows the other's title", async () => {
    resetHarness();
    harness.orderTests = [ECHO_ORDER_TESTS[0], ECHO_ORDER_TESTS[4]];

    await generateStudiesForOrder({
      billId: 7004,
      orderId: 8004,
      patientId: 1234,
      priority: "routine",
      dicomFields: { studyDescription: "USG ABDOMEN" },
    });

    const titles = harness.inserted.map((r) => r.studyDescription).sort();
    expect(titles).toEqual(["ECHO", "USG LOWER ABDOMEN"]);
  });

  it("the reconciliation sweep re-runs the same predicate, so a paid echo is healed", async () => {
    resetHarness();
    harness.reconcileRows = [
      { ...ECHO_ORDER_TESTS[0], orderId: 8005, patientId: 1234, billId: 7005 },
      // Same order, non-imaging test: must not pull the order in on its own.
      { ...ECHO_ORDER_TESTS[2], orderId: 8006, patientId: 1235, billId: 7006 },
    ];
    // The fan-out re-reads the order through `select`.
    harness.orderTests = [ECHO_ORDER_TESTS[0]];

    const recovered = await reconcileMissingStudies();

    expect(recovered).toBe(1);
    expect(harness.inserted).toHaveLength(1);
    expect(harness.inserted[0].modality).toBe("US");
    expect(harness.inserted[0].department).toBe("USG");
  });
});

describe("D. one booked examination must not lose the others on the order", () => {
  it("the guard reads the constraint from the wrapped cause, not from message", () => {
    const wrapped = drizzleUniqueViolation("radiology_studies_order_test_uq");
    // This is the whole defect: the name the guard searched for is not in message.
    expect(wrapped.message).not.toMatch(/order_test_uq/);
    expect(uniqueViolationConstraint(wrapped)).toBe("radiology_studies_order_test_uq");
  });

  it("a bare driver error naming the constraint in its message still resolves", () => {
    const bare = new Error('duplicate key value violates unique constraint "radiology_studies_accession_uq"');
    expect(uniqueViolationConstraint(bare)).toBe("radiology_studies_accession_uq");
  });

  it("anything that is not a unique violation answers null", () => {
    expect(uniqueViolationConstraint(new Error("connect ECONNREFUSED"))).toBeNull();
    expect(uniqueViolationConstraint(undefined)).toBeNull();
  });

  it("the fan-out skips the already-issued test and still creates the echoes", async () => {
    resetHarness();
    harness.orderTests = ECHO_ORDER_TESTS;
    harness.duplicateTestId = 384; // USG LOWER ABDOMEN was booked earlier today

    const created = await generateStudiesForOrder({
      billId: 7007,
      orderId: 8007,
      patientId: 1234,
      priority: "routine",
    });

    expect(created.map((c) => c.testName).sort()).toEqual([" ECHO FETAL", "ECHO"]);
    // The duplicate cost one insert attempt and aborted nothing else.
    expect(harness.inserted.filter((r) => r.testId === 384)).toHaveLength(1);
    expect(harness.published.filter((p) => p.testId === 384)).toHaveLength(0);
  });
});
