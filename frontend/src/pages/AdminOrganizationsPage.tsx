import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
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

export default function AdminOrganizationsPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const roleValues = useMemo(
    () => (Array.isArray(me?.roles) ? me!.roles.map((r: any) => r?.role) : []),
    [me]
  );

  const isAdmin = roleValues.includes("admin");
  const isOps = roleValues.includes("ops_director") || roleValues.includes("manager");
  const isService = roleValues.includes("service_manager");
  const isAuditor = roleValues.includes("auditor") || roleValues.includes("auditor_global");
  const isDirectorLike = roleValues.includes("director") || roleValues.includes("super_admin");
  const isAdminLike = isAdmin || isDirectorLike;

  const isStatsOnly = isAuditor && !isAdminLike && !isOps && !isService;

  // В рамках нового RBAC:
  // - admin (и legacy director/super_admin на время миграции) может создавать/редактировать организации
  // - ops_director НЕ создаёт организации (и не редактирует тут, чтобы не упираться в backend-ограничения)
  const canManageOrgs = isAdminLike;

  const [items, setItems] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create/edit form
  const [orgId, setOrgId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [active, setActive] = useState(true);

  const resetForm = () => {
    setOrgId(null);
    setName("");
    setSlug("");
    setActive(true);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminJson<Org[]>("/api/admin/admin/organizations");
      setItems(data);
    } catch (e: any) {
      setError(errToText(e, devEnabled));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (o: Org) => {
    setOrgId(o.id);
    setName(o.name);
    setSlug(o.slug);
    setActive(o.is_active);
  };

  const submit = async () => {
    if (!canManageOrgs) return;
    setError(null);

    try {
      if (orgId == null) {
        await adminJson("/api/admin/admin/organizations", {
          method: "POST",
          body: JSON.stringify({ name, slug }),
        });
      } else {
        await adminJson(`/api/admin/admin/organizations/${orgId}`, {
          method: "PATCH",
          body: JSON.stringify({ name, slug, is_active: active }),
        });
      }
      resetForm();
      await load();
    } catch (e: any) {
      setError(errToText(e, devEnabled));
    }
  };

  if (isStatsOnly) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm text-[color:var(--pg-text)] font-semibold">Доступ ограничен</div>
          <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
            Роль <b>Аудитор</b> — доступ только к статистике.
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => nav("/admin")}>На дашборд</Button>
          </div>
        </GlassCard>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Организации</h1>
          <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
            Администратор может создавать/редактировать/деактивировать. Ops director и другие — только просмотр.
          </div>
        </div>

        <Button variant="secondary" onClick={() => nav("/admin")}>
          Назад
        </Button>
      </div>

      {error && (
        <GlassCard className="mb-6 border border-rose-500/30">
          <div className="whitespace-pre-wrap text-sm text-rose-300">{error}</div>
        </GlassCard>
      )}

      {canManageOrgs && (
        <GlassCard className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">
              {orgId == null ? "Создать организацию" : "Редактировать организацию"}
              {orgId != null && devEnabled && (
                <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{orgId}</span>
              )}
            </div>
            {orgId != null && (
              <Button variant="secondary" onClick={resetForm}>
                Отмена
              </Button>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Название</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Слаг</div>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>
          </div>

          {orgId != null && (
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Активна
            </label>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={submit} disabled={!name.trim() || !slug.trim()}>
              Сохранить
            </Button>
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Список</div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Обновить
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-[color:var(--pg-muted)]">Пусто</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[color:var(--pg-muted)]">
                <tr>
                  <th className="py-2 pr-4">Название</th>
                  {devEnabled ? <th className="py-2 pr-4">Слаг</th> : null}
                  <th className="py-2 pr-4">Статус</th>
                  <th className="py-2 pr-4">Действия</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--pg-text)]">
                {items.map((o) => (
                  <tr key={o.id} className="border-t border-[color:var(--pg-border)]">
                    <td className="py-3 pr-4">{o.name}</td>
                    {devEnabled ? <td className="py-3 pr-4 font-mono">{o.slug}</td> : null}
                    <td className="py-3 pr-4">
                      {o.is_active ? "Активна" : <span className="opacity-70">Отключена</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => nav(`/admin/organizations/${o.id}/locations`)}
                        >
                          Локации
                        </Button>

                        {canManageOrgs && (
                          <Button variant="secondary" onClick={() => startEdit(o)}>
                            Редактировать
                          </Button>
                        )}

                        {devEnabled && (
                          <span className="self-center font-mono text-xs text-[color:var(--pg-muted)]">
                            #{o.id}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </AppShell>
  );
}
