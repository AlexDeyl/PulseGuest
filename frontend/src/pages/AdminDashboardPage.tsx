import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BarChart3, Shield, Sparkles, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { API_BASE } from "../shared/api/public";

type Summary = {
  location_id: number;
  total_submissions: number;
  rated_count: number;
  avg_rating: number | null;
  negative_count: number;
  negative_share: number | null; // 0..1
  rating_distribution: { rating: number; count: number }[];
  timeseries: { day: string; count: number; avg_rating: number | null }[];
  last_comments: {
    id: number;
    created_at: string;
    rating_overall: number | null;
    comment: string;
    name: string;
    email: string;
  }[];
};

async function adminGetJson<T>(path: string): Promise<T> {
  const access = localStorage.getItem("pg_access_token") || "";
  const res = await fetch(`${API_BASE}${path}`, {
    headers: access ? { authorization: `Bearer ${access}` } : {},
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    const detail = ct.includes("application/json") ? await res.json() : await res.text();
    const err: any = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return (await res.json()) as T;
}

function roleLabel(me: any) {
  if (!me) return "";
  if (me.is_global) return "director";
  const roles = Array.isArray(me.roles) ? me.roles : [];
  const hasSvc = roles.some((r: any) => r?.role === "service_manager");
  return hasSvc ? "service_manager" : "user";
}

function pct(n: number | null) {
  if (n === null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

export default function AdminDashboardPage() {
  const { me, logout } = useAuth();
  const nav = useNavigate();

  const locations = me?.allowed_locations ?? [];

  const [locationId, setLocationId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_location_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [sumError, setSumError] = useState<string | null>(null);

  useEffect(() => {
    if (locationId !== "") return;
    if (locations.length) setLocationId(locations[0].id);
  }, [locations, locationId]);

  useEffect(() => {
    if (locationId === "") return;

    localStorage.setItem("pg_selected_location_id", String(locationId));

    setSumLoading(true);
    setSumError(null);

    // days/comments_limit можно менять, пока фиксируем безопасные значения
    adminGetJson<Summary>(`/api/stats/locations/${locationId}/summary?days=30&comments_limit=10`)
      .then(setSummary)
      .catch((e: any) => {
        setSummary(null);
        const detail = e?.detail ? JSON.stringify(e.detail) : "";
        setSumError(`Не удалось загрузить метрики. ${detail}`);
      })
      .finally(() => setSumLoading(false));
  }, [locationId]);

  const stats = useMemo(() => {
    return [
      {
        label: "Всего ответов",
        value: summary ? String(summary.total_submissions) : "—",
        icon: BarChart3,
      },
      {
        label: "Средняя оценка",
        value: summary?.avg_rating != null ? summary.avg_rating.toFixed(1) : "—",
        icon: Sparkles,
      },
      {
        label: "Негатив (≤6)",
        value: summary
          ? `${summary.negative_count}${summary.rated_count ? ` • ${pct(summary.negative_share)}` : ""}`
          : "—",
        icon: Bell,
      },
    ];
  }, [summary]);

  const onLogout = async () => {
    await logout();
    nav("/admin/login", { replace: true });
  };

  const dist = summary?.rating_distribution ?? [];
  const maxCount = dist.reduce((m, x) => Math.max(m, x.count), 0);
  const totalRated = dist.reduce((s, x) => s + x.count, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>

              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Дашборд</h1>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[color:var(--pg-muted)]">
                <span>
                  Вы вошли как <span className="text-[color:var(--pg-text)]">{me?.email}</span>
                </span>
                <span className="text-[color:var(--pg-faint)]">•</span>
                <span>
                  Роль: <span className="text-[color:var(--pg-text)]">{roleLabel(me)}</span>
                </span>
                <span className="text-[color:var(--pg-faint)]">•</span>
                <span>
                  Локаций доступно:{" "}
                  <span className="text-[color:var(--pg-text)]">{locations.length}</span>
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="text-sm text-[color:var(--pg-muted)]">Локация:</div>

                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={locationId}
                  onChange={(e) => setLocationId(Number(e.target.value))}
                  disabled={!locations.length}
                >
                  {locations.map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.name} • {l.slug}
                    </option>
                  ))}
                </select>

                {sumLoading && <span className="text-xs text-[color:var(--pg-faint)]">Загрузка…</span>}
                {sumError && <span className="text-xs text-red-600">{sumError}</span>}
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => nav("/admin/submissions")}>
                  Отзывы
                </Button>
                <Button variant="secondary" onClick={() => nav("/admin/organizations")}>
                  Организации
                </Button>
                <Button variant="secondary">Фильтры</Button>
                <Button variant="secondary">Сравнение периодов</Button>
                <Button>Экспорт (позже)</Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onLogout}>
                Выйти
              </Button>

              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <Shield className="h-5 w-5 text-[color:var(--pg-muted)]" />
              </div>
            </div>
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
                    <div className="text-sm text-[color:var(--pg-muted)]">{c.label}</div>
                    <div className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                      <Icon className="h-5 w-5 text-[color:var(--pg-muted)]" />
                    </div>
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-[color:var(--pg-text)]">{c.value}</div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Распределение оценок</h2>
              <span className="text-xs text-[color:var(--pg-faint)]">1–10</span>
            </div>

            <div className="mt-4 space-y-2">
              {(summary?.rating_distribution ?? []).map((x) => {
                const w = maxCount > 0 ? Math.round((x.count / maxCount) * 100) : 0;
                return (
                  <div key={x.rating} className="flex items-center gap-3">
                    <div className="w-10 text-sm text-[color:var(--pg-muted)]">{x.rating}</div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${w}%`,
                          minWidth: x.count > 0 ? 6 : 0,          // чтобы 1 голос был виден
                          backgroundColor: "var(--pg-accent, #6d28d9)", // фолбэк, если переменной нет
                        }}
                      />
                    </div>
                    <div className="w-14 text-right text-sm text-[color:var(--pg-muted)]">
                      {totalRated > 0 ? `${Math.round((x.count / totalRated) * 100)}%` : "—"}
                    </div>
                    <div className="w-10 text-right text-sm text-[color:var(--pg-muted)]">{x.count}</div>
                  </div>
                );
              })}
              {!summary && <div className="text-sm text-[color:var(--pg-faint)]">—</div>}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Динамика (30 дней)</h2>
              <span className="text-xs text-[color:var(--pg-faint)]">count / avg</span>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                  <tr>
                    <th className="px-4 py-3">День</th>
                    <th className="px-4 py-3">Ответов</th>
                    <th className="px-4 py-3">Средняя</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.timeseries ?? []).slice(-14).map((r) => (
                    <tr key={r.day} className="border-t border-[color:var(--pg-border)]">
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">{r.day}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-text)]">{r.count}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                        {r.avg_rating != null ? r.avg_rating.toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!summary?.timeseries?.length && (
                    <tr className="border-t border-[color:var(--pg-border)]">
                      <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={3}>
                        Пока нет данных за период.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-[color:var(--pg-faint)]">
              Сейчас показываем последние 14 дней (из 30), чтобы таблица не была длинной.
            </p>
          </GlassCard>
        </div>

        <GlassCard>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Последние комментарии</h2>
            <div className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
              <MessageSquare className="h-5 w-5 text-[color:var(--pg-muted)]" />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(summary?.last_comments ?? []).map((c) => (
              <div
                key={c.id}
                className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-[color:var(--pg-muted)]">
                    #{c.id} • {new Date(c.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                    {c.rating_overall ?? "—"}
                  </div>
                </div>
                <div className="mt-2 text-sm text-[color:var(--pg-text)]">
                  {c.comment}
                </div>
                {(c.name || c.email) && (
                  <div className="mt-2 text-xs text-[color:var(--pg-faint)]">
                    {c.name || "—"} • {c.email || "—"}
                  </div>
                )}

                <div className="mt-3">
                  <Button variant="secondary" onClick={() => nav(`/admin/submissions/${c.id}`)}>
                    Открыть
                  </Button>
                </div>
              </div>
            ))}

            {!summary?.last_comments?.length && (
              <div className="text-sm text-[color:var(--pg-faint)]">Пока нет комментариев.</div>
            )}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
