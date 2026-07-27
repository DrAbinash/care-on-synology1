import { Router } from "express";
import { db, clinicSettingsTable, DEFAULT_BOOKING_TIME_SLOTS_JSON } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";
import {
  hasCommissionAccess,
  CLINIC_COMMISSION_FIELDS,
  stripFields,
} from "../middleware/commissionVisibility";

const CLINIC_SETTINGS_CACHE_KEY = "clinic-settings:v1";

const clinicSettingsRouter = Router();

async function getOrCreate() {
  try {
    const rows = await db.select().from(clinicSettingsTable).limit(1);
    if (rows[0]) return rows[0];
    const [created] = await db.insert(clinicSettingsTable).values({}).returning();
    return created;
  } catch (_e: any) {
    // Drizzle schema may be ahead of the production DB (missing columns).
    // Return safe defaults so the UI can still load while migrations catch up.
    return {
      id: 1,
      name: "Care Diagnostics",
      tagline: "Diagnostic & Pathology Services",
      address: "",
      registeredAddress: "",
      email: "",
      phone: "",
      website: "",
      gstin: "",
      logoDataUrl: null,
      footerNote: "Thank you for choosing our diagnostic services.",
      formFTestIds: "[]",
      quickTestIds: "[null,null,null,null,null,null]",
      patientPhotoEnabled: false,
      showTatOnBill: false,
      billPrintCopies: 1,
      qrOnBillEnabled: true,
      portalEnabled: false,
      portalHeading: "Care Diagnostics",
      portalWelcomeMessage: "",
      portalAllowAppointmentBooking: true,
      portalAllowProfileEdit: true,
      portalBackgroundImageDataUrl: null,
      onlineBookingEnabled: false,
      razorpayKeyId: "",
      onlineBookingLedgerId: 1,
      vipQueueEnabled: false,
      payuEnabled: false,
      payuMerchantKey: "",
      phonepeEnabled: false,
      phonepeMerchantId: "",
      bharatpeEnabled: false,
      bharatpeMerchantId: "",
      cashfreeEnabled: false,
      cashfreeAppId: "",
      iciciEnabled: false,
      iciciMerchantId: "",
      iciciAggregatorId: "",
      iciciSecretKey: "",
      kioskEnabled: false,
      kioskUpiVpa: "",
      kioskUpiName: "",
      kioskWelcomeMessage: "",
      kioskAllowedTestIds: "[]",
      upiQrImageUrl: "",
      upiVpa: "",
      upiQrEnabled: false,
      onlineBookingAllowedTestIds: "[]",
      onlineBookingAllowedPackageIds: "[]",
      hopeBookingAllowedTestIds: "[]",
      hopeBookingAllowedPackageIds: "[]",
      bookingTimeSlots: DEFAULT_BOOKING_TIME_SLOTS_JSON,
      sidebarTheme: "navy",
      billDefaultPaperSize: "A5",
      billPrintSettingsJson: "{}",
      mobileAppConfigJson: "{}",
      billShowCode: true,
      billShowCategory: true,
      dayCloseAutoPrint: true,
      commissionDiscountMode: "none",
      expenseSelfApprovalAllowed: true,
      lanOnlyLogin: false,
      lanAllowedIps: "[]",
      fido2Enabled: false,
      formFBillingPrompt: false,
      formFAddressRequired: true,
      formFGuardianRequired: true,
      patientPhoneRequired: true,
      // V3 fallbacks
      receiptThankYouMessage: "Thank you for choosing Care Diagnostics.",
      receiptCollectionMessage: "Please collect your reports within 7 days.",
      receiptQrMessage: "Scan QR code to verify receipt and download reports.",
      receiptPromotionalMessage: "Advanced Diagnostic & Imaging Centre.",
      serviceFooter: "[\"MRI\",\"CT Scan\",\"Ultrasound\",\"Digital X-Ray\",\"Mammography\",\"Pathology\"]",
      showFollowUpMessage: false,
      followUpMessage: "For future investigations, please quote your Patient ID.",
      showPromotionalFooter: false,
      promotionalTitle: "",
      promotionalDescription: "",
      showPatientSince: false,
      showVerifiedBadge: false,
      showAuditInfoOnPatientCopy: false,
      showWorkingHours: false,
      workingHoursMessage: "Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM",
      showHomeCollection: false,
      homeCollectionMessage: "Home Collection Available. Call us to book.",
      showEmergency: false,
      emergencyMessage: "24x7 Emergency Services Available",
      showReferralProgram: false,
      referralProgramMessage: "Refer a friend and get 10% off your next visit.",
      showHealthPackages: false,
      healthPackagesMessage: "Annual Health Checkup packages available at discounted rates.",
      showAccreditation: false,
      accreditationMessage: "NABL Accredited / ISO 9001:2015 Certified",
      showWhatsAppBooking: false,
      whatsAppBookingMessage: "Book appointments on WhatsApp: +91",
      showCustomFooterMessage: false,
      customFooterMessage: "",
      // Form F scanner fallbacks
      autoCropIdScan: true,
      autoRotateScan: false,
      archiveImportedScans: true,
      cropPadding: 12,
      jpegQuality: 92,
      maxScanWidth: 2000,
      mobileScanEnabled: true,
      phonePairingEnabled: true,
      preferredScanner: "camera",
      requireDesktopConfirmation: true,
      autoDeleteTempScans: true,
      ocrEnabled: true,
      aadhaarQrEnabled: true,
      // Phase 2 Scanner Defaults
      scannerGlobalEnabled: false,
      scanStationKioskModeEnabled: true,
      scanStationAutoClearEnabled: true,
      scanStationResultDisplaySeconds: 10,
      // Ollama fallbacks
      ollamaBaseUrl: null,
      ollamaModel: null,
      ollamaLocalOnly: false,
      ollamaKnownModels: "[]",
      // Online booking additions
      onlineBookingServices: "{\"opd\":true,\"emergency\":true,\"usg\":true,\"xray\":true,\"ct\":true,\"mri\":true,\"pathology\":true,\"packages\":true,\"home_collection\":true,\"doctor\":true}",
      serviceImages: "{}",
      serviceImagesEnabled: false,
      quickTestCategoryImages: "{}",
      quickTestOverlayOpacity: 35,
      vipPercentage: "50.00",
      disclaimerText: "Online booking charges are subject to the centre's cancellation policy. In case of cancellation after confirmation, administrative charges may be deducted from the refundable amount.",
      disclaimerRefundPercentage: 90,
      disclaimerCancellationWindowHours: 24,
      disclaimerDisplayPosition: "bottom",
      disclaimerFontSize: "sm",
      disclaimerEnabled: true,
      // Refactored Payment Gateway Settings
      activePaymentGateway: "icici",
      enableCardPayment: true,
      enableQrPayment: true,
      enableVipBooking: true,
      enablePaymentLogos: true,
      enablePaymentTimer: true,
      customIciciBannerUrl: "",
      customPhonepeBannerUrl: "",
      customBharatpeBannerUrl: "",
      customPayuBannerUrl: "",
      autoPopulateFormFFromObMeasurements: false,
      queueVipMode: "highlighted",
      queuePrivacyMode: "masked",
      queueEstimatedWaitPerPatient: 15,
      updatedAt: new Date(),
    } as any;
  }
}

