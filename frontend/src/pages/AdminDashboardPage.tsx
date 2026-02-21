import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Bell, Building2, MessageSquare, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { adminJson } from "../shared/adminApi";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type OrgLocStat = {
  location_id: number;
  location_name: string;
  location_slug: string;
  total_submissions: number;
  avg_rating: number | null;
  negative_share: number | null;
  last_submission_at: string | null;
};

type OrgSummary = {
  organization_id: number;
  organization_name: string;
  total_submissions: number;
  rated_count: number;
  avg_rating: number | null;
  negative_count: number;
  negative_share: number | null;
  rating_distribution: { rating: number; count: number }[];
  timeseries: { day: string; count: number; avg_rating: number | null }[];
  last_comments: {
    id: number;
    created_at: string;
    location_id: number;
    location_name: string;
    rating_overall: number | null;
    comment: string;
    name: string;
    email: string;
    room?: string;
    guest_name?: string;
    stay_id?: number | string | null;
  }[];
  locations: OrgLocStat[];
};

type GroupSummary = OrgSummary & {
  group_key: string;
  group_name: string;
};

const GROUP_LABELS_RU: Record<string, string> = {
  room: "Номера",
  restaurant: "Рестораны",
  conference_hall: "Конференц-залы",
  banquet_hall: "Банкетные залы",
  other: "Другое",
};

const GROUP_ORDER = ["room", "restaurant", "conference_hall", "banquet_hall", "other"];

function groupLabelRu(key: string) {
  return GROUP_LABELS_RU[key] ?? key;
}

function roleLabelRu(me: any) {
  if (!me) return "—";
  if (me.is_global) return "Директор";
  const roles = Array.isArray(me.roles) ? me.roles : [];
  const hasSvc = roles.some((r: any) => r?.role === "service_manager");
  const hasMgr = roles.some((r: any) => r?.role === "manager");
  const hasAud = roles.some((r: any) => r?.role === "auditor" || r?.role === "auditor_global");
  if (hasMgr) return "Менеджер";
  if (hasAud) return "Аудитор";
  if (hasSvc) return "Менеджер сервиса";
  return "Пользователь";
}

