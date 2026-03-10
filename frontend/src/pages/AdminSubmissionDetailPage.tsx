import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";
import { useAuth } from "../shared/auth";
import { humanizeAnswers, humanKindLabel, type HumanFieldRow } from "../shared/humanizeAnswers";

type GuestContext = {
  stay_id?: number | string | null;
  guest_name?: string | null;
  room?: string | null;
  checkin_at?: string | null;
  checkout_at?: string | null;
  reservation_code?: string | null;
  stay_source?: string | null;
};

type SubmissionDetail = {
  id: number;
  location_id: number;
  survey_version_id: number;
  created_at: string;
  dev_mode?: boolean;
  answers?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;

  extra_fields?: Array<{
    key: string;
    label: string;
    kind: string;
    value_text: string;
    raw_value?: unknown;
  }>;
  phone?: string;

  rating_overall?: number | string | null;
  comment?: string;
  name?: string;
  email?: string;

  guest_context?: GuestContext | null;

  // PATCH D: комментарий сервис-менеджера / принятые меры
  service_action_comment?: string;
  service_action_updated_at?: string | null;
  service_action_updated_by?: number | null;
  service_action_updated_by_name?: string | null;
};

type SurveyVersionResp = {
  id: number;
  schema: any;
};

function errToText(e: any, devEnabled: boolean) {
  const base = "Не удалось загрузить отзыв. Попробуйте позже.";
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

const ANSWER_LABELS: Record<string, string> = {
  phone: "Телефон",
  comment: "Комментарий",
  email: "Email",
  name: "Имя",
  rating_overall: "Общая оценка",
};

function prettifyAnswerKey(key: string) {
  if (ANSWER_LABELS[key]) return ANSWER_LABELS[key];

  if (key.endsWith("__other_text")) return "Свой вариант ответа";
  if (key.startsWith("choice_")) return "Выбранный вариант";
  if (key.startsWith("comment_")) return "Комментарий к вопросу";
  if (key.startsWith("text_")) return "Текстовый ответ";
  if (key.startsWith("rating_")) return "Оценка";

  const cleaned = key
    .replace(/__other_text$/i, "")
    .replace(/_[0-9]{6,}_[a-z0-9]+$/i, "")
    .replace(/_/g, " ")
    .trim();

  if (/[А-Яа-яЁё]/.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return "Дополнительный вопрос";
}

function formatAnswerValue(value: unknown, devEnabled: boolean) {
  if (value == null) return "—";
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return devEnabled ? JSON.stringify(value, null, 2) : `Заполнено (${value.length})`;
  }

  if (typeof value === "object") {
    return devEnabled ? JSON.stringify(value, null, 2) : "Заполнено";
  }

  return "—";
}

function coerceComment(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();

  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x.trim() : String(x)))
      .filter((x) => x.length > 0)
      .join(", ")
      .trim();
  }

  return String(v).trim();
}

