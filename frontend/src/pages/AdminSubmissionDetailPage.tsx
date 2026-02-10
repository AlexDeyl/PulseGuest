import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { API_BASE } from "../shared/api/public";

type SubmissionDetail = {
  id: number;
  location_id: number;
  survey_version_id: number;
  created_at: string;
  answers: Record<string, any>;
  meta: Record<string, any>;
  rating_overall?: number | null;
  comment?: string;
  name?: string;
  email?: string;
};

async function adminGetJson<T>(path: string): Promise<T> {
  const access = localStorage.getItem("pg_access_token") || "";
  const res = await fetch(`${API_BASE}${path}`, {
    headers: access ? { authorization: `Bearer ${access}` } : {},
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    const detail = ct.includes("application/json") ? await res.json() : await res.text();
    const err: any = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return (await res.json()) as T;
}

function FieldRow({ label, value }: { label: string; value: any }) {
  const v =
    value === null || value === undefined || value === ""
      ? "—"
      : typeof value === "string"
      ? value
      : JSON.stringify(value);

  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <div className="text-[color:var(--pg-muted)]">{label}</div>
      <div className="col-span-2 text-[color:var(--pg-text)] break-words">{v}</div>
    </div>
  );
}

export default function AdminSubmissionDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setErr(null);

    adminGetJson<SubmissionDetail>(`/api/admin/admin/submissions/${id}`)
      .then(setData)
      .catch((e: any) => {
        const detail = e?.detail ? JSON.stringify(e.detail) : "";
        setErr(`Не удалось загрузить submission. ${detail}`);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const created = useMemo(() => {
    if (!data?.created_at) return "";
    try {
      return new Date(data.created_at).toLocaleString();
    } catch {
      return data.created_at;
    }
  }, [data?.created_at]);

  const rating = data?.rating_overall ?? data?.answers?.rating_overall ?? null;
  const comment = data?.comment ?? data?.answers?.comment ?? "";
  const name = data?.name ?? data?.answers?.name ?? "";
  const email = data?.email ?? data?.answers?.email ?? "";

  const meta = data?.meta ?? {};
  const slug = meta?.slug ?? "—";
  const source = meta?.source ?? "—";
  const ua = meta?.user_agent ?? "—";

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                Отзыв #{id}
              </h1>

              {loading && (
                <div className="mt-2 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>
              )}
              {err && <div className="mt-2 text-xs text-red-600">{err}</div>}

              {data && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[color:var(--pg-muted)]">
                  <span>
                    Локация:{" "}
                    <span className="text-[color:var(--pg-text)]">{data.location_id}</span>
                  </span>
                  <span className="text-[color:var(--pg-faint)]">•</span>
                  <span>
                    Дата: <span className="text-[color:var(--pg-text)]">{created}</span>
                  </span>
                  <span className="text-[color:var(--pg-faint)]">•</span>
                  <span>
                    Оценка:{" "}
                    <span className="text-[color:var(--pg-text)]">
                      {rating ?? "—"}
                    </span>
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => nav(-1)}>
                Назад
              </Button>
              <Button variant="secondary" onClick={() => nav("/admin/submissions")}>
                К списку
              </Button>
            </div>
          </div>
        </GlassCard>

        {data && (
          <>
            <GlassCard>
              <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">
                Содержание
              </h2>

              <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                <FieldRow label="Оценка" value={rating} />
                <div className="border-t border-[color:var(--pg-border)]" />
                <FieldRow label="Комментарий" value={comment} />
                <div className="border-t border-[color:var(--pg-border)]" />
                <FieldRow label="Имя" value={name} />
                <div className="border-t border-[color:var(--pg-border)]" />
                <FieldRow label="Email" value={email} />
              </div>
            </GlassCard>

            <GlassCard>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[color:var(--pg-text)]">
                  Meta
                </h2>
                <Button variant="secondary" onClick={() => setShowRaw((v) => !v)}>
                  {showRaw ? "Скрыть сырьё" : "Показать сырьё (JSON)"}
                </Button>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                <FieldRow label="slug" value={slug} />
                <div className="border-t border-[color:var(--pg-border)]" />
                <FieldRow label="source" value={source} />
                <div className="border-t border-[color:var(--pg-border)]" />
                <FieldRow label="user_agent" value={ua} />
              </div>

              {showRaw && (
                <pre className="mt-4 overflow-auto rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4 text-xs text-[color:var(--pg-text)]">
                  {JSON.stringify(data, null, 2)}
                </pre>
              )}
            </GlassCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
