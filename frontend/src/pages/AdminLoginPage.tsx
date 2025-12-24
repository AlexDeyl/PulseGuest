import { motion } from "framer-motion";
import { Lock, Mail } from "lucide-react";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";

export default function AdminLoginPage() {
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
                  Вход
                </h1>
                <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  Сотрудник / Руководитель / Сервис-менеджер
                </p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <Lock className="h-5 w-5 text-[color:var(--pg-muted)]" />
              </div>
            </div>

            <form className="mt-6 space-y-4">
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
                />
              </div>

              <Button type="button" className="w-full">
                Войти (демо)
              </Button>

              <p className="text-xs text-[color:var(--pg-faint)]">
                Дальше подключим JWT и разграничение прав по ролям.
              </p>
            </form>
          </GlassCard>
        </motion.div>
      </div>
    </AppShell>
  );
}
