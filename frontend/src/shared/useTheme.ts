import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "pg_theme";

function readTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme") as Theme | null;
  return t ?? "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  function apply(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(KEY, next);
    setTheme(next);
  }

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
    apply(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    const current = readTheme();
    const next: Theme = current === "dark" ? "light" : "dark";

    const vt = (document as any).startViewTransition;

    // ✅ максимально безопасно: try/catch + fallback
    if (typeof vt === "function") {
      try {
        vt(() => apply(next));
        return;
      } catch (e) {
        // если API есть, но падает (часто в нестандартных браузерах)
        console.warn("startViewTransition failed, fallback to instant toggle", e);
      }
    }

    apply(next);
  }

  return { theme, toggle, setTheme: apply };
}
