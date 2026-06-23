import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// dicom_routing_rules — defines where studies from each source AE/modality
// should be forwarded after they arrive in the local PACS. Applied by the pull
// agent and/or Conquest Lua hooks.
// Example: all MR studies → ORTHANC2; all DX studies → CONQUEST_ARCHIVE
export const dicomRoutingRulesTable = pgTable("dicom_routing_rules", {
  id: serial("id").primaryKey(),
  name:                 text("name").notNull(),
  modalityType:         text("modality_type"),           // MR | CT | CR | DX | US | * (wildcard)
  sourceAeTitle:        text("source_ae_title"),         // match source AE or null = any
  destinationPacs:      text("destination_pacs").notNull().default("CONQUEST"),  // CONQUEST | ORTHANC
  destinationAeTitle:   text("destination_ae_title"),
  destinationIp:        text("destination_ip"),
  destinationPort:      integer("destination_port"),
  storagePath:          text("storage_path"),            // optional local folder path
  autoPush:             boolean("auto_push").notNull().default(true),
  priority:             integer("priority").notNull().default(10),  // lower = higher priority
  isEnabled:            boolean("is_enabled").notNull().default(true),
  notes:                text("notes"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DicomRoutingRule = typeof dicomRoutingRulesTable.$inferSelect;
