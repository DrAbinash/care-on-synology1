CREATE TABLE "radiologist_style_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"impression_style" text DEFAULT 'concise' NOT NULL,
	"terminology_level" text DEFAULT 'standard' NOT NULL,
	"auto_number_impressions" boolean DEFAULT true NOT NULL,
	"include_differential" boolean DEFAULT false NOT NULL,
	"include_measurements" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiologist_style_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "radiology_image_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"study_id" integer,
	"series_number" text,
	"image_number" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_normal_snippets" (
	"id" serial PRIMARY KEY NOT NULL,
	"shortcut" text NOT NULL,
	"label" text NOT NULL,
	"modality" text,
	"body_part" text,
	"text" text NOT NULL,
	"impression" text,
	"recommendation" text,
	"is_global" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_report_lifecycle_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"draft_id" integer,
	"action" text NOT NULL,
	"actor_id" integer,
	"actor_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_report_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"heading_case" text DEFAULT 'all_caps' NOT NULL,
	"section_spacing" text DEFAULT 'spaced' NOT NULL,
	"impression_style" text DEFAULT 'bulleted' NOT NULL,
	"show_end_of_report_footer" boolean DEFAULT true NOT NULL,
	"footer_text" text,
	"header_line_1" text,
	"header_line_2_source" text DEFAULT 'template_name' NOT NULL,
	"header_line_2_custom" text,
	"workspace_layout" text DEFAULT '3_panel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiology_report_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "radiology_text_macros" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"shortcut" text NOT NULL,
	"expansion" text NOT NULL,
	"modality" text,
	"is_global" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"phone" text,
	"conversation_id" integer,
	"amount" integer,
	"status" text NOT NULL,
	"details" text,
	"performed_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_bot_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"current_step" text DEFAULT 'main_menu' NOT NULL,
	"context_json" text DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"patient_id" integer,
	"doctor_id" integer,
	"staff_user_id" integer,
	"contact_type" text DEFAULT 'unknown' NOT NULL,
	"consent_status" text DEFAULT 'pending' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_contacts_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "wa_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'bot' NOT NULL,
	"current_flow" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone,
	"assigned_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"direction" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"message_text" text,
	"template_name" text,
	"media_url" text,
	"provider_message_id" text,
	"status" text DEFAULT 'delivered' NOT NULL,
	"raw_payload_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_name" text NOT NULL,
	"category" text DEFAULT 'UTILITY' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"use_case" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"last_pulled_at" timestamp with time zone,
	"last_pushed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_checkpoints_table_name_unique" UNIQUE("table_name")
);
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"local_id" integer,
	"cloud_id" integer,
	"payload" jsonb,
	"conflict_strategy" text DEFAULT 'server_wins' NOT NULL,
	"is_synced" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"bill_id" integer,
	"payment_id" integer,
	"bank_transaction_id" integer,
	"user_id" integer,
	"user_name" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"affected_amount" numeric(14, 2),
	"evidence" jsonb,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_transaction_id" text,
	"external_order_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gateway_fee" numeric(14, 2),
	"tax_on_fee" numeric(14, 2),
	"net_settled" numeric(14, 2),
	"settlement_utr" text,
	"settlement_date" timestamp with time zone,
	"settlement_status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"method_detail" text,
	"payer_vpa" text,
	"payer_phone" text,
	"bill_id" integer,
	"payment_id" integer,
	"status" text DEFAULT 'initiated' NOT NULL,
	"failure_reason" text,
	"raw_payload" jsonb,
	"reconciliation_status" text DEFAULT 'unreconciled' NOT NULL,
	"bank_transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_transaction_id" integer NOT NULL,
	"bill_id" integer,
	"payment_id" integer,
	"voucher_id" integer,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"match_strategy" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_reason" text,
	"auto_closed" boolean DEFAULT false NOT NULL,
	"auto_closed_amount" numeric(14, 2),
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"match_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_by_id" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"approved_by" text,
	"approved_by_id" integer,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"gateway_refund_id" text,
	"gateway_refund_status" text,
	"gateway_refund_raw" jsonb,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"shift_label" text DEFAULT 'Morning' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"expected_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_upi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_card" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_cheque" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_upi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_card" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_cheque" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_note" text DEFAULT '' NOT NULL,
	"denominations" jsonb DEFAULT 'null'::jsonb,
	"denomination_total" numeric(12, 2),
	"bank_deposit_amount" numeric(12, 2),
	"bank_deposit_ref" text,
	"supervisor_id" integer,
	"supervisor_name" text,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"user_day_closure_id" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_server_health_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"endpoint" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"latency_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"http_status" integer,
	"tokens_used" integer,
	"quota_remaining" integer,
	"check_type" text DEFAULT 'actual_call' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "critical_findings_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"study_id" integer,
	"accession_number" text NOT NULL,
	"patient_id" integer,
	"patient_name" text NOT NULL,
	"modality" text DEFAULT 'OT' NOT NULL,
	"study_description" text,
	"severity" text DEFAULT 'high' NOT NULL,
	"finding_type" text NOT NULL,
	"description" text NOT NULL,
	"flagged_by" text NOT NULL,
	"flagged_by_id" integer,
	"ai_confidence" numeric(3, 2),
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"escalated_to" text,
	"escalation_sent" boolean DEFAULT false NOT NULL,
	"notification_channels" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pacs_archive_lifecycle" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text NOT NULL,
	"accession_number" text,
	"modality" text,
	"patient_id" integer,
	"original_size_bytes" numeric(20, 0),
	"compressed_size_bytes" numeric(20, 0),
	"compression_ratio" numeric(5, 2),
	"compression_method" text,
	"tier" text DEFAULT 'hot' NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"moved_to_tier_at" timestamp with time zone,
	"scheduled_for_archive_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"restore_count" integer DEFAULT 0 NOT NULL,
	"auto_compressed" boolean DEFAULT false NOT NULL,
	"retention_days" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pacs_archive_lifecycle_study_instance_uid_unique" UNIQUE("study_instance_uid")
);
--> statement-breakpoint
CREATE TABLE "radiologist_performance_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"radiologist_id" integer NOT NULL,
	"radiologist_name" text NOT NULL,
	"period_type" text DEFAULT 'daily' NOT NULL,
	"period_date" text NOT NULL,
	"total_studies" integer DEFAULT 0 NOT NULL,
	"reported_studies" integer DEFAULT 0 NOT NULL,
	"preliminary_reports" integer DEFAULT 0 NOT NULL,
	"final_reports" integer DEFAULT 0 NOT NULL,
	"avg_tat_minutes" integer,
	"stat_studies" integer DEFAULT 0 NOT NULL,
	"emergency_studies" integer DEFAULT 0 NOT NULL,
	"routine_studies" integer DEFAULT 0 NOT NULL,
	"ai_drafts_used" integer DEFAULT 0 NOT NULL,
	"ai_drafts_accepted" integer DEFAULT 0 NOT NULL,
	"critical_findings_flagged" integer DEFAULT 0 NOT NULL,
	"modality_breakdown" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ris_sync_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_type" text NOT NULL,
	"source_system" text NOT NULL,
	"target_system" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone,
	"items_pending" integer DEFAULT 0 NOT NULL,
	"items_synced" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"avg_sync_time_ms" integer,
	"error_message" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchdog_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_name" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"last_error" text,
	"restart_count" integer DEFAULT 0 NOT NULL,
	"max_restarts" integer DEFAULT 5 NOT NULL,
	"auto_restart_enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"check_interval_seconds" integer DEFAULT 60 NOT NULL,
	"next_check_at" timestamp with time zone,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchdog_status_service_name_unique" UNIQUE("service_name")
);
--> statement-breakpoint
CREATE TABLE "usg_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"action" text NOT NULL,
	"performed_by" text NOT NULL,
	"performed_by_id" integer,
	"performed_by_role" text,
	"study_instance_uid" text,
	"patient_id" integer,
	"details" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_doppler_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"patient_id" integer,
	"extraction_run_id" integer,
	"vessel_name" text DEFAULT '' NOT NULL,
	"side" text DEFAULT 'unknown' NOT NULL,
	"psv" text,
	"edv" text,
	"ri" text,
	"pi" text,
	"sd_ratio" text,
	"waveform_label" text,
	"waveform_description" text,
	"confidence" text DEFAULT 'low' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_extraction_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"extraction_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"frames_processed" integer DEFAULT 0 NOT NULL,
	"frames_failed" integer DEFAULT 0 NOT NULL,
	"sr_found" boolean DEFAULT false NOT NULL,
	"ai_normalized" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"triggered_by" text DEFAULT 'auto' NOT NULL,
	"triggered_by_user_id" integer,
	"raw_ocr_text_json" text,
	"raw_sr_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usg_extraction_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"ocr_enabled" boolean DEFAULT true NOT NULL,
	"ai_normalize_enabled" boolean DEFAULT true NOT NULL,
	"sr_priority_mode" boolean DEFAULT true NOT NULL,
	"auto_reject_low_confidence" boolean DEFAULT true NOT NULL,
	"human_review_required" boolean DEFAULT true NOT NULL,
	"auto_finalize" boolean DEFAULT false NOT NULL,
	"confidence_threshold" real DEFAULT 0.8 NOT NULL,
	"low_confidence_cutoff" real DEFAULT 0.6 NOT NULL,
	"max_frames_to_ocr" integer DEFAULT 20 NOT NULL,
	"ge_ae_title" text DEFAULT 'GE_USG' NOT NULL,
	"ge_ip" text DEFAULT '' NOT NULL,
	"ge_port" text DEFAULT '11112' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_finding_image_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"finding_index" integer DEFAULT 0 NOT NULL,
	"image_id" integer NOT NULL,
	"frame_number" integer,
	"annotation_label" text,
	"measurement_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_key_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"patient_id" integer,
	"series_instance_uid" text,
	"sop_instance_uid" text,
	"series_number" text,
	"image_number" text,
	"frame_number" integer DEFAULT 1 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"wado_url" text,
	"thumbnail_base64" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_by" text,
	"added_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_machine_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"machine_name" text NOT NULL,
	"manufacturer" text DEFAULT 'GE' NOT NULL,
	"model_name" text,
	"ae_title" text,
	"ip_address" text,
	"port" text DEFAULT '11112' NOT NULL,
	"modality" text DEFAULT 'USG' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"capabilities" text DEFAULT '[]' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"study_id" integer,
	"study_instance_uid" text,
	"accession_number" text,
	"patient_id" integer,
	"extraction_run_id" integer,
	"source" text DEFAULT 'ocr' NOT NULL,
	"overall_confidence" text DEFAULT 'low' NOT NULL,
	"bpd" text,
	"bpd_confidence" text,
	"hc" text,
	"hc_confidence" text,
	"ac" text,
	"ac_confidence" text,
	"fl" text,
	"fl_confidence" text,
	"crl" text,
	"crl_confidence" text,
	"efw" text,
	"efw_confidence" text,
	"ga" text,
	"ga_confidence" text,
	"edd" text,
	"edd_confidence" text,
	"fhr" text,
	"fhr_confidence" text,
	"placenta_position" text,
	"liquor_afi" text,
	"fetal_presentation" text,
	"uterus_size" text,
	"uterus_size_confidence" text,
	"endometrium" text,
	"endometrium_confidence" text,
	"right_ovary" text,
	"right_ovary_confidence" text,
	"left_ovary" text,
	"left_ovary_confidence" text,
	"follicles" text,
	"adnexal_lesion" text,
	"liver_size" text,
	"liver_size_confidence" text,
	"spleen_size" text,
	"spleen_size_confidence" text,
	"right_kidney" text,
	"right_kidney_confidence" text,
	"left_kidney" text,
	"left_kidney_confidence" text,
	"cbd" text,
	"cbd_confidence" text,
	"gb_wall" text,
	"gb_wall_confidence" text,
	"prostate_volume" text,
	"prostate_volume_confidence" text,
	"right_kidney_length_mm" real,
	"right_kidney_width_mm" real,
	"right_kidney_thickness_mm" real,
	"left_kidney_length_mm" real,
	"left_kidney_width_mm" real,
	"left_kidney_thickness_mm" real,
	"right_cortical_thickness_mm" real,
	"left_cortical_thickness_mm" real,
	"prostate_length_mm" real,
	"prostate_width_mm" real,
	"prostate_height_mm" real,
	"thyroid_right_lobe_length_mm" real,
	"thyroid_right_lobe_width_mm" real,
	"thyroid_right_lobe_thickness_mm" real,
	"thyroid_left_lobe_length_mm" real,
	"thyroid_left_lobe_width_mm" real,
	"thyroid_left_lobe_thickness_mm" real,
	"thyroid_isthmus_mm" real,
	"thyroid_nodule_size_mm" real,
	"thyroid_tirads_score" text,
	"liver_span_mm" real,
	"cbd_mm" real,
	"gb_wall_mm" real,
	"uterus_length_mm" real,
	"uterus_width_mm" real,
	"uterus_height_mm" real,
	"right_ovary_length_mm" real,
	"right_ovary_width_mm" real,
	"right_ovary_height_mm" real,
	"left_ovary_length_mm" real,
	"left_ovary_width_mm" real,
	"left_ovary_height_mm" real,
	"follicle_count" integer,
	"largest_follicle_mm" real,
	"extra_measurements_json" text DEFAULT '{}' NOT NULL,
	"manufacturer" text,
	"manufacturer_model" text,
	"institution_name" text,
	"study_description" text,
	"study_date" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_report_amendments" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"prior_version_id" integer NOT NULL,
	"amendment_reason" text DEFAULT '' NOT NULL,
	"amended_by" text NOT NULL,
	"amended_by_id" integer,
	"prior_content" text DEFAULT '' NOT NULL,
	"new_content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usg_report_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"worklist_id" integer,
	"study_instance_uid" text,
	"patient_id" integer,
	"accession_number" text,
	"template_type" text DEFAULT 'WHOLE_ABDOMEN' NOT NULL,
	"draft_content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"auto_filled_from_measurement_id" integer,
	"auto_filled_from_doppler_id" integer,
	"created_by" text,
	"verified_by" text,
	"finalized_by" text,
	"amended_by" text,
	"prior_version_id" integer,
	"critical_alert_id" integer,
	"finalized_report_hash" text,
	"finalized_pdf_version_id" text,
	"amendment_reason" text,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"amended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_extraction_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"extraction_type" text NOT NULL,
	"source_data" text,
	"extracted_data" text,
	"confidence" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"is_ai_suggested" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_instance_uid" text NOT NULL,
	"series_instance_uid" text,
	"sop_instance_uid" text,
	"accession_number" text,
	"patient_id" integer,
	"dicom_patient_id" text,
	"patient_name" text NOT NULL,
	"patient_age" text,
	"patient_sex" text,
	"modality" text DEFAULT 'OT' NOT NULL,
	"study_date" text,
	"study_time" text,
	"referring_doctor" text,
	"performing_technician" text,
	"study_description" text,
	"body_part_examined" text,
	"institution_name" text,
	"station_name" text,
	"number_of_series" integer DEFAULT 0 NOT NULL,
	"number_of_images" integer DEFAULT 0 NOT NULL,
	"ingest_status" text DEFAULT 'pending' NOT NULL,
	"ingest_error" text,
	"ingest_source" text DEFAULT 'orthanc' NOT NULL,
	"linked_report_id" integer,
	"linked_bill_id" integer,
	"linked_order_id" integer,
	"link_status" text DEFAULT 'unlinked' NOT NULL,
	"link_confidence" text,
	"link_reason" text,
	"assigned_radiologist_id" integer,
	"assigned_radiologist_name" text,
	"assigned_technician_id" integer,
	"assigned_technician_name" text,
	"priority" text DEFAULT 'routine' NOT NULL,
	"priority_reason" text,
	"pacs_source" text DEFAULT 'orthanc' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"sync_retry_count" integer DEFAULT 0 NOT NULL,
	"report_status" text DEFAULT 'not_started' NOT NULL,
	"report_id" integer,
	"dicom_metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dicom_studies_study_instance_uid_unique" UNIQUE("study_instance_uid")
);
--> statement-breakpoint
CREATE TABLE "dicom_study_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"study_instance_uid" text,
	"action" text NOT NULL,
	"actor_id" integer,
	"actor_name" text,
	"actor_role" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_study_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"series_instance_uid" text NOT NULL,
	"series_number" integer DEFAULT 1 NOT NULL,
	"modality" text,
	"series_description" text,
	"body_part_examined" text,
	"number_of_images" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hanging_protocols" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text NOT NULL,
	"body_part_examined" text,
	"study_description_pattern" text,
	"preferred_viewer_layout" text DEFAULT 'default' NOT NULL,
	"suggested_report_template" text,
	"required_measurement_checklist" text,
	"normal_template_body" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hanging_protocols_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "modality_routing_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"modality_code" text NOT NULL,
	"module_path" text NOT NULL,
	"module_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"auto_route_on_ingest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modality_routing_map_modality_code_unique" UNIQUE("modality_code")
);
--> statement-breakpoint
CREATE TABLE "technician_workflow" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"scan_started_at" timestamp with time zone,
	"scan_completed_at" timestamp with time zone,
	"technician_notes" text,
	"image_quality" text,
	"repeat_reason" text,
	"patient_cooperation" text,
	"contrast_used" boolean DEFAULT false NOT NULL,
	"contrast_name" text,
	"contrast_dose" text,
	"adverse_reaction" boolean DEFAULT false NOT NULL,
	"reaction_notes" text,
	"technician_id" integer,
	"technician_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technician_workflow_study_id_unique" UNIQUE("study_id")
);
--> statement-breakpoint
CREATE TABLE "ai_impressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer,
	"report_draft_id" integer,
	"modality" text NOT NULL,
	"findings_text" text,
	"ai_generated_impression" text,
	"edited_impression" text,
	"is_ai_suggested" boolean DEFAULT true NOT NULL,
	"verified_by_id" integer,
	"verified_by_name" text,
	"verified_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicom_sr_export_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"report_draft_id" integer,
	"measurements_json" text,
	"export_status" text DEFAULT 'pending' NOT NULL,
	"pacs_destination_ae_title" text,
	"pacs_destination_host" text,
	"pacs_destination_port" integer,
	"dicom_sop_instance_uid" text,
	"export_attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_attempted_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"requested_by_id" integer,
	"requested_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_draft_id" integer NOT NULL,
	"study_id" integer,
	"trigger_rule" text NOT NULL,
	"recommendation_text" text NOT NULL,
	"priority" text DEFAULT 'routine' NOT NULL,
	"is_ai_suggested" boolean DEFAULT true NOT NULL,
	"edited_text" text,
	"accepted" boolean DEFAULT false NOT NULL,
	"accepted_by_id" integer,
	"accepted_by_name" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_amendments" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_draft_id" integer NOT NULL,
	"study_id" integer,
	"prior_content" text NOT NULL,
	"prior_version_hash" text,
	"addendum_text" text NOT NULL,
	"amendment_reason" text NOT NULL,
	"amended_by_id" integer,
	"amended_by_name" text,
	"amended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"new_content" text NOT NULL,
	"new_version_hash" text,
	"amendment_label" text DEFAULT 'AMENDED' NOT NULL,
	"sequence_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_quality_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_draft_id" integer NOT NULL,
	"study_id" integer,
	"overall_result" text DEFAULT 'pending' NOT NULL,
	"missing_impression" boolean DEFAULT false NOT NULL,
	"missing_findings" boolean DEFAULT false NOT NULL,
	"missing_critical_values" boolean DEFAULT false NOT NULL,
	"impossible_ob_values" boolean DEFAULT false NOT NULL,
	"edd_ga_mismatch" boolean DEFAULT false NOT NULL,
	"left_right_mismatch" boolean DEFAULT false NOT NULL,
	"unapproved_ocr_used" boolean DEFAULT false NOT NULL,
	"blank_required_fields" boolean DEFAULT false NOT NULL,
	"report_too_short" boolean DEFAULT false NOT NULL,
	"normal_despite_abnormal_findings" boolean DEFAULT false NOT NULL,
	"details_json" text,
	"checked_by_id" integer,
	"checked_by_name" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by_id" integer,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_draft_id" integer NOT NULL,
	"study_id" integer,
	"original_language" text DEFAULT 'en' NOT NULL,
	"hindi_summary" text,
	"hindi_summary_generated_at" timestamp with time zone,
	"bilingual_summary" text,
	"bilingual_generated_at" timestamp with time zone,
	"is_ai_translated" boolean DEFAULT true NOT NULL,
	"edited_hindi_summary" text,
	"edited_by_id" integer,
	"edited_by_name" text,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text,
	"body_part" text,
	"study_description_keywords" text,
	"referring_doctor_id" integer,
	"referring_doctor_name" text,
	"priority" text,
	"target_queue" text NOT NULL,
	"target_module_path" text,
	"auto_assign_radiologist_id" integer,
	"auto_assign_radiologist_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sonographer_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"sonographer_id" integer,
	"sonographer_name" text,
	"approved_measurements_json" text,
	"key_image_ids_json" text,
	"voice_dictation_text" text,
	"draft_report_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_tat_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"accession_number" text,
	"modality" text,
	"priority" text,
	"received_at" timestamp with time zone,
	"assigned_to_radiologist_at" timestamp with time zone,
	"report_started_at" timestamp with time zone,
	"report_verified_at" timestamp with time zone,
	"report_finalized_at" timestamp with time zone,
	"total_tat_minutes" integer,
	"report_tat_minutes" integer,
	"verified_tat_minutes" integer,
	"is_delayed" boolean DEFAULT false NOT NULL,
	"delay_reason" text,
	"radiologist_id" integer,
	"radiologist_name" text,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"sla_threshold_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_tat_metrics_study_id_unique" UNIQUE("study_id")
);
--> statement-breakpoint
CREATE TABLE "template_learning" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"modality" text,
	"body_part" text,
	"template_type" text DEFAULT 'normal' NOT NULL,
	"doctor_id" integer,
	"doctor_name" text,
	"content" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_settings" ALTER COLUMN "from_name" SET DEFAULT 'Care Diagnostics ERP';--> statement-breakpoint
