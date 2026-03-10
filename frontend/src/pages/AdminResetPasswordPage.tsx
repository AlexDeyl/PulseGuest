import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Lock } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useDevMode } from "../shared/devMode";
import { confirmPasswordReset } from "../shared/api/adminAuth";

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Ошибка запроса. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;

  if (devEnabled) {
    try {
      return JSON.stringify(e?.detail ?? e, null, 2);
    } catch {
      return String(e?.message ?? "Ошибка");
    }
  }
  return "Не удалось обновить пароль. Попробуйте позже.";
}

export default function AdminResetPasswordPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { enabled: devEnabled } = useDevMode();

  const token = useMemo(() => {
    const p = new URLSearchParams(loc.search);
    return (p.get("token") || "").trim();
  }, [loc.search]);

  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tooShort = p1.length > 0 && p1.length < 8;
  const mismatch = p2.length > 0 && p1 !== p2;

  const canSubmit =
    !!token && !loading && p1.length >= 8 && p1 === p2;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!token) {
      setErr("Ссылка недействительна: отсутствует token. Запросите сброс ещё раз.");
      return;
    }
    if (p1.length < 8) {
      setErr("Пароль слишком короткий (минимум 8 символов).");
      return;
    }
    if (p1 !== p2) {
      setErr("Пароли не совпадают.");
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(token, p1);
      nav("/admin/login?flash=pwd_updated", { replace: true });
    } catch (e: any) {
      // 400 Invalid/expired token -> нейтрально и по делу
      const text = errToText(e, devEnabled);
      setErr(
        text.includes("Invalid") || text.includes("expired")
          ? "Ссылка недействительна или истекла. Запросите новую."
          : text
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
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
                  Новый пароль
                </h1>
                <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  Установите новый пароль для аккаунта.
                </p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <Lock className="h-5 w-5 text-[color:var(--pg-muted)]" />
              </div>
            </div>

            {!token && (
              <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                Ссылка недействительна: отсутствует token. Запросите сброс пароля заново.
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label className="text-sm font-medium text-[color:var(--pg-muted)]">
                  Новый пароль
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none placeholder:text-[color:var(--pg-placeholder)] focus:border-[color:var(--pg-input-border-focus)]"
                  value={p1}
                  onChange={(e) => setP1(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading || !token}
                  required
                />
                {tooShort && (
                  <p className="mt-2 text-xs text-[color:var(--pg-muted)]">
                    Минимум 8 символов.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-[color:var(--pg-muted)]">
                  Подтвердите пароль
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none placeholder:text-[color:var(--pg-placeholder)] focus:border-[color:var(--pg-input-border-focus)]"
                  value={p2}
                  onChange={(e) => setP2(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading || !token}
                  required
                />
                {mismatch && (
                  <p className="mt-2 text-xs text-red-600">Пароли не совпадают.</p>
                )}
              </div>

              {err && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  {err}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {loading ? "Сохраняем…" : "Сохранить"}
              </Button>

              <div className="flex items-center justify-between">
                <Link
                  to="/admin/login"
                  className="inline-flex items-center gap-2 text-xs text-[color:var(--pg-muted)] hover:text-[color:var(--pg-text)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Ко входу
                </Link>

                <Link
                  to="/admin/forgot-password"
                  className="text-xs text-[color:var(--pg-muted)] hover:text-[color:var(--pg-text)] underline underline-offset-4"
                >
                  Запросить новую ссылку
                </Link>
              </div>
            </form>
          </GlassCard>
        </motion.div>
      </div>
    </AppShell>
  );
}
