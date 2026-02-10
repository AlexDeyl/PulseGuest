import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { API_BASE } from "../shared/api/public";

type ListItem = {
  id: number;
  location_id: number;
  survey_version_id: number;
  created_at: string;
  rating_overall: number | string | null;
  comment: string;
  name: string;
  email: string;
};

type ListResp = {
  total: number;
  limit: number;
  offset: number;
  items: ListItem[];
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

export default function AdminSubmissionsPage() {
  const { me } = useAuth();
  const nav = useNavigate();

  const locations = me?.allowed_locations ?? [];

  const [locationId, setLocationId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_location_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [limit] = useState(20);
  const [offset, setOffset] = useState(0);

  const [ratingMin, setRatingMin] = useState("");
  const [ratingMax, setRatingMax] = useState("");
  const [hasComment, setHasComment] = useState<"any" | "yes" | "no">("any");

  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (locationId !== "") return;
    if (locations.length) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    p.set("offset", String(offset));
    if (ratingMin.trim()) p.set("rating_min", ratingMin.trim());
    if (ratingMax.trim()) p.set("rating_max", ratingMax.trim());
    if (hasComment !== "any") p.set("has_comment", hasComment === "yes" ? "true" : "false");
    return p.toString();
  }, [limit, offset, ratingMin, ratingMax, hasComment]);

  useEffect(() => {
    if (locationId === "") return;

    localStorage.setItem("pg_selected_location_id", String(locationId));
    setLoading(true);
    setErr(null);

    adminGetJson<ListResp>(`/api/admin/admin/locations/${locationId}/submissions?${query}`)
      .then(setData)
      .catch((e: any) => {
        const detail = e?.detail ? JSON.stringify(e.detail) : "";
        setErr(`Не удалось загрузить отзывы. ${detail}`);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [locationId, query]);

  const total = data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                Отзывы (submissions)
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="text-sm text-[color:var(--pg-muted)]">Локация:</div>

                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={locationId}
                  onChange={(e) => {
                    setOffset(0);
                    setLocationId(Number(e.target.value));
                  }}
                  disabled={!locations.length}
                >
                  {locations.map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.name} • {l.slug}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  className="w-24 rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  placeholder="Рейтинг от"
                  value={ratingMin}
                  onChange={(e) => {
                    setOffset(0);
                    setRatingMin(e.target.value);
                  }}
                />
                <input
                  className="w-24 rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  placeholder="до"
                  value={ratingMax}
                  onChange={(e) => {
                    setOffset(0);
                    setRatingMax(e.target.value);
                  }}
                />

                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={hasComment}
                  onChange={(e) => {
                    setOffset(0);
                    setHasComment(e.target.value as any);
                  }}
                >
                  <option value="any">Комментарий: любой</option>
                  <option value="yes">Только с текстом</option>
                  <option value="no">Только без текста</option>
                </select>

                <Button variant="secondary" onClick={() => nav("/admin", { replace: false })}>
                  Назад на дашборд
                </Button>
              </div>

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && <div className="mt-3 text-xs text-red-600">{err}</div>}
            </div>

            <div className="text-sm text-[color:var(--pg-muted)]">
              Всего: <span className="text-[color:var(--pg-text)]">{total}</span>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Дата</th>
                  <th className="px-4 py-3">Оценка</th>
                  <th className="px-4 py-3">Комментарий</th>
                  <th className="px-4 py-3">Контакт</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[color:var(--pg-text)]">
                      {r.rating_overall ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {r.comment ? r.comment.slice(0, 120) : "—"}
                      {r.comment && r.comment.length > 120 ? "…" : ""}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {r.email || r.name ? `${r.name || "—"} • ${r.email || "—"}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        onClick={() => nav(`/admin/submissions/${r.id}`)}
                      >
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}

                {!loading && (data?.items?.length ?? 0) === 0 && (
                  <tr className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={5}>
                      Пока нет отзывов по выбранным фильтрам.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" disabled={!canPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Назад
            </Button>

            <div className="text-xs text-[color:var(--pg-faint)]">
              {total ? `${offset + 1}–${Math.min(offset + limit, total)} из ${total}` : "—"}
            </div>

            <Button variant="secondary" disabled={!canNext} onClick={() => setOffset(offset + limit)}>
              Вперёд
            </Button>
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
