import { useEffect, useMemo, useState } from "react";

// Dev-mode для разработчика.
// В проде должен быть выключен сборкой. Включается только если задан VITE_PG_DEV_MODE=1.
const AVAILABLE = import.meta.env.VITE_PG_DEV_MODE === "1";

const KEY = "pg_dev_mode_enabled";

export function useDevMode() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (!AVAILABLE) return false;
    const raw = localStorage.getItem(KEY);
    if (raw == null) return false;
    return raw === "1";
  });

  useEffect(() => {
    if (!AVAILABLE) return;
    localStorage.setItem(KEY, enabled ? "1" : "0");
  }, [enabled]);

  return useMemo(
    () => ({ available: AVAILABLE, enabled, setEnabled }),
    [enabled]
  );
}