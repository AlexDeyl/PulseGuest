import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { useAuth } from "../shared/auth";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type OrgShort = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type RoleScope = {
  role: string;
  organization_id: number | null;
  location_id: number | null;
};

type UserListItem = {
  id: number;
  full_name: string | null;
  email: string;
  is_active: boolean;
  created_at: string;
};

type UserListResponse = {
  items: UserListItem[];
  total: number;
  limit: number;
  offset: number;
};

type UserDetailMin = {
  id: number;
  roles: RoleScope[];
};

type CreateResp = {
  ok: boolean;
  id: number;
  email: string;
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

function roleRu(role: string) {
  if (role === "admin") return "Администратор";
  if (role === "ops_director") return "Операционный директор";
  if (role === "service_manager") return "Сервис-менеджер";
  if (role === "auditor") return "Аудитор";
  // legacy
  if (role === "director") return "Директор (legacy)";
  if (role === "manager") return "Менеджер (legacy)";
  if (role === "auditor_global") return "Аудитор global (legacy)";
  if (role === "super_admin") return "Super admin (legacy)";
  return role;
}

function pickPrimaryRole(roles: RoleScope[] | undefined | null): string {
  const vals = (roles ?? []).map((r) => String(r.role));
  if (vals.includes("admin") || vals.includes("director") || vals.includes("super_admin")) return "admin";
  if (vals.includes("ops_director") || vals.includes("manager")) return "ops_director";
  if (vals.includes("service_manager")) return "service_manager";
  if (vals.includes("auditor") || vals.includes("auditor_global")) return "auditor";
  return vals[0] ?? "—";
}

export default function AdminUsersPage() {
  const { me } = useAuth();
  const { enabled: devEnabledRaw } = useDevMode();
  const nav = useNavigate();

  const roleValues = useMemo(() => (Array.isArray(me?.roles) ? me!.roles.map((r) => r.role) : []), [me]);

  const isAdminLike = useMemo(() => {
    return roleValues.includes("admin") || roleValues.includes("director") || roleValues.includes("super_admin");
  }, [roleValues]);

  const isOps = useMemo(() => roleValues.includes("ops_director") || roleValues.includes("manager"), [roleValues]);

  const canManageUsers = useMemo(() => isAdminLike || isOps, [isAdminLike, isOps]);

  // dev UI только для admin-like (чтобы случайно не светить лишнее)
  const devEnabled = devEnabledRaw && isAdminLike;

  const [q, setQ] = useState("");
  const [items, setItems] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgShort[]>([]);
  const [roleByUserId, setRoleByUserId] = useState<Record<number, string>>({});

  // Create form
  const [createOpen, setCreateOpen] = useState(false);
  const [createFullName, setCreateFullName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<string>("service_manager");
  const [createOrgId, setCreateOrgId] = useState<string>("");
  const [createGroupKeys, setCreateGroupKeys] = useState<string[]>([]);
  const [createSelectedGroups, setCreateSelectedGroups] = useState<string[]>([]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Fetch orgs (needed for create and for ops constraints)
  useEffect(() => {
    if (!canManageUsers) return;
    adminJson<OrgShort[]>("/api/admin/admin/organizations")
      .then((data) => setOrgs(Array.isArray(data) ? data : []))
      .catch(() => setOrgs([]));
  }, [canManageUsers]);

  // List users
  useEffect(() => {
    if (!canManageUsers) return;

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
  }, [canManageUsers, q, limit, offset, devEnabled]);

  // Load roles for visible users (N+1, но лимит маленький; потом оптимизируем на бэке)
  useEffect(() => {
    if (!canManageUsers) return;
    let cancelled = false;

    const ids = (items ?? []).map((u) => u.id);
    if (ids.length === 0) {
      setRoleByUserId({});
      return;
    }

    Promise.allSettled(ids.map((id) => adminJson<UserDetailMin>(`/api/admin/admin/users/${id}`))).then((res) => {
      if (cancelled) return;
      const next: Record<number, string> = {};
      for (const r of res) {
        if (r.status === "fulfilled" && r.value) {
          next[r.value.id] = pickPrimaryRole(r.value.roles);
        }
      }
      setRoleByUserId(next);
    });

    return () => {
      cancelled = true;
    };
  }, [items, canManageUsers]);

  const orgOptions = useMemo(() => {
    const base = (orgs ?? []).filter((o) => o.is_active);
    const allowed = isAdminLike ? base : base.filter((o) => (me?.allowed_organization_ids ?? []).includes(o.id));
    return allowed.map((o) => ({
      value: String(o.id),
      label: devEnabled ? `${o.name} (#${o.id})` : o.name,
    }));
  }, [orgs, isAdminLike, me?.allowed_organization_ids, devEnabled]);

  const createRoleOptions = useMemo(() => {
    const opts = [
      { value: "service_manager", label: roleRu("service_manager") },
      { value: "ops_director", label: roleRu("ops_director") },
    ];
    if (isAdminLike) {
      opts.unshift({ value: "admin", label: roleRu("admin") });
      opts.push({ value: "auditor", label: roleRu("auditor") });
    }
    return opts;
  }, [isAdminLike]);

  // group keys for selected org (create)
  useEffect(() => {
    if (!createOpen) return;

    if (createRole !== "service_manager" || !createOrgId) {
      setCreateGroupKeys([]);
      setCreateSelectedGroups([]);
      return;
    }

    adminJson<string[]>(`/api/admin/admin/organizations/${createOrgId}/group-keys`)
      .then((keys) => {
        const list = Array.isArray(keys) ? keys : [];
        setCreateGroupKeys(list);
        // по умолчанию — все группы (удобнее, чем пусто)
        setCreateSelectedGroups((prev) => (prev.length ? prev : list));
      })
      .catch((e: any) => {
        setCreateGroupKeys([]);
        setCreateSelectedGroups([]);
        setCreateErr(errToText(e, devEnabled));
      });
  }, [createOpen, createRole, createOrgId, devEnabled]);

  async function onCreate() {
    setCreateErr(null);

    const email = createEmail.trim().toLowerCase();
    const pwd = createPassword;

    if (!email) return setCreateErr("Введите email.");
    if (!pwd || pwd.length < 6) return setCreateErr("Пароль минимум 6 символов.");

    if ((createRole === "ops_director" || createRole === "service_manager") && !createOrgId) {
      return setCreateErr("Выберите организацию.");
    }
    if (createRole === "service_manager" && (createSelectedGroups ?? []).length === 0) {
      return setCreateErr("Для сервис-менеджера выберите хотя бы одну группу.");
    }

    const payload: any = {
      full_name: createFullName.trim() ? createFullName.trim() : null,
      email,
      password: pwd,
      role: createRole,
      is_active: true,
    };

    if (createRole === "ops_director" || createRole === "service_manager") {
      payload.organization_id = Number(createOrgId);
    }
    if (createRole === "service_manager") {
      payload.group_keys = createSelectedGroups;
    }

    setCreateLoading(true);
    try {
      const resp = await adminJson<CreateResp>("/api/admin/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCreateOpen(false);
      setCreateFullName("");
      setCreateEmail("");
      setCreatePassword("");
      setCreateRole("service_manager");
      setCreateOrgId("");
      setCreateGroupKeys([]);
      setCreateSelectedGroups([]);
      setOffset(0);
      // сразу в карточку пользователя
      nav(`/admin/users/${resp.id}`);
    } catch (e: any) {
      setCreateErr(errToText(e, devEnabled));
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">Пользователи</h1>
            <div className="text-sm text-[color:var(--pg-muted)]">
              Создание/редактирование (роль + организация + группы).
            </div>
          </div>

          <div className="flex items-center gap-2">
          </div>
        </div>

        {!canManageUsers ? (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">
              Доступ к пользователям есть только у ролей <b>Администратор</b> и <b>Операционный директор</b>.
            </div>
          </GlassCard>
        ) : (
          <>
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

                <div className="flex items-center gap-2">
                  <div className="text-sm text-[color:var(--pg-muted)]">
                    Всего: <b className="text-[color:var(--pg-text)]">{total}</b>
                  </div>
                  <Button variant="primary" onClick={() => setCreateOpen((v) => !v)}>
                    {createOpen ? "Закрыть" : "Создать"}
                  </Button>
                </div>
              </div>

              {createOpen && (
                <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                  <div className="text-sm font-semibold text-[color:var(--pg-text)]">Новый пользователь</div>

                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs text-[color:var(--pg-muted)]">ФИО</div>
                      <input
                        value={createFullName}
                        onChange={(e) => setCreateFullName(e.target.value)}
                        placeholder="Иванов Иван Иванович"
                        className="w-full rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)]"
                      />
                    </div>

                    <div>
                      <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Email (логин)</div>
                      <input
                        value={createEmail}
                        onChange={(e) => setCreateEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)]"
                      />
                    </div>

                    <div>
                      <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Пароль</div>
                      <input
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        type="password"
                        placeholder="минимум 6 символов"
                        className="w-full rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)]"
                      />
                    </div>

                    <div>
                      <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Роль</div>
                      <Select
                        value={createRole}
                        onValueChange={(v) => {
                          setCreateRole(v);
                          setCreateOrgId("");
                          setCreateGroupKeys([]);
                          setCreateSelectedGroups([]);
                          setCreateErr(null);
                        }}
                        options={createRoleOptions}
                        placeholder="Выберите роль…"
                      />
                      {!isAdminLike && (
                        <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
                          Ограничение: ops_director не может создавать admin/auditor.
                        </div>
                      )}
                    </div>

                    {(createRole === "ops_director" || createRole === "service_manager") && (
                      <div className="md:col-span-2">
                        <div className="mb-2 text-xs text-[color:var(--pg-muted)]">Организация</div>
                        <Select
                          value={createOrgId}
                          onValueChange={(v) => {
                            setCreateOrgId(v);
                            setCreateErr(null);
                          }}
                          options={orgOptions}
                          placeholder="Выберите организацию…"
                        />
                        {!isAdminLike && (
                          <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
                            Доступны только организации из вашего скоупа.
                          </div>
                        )}
                      </div>
                    )}

                    {createRole === "service_manager" && (
                      <div className="md:col-span-2">
                        <div className="mb-2 text-xs text-[color:var(--pg-muted)]">
                          Группы локаций (group_key = Location.type)
                        </div>

                        {!createOrgId ? (
                          <div className="text-sm text-[color:var(--pg-muted)]">Сначала выберите организацию.</div>
                        ) : createGroupKeys.length === 0 ? (
                          <div className="text-sm text-[color:var(--pg-muted)]">
                            В этой организации пока нет групп (нет активных локаций) — нечего назначать.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => setCreateSelectedGroups(createGroupKeys)}
                                disabled={createLoading}
                              >
                                Выбрать все
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => setCreateSelectedGroups([])}
                                disabled={createLoading}
                              >
                                Снять все
                              </Button>
                              <div className="ml-auto text-xs text-[color:var(--pg-muted)]">
                                Выбрано: <b className="text-[color:var(--pg-text)]">{createSelectedGroups.length}</b>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                              {createGroupKeys.map((k) => {
                                const checked = createSelectedGroups.includes(k);
                                return (
                                  <label
                                    key={k}
                                    className="flex items-center gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-2 text-sm text-[color:var(--pg-text)]"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        setCreateSelectedGroups((prev) => {
                                          const set = new Set(prev);
                                          if (set.has(k)) set.delete(k);
                                          else set.add(k);
                                          return Array.from(set);
                                        });
                                      }}
                                    />
                                    <span className="font-mono">{k}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {createErr && <div className="mt-3 whitespace-pre-wrap text-sm text-rose-300">{createErr}</div>}

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                      Отмена
                    </Button>
                    <Button variant="primary" onClick={onCreate} disabled={createLoading}>
                      {createLoading ? "Создание…" : "Создать"}
                    </Button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
              ) : error ? (
                <div className="whitespace-pre-wrap text-sm text-rose-300">{error}</div>
              ) : items.length === 0 ? (
                <div className="text-sm text-[color:var(--pg-muted)]">Пользователи не найдены.</div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-[color:var(--pg-border)]">
                  <div className="grid grid-cols-12 gap-2 border-b border-[color:var(--pg-border)] bg-[color:var(--pg-card-hover)] px-4 py-3 text-xs font-semibold text-[color:var(--pg-muted)]">
                    <div className="col-span-7">Пользователь</div>
                    <div className="col-span-3">Роль</div>
                    <div className="col-span-1">Статус</div>
                    <div className="col-span-1 text-right">→</div>
                  </div>

                  {items.map((u) => {
                    const role = roleByUserId[u.id] ?? "—";
                    return (
                      <button
                        key={u.id}
                        onClick={() => nav(`/admin/users/${u.id}`)}
                        className="grid w-full grid-cols-12 gap-2 px-4 py-3 text-left text-sm text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
                      >
                        <div className="col-span-7">
                          <div className="font-medium">{u.full_name?.trim() ? u.full_name : "—"}</div>
                          <div className="mt-1 text-xs text-[color:var(--pg-muted)]">{u.email}</div>
                          {devEnabled && (
                            <div className="mt-1 font-mono text-xs text-[color:var(--pg-muted)]">id: {u.id}</div>
                          )}
                        </div>

                        <div className="col-span-3">
                          <div className="font-medium">{roleRu(role)}</div>
                          {!devEnabled && role === "—" ? (
                            <div className="mt-1 text-xs text-[color:var(--pg-muted)]">…</div>
                          ) : null}
                        </div>

                        <div className="col-span-1">
                          {u.is_active ? (
                            <span className="rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-1 text-xs">
                              ON
                            </span>
                          ) : (
                            <span className="rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-1 text-xs opacity-70">
                              OFF
                            </span>
                          )}
                        </div>

                        <div className="col-span-1 text-right text-[color:var(--pg-muted)]">→</div>
                      </button>
                    );
                  })}
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
          </>
        )}
      </div>
    </AppShell>
  );
}
