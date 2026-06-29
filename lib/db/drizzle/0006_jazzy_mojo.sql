CREATE TYPE IF NOT EXISTS "public"."outsource_status" AS ENUM('ordered', 'sample_collected', 'sample_packed', 'sent_to_lab', 'received_by_lab', 'report_received', 'report_uploaded', 'report_delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_smart_macros" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"shortcut" text NOT NULL,
	"expansion" text NOT NULL,
	"modality" text,
	"body_part" text,
	"is_measurement_macro" boolean DEFAULT false NOT NULL,
	"measurement_params" text,
	"auto_suggest_on" boolean DEFAULT false NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spinal_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"draft_id" integer,
	"patient_id" integer,
	"worklist_id" integer,
	"vertebra_level" text NOT NULL,
	"canal_ap" text,
	"canal_transverse" text,
	"canal_area" text,
	"cord_ap" text,
	"cord_transverse" text,
	"cord_area" text,
	"disc_height" text,
	"stenosis_grade" text DEFAULT 'none' NOT NULL,
	"stenosis_notes" text,
	"left_foraminal" text DEFAULT 'normal' NOT NULL,
	"right_foraminal" text DEFAULT 'normal' NOT NULL,
	"alignment" text DEFAULT 'normal' NOT NULL,
	"alignment_notes" text,
	"measured_by" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "super_admin_sessions" (
	"token" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone_number_id" text DEFAULT '' NOT NULL,
	"display_number" text DEFAULT '' NOT NULL,
	"access_token" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'general' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_chocolate_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"group_name" text DEFAULT 'General' NOT NULL,
	"short_name" text NOT NULL,
	"finding_text" text NOT NULL,
	"impression_text" text,
	"is_critical" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_study_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"study_instance_uid" text NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"lock_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workstation" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_user_findings_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"favorite_finding_ids" text DEFAULT '[]' NOT NULL,
	"custom_findings_json" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_user_item_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"item_label" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_user_report_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"favorite_findings" text DEFAULT '[]' NOT NULL,
	"favorite_impressions" text DEFAULT '[]' NOT NULL,
	"favorite_templates" text DEFAULT '[]' NOT NULL,
	"personal_macros" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doctor_commission_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"rate_card_id" integer,
	"test_category" text,
	"rule_type" text DEFAULT 'profit_share_percent' NOT NULL,
	"rule_value" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"performed_by" integer,
	"target_table" text,
	"target_id" integer,
	"old_value" text,
	"new_value" text,
	"remarks" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_dispatch_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_number" text NOT NULL,
	"lab_id" integer NOT NULL,
	"courier_name" text,
	"tracking_details" text,
	"staff_handover_id" integer,
	"remarks" text,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outsource_dispatch_batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"rate_card_id" integer NOT NULL,
	"dispatch_batch_id" integer,
	"status" "outsource_status" DEFAULT 'ordered' NOT NULL,
	"barcode" text,
	"sample_type" text,
	"expected_report_time" timestamp with time zone,
	"actual_report_received_time" timestamp with time zone,
	"patient_charge" numeric(10, 2) NOT NULL,
	"outsource_cost" numeric(10, 2) NOT NULL,
	"doctor_commission" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"net_hospital_profit" numeric(10, 2) NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lab_id" integer NOT NULL,
	"payment_date" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_paid" numeric(12, 2) NOT NULL,
	"tds_deducted" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"payment_mode" text NOT NULL,
	"utr_cheque_number" text,
	"attachment_url" text,
	"remarks" text,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_price_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"rate_card_id" integer NOT NULL,
	"price_group" text DEFAULT 'general' NOT NULL,
	"strategy_type" text DEFAULT 'outsource_mrp' NOT NULL,
	"strategy_value" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"final_selling_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_rate_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"lab_id" integer NOT NULL,
	"lab_test_code" text NOT NULL,
	"test_name" text NOT NULL,
	"department" text,
	"mrp" numeric(10, 2) NOT NULL,
	"partner_cost" numeric(10, 2) NOT NULL,
	"commission_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_vendor_invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_invoice_id" integer NOT NULL,
	"lab_no" text,
	"patient_name" text NOT NULL,
	"lab_test_code" text NOT NULL,
	"test_name" text NOT NULL,
	"gross_price" numeric(10, 2) NOT NULL,
	"lab_cost" numeric(10, 2) NOT NULL,
	"net_price" numeric(10, 2) NOT NULL,
	"tds" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"net_payable" numeric(10, 2) NOT NULL,
	"reconciliation_status" text DEFAULT 'pending' NOT NULL,
	"linked_order_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_vendor_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"lab_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp with time zone NOT NULL,
	"gross_amount" numeric(12, 2) NOT NULL,
	"tds_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"net_payable" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'unreconciled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outsource_vendor_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"lab_id" integer NOT NULL,
	"transaction_type" text NOT NULL,
	"reference_id" text,
	"debit_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"credit_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"tds_deducted" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"running_balance" numeric(12, 2) NOT NULL,
	"remarks" text,
	"transaction_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_institutional_styles" (
	"id" serial PRIMARY KEY NOT NULL,
	"preset_name" text DEFAULT 'Care Diagnostics Default' NOT NULL,
	"section_order" text DEFAULT 'Technique,Findings,Impression' NOT NULL,
	"show_clinical_history" boolean DEFAULT true NOT NULL,
	"show_comparison" boolean DEFAULT true NOT NULL,
	"show_recommendation" boolean DEFAULT true NOT NULL,
	"show_critical_communication" boolean DEFAULT true NOT NULL,
	"show_measurements" boolean DEFAULT true NOT NULL,
	"heading_style" text DEFAULT 'underlined' NOT NULL,
	"abnormal_emphasis" text DEFAULT 'bold_abnormal' NOT NULL,
	"spacing" text DEFAULT 'standard' NOT NULL,
	"print_layout" text DEFAULT 'letterhead' NOT NULL,
	"margins" text DEFAULT 'standard' NOT NULL,
	"font_size" text DEFAULT 'standard' NOT NULL,
	"show_radiologist_name" boolean DEFAULT true NOT NULL,
	"show_degree" boolean DEFAULT true NOT NULL,
	"show_reg_number" boolean DEFAULT true NOT NULL,
	"show_digital_signature" boolean DEFAULT true NOT NULL,
	"show_timestamp" boolean DEFAULT true NOT NULL,
	"show_qr_verification" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_config_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text,
	"changed_by" integer,
	"changed_by_name" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_prompt_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text NOT NULL,
	"prompt_content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_prompt_library" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text NOT NULL,
	"prompts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"library_owner" text DEFAULT 'care_diagnostics' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_prompt_library_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"version" integer NOT NULL,
	"prompts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"measurement_type" text NOT NULL,
	"measurement_label" text NOT NULL,
	"value" text NOT NULL,
	"unit" text DEFAULT 'mm',
	"body_part" text,
	"side" text,
	"level" text,
	"study_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"series_number" text,
	"image_number" text,
	"modality" text,
	"measured_by_id" integer,
	"measured_by_name" text,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teaching_case_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" integer,
	"owner_name" text,
	"is_shared" boolean DEFAULT false NOT NULL,
	"case_ids_json" text DEFAULT '[]',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teaching_case_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"teaching_case_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teaching_case_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"teaching_case_id" integer NOT NULL,
	"image_url" text,
	"image_data" text,
	"thumbnail_url" text,
	"study_instance_uid" text,
	"series_instance_uid" text,
	"sop_instance_uid" text,
	"frame_number" integer,
	"is_key_image" boolean DEFAULT false NOT NULL,
	"description" text,
	"annotation_data" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teaching_case_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"teaching_case_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teaching_case_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"teaching_case_id" integer NOT NULL,
	"user_id" integer,
	"user_name" text,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teaching_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"diagnosis" text,
	"category" text NOT NULL,
	"difficulty" text DEFAULT 'intermediate' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"study_instance_uid" text,
	"series_instance_uid" text,
	"sop_instance_uid" text,
	"pacs_url" text,
	"patient_age" text,
	"patient_gender" text,
	"modality" text,
	"body_part" text,
	"study_description" text,
	"findings" text,
	"impression" text,
	"measurements" text,
	"ai_notes" text,
	"ai_summary" text,
	"learning_points" text,
	"pearls" text,
	"pitfalls" text,
	"is_research_candidate" boolean DEFAULT false NOT NULL,
	"research_status" text,
	"tags_json" text DEFAULT '[]',
	"classification" text,
	"classification_value" text,
	"created_by_id" integer NOT NULL,
	"created_by_name" text,
	"is_anonymized" boolean DEFAULT false NOT NULL,
	"anonymized_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"share_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_model_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_quality_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_key" text,
	"date_from" timestamp with time zone NOT NULL,
	"date_to" timestamp with time zone NOT NULL,
	"total_drafts" integer DEFAULT 0 NOT NULL,
	"total_with_feedback" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"needs_improvement_count" integer DEFAULT 0 NOT NULL,
	"inaccurate_count" integer DEFAULT 0 NOT NULL,
	"helpful_rate" real DEFAULT 0 NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"avg_turnaround_minutes" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_dicom_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer NOT NULL,
	"study_instance_uid" text,
	"accession_number" text,
	"modality" text,
	"body_part" text,
	"study_description" text,
	"suggested_findings" text,
	"suggested_impression" text,
	"confidence_score" real,
	"ai_safety_label" text DEFAULT 'AI Draft – Requires Radiologist Review' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_document_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"document_type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"embedding_dimension" integer DEFAULT 384,
	"modality" text,
	"patient_id" integer,
	"study_id" integer,
	"source_url" text,
	"source_title" text,
	"search_count" integer DEFAULT 0 NOT NULL,
	"last_searched_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_search_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"query_text" text NOT NULL,
	"embedding" text,
	"top_k" integer DEFAULT 5 NOT NULL,
	"results_json" text,
	"user_id" integer,
	"user_name" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anomaly_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"message" text NOT NULL,
	"scope" text,
	"related_id" integer,
	"related_table" text,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledged_by_id" integer,
	"acknowledged_by_name" text,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"name" text NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"change_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_billing_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer NOT NULL,
	"report_id" integer,
	"cpt_codes" text,
	"icd_codes" text,
	"overall_confidence" real,
	"ai_safety_label" text DEFAULT 'AI Draft – Requires Radiologist Review' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "peer_review_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"worklist_id" integer,
	"assigned_to_id" integer NOT NULL,
	"assigned_to_name" text,
	"assigned_by_id" integer,
	"assigned_by_name" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ai_confidence_score" integer,
	"auto_assigned_reason" text,
	"completed_at" timestamp with time zone,
	"completed_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turnaround_times" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer NOT NULL,
	"study_id" integer,
	"modality" text,
	"radiologist_id" integer,
	"radiologist_name" text,
	"minutes_to_report" real,
	"minutes_to_first_review" real,
	"minutes_to_peer_review" real,
	"date_bucket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_training_data_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"export_name" text NOT NULL,
	"modality" text,
	"date_from" text,
	"date_to" text,
	"min_quality_score" integer,
	"records_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_path" text,
	"exported_by_id" integer,
	"exported_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_quality_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"findings_present" boolean DEFAULT false NOT NULL,
	"impression_present" boolean DEFAULT false NOT NULL,
	"signature_present" boolean DEFAULT false NOT NULL,
	"clinical_history_present" boolean DEFAULT false NOT NULL,
	"technique_present" boolean DEFAULT false NOT NULL,
	"comparison_present" boolean DEFAULT false NOT NULL,
	"all_passed" boolean DEFAULT false NOT NULL,
	"failed_checks" text,
	"passed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_quality_gates_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "critical_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"worklist_id" integer,
	"patient_id" integer,
	"finding_keywords" text NOT NULL,
	"severity" text DEFAULT 'high' NOT NULL,
	"status" text DEFAULT 'pending_notification' NOT NULL,
	"notified_at" timestamp with time zone,
	"notified_to" text,
	"notification_method" text,
	"escalation_reason" text,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_provider_health_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"endpoint_url" text,
	"model" text,
	"latency_ms" integer,
	"status" text NOT NULL,
	"status_code" integer,
	"error_message" text,
	"is_success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_voice_transcriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"report_id" integer,
	"patient_id" integer,
	"radiologist_id" integer,
	"radiologist_name" text,
	"audio_url" text,
	"audio_duration_seconds" real,
	"raw_transcript" text,
	"confidence_score" real,
	"corrected_text" text,
	"inserted_into_report" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"modality" text,
	"body_part" text,
	"ai_safety_label" text DEFAULT 'AI Draft – Requires Radiologist Review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_patient_communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"report_id" integer,
	"patient_id" integer,
	"communication_type" text DEFAULT 'result_summary' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"original_text" text,
	"ai_draft" text,
	"ai_safety_label" text DEFAULT 'AI Draft – Requires Radiologist Review' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_by_id" integer,
	"sent_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_normal_report_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text NOT NULL,
	"body_part" text,
	"category" text DEFAULT 'normal' NOT NULL,
	"findings" text NOT NULL,
	"impression" text NOT NULL,
	"technique" text,
	"clinical_history" text,
	"comparison" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "echo_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"action" text NOT NULL,
	"performed_by" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "echo_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"patient_id" integer,
	"height_cm" real,
	"weight_kg" real,
	"bsa" real,
	"bp_systolic" integer,
	"bp_diastolic" integer,
	"heart_rate" integer,
	"ivsd" real,
	"ivss" real,
	"lvidd" real,
	"lvids" real,
	"lvpwd" real,
	"lvpws" real,
	"la_diameter" real,
	"la_volume" real,
	"la_volume_index" real,
	"ra_size" real,
	"aortic_root" real,
	"ascending_aorta" real,
	"rv_basal" real,
	"rv_mid" real,
	"rv_length" real,
	"tapase" real,
	"rvsp" real,
	"ef_simpson" real,
	"ef_teichholz" real,
	"fractional_shortening" real,
	"lv_mass" real,
	"lv_mass_index" real,
	"mv_e" real,
	"mv_a" real,
	"mv_ea_ratio" real,
	"mv_decel_time" real,
	"mv_ee_prime" real,
	"septal_e_prime" real,
	"lateral_e_prime" real,
	"av_velocity" real,
	"av_gradient" real,
	"av_area" real,
	"tr_velocity" real,
	"tr_gradient" real,
	"pulmonary_velocity" real,
	"pulmonary_gradient" real,
	"lvh" boolean,
	"relative_wall_thickness" real,
	"lv_geometry" text,
	"diastolic_dysfunction_grade" text,
	"pulmonary_hypertension" boolean,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "echo_regional_walls" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"segment" text NOT NULL,
	"motion" text DEFAULT 'normal' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "echo_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"patient_id" integer,
	"left_ventricle" text,
	"right_ventricle" text,
	"left_atrium" text,
	"right_atrium" text,
	"interatrial_septum" text,
	"interventricular_septum" text,
	"aortic_valve" text,
	"mitral_valve" text,
	"tricuspid_valve" text,
	"pulmonary_valve" text,
	"pericardium" text,
	"doppler_findings" text,
	"impression" text,
	"recommendation" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"drafted_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"finalized_by" text,
	"finalized_at" timestamp with time zone,
	"critical_alerts_acknowledged" boolean DEFAULT false NOT NULL,
	"ai_draft" text,
	"ai_draft_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "echo_reports_study_id_unique" UNIQUE("study_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "echo_valve_assessment" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"valve_name" text NOT NULL,
	"morphology" text,
	"stenosis" text,
	"stenosis_notes" text,
	"regurgitation" text,
	"regurgitation_notes" text,
	"additional_findings" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_echo_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"action" text NOT NULL,
	"performed_by" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_echo_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"patient_id" integer,
	"ga_weeks" real,
	"ga_days" integer,
	"edd" text,
	"lmp" text,
	"fetal_heart_rate" integer,
	"situs" text,
	"cardiac_axis" text,
	"cardiac_position" text,
	"av_concordance" text,
	"va_concordance" text,
	"ra_normal" boolean DEFAULT true,
	"la_normal" boolean DEFAULT true,
	"rv_normal" boolean DEFAULT true,
	"lv_normal" boolean DEFAULT true,
	"four_chamber_view" text,
	"lvot" text,
	"rvot" text,
	"three_vessel_view" text,
	"three_vessel_trachea_view" text,
	"aortic_arch" text,
	"ductal_arch" text,
	"interatrial_septum" text,
	"interventricular_septum" text,
	"mitral_valve" text,
	"tricuspid_valve" text,
	"aortic_valve" text,
	"pulmonary_valve" text,
	"rhythm" text DEFAULT 'normal_sinus',
	"rhythm_notes" text,
	"umbilical_artery_pi" real,
	"umbilical_artery_ri" real,
	"ductus_venosus_pi" real,
	"ductus_venosus_a_wave" text,
	"mca_pi" real,
	"mca_ri" real,
	"suspected_abnormalities" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"drafted_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"finalized_by" text,
	"finalized_at" timestamp with time zone,
	"critical_alerts_acknowledged" boolean DEFAULT false NOT NULL,
	"ai_draft" text,
	"ai_draft_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetal_echo_studies_study_id_unique" UNIQUE("study_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"action" varchar(40) NOT NULL,
	"performed_by" varchar(100) NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"skull_brain" varchar(20) DEFAULT 'not_assessed',
	"face" varchar(20) DEFAULT 'not_assessed',
	"spine" varchar(20) DEFAULT 'not_assessed',
	"thorax" varchar(20) DEFAULT 'not_assessed',
	"heart_four_chamber" varchar(20) DEFAULT 'not_assessed',
	"outflow_tracts" varchar(20) DEFAULT 'not_assessed',
	"abdomen" varchar(20) DEFAULT 'not_assessed',
	"stomach_bubble" varchar(20) DEFAULT 'not_assessed',
	"kidneys" varchar(20) DEFAULT 'not_assessed',
	"urinary_bladder" varchar(20) DEFAULT 'not_assessed',
	"cord_insertion" varchar(20) DEFAULT 'not_assessed',
	"limbs" varchar(20) DEFAULT 'not_assessed',
	"placenta" varchar(20) DEFAULT 'not_assessed',
	"liquor" varchar(20) DEFAULT 'not_assessed',
	"cervix" varchar(20) DEFAULT 'not_assessed',
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_critical_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"alert_type" varchar(40) NOT NULL,
	"alert_message" text NOT NULL,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_by" varchar(100),
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"crl" numeric(6, 2),
	"msd" numeric(6, 2),
	"yolk_sac" numeric(6, 2),
	"fetal_heart_rate" integer,
	"nt" numeric(5, 2),
	"nasal_bone" varchar(20),
	"ductus_venosus" varchar(20),
	"tricuspid_flow" varchar(20),
	"bpd" numeric(6, 2),
	"hc" numeric(6, 2),
	"ac" numeric(6, 2),
	"fl" numeric(6, 2),
	"hl" numeric(6, 2),
	"efw" numeric(8, 2),
	"efw_percentile" numeric(5, 2),
	"afi" numeric(5, 1),
	"afi_interpretation" varchar(30),
	"sdp" numeric(5, 1),
	"placenta_location" varchar(30),
	"placenta_grade" varchar(10),
	"presentation" varchar(20),
	"cervical_length" numeric(5, 2),
	"cervical_length_interpretation" varchar(30),
	"umbilical_artery_pi" numeric(5, 2),
	"umbilical_artery_ri" numeric(5, 2),
	"umbilical_artery_sd" numeric(5, 2),
	"mca_pi" numeric(5, 2),
	"mca_ri" numeric(5, 2),
	"cpr" numeric(5, 2),
	"ductus_venosus_pi" numeric(5, 2),
	"ductus_venosus_a_wave" varchar(10),
	"uterine_artery_pi" numeric(5, 2),
	"uterine_artery_ri" numeric(5, 2),
	"extracted_from" varchar(20) DEFAULT 'manual',
	"confidence_score" integer,
	"twin_a_fhr" integer,
	"twin_a_bpd" numeric(6, 2),
	"twin_a_hc" numeric(6, 2),
	"twin_a_ac" numeric(6, 2),
	"twin_a_fl" numeric(6, 2),
	"twin_a_efw" numeric(8, 2),
	"twin_a_presentation" varchar(20),
	"twin_b_fhr" integer,
	"twin_b_bpd" numeric(6, 2),
	"twin_b_hc" numeric(6, 2),
	"twin_b_ac" numeric(6, 2),
	"twin_b_fl" numeric(6, 2),
	"twin_b_efw" numeric(8, 2),
	"twin_b_presentation" varchar(20),
	"discordance_percent" numeric(5, 2),
	"bpp_fetal_breathing" integer,
	"bpp_fetal_movement" integer,
	"bpp_fetal_tone" integer,
	"bpp_afi" integer,
	"bpp_total" integer,
	"nst_done" boolean DEFAULT false,
	"nst_result" varchar(30),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"findings" text,
	"impression" text,
	"recommendation" text,
	"ai_draft" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"finalized_by" integer,
	"finalized_at" timestamp,
	"critical_alerts_acknowledged" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"study_type" varchar(40) DEFAULT 'unknown' NOT NULL,
	"trimester" varchar(10) DEFAULT 'unknown' NOT NULL,
	"lmp" varchar(20),
	"ga_weeks" integer,
	"ga_days" integer,
	"edd" varchar(20),
	"lmp_ga" integer,
	"biometric_ga" integer,
	"composite_ga" integer,
	"parity" varchar(20),
	"gravida" integer,
	"is_twin" boolean DEFAULT false,
	"chorionicity" varchar(20),
	"amnionicity" varchar(20),
	"doppler_study_done" boolean DEFAULT false,
	"bpp_done" boolean DEFAULT false,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"pregnancy_episode_id" integer,
	"visit_number" integer,
	"study_order" integer,
	"growth_history" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fetal_usg_template_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"study_type" varchar(40) NOT NULL,
	"template_json" json NOT NULL,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_verification" (
	"id" serial PRIMARY KEY NOT NULL,
	"backup_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_successful_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"size_bytes" integer,
	"row_count" integer,
	"restore_test_status" text DEFAULT 'not_tested',
	"restore_tested_at" timestamp with time zone,
	"restore_test_details" text,
	"alert_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "critical_escalation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"critical_finding_id" integer NOT NULL,
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"escalated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"escalated_to" text,
	"escalated_to_role" text,
	"notification_method" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolution_status" text DEFAULT 'open',
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dicom_retry_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_type" text NOT NULL,
	"entity_id" integer,
	"entity_type" text NOT NULL,
	"failure_reason" text,
	"error_details_json" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_delivery_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_draft_id" integer NOT NULL,
	"study_id" integer,
	"patient_id" integer,
	"whatsapp_sent_at" timestamp with time zone,
	"whatsapp_status" text DEFAULT 'pending',
	"print_status" text DEFAULT 'pending',
	"portal_viewed_at" timestamp with time zone,
	"portal_view_count" integer DEFAULT 0 NOT NULL,
	"delivery_failure_log_json" text,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" timestamp with time zone DEFAULT now() NOT NULL,
	"total_bytes_used" integer,
	"total_studies" integer,
	"studies_by_modality_json" text,
	"daily_growth_bytes" integer,
	"archive_bytes" integer,
	"hot_storage_bytes" integer,
	"threshold_percent" integer DEFAULT 80 NOT NULL,
	"alert_triggered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_health_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"api_health" text DEFAULT 'ok' NOT NULL,
	"db_health" text DEFAULT 'ok' NOT NULL,
	"pacs_health" text DEFAULT 'ok' NOT NULL,
	"ai_service_health" text DEFAULT 'ok' NOT NULL,
	"frontend_health" text DEFAULT 'ok' NOT NULL,
	"disk_usage_percent" integer,
	"memory_usage_percent" integer,
	"uptime_minutes" integer,
	"details_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_job_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"job_type" text NOT NULL,
	"modality" text DEFAULT 'OT' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"confidence_score" integer,
	"inference_time_ms" integer,
	"gpu_mode" boolean DEFAULT false NOT NULL,
	"result_json" text,
	"error_message" text,
	"human_overridden" boolean DEFAULT false NOT NULL,
	"overridden_by" text,
	"overridden_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dicom_incoming_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text NOT NULL,
	"series_instance_uid" text,
	"accession_number" text,
	"modality" text DEFAULT 'OT' NOT NULL,
	"ae_title" text,
	"expected_ae_title" text,
	"patient_name" text,
	"patient_id" text,
	"study_description" text,
	"body_part" text,
	"image_count" integer DEFAULT 0 NOT NULL,
	"series_count" integer DEFAULT 0 NOT NULL,
	"last_image_received_at" timestamp with time zone,
	"transfer_status" text DEFAULT 'receiving' NOT NULL,
	"transfer_error" text,
	"ae_mismatch" boolean DEFAULT false NOT NULL,
	"duplicate_study" boolean DEFAULT false NOT NULL,
	"incomplete_study" boolean DEFAULT false NOT NULL,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	"reprocessed_at" timestamp with time zone,
	"reprocess_count" integer DEFAULT 0 NOT NULL,
	"ingest_source" text DEFAULT 'conquest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mwl_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"accession_number" text NOT NULL,
	"modality" text DEFAULT 'OT' NOT NULL,
	"scheduled_procedure_step_id" text,
	"scheduled_ae_title" text,
	"scheduled_station_name" text,
	"scheduled_start_date" text,
	"scheduled_start_time" text,
	"referring_doctor" text,
	"body_part" text,
	"study_description" text,
	"priority" text DEFAULT 'routine' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"duplicate_of_id" integer,
	"resent_at" timestamp with time zone,
	"resent_count" integer DEFAULT 0 NOT NULL,
	"poll_status" text DEFAULT 'pending',
	"poll_error" text,
	"poll_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pacs_storage_tier" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"modality" text DEFAULT 'OT' NOT NULL,
	"current_tier" text DEFAULT 'hot' NOT NULL,
	"previous_tier" text,
	"migrated_at" timestamp with time zone,
	"migrate_reason" text,
	"compression_ratio" integer,
	"is_orphan" boolean DEFAULT false NOT NULL,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"original_study_id" integer,
	"size_bytes" integer,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiologist_macros" (
	"id" serial PRIMARY KEY NOT NULL,
	"radiologist_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"expansion" text NOT NULL,
	"category" text DEFAULT 'general',
	"is_favorite" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiologist_shortcuts" (
	"id" serial PRIMARY KEY NOT NULL,
	"radiologist_id" integer NOT NULL,
	"key_combo" text NOT NULL,
	"action" text NOT NULL,
	"action_params_json" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text,
	"user_role" text,
	"action" text NOT NULL,
	"ip_address" text,
	"device_info" text,
	"session_id" text,
	"details_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "viewer_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text DEFAULT 'CT' NOT NULL,
	"body_part" text,
	"window_center" integer NOT NULL,
	"window_width" integer NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text DEFAULT 'system' NOT NULL,
	"role" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"old_value" text,
	"new_value" text,
	"ip_address" text,
	"user_agent" text,
	"reason" text,
	"previous_hash" text DEFAULT '' NOT NULL,
	"chain_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"module" text NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"can_print" boolean DEFAULT false NOT NULL,
	"can_reprint" boolean DEFAULT false NOT NULL,
	"can_refund" boolean DEFAULT false NOT NULL,
	"can_export" boolean DEFAULT false NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	"can_finalize" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer,
	"module" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"checksum" text,
	"uploaded_by" text DEFAULT 'system' NOT NULL,
	"uploaded_by_id" integer,
	"is_deleted" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_snippets" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"shortcut" text,
	"tags" text[],
	"modality" text,
	"body_part" text,
	"test_keywords" text,
	"title_text" text,
	"technique_text" text,
	"findings_text" text,
	"impression_text" text,
	"advice_text" text,
	"insert_target" text DEFAULT 'findings',
	"merge_priority" integer DEFAULT 0 NOT NULL,
	"abnormal_override" boolean DEFAULT false NOT NULL,
	"is_partial_section" boolean DEFAULT false NOT NULL,
	"expansion_text" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiologist_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"profile_name" text DEFAULT 'Default' NOT NULL,
	"default_master_group" text DEFAULT 'DR_SUGANDHA_MASTER',
	"default_modality" text,
	"default_body_part" text,
	"default_template_ids" jsonb DEFAULT '[]'::jsonb,
	"auto_impression" boolean DEFAULT false,
	"auto_priority" boolean DEFAULT false,
	"show_knowledge_base" boolean DEFAULT true,
	"show_template_packs" boolean DEFAULT true,
	"ai_draft_enabled" boolean DEFAULT false,
	"ai_comparison_enabled" boolean DEFAULT false,
	"ai_voice_enabled" boolean DEFAULT false,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiologist_profiles_staff_id_unique" UNIQUE("staff_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"classification_system" text,
	"classification_grades" jsonb DEFAULT '[]'::jsonb,
	"measurement_references" jsonb DEFAULT '[]'::jsonb,
	"reporting_tips" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_master_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_name" text NOT NULL,
	"template_name" text NOT NULL,
	"modality" text NOT NULL,
	"study_type" text,
	"body_part" text,
	"findings" text NOT NULL,
	"impression" text NOT NULL,
	"recommendations" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"is_locked" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"modified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_personal_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"folder" text DEFAULT 'General' NOT NULL,
	"template_name" text NOT NULL,
	"modality" text,
	"study_type" text,
	"body_part" text,
	"findings" text,
	"impression" text,
	"recommendations" text,
	"measurements" jsonb DEFAULT '[]'::jsonb,
	"macros" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"source_master_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_template_comparison" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"personal_template_id" integer NOT NULL,
	"master_template_id" integer NOT NULL,
	"personal_snapshot" text NOT NULL,
	"master_snapshot" text NOT NULL,
	"differences" jsonb DEFAULT '[]'::jsonb,
	"compared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_template_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_source" text NOT NULL,
	"folder" text DEFAULT 'Favorites',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_template_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"pack_name" text NOT NULL,
	"description" text,
	"modality" text,
	"template_ids" jsonb DEFAULT '[]'::jsonb,
	"template_sources" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_template_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_source" text NOT NULL,
	"template_name" text NOT NULL,
	"modality" text,
	"body_part" text,
	"action" text NOT NULL,
	"study_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"findings" text NOT NULL,
	"impression" text NOT NULL,
	"recommendations" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"change_notes" text,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_favorite_finding_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"set_name" text NOT NULL,
	"builder_type" text NOT NULL,
	"selections" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_impression_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_name" text NOT NULL,
	"builder_type" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"generated_text" text NOT NULL,
	"priority" text DEFAULT 'normal',
	"severity" text DEFAULT 'moderate',
	"version" text DEFAULT 'v1.0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_smart_findings_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"smart_finding_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_text" text,
	"new_text" text,
	"rule_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_smart_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"study_type" text NOT NULL,
	"builder_type" text NOT NULL,
	"selections" jsonb NOT NULL,
	"generated_findings" text,
	"generated_impression" text,
	"rule_version" text DEFAULT 'v1.0' NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_smart_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"worklist_id" integer,
	"feature_type" text NOT NULL,
	"builder_type" text,
	"action" text NOT NULL,
	"duration_ms" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"classification" text NOT NULL,
	"value" text NOT NULL,
	"modality" text,
	"body_part" text,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"suggestion_type" text NOT NULL,
	"suggestion_text" text NOT NULL,
	"action" text NOT NULL,
	"final_text" text,
	"source" text DEFAULT 'ai' NOT NULL,
	"modality" text,
	"body_part" text,
	"order_id" integer,
	"report_id" integer,
	"time_to_decide_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"suggestion_type" text NOT NULL,
	"suggestion_text" text NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"modality" text,
	"body_part" text,
	"order_id" integer,
	"report_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_impressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"finding_signature" text NOT NULL,
	"impression_text" text NOT NULL,
	"modality" text,
	"body_part" text,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"acceptance_count" integer DEFAULT 1 NOT NULL,
	"rejection_count" integer DEFAULT 0 NOT NULL,
	"edit_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"study_id" integer,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"measurement_type" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"reference_range" text,
	"prior_values" jsonb,
	"classification" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"pattern_type" text NOT NULL,
	"key" text NOT NULL,
	"variant" text NOT NULL,
	"chosen_count" integer DEFAULT 1 NOT NULL,
	"alternative_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_phrases" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"trigger" text NOT NULL,
	"phrase" text NOT NULL,
	"phrase_type" text DEFAULT 'finding' NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"acceptance_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"staff_name" text NOT NULL,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"finding_key" text NOT NULL,
	"finding_text" text NOT NULL,
	"impression_text" text,
	"impression_style" text,
	"classification" text,
	"classification_value" text,
	"follow_up_text" text,
	"template_id" integer,
	"template_name" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"order_id" integer,
	"report_id" integer,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"acceptance_count" integer DEFAULT 0 NOT NULL,
	"rejection_count" integer DEFAULT 0 NOT NULL,
	"edit_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_ai_draft" boolean DEFAULT false NOT NULL,
	"ai_label" text DEFAULT 'AI Draft — Requires Radiologist Review',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_memory_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"session_date" text NOT NULL,
	"suggestions_offered" integer DEFAULT 0 NOT NULL,
	"suggestions_accepted" integer DEFAULT 0 NOT NULL,
	"suggestions_rejected" integer DEFAULT 0 NOT NULL,
	"suggestions_edited" integer DEFAULT 0 NOT NULL,
	"templates_used" integer DEFAULT 0 NOT NULL,
	"avg_report_time_ms" integer,
	"autocomplete_used" integer DEFAULT 0 NOT NULL,
	"macros_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_copilot_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_name" text NOT NULL,
	"study_instance_uid" text,
	"suggestion_type" text NOT NULL,
	"suggestion_content" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_lesion_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"lesion_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"study_id" integer,
	"order_id" integer,
	"measurement_mm" real,
	"measurement_mm2" real,
	"measurement_mm3" real,
	"volume_cc" real,
	"series_number" text,
	"image_number" text,
	"slice_location" text,
	"change_status" text,
	"change_percent" real,
	"signal_characteristics" text,
	"enhancement" text,
	"reported_by" text,
	"reported_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_lesions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"lesion_label" text NOT NULL,
	"location" text NOT NULL,
	"organ" text,
	"sub_location" text,
	"modality" text NOT NULL,
	"body_part" text,
	"first_study_id" integer,
	"first_order_id" integer,
	"first_detected_at" timestamp,
	"first_detected_by" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"lesion_type" text,
	"classification" text,
	"classification_value" text,
	"morphology" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"study_id" integer,
	"order_id" integer,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"measurement_type" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"normal_range_low" real,
	"normal_range_high" real,
	"is_abnormal" boolean,
	"notes" text,
	"reported_by" text,
	"reported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_user_copilot_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_name" text NOT NULL,
	"ignored_warnings" text[],
	"favorite_templates" text[],
	"favorite_chocolate_box" text[],
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "radiology_user_copilot_profiles_staff_name_unique" UNIQUE("staff_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "viewer_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"study_id" integer,
	"order_id" integer,
	"study_instance_uid" text NOT NULL,
	"series_instance_uid" text,
	"sop_instance_uid" text,
	"frame_number" integer DEFAULT 1,
	"viewer_name" text NOT NULL,
	"measurement_type" text NOT NULL,
	"value" text NOT NULL,
	"unit" text NOT NULL,
	"slice_number" integer,
	"image_coordinates" text,
	"confidence" real DEFAULT 1,
	"status" text DEFAULT 'pending' NOT NULL,
	"imported_by" text,
	"import_time" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_brain_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"order_id" integer,
	"study_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"modality" text,
	"technique" text,
	"contrast_used" boolean DEFAULT false NOT NULL,
	"clinical_indication" text,
	"midline_shift" numeric(5, 2),
	"midline_shift_direction" text,
	"ventricle_size_status" text,
	"hydrocephalus" text,
	"infarct_present" boolean DEFAULT false NOT NULL,
	"infarct_size_mm" numeric(6, 2),
	"infarct_territory" text,
	"infarct_phase" text,
	"hemorrhage_present" boolean DEFAULT false NOT NULL,
	"hemorrhage_size_mm" numeric(6, 2),
	"hemorrhage_type" text,
	"hemorrhage_location" text,
	"mass_present" boolean DEFAULT false NOT NULL,
	"mass_volume_cc" numeric(8, 3),
	"mass_location" text,
	"mass_enhancement" text,
	"edema_present" boolean DEFAULT false NOT NULL,
	"edema_severity" text,
	"edema_type" text,
	"mass_effect" text,
	"sulcal_efacement" text,
	"cortical_atrophy" text,
	"wm_changes" text,
	"cerebellum_normal" boolean DEFAULT true NOT NULL,
	"brainstem_normal" boolean DEFAULT true NOT NULL,
	"overall_impression" text,
	"recorded_by_id" integer,
	"recorded_by_name" text,
	"study_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_spine_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"level" text NOT NULL,
	"disc_status" text,
	"disc_height" text,
	"canal_diameter" numeric(5, 2),
	"canal_stenosis" text,
	"foraminal_stenosis" text,
	"cord_compression" boolean DEFAULT false NOT NULL,
	"cord_signal_change" boolean DEFAULT false NOT NULL,
	"nerve_root_compression" text,
	"vertebral_collapse" boolean DEFAULT false NOT NULL,
	"compression_fracture" boolean DEFAULT false NOT NULL,
	"fracture_severity" text,
	"modic_change" text,
	"schmorl_node" boolean DEFAULT false NOT NULL,
	"spondylolisthesis" text,
	"facet_arthrosis" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_spine_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"order_id" integer,
	"study_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"modality" text,
	"region" text,
	"technique" text,
	"contrast_used" boolean DEFAULT false NOT NULL,
	"clinical_indication" text,
	"overall_impression" text,
	"recorded_by_id" integer,
	"recorded_by_name" text,
	"study_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_tumor_followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"lesion_id" integer,
	"order_id" integer,
	"study_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"study_date" timestamp with time zone,
	"modality" text,
	"tumor_label" text NOT NULL,
	"tumor_location" text,
	"histology_type" text,
	"size_mm_axis1" numeric(6, 2),
	"size_mm_axis2" numeric(6, 2),
	"size_mm_axis3" numeric(6, 2),
	"volume_cc" numeric(8, 3),
	"change_pct" numeric(6, 2),
	"change_status" text,
	"response_status" text,
	"enhancement_status" text,
	"treatment_phase" text,
	"concurrent_treatment" text,
	"notes" text,
	"recorded_by_id" integer,
	"recorded_by_name" text,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text NOT NULL,
	"series_instance_uid" text,
	"sop_instance_uid" text,
	"frame_number" integer,
	"annotation_type" text NOT NULL,
	"coordinates" jsonb,
	"label_text" text,
	"color" text DEFAULT '#FFFF00',
	"stroke_width" integer DEFAULT 2,
	"linked_teaching_case_id" integer,
	"is_key_annotation" boolean DEFAULT false NOT NULL,
	"order_id" integer,
	"study_id" integer,
	"patient_id" integer,
	"created_by_id" integer NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiology_ai_review_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"modality" text,
	"body_part" text,
	"study_uid" text,
	"order_id" integer,
	"providers_queried" jsonb,
	"winner_provider" text,
	"selected_by_id" integer,
	"selected_by_name" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"staff_id" integer,
	"paired_device_id" text,
	"front_image_url" text,
	"back_image_url" text,
	"ocr_result" text,
	"qr_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scan_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paired_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"device_name" text NOT NULL,
	"staff_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paired_devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" text,
	"method" text NOT NULL,
	"device_id" text,
	"linked_patient_id" integer,
	"linked_form_f_id" integer,
	"status" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_ref" text NOT NULL,
	"patient_name" text NOT NULL,
	"gateway" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"request_payload" text,
	"response_payload" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_dictation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text,
	"study_id" integer,
	"accession_number" text,
	"action" text NOT NULL,
	"duration_secs" integer,
	"word_count" integer,
	"was_ai_cleaned" boolean DEFAULT false NOT NULL,
	"inserted_to_report" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pregnancy_episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"edd" varchar(20),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radiologist_learning_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"learning_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mri_protocol_quality_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"draft_id" integer,
	"protocol_id" integer NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overall_grade" text DEFAULT 'acceptable' NOT NULL,
	"quality_notes" text,
	"completed_by" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mri_protocol_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"protocol_key" text NOT NULL,
	"name" text NOT NULL,
	"modality" text NOT NULL,
	"body_part" text NOT NULL,
	"field_strength_t" text DEFAULT '1.5T/3T' NOT NULL,
	"indications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_scan_time_min" integer,
	"coverage_notes" text,
	"contrast_agent" text,
	"contrast_timing_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"radiologist_notes" text,
	"tech_notes" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "admin_sessions" CASCADE;--> statement-breakpoint
DROP INDEX "tat_study_idx";--> statement-breakpoint
DROP INDEX "tat_modality_idx";--> statement-breakpoint
DROP INDEX "tat_delayed_idx";--> statement-breakpoint
DROP INDEX "tat_radiologist_idx";--> statement-breakpoint
DROP INDEX "tat_sla_idx";--> statement-breakpoint
ALTER TABLE "radiology_report_preferences" ADD COLUMN "print_mode" text DEFAULT 'letterhead' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "diagnostic_tests" ADD COLUMN "outsource_cost" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "order_tests" ADD COLUMN "outsource_cost" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "order_tests" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "original_total" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "qr_scan_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "receipt_verification_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "pdf_download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pacs_network_profile" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_start_page" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_concurrent_sessions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "registered_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "icici_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "icici_merchant_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "icici_aggregator_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "icici_secret_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "kiosk_payment_gateway" text DEFAULT 'upi' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "upi_qr_image_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "upi_vpa" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "upi_qr_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "online_booking_allowed_package_ids" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "session_idle_timeout_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "default_max_concurrent_sessions" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "max_failed_login_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "account_lockout_duration_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "form_f_billing_prompt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "form_f_address_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "form_f_guardian_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "receipt_thank_you_message" text DEFAULT 'Thank you for choosing Care Diagnostics.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "receipt_collection_message" text DEFAULT 'Please collect your reports within 7 days.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "receipt_qr_message" text DEFAULT 'Scan QR code to verify receipt and download reports.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "receipt_promotional_message" text DEFAULT 'Advanced Diagnostic & Imaging Centre.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "service_footer" text DEFAULT '["MRI","CT Scan","Ultrasound","Digital X-Ray","Mammography","Pathology"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_follow_up_message" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "follow_up_message" text DEFAULT 'For future investigations, please quote your Patient ID.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_promotional_footer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "promotional_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "promotional_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_patient_since" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_verified_badge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_audit_info_on_patient_copy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_working_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "working_hours_message" text DEFAULT 'Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_home_collection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "home_collection_message" text DEFAULT 'Home Collection Available. Call us to book.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_emergency" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "emergency_message" text DEFAULT '24x7 Emergency Services Available' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_referral_program" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "referral_program_message" text DEFAULT 'Refer a friend and get 10% off your next visit.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_health_packages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "health_packages_message" text DEFAULT 'Annual Health Checkup packages available at discounted rates.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_accreditation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "accreditation_message" text DEFAULT 'NABL Accredited / ISO 9001:2015 Certified' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_whatsapp_booking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "whatsapp_booking_message" text DEFAULT 'Book appointments on WhatsApp: +91' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "show_custom_footer_message" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "custom_footer_message" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "auto_crop_id_scan" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "auto_rotate_scan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "archive_imported_scans" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "crop_padding" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "jpeg_quality" integer DEFAULT 85 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "max_scan_width" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_base_url" text;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_fallback_url" text;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_model" text;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_local_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_timeout_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_audit_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ollama_known_models" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "online_booking_services" text DEFAULT '{"opd":true,"emergency":true,"usg":true,"xray":true,"ct":true,"mri":true,"pathology":true,"packages":true,"home_collection":true,"doctor":true}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "service_images" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "service_images_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "vip_percentage" numeric(5, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "disclaimer_text" text DEFAULT 'Online booking charges are subject to the centre''s cancellation policy. In case of cancellation after confirmation, administrative charges may be deducted from the refundable amount.' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "disclaimer_refund_percentage" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "disclaimer_cancellation_window_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "disclaimer_display_position" text DEFAULT 'bottom' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "disclaimer_font_size" text DEFAULT 'sm' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "disclaimer_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "mobile_scan_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "phone_pairing_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "preferred_scanner" text DEFAULT 'mobile' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "require_desktop_confirmation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "auto_delete_temp_scans" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "ocr_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "aadhaar_qr_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "scanner_global_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "scan_station_kiosk_mode_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "scan_station_auto_clear_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "scan_station_result_display_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "active_payment_gateway" text DEFAULT 'icici' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "enable_card_payment" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "enable_qr_payment" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "enable_vip_booking" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "enable_payment_logos" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "enable_payment_timer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "custom_icici_banner_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "custom_phonepe_banner_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "custom_bharatpe_banner_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "custom_payu_banner_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "auto_populate_form_f_from_ob_measurements" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "queue_vip_mode" text DEFAULT 'highlighted' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "queue_privacy_mode" text DEFAULT 'masked' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "queue_estimated_wait_per_patient" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "fetal_usg_study_id" integer;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "gestational_age_weeks" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "gestational_age_days" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "id_card_image_url" text;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "id_card_front_url" text;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "id_card_back_url" text;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "id_card_extracted_name" text;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "id_card_extracted_address" text;--> statement-breakpoint
ALTER TABLE "form_f_records" ADD COLUMN "id_card_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "pull_interval_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "query_lookback_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "preferred_retrieve_method" text DEFAULT 'C_MOVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "watch_folder_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "processed_folder_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "failed_folder_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "allow_non_dicom_images" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "max_upload_size_mb" integer DEFAULT 512 NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "thumbnail_preview" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "multi_frame_support" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "acquisition_modes_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_nodes" ADD COLUMN "matching_rules_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "outsource_cost_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "outsource_cost_override" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "outsource_patient_bill" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "outsource_margin" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "total_billed" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "total_refunds" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "total_expenses" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "total_due" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "test_summary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "expense_details" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closures" ADD COLUMN "refund_details" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD COLUMN "pacs_archive_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD COLUMN "pacs_archive_response" text;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD COLUMN "pacs_instance_id" text;--> statement-breakpoint
ALTER TABLE "patient_reports" ADD COLUMN "delivered_by" text;--> statement-breakpoint
ALTER TABLE "patient_reports" ADD COLUMN "style_preset_used" text;--> statement-breakpoint
ALTER TABLE "backup_logs" ADD COLUMN "encrypted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "backup_job_logs" ADD COLUMN "encrypted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "registered_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "age_value" integer;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "age_unit" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "icici_transaction_id" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "icici_provider_ref_id" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "outsourced_labs" ADD COLUMN "cost_type" text DEFAULT 'percent_of_patient_bill' NOT NULL;--> statement-breakpoint
ALTER TABLE "outsourced_labs" ADD COLUMN "cost_percent" numeric(5, 2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "outsourced_labs" ADD COLUMN "cost_fixed" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "ai_feedback" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "ai_feedback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_score" text DEFAULT 'RED' NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_reasons" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_warnings" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_decision" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_approved_by" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "match_override_reason" text;--> statement-breakpoint
ALTER TABLE "dicom_modalities" ADD COLUMN "watch_folder_path" text;--> statement-breakpoint
ALTER TABLE "dicom_modalities" ADD COLUMN "c_store_port" integer;--> statement-breakpoint
ALTER TABLE "dicom_modalities" ADD COLUMN "usb_auto_import_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dicom_modalities" ADD COLUMN "non_dicom_import_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "endpoint_url" text;--> statement-breakpoint
ALTER TABLE "usg_doppler_measurements" ADD COLUMN "provenance_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "usg_doppler_measurements" ADD COLUMN "waveform_sop_instance_uid" text;--> statement-breakpoint
ALTER TABLE "usg_doppler_measurements" ADD COLUMN "waveform_frame_number" integer;--> statement-breakpoint
ALTER TABLE "usg_doppler_measurements" ADD COLUMN "engine_version" text DEFAULT '1.5.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "usg_extraction_logs" ADD COLUMN "provenance_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "pregnancy_episode_id" integer;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "is_approved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "is_rejected" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "usg_key_images" ADD COLUMN "measurement_key" text;--> statement-breakpoint
ALTER TABLE "usg_measurements" ADD COLUMN "provenance_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "usg_measurements" ADD COLUMN "engine_version" text DEFAULT '1.5.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_commission_rules" ADD CONSTRAINT "doctor_commission_rules_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_commission_rules" ADD CONSTRAINT "doctor_commission_rules_rate_card_id_outsource_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."outsource_rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_dispatch_batches" ADD CONSTRAINT "outsource_dispatch_batches_lab_id_outsourced_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."outsourced_labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_orders" ADD CONSTRAINT "outsource_orders_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_orders" ADD CONSTRAINT "outsource_orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_orders" ADD CONSTRAINT "outsource_orders_rate_card_id_outsource_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."outsource_rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_orders" ADD CONSTRAINT "outsource_orders_dispatch_batch_id_outsource_dispatch_batches_id_fk" FOREIGN KEY ("dispatch_batch_id") REFERENCES "public"."outsource_dispatch_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_payments" ADD CONSTRAINT "outsource_payments_lab_id_outsourced_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."outsourced_labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_price_groups" ADD CONSTRAINT "outsource_price_groups_rate_card_id_outsource_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."outsource_rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_rate_cards" ADD CONSTRAINT "outsource_rate_cards_lab_id_outsourced_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."outsourced_labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_reports" ADD CONSTRAINT "outsource_reports_order_id_outsource_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."outsource_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_vendor_invoice_items" ADD CONSTRAINT "outsource_vendor_invoice_items_vendor_invoice_id_outsource_vendor_invoices_id_fk" FOREIGN KEY ("vendor_invoice_id") REFERENCES "public"."outsource_vendor_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_vendor_invoice_items" ADD CONSTRAINT "outsource_vendor_invoice_items_linked_order_id_outsource_orders_id_fk" FOREIGN KEY ("linked_order_id") REFERENCES "public"."outsource_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_vendor_invoices" ADD CONSTRAINT "outsource_vendor_invoices_lab_id_outsourced_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."outsourced_labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsource_vendor_ledger" ADD CONSTRAINT "outsource_vendor_ledger_lab_id_outsourced_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."outsourced_labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetal_usg_audit_logs" ADD CONSTRAINT "fetal_usg_audit_logs_study_id_fetal_usg_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."fetal_usg_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetal_usg_checklists" ADD CONSTRAINT "fetal_usg_checklists_study_id_fetal_usg_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."fetal_usg_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetal_usg_critical_alerts" ADD CONSTRAINT "fetal_usg_critical_alerts_study_id_fetal_usg_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."fetal_usg_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetal_usg_measurements" ADD CONSTRAINT "fetal_usg_measurements_study_id_fetal_usg_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."fetal_usg_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetal_usg_reports" ADD CONSTRAINT "fetal_usg_reports_study_id_fetal_usg_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."fetal_usg_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetal_usg_studies" ADD CONSTRAINT "fetal_usg_studies_study_id_radiology_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."radiology_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiologist_profiles" ADD CONSTRAINT "radiologist_profiles_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_personal_templates" ADD CONSTRAINT "radiology_personal_templates_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_comparison" ADD CONSTRAINT "radiology_template_comparison_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_comparison" ADD CONSTRAINT "radiology_template_comparison_personal_template_id_radiology_personal_templates_id_fk" FOREIGN KEY ("personal_template_id") REFERENCES "public"."radiology_personal_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_comparison" ADD CONSTRAINT "radiology_template_comparison_master_template_id_radiology_master_templates_id_fk" FOREIGN KEY ("master_template_id") REFERENCES "public"."radiology_master_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_favorites" ADD CONSTRAINT "radiology_template_favorites_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_packs" ADD CONSTRAINT "radiology_template_packs_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_usage" ADD CONSTRAINT "radiology_template_usage_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_template_versions" ADD CONSTRAINT "radiology_template_versions_master_template_id_radiology_master_templates_id_fk" FOREIGN KEY ("master_template_id") REFERENCES "public"."radiology_master_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_favorite_finding_sets" ADD CONSTRAINT "radiology_favorite_finding_sets_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_smart_findings_audit" ADD CONSTRAINT "radiology_smart_findings_audit_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_smart_findings" ADD CONSTRAINT "radiology_smart_findings_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_smart_usage" ADD CONSTRAINT "radiology_smart_usage_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancy_episodes" ADD CONSTRAINT "pregnancy_episodes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiologist_learning_settings" ADD CONSTRAINT "radiologist_learning_settings_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_macros_creator_idx" ON "radiology_smart_macros" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_macros_shortcut_idx" ON "radiology_smart_macros" USING btree ("shortcut");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_macros_modality_idx" ON "radiology_smart_macros" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_macros_body_part_idx" ON "radiology_smart_macros" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spinal_measurements_study_idx" ON "spinal_measurements" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spinal_measurements_draft_idx" ON "spinal_measurements" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spinal_measurements_level_idx" ON "spinal_measurements" USING btree ("vertebra_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spinal_measurements_stenosis_idx" ON "spinal_measurements" USING btree ("stenosis_grade");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_study_locks_study_id_uq" ON "radiology_study_locks" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_study_locks_study_id_idx" ON "radiology_study_locks" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_study_locks_user_id_idx" ON "radiology_study_locks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_tpl_modality_idx" ON "ai_prompt_templates" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_tpl_active_idx" ON "ai_prompt_templates" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_prompt_tpl_name_uq" ON "ai_prompt_templates" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_lib_modality_idx" ON "ai_prompt_library" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_lib_owner_idx" ON "ai_prompt_library" USING btree ("library_owner");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_lib_active_idx" ON "ai_prompt_library" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_prompt_lib_name_owner_uq" ON "ai_prompt_library" USING btree ("name","library_owner");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_lib_ver_lib_id_idx" ON "ai_prompt_library_versions" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_prompt_lib_ver_ver_idx" ON "ai_prompt_library_versions" USING btree ("library_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_history_patient_idx" ON "measurement_history" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_history_type_idx" ON "measurement_history" USING btree ("measurement_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_history_study_idx" ON "measurement_history" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_case_collections_owner_idx" ON "teaching_case_collections" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teaching_case_favorites_uq" ON "teaching_case_favorites" USING btree ("teaching_case_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_case_images_case_idx" ON "teaching_case_images" USING btree ("teaching_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_case_images_key_idx" ON "teaching_case_images" USING btree ("is_key_image");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_case_notes_case_idx" ON "teaching_case_notes" USING btree ("teaching_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_case_views_case_idx" ON "teaching_case_views" USING btree ("teaching_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_category_idx" ON "teaching_cases" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_difficulty_idx" ON "teaching_cases" USING btree ("difficulty");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_status_idx" ON "teaching_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_modality_idx" ON "teaching_cases" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_body_part_idx" ON "teaching_cases" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_diagnosis_idx" ON "teaching_cases" USING btree ("diagnosis");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_created_by_idx" ON "teaching_cases" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teaching_cases_research_idx" ON "teaching_cases" USING btree ("is_research_candidate");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_routes_task_uq" ON "ai_model_routes" USING btree ("task_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_qs_scope_key_idx" ON "ai_quality_scores" USING btree ("scope","scope_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_qs_date_idx" ON "ai_quality_scores" USING btree ("date_from","date_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_qs_computed_idx" ON "ai_quality_scores" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_dicom_findings_wl_idx" ON "ai_dicom_findings" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_dicom_findings_uid_idx" ON "ai_dicom_findings" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_dicom_findings_status_idx" ON "ai_dicom_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_doc_doc_id_idx" ON "rag_document_embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_doc_type_idx" ON "rag_document_embeddings" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_doc_modality_idx" ON "rag_document_embeddings" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_doc_patient_idx" ON "rag_document_embeddings" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_search_query_idx" ON "rag_search_queries" USING btree ("query_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_search_user_idx" ON "rag_search_queries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anomaly_alert_type_idx" ON "anomaly_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anomaly_alert_severity_idx" ON "anomaly_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anomaly_alert_status_idx" ON "anomaly_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anomaly_alert_scope_idx" ON "anomaly_alerts" USING btree ("scope","related_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rtv_template_idx" ON "report_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rtv_version_idx" ON "report_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_billing_wl_idx" ON "ai_billing_suggestions" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_billing_status_idx" ON "ai_billing_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pra_report_idx" ON "peer_review_assignments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pra_assignee_idx" ON "peer_review_assignments" USING btree ("assigned_to_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pra_status_idx" ON "peer_review_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tat_wl_idx" ON "turnaround_times" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tat_date_idx" ON "turnaround_times" USING btree ("date_bucket");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tat_modality_idx" ON "turnaround_times" USING btree ("modality","date_bucket");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tat_rad_idx" ON "turnaround_times" USING btree ("radiologist_id","date_bucket");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tde_status_idx" ON "ai_training_data_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tde_name_idx" ON "ai_training_data_exports" USING btree ("export_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rqg_report_idx" ON "report_quality_gates" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rqg_passed_idx" ON "report_quality_gates" USING btree ("all_passed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cf_report_idx" ON "critical_findings" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cf_status_idx" ON "critical_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cf_patient_idx" ON "critical_findings" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aphl_provider_idx" ON "ai_provider_health_logs" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aphl_status_idx" ON "ai_provider_health_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aphl_created_idx" ON "ai_provider_health_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_audit_study_idx" ON "echo_audit_logs" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_measurements_study_idx" ON "echo_measurements" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_measurements_patient_idx" ON "echo_measurements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_wall_study_idx" ON "echo_regional_walls" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_reports_study_idx" ON "echo_reports" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_reports_status_idx" ON "echo_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "echo_valve_study_idx" ON "echo_valve_assessment" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetal_echo_audit_study_idx" ON "fetal_echo_audit_logs" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetal_echo_study_idx" ON "fetal_echo_studies" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetal_echo_status_idx" ON "fetal_echo_studies" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_type_idx" ON "backup_verification" USING btree ("backup_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_status_idx" ON "backup_verification" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esc_finding_idx" ON "critical_escalation_log" USING btree ("critical_finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esc_status_idx" ON "critical_escalation_log" USING btree ("resolution_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retry_op_type_idx" ON "dicom_retry_queue" USING btree ("operation_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retry_status_idx" ON "dicom_retry_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retry_entity_idx" ON "dicom_retry_queue" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_draft_idx" ON "report_delivery_tracking" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_study_idx" ON "report_delivery_tracking" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_date_idx" ON "storage_metrics" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_alert_idx" ON "storage_metrics" USING btree ("alert_triggered");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_snap_idx" ON "system_health_snapshot" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_api_idx" ON "system_health_snapshot" USING btree ("api_health");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_job_study_idx" ON "ai_job_queue" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_job_status_idx" ON "ai_job_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_job_type_idx" ON "ai_job_queue" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_uid_idx" ON "dicom_incoming_studies" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_status_idx" ON "dicom_incoming_studies" USING btree ("transfer_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_modality_idx" ON "dicom_incoming_studies" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_accession_idx" ON "dicom_incoming_studies" USING btree ("accession_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mwl_accession_idx" ON "mwl_entries" USING btree ("accession_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mwl_status_idx" ON "mwl_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mwl_patient_idx" ON "mwl_entries" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mwl_mod_date_idx" ON "mwl_entries" USING btree ("modality","scheduled_start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tier_study_idx" ON "pacs_storage_tier" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tier_current_idx" ON "pacs_storage_tier" USING btree ("current_tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "macro_rad_idx" ON "radiologist_macros" USING btree ("radiologist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "macro_trigger_idx" ON "radiologist_macros" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shortcut_rad_idx" ON "radiologist_shortcuts" USING btree ("radiologist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_study_idx" ON "study_access_log" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_user_idx" ON "study_access_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_action_idx" ON "study_access_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_modality_idx" ON "viewer_presets" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_module_idx" ON "audit_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_chain_hash_idx" ON "audit_logs" USING btree ("chain_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_module_unique_idx" ON "role_permissions" USING btree ("role","module");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_patient_idx" ON "upload_files" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_module_idx" ON "upload_files" USING btree ("module");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_created_idx" ON "upload_files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rad_snippets_type_idx" ON "radiology_snippets" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rad_snippets_new_modality_idx" ON "radiology_snippets" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rad_snippets_new_body_part_idx" ON "radiology_snippets" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rad_snippets_new_active_idx" ON "radiology_snippets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rad_snippets_new_creator_idx" ON "radiology_snippets" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rad_snippets_new_sort_idx" ON "radiology_snippets" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiologist_profiles_staff_idx" ON "radiologist_profiles" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_kb_category_idx" ON "radiology_knowledge_base" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_kb_classification_idx" ON "radiology_knowledge_base" USING btree ("classification_system");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_kb_active_idx" ON "radiology_knowledge_base" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_master_group_name_uq" ON "radiology_master_templates" USING btree ("group_name","template_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_master_group_idx" ON "radiology_master_templates" USING btree ("group_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_master_modality_idx" ON "radiology_master_templates" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_master_bodypart_idx" ON "radiology_master_templates" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_master_studytype_idx" ON "radiology_master_templates" USING btree ("study_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_master_active_idx" ON "radiology_master_templates" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_personal_staff_folder_uq" ON "radiology_personal_templates" USING btree ("staff_id","folder","template_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_personal_staff_idx" ON "radiology_personal_templates" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_personal_folder_idx" ON "radiology_personal_templates" USING btree ("folder");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_personal_modality_idx" ON "radiology_personal_templates" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_personal_bodypart_idx" ON "radiology_personal_templates" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_comparison_staff_idx" ON "radiology_template_comparison" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_template_favorites_uq" ON "radiology_template_favorites" USING btree ("staff_id","template_id","template_source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_favorites_staff_idx" ON "radiology_template_favorites" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_template_packs_staff_uq" ON "radiology_template_packs" USING btree ("staff_id","pack_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_packs_staff_idx" ON "radiology_template_packs" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_usage_staff_idx" ON "radiology_template_usage" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_usage_template_idx" ON "radiology_template_usage" USING btree ("template_id","template_source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_usage_action_idx" ON "radiology_template_usage" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_usage_date_idx" ON "radiology_template_usage" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_template_versions_uq" ON "radiology_template_versions" USING btree ("master_template_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_template_versions_master_idx" ON "radiology_template_versions" USING btree ("master_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_favorite_sets_staff_uq" ON "radiology_favorite_finding_sets" USING btree ("staff_id","set_name","builder_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_favorite_sets_staff_idx" ON "radiology_favorite_finding_sets" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_favorite_sets_builder_idx" ON "radiology_favorite_finding_sets" USING btree ("builder_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_impression_rules_builder_idx" ON "radiology_impression_rules" USING btree ("builder_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_impression_rules_active_idx" ON "radiology_impression_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_audit_finding_idx" ON "radiology_smart_findings_audit" USING btree ("smart_finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_audit_staff_idx" ON "radiology_smart_findings_audit" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radiology_smart_findings_worklist_uq" ON "radiology_smart_findings" USING btree ("worklist_id","builder_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_findings_worklist_idx" ON "radiology_smart_findings" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_findings_staff_idx" ON "radiology_smart_findings" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_findings_studytype_idx" ON "radiology_smart_findings" USING btree ("study_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_findings_active_idx" ON "radiology_smart_findings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_usage_staff_idx" ON "radiology_smart_usage" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_usage_feature_idx" ON "radiology_smart_usage" USING btree ("feature_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_usage_builder_idx" ON "radiology_smart_usage" USING btree ("builder_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_smart_usage_generated_idx" ON "radiology_smart_usage" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classification_staff_idx" ON "radiology_memory_classifications" USING btree ("staff_id","classification");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classification_value_idx" ON "radiology_memory_classifications" USING btree ("value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_staff_type_idx" ON "radiology_memory_decisions" USING btree ("staff_id","suggestion_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_action_idx" ON "radiology_memory_decisions" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_created_idx" ON "radiology_memory_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_staff_rating_idx" ON "radiology_memory_feedback" USING btree ("staff_id","rating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_suggestion_idx" ON "radiology_memory_feedback" USING btree ("suggestion_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "impression_staff_signature_idx" ON "radiology_memory_impressions" USING btree ("staff_id","finding_signature");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "impression_body_part_idx" ON "radiology_memory_impressions" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_staff_patient_idx" ON "radiology_memory_measurements" USING btree ("staff_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_type_idx" ON "radiology_memory_measurements" USING btree ("measurement_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_study_idx" ON "radiology_memory_measurements" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pattern_staff_type_idx" ON "radiology_memory_patterns" USING btree ("staff_id","pattern_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pattern_key_idx" ON "radiology_memory_patterns" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrase_staff_trigger_idx" ON "radiology_memory_phrases" USING btree ("staff_id","trigger");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phrase_type_idx" ON "radiology_memory_phrases" USING btree ("phrase_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_staff_modality_idx" ON "radiology_memory" USING btree ("staff_id","modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_body_part_idx" ON "radiology_memory" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_finding_key_idx" ON "radiology_memory" USING btree ("finding_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_usage_count_idx" ON "radiology_memory" USING btree ("usage_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_last_used_idx" ON "radiology_memory" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_staff_date_idx" ON "radiology_memory_usage" USING btree ("staff_id","session_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_date_idx" ON "radiology_memory_usage" USING btree ("session_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_lesion_timeline_lesion_idx" ON "radiology_lesion_timeline" USING btree ("lesion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_lesion_timeline_patient_idx" ON "radiology_lesion_timeline" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_lesion_timeline_study_idx" ON "radiology_lesion_timeline" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_lesions_patient_idx" ON "radiology_lesions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_lesions_status_idx" ON "radiology_lesions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_measurements_patient_idx" ON "radiology_measurements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_measurements_study_idx" ON "radiology_measurements" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_measurements_modality_idx" ON "radiology_measurements" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "viewer_measurements_study_uid_idx" ON "viewer_measurements" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "viewer_measurements_patient_idx" ON "viewer_measurements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_brain_sessions_patient_idx" ON "radiology_brain_sessions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_brain_sessions_order_idx" ON "radiology_brain_sessions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_spine_levels_session_idx" ON "radiology_spine_levels" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_spine_levels_patient_idx" ON "radiology_spine_levels" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_spine_levels_level_idx" ON "radiology_spine_levels" USING btree ("level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_spine_sessions_patient_idx" ON "radiology_spine_sessions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_spine_sessions_order_idx" ON "radiology_spine_sessions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_tumor_followups_patient_idx" ON "radiology_tumor_followups" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_tumor_followups_lesion_idx" ON "radiology_tumor_followups" USING btree ("lesion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_tumor_followups_order_idx" ON "radiology_tumor_followups" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_annotations_study_idx" ON "radiology_annotations" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_annotations_series_idx" ON "radiology_annotations" USING btree ("series_instance_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_annotations_teaching_case_idx" ON "radiology_annotations" USING btree ("linked_teaching_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_annotations_order_idx" ON "radiology_annotations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radiology_annotations_patient_idx" ON "radiology_annotations" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_pq_results_study_idx" ON "mri_protocol_quality_results" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_pq_results_draft_idx" ON "mri_protocol_quality_results" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_pq_results_protocol_idx" ON "mri_protocol_quality_results" USING btree ("protocol_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mri_protocol_specs_key_uq" ON "mri_protocol_specs" USING btree ("protocol_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_protocol_specs_modality_idx" ON "mri_protocol_specs" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_protocol_specs_body_part_idx" ON "mri_protocol_specs" USING btree ("body_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mri_protocol_specs_active_idx" ON "mri_protocol_specs" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "form_f_records" ADD CONSTRAINT "form_f_records_fetal_usg_study_id_fetal_usg_studies_id_fk" FOREIGN KEY ("fetal_usg_study_id") REFERENCES "public"."fetal_usg_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_sessions_subject_idx" ON "portal_sessions" USING btree ("scope","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_sessions_created_idx" ON "portal_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_reports_delivered_idx" ON "patient_reports" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_tat_metrics_study_idx" ON "study_tat_metrics" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_tat_metrics_modality_idx" ON "study_tat_metrics" USING btree ("modality");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_tat_metrics_delayed_idx" ON "study_tat_metrics" USING btree ("is_delayed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_tat_metrics_radiologist_idx" ON "study_tat_metrics" USING btree ("radiologist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_tat_metrics_sla_idx" ON "study_tat_metrics" USING btree ("sla_breached");--> statement-breakpoint
ALTER TABLE "dicom_nodes" DROP COLUMN "pull_interval_minutes";--> statement-breakpoint
ALTER TABLE "dicom_nodes" DROP COLUMN "pull_query_days";