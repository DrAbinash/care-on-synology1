import { describe, expect, test, vi, beforeEach } from "vitest";

// Regression coverage for: PUT /api/clinic-settings returning 400 after
// login, with no server-side visibility into which field/type triggered it.
//
// Approach: rather than spinning up a full HTTP server (no supertest
// dependency in this repo), we reach into the Express Router's internal
// stack to grab the actual PUT "/" handler function and invoke it directly
// with a fake req/res — the same technique already used implicitly by
// Express itself, just without the HTTP transport in between. This lets us
// assert, for the *exact* payload shapes the frontend Settings page sends
// (see artifacts/diagnostic-erp/src/pages/Settings.tsx), that the endpoint
// accepts them (no 400), and that when a payload genuinely is malformed we
// get both a clear 400 error message AND a server-side console.warn log
// (the logging added specifically so future incidents like this are
// diagnosable from container logs instead of guesswork).

let currentRow: Record<string, unknown>;
let updateSetCalls: Record<string, unknown>[];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: async () => [currentRow],
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updateSetCalls.push(vals);
        return {
          where: () => ({
            returning: async () => [{ ...currentRow, ...vals }],
          }),
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: 1, ...v }],
      }),
    }),
  },
  clinicSettingsTable: { id: "id" },
}));

function getPutHandler(router: any) {
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === "/" && l.route.methods.put
  );
  if (!layer) throw new Error("PUT / handler not found on clinicSettingsRouter");
  // Last handler in the route's stack is the actual route function.
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("PUT /api/clinic-settings — accepts real frontend payload shapes", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    currentRow = { id: 1, name: "Care Diagnostics" };
    updateSetCalls = [];
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("ClinicInfoTab payload (name/tagline/address/... minus quickTestIds/formFTestIds)", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = {
      body: {
        name: "Care Diagnostics",
        tagline: "Diagnostic & Pathology Services",
        address: "Deoghar",
        registeredAddress: "Deoghar",
        email: "info@example.com",
        phone: "9999999999",
        website: "https://example.com",
        gstin: "22AAAAA0000A1Z5",
        footerNote: "Thank you.",
        logoDataUrl: null,
        sidebarTheme: "navy",
        // Fields present on the full settings object but not part of any
        // known validated field list — must be silently ignored, not 400.
        id: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Online Booking tab payload (payment gateway toggles + JSON-as-text fields)", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = {
      body: {
        onlineBookingEnabled: true,
        vipQueueEnabled: false,
        razorpayKeyId: "",
        onlineBookingLedgerId: 1,
        payuEnabled: false,
        payuMerchantKey: "",
        phonepeEnabled: false,
        phonepeMerchantId: "",
        bharatpeEnabled: false,
        bharatpeMerchantId: "",
        cashfreeEnabled: false,
        cashfreeAppId: "",
        iciciEnabled: true,
        iciciMerchantId: "100000000455452",
        iciciAggregatorId: "100000000455451",
        iciciSecretKey: "",
        upiQrEnabled: false,
        upiVpa: "",
        upiQrImageUrl: "",
        onlineBookingAllowedTestIds: "[]",
        onlineBookingAllowedPackageIds: "[]",
        onlineBookingServices: "{}",
        serviceImages: "{}",
        serviceImagesEnabled: false,
        vipPercentage: "50.00",
        disclaimerText: "",
        disclaimerRefundPercentage: 90,
        disclaimerCancellationWindowHours: 24,
        disclaimerDisplayPosition: "bottom",
        disclaimerFontSize: "sm",
        disclaimerEnabled: true,
      },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Form F tab payload (formFTestIds/formFBillingPrompt/etc.)", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = {
      body: {
        formFTestIds: JSON.stringify([1, 2, 3]),
        formFBillingPrompt: false,
        formFAddressRequired: true,
        formFGuardianRequired: true,
        serviceImages: "{}",
      },
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("sidebar theme quick-save payload ({ sidebarTheme })", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = { body: { sidebarTheme: "violet" } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("REGRESSION: a genuine type mismatch (boolean field sent as string) is rejected with a clear message AND logged server-side", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = { body: { onlineBookingEnabled: "true" } }; // string, not boolean
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "onlineBookingEnabled must be a boolean" });
    // The fix for item 5: every 400 must be logged server-side with the
    // field/message and the set of keys the client actually sent, so a
    // future incident is diagnosable from container logs alone.
    expect(warnSpy).toHaveBeenCalledWith(
      "[PUT /api/clinic-settings] rejected 400:",
      "onlineBookingEnabled must be a boolean",
      "| received body keys:",
      ["onlineBookingEnabled"]
    );
  });

  test("REGRESSION: an invalid sidebarTheme value is rejected with a clear message AND logged server-side", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = { body: { sidebarTheme: "not-a-real-theme" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/sidebarTheme must be one of/);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("unknown/extra fields the backend doesn't recognize are ignored, not rejected", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const req = { body: { someFieldThatDoesNotExist: "whatever", name: "Care Diagnostics" } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    // The unknown field must never reach the DB update payload.
    expect(updateSetCalls[0]).not.toHaveProperty("someFieldThatDoesNotExist");
  });
});

describe("PUT /api/clinic-settings — billPrintSettingsJson (clinic-wide Billing Print settings blob)", () => {
  beforeEach(() => {
    currentRow = { id: 1, name: "Care Diagnostics" };
    updateSetCalls = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("accepts a valid JSON object string and persists it verbatim", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const blob = JSON.stringify({ defaultPaperSize: "A4", printMarginMm: 2, adminLock: true });
    const res = makeRes();
    await handler({ body: { billPrintSettingsJson: blob } }, res);
    expect(res.statusCode).toBe(200);
    expect(updateSetCalls[0].billPrintSettingsJson).toBe(blob);
  });

  test("rejects a non-string value", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const res = makeRes();
    await handler({ body: { billPrintSettingsJson: { defaultPaperSize: "A4" } } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/billPrintSettingsJson/);
  });

  test("rejects malformed JSON", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const res = makeRes();
    await handler({ body: { billPrintSettingsJson: "{not json" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/valid JSON/);
  });

  test("rejects JSON that is not an object (array)", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const res = makeRes();
    await handler({ body: { billPrintSettingsJson: "[1,2,3]" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/JSON object/);
  });

  test("rejects an oversized blob (> 8KB)", async () => {
    const { default: clinicSettingsRouter } = await import("./clinicSettings");
    const handler = getPutHandler(clinicSettingsRouter);
    const res = makeRes();
    await handler({ body: { billPrintSettingsJson: JSON.stringify({ pad: "x".repeat(9000) }) } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/max 8KB/);
  });
});
