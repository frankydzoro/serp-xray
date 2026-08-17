"use client";

import { useEffect } from "react";
import { getToken } from "@/lib/api";

/**
 * Client-side guard for UX (the real protection is on the backend, require_auth).
 *
 * Does NOT block rendering children: pages are served immediately (SSR), and the
 * redirect to /login is done with a soft JS effect. This is resilient to slow/partial
 * hydration and to environments where sessionStorage is unavailable (sandboxed
 * browsers): the login form on /login is visible right away, and without a token
 * the API returns 401 anyway.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const path = window.location.pathname;
    const token = getToken();

    if (path === "/login") {
      // With a token, login is unnecessary — go home
      if (token) window.location.href = "/";
      return;
    }
    if (!token) {
      window.location.href = "/login";
    }
  }, []);

  return <>{children}</>;
}
