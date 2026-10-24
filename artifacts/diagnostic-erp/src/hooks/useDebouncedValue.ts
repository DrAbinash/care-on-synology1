import { useEffect, useRef, useState } from "react";

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
 */
export function useKeyedDebouncedValue<T>(value: T, key: string, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  const keyRef = useRef(key);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, key, delayMs]);

  return debounced;
}
