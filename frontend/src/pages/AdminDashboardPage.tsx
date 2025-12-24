import { motion } from "framer-motion";
import { Bell, BarChart3, Shield, Sparkles } from "lucide-react";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";

const stats = [
  { label: "Ответов сегодня", value: "24", icon: BarChart3 },
  { label: "Средняя оценка", value: "8.6", icon: Sparkles },
  { label: "Негатив (≤6)", value: "3", icon: Bell },
];

const last = [
  {
    where: "Ресторан",
    score: 9,
    status: "Новая",
    text: "Очень понравилось обслуживание",
  },
  {
    where: "Отель",
    score: 6,
    status: "Новая",
    text: "Шумно ночью, проснулся несколько раз",
  },
  {
    where: "Ресторан",
    score: 10,
    status: "Обработана",
    text: "Быстро, вкусно, вернусь ещё",
  },
];

function StatusPill({ s }: { s: string }) {
  const cls =
    s === "Обработана"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600"
      : "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-600";

  return (
    <span className={`rounded-full border px-2 py-1 text-xs ${cls}`}>
      {s}
    </span>
  );
}

export default function AdminDashboardPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">
                PulseGuest • Admin
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                Дашборд
              </h1>
              <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                Пока демо-данные. Следующим шагом подключим API и реальные метрики.
              </p>
            </div>

            <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
              <Shield className="h-5 w-5 text-[color:var(--pg-muted)]" />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary">Фильтры</Button>
            <Button variant="secondary">Сравнение периодов</Button>
            <Button>Экспорт (позже)</Button>
          </div>
        </GlassCard>

        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map((c, idx) => {
            const Icon = c.icon;
            return (
              <motion.div
                key={c.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: idx * 0.05 }}
              >
                <GlassCard className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-[color:var(--pg-muted)]">
                      {c.label}
                    </div>
                    <div className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                      <Icon className="h-5 w-5 text-[color:var(--pg-muted)]" />
                    </div>
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-[color:var(--pg-text)]">
                    {c.value}
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>

        <GlassCard>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">
              Последние отзывы
            </h2>
            <span className="text-xs text-[color:var(--pg-faint)]">DEMO</span>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Где</th>
                  <th className="px-4 py-3">Оценка</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {last.map((r, idx) => (
                  <tr key={idx} className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {r.where}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[color:var(--pg-text)]">
                      {r.score}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill s={r.status} />
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {r.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-[color:var(--pg-faint)]">
            Тут появятся карточки отзывов, статусы, фильтры и графики.
          </p>
        </GlassCard>
      </div>
    </AppShell>
  );
}
