/**
 * Shared Emergency Billing contracts.
 * DS225+ captures transactions; DS1522+ CARE remains the source of truth.
 */

export const CSV_FORMAT = "CARE_EMERGENCY_BILLING_V1" as const;
export const JSON_FORMAT = "CARE_EMERGENCY_BILLING_JSON_V1" as const;
export const MASTER_FORMAT = "CARE_EMERGENCY_MASTER_V1" as const;
export const MASTER_VERSION = 1 as const;
export const SOURCE = "LOCAL_EMERGENCY" as const;

export const PUSH_INITIATORS = ["MANUAL", "SCHEDULER", "EVENT"] as const;
export type PushInitiator = (typeof PUSH_INITIATORS)[number];

export const SNAPSHOT_AGE_BANDS = ["never", "fresh", "warning", "stale"] as const;
export type SnapshotAgeBand = (typeof SNAPSHOT_AGE_BANDS)[number];

export const PAYMENT_MODES = ["cash", "upi", "card"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const TXN_STATUS = ["PENDING", "VOID", "RECONCILED"] as const;
export type EmergencyTxnStatus = (typeof TXN_STATUS)[number];

export const MATCH_CLASSES = ["EXACT_MATCH", "PROBABLE_MATCH", "NEW_PATIENT", "CONFLICT"] as const;
export type PatientMatchClass = (typeof MATCH_CLASSES)[number];

export const IMPORT_METHODS = ["NAS_API", "CSV", "JSON"] as const;
export type ImportMethod = (typeof IMPORT_METHODS)[number];

export interface EmergencyPaymentSplit {
  method: PaymentMode;
  amount: number;
  referenceNumber?: string | null;
}

export interface EmergencyLineItem {
  careServiceId: number;
  serviceCode: string;
  serviceName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  lineGross: number;
}

export interface EmergencyPatientSnapshot {
  carePatientId: number | null;
  uhid: string | null;
  firstName: string;
  lastName: string;
  sex: string;
  ageValue: number | null;
  ageUnit: string | null;
  dateOfBirth: string | null;
  mobile: string;
}

export interface EmergencyTransaction {
  emergencyTransactionUuid: string;
  emergencyBillNumber: string;
  emergencySessionUuid: string;
  status: EmergencyTxnStatus;
  createdAt: string;
  createdByStaffId: number;
  createdByStaffName: string;
  voidedAt?: string | null;
  voidedByStaffName?: string | null;
  voidReason?: string | null;
  patient: EmergencyPatientSnapshot;
  referringDoctorId: number | null;
  referringDoctorName: string | null;
  lines: EmergencyLineItem[];
  grossAmount: number;
  discountAmount: number;
  discountReason: string | null;
  netAmount: number;
  amountReceived: number;
  dueAmount: number;
  payments: EmergencyPaymentSplit[];
  notes: string | null;
  tariffSyncedAt: string | null;
}

export interface EmergencySessionRecord {
  emergencySessionUuid: string;
  startedAt: string;
  startedByStaffId: number;
  startedByStaffName: string;
  reason: string;
  workstation?: string | null;
  endedAt?: string | null;
  endedByStaffId?: number | null;
  endedByStaffName?: string | null;
}

export interface EmergencyExportManifest {
  format: typeof JSON_FORMAT | typeof CSV_FORMAT;
  exportedAt: string;
  masterDataLastSyncedAt: string | null;
  session: EmergencySessionRecord | null;
  transactionCount: number;
  checksumSha256: string;
}

export interface EmergencyJsonPackage {
  format: typeof JSON_FORMAT;
  version: 1;
  exportedAt: string;
  masterDataLastSyncedAt: string | null;
  sessions: EmergencySessionRecord[];
  transactions: EmergencyTransaction[];
  checksumSha256: string;
}

export interface PreviewRow {
  emergencyTransactionUuid: string;
  emergencyBillNumber: string;
  matchClass: PatientMatchClass;
  matchReason: string;
  carePatientId: number | null;
  carePatientLabel: string | null;
  alreadyImported: boolean;
  careBillId: number | null;
  blocked: boolean;
  blockReason: string | null;
  transaction: EmergencyTransaction;
}

export interface ReconciliationSummary {
  sessionUuid: string | null;
  sessionStartedAt: string | null;
  sessionEndedAt: string | null;
  bills: number;
  gross: number;
  discount: number;
  net: number;
  collected: number;
  due: number;
  cash: number;
  upi: number;
  card: number;
  exactMatches: number;
  newPatients: number;
  needsReview: number;
  conflicts: number;
  alreadyImported: number;
  safeToImport: number;
}

export interface ImportBatchResult {
  supplied: number;
  imported: number;
  alreadyReconciled: number;
  created: number;
  duplicates: number;
  failures: number;
  conflicts: number;
  skippedReview: number;
  failureDetails: Array<{ uuid: string; error: string }>;
}

export interface MasterPushCounts {
  serviceCount: number;
  doctorCount: number;
  patientCount: number;
  staffCount: number;
}

export interface MasterDataSnapshot {
  format: typeof MASTER_FORMAT;
  version: typeof MASTER_VERSION;
  syncedAt: string;
  services: Array<{
    id: number;
    code: string;
    name: string;
    category: string;
    price: number;
    isActive: boolean;
  }>;
  doctors: Array<{ id: number; name: string; specialization: string }>;
  patients: Array<{
    id: number;
    patientId: string;
    firstName: string;
    lastName: string;
    phone: string;
    gender: string;
    dateOfBirth: string | null;
    ageValue: number | null;
    ageUnit: string | null;
  }>;
  staff: Array<{
    id: number;
    name: string;
    username: string;
    role: string;
    pinHash: string;
    maxDiscount: number;
    permissions: string | null;
  }>;
  discountReasons: string[];
}
