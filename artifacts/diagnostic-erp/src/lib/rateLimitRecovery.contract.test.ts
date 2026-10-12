/**
 * Wiring contracts for the rate-limit recovery.
 *
 * The decision logic is unit-tested where it lives
 * (`studyUidLookupNotice.test.ts`, `frozenKeyImageRailState.test.ts`). What
 * those tests cannot see is whether the components actually consult it — the
 * defect this PR fixes survived #942 precisely because the honest banner was
 * written and then gated behind a condition that a rate limit also removes.
 * These assertions bind the components to the seams.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const VIEWER = read("../components/EmbeddedWadoViewer.tsx");
const COLUMN = read("../components/radiology/workspace/ViewerColumn.tsx");
const RAIL = read("../components/radiology/FrozenKeyImagesRail.tsx");

describe("the embedded viewer distinguishes a rate limit from an Orthanc outage", () => {
  it("classifies the lookup error instead of naming Orthanc", () => {
    expect(VIEWER).toContain("describeStudyUidLookupFailure(err)");
    expect(VIEWER).toContain("selectLookupNotice(");
    // The old string was printed for every error, including one Orthanc never
    // saw. The wording survives only inside the notice, on the 502 branch.
    expect(VIEWER).not.toMatch(/Orthanc lookup failed\.\s*Try Search Orthanc archive/);
  });

  it("waits out the server's window instead of giving up after two attempts", () => {
    const at = VIEWER.indexOf('queryKey: ["resolve-study-uid"');
    expect(at).toBeGreaterThan(-1);
    const block = VIEWER.slice(at, VIEWER.indexOf("});", at));
    expect(block).toContain("...rateAwareRetry");
    expect(block).not.toMatch(/^\s*retry: 1,$/m);
  });

  it("offers a retry control that re-runs the lookup", () => {
    expect(VIEWER).toContain('data-testid="study-uid-lookup-retry"');
    expect(VIEWER).toContain("refetchResolve()");
  });

  it("shows the refusal during the wait, not two minutes after it", () => {
    // The notice only helps if it appears while the retry is scheduled: with the
    // live limiter's 60-second Retry-After and two retries, `useQuery`'s `error`
    // is not committed until roughly two minutes in. So the queryFn records what
    // it caught and the panel reads that. Without this the whole wait is spent on
    // "Looking up study in Orthanc archive…" — the misattribution this PR fixes,
    // in its pending form.
    const at = VIEWER.indexOf("queryFn: async () => {");
    expect(at).toBeGreaterThan(-1);
    const block = VIEWER.slice(at, VIEWER.indexOf("...rateAwareRetry", at));
    expect(block).toMatch(/catch \(err\) \{/);
    // Not just "a setRefusal call exists" — it must store the refusal it just
    // described, or the wait renders nothing and the gate is decoration.
    expect(block).toContain("describeStudyUidLookupFailure(err)");
    expect(block).toMatch(/setRefusal\(\(prev\)[\s\S]{0,400}: said,/);
    expect(block).toContain("throw err;");
    expect(VIEWER).toContain("selectLookupNotice({ canResolve, committedError: resolveError, refusal })");
    // A refusal belongs to one worklist entry; switching studies must not carry
    // the previous refusal onto a study whose lookup has not run.
    expect(VIEWER).toMatch(/setRefusal\(null\);\s*\}, \[worklistId\]\);/);
  });
});

describe("the key-image rail is not deleted by the failure it reports", () => {
  it("mounts on the open study anchor, not on a network-resolved identity", () => {
    expect(COLUMN).toContain("keyImageRailShouldMount(studyId)");
    expect(COLUMN).not.toMatch(/&& reportIdentity && \(/);
  });

  it("is told whether the draft anchor is unknown, absent or refused", () => {
    const at = COLUMN.indexOf("<FrozenKeyImagesRail");
    const block = COLUMN.slice(at, at + 900);
    expect(block).toContain("draftReadPending={draftReadPending}");
    expect(block).toContain("draftError={existingDraftError}");
    expect(block).toContain("onRetryDraftRead=");
  });

  it("does not call a refused picker an unlinked study", () => {
    const at = COLUMN.indexOf("pacsBlockedTitle={");
    const block = COLUMN.slice(at, at + 700);
    expect(block).toContain("Waiting for the reporting server");
    expect(block).toContain("This report is not linked to a PACS study yet");
  });

  it("derives its empty claim from the read state, not from a zero count", () => {
    expect(RAIL).toContain("frozenKeyImageRailState({");
    expect(RAIL).toContain('readState.kind === "empty"');
    // `items.length === 0 && !q.isError` was the old test: a query that had not
    // answered yet satisfied it.
    expect(RAIL).not.toContain("items.length === 0 && !q.isError");
  });

  it("retries the read that actually failed", () => {
    // The images query is `enabled: !!draftId`, so refetching it while the
    // anchor has no draft id asks nothing at all.
    expect(RAIL).toContain("if (anchorFailed) onRetryDraftRead?.();");
  });

  it("will not adopt “there is no draft” from a read that failed", () => {
    // useRadiologyDraftId has no render harness in this repo, so its one
    // rate-limit decision is pinned here: the refusal must stop the adoption
    // effect, or a refused read stamps the study as settled on "no draft" and
    // the later successful refetch is ignored (the rail then sits on "no
    // captures" for a study holding images).
    const hook = read("../hooks/useRadiologyDraftId.ts");
    const guard = hook.indexOf("if (existingDraftError) return;");
    const adoption = hook.indexOf("setDraftId(pickAdoptedDraftId(");
    expect(guard).toBeGreaterThan(-1);
    expect(adoption).toBeGreaterThan(guard);
    // The pending read must also hold the effect back: adopting while it is
    // still in flight is the same false "no draft".
    expect(hook).toContain("if (!studyId || draftReadPending) return;");
  });

  it("keeps every early return below every hook, so the hook order cannot change", () => {
    // This PR introduced a second early return and put it above the component's
    // `useMutation`, which crashed the whole viewer column with
    // "Rendered more hooks than during the previous render" on the FIRST
    // healthy load — the rail vanished for the common case, not the rate-limited
    // one. No unit test could see it; this structural check can.
    const body = RAIL.slice(RAIL.indexOf("export default function FrozenKeyImagesRail"));
    const hooks = [...body.matchAll(/\buse[A-Z]\w*\(/g)];
    const lastHook = hooks.length ? hooks[hooks.length - 1].index ?? -1 : -1;
    expect(lastHook).toBeGreaterThan(-1);
    // Three shapes a component-level exit can take — a bare `return`, an inline
    // `if (…) return`, and a guard block whose body returns. Narrowing this to
    // `return (` alone let a `return null;` above the hooks pass this test while
    // it would crash the same way on screen.
    const GUARD = /^ {2}(?:return\b|if \([^\n]*\) return\b)|^ {2}if \([^\n]*\) \{\n {4}return\b|^ {4}return [(<]/m;
    const firstReturn = body.search(GUARD);
    expect(firstReturn, "a component-level exit sits above the last hook call").toBeGreaterThan(lastHook);
  });
});

describe("the honest words survive in both directions", () => {
  it("still tells a real Orthanc outage how to be worked around", () => {
    const notice = read("./studyUidLookupNotice.ts");
    expect(notice).toContain("Search Orthanc archive");
    expect(notice).toContain("Orthanc was not asked");
  });
});
