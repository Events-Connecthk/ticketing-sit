"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    fbq?: (
      action: string,
      event: string,
      params?: Record<string, unknown>
    ) => void;
    _fbq?: unknown;
  }
}

/** Fires Meta Pixel PageView on App Router navigations (initial load is in layout Script). */
export function MetaPixelPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstLoad = useRef(true);

  useEffect(() => {
    // Root layout Script already fires PageView on first paint — skip duplicate
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    if (typeof window === "undefined" || typeof window.fbq !== "function") {
      return;
    }
    window.fbq("track", "PageView");
  }, [pathname, searchParams]);

  return null;
}
