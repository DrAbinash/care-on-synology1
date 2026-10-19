/**
 * STAGE 1 PR-A — the image-send audit row, against a real schema.
 *
 * Two halves on purpose.
 *
 * The DB-free half covers the decisions the writer makes (whose locality is
 * recorded, what counts as a payload) and runs everywhere.
 *
 * The database half exists because a mocked insert cannot fail: it would accept
 * the four new columns even if the migration never landed, and it would store a
 * base64 blob without complaining. "No image bytes are kept in the audit trail"
 * is only worth saying if the deployed table says it too, so these cases write
 * through Drizzle into PostgreSQL and read the row back.
 *
 * Everything this file writes is scoped to one `job_reference` marker and
 * deleted afterwards; it invents no clinical rows.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { aiReportingAuditLogsTable } from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import {
  hasPatientDerivedImage,
  isPayloadShaped,
  recordImageSendAudit,
  resolveAuditLocality,
  scrubPayloadShaped,
  type ImageSendAuditRecord,
} from "./imageSendAudit";

const LOCAL_ENDPOINT = "http://192.168.1.250:11434";
const PUBLIC_ENDPOINT = "https://api.deepseek.com";

/** 4 KB of base64 — the shape a JPEG chunk arrives in. */
const JPEG_BASE64 = "A".repeat(4096) + "==";

describe("imageSendAudit — locality is derived, not declared", () => {
  it("files a private endpoint as local", () => {
    expect(resolveAuditLocality("ollama", LOCAL_ENDPOINT)).toBe("local");
  });

  it("refuses to file a public endpoint as local because the provider is CALLED local", () => {
    expect(resolveAuditLocality("local_openai_compatible", "http://203.0.113.9:8000/v1")).toBe("cloud");
    expect(resolveAuditLocality("ollama", PUBLIC_ENDPOINT)).toBe("cloud");
  });

  it("records the send layer's answer over the settings' guess", () => {
    // A socket that opened on a public IP is cloud even if the config looked LAN.
    expect(resolveAuditLocality("ollama", LOCAL_ENDPOINT, "cloud")).toBe("cloud");
    expect(resolveAuditLocality("deepseek", PUBLIC_ENDPOINT, "local")).toBe("local");
  });

  it("writes `unknown` rather than a reassuring blank when no endpoint resolved", () => {
    expect(resolveAuditLocality("ollama", null)).toBe("unknown");
    expect(resolveAuditLocality("ollama", "   ")).toBe("unknown");
  });
});

describe("imageSendAudit — provenance rules match the policy", () => {
  it("treats unknown provenance as patient-derived", () => {
    expect(hasPatientDerivedImage(undefined)).toBe(true);
    expect(hasPatientDerivedImage([])).toBe(true);
  });

  it("only an operator's own phantom is not the patient's", () => {
    expect(hasPatientDerivedImage(["OPERATOR_SUPPLIED"])).toBe(false);
    expect(hasPatientDerivedImage(["OPERATOR_SUPPLIED", "VIEWPORT_CAPTURE"])).toBe(true);
    for (const s of ["UPLOAD", "PACS_SCREENSHOT", "VIEWPORT_CAPTURE", "DICOM"]) {
      expect(hasPatientDerivedImage([s])).toBe(true);
    }
  });
});

