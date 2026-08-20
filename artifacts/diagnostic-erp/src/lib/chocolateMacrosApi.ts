/**
 * Sync workspace chocolate macros ↔ radiology_chocolate_findings.
 * Server is authoritative for custom/owned tiles; localStorage remains cache.
 */

import { api } from "@/lib/fetchApi";
import {
  listedChocolateBoxSets,
  loadChocolateTiles,
  saveChocolateTiles,
  type ChocolateTile,
} from "./findingsMacros";
import {
  chocolateSetToBodyPart,
  chocolateSetToModality,
} from "./chocolateMacroOwnership";

const SERVER_FLAG = "care-rad-chocolate-boxes-server-v1";

export type ServerChocolateFinding = {
  id: number;
  modality: string;
  bodyPart: string;
  groupName: string;
  shortName: string;
  findingText: string;
  impressionText: string | null;
  isCritical: boolean;
  sortOrder: number;
  clientKey: string | null;
  anatomicalSection: string;
  conflictGroup: string;
  baselineReplaces: string;
  supportsLaterality: boolean;
  sectionsOwned: string;
};

export function isChocolateServerAuthoritative(): boolean {
  try {
    return localStorage.getItem(SERVER_FLAG) === "1";
  } catch {
    return false;
  }
}

function markChocolateServerAuthoritative(): void {
  try {
    localStorage.setItem(SERVER_FLAG, "1");
  } catch { /* ignore */ }
}

function sectionsOwnedList(raw: string | undefined): ChocolateTile["sectionsOwned"] {
  const parts = (raw ?? "findings").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(["findings", "impression", "recommendation", "technique"]);
  return parts.filter((p): p is NonNullable<ChocolateTile["sectionsOwned"]>[number] => allowed.has(p));
}

function serverRowToTile(row: ServerChocolateFinding): ChocolateTile {
  return {
    id: row.clientKey || `srv_${row.id}`,
    label: row.shortName,
    text: row.findingText,
    impressionText: row.impressionText ?? undefined,
    serverId: row.id,
    anatomicalSection: row.anatomicalSection || undefined,
    conflictGroup: row.conflictGroup || undefined,
    baselineReplaces: row.baselineReplaces || undefined,
    supportsLaterality: row.supportsLaterality,
    sectionsOwned: sectionsOwnedList(row.sectionsOwned),
    custom: true,
    legacyAppend: !(row.anatomicalSection || row.conflictGroup || row.baselineReplaces),
  };
}

function tileToServerPayload(setKey: string, tile: ChocolateTile) {
  return {
    modality: chocolateSetToModality(setKey),
    bodyPart: chocolateSetToBodyPart(setKey),
    groupName: setKey,
    shortName: tile.label,
    findingText: tile.text,
    impressionText: tile.impressionText ?? null,
    clientKey: tile.id,
    anatomicalSection: tile.anatomicalSection ?? "",
    conflictGroup: tile.conflictGroup ?? "",
    baselineReplaces: tile.baselineReplaces ?? "",
    supportsLaterality: Boolean(tile.supportsLaterality),
    sectionsOwned: (tile.sectionsOwned ?? ["findings"]).join(","),
    isCritical: false,
    sortOrder: 0,
  };
}

/** Merge server rows for a set into local tiles (server wins on matching clientKey). */
export function mergeChocolateTilesWithServer(
  local: ChocolateTile[],
  serverRows: ServerChocolateFinding[],
  setKey: string,
): ChocolateTile[] {
  const forSet = serverRows.filter((r) => r.groupName === setKey || r.bodyPart === chocolateSetToBodyPart(setKey));
  if (forSet.length === 0) return local.map((t) => ({ ...t }));
  const byKey = new Map(forSet.map((r) => [r.clientKey || `srv_${r.id}`, r]));
  const used = new Set<string>();
  const merged: ChocolateTile[] = local.map((t) => {
    const row = byKey.get(t.id);
    if (!row) return { ...t };
    used.add(t.id);
    return { ...t, ...serverRowToTile(row), id: t.id };
  });
  for (const row of forSet) {
    const key = row.clientKey || `srv_${row.id}`;
    if (used.has(key)) continue;
    merged.push(serverRowToTile(row));
  }
  return merged;
}

export async function fetchChocolateFindingsFromServer(opts?: {
  modality?: string;
  bodyPart?: string;
}): Promise<ServerChocolateFinding[]> {
  const q = new URLSearchParams();
  if (opts?.modality) q.set("modality", opts.modality);
  if (opts?.bodyPart) q.set("bodyPart", opts.bodyPart);
  const qs = q.toString();
  const rows = await api.get<ServerChocolateFinding[]>(
    `/api/radiology/chocolate-findings${qs ? `?${qs}` : ""}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function upsertChocolateTileOnServer(
  setKey: string,
  tile: ChocolateTile,
): Promise<ChocolateTile> {
  const payload = tileToServerPayload(setKey, tile);
  if (tile.serverId) {
    const row = await api.patch<ServerChocolateFinding>(
      `/api/radiology/chocolate-findings/${tile.serverId}`,
      payload,
    );
    return { ...tile, ...serverRowToTile(row), id: tile.id };
  }
  // Dedupe by clientKey among existing
  const existing = await fetchChocolateFindingsFromServer({
    modality: payload.modality,
    bodyPart: payload.bodyPart,
  });
  const match = existing.find((r) => r.clientKey === tile.id);
  if (match) {
    const row = await api.patch<ServerChocolateFinding>(
      `/api/radiology/chocolate-findings/${match.id}`,
      payload,
    );
    return { ...tile, ...serverRowToTile(row), id: tile.id };
  }
  const row = await api.post<ServerChocolateFinding>("/api/radiology/chocolate-findings", payload);
  markChocolateServerAuthoritative();
  return { ...tile, ...serverRowToTile(row), id: tile.id };
}

/**
 * Push local custom tiles missing on server; pull server into local cache.
 * Does not delete browser data until server write succeeds per tile.
 */
export async function hydrateChocolateMacrosFromServer(): Promise<void> {
  let serverRows: ServerChocolateFinding[] = [];
  try {
    serverRows = await fetchChocolateFindingsFromServer();
  } catch {
    return; // offline — keep local cache; do not claim authoritative
  }

  for (const set of listedChocolateBoxSets()) {
    const local = loadChocolateTiles(set.key);
    const merged = mergeChocolateTilesWithServer(local, serverRows, set.key);
    // Push custom tiles not yet on server
    const next: ChocolateTile[] = [];
    for (const tile of merged) {
      const onServer = serverRows.some(
        (r) => r.clientKey === tile.id || (tile.serverId != null && r.id === tile.serverId),
      );
      if (tile.custom && !onServer) {
        try {
          next.push(await upsertChocolateTileOnServer(set.key, tile));
        } catch {
          next.push(tile);
        }
      } else {
        next.push(tile);
      }
    }
    saveChocolateTiles(set.key, next);
  }
  markChocolateServerAuthoritative();
}
