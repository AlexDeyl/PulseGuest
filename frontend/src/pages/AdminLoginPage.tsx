import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, Mail } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";

export default function AdminLoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;

  const [email, setEmail] = useState("director@pulseguest.local");
  const [password, setPassword] = useState("Admin123!");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { enabled: devEnabled } = useDevMode();

  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(loc.search || "");
    if (p.get("flash") === "pwd_updated") {
      setFlash("Пароль обновлён");

      const t = window.setTimeout(() => {
        setFlash(null);
        p.delete("flash");
        const qs = p.toString();
        nav(`${loc.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
      }, 2800);

      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.search]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      const to = loc?.state?.from || "/admin";
      nav(to, { replace: true });
    } catch (e: any) {
      const detail = devEnabled && e?.detail ? ` ${JSON.stringify(e.detail)}` : "";
      setErr(`Не удалось войти. Проверь логин/пароль.${detail}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      {flash && (
        <div className="fixed right-4 top-4 z-50 rounded-2xl border border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg-strong)] px-4 py-3 text-sm text-[color:var(--pg-success-text)] shadow-lg">
          {flash}
        </div>
      )}

      <div className="mx-auto max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <GlassCard>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">
                  Вход
                </h1>
                <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  Director / Service Manager
                </p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <Lock className="h-5 w-5 text-[color:var(--pg-muted)]" />
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label className="text-sm font-medium text-[color:var(--pg-muted)]">
                  Email
                </label>
                <div className="mt-2 flex items-center gap-2 rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 focus-within:border-[color:var(--pg-input-border-focus)]">
                  <Mail className="h-4 w-4 text-[color:var(--pg-muted)]" />
                  <input
                    type="email"
                    placeholder="name@company.com"
                    className="w-full bg-transparent text-sm text-[color:var(--pg-text)] outline-none placeholder:text-[color:var(--pg-placeholder)]"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[color:var(--pg-muted)]">
                  Пароль
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none placeholder:text-[color:var(--pg-placeholder)] focus:border-[color:var(--pg-input-border-focus)]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              {err && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  {err}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Входим…" : "Войти"}
              </Button>

              <div className="flex items-center justify-between">
                <Link
                  to="/admin/forgot-password"
                  state={{ email: email.trim() }}
                  className="text-xs text-[color:var(--pg-muted)] hover:text-[color:var(--pg-text)] underline underline-offset-4"
                >
                  Забыли пароль?
                </Link>
              </div>

              {devEnabled && (
                <p className="text-xs text-[color:var(--pg-faint)]">
                  Dev: после входа идём в /admin и подтягиваем /api/admin/admin/me.
                </p>
              )}
            </form>
          </GlassCard>
        </motion.div>
      </div>
    </AppShell>
  );
}
