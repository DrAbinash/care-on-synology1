import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  radiologyReportBackupKey,
  rescueBackupEnvelope,
  shouldOfferBackupRestore,
} from "./workspaceReportState";

const ERP_SRC = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ERP_SRC, p), "utf8");

const draftPersistence = read("hooks/radiology-workspace/useDraftPersistence.ts");
const clinicalUi = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const backupHook = read("hooks/useLocalDraftBackup.ts");
const overlays = read("components/radiology/workspace/WorkspaceOverlays.tsx");
const draftRescue = read("lib/draftRescue.ts");

const TEXTS = {
  clinicalHistoryText: "Two weeks of low back pain.",
  techniqueText: "MRI lumbar spine, sagittal T1/T2.",
  findingsText: "Disc desiccation at L4-L5 with a posterior bulge.",
  impressionText: "L4-L5 disc bulge, no significant canal stenosis.",
  recommendationText: "Physiotherapy review.",
};

const EMPTY = {
  clinicalHistoryText: "",
  techniqueText: "",
  findingsText: "",
  impressionText: "",
  recommendationText: "",
};

describe("radiologyReportBackupKey — one definition of where the text lives", () => {
  it("keys by study, and falls back to 'new' exactly as the inline literal did", () => {
    expect(radiologyReportBackupKey(42)).toBe("radiology_report_backup_42");
    expect(radiologyReportBackupKey(null)).toBe("radiology_report_backup_new");
    expect(radiologyReportBackupKey(undefined)).toBe("radiology_report_backup_new");
  });

  it("is what both the debounced backup and the rescue flush now use", () => {
    // The whole defect was two writers and one reader disagreeing about the key.
    expect(clinicalUi).toContain("storageKey: radiologyReportBackupKey(studyId)");
    expect(draftPersistence).toContain("radiologyReportBackupKey(studyId)");
    expect(clinicalUi).not.toContain("`radiology_report_backup_");
    expect(draftPersistence).not.toContain("`radiology_report_backup_");
  });
});

describe("rescueBackupEnvelope — what the pre-redirect flush preserves", () => {
  it("produces exactly the six keys the restore banner reads back", () => {
    const envelope = rescueBackupEnvelope(TEXTS, { signed: false }, () => 1700000000000);
    expect(envelope).toEqual({
      at: 1700000000000,
      clinicalHistory: TEXTS.clinicalHistoryText,
      technique: TEXTS.techniqueText,
      rawFindings: TEXTS.findingsText,
      impression: [TEXTS.impressionText],
      recommendation: TEXTS.recommendationText,
    });
  });

  it("wraps the single impression editor line in an array, as normalizeImpressionLines expects", () => {
    const envelope = rescueBackupEnvelope(TEXTS, { signed: false });
    expect(Array.isArray(envelope?.impression)).toBe(true);
    expect(envelope?.impression).toHaveLength(1);
  });

  it("never carries provenance, even when the live texts do", () => {
    const withProvenance = { ...TEXTS, findingsProvenance: { ai: 1 }, impressionProvenance: {}, techniqueProvenance: {} };
    const envelope = rescueBackupEnvelope(withProvenance, { signed: false });
    expect(Object.keys(envelope ?? {}).sort()).toEqual([
      "at", "clinicalHistory", "impression", "rawFindings", "recommendation", "technique",
    ]);
    expect(JSON.stringify(envelope)).not.toContain("rovenance");
  });

  it("refuses to write over a signed report — signing clears the backup on purpose", () => {
    expect(rescueBackupEnvelope(TEXTS, { signed: true })).toBeNull();
  });

  it("refuses to clobber a good backup with empty text when the 401 lands before hydration", () => {
    expect(rescueBackupEnvelope(EMPTY, { signed: false })).toBeNull();
    const whitespace = {
      clinicalHistoryText: "  ", techniqueText: "\n", findingsText: "",
      impressionText: "   ", recommendationText: "\t",
    };
    expect(rescueBackupEnvelope(whitespace, { signed: false })).toBeNull();
  });

  it("rescues on any single non-empty field, not only findings", () => {
    for (const field of Object.keys(TEXTS) as Array<keyof typeof TEXTS>) {
      const envelope = rescueBackupEnvelope({ ...EMPTY, [field]: TEXTS[field] }, { signed: false });
      expect(envelope, `${field} alone must be worth rescuing`).not.toBeNull();
    }
  });
});

describe("the rescued envelope is actually recoverable — the point of the flush", () => {
  it("is offered by the banner when it is newer than the server draft", () => {
    const serverUpdatedAt = new Date(1699999000000).toISOString();
    const envelope = rescueBackupEnvelope(TEXTS, { signed: false }, () => 1700000000000);
    expect(shouldOfferBackupRestore(envelope, serverUpdatedAt, null)).toBe(true);
  });

  it("is offered even with no server draft at all — the first-save case", () => {
    const envelope = rescueBackupEnvelope(TEXTS, { signed: false }, () => 1700000000000);
    expect(shouldOfferBackupRestore(envelope, null, null)).toBe(true);
  });

  it("does not nag when the rescue merely echoes what the server already has", () => {
    const envelope = rescueBackupEnvelope(TEXTS, { signed: false }, () => 1700000000000);
    const serverContent = {
      clinicalHistory: TEXTS.clinicalHistoryText,
      rawFindings: TEXTS.findingsText,
      impression: [TEXTS.impressionText],
      recommendation: TEXTS.recommendationText,
    };
    expect(shouldOfferBackupRestore(envelope, null, serverContent)).toBe(false);
  });
});

