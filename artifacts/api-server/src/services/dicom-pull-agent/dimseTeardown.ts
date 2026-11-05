/**
 * One-shot teardown for a dcmjs-dimse `Client` on a FAILED DIMSE operation.
 *
 * The pinned library (dcmjs-dimse 0.3.3) exposes `abort()` on `Client` but no
 * `close()` — `close()` belongs to `Server`. Calling the missing method threw a
 * TypeError from inside a `setTimeout` callback, which Node surfaces as an
 * `uncaughtException`; the API's handler logs it and exits the process, so a
 * single unreachable modality used to take the whole clinic server down.
 *
 * Only failure paths belong here. On success the library releases the
 * association itself (`done` → association release request), so aborting a
 * completed operation would send an A-ABORT to a modality that answered
 * correctly and could disturb an association the library is still draining.
 */
import { logger } from "../../lib/logger";

export type DimseReleasable = {
  abort?: () => void;
  clearRequests?: () => void;
};

/**
 * Releases the association this client owns and drops any queued work.
 * Never throws: it is called from timer and socket-error callbacks, where an
 * escaping exception kills PID 1. `abort()` itself throws
 * "Network has not been initialized" once the socket has already closed, which
 * is the normal state on the network-error path.
 */
export function releaseDimseClientAfterFailure(
  client: DimseReleasable | null | undefined,
  context: string,
): void {
  if (!client) return;
  try {
    client.clearRequests?.();
  } catch (err) {
    logger.warn({ err, context }, "[dimse-agent] teardown: clearRequests failed");
  }
  try {
    client.abort?.();
  } catch (err) {
    logger.debug({ err, context }, "[dimse-agent] teardown: association already released");
  }
}
