import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Mail } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useDevMode } from "../shared/devMode";
import { requestPasswordReset } from "../shared/api/adminAuth";

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
  return "Не удалось отправить письмо. Попробуйте позже.";
}

export default function AdminForgotPasswordPage() {
  const loc = useLocation() as any;
  const { enabled: devEnabled } = useDevMode();

  const initialEmail = useMemo(() => {
    const s = (loc?.state?.email ?? "") as string;
    return String(s || "");
  }, [loc]);

  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (e: any) {
      setErr(errToText(e, devEnabled));
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
                  Восстановление пароля
                </h1>
                <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  Укажи email профиля — мы отправим ссылку для сброса.
                </p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <Mail className="h-5 w-5 text-[color:var(--pg-muted)]" />
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
                    required
                    disabled={loading || sent}
                  />
                </div>
              </div>

              {err && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  {err}
                </div>
              )}

              {sent && (
                <div className="rounded-2xl border border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] px-4 py-3 text-sm text-[color:var(--pg-success-text)]">
                  Если такой email зарегистрирован — мы отправили ссылку для сброса пароля.
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading || sent}>
                {loading ? "Отправляем…" : sent ? "Ссылка отправлена" : "Отправить ссылку"}
              </Button>

              <Link
                to="/admin/login"
                className="mt-2 inline-flex items-center gap-2 text-xs text-[color:var(--pg-muted)] hover:text-[color:var(--pg-text)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Вернуться ко входу
              </Link>
            </form>
          </GlassCard>
        </motion.div>
      </div>
    </AppShell>
  );
}
