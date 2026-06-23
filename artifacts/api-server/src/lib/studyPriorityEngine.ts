/**
 * studyPriorityEngine.ts
 * Auto-assigns study priorities based on:
 *   - clinical keywords (stroke, trauma, hemorrhage, etc)
 *   - body part
 *   - study description
 *   - modality
 *   - referring doctor / location context
 *   - admin-configurable priority rules (from radiology_priority_rules table)
 *
 * Priority hierarchy (highest to lowest): STAT > Emergency > Urgent > VIP > Routine
 */
import { db } from "@workspace/db";
import {
  radiologyPriorityRulesTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";

export type PriorityLevel = "stat" | "emergency" | "urgent" | "vip" | "routine";

const PRIORITY_RANK: Record<PriorityLevel, number> = {
  stat: 5,
  emergency: 4,
  urgent: 3,
  vip: 2,
  routine: 1,
};

export type PriorityResult = {
  priority: PriorityLevel;
  reason: string;
  ruleId?: number;
};

// Hard-coded keyword rules (always evaluated; can be overridden by admin rules)
const KEYWORD_RULES: { keywords: string[]; priority: PriorityLevel; reason: string }[] = [
  { keywords: ["stroke", "acute stroke", "hemorrhage", "bleed", "ich", "sah", "subarachnoid"], priority: "stat", reason: "Stroke/hemorrhage keywords detected" },
  { keywords: ["trauma", "rta", "accident", "fall", "fracture", "polytrauma", "penetrating"], priority: "emergency", reason: "Trauma keywords detected" },
  { keywords: ["pneumothorax", "tension pneumothorax", "hemothorax", "flail"], priority: "stat", reason: "Critical chest trauma" },
  { keywords: ["midline shift", "herniation", "brain herniation"], priority: "stat", reason: "Brain herniation risk" },
  { keywords: ["hydrocephalus", "acute hydrocephalus", "shunt malfunction"], priority: "urgent", reason: "Hydrocephalus detected" },
  { keywords: ["compression", "spinal cord compression", "cauda equina", "conus"], priority: "emergency", reason: "Spinal cord compression risk" },
  { keywords: ["aortic dissection", "aaa", "rupture", "pseudoaneurysm"], priority: "stat", reason: "Critical vascular emergency" },
  { keywords: ["foreign body", "ingested", "swallowed battery", "magnet"], priority: "emergency", reason: "Ingested foreign body — pediatric" },
  { keywords: ["intussusception", "volvulus", "malrotation", "nec"], priority: "emergency", reason: "Pediatric surgical abdomen" },
];

// Location keywords that raise priority
const HIGH_PRIORITY_LOCATIONS = ["icu", "ipd", "ccu", "nicu", "picu", "er", "emergency", "trauma bay", "ot", "operation theatre"];

/**
 * Check if a text contains any of the keywords (case-insensitive).
 */
function containsAny(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
}

/**
 * Load admin-configurable priority rules from DB.
 */
export async function loadPriorityRules(): Promise<
  typeof radiologyPriorityRulesTable.$inferSelect[]
> {
  return db
    .select()
    .from(radiologyPriorityRulesTable)
    .where(eq(radiologyPriorityRulesTable.isActive, true))
    .orderBy(asc(radiologyPriorityRulesTable.sortOrder));
}

/**
 * Evaluate admin rules against a study context.
 * Returns the highest-priority match.
 */
export async function evaluateAdminRules(ctx: {
  bodyPart?: string | null;
  studyDescription?: string | null;
  modality?: string | null;
  referringDoctor?: string | null;
  clinicalHistory?: string | null;
  location?: string | null;
}): Promise<PriorityResult | null> {
  const rules = await loadPriorityRules();
  let best: PriorityResult | null = null;

  for (const rule of rules) {
    const priority = rule.priority.toLowerCase() as PriorityLevel;
    let matched = false;
    let matchParts: string[] = [];

    // Body part pattern
    if (rule.bodyPartPattern && ctx.bodyPart) {
      if (ctx.bodyPart.toLowerCase().includes(rule.bodyPartPattern.toLowerCase())) {
        matched = true;
        matchParts.push(`bodyPart=${rule.bodyPartPattern}`);
      }
    }

    // Study description pattern
    if (rule.studyDescPattern && ctx.studyDescription) {
      if (ctx.studyDescription.toLowerCase().includes(rule.studyDescPattern.toLowerCase())) {
        matched = true;
        matchParts.push(`studyDesc=${rule.studyDescPattern}`);
      }
    }

    // Modality list
    if (rule.modalityList && ctx.modality) {
      const allowed = rule.modalityList.split(",").map((m) => m.trim().toUpperCase());
      if (allowed.includes(ctx.modality.toUpperCase())) {
        matched = true;
        matchParts.push(`modality=${ctx.modality}`);
      }
    }

    // Referring doctor pattern
    if (rule.referringDoctorPattern && ctx.referringDoctor) {
      if (ctx.referringDoctor.toLowerCase().includes(rule.referringDoctorPattern.toLowerCase())) {
        matched = true;
        matchParts.push(`refDoc=${rule.referringDoctorPattern}`);
      }
    }

    // Keyword matching on combined text
    if (rule.keywords) {
      const combined = [ctx.clinicalHistory, ctx.studyDescription, ctx.bodyPart]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const kwList = rule.keywords.split(",").map((k) => k.trim().toLowerCase());
      const hit = kwList.find((k) => combined.includes(k));
      if (hit) {
        matched = true;
        matchParts.push(`keyword=${hit}`);
      }
    }

    // Location pattern
    if (rule.locationPattern && ctx.location) {
      const locList = rule.locationPattern.split(",").map((l) => l.trim().toLowerCase());
      if (locList.some((l) => ctx.location!.toLowerCase().includes(l))) {
        matched = true;
        matchParts.push(`location=${rule.locationPattern}`);
      }
    }

    if (matched) {
      if (!best || PRIORITY_RANK[priority] > PRIORITY_RANK[best.priority]) {
        best = {
          priority,
          reason: `${rule.name}: ${matchParts.join(", ")}`,
          ruleId: rule.id,
        };
      }
    }
  }

  return best;
}

/**
 * Evaluate built-in keyword rules (hard-coded medical knowledge).
 */
export function evaluateKeywordRules(ctx: {
  bodyPart?: string | null;
  studyDescription?: string | null;
  modality?: string | null;
  clinicalHistory?: string | null;
}): PriorityResult | null {
  const combined = [ctx.clinicalHistory, ctx.studyDescription, ctx.bodyPart]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let best: PriorityResult | null = null;

  for (const rule of KEYWORD_RULES) {
    if (containsAny(combined, rule.keywords)) {
      if (!best || PRIORITY_RANK[rule.priority] > PRIORITY_RANK[best.priority]) {
        best = {
          priority: rule.priority,
          reason: rule.reason,
        };
      }
    }
  }

  return best;
}

/**
 * Evaluate location-based priority (ICU/IPD/ER context).
 */
export function evaluateLocationRules(location?: string | null): PriorityResult | null {
  if (!location) return null;
  const loc = location.toLowerCase();
  if (HIGH_PRIORITY_LOCATIONS.some((h) => loc.includes(h))) {
    return { priority: "urgent", reason: `High-priority location: ${location}` };
  }
  return null;
}

/**
 * Full priority evaluation pipeline.
 * Admin rules beat keyword rules; keyword rules beat location rules.
 */
export async function computeStudyPriority(ctx: {
  bodyPart?: string | null;
  studyDescription?: string | null;
  modality?: string | null;
  referringDoctor?: string | null;
  clinicalHistory?: string | null;
  location?: string | null;
}): Promise<PriorityResult> {
  // Admin rules first (operator-configured, takes precedence)
  const adminResult = await evaluateAdminRules(ctx);
  if (adminResult) return adminResult;

  // Built-in keyword rules
  const keywordResult = evaluateKeywordRules(ctx);
  if (keywordResult) return keywordResult;

  // Location rules
  const locResult = evaluateLocationRules(ctx.location);
  if (locResult) return locResult;

  return { priority: "routine", reason: "No matching priority rules" };
}

/**
 * Apply computed priority to a study row.
 */
export async function applyPriorityToStudy(
  studyId: number,
  priority: PriorityLevel,
  reason: string,
  overriddenBy?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    priority,
    priorityReason: reason,
  };
  if (overriddenBy) {
    update.priorityOverriddenAt = new Date();
    update.priorityOverriddenBy = overriddenBy;
  }
  await db
    .update(radiologyStudiesTable)
    .set(update)
    .where(eq(radiologyStudiesTable.id, studyId));
}
