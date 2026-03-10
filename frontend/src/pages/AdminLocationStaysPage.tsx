import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { adminJson, adminUploadJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type Loc = {
  id: number;
  organization_id: number;
  type: string;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
};

type StayItem = {
  id: number;
  organization_id?: number;

  location_id: number;
  location_name?: string;
  location_slug?: string;
  location_code?: string;

  room: string;
  guest_name: string;
  checkin_at: string;
  checkout_at: string;
  reservation_code: string | null;
  source: string | null;
  created_at: string | null;
};

type StaysResp = {
  total: number;
  limit: number;
  offset: number;
  items: StayItem[];
};

type ImportResp = {
  ok: boolean;
  organization_id?: number;
  inserted: number;
  updated: number;
  skipped: number;
  unknown_rooms?: number;
  errors?: { row: number; error: string }[];
  encoding?: string;
  delimiter?: string;
  has_header?: boolean;
  max_rows?: number;
  skip_unknown_rooms?: boolean;
};

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Ошибка запроса. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;

  if (devEnabled) {
    try {
      return JSON.stringify(e?.detail ?? e, null, 2);
    } catch {
      return String(e?.message ?? "Ошибка");
    }
  }

  return "Не удалось выполнить операцию. Попробуйте ещё раз.";
}

export default function AdminLocationStaysPage() {
  const nav = useNavigate();
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();

  const allowedLocations: Loc[] = (me?.allowed_locations ?? []) as any;

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

  // По новой модели stays/import — только admin/ops (auditor = stats-only, service_manager stays не трогает)
  const canAccessStaysPage = isAdminLike || isOps;

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_org_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [locations, setLocations] = useState<Loc[]>([]);
  const [locationFilterId, setLocationFilterId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_stays_location_filter_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [room, setRoom] = useState("");
  const [q, setQ] = useState("");
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<StaysResp | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("fidelio_csv");
  const [skipUnknownRooms, setSkipUnknownRooms] = useState(true);

  const [importLoading, setImportLoading] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importRes, setImportRes] = useState<ImportResp | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const items = await adminJson<Org[]>("/api/admin/admin/organizations");
        if (!alive) return;
        setOrgs(items.filter((o) => o.is_active));
      } catch {
        const ids = Array.from(new Set(allowedLocations.map((l) => l.organization_id)));
        const fallback = ids.map((id) => ({
          id,
          name: `Организация #${id}`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (orgId !== "") return;
    if (orgs.length) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  useEffect(() => {
    if (orgId === "") return;
    localStorage.setItem("pg_selected_org_id", String(orgId));
  }, [orgId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (orgId === "") return;

      try {
        const locs = await adminJson<Loc[]>(`/api/admin/admin/organizations/${orgId}/locations`);
        if (!alive) return;
        setLocations(locs.filter((l) => l.is_active));
      } catch {
        const locs = allowedLocations.filter((l) => l.organization_id === Number(orgId));
        if (!alive) return;
        setLocations(locs);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (locationFilterId === "") {
      localStorage.removeItem("pg_stays_location_filter_id");
      return;
    }
    localStorage.setItem("pg_stays_location_filter_id", String(locationFilterId));
  }, [locationFilterId]);

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    p.set("offset", String(offset));
    if (room.trim()) p.set("room", room.trim());
    if (q.trim()) p.set("q", q.trim());
    if (on.trim()) p.set("on", on.trim());
    if (locationFilterId !== "") p.set("location_id", String(locationFilterId));
    return p.toString();
  }, [limit, offset, room, q, on, locationFilterId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (orgId === "") return;

      setLoadingList(true);
      setListErr(null);

      try {
        const r = await adminJson<StaysResp>(
          `/api/admin/admin/organizations/${orgId}/stays?${listQuery}`
        );
        if (!alive) return;
        setData(r);
      } catch (e: any) {
        if (!alive) return;
        setData(null);
        setListErr(errToText(e, devEnabled));
      } finally {
        if (!alive) return;
        setLoadingList(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [orgId, listQuery, devEnabled]);

  const total = data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const doImport = async () => {
    if (orgId === "") {
      setImportErr("Выберите организацию");
      return;
    }
    if (!file) {
      setImportErr("Выберите CSV-файл");
      return;
    }

    setImportLoading(true);
    setImportErr(null);
    setImportRes(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const p = new URLSearchParams();
      p.set("source", source.trim() || "csv");
      p.set("skip_unknown_rooms", skipUnknownRooms ? "1" : "0");
      p.set("max_rows", "50000");

      const r = await adminUploadJson<ImportResp>(
        `/api/admin/admin/organizations/${orgId}/stays/import?${p.toString()}`,
        form
      );

      setImportRes(r);

      setOffset(0);
      const refreshed = await adminJson<StaysResp>(
        `/api/admin/admin/organizations/${orgId}/stays?${new URLSearchParams({
          limit: String(limit),
          offset: "0",
          room: room.trim(),
          q: q.trim(),
          on: on.trim(),
          ...(locationFilterId !== "" ? { location_id: String(locationFilterId) } : {}),
        } as any).toString()}`
      );
      setData(refreshed);
    } catch (e: any) {
      setImportErr(errToText(e, devEnabled));
    } finally {
      setImportLoading(false);
    }
  };

  if (isStatsOnly || !canAccessStaysPage) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Доступ ограничен</div>
          <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
            {isStatsOnly ? (
              <>Роль <b>Аудитор</b> — доступ только к статистике.</>
            ) : (
              <>Раздел <b>Проживающие</b> доступен только для <b>Администратора</b> и <b>Операционного директора</b>.</>
            )}
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
                Проживающие
              </h1>

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

                {devEnabled && (
                  <span className="font-mono text-xs text-[color:var(--pg-muted)]">
                    org={orgId || "—"}
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={locationFilterId}
                  onChange={(e) => {
                    setOffset(0);
                    const v = e.target.value;
                    setLocationFilterId(v ? Number(v) : "");
                  }}
                  disabled={!locations.length}
                  title="Фильтр по локации (опционально)"
                >
                  <option value="">Все локации</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>

                <input
                  className="w-40 rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  placeholder="Номер комнаты"
                  value={room}
                  onChange={(e) => {
                    setOffset(0);
                    setRoom(e.target.value);
                  }}
                />

                <input
                  className="w-64 rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  placeholder="Поиск по гостю"
                  value={q}
                  onChange={(e) => {
                    setOffset(0);
                    setQ(e.target.value);
                  }}
                />

                <input
                  type="date"
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={on}
                  onChange={(e) => {
                    setOffset(0);
                    setOn(e.target.value);
                  }}
                />

                <Button variant="secondary" onClick={() => nav("/admin")}>
                  Назад
                </Button>
              </div>

              {loadingList && (
                <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>
              )}
              {listErr && <div className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{listErr}</div>}
            </div>

            <div className="text-sm text-[color:var(--pg-muted)]">
              Всего: <span className="text-[color:var(--pg-text)]">{total}</span>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">
              Импорт проживающих (CSV)
            </div>
            <div className="text-xs text-[color:var(--pg-muted)]">
              Импорт распределяет строки по локациям организации по номеру комнаты.
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Источник (тип импорта)</div>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">CSV-файл</div>
              <input
                type="file"
                accept=".csv,text/csv"
                className="mt-2 block w-full text-sm text-[color:var(--pg-text)]"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
              <input
                type="checkbox"
                checked={skipUnknownRooms}
                onChange={(e) => setSkipUnknownRooms(e.target.checked)}
              />
              Пропускать неизвестные комнаты
            </label>
          </div>

          {importErr && (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {importErr}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button onClick={doImport} disabled={importLoading || !orgs.length}>
              {importLoading ? "Импорт…" : "Импортировать CSV"}
            </Button>
          </div>

          {importRes && (
            <div className="mt-4 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4 text-sm text-[color:var(--pg-text)]">
              <div className="font-semibold">Результат импорта</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <div>
                  Добавлено: <b>{importRes.inserted}</b>
                </div>
                <div>
                  Обновлено: <b>{importRes.updated}</b>
                </div>
                <div>
                  Пропущено: <b>{importRes.skipped}</b>
                </div>
                <div>
                  Неизвестные комнаты: <b>{importRes.unknown_rooms ?? 0}</b>
                </div>
              </div>

              {!!importRes.errors?.length && (
                <div className="mt-3 text-xs text-[color:var(--pg-muted)]">
                  Ошибки:{" "}
                  {importRes.errors
                    .slice(0, 5)
                    .map((x) => `стр. ${x.row}: ${x.error}`)
                    .join(" | ")}
                  {importRes.errors.length > 5 ? " …" : ""}
                </div>
              )}
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <div className="overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Комната</th>
                  <th className="px-4 py-3">Гость</th>
                  <th className="px-4 py-3">Заезд</th>
                  <th className="px-4 py-3">Выезд</th>
                  <th className="px-4 py-3">Бронь/Фолио</th>
                  <th className="px-4 py-3">Локация</th>
                  <th className="px-4 py-3">Источник</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((s) => (
                  <tr key={s.id} className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-3 font-mono text-[color:var(--pg-text)]">{s.room}</td>
                    <td className="px-4 py-3 text-[color:var(--pg-text)]">{s.guest_name}</td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">{s.checkin_at}</td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">{s.checkout_at}</td>
                    <td className="px-4 py-3 font-mono text-[color:var(--pg-muted)]">
                      {s.reservation_code ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {s.location_name
                        ? `${s.location_name}${devEnabled && s.location_slug ? ` • ${s.location_slug}` : ""}`
                        : devEnabled
                          ? `#${s.location_id}`
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">{s.source ?? "—"}</td>
                  </tr>
                ))}

                {!loadingList && (data?.items?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-sm text-[color:var(--pg-muted)]">
                      Нет данных
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-[color:var(--pg-muted)]">
              {total ? `${offset + 1}–${Math.min(offset + limit, total)} из ${total}` : "—"}
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={!canPrev}
              >
                Назад
              </Button>
              <Button
                variant="secondary"
                onClick={() => setOffset(offset + limit)}
                disabled={!canNext}
              >
                Вперёд
              </Button>
            </div>
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
