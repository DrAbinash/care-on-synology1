/**
 * Immutable Study Snapshot — pure logic (Phase P1 / Gate G5).
 *
 * No DB, no network — pure functions so the snapshot-integrity and late-series
 * detection tests run without a database. The DB persistence lives in
 * shadowPipeline.ts; the Orthanc fetch lives in studyImageFetch.ts.
 */
import { createHash } from "node:crypto";

/** One DICOM instance in a study's manifest. */
export interface InstanceRef {
  seriesUid: string;
  sopUid: string;
  modality?: string;
  seriesNumber?: number;
  instanceNumber?: number;
  numberOfFrames?: number;
  /** Orthanc REST instance id — used to render `/preview` when DICOMweb is off. */
  orthancInstanceId?: string;
}

export interface SnapshotManifest {
  studyInstanceUid: string;
  seriesCount: number;
  instanceCount: number;
  instances: InstanceRef[];
  contentHash: string;
}

/**
 * Deterministic, order-independent content hash of a study's instance set.
 * Adding or removing any series/instance changes the hash; reordering the same
 * set does not. This is the identity of a study revision.
 */
export function computeContentHash(studyInstanceUid: string, instances: InstanceRef[]): string {
  const keys = instances.map((i) => `${i.seriesUid}/${i.sopUid}`).sort();
  return createHash("sha256")
    .update(studyInstanceUid)
    .update("\n")
    .update(String(instances.length))
    .update("\n")
    .update(keys.join("\n"))
    .digest("hex");
}

export function buildSnapshotManifest(studyInstanceUid: string, instances: InstanceRef[]): SnapshotManifest {
  const seriesCount = new Set(instances.map((i) => i.seriesUid)).size;
  return {
    studyInstanceUid,
    seriesCount,
    instanceCount: instances.length,
    instances,
    contentHash: computeContentHash(studyInstanceUid, instances),
  };
}

export type RevisionDecision =
  | { kind: "unchanged"; contentHash: string }
  | { kind: "new"; revision: 1; contentHash: string }
  | { kind: "revision"; revision: number; contentHash: string; addedInstances: number; removedInstances: number };

/**
 * Decide whether a freshly-built manifest is a no-op (same content), the first
 * snapshot, or a new revision (late-arriving series / changed instance set).
 * Never signals an overwrite — a changed set is always a NEW revision.
 */
export function decideRevision(
  prev: { contentHash: string; revision: number; instanceCount: number } | null,
  next: SnapshotManifest,
): RevisionDecision {
  if (!prev) return { kind: "new", revision: 1, contentHash: next.contentHash };
  if (prev.contentHash === next.contentHash) return { kind: "unchanged", contentHash: next.contentHash };
  return {
    kind: "revision",
    revision: prev.revision + 1,
    contentHash: next.contentHash,
    addedInstances: Math.max(0, next.instanceCount - prev.instanceCount),
    removedInstances: Math.max(0, prev.instanceCount - next.instanceCount),
  };
}