// Public branding fields (no auth required) — used by bill printing, public
// clinic site, patient portal, and bill verification QR pages.
clinicSettingsRouter.get("/branding", async (_req, res) => {
  const row = await getOrCreate();
  res.json({
    name: row.name ?? "",
    tagline: row.tagline ?? "",
    address: row.address ?? "",
    registeredAddress: row.registeredAddress ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    gstin: row.gstin ?? "",
    logoDataUrl: row.logoDataUrl ?? null,
    footerNote: row.footerNote ?? "",
    portalHeading: row.portalHeading ?? "",
    portalWelcomeMessage: row.portalWelcomeMessage ?? "",
    billPrintCopies: row.billPrintCopies ?? 1,
    billDefaultPaperSize: row.billDefaultPaperSize ?? "A5",
    // Clinic-wide Billing Print settings blob — the billing pages read their
    // clinic data from this endpoint, so it must ride along here for the
    // print call sites to honor the admin-configured paper size/format.
    billPrintSettingsJson: (row as { billPrintSettingsJson?: string }).billPrintSettingsJson ?? "{}",
    // Mobile-app display config blob (Settings → Mobile App); served publicly
    // (whitelisted) via GET /api/public/mobile-config.
    mobileAppConfigJson: (row as { mobileAppConfigJson?: string }).mobileAppConfigJson ?? "{}",
    billShowCode: row.billShowCode ?? false,
    billShowCategory: row.billShowCategory ?? false,
    qrOnBillEnabled: row.qrOnBillEnabled ?? true,
    showTatOnBill: row.showTatOnBill ?? false,
    dayCloseAutoPrint: row.dayCloseAutoPrint ?? true,
    quickTestIds: row.quickTestIds ?? "[null,null,null,null,null,null,null,null]",
    quickDoctorIds: row.quickDoctorIds ?? "[null,null,null,null,null,null,null,null]",
    formFTestIds: row.formFTestIds ?? "[]",
    formFBillingPrompt: row.formFBillingPrompt ?? false,
    formFAddressRequired: row.formFAddressRequired ?? true,
    formFGuardianRequired: row.formFGuardianRequired ?? true,
    patientPhoneRequired: row.patientPhoneRequired ?? true,
    // V3: Receipt Messages
    receiptThankYouMessage: row.receiptThankYouMessage ?? "Thank you for choosing Care Diagnostics.",
    receiptCollectionMessage: row.receiptCollectionMessage ?? "Please collect your reports within 7 days.",
    receiptQrMessage: row.receiptQrMessage ?? "Scan QR code to verify receipt and download reports.",
    receiptPromotionalMessage: row.receiptPromotionalMessage ?? "Advanced Diagnostic & Imaging Centre.",
    // V3: Service Footer
    serviceFooter: row.serviceFooter ?? "[\"MRI\",\"CT Scan\",\"Ultrasound\",\"Digital X-Ray\",\"Mammography\",\"Pathology\"]",
    // V3: Follow-up
    showFollowUpMessage: row.showFollowUpMessage ?? false,
    followUpMessage: row.followUpMessage ?? "For future investigations, please quote your Patient ID.",
    // V3: Promotional Footer
    showPromotionalFooter: row.showPromotionalFooter ?? false,
    promotionalTitle: row.promotionalTitle ?? "",
    promotionalDescription: row.promotionalDescription ?? "",
    // V3: Identity & Security
    showPatientSince: row.showPatientSince ?? false,
    showVerifiedBadge: row.showVerifiedBadge ?? false,
    // V3: Print audit
    showAuditInfoOnPatientCopy: row.showAuditInfoOnPatientCopy ?? false,
    // V3: Additional footer messages
    showWorkingHours: row.showWorkingHours ?? false,
    workingHoursMessage: row.workingHoursMessage ?? "Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM",
    showHomeCollection: row.showHomeCollection ?? false,
    homeCollectionMessage: row.homeCollectionMessage ?? "Home Collection Available. Call us to book.",
    showEmergency: row.showEmergency ?? false,
    emergencyMessage: row.emergencyMessage ?? "24x7 Emergency Services Available",
    showReferralProgram: row.showReferralProgram ?? false,
    referralProgramMessage: row.referralProgramMessage ?? "Refer a friend and get 10% off your next visit.",
    showHealthPackages: row.showHealthPackages ?? false,
    healthPackagesMessage: row.healthPackagesMessage ?? "Annual Health Checkup packages available at discounted rates.",
    showAccreditation: row.showAccreditation ?? false,
    accreditationMessage: row.accreditationMessage ?? "NABL Accredited / ISO 9001:2015 Certified",
    showWhatsAppBooking: row.showWhatsAppBooking ?? false,
    whatsAppBookingMessage: row.whatsAppBookingMessage ?? "Book appointments on WhatsApp: +91",
    showCustomFooterMessage: row.showCustomFooterMessage ?? false,
    customFooterMessage: row.customFooterMessage ?? "",
    // Phase 2 Scanner Settings
    scannerGlobalEnabled: row.scannerGlobalEnabled ?? false,
    scanStationKioskModeEnabled: row.scanStationKioskModeEnabled ?? true,
    scanStationAutoClearEnabled: row.scanStationAutoClearEnabled ?? true,
    scanStationResultDisplaySeconds: row.scanStationResultDisplaySeconds ?? 10,
  });
});

