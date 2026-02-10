import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import { API_BASE } from "./api/public";

type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
};

export type RoleScope = {
  role: string;
  organization_id: number | null;
  location_id: number | null;
};

export type LocationShort = {
  id: number;
  organization_id: number;
  type: string;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
};

export type MeResponse = {
  id: number;
  email: string;
  is_global: boolean;
  roles: RoleScope[];
  allowed_organization_ids: number[];
  allowed_locations: LocationShort[];
};

type AuthState = {
  isInitializing: boolean;
  isAuthenticated: boolean;
  me: MeResponse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
};

const ACCESS_KEY = "pg_access_token";
const REFRESH_KEY = "pg_refresh_token";

const getAccess = () => localStorage.getItem(ACCESS_KEY) || "";
const getRefresh = () => localStorage.getItem(REFRESH_KEY) || "";

const setTokens = (tp: TokenPair) => {
  localStorage.setItem(ACCESS_KEY, tp.access_token);
  localStorage.setItem(REFRESH_KEY, tp.refresh_token);
};

const clearTokens = () => {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
};

type ApiError = Error & { status?: number; detail?: unknown };

async function readJsonSafe(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const detail = await readJsonSafe(res);
    const err: ApiError = new Error(`API ${res.status}: ${String(path)}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return (await readJsonSafe(res)) as T;
}

async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const access = getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const detail = await readJsonSafe(res);
    const err: ApiError = new Error(`API ${res.status}: ${String(path)}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return (await readJsonSafe(res)) as T;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [isInitializing, setInitializing] = useState(true);

  const isAuthenticated = !!me;

  const reloadMe = async () => {
    // ВНИМАНИЕ: у тебя двойной prefix /admin/admin
    const data = await adminJson<MeResponse>("/api/admin/admin/me");
    setMe(data);
  };

  const login = async (email: string, password: string) => {
    const tp = await apiJson<TokenPair>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setTokens(tp);
    await reloadMe();
  };

  const logout = async () => {
    try {
      await adminJson("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    clearTokens();
    setMe(null);
  };

  useEffect(() => {
    const boot = async () => {
      setInitializing(true);

      const access = getAccess();
      if (!access) {
        setMe(null);
        setInitializing(false);
        return;
      }

      try {
        await reloadMe();
      } catch (e) {
        // если access протух — пробуем refresh
        const refresh_token = getRefresh();
        if (!refresh_token) {
          clearTokens();
          setMe(null);
          setInitializing(false);
          return;
        }

        try {
          const tp = await apiJson<TokenPair>("/api/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refresh_token }),
          });
          setTokens(tp);
          await reloadMe();
        } catch {
          clearTokens();
          setMe(null);
        }
      } finally {
        setInitializing(false);
      }
    };

    void boot();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ isInitializing, isAuthenticated, me, login, logout, reloadMe }),
    [isInitializing, isAuthenticated, me]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isInitializing, isAuthenticated } = useAuth();
  const loc = useLocation();

  if (isInitializing) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl text-sm text-[color:var(--pg-muted)]">
          Загрузка…
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />;
  }

  return <>{children}</>;
}
