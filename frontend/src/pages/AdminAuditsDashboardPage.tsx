import { useEffect, useMemo, useState } from "react";
import { BarChart3, ClipboardList, FileSpreadsheet, History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson } from "../shared/adminApi";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";
import type { ChecklistRunListItem } from "../shared/auditApi";
import { listChecklistRuns } from "../shared/auditApi";

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

type FlatRun = ChecklistRunListItem & {
  organization_name: string;
};

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Не удалось загрузить статистику аудитов. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;
  if (typeof e?.detail?.message === "string") return e.detail.message;
  if (devEnabled) {
    try {
      const detail = JSON.stringify(e?.detail ?? e, null, 2);
      return detail ? `Не удалось загрузить статистику аудитов. ${detail}` : "Не удалось загрузить статистику аудитов.";
    } catch {
      return "Не удалось загрузить статистику аудитов.";
    }
  }
  return "Не удалось загрузить статистику аудитов. Обновите страницу и попробуйте снова.";
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

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function avgDraftProgress(runs: FlatRun[]) {
  const drafts = runs.filter((r) => r.status === "draft" && Number(r.total_questions) > 0);
  if (!drafts.length) return 0;
  const avg =
    drafts.reduce((acc, r) => acc + (Number(r.answered_count) / Number(r.total_questions)) * 100, 0) / drafts.length;
  return Math.round(avg);
}

function sortByRecentDesc(a: FlatRun, b: FlatRun) {
  const ad = asDate(a.completed_at || a.created_at)?.getTime() ?? 0;
  const bd = asDate(b.completed_at || b.created_at)?.getTime() ?? 0;
  return bd - ad;
}

function countCreatedWithinDays(runs: FlatRun[], days: number) {
  const now = Date.now();
  const ms = days * 24 * 60 * 60 * 1000;
  return runs.filter((r) => {
    const t = asDate(r.created_at)?.getTime();
    return typeof t === "number" && now - t <= ms;
  }).length;
}

