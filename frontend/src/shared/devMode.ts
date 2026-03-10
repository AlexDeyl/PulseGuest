import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth";

// Dev-mode включается только если задан VITE_PG_DEV_MODE=1
const BUILD_AVAILABLE = import.meta.env.VITE_PG_DEV_MODE === "1";
const KEY = "pg_dev_mode_enabled";

export function useDevMode() {
  const { me } = useAuth();

  const isAdmin = useMemo(() => {
    const roles = Array.isArray(me?.roles) ? me!.roles : [];
    return roles.some((r: any) => r?.role === "admin");
  }, [me]);

  const available = BUILD_AVAILABLE && isAdmin;

  const [rawEnabled, setRawEnabled] = useState<boolean>(() => {
    if (!BUILD_AVAILABLE) return false;
    const raw = localStorage.getItem(KEY);
    if (raw == null) return false;
    return raw === "1";
  });

  // эффективное значение: только если allowed
  const enabled = available && rawEnabled;

  // если роль не admin — принудительно выключаем
  useEffect(() => {
    if (!BUILD_AVAILABLE) return;

    if (!available) {
      if (rawEnabled) setRawEnabled(false);
      localStorage.setItem(KEY, "0");
      return;
    }

    localStorage.setItem(KEY, rawEnabled ? "1" : "0");
  }, [available, rawEnabled]);

  const setEnabled = (v: boolean) => {
    if (!available) return;
    setRawEnabled(!!v);
  };

  return useMemo(() => ({ available, enabled, setEnabled }), [available, enabled]);
}
