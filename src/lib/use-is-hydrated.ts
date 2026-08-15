"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Returns false during server rendering and the first client render, then true.
 *
 * Use this instead of the `useState(false)` + `useEffect(() => setMounted(true))`
 * pattern: it reads the same but avoids the extra render pass, and satisfies
 * `react-hooks/set-state-in-effect`.
 */
export function useIsHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
