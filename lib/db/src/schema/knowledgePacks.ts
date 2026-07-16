/**
 * knowledgePacks.ts — CARE Knowledge Pack Engine.
 *
 * A Knowledge Pack is a NAMED, VERSIONED registry entry that describes a study
 * type (MRI Brain, USG Whole Abdomen, CT Brain, …) as an installable bundle of
 * the clinical content that ALREADY lives, keyed by study type, across the live
 * tables (radiology_quick_findings / radiology_protocols /
 * radiology_clinical_history_chips / radiology_quick_measurements /
 * radiology_impression_rules / structured_report_templates / teaching_cases /
 * radiology_knowledge_base).
 *
 * The pack is a MANIFEST, not a copy of that content — it references the content
 * by its existing string keys (region name / builderType / bodyPart / category)
 * and the loader assembles it live. This is the "operating system + apps" model:
 * the Reporting Platform is the OS; packs are the apps. Adding a new study type
 * becomes a clinical-content + registry task, not a code task.
 *
 * Backward-compatible: this table is purely additive. No existing content moves;
 * no engine changes. MRI/USG behaviour is unchanged — their packs merely
 * *describe* content that was already there.
 */

import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const knowledgePacksTable = pgTable(
  "knowledge_packs",
  {
    id: serial("id").primaryKey(),

    // Identity: `{modality}.{slug}` — e.g. "mri.brain", "usg.whole_abdomen".
    packId: text("pack_id").notNull().unique(),
    modality: text("modality").notNull(),        // MRI | USG | CT | XR | MG | PETCT | DEXA | FL | NM | EEG | ECG | TMT
    name: text("name").notNull(),                // "MRI Brain Pack"
    description: text("description").notNull().default(""),
    category: text("category").notNull().default(""), // grouping: Neuro | Body | MSK | Obstetric | Vascular | Small Parts | Placeholder | Future

    // Content keys the pack references (into the live tables):
    studyType: text("study_type"),               // radiology_*.study_type / region name (Title Case) — quick findings, protocols, history, quick measurements
    builderType: text("builder_type"),           // radiology_impression_rules.builder_type (lower_snake)
    bodyPart: text("body_part"),                  // structured_report_templates.body_part
    knowledgeCategory: text("knowledge_category"), // radiology_knowledge_base.category + teaching_cases.category

    // Lifecycle
    version: text("version").notNull().default("1.0.0"),
    author: text("author").notNull().default("CARE Radiology"),
    status: text("status").notNull().default("enabled"), // enabled | disabled | placeholder | planned
    isSystem: boolean("is_system").notNull().default(false), // production packs — guarded from accidental delete/overwrite

    dependsOnJson: text("depends_on_json").notNull().default("[]"), // pack ids this pack requires
    // Declarative pack-level extras that don't have a dedicated table today
    // (companion/copilot module ids, comparison measurement labels, critical
    // findings, quality rules, reporting notes, references, normal values).
    manifestJson: text("manifest_json").notNull().default("{}"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byModality: index("knowledge_packs_modality_idx").on(t.modality),
    byStatus: index("knowledge_packs_status_idx").on(t.status),
    byStudyType: index("knowledge_packs_study_type_idx").on(t.studyType),
  }),
);

export type KnowledgePack = typeof knowledgePacksTable.$inferSelect;
export type InsertKnowledgePack = typeof knowledgePacksTable.$inferInsert;
