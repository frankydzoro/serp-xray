"use client";

import { useEffect } from "react";
import { getToken } from "@/lib/api";

/**
 * Клиентский guard для UX (реальная защита — на бэкенде, require_auth).
 *
 * НЕ блокирует рендер children: страницы отдаются сразу (SSR), а редирект
 * на /login делается мягким JS-эффектом. Это устойчиво к медленной/частичной
 * гидратации и к окружениям, где sessionStorage недоступен (sandbox-браузеры):
 * форма логина на /login видна сразу, без токена API всё равно вернёт 401.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const path = window.location.pathname;
    const token = getToken();

    if (path === "/login") {
      // С токеном логин не нужен — на главную
      if (token) window.location.href = "/";
      return;
    }
    if (!token) {
      window.location.href = "/login";
    }
  }, []);

  return <>{children}</>;
}