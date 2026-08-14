import { db, patientsTable, testsTable, doctorsTable, usersTable, discountReasonsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { MasterDataSnapshot } from "@workspace/emergency-billing";

const ACTIVE_ROLES = ["admin", "super_admin", "receptionist", "billing", "manager", "accountant"];

/** Minimum master data CARE pushes to DS225+ while the main NAS is healthy. */
export async function buildEmergencyMasterSnapshot(limitPatients = 2000): Promise<MasterDataSnapshot> {
  const [services, doctors, patients, staff, reasons] = await Promise.all([
    db.select({
      id: testsTable.id,
      code: testsTable.code,
      name: testsTable.name,
      category: testsTable.category,
      price: testsTable.price,
      isActive: testsTable.isActive,
    }).from(testsTable),
    db.select({
      id: doctorsTable.id,
      name: doctorsTable.name,
      specialization: doctorsTable.specialization,
    }).from(doctorsTable),
    db.select({
      id: patientsTable.id,
      patientId: patientsTable.patientId,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      phone: patientsTable.phone,
      gender: patientsTable.gender,
      dateOfBirth: patientsTable.dateOfBirth,
      ageValue: patientsTable.ageValue,
      ageUnit: patientsTable.ageUnit,
    }).from(patientsTable).orderBy(desc(patientsTable.id)).limit(limitPatients),
    db.select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      email: usersTable.email,
      role: usersTable.role,
      pin: usersTable.pin,
      maxDiscount: usersTable.maxDiscount,
      permissions: usersTable.permissions,
      isActive: usersTable.isActive,
    }).from(usersTable),
    db.select({ reason: discountReasonsTable.label }).from(discountReasonsTable).where(eq(discountReasonsTable.isActive, true)),
  ]);

  return {
    syncedAt: new Date().toISOString(),
    services: services
      .filter((s) => s.isActive !== false)
      .map((s) => ({
        id: s.id,
        code: s.code ?? "",
        name: s.name,
        category: s.category ?? "",
        price: Number(s.price ?? 0),
        isActive: s.isActive !== false,
      })),
    doctors: doctors.map((d) => ({
      id: d.id,
      name: d.name,
      specialization: d.specialization ?? "",
    })),
    patients: patients.map((p) => ({
      id: p.id,
      patientId: p.patientId,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      gender: p.gender,
      dateOfBirth: p.dateOfBirth,
      ageValue: p.ageValue,
      ageUnit: p.ageUnit,
    })),
    staff: staff
      .filter((u) => u.isActive !== false && u.pin && ACTIVE_ROLES.includes(u.role))
      .map((u) => ({
        id: u.id,
        name: u.name,
        username: (u.username || u.email || "").toLowerCase(),
        role: u.role,
        pinHash: u.pin!,
        maxDiscount: Number(u.maxDiscount ?? 0),
        permissions: u.permissions,
      })),
    discountReasons: reasons.map((r) => r.reason).filter(Boolean),
  };
}