describe("imageSendAudit — the payload backstop", () => {
  it("recognises image bytes by shape", () => {
    expect(isPayloadShaped(JPEG_BASE64)).toBe(true);
    expect(isPayloadShaped(`data:image/jpeg;base64,${"B".repeat(600)}`)).toBe(true);
    expect(isPayloadShaped("gpt-4o")).toBe(false);
    expect(isPayloadShaped("compose_job:17")).toBe(false);
  });

  it("does not mistake long clinical prose or a wrapped URL for bytes", () => {
    const prose = "Findings of the lumbar spine. ".repeat(40); // 1240 chars, spaced
    expect(isPayloadShaped(prose)).toBe(false);
    const url = "http://192.168.1.250:11434/api/chat?model=qwen3-vl:8b&".repeat(20);
    expect(isPayloadShaped(url)).toBe(false);
  });

  it("redacts a payload and truncates a long-but-ordinary field", () => {
    expect(scrubPayloadShaped(JPEG_BASE64)).toBe("[redacted:payload-shaped-value]");
    const long = "x".repeat(400);
    const scrubbed = scrubPayloadShaped(long) ?? "";
    expect(scrubbed.length).toBeLessThanOrEqual(320);
    expect(scrubbed.endsWith("[truncated]")).toBe(true);
    expect(scrubPayloadShaped(null)).toBeNull();
  });
});

