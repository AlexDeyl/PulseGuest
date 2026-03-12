import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Bell, Building2, MessageSquare, Sparkles, Search, Star } from "lucide-react";
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
  const roles = Array.isArray(me.roles) ? me.roles : [];
  const has = (x: string) => roles.some((r: any) => r?.role === x);

  if (has("admin") || has("director") || has("super_admin")) return "Администратор";
  if (has("ops_director") || has("manager")) return "Операционный директор";
  if (has("auditor") || has("auditor_global")) return "Аудитор";
  if (has("service_manager")) return "Сервис-менеджер";
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

  const hasAuditorRole = useMemo(() => {
    const roles = Array.isArray(me?.roles) ? me!.roles : [];
    return roles.some((r: any) => r?.role === "auditor" || r?.role === "auditor_global");
  }, [me]);

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

  const canManageOrgs = isAdminLike || isOps;
  const canManageSurveys = isAdminLike || isOps || isService;
  const canManageUsers = isAdminLike || isOps;
  const canViewSubmissions = isAdminLike || isOps || isService || isAuditor;
  const canManageStays = isAdminLike || isOps;

  const isStatsOnly = isAuditor && !isAdminLike && !isOps && !isService;

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

    const locLimit = Math.min(5000, Math.max(200, orgLocations.length || 0));

    adminJson<OrgSummary>(
      `/api/stats/organizations/${orgId}/summary?days=30&comments_limit=5&locations_limit=${locLimit}`
    )
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

    const groupLocCount = orgLocations.filter((l: any) => String(l.type || "other") === String(groupKey)).length;
    const groupLocLimit = Math.min(5000, Math.max(200, groupLocCount || 0));

    adminJson<GroupSummary>(
      `/api/stats/organizations/${orgId}/groups/${encodeURIComponent(groupKey)}/summary?days=30&comments_limit=10&locations_limit=${groupLocLimit}`
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
    if (page === "submissions" && !canViewSubmissions) return;
    if (page === "surveys" && !canManageSurveys) return;
    if (page === "stays" && !canManageStays) return;

    localStorage.setItem("pg_selected_org_id", String(orgId));
    localStorage.setItem("pg_selected_location_id", String(locationId));
    if (page === "submissions") nav("/admin/submissions");
    if (page === "surveys") nav(`/admin/locations/${locationId}/surveys`);
    if (page === "stays") nav(`/admin/locations/${locationId}/stays`);
  };

  const [locTab, setLocTab] = useState<"problems" | "active" | "empty">("problems");
  const [locSearch, setLocSearch] = useState("");

  const pinnedKey = orgId === "" ? null : `pg_pinned_locations_${orgId}`;
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);

  // load pins per org
  useEffect(() => {
    if (!pinnedKey) {
      setPinnedIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(pinnedKey);
      const arr = raw ? JSON.parse(raw) : [];
      setPinnedIds(Array.isArray(arr) ? arr.map((x) => Number(x)).filter(Number.isFinite) : []);
    } catch {
      setPinnedIds([]);
    }
  }, [pinnedKey]);

  // persist pins
  useEffect(() => {
    if (!pinnedKey) return;
    try {
      localStorage.setItem(pinnedKey, JSON.stringify(pinnedIds.slice(0, 50)));
    } catch {
      // ignore
    }
  }, [pinnedKey, pinnedIds]);

  const togglePin = (locationId: number) => {
    setPinnedIds((prev) =>
      prev.includes(locationId) ? prev.filter((x) => x !== locationId) : [locationId, ...prev]
    );
  };

  const locById = useMemo(() => {
    const m = new Map<number, any>();
    for (const l of orgLocations) m.set(Number(l.id), l);
    return m;
  }, [orgLocations]);

  const statsById = useMemo(() => {
    const m = new Map<number, OrgLocStat>();
    for (const l of activeSummary?.locations ?? []) m.set(Number(l.location_id), l);
    return m;
  }, [activeSummary]);

  const recentLocationIds = useMemo(() => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const c of activeSummary?.last_comments ?? []) {
      const lid = Number(c.location_id);
      if (!Number.isFinite(lid) || seen.has(lid)) continue;
      seen.add(lid);
      out.push(lid);
      if (out.length >= 8) break;
    }
    return out;
  }, [activeSummary]);

  const searchResults = useMemo(() => {
    const q = locSearch.trim().toLowerCase();
    if (!q) return [];
    const scoped = groupKey === "all"
      ? orgLocations
      : orgLocations.filter((l: any) => String(l.type || "other") === String(groupKey));

    return scoped
      .filter((l: any) => {
        const name = String(l.name ?? "").toLowerCase();
        const code = String(l.code ?? "").toLowerCase();
        const slug = String(l.slug ?? "").toLowerCase();
        return name.includes(q) || code.includes(q) || slug.includes(q) || String(l.id) === q;
      })
      .slice(0, 8);
  }, [locSearch, orgLocations, groupKey]);

  const tabLists = useMemo(() => {
    const all = activeSummary?.locations ?? [];

    const toTs = (iso: string | null) => {
      if (!iso) return 0;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t : 0;
    };

    const problems = all
      .filter((l) => (l.total_submissions ?? 0) > 0)
      .sort((a, b) => {
        const aNeg = a.negative_share ?? 0;
        const bNeg = b.negative_share ?? 0;
        if (bNeg !== aNeg) return bNeg - aNeg;

        const aAvg = a.avg_rating ?? 999;
        const bAvg = b.avg_rating ?? 999;
        if (aAvg !== bAvg) return aAvg - bAvg;

        return toTs(b.last_submission_at) - toTs(a.last_submission_at);
      })
      .slice(0, 8);

    const active = all
      .slice()
      .sort((a, b) => {
        const dt = toTs(b.last_submission_at) - toTs(a.last_submission_at);
        if (dt !== 0) return dt;
        return (b.total_submissions ?? 0) - (a.total_submissions ?? 0);
      })
      .slice(0, 8);

    const empty = all.filter((l) => (l.total_submissions ?? 0) === 0).slice(0, 8);

    return { problems, active, empty };
  }, [activeSummary]);

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseStay • Управление и статистика</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Аналитика отзывов</h1>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[color:var(--pg-muted)]">
                <span>
                  Вы вошли как{" "}
                  <span className="text-[color:var(--pg-text)]">
                    {String(me?.name || me?.full_name || me?.username || "").trim() || me?.email || "—"}
                  </span>
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
                    </option>
                  ))}
                </select>

                {loading && <span className="text-xs text-[color:var(--pg-faint)]">Загрузка…</span>}
                {error && (
                  <span className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-1 text-xs text-rose-300">
                    {error}
                  </span>
                )}
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
                {groupError && (
                  <span className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-1 text-xs text-rose-300">
                    {groupError}
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {canManageOrgs && (
                  <Button variant="secondary" onClick={() => nav("/admin/organizations")}>
                    Организации
                  </Button>
                )}
                {canManageSurveys && (
                  <Button variant="secondary" onClick={() => nav("/admin/group-surveys")}>
                    Опросы
                  </Button>
                )}
                {canManageUsers && (
                  <Button variant="secondary" onClick={() => nav("/admin/users")}>
                    Пользователи
                  </Button>
                )}
                {canViewSubmissions && (
                  <Button variant="secondary" onClick={() => nav("/admin/submissions")}>
                    Отзывы
                  </Button>
                )}

                {hasAuditorRole && (
                  <Button variant="secondary" onClick={() => nav("/admin/audits")}>Аудиты</Button>
                )}

                {isStatsOnly && (
                  <div className="ml-1 text-xs text-[color:var(--pg-faint)]">
                    Доступ аудитора: просмотр статистики и отзывов.
                  </div>
                )}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">
              Локации{groupKey === "all" ? "" : ` • ${groupLabelRu(groupKey)}`}
            </h2>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={orgId === ""}
                onClick={() => orgId !== "" && nav(`/admin/organizations/${orgId}/locations`)}
              >
                Все локации
              </Button>
            </div>
          </div>

          {/* Top row: search + pinned + recent */}
          <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-3">
            {/* Search */}
            <div className="min-w-0 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--pg-text)]">
                <Search className="h-4 w-4 text-[color:var(--pg-muted)]" />
                Быстрый поиск
              </div>

              <input
                className="mt-3 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                placeholder="Номер/название/код (например: 203)"
                value={locSearch}
                onChange={(e) => setLocSearch(e.target.value)}
              />

              {locSearch.trim() && (
                <div className="mt-3 space-y-2">
                  {searchResults.length === 0 ? (
                    <div className="text-xs text-[color:var(--pg-faint)]">Ничего не найдено.</div>
                  ) : (
                    searchResults.map((l: any) => (
                      <div
                        key={l.id}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-[color:var(--pg-text)]">{l.name}</div>
                          <div className="truncate text-xs text-[color:var(--pg-muted)]">
                            {l.code ? `Код: ${l.code}` : "Локация"}
                            {devEnabled ? <span className="ml-2 font-mono text-[11px] text-[color:var(--pg-faint)]">#{l.id} • {l.slug}</span> : null}
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-2 self-start">
                          {canViewSubmissions && (
                            <Button variant="secondary" onClick={() => goToLocation(Number(l.id), "submissions")}>
                              Отзывы
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Pinned */}
            <div className="min-w-0 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Закреплённые</div>
                <div className="text-xs text-[color:var(--pg-faint)]">{pinnedIds.length ? `(${pinnedIds.length})` : ""}</div>
              </div>

              <div className="mt-3 space-y-2">
                {pinnedIds.length === 0 ? (
                  <div className="text-xs text-[color:var(--pg-faint)]">
                    Нажми ⭐ на карточке локации, чтобы закрепить.
                  </div>
                ) : (
                  pinnedIds.slice(0, 8).map((lid) => {
                    const base = locById.get(Number(lid));
                    const st = statsById.get(Number(lid));
                    const name = st?.location_name || base?.name || "Локация";
                    return (
                      <div key={lid} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-[color:var(--pg-text)]">{name}</div>
                          <div className="truncate text-xs text-[color:var(--pg-muted)]">
                            {st ? `${st.total_submissions} ответов • ср. ${st.avg_rating != null ? st.avg_rating.toFixed(1) : "—"}` : "—"}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 self-start">
                          {canViewSubmissions && (
                              <Button variant="secondary" onClick={() => goToLocation(Number(lid), "submissions")}>
                                Открыть
                              </Button>
                            )}
                          <button
                            type="button"
                            onClick={() => togglePin(Number(lid))}
                            className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] hover:bg-[color:var(--pg-card-hover)]"
                            aria-label="Открепить"
                          >
                            <Star className="h-4 w-4 text-amber-300/90" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Recent */}
            <div className="min-w-0 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">Последние</div>

              <div className="mt-3 space-y-2">
                {recentLocationIds.length === 0 ? (
                  <div className="text-xs text-[color:var(--pg-faint)]">Пока нет активности.</div>
                ) : (
                  recentLocationIds.map((lid) => {
                    const base = locById.get(Number(lid));
                    const st = statsById.get(Number(lid));
                    const name = st?.location_name || base?.name || `Локация #${lid}`;
                    const lastAt = st?.last_submission_at ? new Date(st.last_submission_at).toLocaleString() : "—";

                    return (
                      <div key={lid} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-[color:var(--pg-text)]">{name}</div>
                          <div className="truncate text-xs text-[color:var(--pg-muted)]">Последний отзыв: {lastAt}</div>
                        </div>

                        <div className="flex shrink-0 gap-2 self-start">
                          <Button variant="secondary" onClick={() => goToLocation(Number(lid), "submissions")}>
                            Открыть
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              className={`px-3 py-2 text-xs ${locTab === "problems" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
              onClick={() => setLocTab("problems")}
            >
              Проблемные
            </Button>
            <Button
              variant="secondary"
              className={`px-3 py-2 text-xs ${locTab === "active" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
              onClick={() => setLocTab("active")}
            >
              Активные
            </Button>
            <Button
              variant="secondary"
              className={`px-3 py-2 text-xs ${locTab === "empty" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
              onClick={() => setLocTab("empty")}
            >
              Без отзывов
            </Button>

            <div className="ml-auto text-xs text-[color:var(--pg-faint)]">Показаны основные локации</div>
          </div>

          {/* Cards (max 8) */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(locTab === "problems" ? tabLists.problems : locTab === "active" ? tabLists.active : tabLists.empty).map((l) => {
              const isPinned = pinnedIds.includes(l.location_id);

              return (
                <div key={l.location_id} className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold text-[color:var(--pg-text)]">{l.location_name}</div>
                        <button
                          type="button"
                          onClick={() => togglePin(l.location_id)}
                          className="grid h-8 w-8 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] hover:bg-[color:var(--pg-card-hover)]"
                          aria-label={isPinned ? "Открепить" : "Закрепить"}
                        >
                          <Star className={isPinned ? "h-4 w-4 text-amber-300/90" : "h-4 w-4 text-[color:var(--pg-muted)]"} />
                        </button>
                      </div>

                      <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                        {l.total_submissions} ответов • средняя {l.avg_rating != null ? l.avg_rating.toFixed(1) : "—"} • негатив {pct(l.negative_share)}
                      </div>

                      {l.last_submission_at ? (
                        <div className="mt-1 text-xs text-[color:var(--pg-faint)]">
                          Последний отзыв: {new Date(l.last_submission_at).toLocaleString()}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-[color:var(--pg-faint)]">Пока нет отзывов</div>
                      )}

                      {devEnabled && (
                        <div className="mt-1 font-mono text-[11px] text-[color:var(--pg-faint)]">
                          #{l.location_id} • {l.location_slug}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {canViewSubmissions && (
                      <Button variant="secondary" onClick={() => goToLocation(l.location_id, "submissions")}>
                        Отзывы
                      </Button>
                    )}
                    {canManageSurveys && (
                      <Button variant="secondary" onClick={() => goToLocation(l.location_id, "surveys")}>
                        Опросы
                      </Button>
                    )}
                    {canManageStays && (
                      <Button variant="secondary" onClick={() => goToLocation(l.location_id, "stays")}>
                        Проживающие
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

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
                  {canViewSubmissions && (
                    <div className="mt-3">
                      <Button variant="secondary" onClick={() => nav(`/admin/submissions/${c.id}`)}>
                        Открыть отзыв
                      </Button>
                    </div>
                  )}
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
