// Responsive breakpoint hook.
//
// Returns `{ isDesktop }` — true when viewport width >= 1024px (Tailwind `lg`).
// Listens to a `matchMedia` query so the component re-renders on resize.

import { useEffect, useState } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";

export function useBreakpoint() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return { isDesktop };
}
