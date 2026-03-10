import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type LocShort = {
  id: number;
  organization_id: number;
  name: string;
  slug: string;
  code: string;
  type: string;
  is_active: boolean;
};

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

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Не удалось загрузить отзывы. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;

  if (devEnabled) {
    try {
      const detail = JSON.stringify(e?.detail ?? e, null, 2);
      return detail ? `Не удалось загрузить отзывы. ${detail}` : "Не удалось загрузить отзывы.";
    } catch {
      return "Не удалось загрузить отзывы.";
    }
  }

  return "Не удалось загрузить отзывы. Обновите страницу и попробуйте снова.";
}

export default function AdminSubmissionsPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const allowedLocations: LocShort[] = (me?.allowed_locations ?? []) as any;

  const allowedOrgIds = useMemo(() => {
    const xs = Array.isArray(me?.allowed_organization_ids) ? me!.allowed_organization_ids : [];
    return xs.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
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

  const canViewSubmissions = isAdminLike || isOps || isService || isAuditor;

  if (!canViewSubmissions) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Доступ ограничен</div>
          <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
            Раздел <b>Отзывы</b> доступен только для ролей: <b>Администратор</b>, <b>Операционный директор</b>,
            <b>Сервис-менеджер</b>, <b>Аудитор</b>.
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => nav("/admin")}>На дашборд</Button>
          </div>
        </GlassCard>
      </AppShell>
    );
  }

  // org selector
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_org_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  // location selector
  const [locationId, setLocationId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_location_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  // paging + filters
  const [limit] = useState(20);
  const [offset, setOffset] = useState(0);

  const [ratingMin, setRatingMin] = useState("");
  const [ratingMax, setRatingMax] = useState("");
  const [hasComment, setHasComment] = useState<"any" | "yes" | "no">("any");

  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const items = await adminJson<Org[]>("/api/admin/admin/organizations");
        if (!alive) return;

        const active = (items ?? []).filter((o) => o.is_active);
        if (allowedOrgIds.length) {
          const allowedSet = new Set(allowedOrgIds);
          setOrgs(active.filter((o) => allowedSet.has(o.id)));
        } else {
          setOrgs(active);
        }
      } catch {
        const ids = allowedOrgIds.length
          ? allowedOrgIds
          : Array.from(new Set(allowedLocations.map((l) => Number(l.organization_id)).filter(Number.isFinite)));

        const fallback = ids.map((id, idx) => ({
          id,
          name: `Организация ${idx + 1}`,
          slug: `org-${id}`,
          is_active: true,
        }));

        if (!alive) return;
        setOrgs(fallback);
      }
    })();

    return () => {
      alive = false;
    };
  }, [allowedOrgIds]);

  useEffect(() => {
    if (!orgs.length) {
      setOrgId("");
      return;
    }

    const ids = new Set(orgs.map((o) => o.id));
    const cur = orgId === "" ? null : Number(orgId);

    if (cur == null || !ids.has(cur)) {
      setOffset(0);
      setOrgId(orgs[0].id);
    }
  }, [orgs, orgId]);

  useEffect(() => {
    if (orgId === "") return;
    localStorage.setItem("pg_selected_org_id", String(orgId));
  }, [orgId]);

  const locationsByOrg = useMemo(() => {
    if (orgId === "") return [];
    return allowedLocations
      .filter((l) => l.organization_id === Number(orgId))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [allowedLocations, orgId]);

  useEffect(() => {
    if (orgId === "") return;

    const ids = new Set(locationsByOrg.map((l) => Number(l.id)));
    const cur = locationId === "" ? null : Number(locationId);

    if (locationsByOrg.length === 0) {
      setLocationId("");
      setData(null);
      return;
    }

    if (cur == null || !ids.has(cur)) {
      const next = Number(locationsByOrg[0].id);
      setOffset(0);
      setLocationId(next);
      localStorage.setItem("pg_selected_location_id", String(next));
    }
  }, [orgId, locationsByOrg, locationId]);

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
    let alive = true;

    (async () => {
      if (locationId === "") return;

      setLoading(true);
      setErr(null);

      try {
        const r = await adminJson<ListResp>(
          `/api/admin/admin/locations/${locationId}/submissions?${query}`
        );
        if (!alive) return;
        setData(r);
      } catch (e: any) {
        if (!alive) return;
        setErr(errToText(e, devEnabled));
        setData(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [locationId, query, devEnabled]);

  const total = data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Отзывы</div>
                <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Отзывы гостей</h1>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="text-sm text-[color:var(--pg-muted)]">Организация:</div>
                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={orgId}
                  onChange={(e) => {
                    setOffset(0);
                    setOrgId(Number(e.target.value));
                  }}
                  disabled={!orgs.length}
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>

                <div className="text-sm text-[color:var(--pg-muted)]">Локация:</div>
                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={locationId}
                  onChange={(e) => {
                    setOffset(0);
                    setLocationId(Number(e.target.value));
                    localStorage.setItem("pg_selected_location_id", String(e.target.value));
                  }}
                  disabled={!locationsByOrg.length}
                >
                  {locationsByOrg.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>

                {devEnabled && (
                  <span className="font-mono text-[11px] text-[color:var(--pg-faint)]">
                    Организация #{orgId || "—"} • Локация #{locationId || "—"}
                  </span>
                )}
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

                <Button variant="secondary" onClick={() => nav("/admin")}>
                  Назад на дашборд
                </Button>

                <Button variant="secondary" onClick={() => nav(0)}>
                  Обновить
                </Button>
              </div>

              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
              {err && (
                <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 whitespace-pre-wrap text-xs text-rose-300">
                  {err}
                </div>
              )}
              {!loading && locationId === "" && (
                <div className="mt-3 text-xs text-[color:var(--pg-faint)]">
                  В выбранной организации пока нет доступных локаций.
                </div>
              )}
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
                      {r.email || r.name ? (
                        <div className="space-y-1">
                          <div>{r.name || "Имя не указано"}</div>
                          <div className="text-[11px] text-[color:var(--pg-faint)]">{r.email || "Email не указан"}</div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" onClick={() => nav(`/admin/submissions/${r.id}`)}>
                        Открыть отзыв
                      </Button>
                    </td>
                  </tr>
                ))}

                {!loading && (data?.items?.length ?? 0) === 0 && (
                  <tr className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-6 text-[color:var(--pg-faint)]" colSpan={5}>
                      По выбранным условиям отзывы пока не найдены.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="secondary"
              disabled={!canPrev}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
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
