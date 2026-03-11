import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  History,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson } from "../shared/adminApi";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";
import type {
  AuditDashboardByGroup,
  AuditDashboardByOrganization,
  AuditDashboardLocation,
  AuditDashboardRecentCompleted,
  AuditDashboardSummary,
  AuditDashboardTrendPoint,
  AuditDashboardWorstQuestion,
} from "../shared/auditApi";
import { getAuditDashboardSummary } from "../shared/auditApi";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type LocShort = {
  id: number;
  organization_id: number;
};

function errToText(e: any) {
  if (!e) return "Не удалось загрузить аналитику аудитов. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;
  if (typeof e?.detail?.message === "string") return e.detail.message;
  if (typeof e?.message === "string" && e.message.trim()) return e.message;
  return "Не удалось загрузить аналитику аудитов. Обновите страницу и попробуйте снова.";
}

function asDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateTime(value?: string | null) {
  const d = asDate(value);
  if (!d) return "—";
  return d.toLocaleString("ru-RU");
}

function fmtPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

function clampPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentBand(value?: number | null) {
  const safe = clampPercent(value);
  if (safe >= 85) return "good";
  if (safe >= 70) return "mid";
  return "low";
}

function percentTone(value?: number | null) {
  const band = percentBand(value);

  if (band === "good") {
    return {
      solid: "var(--pg-accent-3)",
      soft: "var(--pg-accent-3)",
      text: "var(--pg-success-text)",
      border: "var(--pg-success-border)",
      glow: "0 0 0 1px var(--pg-success-border) inset",
    } as const;
  }

  if (band === "mid") {
    return {
      solid: "var(--pg-accent-1)",
      soft: "var(--pg-accent-1)",
      text: "var(--pg-text)",
      border: "var(--pg-input-border-focus)",
      glow: "0 0 0 1px var(--pg-input-border-focus) inset",
    } as const;
  }

  return {
    solid: "var(--pg-accent-2)",
    soft: "var(--pg-accent-2)",
    text: "var(--pg-text)",
    border: "var(--pg-input-border-focus)",
    glow: "0 0 0 1px var(--pg-input-border-focus) inset",
  } as const;
}

function percentColor(value?: number | null) {
  return percentTone(value).solid;
}

function percentTextColor(value?: number | null) {
  return percentTone(value).text;
}

function percentSoftBadgeStyle(value?: number | null) {
  const tone = percentTone(value);
  return {
    background: tone.soft,
    color: tone.text,
    boxShadow: tone.glow,
    border: `1px solid ${tone.border}`,
    backdropFilter: "blur(4px)",
    fontWeight: 600,
  } as const;
}

function volumeTone(ratio: number) {
  const safe = Math.max(0, Math.min(1, ratio));

  if (safe >= 0.85) {
    return {
      solid: "var(--pg-gradient)",
      text: "var(--pg-on-primary)",
      border: "var(--pg-input-border-focus)",
      glow: "0 10px 26px rgba(0,0,0,0.18)",
    } as const;
  }

  if (safe >= 0.55) {
    return {
      solid: "var(--pg-accent-1)",
      text: "var(--pg-text)",
      border: "var(--pg-input-border-focus)",
      glow: "0 0 0 1px var(--pg-input-border-focus) inset",
    } as const;
  }

  return {
    solid: "var(--pg-accent-2)",
    text: "var(--pg-text)",
    border: "var(--pg-border)",
    glow: "0 0 0 1px var(--pg-border) inset",
  } as const;
}

function fmtScorePair(sum?: number | null, max?: number | null) {
  if (sum == null || max == null) return "—";
  return `${sum} / ${max}`;
}

function fmtGroupName(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "Без группы";

  const map: Record<string, string> = {
    room: "Номера",
    rooms: "Номера",
    restaurant: "Рестораны",
    restaurants: "Рестораны",
    conference: "Конференц-залы",
    conference_hall: "Конференц-залы",
    conference_halls: "Конференц-залы",
    banquet: "Банкетные площадки",
    banquets: "Банкетные площадки",
    spa: "SPA",
    location: "Локации",
    organization: "Организация",
    other: "Прочее",
  };

  return map[raw.toLowerCase()] || raw;
}

