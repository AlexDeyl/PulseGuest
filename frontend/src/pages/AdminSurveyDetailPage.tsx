import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";
import { useAuth } from "../shared/auth";

type SurveyVersionRow = {
  id: number;
  version: number;
  is_active: boolean;
  created_at?: string;
};

type SurveyDetail = {
  id: number;
  location_id: number;
  name: string;
  is_archived: boolean;
  versions: SurveyVersionRow[];
};

function errToText(e: any, devEnabled: boolean) {
  const base = "Не удалось выполнить операцию. Попробуйте позже.";
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

export default function AdminSurveyDetailPage() {
  const nav = useNavigate();
  const params = useParams();
  const { enabled: devEnabled } = useDevMode();
  const { me } = useAuth();

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

  // location survey detail: редактирование версий — только admin/ops
  const canEditSurvey = isAdminLike || isOps;

  const surveyId = Number(params.surveyId || 0);

  const [data, setData] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const reload = async () => {
    if (!surveyId) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await adminJson<SurveyDetail>(`/api/admin/admin/surveys/${surveyId}`);
      setData(d);
    } catch (e: any) {
      setErr(errToText(e, devEnabled));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  const active = useMemo(() => {
    const vs = data?.versions ?? [];
    return vs.find((v) => v.is_active) || null;
  }, [data]);

  const previewPath = (versionId: number) => {
    const locId = data?.location_id;
    if (!locId) return `/admin/survey-versions/${versionId}`;
    return `/admin/locations/${locId}/surveys/${surveyId}/versions/${versionId}/preview`;
  };

  const onCreateVersion = async () => {
    if (!surveyId) return;
    if (!canEditSurvey) {
      setActionErr("Недостаточно прав: редактирование локальных опросов доступно только Admin/Ops.");
      return;
    }
    if (data?.is_archived) {
      setActionErr("Опрос в архиве — сначала верните его из архива.");
      return;
    }

    setActionLoading(true);
    setActionErr(null);
    try {
      await adminJson<{ id: number }>(`/api/admin/admin/surveys/${surveyId}/versions`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await reload();
    } catch (e: any) {
      setActionErr(errToText(e, devEnabled));
    } finally {
      setActionLoading(false);
    }
  };

  const onSetActive = async (versionId: number) => {
    if (!canEditSurvey) {
      setActionErr("Недостаточно прав: активация версий доступна только Admin/Ops.");
      return;
    }
    if (data?.is_archived) {
      setActionErr("Опрос в архиве — версии нельзя делать активными.");
      return;
    }

    setActionLoading(true);
    setActionErr(null);
    try {
      await adminJson(`/api/admin/admin/survey-versions/${versionId}/set-active`, { method: "POST" });
      await reload();
    } catch (e: any) {
      setActionErr(errToText(e, devEnabled));
    } finally {
      setActionLoading(false);
    }
  };


  if (isStatsOnly) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Доступ ограничен</div>
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
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>

              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                Опрос: {data?.name ?? "—"}
                {devEnabled ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{surveyId}</span> : null}
              </h1>

              <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                Статус:{" "}
                <span className="text-[color:var(--pg-text)]">
                  {data?.is_archived ? "В архиве" : "Активен"}
                </span>
                {devEnabled && data ? (
                  <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">
                    loc_id={data.location_id}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">

                <Button
                  variant="secondary"
                  onClick={onCreateVersion}
                  disabled={!canEditSurvey || actionLoading || loading || Boolean(data?.is_archived)}
                  title={!canEditSurvey ? "Только Admin/Ops" : undefined}
                >
                  Создать версию (копия)
                </Button>

                <Button
                  variant="secondary"
                  disabled={!active?.id}
                  onClick={() => active?.id && nav(previewPath(active.id))}
                >
                  Preview активной
                </Button>

                {devEnabled && (
                  <Button
                    variant="secondary"
                    disabled={!active?.id}
                    onClick={() => active?.id && nav(`/admin/survey-versions/${active.id}`)}
                  >
                    Редактор (Dev)
                  </Button>
                )}
              </div>

              {!canEditSurvey ? (
                <div className="mt-2 text-xs text-[color:var(--pg-faint)]">
                  Только просмотр: локальные опросы локации редактируют Admin/Ops. Для сервис-менеджера — group surveys.
                </div>
              ) : null}

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && <div className="mt-3 text-xs text-rose-300">{err}</div>}
              {actionErr && <div className="mt-3 text-xs text-rose-300">{actionErr}</div>}
            </div>

            <div className="text-sm text-[color:var(--pg-muted)]">
              Активная версия:{" "}
              <span className="text-[color:var(--pg-text)]">
                {active ? `v${active.version}` : "нет"}
                {devEnabled && active ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{active.id}</span> : null}
              </span>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Версии</h2>

          <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Версия</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Создана</th>
                  <th className="px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>

              <tbody>
                {(data?.versions ?? []).map((v) => (
                  <tr key={v.id} className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-3 font-semibold text-[color:var(--pg-text)]">
                      v{v.version}
                      {devEnabled ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{v.id}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {v.is_active ? "Активная" : "—"}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" onClick={() => nav(previewPath(v.id))}>
                          Preview
                        </Button>

                        {devEnabled && (
                          <Button variant="secondary" onClick={() => nav(`/admin/survey-versions/${v.id}`)}>
                            Редактор (Dev)
                          </Button>
                        )}

                        <Button
                          variant="secondary"
                          disabled={!canEditSurvey || actionLoading || v.is_active || Boolean(data?.is_archived)}
                          onClick={() => onSetActive(v.id)}
                          title={!canEditSurvey ? "Только Admin/Ops" : undefined}
                        >
                          Сделать активной
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && (data?.versions?.length ?? 0) === 0 && (
                  <tr className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={4}>
                      Пока нет версий.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {actionLoading && (
            <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Выполняем действие…</div>
          )}
        </GlassCard>
      </div>
    </AppShell>
  );
}