clinicSettingsRouter.get("/", async (req, res) => {
  // Clinic/hospital settings are read on nearly every page load (branding,
  // feature toggles, payment-provider enabled flags) but change rarely —
  // a 5-minute cache removes a DB round-trip from the hottest path in the
  // whole ERP. PUT / and POST /ollama invalidate this key immediately after
  // a successful write, so edits still show up within the same request.
  //
  // The commission settings on this row are Super-Admin-only. The cache stays
  // complete and USB-agnostic; the fields are removed on the way out, so one
  // caller's visibility can never be cached and served to another.
  const shape = <T extends Record<string, unknown>>(row: T) =>
    hasCommissionAccess(req) ? row : stripFields(row, CLINIC_COMMISSION_FIELDS);

  const cached = getCached<Awaited<ReturnType<typeof getOrCreate>>>(CLINIC_SETTINGS_CACHE_KEY);
  if (cached) {
    res.json(shape(cached as unknown as Record<string, unknown>));
    return;
  }
  const row = await getOrCreate();
  setCached(CLINIC_SETTINGS_CACHE_KEY, row, TTL.SHORT);
  res.json(shape(row as unknown as Record<string, unknown>));
});

clinicSettingsRouter.put("/", async (req, res) => {
  const current = await getOrCreate();
  const body = req.body ?? {};
  const fields = ["name", "tagline", "address", "registeredAddress", "email", "phone", "website", "gstin", "footerNote", "logoDataUrl", "formFTestIds", "quickTestIds"] as const;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of fields) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  if (body.sidebarTheme !== undefined) {
    const VALID_THEMES = ["navy", "violet", "teal", "charcoal", "forest"];
    const isCustom = typeof body.sidebarTheme === "string" && /^custom:#[0-9a-fA-F]{6}$/.test(body.sidebarTheme);
    if (typeof body.sidebarTheme !== "string" || (!VALID_THEMES.includes(body.sidebarTheme) && !isCustom)) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", `sidebarTheme must be one of: ${VALID_THEMES.join(", ")} or custom:#rrggbb`, "| received body keys:", Object.keys(body));
      res.status(400).json({ error: `sidebarTheme must be one of: ${VALID_THEMES.join(", ")} or custom:#rrggbb` });
      return;
    }
    update.sidebarTheme = body.sidebarTheme;
  }
  const boolFields = [
    "patientPhotoEnabled", "showTatOnBill", "qrOnBillEnabled", "portalEnabled", "portalAllowAppointmentBooking",
    "portalAllowProfileEdit", "onlineBookingEnabled", "vipQueueEnabled", "payuEnabled", "phonepeEnabled",
    "bharatpeEnabled", "cashfreeEnabled", "iciciEnabled", "upiQrEnabled", "billShowCode", "billShowCategory",
    "dayCloseAutoPrint", "lanOnlyLogin", "fido2Enabled", "kioskEnabled", "formFBillingPrompt", "formFAddressRequired",
    "formFGuardianRequired", "showFollowUpMessage", "showPromotionalFooter", "showPatientSince", "showVerifiedBadge",
    "showAuditInfoOnPatientCopy", "showWorkingHours", "showHomeCollection", "showEmergency", "showReferralProgram",
    "showHealthPackages", "showAccreditation", "showWhatsAppBooking", "showCustomFooterMessage", "autoCropIdScan",
    "autoRotateScan", "archiveImportedScans", "ollamaLocalOnly", "serviceImagesEnabled", "disclaimerEnabled",
    "mobileScanEnabled", "phonePairingEnabled", "requireDesktopConfirmation", "autoDeleteTempScans", "ocrEnabled",
    "aadhaarQrEnabled", "autoPopulateFormFFromObMeasurements", "patientPhoneRequired",
    // Phase 2 Scanner Settings
    "scannerGlobalEnabled", "scanStationKioskModeEnabled", "scanStationAutoClearEnabled",
    // Refactored fields
    "enableCardPayment", "enableQrPayment", "enableVipBooking", "enablePaymentLogos", "enablePaymentTimer",
    // Expense approval separation
    "expenseSelfApprovalAllowed"
  ] as const;
  
  const textFields = [
    "kioskPaymentGateway", "kioskUpiVpa", "kioskUpiName", "kioskWelcomeMessage", "kioskAllowedTestIds",
    "onlineBookingAllowedTestIds", "onlineBookingAllowedPackageIds",
    "hopeBookingAllowedTestIds", "hopeBookingAllowedPackageIds",
    "bookingTimeSlots", "razorpayKeyId", "payuMerchantKey",
    "phonepeMerchantId", "bharatpeMerchantId", "cashfreeAppId", "iciciMerchantId", "iciciAggregatorId",
    "iciciSecretKey", "formFTestIds", "quickTestIds", "quickDoctorIds", "footerNote", "commissionDiscountMode", "lanAllowedIps",
    "billDefaultPaperSize", "name", "tagline", "address", "registeredAddress", "email", "phone", "website",
    "gstin", "logoDataUrl", "portalHeading", "portalWelcomeMessage", "portalBackgroundImageDataUrl", "sidebarTheme", "receiptThankYouMessage",
    "receiptCollectionMessage", "receiptQrMessage", "receiptPromotionalMessage", "serviceFooter", "followUpMessage",
    "promotionalTitle", "promotionalDescription", "workingHoursMessage", "homeCollectionMessage", "emergencyMessage",
    "referralProgramMessage", "healthPackagesMessage", "accreditationMessage", "whatsAppBookingMessage",
    "customFooterMessage", "ollamaBaseUrl", "ollamaModel", "onlineBookingServices", "serviceImages", "quickTestCategoryImages", "vipPercentage",
    "disclaimerText", "disclaimerDisplayPosition", "disclaimerFontSize", "preferredScanner",
    // Refactored fields
    "activePaymentGateway", "customIciciBannerUrl", "customPhonepeBannerUrl", "customBharatpeBannerUrl", "customPayuBannerUrl",
    "queueVipMode", "queuePrivacyMode"
  ] as const;
  
  if (body.preferredScanner !== undefined) {
    if (body.preferredScanner !== "mobile" && body.preferredScanner !== "bridge" && body.preferredScanner !== "camera") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "preferredScanner must be camera, mobile, or bridge", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "preferredScanner must be camera, mobile, or bridge" });
      return;
    }
    update.preferredScanner = body.preferredScanner;
  }

  // Handle refactored text fields explicitly
  for (const f of textFields) {
    if (body[f] !== undefined) {
      if (body[f] !== null && typeof body[f] !== "string") {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `${f} must be a string or null`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `${f} must be a string or null` });
        return;
      }
      update[f] = body[f] === null ? "" : body[f].trim();
    }
  }

  // bookingTimeSlots is stored as JSON-as-text (whitelisted in textFields
  // above). Validate it parses to an array of { value, label } strings so a
  // malformed blob can never reach the public booking form and break the
  // dropdown. An empty array is allowed (the form falls back to defaults).
  if (update.bookingTimeSlots !== undefined) {
    const raw = String(update.bookingTimeSlots || "").trim();
    if (raw === "") {
      update.bookingTimeSlots = "[]";
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.status(400).json({ error: "bookingTimeSlots must be valid JSON." });
        return;
      }
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (s) =>
            s && typeof s === "object" &&
            typeof (s as { value?: unknown }).value === "string" &&
            typeof (s as { label?: unknown }).label === "string",
        )
      ) {
        res.status(400).json({ error: "bookingTimeSlots must be an array of { value, label } objects." });
        return;
      }
      // Re-serialize the sanitized list (drops any extra keys, trims strings).
      update.bookingTimeSlots = JSON.stringify(
        (parsed as Array<{ value: string; label: string }>)
          .map((s) => ({ value: s.value.trim(), label: s.label.trim() }))
          .filter((s) => s.value !== "" && s.label !== ""),
      );
    }
  }

  // NOTE: quickTestIds and formFTestIds are intentionally NOT in boolFields
  // because they store JSON-as-text (e.g. "[null,null,null,null,null,null]").
  // They are listed in textFields above.
  for (const f of boolFields) {

    if (body[f] !== undefined) {
      if (typeof body[f] !== "boolean") {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `${f} must be a boolean`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `${f} must be a boolean` });
        return;
      }
      update[f] = body[f];
    }
  }
  // ── Ollama configuration ────────────────────────────────────────────────────
  if (body.ollamaBaseUrl !== undefined) {
    if (body.ollamaBaseUrl !== null && typeof body.ollamaBaseUrl !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaBaseUrl must be a string or null", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "ollamaBaseUrl must be a string or null" }); return;
    }
    const trimmed = typeof body.ollamaBaseUrl === "string" ? body.ollamaBaseUrl.trim() : null;
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaBaseUrl must be http:// or https://", "| received body keys:", Object.keys(body));
          res.status(400).json({ error: "ollamaBaseUrl must be http:// or https://" }); return;
        }
      } catch {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaBaseUrl is not a valid URL", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "ollamaBaseUrl is not a valid URL" }); return;
      }
    }
    update.ollamaBaseUrl = trimmed || null;
  }
  if (body.ollamaModel !== undefined) {
    if (body.ollamaModel !== null && typeof body.ollamaModel !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaModel must be a string or null", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "ollamaModel must be a string or null" }); return;
    }
    update.ollamaModel = typeof body.ollamaModel === "string" ? body.ollamaModel.trim() || null : null;
  }
  if (body.ollamaKnownModels !== undefined) {
    if (typeof body.ollamaKnownModels !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaKnownModels must be a JSON string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "ollamaKnownModels must be a JSON string" }); return;
    }
    try {
      const parsed = JSON.parse(body.ollamaKnownModels);
      if (!Array.isArray(parsed) || !parsed.every((m) => typeof m === "string")) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaKnownModels must be a JSON array of strings", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "ollamaKnownModels must be a JSON array of strings" }); return;
      }
    } catch {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaKnownModels must be valid JSON", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "ollamaKnownModels must be valid JSON" }); return;
    }
    update.ollamaKnownModels = body.ollamaKnownModels;
  }

  const portalTextFields = ["portalHeading", "portalWelcomeMessage"] as const;
  for (const f of portalTextFields) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "string") {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `${f} must be a string`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `${f} must be a string` });
        return;
      }
      if (body[f].length > 500) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `${f} too long (max 500 chars)`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `${f} too long (max 500 chars)` });
        return;
      }
      update[f] = body[f];
    }
  }
  if (body.razorpayKeyId !== undefined) {
    if (typeof body.razorpayKeyId !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "razorpayKeyId must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "razorpayKeyId must be a string" });
      return;
    }
    update.razorpayKeyId = body.razorpayKeyId.trim();
  }
  if (body.payuMerchantKey !== undefined) {
    if (typeof body.payuMerchantKey !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "payuMerchantKey must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "payuMerchantKey must be a string" });
      return;
    }
    update.payuMerchantKey = body.payuMerchantKey.trim();
  }
  if (body.phonepeMerchantId !== undefined) {
    if (typeof body.phonepeMerchantId !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "phonepeMerchantId must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "phonepeMerchantId must be a string" });
      return;
    }
    update.phonepeMerchantId = body.phonepeMerchantId.trim();
  }
  if (body.bharatpeMerchantId !== undefined) {
    if (typeof body.bharatpeMerchantId !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "bharatpeMerchantId must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "bharatpeMerchantId must be a string" });
      return;
    }
    update.bharatpeMerchantId = body.bharatpeMerchantId.trim();
  }
  if (body.cashfreeAppId !== undefined) {
    if (typeof body.cashfreeAppId !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "cashfreeAppId must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "cashfreeAppId must be a string" });
      return;
    }
    update.cashfreeAppId = body.cashfreeAppId.trim();
  }
  if (body.iciciMerchantId !== undefined) {
    if (typeof body.iciciMerchantId !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "iciciMerchantId must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "iciciMerchantId must be a string" });
      return;
    }
    update.iciciMerchantId = body.iciciMerchantId.trim();
  }
  if (body.iciciAggregatorId !== undefined) {
    if (typeof body.iciciAggregatorId !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "iciciAggregatorId must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "iciciAggregatorId must be a string" });
      return;
    }
    update.iciciAggregatorId = body.iciciAggregatorId.trim();
  }
  if (body.iciciSecretKey !== undefined) {
    if (typeof body.iciciSecretKey !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "iciciSecretKey must be a string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "iciciSecretKey must be a string" });
      return;
    }
    update.iciciSecretKey = body.iciciSecretKey.trim();
  }
  const arrayJsonTextFields = ["kioskUpiVpa", "kioskUpiName", "kioskWelcomeMessage", "kioskAllowedTestIds", "onlineBookingAllowedTestIds", "onlineBookingAllowedPackageIds", "hopeBookingAllowedTestIds", "hopeBookingAllowedPackageIds", "upiVpa", "upiQrImageUrl"] as const;
  for (const f of arrayJsonTextFields) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "string") {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `${f} must be a string`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `${f} must be a string` });
        return;
      }
      update[f] = body[f];
    }
  }
  if (body.onlineBookingLedgerId !== undefined) {
    const n = Number(body.onlineBookingLedgerId);
    if (!Number.isInteger(n) || n <= 0) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "onlineBookingLedgerId must be a positive integer", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "onlineBookingLedgerId must be a positive integer" });
      return;
    }
    update.onlineBookingLedgerId = n;
  }
  // Clinic-wide Billing Print settings blob (Settings → Billing Print).
  // Must be a JSON object (Partial<BillPrintSettings>) as a string — reject
  // anything else so a corrupt value can never reach the printing call sites.
  if (body.billPrintSettingsJson !== undefined) {
    if (typeof body.billPrintSettingsJson !== "string" || body.billPrintSettingsJson.length > 8192) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "billPrintSettingsJson must be a JSON string (max 8KB)", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "billPrintSettingsJson must be a JSON string (max 8KB)" });
      return;
    }
    try {
      const parsed = JSON.parse(body.billPrintSettingsJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "billPrintSettingsJson must be a JSON object", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "billPrintSettingsJson must be a JSON object" });
        return;
      }
    } catch {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "billPrintSettingsJson must be valid JSON", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "billPrintSettingsJson must be valid JSON" });
      return;
    }
    update.billPrintSettingsJson = body.billPrintSettingsJson;
  }
  // Mobile-app display config blob (Settings → Mobile App). Same contract as
  // billPrintSettingsJson: must be a JSON object serialized as a string. The
  // public /api/public/mobile-config endpoint additionally whitelists keys on
  // the way out, so even a well-formed-but-wrong blob can't leak secrets.
  if (body.mobileAppConfigJson !== undefined) {
    if (typeof body.mobileAppConfigJson !== "string" || body.mobileAppConfigJson.length > 16384) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "mobileAppConfigJson must be a JSON string (max 16KB)", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "mobileAppConfigJson must be a JSON string (max 16KB)" });
      return;
    }
    try {
      const parsed = JSON.parse(body.mobileAppConfigJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "mobileAppConfigJson must be a JSON object", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "mobileAppConfigJson must be a JSON object" });
        return;
      }
    } catch {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "mobileAppConfigJson must be valid JSON", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "mobileAppConfigJson must be valid JSON" });
      return;
    }
    update.mobileAppConfigJson = body.mobileAppConfigJson;
  }
  if (body.billDefaultPaperSize !== undefined) {
    if (body.billDefaultPaperSize !== "A4" && body.billDefaultPaperSize !== "A5") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "billDefaultPaperSize must be A4 or A5", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "billDefaultPaperSize must be A4 or A5" });
      return;
    }
    update.billDefaultPaperSize = body.billDefaultPaperSize;
  }
  if (body.billPrintCopies !== undefined) {
    const n = Number(body.billPrintCopies);
    if (!Number.isInteger(n) || (n !== 1 && n !== 2)) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "billPrintCopies must be 1 or 2", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "billPrintCopies must be 1 or 2" });
      return;
    }
    update.billPrintCopies = n;
  }
  if (body.lanAllowedIps !== undefined) {
    if (typeof body.lanAllowedIps !== "string") {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "lanAllowedIps must be a JSON string", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "lanAllowedIps must be a JSON string" });
      return;
    }
    try {
      const parsed = JSON.parse(body.lanAllowedIps);
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "lanAllowedIps must be a JSON array of strings", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "lanAllowedIps must be a JSON array of strings" });
        return;
      }
    } catch {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "lanAllowedIps must be valid JSON", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "lanAllowedIps must be valid JSON" });
      return;
    }
    update.lanAllowedIps = body.lanAllowedIps;
  }
  // Commission settings are Super-Admin-only — they belong to the pen drive,
  // and the portal's PATCH /api/super-admin/commission-settings is the way to
  // change them. Reject rather than silently ignore, so an unauthorised caller
  // is never told a commission change succeeded when it did not.
  if (CLINIC_COMMISSION_FIELDS.some(f => body[f] !== undefined)) {
    if (!hasCommissionAccess(req)) {
      console.warn("[PUT /api/clinic-settings] rejected 403: commission settings require the super-admin USB key", "| received body keys:", Object.keys(body));
      res.status(403).json({ error: "Commission settings can only be changed from the Super Admin portal" });
      return;
    }
    if (body.commissionDiscountMode !== undefined) {
      const valid = ["none", "deduct", "deduct_rollover"];
      if (!valid.includes(body.commissionDiscountMode)) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `commissionDiscountMode must be one of: ${valid.join(", ")}`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `commissionDiscountMode must be one of: ${valid.join(", ")}` });
        return;
      }
      update.commissionDiscountMode = body.commissionDiscountMode;
    }
  }
  // Form F scanner integer settings
  const intFields = ["cropPadding", "jpegQuality", "maxScanWidth", "disclaimerRefundPercentage", "disclaimerCancellationWindowHours", "scanStationResultDisplaySeconds", "queueEstimatedWaitPerPatient"] as const;
  for (const f of intFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 0 || n > 5000) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", `${f} must be an integer between 0 and 5000`, "| received body keys:", Object.keys(body));
        res.status(400).json({ error: `${f} must be an integer between 0 and 5000` });
        return;
      }
      update[f] = n;
    }
  }

  if (body.quickTestOverlayOpacity !== undefined) {
    const n = Number(body.quickTestOverlayOpacity);
    update.quickTestOverlayOpacity = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 35;
  }

  if (typeof update.logoDataUrl === "string" && update.logoDataUrl.length > 2_000_000) {
    res.status(413).json({ error: "Logo too large (max ~1.5MB)" });
    return;
  }
  if (typeof update.portalBackgroundImageDataUrl === "string" && update.portalBackgroundImageDataUrl.length > 4_000_000) {
    res.status(413).json({ error: "Background image too large (max ~3MB)" });
    return;
  }
  if (typeof update.quickTestIds === "string") {
    if (update.quickTestIds.length > 260) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "quickTestIds payload too large", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "quickTestIds payload too large" });
      return;
    }
    try {
      const parsed = JSON.parse(update.quickTestIds);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 8 ||
        !parsed.every((v) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0))
      ) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "quickTestIds must be an array of exactly 8 entries (positive integer test id or null)", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "quickTestIds must be an array of exactly 8 entries (positive integer test id or null)" });
        return;
      }
    } catch {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "quickTestIds must be valid JSON", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "quickTestIds must be valid JSON" });
      return;
    }
  } else if (typeof update.quickTestIds === "undefined") {
    // If quickTestIds is undefined (which happens when tabs send only their own fields),
    // don't validate it — let it pass through so it won't be overwritten to invalid state
  } else {
    // Gracefully handle any other type by ignoring it
    delete (update as any).quickTestIds;
  }

  if (typeof update.quickDoctorIds === "string") {
    if (update.quickDoctorIds.length > 260) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "quickDoctorIds payload too large", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "quickDoctorIds payload too large" });
      return;
    }
    try {
      const parsed = JSON.parse(update.quickDoctorIds);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 8 ||
        !parsed.every((v) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0))
      ) {
        console.warn("[PUT /api/clinic-settings] rejected 400:", "quickDoctorIds must be an array of exactly 8 entries (positive integer doctor id or null)", "| received body keys:", Object.keys(body));
        res.status(400).json({ error: "quickDoctorIds must be an array of exactly 8 entries (positive integer doctor id or null)" });
        return;
      }
    } catch {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "quickDoctorIds must be valid JSON", "| received body keys:", Object.keys(body));
      res.status(400).json({ error: "quickDoctorIds must be valid JSON" });
      return;
    }
  } else if (typeof update.quickDoctorIds === "undefined") {
    // Same grace handling as quickTestIds above — Settings tabs and the
    // Billing Desk quick-slot picker each send only their own fields.
  } else {
    delete (update as any).quickDoctorIds;
  }

  try {
    const updateResult = await db
      .update(clinicSettingsTable)
      .set(update)
      .where(eq(clinicSettingsTable.id, current.id))
      .returning();
    if (updateResult.length > 0) {
      invalidateCached(CLINIC_SETTINGS_CACHE_KEY);
      res.json(hasCommissionAccess(req)
        ? updateResult[0]
        : stripFields(updateResult[0] as unknown as Record<string, unknown>, CLINIC_COMMISSION_FIELDS));
      return;
    }
  } catch (updateErr) {
    const cause = (updateErr as any).cause;
    const causeMsg = cause ? (cause.message || String(cause)) : "";
    const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
    const finalMsg = causeMsg ? `${msg} (DB Cause: ${causeMsg})` : msg;
    res.status(500).json({ error: "Settings update failed: " + finalMsg });
    return;
  }
  // Row was missing (e.g. getOrCreate returned a fallback object with no DB row).
  // Insert a new row with current defaults merged with the update.
  try {
    const insertValues = { ...current, ...update };
    delete (insertValues as any).id; // let DB auto-generate the PK
    const [inserted] = await db
      .insert(clinicSettingsTable)
      .values(insertValues)
      .returning();
    res.json(hasCommissionAccess(req)
      ? inserted
      : stripFields(inserted as unknown as Record<string, unknown>, CLINIC_COMMISSION_FIELDS));
    invalidateCached(CLINIC_SETTINGS_CACHE_KEY);
  } catch (insertErr) {
    const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
    res.status(500).json({ error: "Settings save failed: " + msg });
  }
});

