import { pgTable, serial, text, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";

export const onlineBookingsTable = pgTable("online_bookings", {
  id: serial("id").primaryKey(),
  bookingRef: text("booking_ref").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull().default(""),
  selectedDate: text("selected_date").notNull(),
  timeSlot: text("time_slot").notNull().default(""),
  testIds: text("test_ids").notNull().default("[]"),
  packageIds: text("package_ids").notNull().default("[]"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes").notNull().default(""),
  isVip: boolean("is_vip").notNull().default(false),
  ageValue: integer("age_value"),
  ageUnit: text("age_unit"),
  gender: text("gender"),
  // Referring doctor selected in the booking form (mirrors the Billing Desk
  // referring-doctor picker). Nullable: a self/walk-in booking has none. On
  // confirmation the id is copied onto the created order's doctor_id so the
  // referral is tracked exactly like an over-the-counter bill. The name is
  // captured too so it survives even if the doctor record is later removed.
  referringDoctorId: integer("referring_doctor_id"),
  referringDoctorName: text("referring_doctor_name"),
  // Channel that created the booking. website/kiosk are public; reception/phone
  // are staff-created from the Online Bookings page. Default keeps existing
  // rows classified as website.
  source: text("source").notNull().default("website"),
  // Optional modality key for a capacity-scoped slot (e.g. "mri"). Empty
  // string = general slot. Combined with time_slot for occupancy.
  slotModality: text("slot_modality").notNull().default(""),
  // Set when an admin overrides a full slot. Null when capacity was available.
  capacityOverrideReason: text("capacity_override_reason"),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  razorpaySignature: text("razorpay_signature"),
  payuTxnId: text("payu_txn_id"),
  payuPaymentId: text("payu_payment_id"),
  phonepeTransactionId: text("phonepe_transaction_id"),
  phonepeProviderRefId: text("phonepe_provider_ref_id"),
  bharatpeTransactionId: text("bharatpe_transaction_id"),
  bharatpeProviderRefId: text("bharatpe_provider_ref_id"),
  iciciTransactionId: text("icici_transaction_id"),
  iciciProviderRefId: text("icici_provider_ref_id"),
  status: text("status").notNull().default("pending_payment"),
  failureReason: text("failure_reason"),
  patientId: integer("patient_id"),
  billId: integer("bill_id"),
  confirmedByName: text("confirmed_by_name"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type OnlineBooking = typeof onlineBookingsTable.$inferSelect;
