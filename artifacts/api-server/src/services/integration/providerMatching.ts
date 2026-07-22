// ============================================================================
// Referring-doctor resolution: HOPE prescriber → canonical CARE doctors row.
// Reuses an existing crosswalk link, else matches by registration number or
// normalized name, else creates a CARE doctors row (idempotent-by-name,
// mirroring scripts/import-referral-doctors.ts) and records the link. Never
// modifies the core doctors schema.
// ============================================================================
import { and, eq, sql } from "drizzle-orm";
import { doctorsTable, externalProviderLinksTable } from "@workspace/db";
import type { Executor } from "./db";
import { normalizeName } from "./normalize";

export interface ProviderInput {
  sourceSystem: string;
  sourceProviderId?: string | null;
  name?: string | null;
  specialization?: string | null;
  registrationNo?: string | null;
}

export interface ProviderResolution {
  careDoctorId: number | null;
  linkId: number | null;
  method: string;
  created: boolean;
}

export async function resolveReferringDoctor(exec: Executor, input: ProviderInput): Promise<ProviderResolution> {
  const sourceId = (input.sourceProviderId ?? "").trim();
  const name = (input.name ?? "").trim();

  // Tier 1: existing crosswalk link.
  if (sourceId) {
    const [link] = await exec
      .select()
      .from(externalProviderLinksTable)
      .where(
        and(
          eq(externalProviderLinksTable.sourceSystem, input.sourceSystem),
          eq(externalProviderLinksTable.sourceProviderId, sourceId),
        ),
      )
      .limit(1);
    if (link && link.careDoctorId) {
      await exec
        .update(externalProviderLinksTable)
        .set({ lastUsedAt: new Date() })
        .where(eq(externalProviderLinksTable.id, link.id));
      return { careDoctorId: link.careDoctorId, linkId: link.id, method: "existing_link", created: false };
    }
  }

  if (!name) return { careDoctorId: null, linkId: null, method: "no_name", created: false };

  // Tier 2: match an existing CARE doctor by registration no, else by name.
  let careDoctor: { id: number } | undefined;
  let method = "";
  if (input.registrationNo && input.registrationNo.trim()) {
    [careDoctor] = await exec
      .select({ id: doctorsTable.id })
      .from(doctorsTable)
      .where(eq(doctorsTable.registrationNumber, input.registrationNo.trim()))
      .limit(1);
    if (careDoctor) method = "registration_no";
  }
  if (!careDoctor) {
    const norm = normalizeName(name);
    const rows = await exec
      .select({ id: doctorsTable.id, name: doctorsTable.name })
      .from(doctorsTable)
      .where(sql`lower(trim(${doctorsTable.name})) = ${norm} OR lower(trim(${doctorsTable.name})) = ${name.toLowerCase().trim()}`)
      .limit(1);
    if (rows[0]) {
      careDoctor = { id: rows[0].id };
      method = "name";
    }
  }

  let created = false;
  if (!careDoctor) {
    // Tier 3: create the CARE doctors row. specialization is NOT NULL.
    const [inserted] = await exec
      .insert(doctorsTable)
      .values({
        name,
        specialization: (input.specialization && input.specialization.trim()) || "Referring Physician",
        registrationNumber: input.registrationNo?.trim() || null,
      })
      .returning({ id: doctorsTable.id });
    careDoctor = { id: inserted.id };
    method = "created_new";
    created = true;
  }

  // Record / upsert the crosswalk link.
  let linkId: number | null = null;
  if (sourceId) {
    const [linkRow] = await exec
      .insert(externalProviderLinksTable)
      .values({
        sourceSystem: input.sourceSystem,
        sourceProviderId: sourceId,
        sourceProviderName: name,
        sourceSpecialization: input.specialization ?? null,
        sourceRegistrationNo: input.registrationNo ?? null,
        careDoctorId: careDoctor.id,
        linkStatus: created ? "created_new" : "confirmed",
        matchMethod: method,
        confidence: created ? "60" : method === "registration_no" ? "95" : "80",
      })
      .returning({ id: externalProviderLinksTable.id });
    linkId = linkRow?.id ?? null;
  }

  return { careDoctorId: careDoctor.id, linkId, method, created };
}
