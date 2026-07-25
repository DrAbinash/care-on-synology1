import { pgTable, serial, text, timestamp, boolean, integer, numeric } from "drizzle-orm/pg-core";

// Built-in default appointment time slots for the online booking form. Kept as
// { value, label } pairs: `value` is stored on the booking, `label` is what the
// patient sees. Admins can override this list in Settings → Online Booking.
// Exported so the API/UI can share one source of truth for the fallback.
export const DEFAULT_BOOKING_TIME_SLOTS = [
  { value: "07:00 – 10:00", label: "Morning (7:00 – 10:00 AM)" },
  { value: "10:00 – 13:00", label: "Late Morning (10:00 AM – 1:00 PM)" },
  { value: "13:00 – 16:00", label: "Afternoon (1:00 – 4:00 PM)" },
  { value: "16:00 – 19:00", label: "Evening (4:00 – 7:00 PM)" },
  { value: "19:00 – 21:00", label: "Night (7:00 – 9:00 PM)" },
] as const;

export const DEFAULT_BOOKING_TIME_SLOTS_JSON = JSON.stringify(DEFAULT_BOOKING_TIME_SLOTS);

export const clinicSettingsTable = pgTable("clinic_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Care Diagnostics"),
  tagline: text("tagline").notNull().default("Diagnostic & Pathology Services"),
  address: text("address").notNull().default(""),
  registeredAddress: text("registered_address").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  website: text("website").notNull().default(""),
  // Nullable: NULL means "GSTIN not configured yet". The app relies on this
  // (see the GSTIN_NOT_SET placeholder cleanup at startup) so this column
  // must NOT be NOT NULL — see migrations/fix_gstin_razorpay_nullable.sql
  gstin: text("gstin"),
  logoDataUrl: text("logo_data_url"),
  footerNote: text("footer_note").notNull().default("Thank you for choosing our diagnostic services."),
  formFTestIds: text("form_f_test_ids").notNull().default("[]"),
  quickTestIds: text("quick_test_ids").notNull().default("[null,null,null,null,null,null,null,null]"),
  quickDoctorIds: text("quick_doctor_ids").notNull().default("[null,null,null,null,null,null,null,null]"),
  patientPhotoEnabled: boolean("patient_photo_enabled").notNull().default(false),
  showTatOnBill: boolean("show_tat_on_bill").notNull().default(false),
  billPrintCopies: integer("bill_print_copies").notNull().default(1),
  qrOnBillEnabled: boolean("qr_on_bill_enabled").notNull().default(true),
  portalEnabled: boolean("portal_enabled").notNull().default(false),
  portalHeading: text("portal_heading").notNull().default(""),
  portalWelcomeMessage: text("portal_welcome_message").notNull().default(""),
  portalAllowAppointmentBooking: boolean("portal_allow_appointment_booking").notNull().default(true),
  portalAllowProfileEdit: boolean("portal_allow_profile_edit").notNull().default(true),
  // Optional background image (data URL) shown behind the public portal /
  // staff login landing page. NULL means "use the default gradient".
  portalBackgroundImageDataUrl: text("portal_background_image_data_url"),
  // Online booking
  onlineBookingEnabled: boolean("online_booking_enabled").notNull().default(false),
  // Nullable: NULL means "Razorpay not configured yet" (same reasoning as gstin above).
  razorpayKeyId: text("razorpay_key_id"),
  onlineBookingLedgerId: integer("online_booking_ledger_id").notNull().default(1),
  vipQueueEnabled: boolean("vip_queue_enabled").notNull().default(false),
  // PayU India
  payuEnabled: boolean("payu_enabled").notNull().default(false),
  payuMerchantKey: text("payu_merchant_key").notNull().default(""),
  // PhonePe
  phonepeEnabled: boolean("phonepe_enabled").notNull().default(false),
  phonepeMerchantId: text("phonepe_merchant_id").notNull().default(""),
  // BharatPe
  bharatpeEnabled: boolean("bharatpe_enabled").notNull().default(false),
  bharatpeMerchantId: text("bharatpe_merchant_id").notNull().default(""),
  // Cashfree
  cashfreeEnabled: boolean("cashfree_enabled").notNull().default(false),
  cashfreeAppId: text("cashfree_app_id").notNull().default(""),
  // ICICI Orange PG
  iciciEnabled: boolean("icici_enabled").notNull().default(false),
  iciciMerchantId: text("icici_merchant_id").notNull().default(""),
  iciciAggregatorId: text("icici_aggregator_id").notNull().default(""),
  iciciSecretKey: text("icici_secret_key").notNull().default(""),
  // Self-registration kiosk
  kioskEnabled: boolean("kiosk_enabled").notNull().default(false),
  kioskPaymentGateway: text("kiosk_payment_gateway").notNull().default("upi"),
  kioskUpiVpa: text("kiosk_upi_vpa").notNull().default(""),
  kioskUpiName: text("kiosk_upi_name").notNull().default(""),
  kioskWelcomeMessage: text("kiosk_welcome_message").notNull().default(""),
  kioskAllowedTestIds: text("kiosk_allowed_test_ids").notNull().default("[]"),
  // QR payment image (UPI / BharatPe etc.)
  upiQrImageUrl: text("upi_qr_image_url").notNull().default(""),
  upiVpa: text("upi_vpa").notNull().default(""),
  upiQrEnabled: boolean("upi_qr_enabled").notNull().default(false),
  // Online booking whitelist (tests + packages)
  onlineBookingAllowedTestIds: text("online_booking_allowed_test_ids").notNull().default("[]"),
  onlineBookingAllowedPackageIds: text("online_booking_allowed_package_ids").notNull().default("[]"),
  // Hope partner booking (/book?source=hope) — a narrower selection picked from
  // the same Care catalogue, so Hope's page lists only Hope's investigations.
  // Empty "[]" = not configured, and Hope's page falls back to the global
  // online booking whitelist above.
  hopeBookingAllowedTestIds: text("hope_booking_allowed_test_ids").notNull().default("[]"),
  hopeBookingAllowedPackageIds: text("hope_booking_allowed_package_ids").notNull().default("[]"),
  // Configurable appointment time slots shown in the online booking form.
  // JSON-as-text array of { value, label } objects — admins edit these in
  // Settings so the clinic can match its actual opening hours (e.g. 9 AM–11 PM)
  // instead of the old hard-coded 7 AM–9 PM list. Empty "[]" makes the form
  // fall back to its built-in defaults.
  bookingTimeSlots: text("booking_time_slots").notNull().default(DEFAULT_BOOKING_TIME_SLOTS_JSON),
  sidebarTheme: text("sidebar_theme").notNull().default("navy"),
  billDefaultPaperSize: text("bill_default_paper_size").notNull().default("A5"),
  // Clinic-wide Billing Print settings (Settings → Billing Print) as a JSON
  // blob of Partial<BillPrintSettings> — paper size, format, layout/typography
  // overrides, print-action toggles, adminLock. "{}" = nothing configured yet
  // (each field falls back to the built-in defaults client-side). See
  // artifacts/diagnostic-erp/src/lib/billPrintSettings.ts for the shape and
  // for why this must live server-side, not in per-browser localStorage.
  billPrintSettingsJson: text("bill_print_settings_json").notNull().default("{}"),
  // Mobile-app display config (Settings → Mobile App) as a JSON blob:
  // promo banner, services grid, trust chips, tab toggles, contact overrides,
  // about text. "{}" = nothing configured (the app falls back to its built-in
  // defaults client-side). Served publicly via GET /api/public/mobile-config —
  // never put secrets in here.
  mobileAppConfigJson: text("mobile_app_config_json").notNull().default("{}"),
  billShowCode: boolean("bill_show_code").notNull().default(true),
  billShowCategory: boolean("bill_show_category").notNull().default(true),
  // When true, closing the day auto-prints the summary slip on the bill printer.
  dayCloseAutoPrint: boolean("day_close_auto_print").notNull().default(true),
  // Referral commission discount deduction mode (super-admin configurable):
  //   "none"            — discount has no effect on commission (default/legacy)
  //   "deduct"          — commission = max(0, commission - bill_discount)
  //   "deduct_rollover" — commission = commission - bill_discount (can go negative;
  //                       negative amount is deducted from doctor's overall ledger)
  commissionDiscountMode: text("commission_discount_mode").notNull().default("none"),
  // Referral commission eligibility policy (super-admin configurable) — decides
  // WHEN a calculated commission becomes payable. Until the condition is met the
  // commission is held (excluded from Doctor Due / payout totals) and released
  // automatically once it is satisfied. Cancelled bills are never payable.
  //   "bill_created"           — payable as soon as billed (legacy behaviour)
  //   "report_finalized"       — payable once the order's report(s) are verified
  //   "report_delivered"       — payable once the order's report(s) are delivered
  //   "min_amount_collected"   — payable once collected >= commissionEligibilityMinAmount
  //   "full_payment_collected" — payable once the bill is fully paid (balance 0)
  //   "collected_ge_commission"— payable once collected >= the commission amount
  // What an outsourced test's commission is calculated on.
  //   'price'  — the full patient price (historical behaviour, default)
  //   'margin' — price minus what the clinic pays the external lab, so
  //              commission can never exceed what the clinic actually earned
  commissionOutsourcedBasis: text("commission_outsourced_basis").notNull().default("price"),
  // Guard rail on the rule form: no slab (and no doctor profile default) may be
  // saved above this percentage. Nothing previously stopped a 90% rate being
  // typed into something that moves money. 0 disables the check.
  commissionMaxPercent: numeric("commission_max_percent", { precision: 5, scale: 2 }).notNull().default("60.00"),
  // Realised-vs-configured drift: how many percentage points a doctor's realised
  // rate may fall below their configured slab before the portal flags it.
  // Usually it means discounts are quietly eating that doctor's band. 0 = off.
  commissionDriftAlertPoints: numeric("commission_drift_alert_points", { precision: 5, scale: 2 }).notNull().default("10.00"),
  commissionEligibilityPolicy: text("commission_eligibility_policy").notNull().default("full_payment_collected"),
  commissionEligibilityMinAmount: numeric("commission_eligibility_min_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  // Expense approval separation-of-duties toggle. Default true (self-approval
  // allowed) matches current behaviour exactly — approvedBy has always been
  // free text set by whoever creates the expense. Admin can flip this off once
  // there is enough staff for the creator/approver split to be practical.
  expenseSelfApprovalAllowed: boolean("expense_self_approval_allowed").notNull().default(true),
  // Network access control — when enabled, non-admin staff can only log in from
  // the hospital LAN (private RFC-1918 IP ranges). Extra trusted IPs can be added
  // as a JSON array of strings in lanAllowedIps.
  lanOnlyLogin: boolean("lan_only_login").notNull().default(false),
  lanAllowedIps: text("lan_allowed_ips").notNull().default("[]"),
  // FIDO2 / WebAuthn / YubiKey optional toggle — when enabled the login UI
  // offers security-key authentication alongside PIN login.
  fido2Enabled: boolean("fido2_enabled").notNull().default(false),
  // Session idle timeout in minutes. Staff sessions are invalidated after this
  // period of inactivity. 0 = disabled (no timeout).
  sessionIdleTimeoutMinutes: integer("session_idle_timeout_minutes").notNull().default(30),
  // Default maximum concurrent sessions per user (when user.maxConcurrentSessions = 0).
  // Super-admins are exempt.
  defaultMaxConcurrentSessions: integer("default_max_concurrent_sessions").notNull().default(3),
  // Account lockout after N consecutive failed PIN attempts. 0 = disabled.
  maxFailedLoginAttempts: integer("max_failed_login_attempts").notNull().default(5),
  // How long (in minutes) an account stays locked after reaching the threshold.
  accountLockoutDurationMinutes: integer("account_lockout_duration_minutes").notNull().default(30),
  // When true, the billing desk prompts for address + husband/father name when a
  // bill contains any Form F required test (configured in the Form F tests tab).
  formFBillingPrompt: boolean("form_f_billing_prompt").notNull().default(false),
  // When true, address is required in the Form F billing desk popup and form.
  formFAddressRequired: boolean("form_f_address_required").notNull().default(true),
  // When true, husband/father name is required in the Form F billing desk popup and form.
  formFGuardianRequired: boolean("form_f_guardian_required").notNull().default(true),
  // When true (default — matches existing behavior), phone number is a required
  // field on the Patients page's Add/Edit Patient forms. When false, staff can
  // register patients there without a phone number. Kiosk and online-booking
  // self-registration ALWAYS require a phone regardless of this setting —
  // patients registering themselves must be reachable.
  patientPhoneRequired: boolean("patient_phone_required").notNull().default(true),

  // ── V3: Receipt Message Management ──
  receiptThankYouMessage: text("receipt_thank_you_message").notNull().default("Thank you for choosing Care Diagnostics."),
  receiptCollectionMessage: text("receipt_collection_message").notNull().default("Please collect your reports within 7 days."),
  receiptQrMessage: text("receipt_qr_message").notNull().default("Scan QR code to verify receipt and download reports."),
  receiptPromotionalMessage: text("receipt_promotional_message").notNull().default("Advanced Diagnostic & Imaging Centre."),

  // ── V3: Service Footer Management ──
  serviceFooter: text("service_footer").notNull().default("[\"MRI\",\"CT Scan\",\"Ultrasound\",\"Digital X-Ray\",\"Mammography\",\"Pathology\"]"),

  // ── V3: Follow-up / Retention ──
  showFollowUpMessage: boolean("show_follow_up_message").notNull().default(false),
  followUpMessage: text("follow_up_message").notNull().default("For future investigations, please quote your Patient ID."),

  // ── V3: Promotional Footer ──
  showPromotionalFooter: boolean("show_promotional_footer").notNull().default(false),
  promotionalTitle: text("promotional_title").notNull().default(""),
  promotionalDescription: text("promotional_description").notNull().default(""),

  // ── V3: Patient Identity & Security ──
  showPatientSince: boolean("show_patient_since").notNull().default(false),
  showVerifiedBadge: boolean("show_verified_badge").notNull().default(false),

  // ── V3: Print audit settings ──
  showAuditInfoOnPatientCopy: boolean("show_audit_info_on_patient_copy").notNull().default(false),

  // ── V3: Additional footer messages ──
  showWorkingHours: boolean("show_working_hours").notNull().default(false),
  workingHoursMessage: text("working_hours_message").notNull().default("Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM"),
  showHomeCollection: boolean("show_home_collection").notNull().default(false),
  homeCollectionMessage: text("home_collection_message").notNull().default("Home Collection Available. Call us to book."),
  showEmergency: boolean("show_emergency").notNull().default(false),
  emergencyMessage: text("emergency_message").notNull().default("24x7 Emergency Services Available"),
  showReferralProgram: boolean("show_referral_program").notNull().default(false),
  referralProgramMessage: text("referral_program_message").notNull().default("Refer a friend and get 10% off your next visit."),
  showHealthPackages: boolean("show_health_packages").notNull().default(false),
  healthPackagesMessage: text("health_packages_message").notNull().default("Annual Health Checkup packages available at discounted rates."),
  showAccreditation: boolean("show_accreditation").notNull().default(false),
  accreditationMessage: text("accreditation_message").notNull().default("NABL Accredited / ISO 9001:2015 Certified"),
  showWhatsAppBooking: boolean("show_whatsapp_booking").notNull().default(false),
  whatsAppBookingMessage: text("whatsapp_booking_message").notNull().default("Book appointments on WhatsApp: +91"),
  showCustomFooterMessage: boolean("show_custom_footer_message").notNull().default(false),
  customFooterMessage: text("custom_footer_message").notNull().default(""),

  // ── Form F Scanner Settings ──
  autoCropIdScan: boolean("auto_crop_id_scan").notNull().default(true),
  autoRotateScan: boolean("auto_rotate_scan").notNull().default(false),
  archiveImportedScans: boolean("archive_imported_scans").notNull().default(true),
  cropPadding: integer("crop_padding").notNull().default(12),
  jpegQuality: integer("jpeg_quality").notNull().default(85),
  maxScanWidth: integer("max_scan_width").notNull().default(1200),

  // ── Ollama Local Models (Phase 10C / 11) ──
  // Primary endpoint — set to Windows PC primary LAN IP: http://192.168.1.250:11434
  ollamaBaseUrl: text("ollama_base_url"),
  // Fallback endpoint — set to Windows PC secondary LAN IP: http://172.16.1.140:11434
  // The backend probes primary first, switches to fallback if primary times out.
  ollamaFallbackUrl: text("ollama_fallback_url"),
  ollamaModel: text("ollama_model"),
  ollamaLocalOnly: boolean("ollama_local_only").notNull().default(false),
  // Master toggle — when false ALL Ollama endpoints return 503 without calling Ollama.
  ollamaEnabled: boolean("ollama_enabled").notNull().default(false),
  // Request timeout in seconds for individual Ollama calls (default 30s).
  ollamaTimeoutSeconds: integer("ollama_timeout_seconds").notNull().default(30),
  // When true, all AI assistant actions are logged to radiology_ai_review_audits.
  ollamaAuditEnabled: boolean("ollama_audit_enabled").notNull().default(true),
  // Cached list of models pulled on the Ollama instance — synced server-side
  // so every clinic workstation shows the dropdown without needing to "Test Connection".
  ollamaKnownModels: text("ollama_known_models").notNull().default("[]"),

  // Online booking granular settings (Phase 4)
  onlineBookingServices: text("online_booking_services").notNull().default("{\"opd\":true,\"emergency\":true,\"usg\":true,\"xray\":true,\"ct\":true,\"mri\":true,\"pathology\":true,\"packages\":true,\"home_collection\":true,\"doctor\":true}"),
  
  // Photo tile settings (Phase 5)
  serviceImages: text("service_images").notNull().default("{}"),
  serviceImagesEnabled: boolean("service_images_enabled").notNull().default(false),

  // Quick Select Tests background images (/book page, step 2) — JSON string
  // map of test category (biochemistry, cardiology, radiology, pathology,
  // hematology, endocrinology, serology, default) to an uploaded image URL.
  // Categories left unset keep the existing solid-gradient tile look.
  quickTestCategoryImages: text("quick_test_category_images").notNull().default("{}"),
  // 0-100, how much the white overlay washes out the tile photo so the test
  // name stays readable — same idea as bookHeroOverlayOpacity.
  quickTestOverlayOpacity: integer("quick_test_overlay_opacity").notNull().default(35),

  // VIP settings (Phase 6)
  vipPercentage: numeric("vip_percentage", { precision: 5, scale: 2 }).notNull().default("50.00"),

  // Disclaimer settings (Phase 7)
  disclaimerText: text("disclaimer_text").notNull().default("Online booking charges are subject to the centre's cancellation policy. In case of cancellation after confirmation, administrative charges may be deducted from the refundable amount."),
  disclaimerRefundPercentage: integer("disclaimer_refund_percentage").notNull().default(90),
  disclaimerCancellationWindowHours: integer("disclaimer_cancellation_window_hours").notNull().default(24),
  disclaimerDisplayPosition: text("disclaimer_display_position").notNull().default("bottom"),
  disclaimerFontSize: text("disclaimer_font_size").notNull().default("sm"),
  disclaimerEnabled: boolean("disclaimer_enabled").notNull().default(true),

  // Wireless scanning + pairing configurations
  mobileScanEnabled: boolean("mobile_scan_enabled").notNull().default(true),
  phonePairingEnabled: boolean("phone_pairing_enabled").notNull().default(true),
  preferredScanner: text("preferred_scanner").notNull().default("mobile"), // mobile | bridge
  requireDesktopConfirmation: boolean("require_desktop_confirmation").notNull().default(true),
  autoDeleteTempScans: boolean("auto_delete_temp_scans").notNull().default(true),
  ocrEnabled: boolean("ocr_enabled").notNull().default(true),
  aadhaarQrEnabled: boolean("aadhaar_qr_enabled").notNull().default(true),

  // Phase 2 Enhanced Scanner Settings
  scannerGlobalEnabled: boolean("scanner_global_enabled").notNull().default(false),
  scanStationKioskModeEnabled: boolean("scan_station_kiosk_mode_enabled").notNull().default(true),
  scanStationAutoClearEnabled: boolean("scan_station_auto_clear_enabled").notNull().default(true),
  scanStationResultDisplaySeconds: integer("scan_station_result_display_seconds").notNull().default(10),

  // Refactored Payment Gateway Settings
  activePaymentGateway: text("active_payment_gateway").notNull().default("icici"),
  enableCardPayment: boolean("enable_card_payment").notNull().default(true),
  enableQrPayment: boolean("enable_qr_payment").notNull().default(true),
  enableVipBooking: boolean("enable_vip_booking").notNull().default(true),
  enablePaymentLogos: boolean("enable_payment_logos").notNull().default(true),
  enablePaymentTimer: boolean("enable_payment_timer").notNull().default(true),
  customIciciBannerUrl: text("custom_icici_banner_url").notNull().default(""),
  customPhonepeBannerUrl: text("custom_phonepe_banner_url").notNull().default(""),
  customBharatpeBannerUrl: text("custom_bharatpe_banner_url").notNull().default(""),
  customPayuBannerUrl: text("custom_payu_banner_url").notNull().default(""),
  autoPopulateFormFFromObMeasurements: boolean("auto_populate_form_f_from_ob_measurements").notNull().default(false),

  // Queue & VIP Settings
  queueVipMode: text("queue_vip_mode").notNull().default("highlighted"),
  queuePrivacyMode: text("queue_privacy_mode").notNull().default("masked"),
  queueEstimatedWaitPerPatient: integer("queue_estimated_wait_per_patient").notNull().default(15),

  // Scanner overhaul: retention period (days) for unlinked/temp scanned_documents rows.
  scanRetentionDays: integer("scan_retention_days").notNull().default(30),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

