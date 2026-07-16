// version.ts — engine version, stamped onto every QualityReport and persisted
// with each quality run so dashboard trends can attribute results to a version.
// Kept in its own module so both runner.ts and index.ts can import it without a
// circular dependency.
export const REPORT_QUALITY_ENGINE_VERSION = "0.1.0-phase0";
