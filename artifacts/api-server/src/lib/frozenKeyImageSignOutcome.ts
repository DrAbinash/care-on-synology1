/**
 * The shape every signing path reports for the freeze-at-sign step
 * (`freezeUncoveredImageRefsForSign`), and the one case the counts could not
 * describe: the freeze itself threw.
 *
 * A throw has always been swallowed — by ruling, because the finalize
 * transaction has already committed and re-throwing would either lose a signed
 * report or make the legacy fallback write a second one. What the swallow used
 * to cost is the desk's knowledge: a partial failure reported
 * `placeholders: 2` and the workspace said so in a destructive toast, while a
 * failure that lost EVERY attached picture reported nothing at all. The worst
 * case was the quietest, which is the opposite of what the radiologist needs.
 *
 * So a failed freeze keeps the same contract — 201, signed report unaffected,
 * the field is additive — and carries `failed: true` instead of being omitted.
 */

export type FrozenImageSignOutcome = {
  frozen: number;
  placeholders: number;
  skipped: number;
  /** True when the freeze threw, so the three counts below were never measured. */
  failed?: boolean;
  error?: string;
};

export function frozenImageSignFailure(err: unknown): FrozenImageSignOutcome {
  return {
    frozen: 0,
    placeholders: 0,
    skipped: 0,
    failed: true,
    error: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Run the freeze and turn a throw into the announced outcome, so no signing
 * path can degrade back to silence. `onError` keeps each site's own log line
 * and identifiers — the swallow is deliberate, the log is the audit trail.
 */
export async function freezeForSignSafely(
  freeze: () => Promise<FrozenImageSignOutcome>,
  onError: (err: unknown) => void,
): Promise<FrozenImageSignOutcome> {
  try {
    return await freeze();
  } catch (err) {
    onError(err);
    return frozenImageSignFailure(err);
  }
}
