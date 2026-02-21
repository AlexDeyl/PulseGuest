import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type RoleScope = {
  role: string;
  organization_id: number | null;
  location_id: number | null;
};

type LocationShort = {
  id: number;
  organization_id: number;
  type: string;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
};

type OrgShort = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type UserDetail = {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string;
  is_global: boolean;
  roles: RoleScope[];
  allowed_organization_ids: number[];
  allowed_locations: LocationShort[];
};

function errToText(e: any, devEnabled: boolean, base: string) {
  if (!devEnabled) return base;
  try {
    const detail =
      e?.detail == null
        ? ""
        : typeof e.detail === "string"
          ? e.detail.slice(0, 500)
          : JSON.stringify(e.detail).slice(0, 500);
    return [base, detail].filter(Boolean).join(" • ");
  } catch {
    return base;
  }
}

function roleRu(role: string) {
  if (role === "director") return "Директор";
  if (role === "service_manager") return "Менеджер сервиса";
  if (role === "admin") return "Администратор";
  return role;
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { enabled: devEnabled } = useDevMode();

  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgShort[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [orgLocs, setOrgLocs] = useState<LocationShort[]>([]);
  const [locId, setLocId] = useState<string>("");

  const [actionLoading, setActionLoading] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const orgById = useMemo(() => {
    const m = new Map<number, OrgShort>();
    for (const o of orgs ?? []) m.set(o.id, o);
    return m;
  }, [orgs]);

  const locationById = useMemo(() => {
    const m = new Map<number, LocationShort>();
    for (const l of data?.allowed_locations ?? []) m.set(l.id, l);
    return m;
  }, [data?.allowed_locations]);

  const assignedServiceManagerLocationIds = useMemo(() => {
    const ids = (data?.roles ?? [])
      .filter((r) => r.role === "service_manager" && r.location_id != null)
      .map((r) => Number(r.location_id));
    return Array.from(new Set(ids)).sort((a, b) => a - b);
  }, [data?.roles]);

  async function refetchUser() {
    if (!id) return;
    const ud = await adminJson<UserDetail>(`/api/admin/admin/users/${id}`);
    setData(ud);
  }

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setErr(null);

    Promise.all([
      refetchUser(),
      adminJson<OrgShort[]>(`/api/admin/admin/organizations`).then(setOrgs),
    ])
      .catch((e: any) => {
        setErr(errToText(e, devEnabled, "Не удалось загрузить страницу. Попробуйте позже."));
        setData(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, devEnabled]);

  useEffect(() => {
    if (!orgId) {
      setOrgLocs([]);
      setLocId("");
      return;
    }

    adminJson<LocationShort[]>(`/api/admin/admin/organizations/${orgId}/locations`)
      .then((locs) => {
        const active = (locs ?? []).filter((l) => l.is_active);
        setOrgLocs(active);
        setLocId("");
      })
      .catch((e: any) => {
        setActionErr(errToText(e, devEnabled, "Не удалось загрузить локации."));
        setOrgLocs([]);
        setLocId("");
      });
  }, [orgId, devEnabled]);

  async function onAssign() {
    if (!id || !locId) return;

    setActionLoading(true);
    setActionErr(null);
    setActionOk(null);

    try {
      await adminJson(`/api/admin/admin/users/${id}/service-manager/${locId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refetchUser();
      setActionOk("Назначено.");
    } catch (e: any) {
      setActionErr(errToText(e, devEnabled, "Не удалось назначить."));
    } finally {
      setActionLoading(false);
    }
  }

  async function onRemove(locationId: number) {
    if (!id) return;

    setActionLoading(true);
    setActionErr(null);
    setActionOk(null);

    try {
      await adminJson(`/api/admin/admin/users/${id}/service-manager/${locationId}`, {
        method: "DELETE",
      });
      await refetchUser();
      setActionOk("Снято.");
    } catch (e: any) {
      setActionErr(errToText(e, devEnabled, "Не удалось снять."));
    } finally {
      setActionLoading(false);
    }
  }

  const orgOptions = useMemo(() => {
    return (orgs ?? [])
      .filter((o) => o.is_active)
      .map((o) => ({
        value: String(o.id),
        label: devEnabled ? `${o.name} (#${o.id})` : o.name,
      }));
  }, [orgs, devEnabled]);

  const locOptions = useMemo(() => {
    return (orgLocs ?? []).map((l) => ({
      value: String(l.id),
      label: devEnabled ? `${l.name} (${l.slug})` : l.name,
    }));
  }, [orgLocs, devEnabled]);

  const title = data?.email ? `Пользователь: ${data.email}` : "Пользователь";

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                {title}
                {devEnabled && id ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{id}</span> : null}
              </h1>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => nav("/admin/users")}>Назад к списку</Button>
                <Button variant="secondary" onClick={() => nav("/admin")}>Дашборд</Button>
              </div>

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && <div className="mt-3 text-xs text-rose-300">{err}</div>}
            </div>

            {data && (
              <div className="text-sm text-[color:var(--pg-muted)]">
                <div>
                  Статус:{" "}
                  <span className="text-[color:var(--pg-text)]">
                    {data.is_active ? "Активен" : "Отключён"}
                  </span>
                </div>
                <div>
                  Права:{" "}
                  <span className="text-[color:var(--pg-text)]">
                    {data.is_global ? "Директор" : "Обычный доступ"}
                  </span>
                </div>
                <div>
                  Создан:{" "}
                  <span className="text-[color:var(--pg-text)]">
                    {data.created_at ? new Date(data.created_at).toLocaleString() : "—"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Роли</h2>

          <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Роль</th>
                  <th className="px-4 py-3">Организация</th>
                  <th className="px-4 py-3">Локация</th>
                </tr>
              </thead>
              <tbody>
                {(data?.roles ?? []).map((r, idx) => {
                  const orgName =
                    r.organization_id == null
                      ? "Все"
                      : orgById.get(Number(r.organization_id))?.name ?? "Организация";
                  const locName =
                    r.location_id == null
                      ? "Все"
                      : locationById.get(Number(r.location_id))?.name ?? "Локация";

                  return (
                    <tr key={`${r.role}-${idx}`} className="border-t border-[color:var(--pg-border)]">
                      <td className="px-4 py-3 text-[color:var(--pg-text)]">{roleRu(r.role)}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                        {orgName}
                        {devEnabled && r.organization_id != null ? (
                          <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{r.organization_id}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                        {locName}
                        {devEnabled && r.location_id != null ? (
                          <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{r.location_id}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}

                {!loading && (data?.roles?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-sm text-[color:var(--pg-muted)]">
                      Ролей нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Назначение “Менеджер сервиса”</h2>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Организация</div>
              <Select value={orgId} onValueChange={(v) => setOrgId(v)} options={orgOptions} placeholder="Выберите организацию…" />
            </div>

            <div>
              <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Локация</div>
              <Select
                value={locId}
                onValueChange={(v) => setLocId(v)}
                options={locOptions}
                placeholder={orgId ? "Выберите локацию…" : "Сначала выберите организацию…"}
              />
            </div>

            <div className="flex items-end">
              <Button variant="primary" disabled={!id || !locId || actionLoading} onClick={onAssign}>
                {actionLoading ? "…" : "Назначить"}
              </Button>
            </div>
          </div>

          {actionErr && <div className="mt-3 text-sm text-rose-300">{actionErr}</div>}
          {actionOk && <div className="mt-3 text-sm text-emerald-400">{actionOk}</div>}

          <div className="mt-6">
            <div className="text-sm text-[color:var(--pg-muted)]">Текущие назначения:</div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                  <tr>
                    <th className="px-4 py-3">Локация</th>
                    {devEnabled ? <th className="px-4 py-3">Slug</th> : null}
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {assignedServiceManagerLocationIds.map((lid) => {
                    const loc = locationById.get(lid);
                    return (
                      <tr key={lid} className="border-t border-[color:var(--pg-border)]">
                        <td className="px-4 py-3 text-[color:var(--pg-text)]">
                          {loc?.name ?? "Локация"}
                          {devEnabled ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{lid}</span> : null}
                        </td>
                        {devEnabled ? (
                          <td className="px-4 py-3 text-[color:var(--pg-muted)]">{loc?.slug ?? "—"}</td>
                        ) : null}
                        <td className="px-4 py-3 text-right">
                          <Button variant="secondary" disabled={actionLoading} onClick={() => onRemove(lid)}>
                            Снять
                          </Button>
                        </td>
                      </tr>
                    );
                  })}

                  {!loading && assignedServiceManagerLocationIds.length === 0 && (
                    <tr>
                      <td colSpan={devEnabled ? 3 : 2} className="px-4 py-6 text-sm text-[color:var(--pg-muted)]">
                        Назначений нет.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {devEnabled && (
              <div className="mt-4 text-xs text-[color:var(--pg-muted)]">
                Dev: назначения влияют на allowed_locations и доступы в админке.
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Доступные локации пользователя</h2>

          <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Организация</th>
                  <th className="px-4 py-3">Локация</th>
                  <th className="px-4 py-3">Статус</th>
                  {devEnabled ? <th className="px-4 py-3">Dev</th> : null}
                </tr>
              </thead>
              <tbody>
                {(data?.allowed_locations ?? []).map((l) => {
                  const orgName = orgById.get(l.organization_id)?.name ?? "Организация";
                  return (
                    <tr key={l.id} className="border-t border-[color:var(--pg-border)]">
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">{orgName}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-text)]">{l.name}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">{l.is_active ? "Активна" : "Отключена"}</td>
                      {devEnabled ? (
                        <td className="px-4 py-3 font-mono text-xs text-[color:var(--pg-muted)]">
                          #{l.id} • {l.slug}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}

                {!loading && (data?.allowed_locations?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={devEnabled ? 4 : 3} className="px-4 py-6 text-sm text-[color:var(--pg-muted)]">
                      Локаций нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
