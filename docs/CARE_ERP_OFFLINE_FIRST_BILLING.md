# CARE ERP — Offline-First Billing (Foundation)

*The billing counter must keep working through a network blip or a momentary
NAS outage. This foundation lets a bill/order be saved locally the instant the
server is unreachable and replayed — exactly once — when connectivity returns.*

## The idea in one paragraph

Every bill/order POST already carries a **`clientRef`** idempotency key, and the
API server deduplicates on it (see `orders.clientRef` / `bills.clientRef`). This
foundation adds a **durable client-side outbox** (IndexedDB): when a submit fails
because the network is down, the mutation — with its stable `clientRef` — is
persisted locally and the user is told "saved, will sync". A background replayer
drains the outbox in order when the browser comes back online. Because replay
uses the same `clientRef`, re-sending one that actually reached the server just
returns the existing record. **Bills are never lost and never duplicated.**

## What's included

| Piece | File | Tested |
| --- | --- | --- |
| Pure outbox core (build/enqueue/replay/submit) | `src/lib/offlineOutbox.ts` | 13 unit tests (`offlineOutbox.test.ts`) |
| IndexedDB store + in-memory fallback | `src/lib/offlineOutbox.ts` | — (thin adapter) |
| React hook (auto-replay, pending count) | `src/hooks/useOfflineOutbox.ts` | — (wires the core) |

It builds on the existing `reliability.ts` (`isTransientError`) and
`useOnlineStatus.ts`, and is **additive**: no existing billing flow is changed
until a page opts in.

## Replay semantics (why it's safe)

`replayOutbox` walks pending entries **FIFO** and:

- **success** → the entry is deleted; count drops.
- **transient failure** (offline, `Failed to fetch`, 502/503/504) → the pass
  **stops** and leaves that entry and everything after it queued. The network is
  down; hammering it or reordering would only cause harm.
- **permanent failure** (4xx: validation, auth) → the entry is marked
  **`failed`** and replay **continues**. One bad bill can't block the good ones
  behind it; an operator reviews failed entries and re-edits or discards them.

Idempotency (the `clientRef`) makes the transient case safe: a bill that *did*
reach the server before the connection dropped is returned as-is on replay, not
recreated.

## Wiring it into the billing page (opt-in)

The existing bill-create call is untouched. To make it offline-first, swap the
direct `api.post` for the hook's `submit`:

```tsx
import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";

function BillDesk() {
  const outbox = useOfflineOutbox();

  async function saveBill(payload: BillPayload) {
    const label = `Bill • ${payload.patientName} • ₹${payload.total}`;
    const r = await outbox.submit<{ id: number }>("/api/bills", payload, label);
    if (r.status === "queued") {
      toast.success("Saved offline — will sync automatically when back online");
      resetForm();                     // the counter keeps moving
    } else {
      navigate(`/bills/${r.data!.id}`); // sent straight through
    }
  }

  // Optional UI: show `outbox.pending` queued / `outbox.failed` needing attention,
  // a manual `outbox.replayNow()` button, and `outbox.entries` in a drawer.
}
```

A permanent validation error still throws from `submit` exactly as today — catch
it and show the message; it is **not** queued.

## Notes, limits, and next steps

- **Scope of the foundation.** This ships the durable queue, the replay engine,
  the idempotency plumbing, and the hook — the reusable core. Turning it on for
  the Bill Desk (and Orders) is the opt-in swap above.
- **Reads are still online.** This handles *writes*. Offline *reads* (test
  catalogue, patient lookup) would need a cached-GET layer / service worker —
  a separate, larger step. The test catalogue is small and a good first candidate.
- **Not the Electron sync engine.** The existing `sync_queue` / `useSyncStatus`
  path is the local-Postgres↔cloud replication used by the Windows build. This
  outbox is the **web build's** counterpart for in-flight mutations; the two are
  complementary (surface both counts in the UI if you run both).
- **Storage.** IndexedDB persists across reloads and crashes. In the rare
  environment without it (SSR, hardened private mode) the store degrades to
  in-memory (tab lifetime) rather than crashing.
- **Failed entries.** Expose `outbox.failed` and `outbox.discard(id)` so a
  supervisor can clear a permanently-rejected mutation after handling it.
