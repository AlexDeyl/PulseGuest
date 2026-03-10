import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";
import { useAuth } from "../shared/auth";

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

type OrgAccess = { organization_id: number; is_active: boolean };
type GroupAccess = { organization_id: number; group_key: string; is_active: boolean };

type UserDetail = {
  id: number;
  full_name: string | null;
  email: string;
  is_active: boolean;
  created_at: string;

  roles: RoleScope[];

  organizations_access?: OrgAccess[];
  groups_access?: GroupAccess[];

  allowed_organization_ids: number[];
  allowed_location_ids?: number[];
  allowed_locations: LocationShort[];
};

function errToText(e: any, devEnabled: boolean, base: string) {
  if (!devEnabled) return base;
  try {
    const detail =
      e?.detail == null
        ? ""
        : typeof e.detail === "string"
          ? e.detail.slice(0, 800)
          : JSON.stringify(e.detail).slice(0, 800);
    return [base, detail].filter(Boolean).join(" • ");
  } catch {
    return base;
  }
}

function roleRu(role: string) {
  if (role === "admin" || role === "director" || role === "super_admin") return "Администратор";
  if (role === "ops_director" || role === "manager") return "Операционный директор";
  if (role === "service_manager") return "Сервис-менеджер";
  if (role === "auditor" || role === "auditor_global") return "Аудитор";
  return "Пользователь";
}

const TYPE_LABEL: Record<string, string> = {
  room: "Номера",
  restaurant: "Ресторан",
  conference_hall: "Конференц-зал",
  banquet_hall: "Банкетный зал",
  other: "Другое",
};

function locationTypeRu(t: string) {
  return TYPE_LABEL[t] ?? t;
}

function pickPrimaryRole(roles: RoleScope[] | undefined | null): string {
  const vals = (roles ?? []).map((r) => String(r.role));
  if (vals.includes("admin") || vals.includes("director") || vals.includes("super_admin")) return "admin";
  if (vals.includes("ops_director") || vals.includes("manager")) return "ops_director";
  if (vals.includes("service_manager")) return "service_manager";
  if (vals.includes("auditor") || vals.includes("auditor_global")) return "auditor";
  return vals[0] ?? "—";
}