function pct(n: number | null) {
  if (n === null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function errToText(e: any, devEnabled: boolean, fallback: string) {
  if (!devEnabled) return fallback;
  try {
    const st = e?.status ? `status=${e.status}` : "";
    const detail =
      e?.detail == null
        ? ""
        : typeof e.detail === "string"
          ? e.detail.slice(0, 400)
          : JSON.stringify(e.detail).slice(0, 400);
    return [fallback, st, detail].filter(Boolean).join(" • ");
  } catch {
    return fallback;
  }
}

export default function AdminDashboardPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const allowedLocations = (me?.allowed_locations ?? []) as any[];

  const [orgsFromApi, setOrgsFromApi] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_org_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [groupKey, setGroupKey] = useState<string>(() => localStorage.getItem("pg_selected_group_key") || "all");

  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [groupSummary, setGroupSummary] = useState<GroupSummary | null>(null);

  const [loading, setLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Load organizations list for nicer names
  useEffect(() => {
    let alive = true;
    adminJson<Org[]>("/api/admin/admin/organizations")
      .then((xs) => {
        if (!alive) return;
        setOrgsFromApi(xs ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setOrgsFromApi([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Available orgs for this user
  const orgOptions: Org[] = useMemo(() => {
    const derivedIds = Array.from(new Set<number>(allowedLocations.map((l) => Number(l.organization_id)).filter(Boolean)));

    // Director: use API list. By default show only active orgs (stats endpoint работает только с активными).
    if (me?.is_global && orgsFromApi.length) {
      const list = devEnabled ? orgsFromApi : orgsFromApi.filter((o) => o.is_active);
      return list;
    }

    // Scoped: derived IDs, try to enrich from API
    const apiMap = new Map<number, Org>(orgsFromApi.map((o) => [o.id, o]));
    return derivedIds
      .map((id) => apiMap.get(id) ?? { id, name: `Организация #${id}`, slug: `org-${id}`, is_active: true })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allowedLocations, orgsFromApi, me?.is_global, devEnabled]);

  // Ensure orgId selected
  useEffect(() => {
    if (!orgOptions.length) {
      setOrgId("");
      return;
    }
    const ids = new Set(orgOptions.map((o) => o.id));
    const cur = orgId === "" ? null : Number(orgId);
    if (cur == null || !ids.has(cur)) setOrgId(orgOptions[0].id);
  }, [orgOptions, orgId]);

  useEffect(() => {
    if (orgId === "") return;
    localStorage.setItem("pg_selected_org_id", String(orgId));
  }, [orgId]);

  // Locations inside selected org (for selection persistence + группировка)
  const orgLocations = useMemo(() => {
    if (orgId === "") return [];
    return allowedLocations
      .filter((l) => Number(l.organization_id) === Number(orgId))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [allowedLocations, orgId]);

  const groupOptions = useMemo(() => {
    // групповые ключи берём из реальных доступных локаций в выбранной организации
    const typeToCount = new Map<string, number>();
    for (const l of orgLocations) {
      const k = String(l.type || "other");
      typeToCount.set(k, (typeToCount.get(k) ?? 0) + 1);
    }
    const keys = Array.from(typeToCount.keys());
    keys.sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return groupLabelRu(a).localeCompare(groupLabelRu(b));
    });
    return keys.map((k) => ({ key: k, label: groupLabelRu(k), count: typeToCount.get(k) ?? 0 }));
  }, [orgLocations]);

  // Keep groupKey sane on org change (и после загрузки me)
  useEffect(() => {
    if (orgId === "") return;
    if (groupKey === "all") return;
    const keys = new Set(groupOptions.map((g) => g.key));
    if (!keys.has(groupKey)) setGroupKey("all");
  }, [orgId, groupKey, groupOptions]);

  useEffect(() => {
    localStorage.setItem("pg_selected_group_key", groupKey);
  }, [groupKey]);

  useEffect(() => {
    if (orgId === "") return;
    if (!orgLocations.length) return;
    const raw = localStorage.getItem("pg_selected_location_id");
    const cur = raw ? Number(raw) : NaN;
    const ids = new Set(orgLocations.map((l) => Number(l.id)));
    if (!Number.isFinite(cur) || !ids.has(cur)) {
      localStorage.setItem("pg_selected_location_id", String(orgLocations[0].id));
    }
  }, [orgId, orgLocations]);

  // Load org summary
  useEffect(() => {
    let cancelled = false;
    if (orgId === "") return;

    setLoading(true);
    setError(null);

    adminJson<OrgSummary>(`/api/stats/organizations/${orgId}/summary?days=30&comments_limit=10&locations_limit=200`)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setSummary(null);
        setError(errToText(e, devEnabled, "Не удалось загрузить метрики по организации."));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, devEnabled]);

  // Load group summary (selected group only)
  useEffect(() => {
    let cancelled = false;
    if (orgId === "" || groupKey === "all") {
      setGroupSummary(null);
      setGroupError(null);
      setGroupLoading(false);
      return;
    }

    setGroupLoading(true);
    setGroupError(null);

    adminJson<GroupSummary>(
      `/api/stats/organizations/${orgId}/groups/${encodeURIComponent(groupKey)}/summary?days=30&comments_limit=10&locations_limit=200`
    )
      .then((s) => {
        if (cancelled) return;
        setGroupSummary(s);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setGroupSummary(null);
        setGroupError(errToText(e, devEnabled, "Не удалось загрузить метрики по группе."));
      })
      .finally(() => {
        if (cancelled) return;
        setGroupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, groupKey, devEnabled]);

  const activeSummary: OrgSummary | null = groupKey === "all" ? summary : groupSummary;

  const stats = useMemo(() => {
    return [
      { label: "Всего ответов", value: activeSummary ? String(activeSummary.total_submissions) : "—", icon: BarChart3 },
      { label: "Средняя оценка", value: activeSummary?.avg_rating != null ? activeSummary.avg_rating.toFixed(1) : "—", icon: Sparkles },
      {
        label: "Негатив (≤6)",
        value: activeSummary ? `${activeSummary.negative_count}${activeSummary.rated_count ? ` • ${pct(activeSummary.negative_share)}` : ""}` : "—",
        icon: Bell,
      },
    ];
  }, [activeSummary]);

  const dist = activeSummary?.rating_distribution ?? [];
  const maxCount = dist.reduce((m, x) => Math.max(m, x.count), 0);
  const totalRated = dist.reduce((s, x) => s + x.count, 0);

  const goToLocation = (locationId: number, page: "submissions" | "surveys" | "stays") => {
    localStorage.setItem("pg_selected_org_id", String(orgId));
    localStorage.setItem("pg_selected_location_id", String(locationId));
    if (page === "submissions") nav("/admin/submissions");
    if (page === "surveys") nav(`/admin/locations/${locationId}/surveys`);
    if (page === "stays") nav(`/admin/locations/${locationId}/stays`);
  };

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
                  Роль: <span className="text-[color:var(--pg-text)]">{roleLabelRu(me)}</span>
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="text-sm text-[color:var(--pg-muted)]">Организация:</div>

                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={orgId}
                  onChange={(e) => setOrgId(Number(e.target.value))}
                  disabled={!orgOptions.length}
                >
                  {orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {devEnabled ? ` • ${o.slug}` : ""}
                    </option>
                  ))}
                </select>

                {loading && <span className="text-xs text-[color:var(--pg-faint)]">Загрузка…</span>}
                {error && <span className="text-xs text-rose-300">{error}</span>}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="text-sm text-[color:var(--pg-muted)]">Группа:</div>

                <Button
                  variant="secondary"
                  className={`px-3 py-2 text-xs ${groupKey === "all" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
                  onClick={() => setGroupKey("all")}
                >
                  Все
                </Button>

                {groupOptions.map((g) => (
                  <Button
                    key={g.key}
                    variant="secondary"
                    className={`px-3 py-2 text-xs ${groupKey === g.key ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
                    onClick={() => setGroupKey(g.key)}
                  >
                    {g.label}
                    <span className="text-[color:var(--pg-faint)]">• {g.count}</span>
                  </Button>
                ))}

                {groupLoading && <span className="text-xs text-[color:var(--pg-faint)]">Загрузка группы…</span>}
                {groupError && <span className="text-xs text-rose-300">{groupError}</span>}
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => nav("/admin/organizations")}>Организации</Button>
                <Button variant="secondary" onClick={() => nav("/admin/users")}>Пользователи</Button>
                <Button variant="secondary" onClick={() => nav("/admin/submissions")}>Отзывы</Button>
              </div>

              {orgId !== "" && orgLocations.length === 0 && (
                <div className="mt-4 text-xs text-[color:var(--pg-faint)]">
                  В этой организации нет доступных локаций.
                </div>
              )}

              {orgId !== "" && groupKey !== "all" && (
                <div className="mt-3 text-xs text-[color:var(--pg-faint)]">
                  Выбранная группа: <span className="text-[color:var(--pg-text)]">{groupLabelRu(groupKey)}</span>
                </div>
              )}
            </div>

            <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
              <Building2 className="h-5 w-5 text-[color:var(--pg-muted)]" />
            </div>
          </div>
        </GlassCard>

        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map((c, idx) => {
            const Icon = c.icon;
            return (
              <motion.div key={c.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: idx * 0.05 }}>
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
              {(activeSummary?.rating_distribution ?? []).map((x) => {
                const w = maxCount > 0 ? Math.round((x.count / maxCount) * 100) : 0;
                return (
                  <div key={x.rating} className="flex items-center gap-3">
                    <div className="w-10 text-sm text-[color:var(--pg-muted)]">{x.rating}</div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                      <div className="h-full rounded-full" style={{ width: `${w}%`, minWidth: x.count > 0 ? 6 : 0, backgroundColor: "var(--pg-accent, #6d28d9)" }} />
                    </div>
                    <div className="w-14 text-right text-sm text-[color:var(--pg-muted)]">{totalRated > 0 ? `${Math.round((x.count / totalRated) * 100)}%` : "—"}</div>
                    <div className="w-10 text-right text-sm text-[color:var(--pg-muted)]">{x.count}</div>
                  </div>
                );
              })}
              {!activeSummary && <div className="text-sm text-[color:var(--pg-faint)]">—</div>}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Динамика (30 дней)</h2>
              <span className="text-xs text-[color:var(--pg-faint)]">ответов / средняя</span>
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
                  {(activeSummary?.timeseries ?? []).slice(-14).map((r) => (
                    <tr key={r.day} className="border-t border-[color:var(--pg-border)]">
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">{r.day}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-text)]">{r.count}</td>
                      <td className="px-4 py-3 text-[color:var(--pg-muted)]">{r.avg_rating != null ? r.avg_rating.toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                  {!activeSummary?.timeseries?.length && (
                    <tr className="border-t border-[color:var(--pg-border)]">
                      <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={3}>Пока нет данных за период.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-[color:var(--pg-faint)]">Показываем последние 14 дней.</p>
          </GlassCard>
        </div>

        <GlassCard>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">
              Локации{groupKey === "all" ? "" : ` • ${groupLabelRu(groupKey)}`}
            </h2>
            <div className="text-xs text-[color:var(--pg-faint)]">быстрые действия</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(activeSummary?.locations ?? []).map((l) => (
              <div key={l.location_id} className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[color:var(--pg-text)]">{l.location_name}</div>
                    <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                      {l.total_submissions} ответов • средняя {l.avg_rating != null ? l.avg_rating.toFixed(1) : "—"} • негатив {pct(l.negative_share)}
                    </div>
                    {l.last_submission_at ? (
                      <div className="mt-1 text-xs text-[color:var(--pg-faint)]">Последний отзыв: {new Date(l.last_submission_at).toLocaleString()}</div>
                    ) : (
                      <div className="mt-1 text-xs text-[color:var(--pg-faint)]">Пока нет отзывов</div>
                    )}
                    {devEnabled && (
                      <div className="mt-1 font-mono text-xs text-[color:var(--pg-muted)]">#{l.location_id} • {l.location_slug}</div>
                    )}
                  </div>

                  <div className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                    <Building2 className="h-5 w-5 text-[color:var(--pg-muted)]" />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => goToLocation(l.location_id, "submissions")}>Отзывы</Button>
                  <Button variant="secondary" onClick={() => goToLocation(l.location_id, "surveys")}>Опросы</Button>
                  <Button variant="secondary" onClick={() => goToLocation(l.location_id, "stays")}>Проживающие</Button>
                </div>
              </div>
            ))}

            {!loading && orgId !== "" && (activeSummary?.locations?.length ?? 0) === 0 && (
              <div className="text-sm text-[color:var(--pg-faint)]">Нет локаций для отображения.</div>
            )}
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Последние комментарии</h2>
            <div className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
              <MessageSquare className="h-5 w-5 text-[color:var(--pg-muted)]" />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(activeSummary?.last_comments ?? []).map((c) => (
              <div key={c.id} className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-[color:var(--pg-muted)]">
                    {new Date(c.created_at).toLocaleString()} • {c.location_name || "Локация"}
                    {devEnabled ? <span className="ml-2 font-mono text-xs">#{c.id}</span> : null}
                  </div>
                  <div className="text-sm font-semibold text-[color:var(--pg-text)]">{c.rating_overall ?? "—"}</div>
                </div>
                <div className="mt-2 text-sm text-[color:var(--pg-text)]">{c.comment}</div>

                {(c.name || c.email) && (
                  <div className="mt-2 text-xs text-[color:var(--pg-faint)]">{c.name || "—"} • {c.email || "—"}</div>
                )}

                <div className="mt-3">
                  <Button variant="secondary" onClick={() => nav(`/admin/submissions/${c.id}`)}>Открыть</Button>
                </div>
              </div>
            ))}

            {!activeSummary?.last_comments?.length && (
              <div className="text-sm text-[color:var(--pg-faint)]">Пока нет комментариев.</div>
            )}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
