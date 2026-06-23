CREATE TABLE "patient_counter" (
	"id" serial PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" text NOT NULL,
	"gender" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"blood_group" text,
	"photo_data_url" text,
	"ledger_id" integer,
	"portal_pin_hash" text,
	"age_value" integer,
	"age_unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"specialization" text NOT NULL,
	"phone" text,
	"email" text,
	"hospital_affiliation" text,
	"registration_number" text,
	"default_commission_type" text DEFAULT 'percentage' NOT NULL,
	"default_commission" numeric(10, 2) DEFAULT '0' NOT NULL,
	"ledger_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"duration" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"department" text DEFAULT 'Pathology' NOT NULL,
	"room_number" text DEFAULT '' NOT NULL,
	"test_type" text DEFAULT 'inhouse' NOT NULL,
	"outsourced_lab_id" integer,
	"room_id" integer,
	"modality_id" integer,
	"floor_label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_tests_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "test_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "order_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"test_id" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"result" text,
	"result_status" text,
	"status" text DEFAULT 'active' NOT NULL,
	"cancelled_by_name" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"ledger_id" integer,
	"collected_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_number" text NOT NULL,
	"order_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"subtotal" numeric(10, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"discount_reason" text,
	"discount_reason_note" text,
	"tax_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"balance_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ledger_id" integer,
	"due_date" text,
	"created_by_name" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_name" text,
	"cancellation_reason" text,
	"refund_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_bill_number_unique" UNIQUE("bill_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"method" text NOT NULL,
	"reference_number" text,
	"notes" text,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"pincode" text,
	"gstin" text,
	"payment_terms" text,
	"category" text,
	"opening_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "inventory_consumption_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"category" text DEFAULT 'consumable' NOT NULL,
	"current_stock" numeric(10, 2) DEFAULT '0' NOT NULL,
	"min_stock" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"preferred_vendor_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"stock_before" numeric(10, 2) NOT NULL,
	"stock_after" numeric(10, 2) NOT NULL,
	"reason" text,
	"reference" text,
	"performed_by" text,
	"vendor_id" integer,
	"invoice_number" text,
	"invoice_date" date,
	"unit_cost" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"code" text,
	"bank_name" text,
	"account_number" text,
	"ifsc_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"tally_group" text,
	"opening_balance" numeric(14, 2) DEFAULT '0',
	"opening_balance_type" text DEFAULT 'Dr',
	"gst_applicable" boolean DEFAULT false,
	"gst_number" text,
	"pan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "voucher_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"voucher_number" text NOT NULL,
	"edited_by" text NOT NULL,
	"reason" text NOT NULL,
	"change_type" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_number" text NOT NULL,
	"type" text NOT NULL,
	"date" text NOT NULL,
	"credit_account_id" text NOT NULL,
	"debit_account_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"particular" text NOT NULL,
	"remark" text,
	"performed_by" text,
	"reference" text,
	"narration" text,
	"bill_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_voucher_number_unique" UNIQUE("voucher_number")
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'percentage' NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"categories" text,
	"test_ids" text,
	"is_exclusive" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"edited_by" text NOT NULL,
	"reason" text NOT NULL,
	"change_type" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "super_admin_sessions" (
	"token" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"username" text,
	"role" text DEFAULT 'receptionist' NOT NULL,
	"permissions" text,
	"pin" text,
	"photo_data_url" text,
	"sidebar_theme" text,
	"dicom_presets" jsonb,
	"must_change_pin" boolean DEFAULT false NOT NULL,
	"remote_login_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"max_discount" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_name" text,
	"transports" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"smtp_host" text DEFAULT '' NOT NULL,
	"smtp_port" text DEFAULT '587' NOT NULL,
	"smtp_user" text DEFAULT '' NOT NULL,
	"smtp_password" text DEFAULT '' NOT NULL,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"from_address" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT 'DiagnoCenter ERP' NOT NULL,
	"admin_email" text DEFAULT '' NOT NULL,
	"extra_recipients" text DEFAULT '[]' NOT NULL,
	"bill_edit_enabled" boolean DEFAULT true NOT NULL,
	"daily_summary_enabled" boolean DEFAULT true NOT NULL,
	"daily_summary_time" text DEFAULT '17:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'percentage' NOT NULL,
	"value" numeric(10, 2) DEFAULT '0' NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"categories" text DEFAULT '[]' NOT NULL,
	"test_ids" text DEFAULT '[]' NOT NULL,
	"expires_at" text,
	"reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conditions" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_counter" (
	"id" serial PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer,
	"package_id" integer,
	"appointment_date" text NOT NULL,
	"time_slot" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"type" text DEFAULT 'walk-in' NOT NULL,
	"notes" text,
	"ledger_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "package_counter" (
	"id" serial PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" integer NOT NULL,
	"test_id" integer NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_package_code_unique" UNIQUE("package_code")
);
--> statement-breakpoint
CREATE TABLE "expense_counter" (
	"id" serial PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"expense_date" text NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"paid_to" text,
	"voucher_id" integer,
	"approved_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_expense_id_unique" UNIQUE("expense_id")
);
--> statement-breakpoint
CREATE TABLE "discount_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_reasons_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'DiagnoCenter' NOT NULL,
	"tagline" text DEFAULT 'Diagnostic & Pathology Services' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"logo_data_url" text,
	"footer_note" text DEFAULT 'Thank you for choosing our diagnostic services.' NOT NULL,
	"form_f_test_ids" text DEFAULT '[]' NOT NULL,
	"quick_test_ids" text DEFAULT '[null,null,null,null,null,null]' NOT NULL,
	"patient_photo_enabled" boolean DEFAULT false NOT NULL,
	"show_tat_on_bill" boolean DEFAULT false NOT NULL,
	"bill_print_copies" integer DEFAULT 1 NOT NULL,
	"qr_on_bill_enabled" boolean DEFAULT true NOT NULL,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"portal_heading" text DEFAULT '' NOT NULL,
	"portal_welcome_message" text DEFAULT '' NOT NULL,
	"portal_allow_appointment_booking" boolean DEFAULT true NOT NULL,
	"portal_allow_profile_edit" boolean DEFAULT true NOT NULL,
	"online_booking_enabled" boolean DEFAULT false NOT NULL,
	"razorpay_key_id" text DEFAULT '' NOT NULL,
	"online_booking_ledger_id" integer DEFAULT 1 NOT NULL,
	"vip_queue_enabled" boolean DEFAULT false NOT NULL,
	"payu_enabled" boolean DEFAULT false NOT NULL,
	"payu_merchant_key" text DEFAULT '' NOT NULL,
	"kiosk_enabled" boolean DEFAULT false NOT NULL,
	"kiosk_upi_vpa" text DEFAULT '' NOT NULL,
	"kiosk_upi_name" text DEFAULT '' NOT NULL,
	"kiosk_welcome_message" text DEFAULT '' NOT NULL,
	"kiosk_allowed_test_ids" text DEFAULT '[]' NOT NULL,
	"sidebar_theme" text DEFAULT 'navy' NOT NULL,
	"bill_default_paper_size" text DEFAULT 'A5' NOT NULL,
	"bill_show_code" boolean DEFAULT true NOT NULL,
	"bill_show_category" boolean DEFAULT true NOT NULL,
	"day_close_auto_print" boolean DEFAULT true NOT NULL,
	"commission_discount_mode" text DEFAULT 'none' NOT NULL,
	"lan_only_login" boolean DEFAULT false NOT NULL,
	"lan_allowed_ips" text DEFAULT '[]' NOT NULL,
	"fido2_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledgers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_walk_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledgers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"ledger_id" integer,
	"bill_id" integer,
	"patient_id" integer,
	"token_no" integer NOT NULL,
	"token_date" date NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'walkin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"phone_number_id" text DEFAULT '' NOT NULL,
	"access_token" text DEFAULT '' NOT NULL,
	"template_name" text DEFAULT '' NOT NULL,
	"template_lang" text DEFAULT 'en' NOT NULL,
	"default_country_code" text DEFAULT '91' NOT NULL,
	"auto_send_on_verify" boolean DEFAULT false NOT NULL,
	"report_message_template" text DEFAULT '' NOT NULL,
	"include_viewer_link" boolean DEFAULT true NOT NULL,
	"waba_id" text DEFAULT '' NOT NULL,
	"webhook_verify_token" text DEFAULT '' NOT NULL,
	"ai_assistant_enabled" boolean DEFAULT false NOT NULL,
	"ai_assistant_name" text DEFAULT 'DiagnoCenter Assistant' NOT NULL,
	"ai_system_prompt" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printer_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_printer" text DEFAULT '' NOT NULL,
	"bill_printer_type" text DEFAULT 'color' NOT NULL,
	"barcode_printer" text DEFAULT '' NOT NULL,
	"token_printer" text DEFAULT '' NOT NULL,
	"token_printer_type" text DEFAULT 'color' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_fingerprint_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" integer NOT NULL,
	"vendor" text DEFAULT 'generic' NOT NULL,
	"finger_name" text,
	"template" text NOT NULL,
	"quality" integer,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hr_rejoining_form_counter" (
	"id" serial PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_rejoining_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"form_number" text NOT NULL,
	"photo_data_url" text,
	"photo_storage_key" text,
	"employee_name" text NOT NULL,
	"father_spouse_name" text,
	"date_of_birth" date,
	"gender" text,
	"blood_group" text,
	"qualification" text,
	"aadhaar_number" text,
	"pan_number" text,
	"address" text,
	"mobile" text,
	"alternate_mobile" text,
	"email" text,
	"designation" text,
	"department" text,
	"joining_date" date,
	"rejoining_date" date,
	"family_details" jsonb,
	"emergency_contact_name" text,
	"emergency_contact_relation" text,
	"emergency_contact_phone" text,
	"bank_account_holder" text,
	"bank_name" text,
	"bank_account_number" text,
	"bank_ifsc" text,
	"bank_branch" text,
	"salary_structure" jsonb,
	"fixed_salary" numeric(10, 2) DEFAULT '0' NOT NULL,
	"incentive_acknowledged" boolean DEFAULT false NOT NULL,
	"deduction_acknowledged" boolean DEFAULT false NOT NULL,
	"shift_type" text,
	"reporting_time" text,
	"duty_hours" text,
	"confidentiality_acknowledged" boolean DEFAULT false NOT NULL,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"notice_policy_acknowledged" boolean DEFAULT false NOT NULL,
	"document_checklist" jsonb,
	"employee_declaration_date" date,
	"employee_signature_data_url" text,
	"remarks" text,
	"management_status" text DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" integer,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_rejoining_forms_form_number_unique" UNIQUE("form_number")
);
--> statement-breakpoint
CREATE TABLE "staff_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"advance_date" date NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"reason" text,
	"recovered_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'outstanding' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"attendance_date" date NOT NULL,
	"punch_in" timestamp with time zone,
	"punch_out" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_biometric_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text,
	"device_name" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "staff_biometric_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "staff_counter" (
	"id" serial PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_salary_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"month_year" text NOT NULL,
	"base_amount" numeric(10, 2) NOT NULL,
	"bonus" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(10, 2) DEFAULT '0' NOT NULL,
	"advance_deducted" numeric(10, 2) DEFAULT '0' NOT NULL,
	"days_present" integer DEFAULT 0 NOT NULL,
	"days_absent" integer DEFAULT 0 NOT NULL,
	"net_amount" numeric(10, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" text NOT NULL,
	"department" text,
	"joining_date" date,
	"base_salary" numeric(10, 2) DEFAULT '0' NOT NULL,
	"address" text,
	"emergency_contact" text,
	"bank_account" text,
	"ifsc" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_staff_id_unique" UNIQUE("staff_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"login_method" text DEFAULT 'fingerprint' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"name" text NOT NULL,
	"format" text DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"tags" text,
	"modality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abnormal_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer,
	"modality" text,
	"category" text,
	"keyword" text NOT NULL,
	"aliases" text,
	"description" text NOT NULL,
	"severity" text DEFAULT 'moderate' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_f_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer,
	"patient_id" integer,
	"bill_number" text,
	"centre_name" text DEFAULT '' NOT NULL,
	"registration_no" text DEFAULT '' NOT NULL,
	"patient_name" text DEFAULT '' NOT NULL,
	"age" text DEFAULT '' NOT NULL,
	"children_details" text DEFAULT '' NOT NULL,
	"husband_father_name" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"mobile" text DEFAULT '' NOT NULL,
	"referred_by" text DEFAULT 'Self' NOT NULL,
	"lmp_weeks" text DEFAULT '' NOT NULL,
	"genetic_history" text DEFAULT '' NOT NULL,
	"basis_diagnosis" text DEFAULT '' NOT NULL,
	"previous_child_issue" text DEFAULT '' NOT NULL,
	"indication_other" text DEFAULT '' NOT NULL,
	"doctor_name" text DEFAULT '' NOT NULL,
	"procedure" text DEFAULT '' NOT NULL,
	"procedure_purpose" text DEFAULT '' NOT NULL,
	"invasive_procedure" text DEFAULT '' NOT NULL,
	"complication" text DEFAULT '' NOT NULL,
	"lab_tests" text DEFAULT '' NOT NULL,
	"prenatal_result" text DEFAULT '' NOT NULL,
	"ultrasound_result" text DEFAULT '' NOT NULL,
	"abnormality" text DEFAULT '' NOT NULL,
	"procedure_date" text DEFAULT '' NOT NULL,
	"consent_date" text DEFAULT '' NOT NULL,
	"result_conveyed" text DEFAULT '' NOT NULL,
	"mtp_advised" text DEFAULT '' NOT NULL,
	"mtp_date" text DEFAULT '' NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"scope" text NOT NULL,
	"subject_id" integer NOT NULL,
	"subject_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dicom_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"ae_title" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 104 NOT NULL,
	"modality" text DEFAULT 'OT' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"auto_pull" boolean DEFAULT false NOT NULL,
	"pull_interval_minutes" integer DEFAULT 15 NOT NULL,
	"pull_query_days" integer DEFAULT 1 NOT NULL,
	"conquest_ae_title" text DEFAULT '' NOT NULL,
	"conquest_host" text DEFAULT '' NOT NULL,
	"conquest_port" integer DEFAULT 5678 NOT NULL,
	"last_pull_at" timestamp with time zone,
	"last_pull_status" text,
	"last_pull_message" text,
	"last_test_at" timestamp with time zone,
	"last_test_status" text,
	"last_test_message" text,
	"last_test_latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dicom_nodes_ae_title_unique" UNIQUE("ae_title")
);
--> statement-breakpoint
CREATE TABLE "dicom_pull_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"query_date_from" text NOT NULL,
	"query_date_to" text NOT NULL,
	"studies_found" integer,
	"studies_pulled" integer,
	"studies_failed" integer,
	"study_instance_uids" text,
	"error_message" text,
	"agent_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample_test_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sample_id" integer NOT NULL,
	"order_test_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"barcode" text NOT NULL,
	"order_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"sample_type" text DEFAULT 'Blood' NOT NULL,
	"container_type" text DEFAULT 'Plain' NOT NULL,
	"volume" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'collected' NOT NULL,
	"collected_by_name" text DEFAULT '' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collection_site" text DEFAULT 'Center' NOT NULL,
	"received_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"is_outsourced" boolean DEFAULT false NOT NULL,
	"outsource_lab" text,
	"outsource_sent_at" timestamp with time zone,
	"outsource_expected_at" text,
	"outsource_received_at" timestamp with time zone,
	"outsource_tracking_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "samples_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "test_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"ledger_id" integer,
	"bill_id" integer,
	"order_id" integer,
	"order_test_id" integer,
	"test_id" integer,
	"patient_id" integer,
	"department" text DEFAULT 'Pathology' NOT NULL,
	"room_number" text DEFAULT '' NOT NULL,
	"token_no" integer NOT NULL,
	"token_date" date NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'walkin' NOT NULL,
	"called_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"closure_date" date NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_user_id" integer,
	"closed_by_name" text DEFAULT '' NOT NULL,
	"covered_from_ts" timestamp with time zone,
	"covered_to_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_upi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_card" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_cheque" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_upi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_card" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_cheque" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_note" text DEFAULT '' NOT NULL,
	"bills_count" integer DEFAULT 0 NOT NULL,
	"payments_count" integer DEFAULT 0 NOT NULL,
	"total_expected" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_actual" numeric(12, 2) DEFAULT '0' NOT NULL,
	"staff_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'closed' NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" integer,
	"reopened_by_name" text DEFAULT '' NOT NULL,
	"reopen_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_routing_optimization_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text,
	"source_ae_title" text,
	"target_ae_title" text,
	"routing_decision" text NOT NULL,
	"reason" text,
	"load_factor" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiologist_assignment_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"modality" text NOT NULL,
	"body_part" text,
	"subspecialty" text,
	"shift_start" text,
	"shift_end" text,
	"primary_radiologist_id" integer NOT NULL,
	"backup_radiologist_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiologist_subspecialties" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"subspecialty" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiologist_workloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"assigned_count" integer DEFAULT 0 NOT NULL,
	"in_progress_count" integer DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"today_reported_count" integer DEFAULT 0 NOT NULL,
	"last_assigned_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiologist_workloads_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "radiology_ai_enhancements" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"findings_json" text,
	"impression_draft" text,
	"measurement_extracts_json" text,
	"ai_model" text,
	"ai_version" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_critical_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"finding" text NOT NULL,
	"severity" text NOT NULL,
	"category" text,
	"notified_clinician" text,
	"notified_at" timestamp with time zone,
	"notification_method" text,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_dicom_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"measurement_type" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"reference_range" text,
	"dicom_tag" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_film_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"issue_type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"issued_by" text,
	"received_by" text,
	"notes" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_multi_site_worklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"study_id" integer NOT NULL,
	"external_accession_number" text,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_priority_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"body_part_pattern" text,
	"study_desc_pattern" text,
	"modality_list" text,
	"referring_doctor_pattern" text,
	"keywords" text,
	"location_pattern" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"test_name" text,
	"modality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_report_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"status" text DEFAULT 'pending_prelim' NOT NULL,
	"prelim_by" integer,
	"prelim_at" timestamp with time zone,
	"peer_reviewer_id" integer,
	"peer_reviewed_at" timestamp with time zone,
	"peer_review_notes" text,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"final_by" integer,
	"final_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_structured_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text NOT NULL,
	"body_part" text,
	"description" text,
	"template" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"accession_number" text NOT NULL,
	"bill_id" integer,
	"order_id" integer,
	"order_test_id" integer,
	"patient_id" integer NOT NULL,
	"test_id" integer NOT NULL,
	"modality" text DEFAULT 'OT' NOT NULL,
	"department" text DEFAULT 'X-Ray' NOT NULL,
	"room_number" text DEFAULT '' NOT NULL,
	"technician_id" integer,
	"technician_name" text,
	"assigned_radiologist_id" integer,
	"assigned_radiologist_name" text,
	"claimed_at" timestamp with time zone,
	"clinical_history" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"acquired_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"num_images" integer DEFAULT 0 NOT NULL,
	"study_instance_uid" text,
	"notes" text,
	"body_part" text,
	"study_description" text,
	"scheduled_station_ae_title" text,
	"referring_doctor" text,
	"prelim_report" text,
	"prelim_reported_by" text,
	"prelim_reported_at" timestamp with time zone,
	"final_report" text,
	"final_reported_by" text,
	"final_reported_at" timestamp with time zone,
	"template_id" integer,
	"study_date" date DEFAULT now() NOT NULL,
	"priority" text DEFAULT 'routine' NOT NULL,
	"priority_reason" text,
	"priority_overridden_at" timestamp with time zone,
	"priority_overridden_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_tat_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"priority" text DEFAULT 'routine' NOT NULL,
	"study_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prelim_completed_at" timestamp with time zone,
	"final_completed_at" timestamp with time zone,
	"prelim_minutes" integer,
	"final_minutes" integer,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"sla_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiology_tat_tracking_study_id_unique" UNIQUE("study_id")
);
--> statement-breakpoint
CREATE TABLE "teleradiology_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"pacs_url" text,
	"ae_title" text,
	"modality_list" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"timezone_offset" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teleradiology_sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "radiology_share_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"study_id" integer NOT NULL,
	"audience" text DEFAULT 'patient' NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'Doctor' NOT NULL,
	"qualification" text DEFAULT '' NOT NULL,
	"registration_no" text DEFAULT '' NOT NULL,
	"image_data_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_number" text NOT NULL,
	"type" text DEFAULT 'pathology' NOT NULL,
	"patient_id" integer NOT NULL,
	"test_id" integer NOT NULL,
	"order_test_id" integer,
	"order_id" integer,
	"bill_id" integer,
	"study_id" integer,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"parameters" text,
	"impression" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"critical_note" text,
	"critical_acknowledged_at" timestamp with time zone,
	"critical_acknowledged_by" text,
	"signature_id" integer,
	"signed_by_name" text,
	"signed_at" timestamp with time zone,
	"verified_by_signature_id" integer,
	"verified_by_name" text,
	"verified_at" timestamp with time zone,
	"verifier_notes" text,
	"delivered_at" timestamp with time zone,
	"template_id" integer,
	"public_token" text,
	"public_token_expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"channel" text NOT NULL,
	"recipient" text,
	"shared_by" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_date" text NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"period_from" text,
	"period_to" text,
	"notes" text,
	"voucher_id" integer,
	"performed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_amc_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"machine_id" integer NOT NULL,
	"contract_type" text DEFAULT 'AMC' NOT NULL,
	"vendor" text NOT NULL,
	"contract_number" text,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"contact_person" text,
	"contact_phone" text,
	"contact_email" text,
	"coverage" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_breakdowns" (
	"id" serial PRIMARY KEY NOT NULL,
	"machine_id" integer NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_by" text,
	"description" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"downtime_hours" numeric(8, 2),
	"repair_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"service_vendor" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_service_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"machine_id" integer NOT NULL,
	"service_date" text NOT NULL,
	"service_type" text DEFAULT 'preventive' NOT NULL,
	"engineer" text,
	"vendor" text,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"parts_replaced" text,
	"notes" text,
	"next_due_date" text,
	"certificate_number" text,
	"certificate_url" text,
	"performed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"model_number" text,
	"serial_number" text,
	"manufacturer" text,
	"department" text DEFAULT '' NOT NULL,
	"location" text,
	"purchase_date" text,
	"purchase_cost" numeric(14, 2),
	"warranty_end" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"head_of_department" text,
	"contact_phone" text,
	"contact_email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"pincode" text,
	"phone" text,
	"email" text,
	"gstin" text,
	"manager" text,
	"is_main" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "backup_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"backup_type" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"format" text DEFAULT 'json' NOT NULL,
	"row_count" integer,
	"size_bytes" bigint,
	"error_message" text,
	"performed_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"size_bytes" bigint,
	"row_count" integer,
	"file_path" text,
	"error_message" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"backup_type" text NOT NULL,
	"destination_type" text NOT NULL,
	"destination_path" text,
	"schedule" text DEFAULT 'MANUAL' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"completed_by" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"anomaly_count" integer DEFAULT 0 NOT NULL,
	"high_count" integer DEFAULT 0 NOT NULL,
	"total_impact" numeric(14, 2) DEFAULT '0' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"email_sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_title" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"whatsapp_number" text DEFAULT '' NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_greeting" text DEFAULT 'Hi! I''d like to book an appointment.' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"favicon_url" text DEFAULT '' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"theme_id" text DEFAULT 'modern-clinical' NOT NULL,
	"primary_color" text DEFAULT '#7c3aed' NOT NULL,
	"secondary_color" text DEFAULT '#06b6d4' NOT NULL,
	"accent_color" text DEFAULT '#f59e0b' NOT NULL,
	"background_color" text DEFAULT '#ffffff' NOT NULL,
	"font_heading" text DEFAULT 'Inter' NOT NULL,
	"font_body" text DEFAULT 'Inter' NOT NULL,
	"button_style" text DEFAULT 'rounded' NOT NULL,
	"custom_domain" text DEFAULT '' NOT NULL,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"domain_verified_at" timestamp with time zone,
	"seo_meta_title" text DEFAULT '' NOT NULL,
	"seo_meta_description" text DEFAULT '' NOT NULL,
	"seo_keywords" text DEFAULT '' NOT NULL,
	"seo_og_image" text DEFAULT '' NOT NULL,
	"google_analytics_id" text DEFAULT '' NOT NULL,
	"google_tag_manager_id" text DEFAULT '' NOT NULL,
	"google_adsense_id" text DEFAULT '' NOT NULL,
	"meta_pixel_id" text DEFAULT '' NOT NULL,
	"facebook_meta_tag" text DEFAULT '' NOT NULL,
	"pinterest_meta_tag" text DEFAULT '' NOT NULL,
	"custom_head_html" text DEFAULT '' NOT NULL,
	"social_links" text DEFAULT '{}' NOT NULL,
	"site_history" text DEFAULT '[]' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"last_published_at" timestamp with time zone,
	"published_revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"show_in_nav" boolean DEFAULT true NOT NULL,
	"sections" text DEFAULT '[]' NOT NULL,
	"seo_meta_title" text DEFAULT '' NOT NULL,
	"seo_meta_description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_popups" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"cta_label" text DEFAULT '' NOT NULL,
	"cta_url" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"trigger_type" text DEFAULT 'time_delay' NOT NULL,
	"trigger_value" integer DEFAULT 5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_ref" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"selected_date" text NOT NULL,
	"time_slot" text DEFAULT '' NOT NULL,
	"test_ids" text DEFAULT '[]' NOT NULL,
	"package_ids" text DEFAULT '[]' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_vip" boolean DEFAULT false NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"razorpay_signature" text,
	"payu_txn_id" text,
	"payu_payment_id" text,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"patient_id" integer,
	"bill_id" integer,
	"confirmed_by_name" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_bookings_booking_ref_unique" UNIQUE("booking_ref")
);
--> statement-breakpoint
CREATE TABLE "outsourced_labs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"gstin" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"accession_number" text,
	"action" text NOT NULL,
	"actor" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_worklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer,
	"patient_id" integer,
	"dicom_patient_id" text,
	"patient_match_status" text DEFAULT 'UNMATCHED' NOT NULL,
	"patient_name" text NOT NULL,
	"age" text,
	"sex" text,
	"modality" text DEFAULT 'OT' NOT NULL,
	"study_description" text,
	"study_date" text,
	"accession_number" text NOT NULL,
	"study_instance_uid" text,
	"ae_title" text,
	"ip_address" text,
	"port" integer,
	"referring_doctor" text,
	"weasis_url" text,
	"status" text DEFAULT 'STUDY_RECEIVED' NOT NULL,
	"assigned_radiologist" text,
	"ai_draft_status" text DEFAULT 'NONE' NOT NULL,
	"ai_draft_json" text,
	"report_id" integer,
	"delivery_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_report_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer,
	"worklist_id" integer,
	"patient_id" integer,
	"template_id" text,
	"modality" text,
	"study_name" text,
	"clinical_history" text,
	"raw_findings" text,
	"findings_sections" text,
	"impression" text,
	"recommendation" text,
	"formatted_report_html" text,
	"formatted_report_text" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"final_report_id" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_report_key_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer,
	"study_id" integer,
	"patient_id" integer,
	"accession_number" text,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"caption" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"include_in_report" boolean DEFAULT true NOT NULL,
	"source_type" text DEFAULT 'UPLOAD' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_voice_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer,
	"study_id" integer,
	"patient_id" integer,
	"target_field" text,
	"raw_transcript" text,
	"cleaned_text" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_delivery_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer,
	"patient_id" integer,
	"study_id" integer,
	"accession_number" text,
	"delivery_mode" text NOT NULL,
	"recipient_phone" text,
	"recipient_email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_text" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"raw_response" text,
	"error_message" text,
	"pdf_attached" text,
	"verification_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structured_report_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_name" text NOT NULL,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"study_type" text,
	"sections_json" text,
	"default_findings" text,
	"default_impression" text,
	"macros_json" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teleradiology_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"teleradiologist_id" integer NOT NULL,
	"priority" text DEFAULT 'ROUTINE' NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone,
	"status" text DEFAULT 'assigned' NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"comments" text,
	"prelim_report" text,
	"final_report" text,
	"submitted_at" timestamp with time zone,
	"unassigned_at" timestamp with time zone,
	"unassigned_by" text
);
--> statement-breakpoint
CREATE TABLE "teleradiology_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teleradiology_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "teleradiology_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"pin_hash" text NOT NULL,
	"role" text DEFAULT 'TELERADIOLOGIST' NOT NULL,
	"specialty" text,
	"qualifications" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"can_do_final_report" boolean DEFAULT false NOT NULL,
	"can_use_ai" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teleradiology_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "hl7_integration_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"sending_facility" text,
	"receiving_facility" text,
	"hl7_version" text DEFAULT '2.5' NOT NULL,
	"enabled_message_types" text,
	"inbound_endpoint_secret" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hl7_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"message_type" text NOT NULL,
	"sending_facility" text,
	"receiving_facility" text,
	"patient_id" text,
	"accession_number" text,
	"message_control_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"raw_message" text,
	"parsed_json" text,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"direction" text DEFAULT 'incoming' NOT NULL,
	"message_body" text DEFAULT '' NOT NULL,
	"wa_message_id" text DEFAULT '' NOT NULL,
	"ai_handled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_modalities" (
	"id" serial PRIMARY KEY NOT NULL,
	"machine_name" text NOT NULL,
	"modality" text,
	"ae_title" text,
	"ip_address" text,
	"port" integer,
	"location" text,
	"manufacturer" text,
	"auto_send_enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"query_enabled" boolean DEFAULT true NOT NULL,
	"retrieve_enabled" boolean DEFAULT true NOT NULL,
	"polling_enabled" boolean DEFAULT false NOT NULL,
	"polling_interval_seconds" integer DEFAULT 300 NOT NULL,
	"retrieve_method" text DEFAULT 'C_MOVE' NOT NULL,
	"preferred_transfer_syntax" text,
	"destination_pacs" text DEFAULT 'CONQUEST' NOT NULL,
	"auto_push_to_conquest" boolean DEFAULT true NOT NULL,
	"auto_create_worklist" boolean DEFAULT true NOT NULL,
	"auto_notify_radiologist" boolean DEFAULT false NOT NULL,
	"notes" text,
	"last_connection_status" text,
	"last_seen_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pacs_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"log_type" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"source" text,
	"event_type" text,
	"message" text NOT NULL,
	"study_instance_uid" text,
	"accession_number" text,
	"patient_id" text,
	"modality" text,
	"payload" text,
	"error_stack" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pacs_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"category" text DEFAULT 'general' NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_pull_agent_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text,
	"agent_host" text,
	"event_type" text NOT NULL,
	"source_ae_title" text,
	"source_ip" text,
	"modality" text,
	"study_instance_uid" text,
	"accession_number" text,
	"patient_name" text,
	"patient_id" text,
	"status" text DEFAULT 'INFO' NOT NULL,
	"message" text NOT NULL,
	"raw_payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_pull_agent_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"agent_host" text NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_successful_pull_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"is_online" boolean DEFAULT false NOT NULL,
	"studies_found_today" integer DEFAULT 0 NOT NULL,
	"studies_pulled_today" integer DEFAULT 0 NOT NULL,
	"failed_today" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_failed_retrieval_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text NOT NULL,
	"accession_number" text,
	"modality" text,
	"source_ae_title" text,
	"source_ip" text,
	"failure_type" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_pulled_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text NOT NULL,
	"accession_number" text,
	"modality" text,
	"source_ae_title" text,
	"source_ip" text,
	"patient_name" text,
	"patient_id" text,
	"study_date" text,
	"study_time" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"hash_signature" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"pulled_at" timestamp with time zone,
	"pushed_to_pacs_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dicom_pulled_studies_study_instance_uid_unique" UNIQUE("study_instance_uid")
);
--> statement-breakpoint
CREATE TABLE "radiology_scheduled_procedures" (
	"id" serial PRIMARY KEY NOT NULL,
	"accession_number" text NOT NULL,
	"patient_id" text,
	"patient_name" text,
	"patient_sex" text,
	"patient_age" text,
	"patient_dob" text,
	"modality" text,
	"procedure_name" text,
	"procedure_code" text,
	"study_description" text,
	"referring_doctor" text,
	"referring_doctor_id" text,
	"scheduled_date" text,
	"scheduled_time" text,
	"station_ae_title" text,
	"body_part_examined" text,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"source_bill_id" text,
	"source_order_id" text,
	"source_appointment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiology_scheduled_procedures_accession_number_unique" UNIQUE("accession_number")
);
--> statement-breakpoint
CREATE TABLE "dicom_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality_type" text,
	"source_ae_title" text,
	"destination_pacs" text DEFAULT 'CONQUEST' NOT NULL,
	"destination_ae_title" text,
	"destination_ip" text,
	"destination_port" integer,
	"storage_path" text,
	"auto_push" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"bank_name" text NOT NULL,
	"account_nickname" text,
	"masked_account_number" text NOT NULL,
	"ifsc" text,
	"branch" text,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"credential_key" text,
	"ledger_account_id" integer,
	"provider_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"bank_account_id" integer,
	"external_id" text,
	"amount" numeric(14, 2),
	"status" text,
	"details" jsonb,
	"performed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_transaction_id" text,
	"transaction_date" timestamp with time zone NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"type" text NOT NULL,
	"balance_after" numeric(14, 2),
	"utr" text,
	"reference_number" text,
	"raw_payload" jsonb,
	"reconciliation_status" text DEFAULT 'unreconciled' NOT NULL,
	"voucher_id" integer,
	"payment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"provider" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"purpose" text,
	"beneficiary_name" text,
	"beneficiary_account" text,
	"beneficiary_ifsc" text,
	"external_request_id" text,
	"external_transaction_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"bill_id" integer,
	"voucher_id" integer,
	"performed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text,
	"payload" jsonb,
	"raw_body" text,
	"signature_valid" boolean,
	"processed" boolean DEFAULT false NOT NULL,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_day_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"closure_date" date NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"covered_from_ts" timestamp with time zone,
	"covered_to_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_upi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_card" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_cheque" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_expected" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_billed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_due" numeric(12, 2) DEFAULT '0' NOT NULL,
	"bills_count" integer DEFAULT 0 NOT NULL,
	"payments_count" integer DEFAULT 0 NOT NULL,
	"actual_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_upi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_card" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_cheque" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_actual" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_note" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"denominations" jsonb DEFAULT 'null'::jsonb,
	"denomination_total" numeric(12, 2),
	"drawer_status" text DEFAULT 'closed' NOT NULL,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"reopened_by_name" text,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"floor_id" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "modalities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modalities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ai_provider_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"encrypted_api_key" text,
	"default_model" text,
	"settings_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reporting_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text,
	"patient_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"provider" text NOT NULL,
	"model" text,
	"prompt_text" text,
	"num_images" integer DEFAULT 0 NOT NULL,
	"anonymized" boolean DEFAULT true NOT NULL,
	"included_demographics" boolean DEFAULT false NOT NULL,
	"was_inserted_to_report" boolean DEFAULT false NOT NULL,
	"draft_id" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reporting_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text,
	"accession_number" text,
	"patient_id" integer,
	"user_id" integer,
	"user_name" text,
	"provider" text NOT NULL,
	"model" text,
	"prompt_text" text,
	"template_name" text,
	"ai_response" text,
	"draft_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"inserted_at" timestamp with time zone,
	"inserted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawer_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_closure_id" integer,
	"action" text NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"user_role" text DEFAULT 'staff' NOT NULL,
	"expected_total" numeric(12, 2),
	"actual_total" numeric(12, 2),
	"variance" numeric(12, 2),
	"reason" text DEFAULT '' NOT NULL,
	"target_type" text,
	"target_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_tests" ADD CONSTRAINT "order_tests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_tests" ADD CONSTRAINT "order_tests_test_id_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."diagnostic_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumption_rules" ADD CONSTRAINT "inventory_consumption_rules_test_id_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."diagnostic_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_consumption_rules" ADD CONSTRAINT "inventory_consumption_rules_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferred_vendor_id_vendors_id_fk" FOREIGN KEY ("preferred_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_tests" ADD CONSTRAINT "package_tests_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_tests" ADD CONSTRAINT "package_tests_test_id_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."diagnostic_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_rejoining_forms" ADD CONSTRAINT "hr_rejoining_forms_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_biometric_credentials" ADD CONSTRAINT "staff_biometric_credentials_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salary_payments" ADD CONSTRAINT "staff_salary_payments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD CONSTRAINT "form_f_records_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD CONSTRAINT "form_f_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_test_assignments" ADD CONSTRAINT "sample_test_assignments_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_test_assignments" ADD CONSTRAINT "sample_test_assignments_order_test_id_order_tests_id_fk" FOREIGN KEY ("order_test_id") REFERENCES "public"."order_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD CONSTRAINT "doctor_payouts_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_amc_contracts" ADD CONSTRAINT "machine_amc_contracts_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_breakdowns" ADD CONSTRAINT "machine_breakdowns_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_service_records" ADD CONSTRAINT "machine_service_records_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_ledger_date_no_uq" ON "tokens" USING btree (COALESCE("ledger_id", 1),"token_date","token_no");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attendance_staff_date_uniq" ON "staff_attendance" USING btree ("staff_id","attendance_date");--> statement-breakpoint
CREATE INDEX "report_templates_by_test_idx" ON "report_templates" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "abnormal_findings_by_test_idx" ON "abnormal_findings" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "abnormal_findings_by_modality_idx" ON "abnormal_findings" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "portal_sessions_token_idx" ON "portal_sessions" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_test_unique_idx" ON "sample_test_assignments" USING btree ("sample_id","order_test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_tokens_dept_date_no_uq" ON "test_tokens" USING btree (COALESCE("ledger_id", 1),"token_date","department","token_no");--> statement-breakpoint
CREATE UNIQUE INDEX "test_tokens_order_test_uq" ON "test_tokens" USING btree ("order_test_id");--> statement-breakpoint
CREATE INDEX "radiology_prompts_modality_idx" ON "radiology_prompts" USING btree ("modality");--> statement-breakpoint
CREATE UNIQUE INDEX "radiology_studies_accession_uq" ON "radiology_studies" USING btree ("accession_number");--> statement-breakpoint
CREATE UNIQUE INDEX "radiology_studies_order_test_uq" ON "radiology_studies" USING btree ("order_test_id");--> statement-breakpoint
CREATE INDEX "radiology_studies_status_idx" ON "radiology_studies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "radiology_studies_date_idx" ON "radiology_studies" USING btree ("study_date");--> statement-breakpoint
CREATE INDEX "radiology_studies_priority_idx" ON "radiology_studies" USING btree ("priority");--> statement-breakpoint
CREATE UNIQUE INDEX "radiology_share_links_token_uq" ON "radiology_share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "radiology_share_links_study_idx" ON "radiology_share_links" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_reports_number_uq" ON "patient_reports" USING btree ("report_number");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_reports_public_token_uq" ON "patient_reports" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "patient_reports_patient_idx" ON "patient_reports" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_reports_status_idx" ON "patient_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "patient_reports_critical_idx" ON "patient_reports" USING btree ("is_critical");--> statement-breakpoint
CREATE INDEX "doctor_payouts_doctor_idx" ON "doctor_payouts" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_payouts_date_idx" ON "doctor_payouts" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "doctor_payouts_doctor_date_idx" ON "doctor_payouts" USING btree ("doctor_id","payment_date");--> statement-breakpoint
CREATE INDEX "amc_machine_idx" ON "machine_amc_contracts" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "amc_end_date_idx" ON "machine_amc_contracts" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "breakdown_machine_idx" ON "machine_breakdowns" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "breakdown_status_idx" ON "machine_breakdowns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "breakdown_reported_idx" ON "machine_breakdowns" USING btree ("reported_at");--> statement-breakpoint
CREATE INDEX "service_machine_idx" ON "machine_service_records" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "service_type_idx" ON "machine_service_records" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX "service_next_due_idx" ON "machine_service_records" USING btree ("next_due_date");--> statement-breakpoint
CREATE INDEX "service_date_idx" ON "machine_service_records" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "machines_dept_idx" ON "machines" USING btree ("department");--> statement-breakpoint
CREATE INDEX "machines_status_idx" ON "machines" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_main_uq" ON "branches" USING btree ("is_main") WHERE "branches"."is_main" = true;--> statement-breakpoint
CREATE INDEX "backup_job_log_job_idx" ON "backup_job_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "radiology_audit_log_worklist_idx" ON "radiology_audit_log" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "radiology_audit_log_action_idx" ON "radiology_audit_log" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "radiology_worklist_accession_uq" ON "radiology_worklist" USING btree ("accession_number");--> statement-breakpoint
CREATE INDEX "radiology_worklist_uid_idx" ON "radiology_worklist" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "radiology_worklist_status_idx" ON "radiology_worklist" USING btree ("status");--> statement-breakpoint
CREATE INDEX "radiology_worklist_patient_idx" ON "radiology_worklist" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "rad_report_drafts_study_idx" ON "radiology_report_drafts" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "rad_report_drafts_patient_idx" ON "radiology_report_drafts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "rad_report_drafts_status_idx" ON "radiology_report_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rad_key_images_draft_idx" ON "radiology_report_key_images" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "rad_key_images_study_idx" ON "radiology_report_key_images" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "rad_voice_logs_draft_idx" ON "radiology_voice_logs" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "rdl_report_idx" ON "report_delivery_logs" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "rdl_patient_idx" ON "report_delivery_logs" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "rdl_created_idx" ON "report_delivery_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "srt_modality_idx" ON "structured_report_templates" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "srt_body_part_idx" ON "structured_report_templates" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX "tele_assign_study_idx" ON "teleradiology_assignments" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "tele_assign_user_idx" ON "teleradiology_assignments" USING btree ("teleradiologist_id");--> statement-breakpoint
CREATE INDEX "hl7_msg_type_idx" ON "hl7_messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "hl7_msg_created_idx" ON "hl7_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_conv_phone_idx" ON "whatsapp_conversations" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "whatsapp_conv_created_idx" ON "whatsapp_conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_audit_study_idx" ON "ai_reporting_audit_logs" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "ai_audit_user_idx" ON "ai_reporting_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_audit_created_idx" ON "ai_reporting_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_draft_study_idx" ON "ai_reporting_drafts" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "ai_draft_patient_idx" ON "ai_reporting_drafts" USING btree ("patient_id");