export default function AdminAuditsDashboardPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const allowedLocations: LocShort[] = (me?.allowed_locations ?? []) as any;

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>(() => localStorage.getItem("pg_audit_dashboard_org_id") || "all");

  const [runs, setRuns] = useState<FlatRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const xs = await adminJson<Org[]>("/api/admin/admin/organizations");
        if (!alive) return;

        const filtered = devEnabled ? xs : xs.filter((o) => o.is_active);

        if (me?.is_global) {
          setOrgs(filtered);
          return;
        }

        const allowedOrgIds = new Set(
          allowedLocations.map((l) => Number(l.organization_id)).filter((x) => Number.isFinite(x))
        );

        setOrgs(filtered.filter((o) => allowedOrgIds.has(Number(o.id))));
      } catch {
        const ids = Array.from(
          new Set(allowedLocations.map((l) => Number(l.organization_id)).filter((x) => Number.isFinite(x)))
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
  }, [allowedLocations, devEnabled, me?.is_global]);

  useEffect(() => {
    const allowedValues = new Set(["all", ...orgs.map((o) => String(o.id))]);
    if (!allowedValues.has(orgFilter)) {
      setOrgFilter("all");
    }
  }, [orgs, orgFilter]);

  useEffect(() => {
    localStorage.setItem("pg_audit_dashboard_org_id", orgFilter);
  }, [orgFilter]);

  const refreshStats = async () => {
    setLoading(true);
    setErr(null);

    try {
      const targetOrgs = orgs;
      const results = await Promise.allSettled(
        targetOrgs.map(async (org) => {
          const rr = await listChecklistRuns(org.id);
          return (rr ?? []).map((r) => ({
            ...r,
            organization_name: org.name,
          }));
        })
      );

      const nextRuns: FlatRun[] = [];
      const failures: any[] = [];

      for (const res of results) {
        if (res.status === "fulfilled") nextRuns.push(...res.value);
        else failures.push(res.reason);
      }

      setRuns(nextRuns);

      if (failures.length === results.length && failures.length > 0) {
        setErr(errToText(failures[0], devEnabled));
      } else if (failures.length > 0) {
        setErr(`Не все организации удалось загрузить (${failures.length}). Остальная статистика показана.`);
      }
    } catch (e) {
      setRuns([]);
      setErr(errToText(e, devEnabled));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orgs.length) {
      setRuns([]);
      return;
    }
    void refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs]);

  const orgOptions = useMemo(
    () => [{ value: "all", label: "Все доступные организации" }, ...orgs.map((o) => ({ value: String(o.id), label: o.name }))],
    [orgs]
  );

  const filteredRuns = useMemo(() => {
    if (orgFilter === "all") return runs;
    return runs.filter((r) => String(r.organization_id) === orgFilter);
  }, [runs, orgFilter]);

  const created7 = useMemo(() => countCreatedWithinDays(filteredRuns, 7), [filteredRuns]);
  const created30 = useMemo(() => countCreatedWithinDays(filteredRuns, 30), [filteredRuns]);

  const completedCount = useMemo(
    () => filteredRuns.filter((r) => r.status === "completed").length,
    [filteredRuns]
  );

  const draftCount = useMemo(
    () => filteredRuns.filter((r) => r.status === "draft").length,
    [filteredRuns]
  );

  const avgDraftFill = useMemo(() => avgDraftProgress(filteredRuns), [filteredRuns]);

  const topOrganizations = useMemo(() => {
    const map = new Map<string, { name: string; completed: number }>();

    for (const r of filteredRuns) {
      const key = String(r.organization_id);
      if (!map.has(key)) {
        map.set(key, { name: r.organization_name, completed: 0 });
      }
      if (r.status === "completed") {
        map.get(key)!.completed += 1;
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name))
      .slice(0, 5);
  }, [filteredRuns]);

  const latestRuns = useMemo(() => {
    return [...filteredRuns].sort(sortByRecentDesc).slice(0, 5);
  }, [filteredRuns]);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-2xl font-semibold text-[color:var(--pg-text)]">
            <BarChart3 className="h-6 w-6" />
            <span>Дашборд аудиторов</span>
          </div>
          <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
            Краткая сводка по чек-листам, прогрессу и завершённым аудитам.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void refreshStats()} disabled={loading}>
            {loading ? "Обновляю…" : "Обновить"}
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
        <GlassCard className="p-5">
          <div className="text-xs text-[color:var(--pg-muted)]">Организация</div>
          <div className="mt-2">
            <Select
              value={orgFilter}
              onValueChange={setOrgFilter}
              options={orgOptions}
              placeholder="Выберите организацию…"
            />
          </div>
        </GlassCard>

        <div className="grid gap-4 md:grid-cols-3">
          <GlassCard className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <FileSpreadsheet className="h-5 w-5 text-[color:var(--pg-text)]" />
              </div>
              <div>
                <div className="text-base font-semibold text-[color:var(--pg-text)]">Импортировать шаблон</div>
                <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
                  Загрузить Excel-шаблон чек-листа
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => nav("/admin/audits/import")}>Открыть импорт</Button>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <History className="h-5 w-5 text-[color:var(--pg-text)]" />
              </div>
              <div>
                <div className="text-base font-semibold text-[color:var(--pg-text)]">Заполненные чек-листы</div>
                <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
                  Просмотр завершенных и продолжение не заполненых
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => nav("/admin/audits/history")}>Открыть историю</Button>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <ClipboardList className="h-5 w-5 text-[color:var(--pg-text)]" />
              </div>
              <div>
                <div className="text-base font-semibold text-[color:var(--pg-text)]">Заполнить чек-лист</div>
                <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
                  Выбрать шаблон и начать нновую проверку
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => nav("/admin/audits/templates")}>К шаблонам</Button>
            </div>
          </GlassCard>
        </div>
      </div>

      {err && (
        <GlassCard className="mb-6">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {err}
          </div>
        </GlassCard>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlassCard className="p-5">
          <div className="text-xs text-[color:var(--pg-muted)]">Проверок за 7 дней</div>
          <div className="mt-2 text-3xl font-semibold text-[color:var(--pg-text)]">{created7}</div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-xs text-[color:var(--pg-muted)]">Проверок за 30 дней</div>
          <div className="mt-2 text-3xl font-semibold text-[color:var(--pg-text)]">{created30}</div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-xs text-[color:var(--pg-muted)]">Завершено / в черновике</div>
          <div className="mt-2 text-3xl font-semibold text-[color:var(--pg-text)]">
            {completedCount} / {draftCount}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-xs text-[color:var(--pg-muted)]">Среднее заполнение черновиков</div>
          <div className="mt-2 text-3xl font-semibold text-[color:var(--pg-text)]">{percent(avgDraftFill)}</div>
        </GlassCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
        <GlassCard className="p-5">
          <div className="text-lg font-semibold text-[color:var(--pg-text)]">Топ организаций по завершенным проверкам</div>
          <div className="mt-4 space-y-3">
            {!topOrganizations.length && (
              <div className="text-sm text-[color:var(--pg-muted)]">Пока нет завершённых чек-листов.</div>
            )}

            {topOrganizations.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                className="flex items-center justify-between rounded-xl border border-white/10 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-[color:var(--pg-text)]">{item.name}</div>
                </div>
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">{item.completed}</div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="text-lg font-semibold text-[color:var(--pg-text)]">Последние 5 проверок</div>
          <div className="mt-4 space-y-3">
            {!latestRuns.length && (
              <div className="text-sm text-[color:var(--pg-muted)]">Пока нет проверок.</div>
            )}

            {latestRuns.map((r) => {
              const progress =
                Number(r.total_questions) > 0
                  ? `${r.answered_count}/${r.total_questions}`
                  : "0/0";

              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[color:var(--pg-text)]">
                      {r.organization_name} · {r.location_name || r.template_name}
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                      {r.status === "completed" ? "Завершён" : "Черновик"} · {fmtDateTime(r.completed_at || r.created_at)} · Прогресс: {progress}
                    </div>
                  </div>

                  <Button variant="secondary" onClick={() => nav(`/admin/audits/runs/${r.id}`)}>
                    Открыть
                  </Button>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