ALTER TABLE "clinic_settings" ALTER COLUMN "name" SET DEFAULT 'Care Diagnostics';--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ALTER COLUMN "ai_assistant_name" SET DEFAULT 'Care Diagnostics Assistant';--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "phonepe_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "phonepe_merchant_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "bharatpe_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "bharatpe_merchant_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "cashfree_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "cashfree_app_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "online_booking_allowed_test_ids" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "printer_settings" ADD COLUMN "barcode_enabled" text DEFAULT 'true' NOT NULL;--> statement-breakpoint
ALTER TABLE "printer_settings" ADD COLUMN "token_enabled" text DEFAULT 'true' NOT NULL;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "phonepe_transaction_id" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "phonepe_provider_ref_id" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "bharatpe_transaction_id" text;--> statement-breakpoint
ALTER TABLE "online_bookings" ADD COLUMN "bharatpe_provider_ref_id" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "source_pacs" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "source_ae_title" text;--> statement-breakpoint
ALTER TABLE "radiology_worklist" ADD COLUMN "dicom_metadata" text;--> statement-breakpoint
CREATE INDEX "rad_img_refs_draft_idx" ON "radiology_image_references" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "rad_img_refs_study_idx" ON "radiology_image_references" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "rad_snippets_shortcut_idx" ON "radiology_normal_snippets" USING btree ("shortcut");--> statement-breakpoint
CREATE INDEX "rad_snippets_modality_idx" ON "radiology_normal_snippets" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "rad_lifecycle_study_idx" ON "radiology_report_lifecycle_log" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "rad_lifecycle_action_idx" ON "radiology_report_lifecycle_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "rad_prefs_user_idx" ON "radiology_report_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rad_macros_creator_idx" ON "radiology_text_macros" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "rad_macros_shortcut_idx" ON "radiology_text_macros" USING btree ("shortcut");--> statement-breakpoint
CREATE INDEX "rad_macros_modality_idx" ON "radiology_text_macros" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "wa_bot_contact_idx" ON "wa_bot_sessions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "wa_bot_expires_idx" ON "wa_bot_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "wa_contact_phone_idx" ON "wa_contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "wa_contact_patient_idx" ON "wa_contacts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "wa_contact_type_idx" ON "wa_contacts" USING btree ("contact_type");--> statement-breakpoint
CREATE INDEX "wa_conv_phone_idx" ON "wa_conversations" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "wa_conv_status_idx" ON "wa_conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wa_conv_contact_idx" ON "wa_conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "wa_msg_conv_idx" ON "wa_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "wa_msg_direction_idx" ON "wa_messages" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "wa_msg_created_idx" ON "wa_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wa_tmpl_name_idx" ON "wa_templates" USING btree ("template_name");--> statement-breakpoint
CREATE INDEX "wa_tmpl_usecase_idx" ON "wa_templates" USING btree ("use_case");--> statement-breakpoint
CREATE INDEX "ai_health_provider_idx" ON "ai_server_health_log" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_health_status_idx" ON "ai_server_health_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_health_created_idx" ON "ai_server_health_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cf_alert_worklist_idx" ON "critical_findings_alerts" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "cf_alert_status_idx" ON "critical_findings_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cf_alert_severity_idx" ON "critical_findings_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "cf_alert_created_idx" ON "critical_findings_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "archive_uid_idx" ON "pacs_archive_lifecycle" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "archive_tier_idx" ON "pacs_archive_lifecycle" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "archive_patient_idx" ON "pacs_archive_lifecycle" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "perf_stats_rad_period_idx" ON "radiologist_performance_stats" USING btree ("radiologist_id","period_type","period_date");--> statement-breakpoint
CREATE INDEX "perf_stats_date_idx" ON "radiologist_performance_stats" USING btree ("period_date");--> statement-breakpoint
CREATE INDEX "ris_sync_type_idx" ON "ris_sync_status" USING btree ("sync_type");--> statement-breakpoint
CREATE INDEX "ris_sync_status_idx" ON "ris_sync_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "watchdog_status_idx" ON "watchdog_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "watchdog_heartbeat_idx" ON "watchdog_status" USING btree ("last_heartbeat");--> statement-breakpoint
CREATE INDEX "usg_audit_entity_idx" ON "usg_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "usg_audit_study_idx" ON "usg_audit_log" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "usg_audit_patient_idx" ON "usg_audit_log" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "usg_audit_user_idx" ON "usg_audit_log" USING btree ("performed_by_id");--> statement-breakpoint
CREATE INDEX "usg_audit_created_idx" ON "usg_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usg_dop_study_idx" ON "usg_doppler_measurements" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "usg_dop_worklist_idx" ON "usg_doppler_measurements" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "usg_dop_status_idx" ON "usg_doppler_measurements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usg_dop_patient_idx" ON "usg_doppler_measurements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "usg_log_study_idx" ON "usg_extraction_logs" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "usg_log_worklist_idx" ON "usg_extraction_logs" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "usg_log_status_idx" ON "usg_extraction_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usg_fimg_draft_idx" ON "usg_finding_image_links" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "usg_fimg_image_idx" ON "usg_finding_image_links" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "usg_key_img_study_idx" ON "usg_key_images" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "usg_key_img_worklist_idx" ON "usg_key_images" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "usg_machine_active_idx" ON "usg_machine_profiles" USING btree ("active");--> statement-breakpoint
CREATE INDEX "usg_meas_study_uid_idx" ON "usg_measurements" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "usg_meas_worklist_idx" ON "usg_measurements" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "usg_meas_status_idx" ON "usg_measurements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usg_meas_patient_idx" ON "usg_measurements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "usg_amend_draft_idx" ON "usg_report_amendments" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "usg_amend_prior_idx" ON "usg_report_amendments" USING btree ("prior_version_id");--> statement-breakpoint
CREATE INDEX "usg_draft_study_idx" ON "usg_report_drafts" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "usg_draft_worklist_idx" ON "usg_report_drafts" USING btree ("worklist_id");--> statement-breakpoint
CREATE INDEX "usg_draft_status_idx" ON "usg_report_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usg_draft_patient_idx" ON "usg_report_drafts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "usg_draft_hash_idx" ON "usg_report_drafts" USING btree ("finalized_report_hash");--> statement-breakpoint
CREATE INDEX "ai_extraction_study_idx" ON "ai_extraction_results" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "ai_extraction_type_idx" ON "ai_extraction_results" USING btree ("extraction_type");--> statement-breakpoint
CREATE INDEX "ai_extraction_status_idx" ON "ai_extraction_results" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "dicom_studies_uid_idx" ON "dicom_studies" USING btree ("study_instance_uid");--> statement-breakpoint
CREATE INDEX "dicom_studies_accession_idx" ON "dicom_studies" USING btree ("accession_number");--> statement-breakpoint
CREATE INDEX "dicom_studies_patient_idx" ON "dicom_studies" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "dicom_studies_status_idx" ON "dicom_studies" USING btree ("ingest_status");--> statement-breakpoint
CREATE INDEX "dicom_studies_link_idx" ON "dicom_studies" USING btree ("link_status");--> statement-breakpoint
CREATE INDEX "dicom_studies_modality_idx" ON "dicom_studies" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "dicom_studies_radiologist_idx" ON "dicom_studies" USING btree ("assigned_radiologist_id");--> statement-breakpoint
CREATE INDEX "dicom_studies_priority_idx" ON "dicom_studies" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "dicom_studies_report_idx" ON "dicom_studies" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "dicom_audit_study_idx" ON "dicom_study_audit_log" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "dicom_audit_action_idx" ON "dicom_study_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "dicom_series_study_idx" ON "dicom_study_series" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "dicom_series_uid_idx" ON "dicom_study_series" USING btree ("series_instance_uid");--> statement-breakpoint
CREATE INDEX "hanging_protocol_modality_idx" ON "hanging_protocols" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "tech_workflow_study_idx" ON "technician_workflow" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "ai_imp_study_idx" ON "ai_impressions" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "ai_imp_draft_idx" ON "ai_impressions" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX "ai_imp_modality_idx" ON "ai_impressions" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "ai_imp_status_idx" ON "ai_impressions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sr_study_idx" ON "dicom_sr_export_queue" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "sr_status_idx" ON "dicom_sr_export_queue" USING btree ("export_status");--> statement-breakpoint
CREATE INDEX "sr_draft_idx" ON "dicom_sr_export_queue" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX "fu_draft_idx" ON "follow_up_recommendations" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX "fu_study_idx" ON "follow_up_recommendations" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "fu_rule_idx" ON "follow_up_recommendations" USING btree ("trigger_rule");--> statement-breakpoint
CREATE INDEX "amend_draft_idx" ON "report_amendments" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX "amend_study_idx" ON "report_amendments" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "amend_seq_idx" ON "report_amendments" USING btree ("sequence_number");--> statement-breakpoint
CREATE INDEX "qc_draft_idx" ON "report_quality_checks" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX "qc_study_idx" ON "report_quality_checks" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "qc_result_idx" ON "report_quality_checks" USING btree ("overall_result");--> statement-breakpoint
CREATE INDEX "trans_draft_idx" ON "report_translations" USING btree ("report_draft_id");--> statement-breakpoint
CREATE INDEX "trans_study_idx" ON "report_translations" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "route_modality_idx" ON "smart_routing_rules" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "route_queue_idx" ON "smart_routing_rules" USING btree ("target_queue");--> statement-breakpoint
CREATE INDEX "route_active_idx" ON "smart_routing_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "sono_study_idx" ON "sonographer_drafts" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "sono_status_idx" ON "sonographer_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sono_sonographer_idx" ON "sonographer_drafts" USING btree ("sonographer_id");--> statement-breakpoint
CREATE INDEX "tat_study_idx" ON "study_tat_metrics" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "tat_modality_idx" ON "study_tat_metrics" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "tat_delayed_idx" ON "study_tat_metrics" USING btree ("is_delayed");--> statement-breakpoint
CREATE INDEX "tat_radiologist_idx" ON "study_tat_metrics" USING btree ("radiologist_id");--> statement-breakpoint
CREATE INDEX "tat_sla_idx" ON "study_tat_metrics" USING btree ("sla_breached");--> statement-breakpoint
CREATE INDEX "tl_modality_idx" ON "template_learning" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "tl_doctor_idx" ON "template_learning" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "tl_type_idx" ON "template_learning" USING btree ("template_type");