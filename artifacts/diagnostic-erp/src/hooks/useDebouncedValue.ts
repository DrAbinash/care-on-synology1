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
