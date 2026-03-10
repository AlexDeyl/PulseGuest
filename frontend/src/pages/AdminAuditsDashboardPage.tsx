import { useEffect, useMemo, useState } from "react";
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
  if (typeof e?.message === "string" && e.message.trim()) {
    return e.message;
  }
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
  };
  return map[raw.toLowerCase()] || raw;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]/60 px-4 py-6 text-sm text-[color:var(--pg-text-muted)]">
      {text}
    </div>
  );
}

function niceTrendText(points: AuditDashboardTrendPoint[]) {
  if (points.length < 2) return "Недостаточно данных для оценки тренда";
  const first = points[0]?.avg_score_percent ?? null;
  const last = points[points.length - 1]?.avg_score_percent ?? null;
  if (first == null || last == null) return "Тренд появится, когда накопится больше completed audits";
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
  const width = 720;
  const height = 220;
  const padX = 28;
  const padY = 24;

  const chartPoints = points.filter((p) => p.avg_score_percent != null);
  if (!chartPoints.length) {
    return <EmptyState text="Пока недостаточно completed audit runs для построения динамики результата." />;
  }

  const qualityValues = chartPoints.map((p) => Number(p.avg_score_percent ?? 0));
  const qualityMin = Math.min(...qualityValues, 0);
  const qualityMax = Math.max(...qualityValues, 100);
  const qualityRange = Math.max(1, qualityMax - qualityMin);

  const maxProblemRuns = Math.max(
    1,
    ...chartPoints.map((p) => Number(p.problem_completed_runs || 0))
  );

  const coords = chartPoints.map((p, idx) => {
    const x =
      chartPoints.length === 1
        ? width / 2
        : padX + (idx / (chartPoints.length - 1)) * (width - padX * 2);

    const qualityY =
      height -
      padY -
      ((Number(p.avg_score_percent ?? 0) - qualityMin) / qualityRange) * (height - padY * 2);

    const problemsY =
      height -
      padY -
      (Number(p.problem_completed_runs || 0) / maxProblemRuns) * (height - padY * 2);

    return {
      ...p,
      x,
      qualityY,
      problemsY,
    };
  });

  const qualityPath = coords
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.qualityY}`)
    .join(" ");

  const problemsPath = coords
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.problemsY}`)
    .join(" ");

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--pg-text)]">{title}</h3>
          <p className="mt-1 text-sm text-[color:var(--pg-text-muted)]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs text-[color:var(--pg-text-muted)]">
            {points[0]?.bucket === "week" ? "По неделям" : "По дням"}
          </div>
          <div className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs text-[color:var(--pg-text-muted)]">
            Толстая линия — средний результат
          </div>
          <div className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs text-[color:var(--pg-text-muted)]">
            Тонкая линия — проблемные проверки
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] min-w-[720px] w-full">
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="currentColor" opacity="0.12" />
          <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="currentColor" opacity="0.08" />

          <path d={problemsPath} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" strokeDasharray="4 4" />
          <path d={qualityPath} fill="none" stroke="currentColor" strokeWidth="3" opacity="0.9" />

          {coords.map((p) => (
            <g key={p.period_key}>
              <circle cx={p.x} cy={p.qualityY} r="4.5" fill="currentColor" />
              <circle cx={p.x} cy={p.problemsY} r="2.5" fill="currentColor" opacity="0.45" />

              <text x={p.x} y={height - 6} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.7">
                {p.label}
              </text>

              <text x={p.x} y={p.qualityY - 10} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.8">
                {Math.round(Number(p.avg_score_percent ?? 0))}%
              </text>

              {Number(p.problem_completed_runs || 0) > 0 ? (
                <text x={p.x} y={p.problemsY + 14} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.55">
                  {p.problem_completed_runs}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 text-xs text-[color:var(--pg-text-muted)]">
        Цифры возле тонкой линии показывают количество проблемных завершенных проверок в периоде.
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
    return <EmptyState text="Пока недостаточно завершенных проверок для построения динамики." />;
  }

  const max = Math.max(1, ...points.map((p) => Number(p.completed_runs || 0)));

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--pg-text)]">{title}</h3>
          <p className="mt-1 text-sm text-[color:var(--pg-text-muted)]">{subtitle}</p>
        </div>
        <div className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs text-[color:var(--pg-text-muted)]">
          {points[0]?.bucket === "week" ? "По неделям" : "По дням"}
        </div>
      </div>

      <div className="flex h-[220px] items-end gap-3 overflow-x-auto">
        {points.map((p) => {
          const height = Math.max(10, Math.round((Number(p.completed_runs || 0) / max) * 170));
          return (
            <div key={p.period_key} className="flex min-w-[56px] flex-col items-center gap-2">
              <div className="text-xs text-[color:var(--pg-text-muted)]">{p.completed_runs}</div>
              <div
                className="w-10 rounded-t-2xl bg-[color:var(--pg-accent)]/85 transition-all"
                style={{ height }}
                title={`${p.label}: ${p.completed_runs}`}
              />
              <div className="text-center text-[11px] leading-tight text-[color:var(--pg-text-muted)]">
                {p.label}
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function MiniBarChart({
  items,
}: {
  items: { label: string; value: number; sublabel?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const width = Math.max(6, Math.round((item.value / max) * 100));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate text-[color:var(--pg-text)]">{item.label}</div>
                {item.sublabel ? (
                  <div className="truncate text-xs text-[color:var(--pg-text-muted)]">
                    {item.sublabel}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 font-medium text-[color:var(--pg-text)]">
                {item.value}
              </div>
            </div>
            <div className="h-2.5 rounded-full bg-[color:var(--pg-border)]/50">
              <div
                className="h-2.5 rounded-full bg-[color:var(--pg-accent)] transition-all"
                style={{ width: `${width}%` }}
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
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const safe = Math.max(0, Math.min(100, Math.round(item.value ?? 0)));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate text-[color:var(--pg-text)]">{item.label}</div>
                {item.sublabel ? (
                  <div className="truncate text-xs text-[color:var(--pg-text-muted)]">
                    {item.sublabel}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 font-medium text-[color:var(--pg-text)]">
                {item.value == null ? "—" : `${safe}%`}
              </div>
            </div>
            <div className="h-2.5 rounded-full bg-[color:var(--pg-border)]/50">
              <div
                className="h-2.5 rounded-full bg-[color:var(--pg-accent)] transition-all"
                style={{ width: `${safe}%` }}
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
    return {
      label: "Риск высокий",
      hint: "Пункт часто проваливается",
    };
  }
  if (safe >= 40) {
    return {
      label: "Риск средний",
      hint: "Проблема встречается регулярно",
    };
  }
  return {
    label: "Риск низкий",
    hint: "Проблема встречается редко",
  };
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
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const safe = Math.max(0, Math.min(100, Math.round(item.intensity ?? 0)));
        const level = problemLevel(item.intensity);

        return (
          <div
            key={item.key}
            className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]/80 p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="line-clamp-2 font-medium text-[color:var(--pg-text)]">
                  {item.title}
                </div>
                {item.subtitle ? (
                  <div className="mt-1 text-sm text-[color:var(--pg-text-muted)]">
                    {item.subtitle}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-sm font-semibold text-[color:var(--pg-text)]">
                {safe}%
              </div>
            </div>

            <div className="mb-2 h-3 overflow-hidden rounded-full bg-[color:var(--pg-border)]/50">
              <div
                className="h-3 rounded-full bg-[color:var(--pg-accent)] transition-all"
                style={{ width: `${safe}%` }}
              />
            </div>

            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium text-[color:var(--pg-text)]">
                {level.label}
              </div>
              <div className="text-sm text-[color:var(--pg-text-muted)]">
                {item.problemText || level.hint}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionTable({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[color:var(--pg-text)]">
          {title}
        </h3>
      </div>
      {children}
    </GlassCard>
  );
}

export default function AdminAuditsDashboardPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const allowedLocations: LocShort[] = (me?.allowed_locations ?? []) as any;

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgFilter, setOrgFilter] = useState(
    () => localStorage.getItem("pg_audit_dashboard_org_id") || "all"
  );
  const [summary, setSummary] = useState<AuditDashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const xs = await adminJson<Org[]>("/api/admin/admin/organizations");
        if (!alive) return;

        const filtered = devEnabled ? xs : xs.filter((o) => o.is_active);

        if ((me as any)?.is_global) {
          setOrgs(filtered);
          return;
        }

        const allowedOrgIds = new Set(
          allowedLocations
            .map((l) => Number(l.organization_id))
            .filter((x) => Number.isFinite(x))
        );

        setOrgs(filtered.filter((o) => allowedOrgIds.has(Number(o.id))));
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

      setSummary(
        data
          ? {
              ...data,
              by_organization: Array.isArray(data.by_organization)
                ? data.by_organization
                : [],
              by_group: Array.isArray(data.by_group) ? data.by_group : [],
              best_locations: Array.isArray(data.best_locations)
                ? data.best_locations
                : [],
              worst_locations: Array.isArray(data.worst_locations)
                ? data.worst_locations
                : [],
              worst_questions: Array.isArray(data.worst_questions)
                ? data.worst_questions
                : [],
              recent_completed: Array.isArray(data.recent_completed)
                ? data.recent_completed
                : [],
              trends: Array.isArray((data as any).trends)
                ? (data as any).trends
                : [],
            }
          : null
      );
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

  const hasAnyData = useMemo(() => {
    if (!summary) return false;

    const byOrganization = Array.isArray(summary.by_organization)
      ? summary.by_organization
      : [];
    const byGroup = Array.isArray(summary.by_group) ? summary.by_group : [];
    const recentCompleted = Array.isArray(summary.recent_completed)
      ? summary.recent_completed
      : [];
    const trends = Array.isArray((summary as any).trends)
      ? (summary as any).trends
      : [];

    return (
      Number(summary.total_runs || 0) > 0 ||
      byOrganization.length > 0 ||
      byGroup.length > 0 ||
      recentCompleted.length > 0 ||
      trends.length > 0
    );
  }, [summary]);

  const byOrganization = Array.isArray(summary?.by_organization)
    ? summary!.by_organization
    : [];
  const byGroup = Array.isArray(summary?.by_group) ? summary!.by_group : [];
  const bestLocations = Array.isArray(summary?.best_locations)
    ? summary!.best_locations
    : [];
  const worstLocations = Array.isArray(summary?.worst_locations)
    ? summary!.worst_locations
    : [];
  const worstQuestions = Array.isArray(summary?.worst_questions)
    ? summary!.worst_questions
    : [];
  const recentCompleted = Array.isArray(summary?.recent_completed)
    ? summary!.recent_completed
    : [];
  const trends = Array.isArray(summary?.trends) ? summary!.trends : [];

  const byGroupChart = useMemo(
    () =>
      byGroup
        .slice(0, 6)
        .map((item: AuditDashboardByGroup) => ({
          label: fmtGroupName(item.group_key),
          value: item.completed_runs,
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
        label: item.location_name,
        value: item.avg_score_percent,
        sublabel: `${item.organization_name} · Проверок: ${item.completed_runs}`,
      })),
    [bestLocations]
  );

  const worstLocationBars = useMemo(
    () =>
      worstLocations.slice(0, 5).map((item: AuditDashboardLocation) => ({
        label: item.location_name,
        value: item.avg_score_percent,
        sublabel: `${item.organization_name} · Проверок: ${item.completed_runs}`,
      })),
    [worstLocations]
  );

  const scoreHealth = useMemo(() => {
    const avg = summary?.avg_score_percent;
    if (avg == null) return { label: "Нет данных", width: 0 };
    if (avg >= 85) return { label: "Сильный результат", width: Math.round(avg) };
    if (avg >= 70) return { label: "Стабильно", width: Math.round(avg) };
    return { label: "Нужны улучшения", width: Math.round(avg) };
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
          subtitle: [
            item.template_name || null,
            item.section ? `Раздел: ${item.section}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          intensity,
          problemText: problemCount,
        };
      }),
    [worstQuestions]
  );

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <GlassCard className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs font-medium text-[color:var(--pg-text-muted)]">
                <BarChart3 className="h-4 w-4" />
                Дашборд аудиторов
              </div>
              <h1 className="text-2xl font-semibold text-[color:var(--pg-text)] sm:text-3xl">
                Аналитика по чек-листам
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--pg-text-muted)] sm:text-base">
                Сводка по завершенным проверкам: результаты, проблемные зоны,
                последние проверки и качество прохождения чек-листов.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:max-w-xl lg:justify-end">
              <div className="min-w-[260px]">
                <div className="mb-1 flex items-center gap-2 text-sm text-[color:var(--pg-text-muted)]">
                    <Building2 className="h-4 w-4" />
                    Организация
                  </div>
                  <Select
                    value={orgFilter}
                    onValueChange={setOrgFilter}
                    options={orgOptions}
                    placeholder="Все доступные организации"
                  />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void refreshSummary()} disabled={loading}>
                  {loading ? "Обновляю…" : "Обновить"}
                </Button>
                <Button variant="secondary" onClick={() => nav("/admin/audits/import")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Импорт
                </Button>
                <Button variant="secondary" onClick={() => nav("/admin/audits/history")}>
                  <History className="mr-2 h-4 w-4" />
                  История
                </Button>
                <Button variant="secondary" onClick={() => nav("/admin/audits/templates")}>
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Шаблоны
                </Button>
              </div>
            </div>
          </div>
        </GlassCard>

        {err && (
          <GlassCard className="border-[color:var(--pg-danger-border)] bg-[color:var(--pg-danger-bg)] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[color:var(--pg-danger-text)]" />
              <div className="text-sm text-[color:var(--pg-danger-text)]">{err}</div>
            </div>
          </GlassCard>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <GlassCard className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm text-[color:var(--pg-text-muted)]">
              <ClipboardList className="h-4 w-4" />
              Проведено аудитов
            </div>
            <div className="text-3xl font-semibold text-[color:var(--pg-text)]">
              {summary?.total_runs ?? 0}
            </div>
            <div className="mt-2 text-xs text-[color:var(--pg-text-muted)]">
              Все запуски в выбранной области
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm text-[color:var(--pg-text-muted)]">
              <CheckCircle2 className="h-4 w-4" />
              Завершено
            </div>
            <div className="text-3xl font-semibold text-[color:var(--pg-text)]">
              {summary?.completed_runs ?? 0}
            </div>
            <div className="mt-2 text-xs text-[color:var(--pg-text-muted)]">
              Завершенные проверки за выбранный период
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm text-[color:var(--pg-text-muted)]">
              <TrendingUp className="h-4 w-4" />
              Средний результат
            </div>
            <div className="text-3xl font-semibold text-[color:var(--pg-text)]">
              {fmtPercent(summary?.avg_score_percent)}
            </div>
            <div className="mt-2 text-xs text-[color:var(--pg-text-muted)]">
              Средний балл: {fmtScorePair(summary?.avg_score_sum, summary?.avg_score_max)}
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-[color:var(--pg-text-muted)]">
                <span>{scoreHealth.label}</span>
                <span>{fmtPercent(summary?.avg_score_percent)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-[color:var(--pg-border)]/50">
                <div
                  className="h-2.5 rounded-full bg-[color:var(--pg-accent)] transition-all"
                  style={{ width: `${scoreHealth.width}%` }}
                />
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm text-[color:var(--pg-text-muted)]">
              <History className="h-4 w-4" />
              Черновики
            </div>
            <div className="text-3xl font-semibold text-[color:var(--pg-text)]">
              {summary?.draft_runs ?? 0}
            </div>
            <div className="mt-2 text-xs text-[color:var(--pg-text-muted)]">
              В работе, ещё не завершены
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm text-[color:var(--pg-text-muted)]">
              <AlertTriangle className="h-4 w-4" />
              Проблемные проверки
            </div>
            <div className="text-3xl font-semibold text-[color:var(--pg-text)]">
              {summary?.problem_completed_runs ?? 0}
            </div>
            <div className="mt-2 text-xs text-[color:var(--pg-text-muted)]">
              Завершенные проверки с низким результатом
            </div>
          </GlassCard>
        </div>

        {!loading && !err && !hasAnyData && (
          <GlassCard className="p-6">
            <EmptyState text="Пока недостаточно данных для аналитики. Когда появятся завершенные проверки, здесь отобразятся результаты, динамика по времени, проблемные зоны и последние проверки." />
          </GlassCard>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TrendLineChart
            title="Динамика результата"
            subtitle={niceTrendText(trends)}
            points={trends}
          />
          <TrendBarsChart
            title="Завершённые аудиты по периодам"
            subtitle="Показывает активность завершенных проверок за тот же период."
            points={trends}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionTable title="По организациям">
            {!byOrganization.length ? (
              <EmptyState text="Пока нет завершенных проверок по организациям." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--pg-border)] text-left text-[color:var(--pg-text-muted)]">
                      <th className="py-3 pr-4 font-medium">Организация</th>
                      <th className="py-3 pr-4 font-medium">Завершено</th>
                      <th className="py-3 pr-4 font-medium">Средний %</th>
                      <th className="py-3 font-medium">Средний балл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byOrganization.map((item: AuditDashboardByOrganization) => (
                      <tr
                        key={item.organization_id}
                        className="border-b border-[color:var(--pg-border)]/70 last:border-b-0"
                      >
                        <td className="py-3 pr-4 text-[color:var(--pg-text)]">
                          {item.organization_name}
                        </td>
                        <td className="py-3 pr-4 text-[color:var(--pg-text)]">
                          {item.completed_runs}
                        </td>
                        <td className="py-3 pr-4 text-[color:var(--pg-text)]">
                          {fmtPercent(item.avg_score_percent)}
                        </td>
                        <td className="py-3 text-[color:var(--pg-text)]">
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
              <EmptyState text="Пока нет данных по группам локаций." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--pg-border)] text-left text-[color:var(--pg-text-muted)]">
                      <th className="py-3 pr-4 font-medium">Группа</th>
                      <th className="py-3 pr-4 font-medium">Завершено</th>
                      <th className="py-3 pr-4 font-medium">Средний %</th>
                      <th className="py-3 font-medium">Средний балл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byGroup.map((item: AuditDashboardByGroup) => (
                      <tr
                        key={item.group_key}
                        className="border-b border-[color:var(--pg-border)]/70 last:border-b-0"
                      >
                        <td className="py-3 pr-4 text-[color:var(--pg-text)]">
                          {fmtGroupName(item.group_key)}
                        </td>
                        <td className="py-3 pr-4 text-[color:var(--pg-text)]">
                          {item.completed_runs}
                        </td>
                        <td className="py-3 pr-4 text-[color:var(--pg-text)]">
                          {fmtPercent(item.avg_score_percent)}
                        </td>
                        <td className="py-3 text-[color:var(--pg-text)]">
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

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <SectionTable title="Распределение по группам">
            {!byGroupChart.length ? (
              <EmptyState text="Пока нет данных по completed audit runs в группах локаций." />
            ) : (
              <MiniBarChart items={byGroupChart} />
            )}
          </SectionTable>

          <SectionTable title="Лучшие локации">
            {!bestLocations.length ? (
              <EmptyState text="Пока нет достаточных данных, чтобы показать лучшие локации." />
            ) : (
              <PercentBars items={bestLocationBars} />
            )}
          </SectionTable>

          <SectionTable title="Локации с риском">
            {!worstLocations.length ? (
              <EmptyState text="Пока нет достаточных данных, чтобы показать проблемные локации." />
            ) : (
              <PercentBars items={worstLocationBars} />
            )}
          </SectionTable>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionTable title="Где чаще всего находят проблемы">
            {!worstQuestionHeatItems.length ? (
              <EmptyState text="Пока нет данных по проблемным вопросам." />
            ) : (
              <HeatList items={worstQuestionHeatItems} />
            )}
          </SectionTable>

          <SectionTable title="Последние завершённые аудиты">
            {!recentCompleted.length ? (
              <EmptyState text="Пока нет завершённых аудитов." />
            ) : (
              <div className="space-y-3">
                {recentCompleted.map((item: AuditDashboardRecentCompleted) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[color:var(--pg-border)] px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[color:var(--pg-text)]">
                          {item.organization_name}
                          {" · "}
                          {item.location_name || item.template_name}
                        </div>
                        <div className="mt-1 text-sm text-[color:var(--pg-text-muted)]">
                          {item.template_name}
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--pg-text-muted)]">
                          Завершён: {fmtDateTime(item.completed_at)}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-semibold text-[color:var(--pg-text)]">
                            {fmtPercent(item.score?.score_percent ?? null)}
                          </div>
                          <div className="mt-1 text-xs text-[color:var(--pg-text-muted)]">
                            {fmtScorePair(item.score?.score_sum ?? null, item.score?.score_max ?? null)}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          onClick={() => nav(`/admin/audits/runs/${item.id}`)}
                        >
                          Открыть
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionTable>
        </div>
      </div>
    </AppShell>
  );
}
