import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * no further changes.
 *
 * Use this to wrap search-box state before passing it into a server query
 * (useListPatients({ search }), etc.) so the API isn't hit on every single
 * keystroke — the input itself still updates instantly (it's not debounced,
 * only the value handed to the query is), so typing feels completely
 * normal to the user.
 *
 * Example:
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebouncedValue(search, 350);
 *   const { data } = useListPatients({ search: debouncedSearch || undefined });
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * A debounced copy of `value` whose timer is RESET by `key`, not by `value`
 * alone: when the identity changes, the new value is adopted immediately —
 * no debounce window, no flush wait.
 *
 * For values that describe the thing currently open (a study's structured
 * findings map, a report's flags), a plain debounce holds the PREVIOUS
 * study's value for `delayMs` after a switch, and anything downstream that
 * pairs it with an instantly-flushed sibling (the clinical-texts mirror
 * flushes on study switch) reads a two-study mixture. The key makes the
 * debounce apply only to changes WITHIN one identity, which is the churn it
 * exists to absorb — same rule as useDebouncedWorkspaceClinicalTexts.
 *
 * Adoption happens DURING the render that first sees the new key (React's
 * adjust-state-when-a-prop-changes pattern), not in an effect: an
 * effect-based adoption still COMMITS one (new key, old value) render, and
 * any downstream cache key derived in that commit — the Section-9 preview's
 * queryKey does exactly this — mints a two-study mixture: one extra server
 * round-trip per study switch, cached under a pairing that describes no
 * real report. React discards the in-progress render after a render-phase
 * setState and re-renders with the adopted value before committing, so no
 * committed render ever mixes identities.
 */
export function useKeyedDebouncedValue<T>(value: T, key: string, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  const [prevKey, setPrevKey] = useState(key);

  // Adjust state during render when the identity changes (the React-docs
  // pattern; setState of the component's OWN state during its own render is
  // sanctioned and re-renders immediately without committing the mixture).
  if (prevKey !== key) {
    setPrevKey(key);
    setDebounced(value);
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
