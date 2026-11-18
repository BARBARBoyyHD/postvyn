import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/**
 * `useSyncExternalStore` rather than an effect that sets state: the media query *is* the external
 * store, and the React Compiler lint forbids the cascading render the effect version causes.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
