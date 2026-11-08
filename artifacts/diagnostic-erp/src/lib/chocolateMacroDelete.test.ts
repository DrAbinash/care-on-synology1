/**
 * B10 — deleting a workspace macro box must delete its server row too.
 *
 * The editor's Delete button used to call only `deleteChocolateTile`
 * (localStorage). `hydrateChocolateMacrosFromServer` runs at workspace hydrate
 * and `mergeChocolateTilesWithServer` re-appends every server row the local
 * cache is missing — so the "deleted" tile resurrected on the next open, which
 * is exactly what a delete that only one side of the sync heard about looks like.
 *
 * These tests pin `deleteChocolateTileOnServer`, the delete-side counterpart of
 * `upsertChocolateTileOnServer`: the row is resolved by serverId, or by
 * clientKey when the cache never learned the server id, and a tile with no
 * server presence deletes nothing server-side (a pre-sync local delete is
 * already complete).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/fetchApi", () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(async () => ({})),
  },
}));

import { api } from "@/lib/fetchApi";
import { deleteChocolateTileOnServer } from "./chocolateMacrosApi";
import type { ServerChocolateFinding } from "./chocolateMacrosApi";

const get = vi.mocked(api.get);
const del = vi.mocked(api.delete);

function serverRow(over: Partial<ServerChocolateFinding>): ServerChocolateFinding {
  return {
    id: 77,
    modality: "MR",
    bodyPart: "brain",
    groupName: "brain",
    shortName: "Meningioma",
    findingText: "Extra-axial dural-based mass.",
    impressionText: null,
    isCritical: false,
    sortOrder: 0,
    clientKey: "brain-meningioma",
    anatomicalSection: "",
    conflictGroup: "",
    baselineReplaces: "",
    supportsLaterality: false,
    sectionsOwned: "findings",
    ...over,
  };
}

beforeEach(() => {
  get.mockReset();
  del.mockReset();
  del.mockResolvedValue({});
});

describe("deleteChocolateTileOnServer", () => {
  it("deletes by the cached serverId without a lookup", async () => {
    await deleteChocolateTileOnServer("brain", { id: "brain-meningioma", serverId: 77 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("/api/radiology/chocolate-findings/77");
    expect(get, "a cached serverId answers the question; no extra round-trip").not.toHaveBeenCalled();
  });

  it("resolves the row by clientKey when the cache has no serverId", async () => {
    get.mockResolvedValue([
      serverRow({ id: 51, clientKey: "other-tile" }),
      serverRow({ id: 88, clientKey: "brain-meningioma" }),
    ]);
    await deleteChocolateTileOnServer("brain", { id: "brain-meningioma", serverId: undefined });
    expect(get).toHaveBeenCalledWith("/api/radiology/chocolate-findings?modality=MR&bodyPart=Brain");
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("/api/radiology/chocolate-findings/88");
  });

  it("deletes nothing server-side for a tile that was never synced", async () => {
    get.mockResolvedValue([serverRow({ id: 51, clientKey: "other-tile" })]);
    await deleteChocolateTileOnServer("brain", { id: "brain-unsynced", serverId: undefined });
    expect(del, "no server row, no server delete — the local delete was already complete").not.toHaveBeenCalled();
  });

  it("the workspace editor's Delete button calls the server delete (source pin)", async () => {
    // Source-level pin in the characterization style: the wiring is one line in a
    // component the test environment cannot mount cheaply (workspace store +
    // dialog tree), and what must not regress is that the call is made at all —
    // the failure mode B10 described was exactly this line being absent.
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/radiology/zai-workspace/chocolate-box-macros.tsx"),
      "utf8",
    );
    expect(src).toContain("deleteChocolateTileOnServer(state.key, state.tile!)");
    // Local delete stays: the cache must not resurrect the tile either.
    expect(src).toContain("deleteChocolateTile(state.key, state.tile!.id)");
  });
});
