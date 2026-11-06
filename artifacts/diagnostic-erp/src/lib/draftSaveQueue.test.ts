import { describe, expect, it } from "vitest";
import { createDraftSaveQueue } from "./draftSaveQueue";

/**
 * The queue is what stops ONE console racing itself: the measured transcript in
 * draftSaveQueue.ts's header shows three saves fired inside 40 ms for one study,
 * the third still claiming the study had no draft row one millisecond after the
 * first created it. These pin the ordering that makes the claim impossible, and
 * the two properties that keep ordering from becoming a new trap: a failed save
 * must not wedge the ones behind it, and one study's queue must not hold up
 * another's.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("createDraftSaveQueue — one save in flight per study", () => {
  it("runs saves for one study one at a time, in the order they were asked for", async () => {
    const queue = createDraftSaveQueue();
    const order: string[] = [];
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const saves = gates.map((gate, index) =>
      queue.run(101, async () => {
        order.push(`start:${index + 1}`);
        await gate.promise;
        order.push(`end:${index + 1}`);
        return index + 1;
      }),
    );
    await flush();
    // Only the first has started; the other two are waiting, not interleaved.
    expect(order).toEqual(["start:1"]);
    gates[0].resolve();
    await flush();
    expect(order).toEqual(["start:1", "end:1", "start:2"]);
    gates[1].resolve();
    gates[2].resolve();
    expect(await Promise.all(saves)).toEqual([1, 2, 3]);
    expect(order).toEqual([
      "start:1", "end:1", "start:2", "end:2", "start:3", "end:3",
    ]);
  });

  it("a save queued behind another still holds the queue once the one ahead settles", async () => {
    const queue = createDraftSaveQueue();
    const first = deferred<void>();
    const second = deferred<void>();
    const firstRun = queue.run(7, async () => { await first.promise; return "a"; });
    const secondRun = queue.run(7, async () => { await second.promise; return "b"; });
    first.resolve();
    expect(await firstRun).toBe("a");
    await flush();

    // The second save is now in flight and is the tail. Clearing the entry when
    // the FIRST settled — instead of only when it is still the tail — would let
    // this third save run concurrently with it.
    let thirdStarted = false;
    const thirdRun = queue.run(7, async () => { thirdStarted = true; return "c"; });
    await flush();
    expect(thirdStarted).toBe(false);
    second.resolve();
    expect(await secondRun).toBe("b");
    expect(await thirdRun).toBe("c");
    expect(thirdStarted).toBe(true);
  });

  it("lets the save behind a rejected one run, and hands each caller its own outcome", async () => {
    const queue = createDraftSaveQueue();
    const boom = new Error("409 DRAFT_REVISION_CONFLICT");
    const failure = queue.run(101, async () => { throw boom; });
    const after = queue.run(101, async () => 1101);
    await expect(failure).rejects.toBe(boom);
    await expect(after).resolves.toBe(1101);
  });

  it("keeps one study's queue off another's", async () => {
    const queue = createDraftSaveQueue();
    const held = deferred<void>();
    let otherStarted = false;
    const leaving = queue.run(101, async () => { await held.promise; return "left"; });
    const opening = queue.run(202, async () => { otherStarted = true; return "opened"; });
    await flush();
    // A flush for the study being left must not hold up the study being opened.
    expect(otherStarted).toBe(true);
    expect(await opening).toBe("opened");
    held.resolve();
    expect(await leaving).toBe("left");
  });

  it("runs a save with no study immediately — there is no row to race for", async () => {
    const queue = createDraftSaveQueue();
    const held = deferred<void>();
    const blocking = queue.run(101, async () => { await held.promise; return "busy"; });
    await expect(queue.run(null, async () => "ran")).resolves.toBe("ran");
    held.resolve();
    await blocking;
  });
});
