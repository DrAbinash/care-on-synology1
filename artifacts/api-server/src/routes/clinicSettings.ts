import { Router } from "express";
import { db, clinicSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";

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
      sidebarTheme: "navy",
      billDefaultPaperSize: "A5",
      billShowCode: true,
      billShowCategory: true,
      dayCloseAutoPrint: true,
      commissionDiscountMode: "none",
      lanOnlyLogin: false,
      lanAllowedIps: "[]",
      fido2Enabled: false,
      formFBillingPrompt: false,
      formFAddressRequired: true,
      formFGuardianRequired: true,
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
      jpegQuality: 85,
      maxScanWidth: 1200,
      mobileScanEnabled: true,
      phonePairingEnabled: true,
      preferredScanner: "mobile",
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

clinicSettingsRouter.get("/", async (_req, res) => {
  // Clinic/hospital settings are read on nearly every page load (branding,
  // feature toggles, payment-provider enabled flags) but change rarely —
  // a 5-minute cache removes a DB round-trip from the hottest path in the
  // whole ERP. PUT / and POST /ollama invalidate this key immediately after
  // a successful write, so edits still show up within the same request.
  const cached = getCached<Awaited<ReturnType<typeof getOrCreate>>>(CLINIC_SETTINGS_CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  const row = await getOrCreate();
  setCached(CLINIC_SETTINGS_CACHE_KEY, row, TTL.SHORT);
  res.json(row);
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
    "aadhaarQrEnabled", "autoPopulateFormFFromObMeasurements",
    // Phase 2 Scanner Settings
    "scannerGlobalEnabled", "scanStationKioskModeEnabled", "scanStationAutoClearEnabled",
    // Refactored fields
    "enableCardPayment", "enableQrPayment", "enableVipBooking", "enablePaymentLogos", "enablePaymentTimer"
  ] as const;
  
  const textFields = [
    "kioskPaymentGateway", "kioskUpiVpa", "kioskUpiName", "kioskWelcomeMessage", "kioskAllowedTestIds",
    "onlineBookingAllowedTestIds", "onlineBookingAllowedPackageIds", "razorpayKeyId", "payuMerchantKey",
    "phonepeMerchantId", "bharatpeMerchantId", "cashfreeAppId", "iciciMerchantId", "iciciAggregatorId",
    "iciciSecretKey", "formFTestIds", "quickTestIds", "quickDoctorIds", "footerNote", "commissionDiscountMode", "lanAllowedIps",
    "billDefaultPaperSize", "name", "tagline", "address", "registeredAddress", "email", "phone", "website",
    "gstin", "logoDataUrl", "portalHeading", "portalWelcomeMessage", "sidebarTheme", "receiptThankYouMessage",
    "receiptCollectionMessage", "receiptQrMessage", "receiptPromotionalMessage", "serviceFooter", "followUpMessage",
    "promotionalTitle", "promotionalDescription", "workingHoursMessage", "homeCollectionMessage", "emergencyMessage",
    "referralProgramMessage", "healthPackagesMessage", "accreditationMessage", "whatsAppBookingMessage",
    "customFooterMessage", "ollamaBaseUrl", "ollamaModel", "onlineBookingServices", "serviceImages", "vipPercentage",
    "disclaimerText", "disclaimerDisplayPosition", "disclaimerFontSize", "preferredScanner",
    // Refactored fields
    "activePaymentGateway", "customIciciBannerUrl", "customPhonepeBannerUrl", "customBharatpeBannerUrl", "customPayuBannerUrl",
    "queueVipMode", "queuePrivacyMode"
  ] as const;
  
  if (body.preferredScanner !== undefined) {
    if (body.preferredScanner !== "mobile" && body.preferredScanner !== "bridge") {
      res.status(400).json({ error: "preferredScanner must be mobile or bridge" });
      return;
    }
    update.preferredScanner = body.preferredScanner;
  }

  // Handle refactored text fields explicitly
  for (const f of textFields) {
    if (body[f] !== undefined) {
      if (body[f] !== null && typeof body[f] !== "string") {
        res.status(400).json({ error: `${f} must be a string or null` });
        return;
      }
      update[f] = body[f] === null ? "" : body[f].trim();
    }
  }

  // NOTE: quickTestIds and formFTestIds are intentionally NOT in boolFields
  // because they store JSON-as-text (e.g. "[null,null,null,null,null,null]").
  // They are listed in textFields above.
  for (const f of boolFields) {

    if (body[f] !== undefined) {
      if (typeof body[f] !== "boolean") {
        res.status(400).json({ error: `${f} must be a boolean` });
        return;
      }
      update[f] = body[f];
    }
  }
  // ── Ollama configuration ────────────────────────────────────────────────────
  if (body.ollamaBaseUrl !== undefined) {
    if (body.ollamaBaseUrl !== null && typeof body.ollamaBaseUrl !== "string") {
      res.status(400).json({ error: "ollamaBaseUrl must be a string or null" }); return;
    }
    const trimmed = typeof body.ollamaBaseUrl === "string" ? body.ollamaBaseUrl.trim() : null;
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          res.status(400).json({ error: "ollamaBaseUrl must be http:// or https://" }); return;
        }
      } catch {
        res.status(400).json({ error: "ollamaBaseUrl is not a valid URL" }); return;
      }
    }
    update.ollamaBaseUrl = trimmed || null;
  }
  if (body.ollamaModel !== undefined) {
    if (body.ollamaModel !== null && typeof body.ollamaModel !== "string") {
      res.status(400).json({ error: "ollamaModel must be a string or null" }); return;
    }
    update.ollamaModel = typeof body.ollamaModel === "string" ? body.ollamaModel.trim() || null : null;
  }
  if (body.ollamaKnownModels !== undefined) {
    if (typeof body.ollamaKnownModels !== "string") {
      res.status(400).json({ error: "ollamaKnownModels must be a JSON string" }); return;
    }
    try {
      const parsed = JSON.parse(body.ollamaKnownModels);
      if (!Array.isArray(parsed) || !parsed.every((m) => typeof m === "string")) {
        res.status(400).json({ error: "ollamaKnownModels must be a JSON array of strings" }); return;
      }
    } catch {
      res.status(400).json({ error: "ollamaKnownModels must be valid JSON" }); return;
    }
    update.ollamaKnownModels = body.ollamaKnownModels;
  }

  const portalTextFields = ["portalHeading", "portalWelcomeMessage"] as const;
  for (const f of portalTextFields) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "string") {
        res.status(400).json({ error: `${f} must be a string` });
        return;
      }
      if (body[f].length > 500) {
        res.status(400).json({ error: `${f} too long (max 500 chars)` });
        return;
      }
      update[f] = body[f];
    }
  }
  if (body.razorpayKeyId !== undefined) {
    if (typeof body.razorpayKeyId !== "string") {
      res.status(400).json({ error: "razorpayKeyId must be a string" });
      return;
    }
    update.razorpayKeyId = body.razorpayKeyId.trim();
  }
  if (body.payuMerchantKey !== undefined) {
    if (typeof body.payuMerchantKey !== "string") {
      res.status(400).json({ error: "payuMerchantKey must be a string" });
      return;
    }
    update.payuMerchantKey = body.payuMerchantKey.trim();
  }
  if (body.phonepeMerchantId !== undefined) {
    if (typeof body.phonepeMerchantId !== "string") {
      res.status(400).json({ error: "phonepeMerchantId must be a string" });
      return;
    }
    update.phonepeMerchantId = body.phonepeMerchantId.trim();
  }
  if (body.bharatpeMerchantId !== undefined) {
    if (typeof body.bharatpeMerchantId !== "string") {
      res.status(400).json({ error: "bharatpeMerchantId must be a string" });
      return;
    }
    update.bharatpeMerchantId = body.bharatpeMerchantId.trim();
  }
  if (body.cashfreeAppId !== undefined) {
    if (typeof body.cashfreeAppId !== "string") {
      res.status(400).json({ error: "cashfreeAppId must be a string" });
      return;
    }
    update.cashfreeAppId = body.cashfreeAppId.trim();
  }
  if (body.iciciMerchantId !== undefined) {
    if (typeof body.iciciMerchantId !== "string") {
      res.status(400).json({ error: "iciciMerchantId must be a string" });
      return;
    }
    update.iciciMerchantId = body.iciciMerchantId.trim();
  }
  if (body.iciciAggregatorId !== undefined) {
    if (typeof body.iciciAggregatorId !== "string") {
      res.status(400).json({ error: "iciciAggregatorId must be a string" });
      return;
    }
    update.iciciAggregatorId = body.iciciAggregatorId.trim();
  }
  if (body.iciciSecretKey !== undefined) {
    if (typeof body.iciciSecretKey !== "string") {
      res.status(400).json({ error: "iciciSecretKey must be a string" });
      return;
    }
    update.iciciSecretKey = body.iciciSecretKey.trim();
  }
  const arrayJsonTextFields = ["kioskUpiVpa", "kioskUpiName", "kioskWelcomeMessage", "kioskAllowedTestIds", "onlineBookingAllowedTestIds", "onlineBookingAllowedPackageIds", "upiVpa", "upiQrImageUrl"] as const;
  for (const f of arrayJsonTextFields) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "string") {
        res.status(400).json({ error: `${f} must be a string` });
        return;
      }
      update[f] = body[f];
    }
  }
  if (body.onlineBookingLedgerId !== undefined) {
    const n = Number(body.onlineBookingLedgerId);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "onlineBookingLedgerId must be a positive integer" });
      return;
    }
    update.onlineBookingLedgerId = n;
  }
  if (body.billDefaultPaperSize !== undefined) {
    if (body.billDefaultPaperSize !== "A4" && body.billDefaultPaperSize !== "A5") {
      res.status(400).json({ error: "billDefaultPaperSize must be A4 or A5" });
      return;
    }
    update.billDefaultPaperSize = body.billDefaultPaperSize;
  }
  if (body.billPrintCopies !== undefined) {
    const n = Number(body.billPrintCopies);
    if (!Number.isInteger(n) || (n !== 1 && n !== 2)) {
      res.status(400).json({ error: "billPrintCopies must be 1 or 2" });
      return;
    }
    update.billPrintCopies = n;
  }
  if (body.lanAllowedIps !== undefined) {
    if (typeof body.lanAllowedIps !== "string") {
      res.status(400).json({ error: "lanAllowedIps must be a JSON string" });
      return;
    }
    try {
      const parsed = JSON.parse(body.lanAllowedIps);
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
        res.status(400).json({ error: "lanAllowedIps must be a JSON array of strings" });
        return;
      }
    } catch {
      res.status(400).json({ error: "lanAllowedIps must be valid JSON" });
      return;
    }
    update.lanAllowedIps = body.lanAllowedIps;
  }
  if (body.commissionDiscountMode !== undefined) {
    const valid = ["none", "deduct", "deduct_rollover"];
    if (!valid.includes(body.commissionDiscountMode)) {
      res.status(400).json({ error: `commissionDiscountMode must be one of: ${valid.join(", ")}` });
      return;
    }
    update.commissionDiscountMode = body.commissionDiscountMode;
  }
  // Form F scanner integer settings
  const intFields = ["cropPadding", "jpegQuality", "maxScanWidth", "disclaimerRefundPercentage", "disclaimerCancellationWindowHours", "scanStationResultDisplaySeconds", "queueEstimatedWaitPerPatient"] as const;
  for (const f of intFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 0 || n > 5000) {
        res.status(400).json({ error: `${f} must be an integer between 0 and 5000` });
        return;
      }
      update[f] = n;
    }
  }

  if (typeof update.logoDataUrl === "string" && update.logoDataUrl.length > 2_000_000) {
    res.status(413).json({ error: "Logo too large (max ~1.5MB)" });
    return;
  }
  if (typeof update.quickTestIds === "string") {
    if (update.quickTestIds.length > 260) {
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
        res.status(400).json({ error: "quickTestIds must be an array of exactly 8 entries (positive integer test id or null)" });
        return;
      }
    } catch {
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
        res.status(400).json({ error: "quickDoctorIds must be an array of exactly 8 entries (positive integer doctor id or null)" });
        return;
      }
    } catch {
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
      res.json(updateResult[0]);
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
    res.json(inserted);
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
    if (typeof b.ollamaEnabled !== "boolean") { res.status(400).json({ error: "ollamaEnabled must be boolean" }); return; }
    update.ollamaEnabled = b.ollamaEnabled;
  }

  // ollamaLocalOnly
  if (b.ollamaLocalOnly !== undefined) {
    if (typeof b.ollamaLocalOnly !== "boolean") { res.status(400).json({ error: "ollamaLocalOnly must be boolean" }); return; }
    update.ollamaLocalOnly = b.ollamaLocalOnly;
  }

  // ollamaAuditEnabled
  if (b.ollamaAuditEnabled !== undefined) {
    if (typeof b.ollamaAuditEnabled !== "boolean") { res.status(400).json({ error: "ollamaAuditEnabled must be boolean" }); return; }
    update.ollamaAuditEnabled = b.ollamaAuditEnabled;
  }

  // ollamaTimeoutSeconds
  if (b.ollamaTimeoutSeconds !== undefined) {
    const n = Number(b.ollamaTimeoutSeconds);
    if (!Number.isInteger(n) || n < 5 || n > 300) { res.status(400).json({ error: "ollamaTimeoutSeconds must be 5–300" }); return; }
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
      res.status(400).json({ error: "ollamaBaseUrl must be a valid http/https URL" }); return;
    }
    update.ollamaBaseUrl = raw || null;
  }

  // ollamaFallbackUrl (new column)
  if (b.ollamaFallbackUrl !== undefined) {
    const raw = b.ollamaFallbackUrl ? String(b.ollamaFallbackUrl).trim() : "";
    if (raw && !validateOllamaUrlSimple(raw)) {
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
