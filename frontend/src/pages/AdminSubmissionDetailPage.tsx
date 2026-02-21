import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

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
  answers: Record<string, unknown>;
  meta: Record<string, unknown>;

  rating_overall?: number | string | null;
  comment?: string;
  name?: string;
  email?: string;

  guest_context?: GuestContext | null;
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

export default function AdminSubmissionDetailPage() {
  const nav = useNavigate();
  const params = useParams();
  const { enabled: devEnabled } = useDevMode();

  const id = Number(params.id || 0);

  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setErr(null);

    adminJson<SubmissionDetail>(`/api/admin/admin/submissions/${id}`)
      .then(setData)
      .catch((e: any) => {
        setErr(errToText(e, devEnabled));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [id, devEnabled]);

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

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
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
                <Button variant="secondary" onClick={() => nav("/admin/submissions")}>Назад</Button>
                {data?.location_id ? (
                  <Button variant="secondary" onClick={() => nav(`/admin/locations/${data.location_id}/surveys`)}>
                    Опросы локации
                  </Button>
                ) : null}
              </div>

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && <div className="mt-3 text-xs text-rose-300">{err}</div>}
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
                {data?.comment?.trim() ? data.comment : "—"}
              </div>

              <div className="mt-4 text-sm font-medium text-[color:var(--pg-muted)]">Контакт</div>
              <div className="mt-2 text-sm text-[color:var(--pg-text)]">
                {data?.name || "—"} • {data?.email || "—"}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-[color:var(--pg-muted)]">Дополнительные ответы</div>

              <div className="mt-2 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                    <tr>
                      <th className="px-4 py-3">Поле</th>
                      <th className="px-4 py-3">Значение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extraAnswers.map(([k, v]) => (
                      <tr key={k} className="border-t border-[color:var(--pg-border)]">
                        <td className="px-4 py-3 font-mono text-xs text-[color:var(--pg-muted)]">{k}</td>
                        <td className="px-4 py-3 text-[color:var(--pg-text)] whitespace-pre-wrap break-words">
                          {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                            ? String(v)
                            : devEnabled
                              ? JSON.stringify(v, null, 2)
                              : "Сложное значение (см. Dev mode)"}
                        </td>
                      </tr>
                    ))}

                    {!loading && extraAnswers.length === 0 && (
                      <tr className="border-t border-[color:var(--pg-border)]">
                        <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={2}>
                          Нет дополнительных ответов.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {devEnabled && (
                <div className="mt-4">
                  <details className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                    <summary className="cursor-pointer text-sm font-medium text-[color:var(--pg-text)]">
                      Технические данные (JSON)
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