function pickScopedOrgId(roles: RoleScope[] | undefined | null): number | null {
  const r = (roles ?? []).find((x) => x.organization_id != null);
  return r?.organization_id ?? null;
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { enabled: devEnabledRaw } = useDevMode();
  const { me } = useAuth();

  const roleValues = useMemo(() => (Array.isArray(me?.roles) ? me!.roles.map((r) => r.role) : []), [me]);

  const isAdminLike = useMemo(() => {
    return roleValues.includes("admin") || roleValues.includes("director") || roleValues.includes("super_admin");
  }, [roleValues]);

  const isOps = useMemo(() => roleValues.includes("ops_director") || roleValues.includes("manager"), [roleValues]);

  const canManageUsers = useMemo(() => isAdminLike || isOps, [isAdminLike, isOps]);

  // dev UI только для admin-like
  const devEnabled = devEnabledRaw && isAdminLike;

  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgShort[]>([]);

  // Profile form
  const [fullName, setFullName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [newPassword, setNewPassword] = useState("");

  // Role form
  const [roleDraft, setRoleDraft] = useState<string>("service_manager");
  const [orgDraft, setOrgDraft] = useState<string>("");
  const [groupKeys, setGroupKeys] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const orgById = useMemo(() => {
    const m = new Map<number, OrgShort>();
    for (const o of orgs ?? []) m.set(o.id, o);
    return m;
  }, [orgs]);

  async function refetchUser() {
    if (!id) return;
    const ud = await adminJson<UserDetail>(`/api/admin/admin/users/${id}`);
    setData(ud);
    setFullName(ud.full_name ?? "");
    setIsActive(!!ud.is_active);

    const pr = pickPrimaryRole(ud.roles);
    setRoleDraft(pr);

    const scopedOrg = pickScopedOrgId(ud.roles);
    setOrgDraft(scopedOrg != null ? String(scopedOrg) : "");

    // если есть groups_access — возьмём активные группы для текущей org
    const activeGroups =
      (ud.groups_access ?? [])
        .filter((g) => g.is_active && (scopedOrg == null ? true : g.organization_id === scopedOrg))
        .map((g) => g.group_key) ?? [];
    setSelectedGroups(activeGroups);
  }

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setErr(null);

    Promise.all([
      refetchUser(),
      adminJson<OrgShort[]>(`/api/admin/admin/organizations`).then((o) => setOrgs(Array.isArray(o) ? o : [])),
    ])
      .catch((e: any) => {
        setErr(errToText(e, devEnabled, "Не удалось загрузить страницу. Попробуйте позже."));
        setData(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, devEnabled]);

  const roleOptions = useMemo(() => {
    const base = [
      { value: "service_manager", label: roleRu("service_manager") },
      { value: "ops_director", label: roleRu("ops_director") },
    ];
    if (isAdminLike) {
      base.unshift({ value: "admin", label: roleRu("admin") });
      base.push({ value: "auditor", label: roleRu("auditor") });
    }
    return base;
  }, [isAdminLike]);

  const orgOptions = useMemo(() => {
    const active = (orgs ?? []).filter((o) => o.is_active);
    const allowed = isAdminLike ? active : active.filter((o) => (me?.allowed_organization_ids ?? []).includes(o.id));
    return allowed.map((o) => ({
      value: String(o.id),
      label: devEnabled ? `${o.name} (#${o.id})` : o.name,
    }));
  }, [orgs, isAdminLike, me?.allowed_organization_ids, devEnabled]);

  // Load group keys when role/service_manager + org selected
  useEffect(() => {
    if (roleDraft !== "service_manager" || !orgDraft) {
      setGroupKeys([]);
      return;
    }

    adminJson<string[]>(`/api/admin/admin/organizations/${orgDraft}/group-keys`)
      .then((keys) => {
        const list = Array.isArray(keys) ? keys : [];
        setGroupKeys(list);

        // если текущие выбранные группы пустые — поставим “все”
        setSelectedGroups((prev) => (prev.length ? prev : list));
      })
      .catch((e: any) => {
        setGroupKeys([]);
        setActionErr(errToText(e, devEnabled, "Не удалось загрузить группы."));
      });
  }, [roleDraft, orgDraft, devEnabled]);

  async function onSaveProfile() {
    if (!id) return;

    setActionLoading(true);
    setActionErr(null);
    setActionOk(null);

    try {
      const payload: any = {
        full_name: fullName.trim() ? fullName.trim() : null,
        is_active: !!isActive,
      };
      if (newPassword.trim()) payload.password = newPassword.trim();

      await adminJson(`/api/admin/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      setNewPassword("");
      await refetchUser();
      setActionOk("Профиль сохранён.");
    } catch (e: any) {
      setActionErr(errToText(e, devEnabled, "Не удалось сохранить профиль."));
    } finally {
      setActionLoading(false);
    }
  }

  async function onSaveRole() {
    if (!id) return;

    setActionLoading(true);
    setActionErr(null);
    setActionOk(null);

    // UI validation
    if ((roleDraft === "ops_director" || roleDraft === "service_manager") && !orgDraft) {
      setActionErr("Выберите организацию.");
      setActionLoading(false);
      return;
    }
    if (roleDraft === "service_manager" && selectedGroups.length === 0) {
      setActionErr("Для сервис-менеджера выберите хотя бы одну группу.");
      setActionLoading(false);
      return;
    }

    try {
      const payload: any = { role: roleDraft };

      if (roleDraft === "ops_director" || roleDraft === "service_manager") {
        payload.organization_id = Number(orgDraft);
      }
      if (roleDraft === "service_manager") {
        payload.group_keys = selectedGroups;
      }

      await adminJson(`/api/admin/admin/users/${id}/role`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      await refetchUser();
      setActionOk("Роль/доступы обновлены.");
    } catch (e: any) {
      setActionErr(errToText(e, devEnabled, "Не удалось обновить роль/доступы."));
    } finally {
      setActionLoading(false);
    }
  }

  const title = data?.email ? `Пользователь: ${data.email}` : "Пользователь";
  const primaryRole = pickPrimaryRole(data?.roles);

  const allowedLocations = data?.allowed_locations ?? [];
  const allowedLocationsCount = allowedLocations.length;

  const showAccessPreview = allowedLocationsCount <= 200;

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Пользователи</div>
                <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                  {title}
                  {devEnabled && id ? (
                    <span className="ml-2 font-mono text-[11px] text-[color:var(--pg-faint)]">#{id}</span>
                  ) : null}
                </h1>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => nav("/admin/users")}>
                  Назад к списку
                </Button>
                <Button variant="secondary" onClick={() => nav("/admin")}>
                  Дашборд
                </Button>
              </div>

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && (
                <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                  {err}
                </div>
              )}
            </div>

            {data && (
              <div className="text-sm text-[color:var(--pg-muted)]">
                <div>
                  Роль: <span className="text-[color:var(--pg-text)]">{roleRu(primaryRole)}</span>
                </div>
                <div>
                  Статус:{" "}
                  <span className="text-[color:var(--pg-text)]">{data.is_active ? "Активен" : "Отключён"}</span>
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

        {!canManageUsers ? (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">
              У вас нет прав на управление пользователями.
            </div>
          </GlassCard>
        ) : (
          <>
            <GlassCard className="space-y-4">
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Профиль</h2>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs text-[color:var(--pg-muted)]">ФИО</div>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="ФИО"
                    className="w-full rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)]"
                  />
                </div>

                <div>
                  <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Email</div>
                  <input
                    value={data?.email ?? ""}
                    readOnly
                    className="w-full cursor-not-allowed rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-muted)] outline-none"
                  />
                </div>

                <div>
                  <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Новый пароль</div>
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    type="password"
                    placeholder="оставьте пустым, чтобы не менять"
                    className="w-full rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)]"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)]">
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    Активен
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="primary" disabled={actionLoading || !id} onClick={onSaveProfile}>
                  {actionLoading ? "…" : "Сохранить профиль"}
                </Button>
              </div>

              {actionErr && <div className="text-sm text-rose-300">{actionErr}</div>}
              {actionOk && <div className="text-sm text-emerald-400">{actionOk}</div>}
            </GlassCard>

            <GlassCard className="space-y-4">
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Роль и доступ</h2>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Роль</div>
                  <Select
                    value={roleDraft}
                    onValueChange={(v) => {
                      setRoleDraft(v);
                      if (v === "admin" || v === "auditor") {
                        setOrgDraft("");
                        setGroupKeys([]);
                        setSelectedGroups([]);
                      }
                    }}
                    options={roleOptions}
                    placeholder="Выберите роль…"
                  />
                  {!isAdminLike && (
                    <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
                      Операционный директор может назначать только доступные ему роли.
                    </div>
                  )}
                </div>

                {(roleDraft === "ops_director" || roleDraft === "service_manager") && (
                  <div>
                    <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Организация</div>
                    <Select
                      value={orgDraft}
                      onValueChange={(v) => {
                        setOrgDraft(v);
                        if (roleDraft !== "service_manager") {
                          setGroupKeys([]);
                          setSelectedGroups([]);
                        }
                      }}
                      options={orgOptions}
                      placeholder="Выберите организацию…"
                    />
                    {!isAdminLike && (
                      <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
                        Доступны только организации, к которым у вас есть доступ.
                      </div>
                    )}
                  </div>
                )}

                {roleDraft === "service_manager" && (
                  <div className="md:col-span-2">
                    <div className="mb-2 text-xs text-[color:var(--pg-muted)]">
                      Группы локаций
                    </div>

                    {!orgDraft ? (
                      <div className="text-sm text-[color:var(--pg-muted)]">Сначала выберите организацию.</div>
                    ) : groupKeys.length === 0 ? (
                      <div className="text-sm text-[color:var(--pg-muted)]">
                        В этой организации пока нет групп (нет активных локаций).
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setSelectedGroups(groupKeys)} disabled={actionLoading}>
                            Выбрать все
                          </Button>
                          <Button variant="secondary" onClick={() => setSelectedGroups([])} disabled={actionLoading}>
                            Снять все
                          </Button>
                          <div className="ml-auto text-xs text-[color:var(--pg-muted)]">
                            Выбрано: <b className="text-[color:var(--pg-text)]">{selectedGroups.length}</b>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                          {groupKeys.map((k) => {
                            const checked = selectedGroups.includes(k);
                            return (
                              <label
                                key={k}
                                className="flex items-center gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-2 text-sm text-[color:var(--pg-text)]"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedGroups((prev) => {
                                      const set = new Set(prev);
                                      if (set.has(k)) set.delete(k);
                                      else set.add(k);
                                      return Array.from(set);
                                    });
                                  }}
                                />
                                <span>{locationTypeRu(k)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="primary" disabled={actionLoading || !id} onClick={onSaveRole}>
                  {actionLoading ? "…" : "Сохранить роль и доступ"}
                </Button>
              </div>

              {actionErr && (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
                  {actionErr}
                </div>
              )}
              {actionOk && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
                  {actionOk}
                </div>
              )}

              {devEnabled ? (
                <div className="mt-2 text-xs text-[color:var(--pg-faint)]">
                  Служебная информация: роли и доступы пользователя.
                </div>
              ) : null}

              {devEnabled && (
                <div className="mt-3 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3">
                  <div className="text-xs font-semibold text-[color:var(--pg-muted)]">Служебные данные</div>
                  <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
                    Roles: {(data?.roles ?? []).map((r) => `${r.role}:${r.organization_id ?? "all"}`).join(", ") || "—"}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                    Org access:{" "}
                    {(data?.organizations_access ?? [])
                      .filter((x) => x.is_active)
                      .map((x) => `#${x.organization_id}`)
                      .join(", ") || "—"}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                    Group access:{" "}
                    {(data?.groups_access ?? [])
                      .filter((x) => x.is_active)
                      .map((x) => `#${x.organization_id}:${x.group_key}`)
                      .join(", ") || "—"}
                  </div>
                </div>
              )}
            </GlassCard>

            <GlassCard className="space-y-3">
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Доступ пользователя</h2>

              <div className="text-sm text-[color:var(--pg-muted)]">
                Организации:{" "}
                <b className="text-[color:var(--pg-text)]">{(data?.allowed_organization_ids ?? []).length}</b>{" "}
                • Локации: <b className="text-[color:var(--pg-text)]">{allowedLocationsCount}</b>
              </div>

              {!showAccessPreview ? (
                <div className="text-sm text-[color:var(--pg-muted)]">
                  Список слишком большой для компактного отображения. Уточните доступы через фильтрацию по ролям и организациям.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                      <tr>
                        <th className="px-4 py-3">Организация</th>
                        <th className="px-4 py-3">Локация</th>
                        <th className="px-4 py-3">Группа</th>
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
                            <td className="px-4 py-3 text-xs text-[color:var(--pg-muted)]">{locationTypeRu(l.type || "other")}</td>
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
              )}
            </GlassCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