export default function AdminSubmissionDetailPage() {
  const nav = useNavigate();
  const params = useParams();
  const { enabled: devEnabled } = useDevMode();
  const { me } = useAuth();

  const roleValues = Array.isArray(me?.roles) ? (me as any).roles.map((r: any) => r?.role) : [];
  const isAdmin = roleValues.includes("admin");
  const isOps = roleValues.includes("ops_director") || roleValues.includes("manager");
  const isService = roleValues.includes("service_manager");
  const isAuditor = roleValues.includes("auditor") || roleValues.includes("auditor_global");
  const isDirectorLike = roleValues.includes("director") || roleValues.includes("super_admin");
  const isAdminLike = isAdmin || isDirectorLike;

  const canViewSubmissions = isAdminLike || isOps || isService || isAuditor;

  const canEditActionComment = isAdmin || roleValues.includes("ops_director") || isService;

  if (!canViewSubmissions) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Доступ ограничен</div>
          <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
            Просмотр отзывов доступен только для ролей: <b>Администратор</b>, <b>Операционный директор</b>,
            <b>Сервис-менеджер</b>, <b>Аудитор</b>.
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => nav("/admin")}>На дашборд</Button>
          </div>
        </GlassCard>
      </AppShell>
    );
  }

  const id = Number(params.id || 0);

  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // PATCH D: "Принятые меры" editor
  const [actionText, setActionText] = useState<string>("");
  const [actionSaving, setActionSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const [svSchema, setSvSchema] = useState<any | null>(null);
  const [svLoading, setSvLoading] = useState(false);
  const [svErr, setSvErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setErr(null);

    const url = devEnabled
      ? `/api/admin/admin/submissions/${id}?dev=1`
      : `/api/admin/admin/submissions/${id}`;

    adminJson<SubmissionDetail>(url)
      .then(setData)
      .catch((e: any) => {
        setErr(errToText(e, devEnabled));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [id, devEnabled]);

  // Load schema for the specific survey_version of this submission.
  useEffect(() => {
    const verId = data?.survey_version_id;
    if (!verId) {
      setSvSchema(null);
      setSvErr(null);
      setSvLoading(false);
      return;
    }

    let cancelled = false;
    setSvLoading(true);
    setSvErr(null);

    adminJson<SurveyVersionResp>(`/api/admin/admin/survey-versions/${verId}`)
      .then((resp) => {
        if (cancelled) return;
        setSvSchema(resp?.schema ?? null);
      })
      .catch((e: any) => {
        if (cancelled) return;
        // Не блокируем просмотр отзыва: просто падаем в raw-view.
        setSvSchema(null);
        setSvErr(devEnabled ? `Schema load: ${e?.status ?? "?"}` : null);
      })
      .finally(() => {
        if (!cancelled) setSvLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data?.survey_version_id, devEnabled]);

  const guest = useMemo<GuestContext | null>(() => {
    if (!data) return null;
    if (data.guest_context) return data.guest_context;

    const m = data.meta || {};
    const any =
      (m as any).stay_id ||
      (m as any).guest_name ||
      (m as any).room ||
      (m as any).checkin_at ||
      (m as any).checkout_at ||
      (m as any).reservation_code;

    if (!any) return null;

    return {
      stay_id: (m as any).stay_id,
      guest_name: (m as any).guest_name,
      room: (m as any).room,
      checkin_at: (m as any).checkin_at,
      checkout_at: (m as any).checkout_at,
      reservation_code: (m as any).reservation_code,
      stay_source: (m as any).stay_source,
    };
  }, [data]);

  const extraAnswers = useMemo(() => {
    const a = data?.answers ?? {};
    return Object.entries(a).filter(([k, v]) => v != null && !["comment", "name", "email", "rating_overall"].includes(k));
  }, [data]);

  const humanExtraRows = useMemo<HumanFieldRow[] | null>(() => {
    // 1) В non-dev режиме backend отдаёт готовые человеко-читаемые строки (extra_fields)
    const serverRows = Array.isArray(data?.extra_fields) ? data!.extra_fields! : null;
    if (serverRows && serverRows.length) {
      return serverRows
        .filter((r: any) => String(r?.value_text ?? "").trim().length > 0)
        .map((r: any, idx: number) => ({
          key: String(r.key || `row_${idx}`),
          label: String(r.label || r.key || `Поле ${idx + 1}`),
          kind: (r.kind as any) || "unknown",
          valueText: String(r.value_text ?? ""),
          rawValue: r.raw_value,
        }));
    }

    // 2) Dev-mode fallback: используем raw answers + schema (как было раньше)
    if (!data?.answers) return null;
    if (!svSchema) return null;

    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.answers)) {
      if (v == null) continue;
      if (["comment", "name", "email", "rating_overall"].includes(k)) continue;
      filtered[k] = v;
    }

    return humanizeAnswers(svSchema, filtered, { dev: devEnabled, hideUnknown: !devEnabled });
  }, [data?.answers, data?.extra_fields, svSchema, devEnabled]);

  const phone = useMemo(() => {
    // non-dev: backend отдаёт phone отдельно (чтобы не тянуть raw answers)
    if (typeof data?.phone === "string" && data.phone.trim()) return data.phone.trim();

    // dev fallback: достаём из answers (как было раньше)
    const a = (data?.answers ?? {}) as any;
    const p = a?.phone ?? a?.tel ?? a?.telephone;
    return typeof p === "string" || typeof p === "number" ? String(p) : "";
  }, [data]);

  // PATCH D: sync textarea from loaded submission
  useEffect(() => {
    setActionText(String(data?.service_action_comment ?? ""));
    setActionMsg(null);
    setActionErr(null);
  }, [data?.id, data?.service_action_comment]);

    async function saveActionComment() {
    if (!id) return;
    setActionSaving(true);
    setActionMsg(null);
    setActionErr(null);

    try {
      const resp = await adminJson<{
        ok: boolean;
        id: number;
        service_action_comment: string;
        service_action_updated_at: string | null;
        service_action_updated_by: number | null;
        service_action_updated_by_name: string | null;
      }>(`/api/admin/admin/submissions/${id}/action-comment`, {
        method: "PATCH",
        body: JSON.stringify({ service_action_comment: actionText }),
      });

      setData((prev) =>
        prev
          ? {
              ...prev,
              service_action_comment: resp.service_action_comment,
              service_action_updated_at: resp.service_action_updated_at,
              service_action_updated_by: resp.service_action_updated_by,
              service_action_updated_by_name: resp.service_action_updated_by_name,
            }
          : prev
      );

      setActionMsg("Сохранено");
    } catch (e: any) {
      const msg =
        e?.status === 403
          ? "Нет прав на изменение этого отзыва."
          : e?.status === 404
            ? "Отзыв не найден."
            : "Не удалось сохранить. Попробуйте позже.";
      setActionErr(msg);
    } finally {
      setActionSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Отзывы</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                Отзыв
                {devEnabled ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{id}</span> : null}
              </h1>

              <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                Дата:{" "}
                <span className="text-[color:var(--pg-text)]">
                  {data?.created_at ? new Date(data.created_at).toLocaleString() : "—"}
                </span>
                {devEnabled && data ? (
                  <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">
                    loc_id={data.location_id} • survey_version_id={data.survey_version_id}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {data?.location_id ? (
                  <Button variant="secondary" onClick={() => nav(`/admin/locations/${data.location_id}/surveys`)}>
                    Опросы локации
                  </Button>
                ) : null}
              </div>

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && (
                <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                  {err}
                </div>
              )}
            </div>

            <div className="text-sm text-[color:var(--pg-muted)]">
              Оценка:{" "}
              <span className="text-[color:var(--pg-text)] font-semibold">
                {data?.rating_overall ?? "—"}
              </span>
            </div>
          </div>
        </GlassCard>

        {guest && (
          <GlassCard>
            <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Контекст гостя</h2>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="text-sm text-[color:var(--pg-muted)]">
                Гость: <span className="text-[color:var(--pg-text)]">{guest.guest_name || "—"}</span>
              </div>
              <div className="text-sm text-[color:var(--pg-muted)]">
                Комната: <span className="text-[color:var(--pg-text)]">{guest.room || "—"}</span>
              </div>
              <div className="text-sm text-[color:var(--pg-muted)]">
                Заезд: <span className="text-[color:var(--pg-text)]">{guest.checkin_at || "—"}</span>
              </div>
              <div className="text-sm text-[color:var(--pg-muted)]">
                Выезд: <span className="text-[color:var(--pg-text)]">{guest.checkout_at || "—"}</span>
              </div>
              <div className="text-sm text-[color:var(--pg-muted)]">
                Бронь: <span className="text-[color:var(--pg-text)]">{guest.reservation_code || "—"}</span>
              </div>

              {devEnabled ? (
                <div className="text-sm text-[color:var(--pg-muted)]">
                  stay_id: <span className="text-[color:var(--pg-text)]">{String(guest.stay_id ?? "—")}</span>
                  {guest.stay_source ? (
                    <>
                      {" "}• source: <span className="text-[color:var(--pg-text)]">{guest.stay_source}</span>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </GlassCard>
        )}

        <GlassCard>
          <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">Содержание</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-medium text-[color:var(--pg-muted)]">Комментарий</div>
              <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4 text-sm text-[color:var(--pg-text)]">
                {coerceComment((data as any)?.comment) || "—"}
              </div>

              <div className="mt-4 text-sm font-medium text-[color:var(--pg-muted)]">
                Принятые меры / ответ сервис-менеджера
              </div>

              <div className="mt-2">
                <textarea
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                  placeholder={canEditActionComment ? "Опишите, какие меры приняты…" : "Только чтение"}
                  disabled={!canEditActionComment || actionSaving}
                  spellCheck={false}
                  className="h-[140px] w-full resize-y rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 text-sm text-[color:var(--pg-text)] outline-none disabled:opacity-60"
                />

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-[color:var(--pg-muted)]">
                    {data?.service_action_updated_at ? (
                      <>
                        Последнее обновление:{" "}
                        <span className="text-[color:var(--pg-text)]">
                          {new Date(data.service_action_updated_at).toLocaleString()}
                        </span>
                        {data?.service_action_updated_by_name ? (
                          <>
                            {" "}•{" "}
                            <span className="text-[color:var(--pg-text)]">{data.service_action_updated_by_name}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>Пока нет ответа сервис-менеджера.</>
                    )}
                    {!canEditActionComment ? (
                      <span className="ml-2">
                        (редактирование доступно ролям: Администратор, Опер. директор, Сервис-менеджер)
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {actionErr ? <div className="text-xs text-rose-300">{actionErr}</div> : null}
                    {actionMsg ? <div className="text-xs text-emerald-300">{actionMsg}</div> : null}

                    <Button
                      variant="secondary"
                      onClick={saveActionComment}
                      disabled={
                        !canEditActionComment ||
                        actionSaving ||
                        actionText.trim() === String(data?.service_action_comment ?? "").trim()
                      }
                    >
                      {actionSaving ? "Сохранение…" : "Сохранить"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-sm font-medium text-[color:var(--pg-muted)]">Контакт</div>
              <div className="mt-2 grid gap-1 text-sm text-[color:var(--pg-text)]">
                <div>
                  <span className="text-[color:var(--pg-muted)]">Имя:</span> {data?.name || "—"}
                </div>
                <div>
                  <span className="text-[color:var(--pg-muted)]">Email:</span> {data?.email || "—"}
                </div>
                {phone ? (
                  <div>
                    <span className="text-[color:var(--pg-muted)]">Телефон:</span> {phone}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-[color:var(--pg-muted)]">Дополнительные ответы</div>

              <div className="mt-2 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                    <tr>
                      <th className="px-4 py-3">Вопрос</th>
                      <th className="px-4 py-3">Ответ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(humanExtraRows ?? []).map((row) => (
                      <tr key={row.key} className="border-t border-[color:var(--pg-border)]">
                        <td className="px-4 py-3">
                          <div className="text-[color:var(--pg-text)]">{row.label}</div>
                          <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                            {humanKindLabel(row.kind)}
                            {devEnabled ? <span className="ml-2 font-mono">{row.key}</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--pg-text)] whitespace-pre-wrap break-words">
                          {row.valueText}
                          {devEnabled ? (
                            <div className="mt-2 font-mono text-xs text-[color:var(--pg-muted)]">
                              raw: {typeof row.rawValue === "string" || typeof row.rawValue === "number" || typeof row.rawValue === "boolean"
                                ? String(row.rawValue)
                                : JSON.stringify(row.rawValue)}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}

                    {/* Fallback: если схему не удалось загрузить — показываем старый raw-view */}
                    {!svLoading && !svSchema && extraAnswers.map(([k, v]) => (
                      <tr key={k} className="border-t border-[color:var(--pg-border)]">
                        <td className="px-4 py-3">
                          <div className="text-[color:var(--pg-text)]">{k}</div>
                          <div className="mt-1 font-mono text-xs text-[color:var(--pg-muted)]">raw</div>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--pg-text)] whitespace-pre-wrap break-words">
                          {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                            ? String(v)
                            : devEnabled
                              ? JSON.stringify(v, null, 2)
                              : "Сложное значение (см. Dev mode)"}
                        </td>
                      </tr>
                    ))}

                    {!loading && (humanExtraRows?.length ?? 0) === 0 && (!svSchema ? extraAnswers.length === 0 : true) && (
                      <tr className="border-t border-[color:var(--pg-border)]">
                        <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={2}>
                          Нет дополнительных ответов.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {svLoading && (
                <div className="mt-2 text-xs text-[color:var(--pg-faint)]">Загрузка схемы вопросов…</div>
              )}
              {devEnabled && svErr && (
                <div className="mt-2 text-xs text-rose-300">{svErr}</div>
              )}

              {devEnabled && (
                <div className="mt-4">
                  <details className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                    <summary className="cursor-pointer text-sm font-medium text-[color:var(--pg-text)]">
                      Служебные данные
                    </summary>

                    <div className="mt-3">
                      <div className="text-xs font-medium text-[color:var(--pg-muted)]">answers</div>
                      <pre className="mt-2 max-h-[320px] overflow-auto rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card-hover)] p-3 text-xs text-[color:var(--pg-text)]">
                        {JSON.stringify(data?.answers ?? {}, null, 2)}
                      </pre>

                      <div className="mt-4 text-xs font-medium text-[color:var(--pg-muted)]">meta</div>
                      <pre className="mt-2 max-h-[320px] overflow-auto rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card-hover)] p-3 text-xs text-[color:var(--pg-text)]">
                        {JSON.stringify(data?.meta ?? {}, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
