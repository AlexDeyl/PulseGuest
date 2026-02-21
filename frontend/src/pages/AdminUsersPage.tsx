import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type LocationShort = {
  id: number;
  organization_id: number;
  type: string;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
};

type UserListItem = {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string;
  service_manager_locations: LocationShort[];
  service_manager_locations_count: number;
};

type UserListResponse = {
  items: UserListItem[];
  total: number;
  limit: number;
  offset: number;
};

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

  return "Ошибка запроса. Попробуйте обновить страницу.";
}

export default function AdminUsersPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const canManage = useMemo(() => {
    if (me?.is_global) return true; // director
    const roles = Array.isArray(me?.roles) ? me?.roles : [];
    return roles.some((r: any) => r?.role === "director");
  }, [me]);

  const [q, setQ] = useState("");
  const [items, setItems] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;

    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));
    if (q.trim()) qs.set("q", q.trim());

    adminJson<UserListResponse>(`/api/admin/admin/users?${qs.toString()}`)
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(Number(data.total ?? 0));
      })
      .catch((e: any) => {
        setItems([]);
        setTotal(0);
        setError(errToText(e, devEnabled));
      })
      .finally(() => setLoading(false));
  }, [canManage, q, limit, offset, devEnabled]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">Пользователи</h1>
            <div className="text-sm text-[color:var(--pg-muted)]">
              Сейчас — просмотр списка и текущих назначений. Управление ролями — отдельным патчем.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => nav("/admin")}>
              Назад
            </Button>
          </div>
        </div>

        {!canManage ? (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">
              Доступ к пользователям есть только у роли <b>director</b>.
            </div>
          </GlassCard>
        ) : (
          <GlassCard className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <input
                  value={q}
                  onChange={(e) => {
                    setOffset(0);
                    setQ(e.target.value);
                  }}
                  placeholder="Поиск по email…"
                  className="w-full rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)] sm:w-[360px]"
                />
              </div>

              <div className="text-sm text-[color:var(--pg-muted)]">
                Всего: <b className="text-[color:var(--pg-text)]">{total}</b>
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
            ) : error ? (
              <div className="whitespace-pre-wrap text-sm text-rose-300">{error}</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-[color:var(--pg-muted)]">Пользователи не найдены.</div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[color:var(--pg-border)]">
                <div className="grid grid-cols-12 gap-2 border-b border-[color:var(--pg-border)] bg-[color:var(--pg-card-hover)] px-4 py-3 text-xs font-semibold text-[color:var(--pg-muted)]">
                  <div className="col-span-6">Email</div>
                  <div className="col-span-3">Локации менеджера</div>
                  <div className="col-span-2">Статус</div>
                  <div className="col-span-1 text-right">→</div>
                </div>

                {items.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => nav(`/admin/users/${u.id}`)}
                    className="grid w-full grid-cols-12 gap-2 px-4 py-3 text-left text-sm text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
                  >
                    <div className="col-span-6">
                      <div className="font-medium">{u.email}</div>
                      {devEnabled && (
                        <div className="mt-1 font-mono text-xs text-[color:var(--pg-muted)]">
                          id: {u.id}
                        </div>
                      )}
                    </div>

                    <div className="col-span-3">
                      <div className="font-medium">{u.service_manager_locations_count ?? 0} локац.</div>
                      <div className="mt-1 truncate text-xs text-[color:var(--pg-muted)]">
                        {(u.service_manager_locations ?? [])
                          .slice(0, 2)
                          .map((l) => l.name)
                          .join(", ")}
                        {(u.service_manager_locations ?? []).length > 2 ? "…" : ""}
                      </div>
                    </div>

                    <div className="col-span-2">
                      {u.is_active ? (
                        <span className="rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-1 text-xs">
                          Активен
                        </span>
                      ) : (
                        <span className="rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-1 text-xs opacity-70">
                          Отключён
                        </span>
                      )}
                    </div>

                    <div className="col-span-1 text-right text-[color:var(--pg-muted)]">→</div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-xs text-[color:var(--pg-muted)]">
                Показано {items.length} из {total}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={offset <= 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                >
                  Вперёд
                </Button>
              </div>
            </div>
          </GlassCard>
        )}
      </div>
    </AppShell>
  );
}
