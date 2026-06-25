import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

// pacs_settings — key/value store for PACS-level configuration (Conquest host,
// port, AE title, auto-send toggles, report delivery settings, etc.)
export const pacsSettingsTable = pgTable("pacs_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value"),
  category: text("category").notNull().default("general"),
  isSecret: boolean("is_secret").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// dicom_modalities — individual imaging machines (CT, MRI, X-Ray, USG) that
// push studies to Conquest. Separate from dicom_nodes (which are PACS pull targets).
export const dicomModalitiesTable = pgTable("dicom_modalities", {
  id: serial("id").primaryKey(),
  machineName: text("machine_name").notNull(),
  modality: text("modality"),            // MR | CT | CR | DX | US | XA | MG | OT
  aeTitle: text("ae_title"),
  ipAddress: text("ip_address"),
  port: integer("port"),
  location: text("location"),
  manufacturer: text("manufacturer"),    // scanner brand / model info
  autoSendEnabled: boolean("auto_send_enabled").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),

  // Pull-agent Q/R controls
  queryEnabled: boolean("query_enabled").notNull().default(true),
  retrieveEnabled: boolean("retrieve_enabled").notNull().default(true),
  pollingEnabled: boolean("polling_enabled").notNull().default(false),
  pollingIntervalSeconds: integer("polling_interval_seconds").notNull().default(300),
  retrieveMethod: text("retrieve_method").notNull().default("C_MOVE"),          // C_MOVE | C_GET | C_STORE | WATCH_FOLDER | C_STORE_OR_WATCH_FOLDER | USB_DICOMDIR | NON_DICOM_JPG_PNG
  preferredTransferSyntax: text("preferred_transfer_syntax"),
  destinationPacs: text("destination_pacs").notNull().default("CONQUEST"),      // CONQUEST | ORTHANC

  // USG / Voluson-specific import methods
  watchFolderPath: text("watch_folder_path"),                                    // filesystem path to watch for DICOM files
  cStorePort: integer("c_store_port"),                                          // local port to listen for C-STORE SCP (e.g. 11112)
  usbAutoImportEnabled: boolean("usb_auto_import_enabled").notNull().default(false),  // auto-import from USB / DICOMDIR
  nonDicomImportEnabled: boolean("non_dicom_import_enabled").notNull().default(false),  // accept JPG/PNG fallback for non-DICOM images
  autoPushToConquest: boolean("auto_push_to_conquest").notNull().default(true),
  autoCreateWorklist: boolean("auto_create_worklist").notNull().default(true),
  autoNotifyRadiologist: boolean("auto_notify_radiologist").notNull().default(false),
  notes: text("notes"),

  // Status tracking (written by agent heartbeat / echo-test)
  lastConnectionStatus: text("last_connection_status"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// pacs_logs — append-only event log written by Conquest Lua hooks and the
// Python PACS agent. Also writable from the internal API for custom events.
export const pacsLogsTable = pgTable("pacs_logs", {
  id: serial("id").primaryKey(),
  logType: text("log_type"),
  severity: text("severity").notNull().default("info"),
  source: text("source"),
  eventType: text("event_type"),
  message: text("message").notNull(),
  studyInstanceUid: text("study_instance_uid"),
  accessionNumber: text("accession_number"),
  patientId: text("patient_id"),
  modality: text("modality"),
  payload: text("payload"),
  errorStack: text("error_stack"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// radiology_config_changes — tracks audit logs of config updates
export const radiologyConfigChangesTable = pgTable("radiology_config_changes", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  category: text("category").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  changedBy: integer("changed_by"),
  changedByName: text("changed_by_name"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PacsSettings = typeof pacsSettingsTable.$inferSelect;
export type DicomModality = typeof dicomModalitiesTable.$inferSelect;
export type PacsLog = typeof pacsLogsTable.$inferSelect;
export type RadiologyConfigChange = typeof radiologyConfigChangesTable.$inferSelect;