export default clinicSettingsRouter;

// ── Dedicated Local AI / Ollama settings endpoint ────────────────────────────
// POST /api/clinic-settings/ollama — save all Ollama fields atomically.
// Separate from the main PUT / so the AI settings page has its own Save button.
clinicSettingsRouter.post("/ollama", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const current = await getOrCreate();
  const update: Record<string, unknown> = { updatedAt: new Date() };

  // ollamaEnabled
  if (b.ollamaEnabled !== undefined) {
    if (typeof b.ollamaEnabled !== "boolean") { console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaEnabled must be boolean", "| received body keys:", Object.keys(b));
 res.status(400).json({ error: "ollamaEnabled must be boolean" }); return; }
    update.ollamaEnabled = b.ollamaEnabled;
  }

  // ollamaLocalOnly
  if (b.ollamaLocalOnly !== undefined) {
    if (typeof b.ollamaLocalOnly !== "boolean") { console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaLocalOnly must be boolean", "| received body keys:", Object.keys(b));
 res.status(400).json({ error: "ollamaLocalOnly must be boolean" }); return; }
    update.ollamaLocalOnly = b.ollamaLocalOnly;
  }

  // ollamaAuditEnabled
  if (b.ollamaAuditEnabled !== undefined) {
    if (typeof b.ollamaAuditEnabled !== "boolean") { console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaAuditEnabled must be boolean", "| received body keys:", Object.keys(b));
 res.status(400).json({ error: "ollamaAuditEnabled must be boolean" }); return; }
    update.ollamaAuditEnabled = b.ollamaAuditEnabled;
  }

  // ollamaTimeoutSeconds
  if (b.ollamaTimeoutSeconds !== undefined) {
    const n = Number(b.ollamaTimeoutSeconds);
    if (!Number.isInteger(n) || n < 5 || n > 300) { console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaTimeoutSeconds must be 5–300", "| received body keys:", Object.keys(b));
 res.status(400).json({ error: "ollamaTimeoutSeconds must be 5–300" }); return; }
    update.ollamaTimeoutSeconds = n;
  }

  // ollamaModel
  if (b.ollamaModel !== undefined) {
    update.ollamaModel = b.ollamaModel ? String(b.ollamaModel).trim() || null : null;
  }

  // URL validator helper
  function validateOllamaUrlSimple(raw: string): string | null {
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch { return null; }
  }

  // ollamaBaseUrl
  if (b.ollamaBaseUrl !== undefined) {
    const raw = b.ollamaBaseUrl ? String(b.ollamaBaseUrl).trim() : "";
    if (raw && !validateOllamaUrlSimple(raw)) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaBaseUrl must be a valid http/https URL", "| received body keys:", Object.keys(b));
      res.status(400).json({ error: "ollamaBaseUrl must be a valid http/https URL" }); return;
    }
    update.ollamaBaseUrl = raw || null;
  }

  // ollamaFallbackUrl (new column)
  if (b.ollamaFallbackUrl !== undefined) {
    const raw = b.ollamaFallbackUrl ? String(b.ollamaFallbackUrl).trim() : "";
    if (raw && !validateOllamaUrlSimple(raw)) {
      console.warn("[PUT /api/clinic-settings] rejected 400:", "ollamaFallbackUrl must be a valid http/https URL", "| received body keys:", Object.keys(b));
      res.status(400).json({ error: "ollamaFallbackUrl must be a valid http/https URL" }); return;
    }
    // Store in DB using raw SQL to handle column added by migration (not yet in drizzle schema deploy)
    // We do a raw update so we don't crash if the column is missing yet.
    (update as any).ollamaFallbackUrl = raw || null;
  }

  try {
    const rows = await db.update(clinicSettingsTable).set(update).where(eq(clinicSettingsTable.id, current.id)).returning();
    invalidateCached(CLINIC_SETTINGS_CACHE_KEY);
    res.json({ ok: true, settings: rows[0] ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Ollama settings save failed: " + msg });
  }
});
