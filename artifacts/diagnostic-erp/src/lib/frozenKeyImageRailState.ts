/**
 * The one question the key-image rail answers wrong under load: are there no
 * images, or do we not know yet?
 *
 * The rail's data is a chain of two reads — the study's draft id, then that
 * draft's frozen images — and each has an "I have nothing" branch that renders
 * `No frozen captures yet`. That sentence is a claim about the study, so it is
 * only allowed when a read actually answered. Measured on current main
 * (tmp/p1-429-timeline.log): with 42 of 43 API calls refused, the rail was not
 * on screen at all for 66 seconds, and the strip that did eventually appear
 * would have said "no captures" about a study holding fourteen.
 *
 * The ordering below is the whole safety property: a pending or failed read can
 * never produce `empty`, and images already on screen are never thrown away
 * because a later refresh failed.
 */
import { isRateLimited } from "./fetchApi";

export type RailReadState =
  /** Tiles are on screen — including when a refresh behind them failed. */
  | { kind: "images"; count: number }
  /** A read is still in flight (including one waiting out a rate-limit window). */
  | { kind: "loading" }
  /** The server refused; it is a scheduling problem, not an absence. */
  | { kind: "rate-limited"; waitSeconds: number }
  /** Something else went wrong and no images are displayed. */
  | { kind: "read-failed" }
  /** A read answered "none". The only state allowed to say so. */
  | { kind: "empty" };

const DEFAULT_WAIT_MS = 60_000;

function failureState(err: unknown): RailReadState {
  if (isRateLimited(err)) {
    return {
      kind: "rate-limited",
      waitSeconds: Math.max(1, Math.round((err.retryAfterMs ?? DEFAULT_WAIT_MS) / 1000)),
    };
  }
  return { kind: "read-failed" };
}

export function frozenKeyImageRailState(opts: {
  /** The study's draft anchor. Null means "not known", not "does not exist". */
  draftId: number | null;
  /** The draft-id read has not answered for this study yet. */
  draftPending: boolean;
  draftError?: unknown;
  /** The key-images read is in flight (it is disabled until a draft id exists). */
  imagesPending: boolean;
  imagesError?: unknown;
  /** Tiles currently rendered, from this read or the last good one. */
  itemCount: number;
}): RailReadState {
  if (opts.itemCount > 0) return { kind: "images", count: opts.itemCount };
  if (opts.draftError) return failureState(opts.draftError);
  if (opts.imagesError) return failureState(opts.imagesError);
  if (opts.draftPending) return { kind: "loading" };
  // Past this point the anchor read has ANSWERED without failing, so a null
  // draft id really means "this study has no draft yet" — and `empty` is the
  // honest word for it.
  if (opts.draftId == null) return { kind: "empty" };
  if (opts.imagesPending) return { kind: "loading" };
  return { kind: "empty" };
}

/**
 * Whether the rail belongs on screen at all.
 *
 * It used to be mounted only once a network read had described the study, so a
 * refused read removed the strip, its error banner and its retry button together
 * — the control that reports the failure was the thing the failure deleted. The
 * rail's own data is keyed on the study opened in the URL, which is known before
 * any request returns.
 */
export function keyImageRailShouldMount(studyAnchor: unknown): boolean {
  const id = Number(studyAnchor);
  return Number.isFinite(id) && id > 0;
}