function normalizeSummary(data: AuditDashboardSummary | null): AuditDashboardSummary | null {
  if (!data) return null;

  return {
    ...data,
    by_organization: Array.isArray(data.by_organization) ? data.by_organization : [],
    by_group: Array.isArray(data.by_group) ? data.by_group : [],
    best_locations: Array.isArray(data.best_locations) ? data.best_locations : [],
    worst_locations: Array.isArray(data.worst_locations) ? data.worst_locations : [],
    worst_questions: Array.isArray(data.worst_questions) ? data.worst_questions : [],
    recent_completed: Array.isArray(data.recent_completed) ? data.recent_completed : [],
    trends: Array.isArray((data as any).trends) ? (data as any).trends : [],
  };
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-soft)] px-4 py-6 text-sm text-[color:var(--pg-text-muted)]">
      {text}
    </div>
  );
}

function SectionTable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <GlassCard className="p-5">
      <h3 className="mb-4 text-lg font-semibold text-[color:var(--pg-text)]">{title}</h3>
      {children}
    </GlassCard>
  );
}

function MiniBarChart({
  items,
}: {
  items: { label: string; value: number; sublabel?: string }[];
}) {
  if (!items.length) return <EmptyState text="Пока недостаточно данных для отображения." />;

  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const ratio = item.value / max;
        const width = Math.max(6, Math.round(ratio * 100));
        const tone = volumeTone(ratio);

        return (
          <div key={`${item.label}_${item.value}`} className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[color:var(--pg-text)]">{item.label}</div>
                {item.sublabel ? (
                  <div className="text-xs text-[color:var(--pg-text-muted)]">{item.sublabel}</div>
                ) : null}
              </div>
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                {item.value}
              </div>
            </div>
              <div className="h-2 rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${width}%`,
                    background: tone.solid,
                    boxShadow: tone.glow,
                  }}
                />
              </div>
          </div>
        );
      })}
    </div>
  );
}

