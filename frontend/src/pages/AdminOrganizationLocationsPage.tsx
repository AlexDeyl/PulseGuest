import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

type Loc = {
  id: number;
  organization_id: number;
  type: string;
  code: string;
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

const TYPES = ["room", "restaurant", "conference_hall", "banquet_hall", "other"] as const;

const TYPE_LABEL: Record<string, string> = {
  room: "Номера",
  restaurant: "Ресторан",
  conference_hall: "Конференц-зал",
  banquet_hall: "Банкетный зал",
  other: "Другое",
};

export default function AdminOrganizationLocationsPage() {
  const { orgId } = useParams();
  const organizationId = Number(orgId || 0);
  const nav = useNavigate();
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();

  const canManage = useMemo(() => {
    const roles = Array.isArray(me?.roles) ? me?.roles : [];
    return roles.some((r: any) => r?.role === "director");
  }, [me]);

  const [org, setOrg] = useState<Org | null>(null);
  const [items, setItems] = useState<Loc[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOrg, setCheckingOrg] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create/edit form
  const [locId, setLocId] = useState<number | null>(null);
  const [type, setType] = useState("other");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(""); // only create (optional)
  const [active, setActive] = useState(true);

  const resetForm = () => {
    setLocId(null);
    setType("other");
    setCode("");
    setName("");
    setSlug("");
    setActive(true);
  };

  useEffect(() => {
    if (!organizationId || Number.isNaN(organizationId) || organizationId <= 0) {
      nav("/admin/organizations", { replace: true });
    }
  }, [organizationId, nav]);

  const load = async () => {
    if (!organizationId || Number.isNaN(organizationId) || organizationId <= 0) return;

    setLoading(true);
    setError(null);

    let alive = true;
    setCheckingOrg(true);

    try {
      const o = await adminJson<Org>(`/api/admin/admin/organizations/${organizationId}`);
      if (!alive) return;
      setOrg(o);
      setCheckingOrg(false);

      const locs = await adminJson<Loc[]>(
        `/api/admin/admin/organizations/${organizationId}/locations`
      );
      if (!alive) return;
      setItems(locs);
    } catch (e: any) {
      if (!alive) return;

      const status = e?.status;
      if (status === 404 || status === 403) {
        nav("/admin/organizations", { replace: true });
        return;
      }

      setError(errToText(e, devEnabled));
      setCheckingOrg(false);
    } finally {
      if (alive) setLoading(false);
    }

    return () => {
      alive = false;
    };
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const startEdit = (l: Loc) => {
    setLocId(l.id);
    setType(l.type || "other");
    setCode(l.code || "");
    setName(l.name || "");
    setActive(l.is_active);
    setSlug(""); // slug не редактируем в этом патче
  };

  const submit = async () => {
    if (!canManage) return;
    setError(null);

    try {
      if (locId == null) {
        await adminJson("/api/admin/admin/locations", {
          method: "POST",
          body: JSON.stringify({
            organization_id: organizationId,
            type,
            code,
            name,
            slug: slug.trim() ? slug.trim() : undefined,
          }),
        });
      } else {
        await adminJson(`/api/admin/admin/locations/${locId}`, {
          method: "PATCH",
          body: JSON.stringify({
            type,
            code,
            name,
            is_active: active,
          }),
        });
      }
      resetForm();
      await load();
    } catch (e: any) {
      setError(errToText(e, devEnabled));
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Локации</h1>
          <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
            {org ? (
              <>
                Организация: <span className="font-semibold">{org.name}</span>{" "}
                (<span className="font-mono">{org.slug}</span>)
              </>
            ) : devEnabled ? (
              <>org_id={organizationId}</>
            ) : (
              <>Организация: —</>
            )}
          </div>
        </div>

        <Button variant="secondary" onClick={() => nav("/admin/organizations")}>
          Назад к организациям
        </Button>
      </div>

      {checkingOrg && (
        <GlassCard className="mb-6">
          <div className="text-sm text-[color:var(--pg-muted)]">Проверяю организацию…</div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="mb-6 border border-rose-500/30">
          <div className="whitespace-pre-wrap text-sm text-rose-300">{error}</div>
        </GlassCard>
      )}

      {canManage && (
        <GlassCard className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">
              {locId == null ? "Создать локацию" : "Редактировать локацию"}
              {locId != null && devEnabled && (
                <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{locId}</span>
              )}
            </div>
            {locId != null && (
              <Button variant="secondary" onClick={resetForm}>
                Отмена
              </Button>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Тип</div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Код</div>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            <label className="block sm:col-span-2">
              <div className="text-xs text-[color:var(--pg-muted)]">Название</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            {locId == null && (
              <label className="block sm:col-span-2">
                <div className="text-xs text-[color:var(--pg-muted)]">
                  Слаг (опционально; если пусто — будет {"{org_slug}-{code}"})
                </div>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                />
              </label>
            )}
          </div>

          {locId != null && (
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Активна
            </label>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={submit} disabled={!name.trim()}>
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
                  <th className="py-2 pr-4">Слаг</th>
                  <th className="py-2 pr-4">Ссылка (QR)</th>
                  <th className="py-2 pr-4">Статус</th>
                  <th className="py-2 pr-4">Действия</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--pg-text)]">
                {items.map((l) => {
                  const rel = `/${l.slug}`;
                  const full = origin ? `${origin}${rel}` : rel;

                  return (
                    <tr key={l.id} className="border-t border-[color:var(--pg-border)]">
                      <td className="py-3 pr-4">{l.name}</td>
                      <td className="py-3 pr-4 font-mono">{l.slug}</td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link className="underline" to={rel}>
                            {rel}
                          </Link>
                          <Button variant="secondary" onClick={() => copy(full)}>
                            Скопировать
                          </Button>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        {l.is_active ? "Активна" : <span className="opacity-70">Отключена</span>}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {canManage && (
                            <Button variant="secondary" onClick={() => startEdit(l)}>
                              Редактировать
                            </Button>
                          )}

                          {devEnabled && (
                            <span className="self-center font-mono text-xs text-[color:var(--pg-muted)]">
                              #{l.id}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </AppShell>
  );
}