describe("writeDraftBackupSnapshot — the one localStorage path both writers share", () => {
  type Stub = { setItem: (k: string, v: string) => void; getItem: (k: string) => string | null; removeItem: (k: string) => void };
  const g = globalThis as unknown as { localStorage?: Stub };
  const original = g.localStorage;

  it("round-trips a rescued envelope into the banner predicate", async () => {
    const store = new Map<string, string>();
    g.localStorage = {
      setItem: (k, v) => { store.set(k, v); },
      getItem: (k) => store.get(k) ?? null,
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const { writeDraftBackupSnapshot } = await import("../hooks/useLocalDraftBackup");
      const key = radiologyReportBackupKey(42);
      const envelope = rescueBackupEnvelope(TEXTS, { signed: false }, () => 1700000000000);
      writeDraftBackupSnapshot(key, envelope);

      // What the flush wrote is exactly what useLocalDraftBackup reads back on
      // the next mount, and the existing banner accepts it.
      const readBack = JSON.parse(store.get(key) ?? "null");
      expect(readBack).toEqual(envelope);
      expect(shouldOfferBackupRestore(readBack, new Date(1699999000000).toISOString(), null)).toBe(true);
    } finally {
      g.localStorage = original;
    }
  });

  it("never throws when the store is full or blocked — the redirect must proceed", async () => {
    g.localStorage = {
      setItem: () => { throw new Error("QuotaExceededError"); },
      getItem: () => null,
      removeItem: () => { /* ignore */ },
    };
    try {
      const { writeDraftBackupSnapshot } = await import("../hooks/useLocalDraftBackup");
      const envelope = rescueBackupEnvelope(TEXTS, { signed: false });
      expect(() => writeDraftBackupSnapshot(radiologyReportBackupKey(42), envelope)).not.toThrow();
    } finally {
      g.localStorage = original;
    }
  });
});

describe("wiring — no React harness exists, so the plumbing is pinned by contract", () => {
  it("the flush writes through the backup hook's own writer, not a second localStorage path", () => {
    expect(backupHook).toContain("export function writeDraftBackupSnapshot(");
    expect(draftPersistence).toContain('import { writeDraftBackupSnapshot } from "@/hooks/useLocalDraftBackup"');
    expect(draftPersistence).toContain("writeDraftBackupSnapshot(radiologyReportBackupKey(studyId), envelope)");
    expect(draftPersistence).not.toContain("localStorage.");
  });

  it("the flush is gated on the envelope builder's refusals, not written unconditionally", () => {
    // The live store texts are read at FLUSH time; the structured cards ride
    // along from the ref mirror (they live in hook options, not the store).
    expect(draftPersistence).toContain("const texts = readWorkspaceClinicalTexts();");
    expect(draftPersistence).toContain("findingsSections: structured ? sections : null,");
    expect(draftPersistence).toContain("rescueBackupEnvelope({");
    expect(draftPersistence).toContain("if (envelope) writeDraftBackupSnapshot");
    expect(draftPersistence).toMatch(/\}, \[studyId, isFinalized, backupEnabled\]\);/);
  });

  it("obeys the SAME signed-report gate as the debounced backup, not a narrower one", () => {
    // A report signed in another session leaves isFinalized false here. Copying
    // its text to a shared workstation is what draftBackup.clear() prevents.
    expect(draftPersistence).toContain("signed: isFinalized || !backupEnabled,");
    expect(clinicalUi).toContain("enabled: allowEditSigned || !studyIsSignedElsewhere,");
    expect(clinicalUi).toContain("backupEnabled: allowEditSigned || !studyIsSignedElsewhere,");
  });

  it("the canonical workspace no longer writes the store only the deprecated page reads", () => {
    // The registration slot is still draftRescue's — that is how fetchApi
    // triggers the flush. What it must NOT import is any of draftRescue's
    // writers or readers, which are keyed to the deprecated page's store.
    const rescueImport = draftPersistence.match(/import \{([^}]*)\} from "@\/lib\/draftRescue";/);
    expect(rescueImport, "draftRescue import must still exist").not.toBeNull();
    // An exact NAME list, not a text match — this pins which functions are
    // imported without pinning how the import statement is laid out.
    expect(rescueImport![1].split(",").map((s) => s.trim()).filter(Boolean))
      .toEqual(["registerDraftRescueSaver", "deregisterDraftRescueSaver"]);
    expect(draftPersistence).not.toContain("writeRescueDraft");
    expect(draftPersistence).not.toMatch(/as any\);/);
    // draftRescue itself is untouched. Since B-10 the Command Center no longer
    // registers a saver or renders the rescue banner — it holds no draft text to
    // rescue — so useDraftPersistence is the only consumer of the slot, and the
    // module keeps its shape for it.
    expect(draftRescue).toContain('const RESCUE_KEY = "rcc_rescue_draft"');
    expect(draftRescue).toContain("accessionNumber: string;");
    expect(read("pages/RadiologyCommandCenter.tsx")).not.toContain("@/lib/draftRescue");
  });

  it("the reader that recovers it is the existing banner — no new UI", () => {
    expect(overlays).toContain("draftBackup.restoreAvailable && shouldOfferBackupRestore(");
    expect(overlays).toContain("draftBackup.peek()");
  });
});