function PercentBars({
  items,
}: {
  items: { label: string; value: number | null; sublabel?: string }[];
}) {
  if (!items.length) return <EmptyState text="Пока недостаточно данных для отображения." />;

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const safe = clampPercent(item.value);

        return (
          <div key={`${item.label}_${safe}`} className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[color:var(--pg-text)]">{item.label}</div>
                {item.sublabel ? (
                  <div className="text-xs text-[color:var(--pg-text-muted)]">{item.sublabel}</div>
                ) : null}
              </div>
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                {item.value == null ? "—" : `${safe}%`}
              </div>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div
                className="h-2 rounded-full transition-all"
                style={{
                  width: `${safe}%`,
                  background: "var(--pg-gradient)",
                  backgroundSize: "160% 100%",
                  backgroundPosition: "left center",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function problemLevel(value: number | null) {
  const safe = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  if (safe >= 70) {
    return { label: "Риск высокий", hint: "Пункт часто проваливается" };
  }
  if (safe >= 40) {
    return { label: "Риск средний", hint: "Проблема встречается регулярно" };
  }
  return { label: "Риск низкий", hint: "Проблема встречается редко" };
}

function HeatList({
  items,
}: {
  items: {
    key: string | number;
    title: string;
    subtitle?: string;
    intensity: number | null;
    problemText?: string;
  }[];
}) {
  if (!items.length) return <EmptyState text="Пока недостаточно данных для отображения." />;

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const safe = Math.max(0, Math.min(100, Math.round(item.intensity ?? 0)));
        const level = problemLevel(item.intensity);

        return (
          <div
              key={item.key}
              className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-soft)] p-4"
            >
            <div className="mb-2 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[color:var(--pg-text)]">{item.title}</div>
                {item.subtitle ? (
                  <div className="mt-1 text-xs text-[color:var(--pg-text-muted)]">{item.subtitle}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-sm font-semibold text-[color:var(--pg-text)]">{safe}%</div>
            </div>

            <div className="mb-2 h-2 rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-white/70 transition-all"
                style={{ width: `${safe}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-[color:var(--pg-soft)] px-2 py-1 text-[color:var(--pg-text)]">
                {level.label}
              </span>
              <span className="text-[color:var(--pg-text-muted)]">{item.problemText || level.hint}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function niceTrendText(points: AuditDashboardTrendPoint[]) {
  if (points.length < 2) return "Недостаточно данных для оценки тренда";
  const first = points[0]?.avg_score_percent ?? null;
  const last = points[points.length - 1]?.avg_score_percent ?? null;
  if (first == null || last == null) {
    return "Тренд появится, когда накопится больше завершенных проверок";
  }
  const delta = Math.round((last - first) * 10) / 10;
  if (delta >= 5) return `Качество растёт: +${delta}% к началу периода`;
  if (delta <= -5) return `Качество снижается: ${delta}% к началу периода`;
  return "Результат остаётся примерно на одном уровне";
}

function TrendLineChart({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle: string;
  points: AuditDashboardTrendPoint[];
}) {
  const chartPoints = points.filter((p) => p.avg_score_percent != null);

  if (!chartPoints.length) {
    return <EmptyState text="Для графика качества пока недостаточно завершенных проверок." />;
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2 text-[color:var(--pg-text)]">
        <TrendingUp className="h-5 w-5" />
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="mb-2 text-sm text-[color:var(--pg-text-muted)]">{subtitle}</p>
      <p className="mb-4 text-xs text-[color:var(--pg-text-muted)]">
        {points[0]?.bucket === "week" ? "По неделям" : "По дням"} · {niceTrendText(chartPoints)}
      </p>

      <div className="space-y-3">
        {chartPoints.map((p) => {
          const percent = clampPercent(p.avg_score_percent ?? 0);
          return (
            <div key={p.period_key} className="space-y-1">
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                {p.label} {percent}% · проблемных: {Number(p.problem_completed_runs || 0)}
              </div>
                <div className="h-2 rounded-full bg-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.22)]">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${percent}%`,
                      background: "var(--pg-gradient)",
                      backgroundSize: "160% 100%",
                      backgroundPosition: "left center",
                    }}
                  />
                </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function TrendBarsChart({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle: string;
  points: AuditDashboardTrendPoint[];
}) {
  if (!points.length) {
    return <EmptyState text="Для динамики по количеству пока недостаточно данных." />;
  }

  const chartHeight = 120;
  const max = Math.max(1, ...points.map((p) => Number(p.completed_runs || 0)));

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2 text-[color:var(--pg-text)]">
        <BarChart3 className="h-5 w-5" />
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="mb-2 text-sm text-[color:var(--pg-text-muted)]">{subtitle}</p>
      <p className="mb-4 text-xs text-[color:var(--pg-text-muted)]">
        {points[0]?.bucket === "week" ? "По неделям" : "По дням"}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {points.map((p) => {
          const value = Number(p.completed_runs || 0);
          const ratio = value / max;
          const fillHeight = Math.max(10, Math.round(ratio * chartHeight));

          return (
            <div key={p.label} className="flex flex-col items-center gap-2">
              <div
                className="relative flex w-14 items-end justify-center overflow-hidden rounded-2xl"
                style={{ height: `${chartHeight}px` }}
              >
                <div
                  className="absolute inset-x-0 bottom-0 overflow-hidden rounded-2xl"
                  style={{ height: `${fillHeight}px` }}
                >
                  <div
                      className="absolute inset-x-0 bottom-0 rounded-2xl"
                      style={{
                        height: `${chartHeight}px`,
                        background:
                          "linear-gradient(to top, rgba(99, 102, 241, 0.92) 0%, rgba(236, 72, 153, 0.92) 52%, rgba(16, 185, 129, 0.92) 100%)",
                      }}
                    />
                </div>
                <span
                  className="relative z-[1] pb-2 text-sm font-semibold text-[color:var(--pg-on-primary)]"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.22)" }}
                >
                  {value}
                </span>
              </div>

              <div className="text-xs font-medium text-[color:var(--pg-text-muted)]">{p.label}</div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function KpiCard({
  icon,
  title,
  value,
  subtitle,
  extra,
}: {
  icon: ReactNode;
  title: string;
  value: string | number;
  subtitle: string;
  extra?: ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[color:var(--pg-text-muted)]">{icon}</div>
        <div className="text-right text-2xl font-semibold text-[color:var(--pg-text)]">{value}</div>
      </div>
      <div className="text-sm font-medium text-[color:var(--pg-text)]">{title}</div>
      <div className="mt-1 text-xs text-[color:var(--pg-text-muted)]">{subtitle}</div>
      {extra ? <div className="mt-3">{extra}</div> : null}
    </GlassCard>
  );
}

export default function AdminAuditsDashboardPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const roleValues = Array.isArray((me as any)?.roles)
    ? (me as any).roles.map((r: any) => String(r?.role || ""))
    : [];
  const isOpsDirector = roleValues.includes("ops_director");

  const allowedLocations: LocShort[] = (((me as any)?.allowed_locations ?? []) as LocShort[]) || [];

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>(
    () => localStorage.getItem("pg_audit_dashboard_org_id") || "all"
  );
  const [summary, setSummary] = useState<AuditDashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const xs = await adminJson("/api/admin/admin/organizations");
        if (!alive) return;

        const filtered = devEnabled ? xs : xs.filter((o: Org) => o.is_active);

        if ((me as any)?.is_global) {
          setOrgs(filtered);
          return;
        }

        const allowedOrgIds = new Set(
          allowedLocations
            .map((l) => Number(l.organization_id))
            .filter((x) => Number.isFinite(x))
        );

        setOrgs(filtered.filter((o: Org) => allowedOrgIds.has(Number(o.id))));
      } catch {
        const ids = Array.from(
          new Set(
            allowedLocations
              .map((l) => Number(l.organization_id))
              .filter((x) => Number.isFinite(x))
          )
        );

        if (!alive) return;

        setOrgs(
          ids.map((id, idx) => ({
            id,
            name: `Организация ${idx + 1}`,
            slug: `org-${id}`,
            is_active: true,
          }))
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [allowedLocations, devEnabled, me]);

  useEffect(() => {
    const allowedValues = new Set(["all", ...orgs.map((o) => String(o.id))]);
    if (!allowedValues.has(orgFilter)) {
      setOrgFilter("all");
    }
  }, [orgFilter, orgs]);

  useEffect(() => {
    localStorage.setItem("pg_audit_dashboard_org_id", orgFilter);
  }, [orgFilter]);

  const refreshSummary = async () => {
    setLoading(true);
    setErr(null);

    try {
      const data = await getAuditDashboardSummary({
        organizationId: orgFilter === "all" ? null : Number(orgFilter),
      });
      setSummary(normalizeSummary(data));
    } catch (e) {
      setSummary(null);
      setErr(errToText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orgs.length && orgFilter !== "all") {
      setSummary(null);
      return;
    }
    void refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgFilter, orgs.length]);

  const orgOptions = useMemo(
    () => [
      { value: "all", label: "Все доступные организации" },
      ...orgs.map((o) => ({ value: String(o.id), label: o.name })),
    ],
    [orgs]
  );

  const selectedOrgLabel = useMemo(() => {
    if (orgFilter === "all") return "Все доступные организации";
    return orgs.find((o) => String(o.id) === String(orgFilter))?.name || "Выбранная организация";
  }, [orgFilter, orgs]);

  const byOrganization = Array.isArray(summary?.by_organization) ? summary!.by_organization : [];
  const byGroup = Array.isArray(summary?.by_group) ? summary!.by_group : [];
  const bestLocations = Array.isArray(summary?.best_locations) ? summary!.best_locations : [];
  const worstLocations = Array.isArray(summary?.worst_locations) ? summary!.worst_locations : [];
  const worstQuestions = Array.isArray(summary?.worst_questions) ? summary!.worst_questions : [];
  const recentCompleted = Array.isArray(summary?.recent_completed) ? summary!.recent_completed : [];
  const trends = Array.isArray(summary?.trends) ? summary!.trends : [];

  const hasAnyData = useMemo(() => {
    if (!summary) return false;
    return (
      Number(summary.total_runs || 0) > 0 ||
      byOrganization.length > 0 ||
      byGroup.length > 0 ||
      recentCompleted.length > 0 ||
      trends.length > 0
    );
  }, [summary, byOrganization.length, byGroup.length, recentCompleted.length, trends.length]);

  const byGroupChart = useMemo(
    () =>
      byGroup.slice(0, 6).map((item: AuditDashboardByGroup) => ({
        label: fmtGroupName(item.group_key),
        value: Number(item.completed_runs || 0),
        sublabel:
          item.avg_score_percent == null
            ? "Нет score"
            : `Средний результат ${fmtPercent(item.avg_score_percent)}`,
      })),
    [byGroup]
  );

  const bestLocationBars = useMemo(
    () =>
      bestLocations.slice(0, 5).map((item: AuditDashboardLocation) => ({
        label: item.location_name || "Без названия",
        value: item.avg_score_percent,
        sublabel: `${item.organization_name} · Проверок: ${item.completed_runs}`,
      })),
    [bestLocations]
  );

  const worstLocationBars = useMemo(
    () =>
      worstLocations.slice(0, 5).map((item: AuditDashboardLocation) => ({
        label: item.location_name || "Без названия",
        value: item.avg_score_percent,
        sublabel: `${item.organization_name} · Проверок: ${item.completed_runs}`,
      })),
    [worstLocations]
  );

  const scoreHealth = useMemo(() => {
    const avg = summary?.avg_score_percent;
    if (avg == null) {
      return {
        label: "Нет данных",
        width: 0,
      };
    }
    if (avg >= 85) {
      return {
        label: "Сильный результат",
        width: Math.round(avg),
      };
    }
    if (avg >= 70) {
      return {
        label: "Стабильно",
        width: Math.round(avg),
      };
    }
    return {
      label: "Нужны улучшения",
      width: Math.round(avg),
    };
  }, [summary?.avg_score_percent]);

  const worstQuestionHeatItems = useMemo(
    () =>
      worstQuestions.slice(0, 8).map((item: AuditDashboardWorstQuestion) => {
        const intensity =
          item.low_rate != null
            ? item.low_rate
            : item.answers_count > 0
              ? Math.min(100, Math.round((item.low_count / item.answers_count) * 100))
              : 0;

        const problemCount =
          item.low_count > 0
            ? `Проблема встречается в ${item.low_count} из ${item.answers_count} проверок`
            : item.answers_count > 0
              ? "Серьёзных проблем почти не встречается"
              : "Пока недостаточно данных";

        return {
          key: item.question_id,
          title: item.text || "Вопрос без текста",
          subtitle: [item.template_name || null, item.section ? `Раздел: ${item.section}` : null]
            .filter(Boolean)
            .join(" · "),
          intensity,
          problemText: problemCount,
        };
      }),
    [worstQuestions]
  );

  return (
    <AppShell title="Дашборд аудиторов">
      <div className="space-y-6">
        <GlassCard className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[color:var(--pg-text-muted)]">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  <span className="text-sm">Дашборд аудиторов</span>
                </div>
                <span className="rounded-full bg-[color:var(--pg-soft)] px-3 py-1 text-xs text-[color:var(--pg-text)]">
                  {selectedOrgLabel}
                </span>
              </div>

              <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">Аналитика по чек-листам</h1>

              <p className="mt-2 text-sm leading-6 text-[color:var(--pg-text-muted)]">
                Сводка по завершённым проверкам: результаты, проблемные зоны, последние проверки и
                динамика качества прохождения чек-листов.
              </p>

              <div className="mt-3 text-xs text-[color:var(--pg-text-muted)]">
                Показываем только доступные вам организации, локации и завершённые проверки в рамках прав доступа.
              </div>
            </div>

            <div className="flex w-full max-w-[560px] flex-col gap-3 md:self-start">
              <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-soft)] p-3">
                <div className="mb-2 text-sm text-[color:var(--pg-text-muted)]">Организация</div>
                <Select
                  value={orgFilter}
                  onValueChange={(value) => setOrgFilter(value)}
                  options={orgOptions}
                />
              </div>

              <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-soft)] p-3">
                <div className="mb-2 text-sm text-[color:var(--pg-text-muted)]">Быстрые действия</div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void refreshSummary()} disabled={loading}>
                    {loading ? "Обновляю…" : "Обновить"}
                  </Button>

                  <Button variant="secondary" onClick={() => nav("/admin/audits/history")}>
                    <History className="mr-2 h-4 w-4" />
                    История проверок
                  </Button>

                  {!isOpsDirector && (
                    <Button variant="secondary" onClick={() => nav("/admin/audits/templates")}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Шаблоны
                    </Button>
                  )}

                  {!isOpsDirector && (
                    <Button variant="secondary" onClick={() => nav("/admin/audits/import")}>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Импорт
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {err ? (
          <GlassCard className="border border-rose-400/20 bg-rose-500/10 p-4">
            <div className="flex items-start gap-3 text-rose-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>{err}</div>
            </div>
          </GlassCard>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            icon={<ClipboardList className="h-5 w-5" />}
            title="Проведено аудитов"
            value={summary?.total_runs ?? 0}
            subtitle="Все запуски в выбранной области"
          />

          <KpiCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Завершено"
            value={summary?.completed_runs ?? 0}
            subtitle="Завершённые проверки за выбранный период"
          />

          <KpiCard
            icon={<TrendingUp className="h-5 w-5" />}
            title="Средний результат"
            value={fmtPercent(summary?.avg_score_percent)}
            subtitle={`Средний балл: ${fmtScorePair(
              summary?.avg_score_sum,
              summary?.avg_score_max
            )}`}
            extra={
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-white/60">
                  <span>{scoreHealth.label}</span>
                  <span className="text-[color:var(--pg-text)]">{fmtPercent(summary?.avg_score_percent)}</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.22)]">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${scoreHealth.width}%`,
                      background: "var(--pg-gradient)",
                      backgroundSize: "160% 100%",
                      backgroundPosition: "left center",
                    }}
                  />
                </div>
              </div>
            }
          />

          <KpiCard
            icon={<FileSpreadsheet className="h-5 w-5" />}
            title="Черновики"
            value={summary?.draft_runs ?? 0}
            subtitle="В работе, ещё не завершены"
          />

          <KpiCard
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Проблемные проверки"
            value={summary?.problem_completed_runs ?? 0}
            subtitle="Завершённые проверки с низким результатом"
          />
        </div>

        {!loading && !err && !hasAnyData ? (
          <GlassCard className="p-6">
            <EmptyState text="Пока нет данных для аналитики. Завершите хотя бы одну проверку, и здесь появятся результаты, проблемные зоны и динамика." />
          </GlassCard>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionTable title="По организациям">
            {!byOrganization.length ? (
              <EmptyState text="По выбранной области пока нет завершённых проверок по организациям." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-[color:var(--pg-text)]">
                  <thead className="text-[color:var(--pg-text-muted)]">
                    <tr className="border-b border-[color:var(--pg-border)]">
                      <th className="py-2 pr-4 font-medium">Организация</th>
                      <th className="py-2 pr-4 font-medium">Завершено</th>
                      <th className="py-2 pr-4 font-medium">Средний %</th>
                      <th className="py-2 font-medium">Средний балл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byOrganization.map((item: AuditDashboardByOrganization) => (
                      <tr key={item.organization_id} className="border-b border-[color:var(--pg-border)]">
                        <td className="py-3 pr-4">{item.organization_name}</td>
                        <td className="py-3 pr-4">{item.completed_runs}</td>
                        <td className="py-3 pr-4">{fmtPercent(item.avg_score_percent)}</td>
                        <td className="py-3">
                          {fmtScorePair(item.avg_score_sum, item.avg_score_max)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionTable>

          <SectionTable title="По группам локаций">
            {!byGroup.length ? (
              <EmptyState text="По группам локаций пока недостаточно данных." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-[color:var(--pg-text)]">
                  <thead className="text-[color:var(--pg-text-muted)]">
                    <tr className="border-b border-white/10">
                      <th className="py-2 pr-4 font-medium">Группа</th>
                      <th className="py-2 pr-4 font-medium">Завершено</th>
                      <th className="py-2 pr-4 font-medium">Средний %</th>
                      <th className="py-2 font-medium">Средний балл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byGroup.map((item: AuditDashboardByGroup) => (
                      <tr key={item.group_key} className="border-b border-[color:var(--pg-border)]">
                        <td className="py-3 pr-4">{fmtGroupName(item.group_key)}</td>
                        <td className="py-3 pr-4">{item.completed_runs}</td>
                        <td className="py-3 pr-4">{fmtPercent(item.avg_score_percent)}</td>
                        <td className="py-3">
                          {fmtScorePair(item.avg_score_sum, item.avg_score_max)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionTable>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionTable title="Где чаще проходят проверки">
            <MiniBarChart items={byGroupChart} />
          </SectionTable>

          <SectionTable title="Лучшие локации">
            <PercentBars items={bestLocationBars} />
          </SectionTable>

          <SectionTable title="Рискованные локации">
            <PercentBars items={worstLocationBars} />
          </SectionTable>
        </div>

        <SectionTable title="Где чаще всего находят проблемы">
          <HeatList items={worstQuestionHeatItems} />
        </SectionTable>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TrendLineChart
            title="Динамика качества"
            subtitle="Средний процент соответствия по завершенным проверкам"
            points={trends}
          />

          <TrendBarsChart
            title="Динамика завершённых проверок"
            subtitle="Сколько завершенных проверок было в каждом периоде"
            points={trends}
          />
        </div>

        <SectionTable title="Последние завершённые проверки">
          {!recentCompleted.length ? (
            <EmptyState text="Здесь появятся последние завершенные проверки." />
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {recentCompleted.map((item: AuditDashboardRecentCompleted) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-soft)] p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[color:var(--pg-text)]">
                        {item.organization_name} · {item.location_name || item.template_name}
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--pg-text-muted)]">{item.template_name}</div>
                    </div>
                    <div
                      className="shrink-0 rounded-full px-2 py-1 text-xs font-medium"
                      style={percentSoftBadgeStyle(item.score?.score_percent ?? null)}
                    >
                      {fmtPercent(item.score?.score_percent ?? null)}
                    </div>
                  </div>

                  <div className="mb-3 text-xs text-[color:var(--pg-text-muted)]">
                    Завершён: {fmtDateTime(item.completed_at)}
                  </div>

                  <div className="mb-4 text-sm text-[color:var(--pg-text)]">
                    Балл: {fmtScorePair(item.score?.score_sum ?? null, item.score?.score_max ?? null)}
                  </div>

                  <Button variant="secondary" onClick={() => nav(`/admin/audits/runs/${item.id}`)}>
                    <Building2 className="mr-2 h-4 w-4" />
                    Открыть
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionTable>
      </div>
    </AppShell>
  );
}