describe.skipIf(!hasDatabaseUrl())("imageSendAudit — the row that lands in PostgreSQL", () => {
  const marker = `pra-${randomUUID()}`;
  const written: string[] = [];

  /** `db.execute` hands back a pg Result on one driver and rows on another. */
  async function rawRows(query: ReturnType<typeof sql>): Promise<Record<string, string>[]> {
    const r = (await db.execute(query)) as unknown as
      | { rows?: Record<string, string>[] }
      | Record<string, string>[];
    return Array.isArray(r) ? r : (r.rows ?? []);
  }

  function ref(tag: string): string {
    const jobReference = `${marker}:${tag}`;
    written.push(jobReference);
    return jobReference;
  }

  async function readBack(jobReference: string): Promise<Record<string, unknown>[]> {
    return (await db
      .select()
      .from(aiReportingAuditLogsTable)
      .where(like(aiReportingAuditLogsTable.jobReference, jobReference))
      .execute()) as unknown as Record<string, unknown>[];
  }

  const base: ImageSendAuditRecord = {
    userId: 7,
    userName: "Dr Synthetic Reviewer",
    patientId: null,
    studyInstanceUID: "1.2.826.0.1.3680043.10.1234567890.PRA",
    accessionNumber: "PRA-ACC-1",
    provider: "ollama",
    model: "qwen3-vl:8b",
    resolvedUrl: LOCAL_ENDPOINT,
    numImages: 3,
    imageSourceTypes: ["PACS_SCREENSHOT", "PACS_SCREENSHOT", "VIEWPORT_CAPTURE"],
    success: true,
  };

  beforeAll(async () => {
    // Prove the migration, not just a clean boot: the four evidence columns have
    // to exist on this database and stay nullable, or an insert that predates
    // them would fail and a send would be filed as nothing.
    const cols = await rawRows(
      sql`select column_name, is_nullable, data_type from information_schema.columns
           where table_name = 'ai_reporting_audit_logs'
             and column_name in ('endpoint_locality','job_reference','correlation_id','image_source_types')
           order by column_name`,
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      "correlation_id",
      "endpoint_locality",
      "image_source_types",
      "job_reference",
    ]);
    for (const c of cols) {
      expect(c.is_nullable).toBe("YES");
      expect(c.data_type).toBe("text");
    }
  });

  afterAll(async () => {
    for (const jobReference of written) {
      await db
        .delete(aiReportingAuditLogsTable)
        .where(like(aiReportingAuditLogsTable.jobReference, jobReference))
        .execute();
    }
  });

  it("files who, where, how many and how it went", async () => {
    const jobReference = ref("local-success");
    // `filed` is the answer PR-A2's Clinical mode enforces on, so it is asserted
    // against a real insert here — not against a mock that always says true.
    await expect(
      recordImageSendAudit({
        ...base,
        jobReference,
        correlationId: `worklist:${jobReference}`,
      }),
    ).resolves.toEqual({ filed: true });
    const rows = await readBack(jobReference);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.provider).toBe("ollama");
    expect(row.model).toBe("qwen3-vl:8b");
    expect(row.endpointLocality).toBe("local");
    expect(row.numImages).toBe(3);
    expect(row.imageSourceTypes).toBe("PACS_SCREENSHOT,PACS_SCREENSHOT,VIEWPORT_CAPTURE");
    expect(row.studyInstanceUID).toBe(base.studyInstanceUID);
    expect(row.success).toBe(true);
    // The honest privacy answer: CARE does not strip identifiers from an image.
    expect(row.anonymized).toBe(false);
    expect(row.promptText).toBeNull();
  });

  it("files the refused send too, with a safe reason and no provider body", async () => {
    const jobReference = ref("cloud-refused");
    await recordImageSendAudit({
      ...base,
      provider: "deepseek",
      resolvedUrl: PUBLIC_ENDPOINT,
      model: null,
      executedLocality: "cloud",
      jobReference,
      success: false,
      safeFailureReason:
        "PHI_IMAGE_CLOUD_UNATTESTED — no clinician attested these patient-derived frames for this request.",
    });
    const row = (await readBack(jobReference))[0] as Record<string, unknown>;
    expect(row.endpointLocality).toBe("cloud");
    expect(row.success).toBe(false);
    expect(String(row.errorMessage)).toContain("PHI_IMAGE_CLOUD_UNATTESTED");
    expect(row.promptText).toBeNull();
  });

  it("will not file a public endpoint as local just because the row says local", async () => {
    const jobReference = ref("name-is-not-locality");
    await recordImageSendAudit({
      ...base,
      provider: "local_openai_compatible",
      resolvedUrl: "http://203.0.113.9:8000/v1",
      jobReference,
    });
    const row = (await readBack(jobReference))[0] as Record<string, unknown>;
    expect(row.endpointLocality).toBe("cloud");
  });

  it("keeps bytes out of every column when a caller pastes them into one", async () => {
    const jobReference = ref("payload-attempt");
    await recordImageSendAudit({
      ...base,
      jobReference,
      model: `qwen3-vl:8b ${JPEG_BASE64}`,
      userName: `data:image/jpeg;base64,${JPEG_BASE64}`,
      safeFailureReason: JPEG_BASE64,
    });
    const row = (await readBack(jobReference))[0] as Record<string, unknown>;
    for (const [column, value] of Object.entries(row)) {
      if (typeof value !== "string") continue;
      expect(isPayloadShaped(value), `${column} holds a payload`).toBe(false);
      // Independently of the writer's own detector: nothing in the stored row may
      // contain a long unbroken base64 run, truncated or otherwise.
      expect(value, `${column} holds a base64 run`).not.toMatch(/[A-Za-z0-9+/]{128,}/);
    }
    expect(String(row.userName)).toBe("[redacted:payload-shaped-value]");
    expect(String(row.errorMessage)).toBe("[redacted:payload-shaped-value]");
  });

  it("never blocks the send when the audit write itself fails", async () => {
    const logged: Array<{ message: string; fields: Record<string, unknown> }> = [];
    // `NaN` is what a bad parse upstream produces for an integer column: the
    // insert really throws, and the caller must still get its draft.
    //
    // PR-A2 added a return value so a caller can decide what an unfiled row means —
    // `filed: false` here, and still no throw, which is the part that must never
    // regress: a local Ollama draft is not held hostage by a broken audit insert.
    await expect(
      recordImageSendAudit(
        { ...base, patientId: Number.NaN, jobReference: ref("write-fails") },
        (message, fields) => logged.push({ message, fields }),
      ),
    ).resolves.toEqual({ filed: false });
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toBe("ai_image_send_audit_failed");
  });

  it("adds nothing to the table that could hold an image", async () => {
    const cols = await rawRows(
      sql`select column_name, data_type from information_schema.columns
           where table_name = 'ai_reporting_audit_logs' order by column_name`,
    );
    for (const c of cols) {
      expect(
        ["bytea", "blob", "json", "jsonb"],
        `${c.column_name} is of type ${c.data_type}, which could hold pixels`,
      ).not.toContain(c.data_type);
    }
  });
});
