import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";
import { useAuth } from "../shared/auth";
import QrModal from "../components/QrModal";

type LocationDto = {
  id: number;
  organization_id: number;
  name: string;
  slug: string;
  code: string;
  type: string;
  is_active: boolean;
};

type SurveyItem = {
  survey_id: number;
  location_id: number;
  name: string;
  is_archived: boolean;
  active_version: number | null;
  active_version_id: number | null;
  versions_count: number;
  updated_at: string | null;
};

type LocationReviewLinksResp = {
  location_id: number;
  organization_id: number;
  group_key: string;
  inherit: boolean;
  override: { yandex_url: string | null; twogis_url: string | null };
  group_default: { yandex_url: string | null; twogis_url: string | null };
  effective: { yandex_url?: string; twogis_url?: string } | null;
  errors?: { yandex_url?: string | null; twogis_url?: string | null };
};

function urlErrText(code?: string | null) {
  if (!code) return null;
  if (code === "invalid_url") return "Некорректная ссылка (нужен http/https).";
  return "Некорректное значение.";
}

function errToText(
  e: any,
  devEnabled: boolean,
  base: string = "Не удалось загрузить опросы. Попробуйте позже."
) {
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

export default function AdminLocationSurveysPage() {
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

  // location surveys: только admin/ops (service_manager работает с group surveys)
  const canEditLocationSurveys = isAdminLike || isOps;

  // review links can be managed by admin/ops/service_manager
  const canManageReviewLinks = isAdminLike || isOps || isService;

  const locationId = useMemo(() => Number(params.locationId || 0), [params.locationId]);

  const [loc, setLoc] = useState<LocationDto | null>(null);
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [links, setLinks] = useState<LocationReviewLinksResp | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksSaving, setLinksSaving] = useState(false);
  const [linksErr, setLinksErr] = useState<string | null>(null);
  const [linksForm, setLinksForm] = useState<{ inherit: boolean; yandex_url: string; twogis_url: string }>(
    { inherit: true, yandex_url: "", twogis_url: "" }
  );

  const [newName, setNewName] = useState("Опрос локации");
  const [qrOpen, setQrOpen] = useState(false);

  const getPublicUrl = async () => {
    if (!loc) return `/${params.locationId || ""}`;
    try {
      const r = await adminJson<{ public_url: string }>(
        `/api/admin/admin/locations/${loc.id}/public-url`
      );
      const u = (r?.public_url || "").trim();
      if (u) return u;
    } catch {
      // ignore
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const rel = `/${loc.slug}`;
    return origin ? `${origin}${rel}` : rel;
  };

  const openPublic = async () => {
    const url = await getPublicUrl();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    if (!locationId) return;

    setLoading(true);
    setErr(null);

    Promise.all([
      adminJson<LocationDto>(`/api/admin/admin/locations/${locationId}`),
      adminJson<SurveyItem[]>(`/api/admin/admin/locations/${locationId}/surveys`),
    ])
      .then(([l, s]) => {
        setLoc(l);
        setItems(s);
      })
      .catch((e: any) => {
        setErr(errToText(e, devEnabled));
        setLoc(null);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [locationId, devEnabled]);

  // Review links (Yandex / 2GIS)
  useEffect(() => {
    let alive = true;
    if (!locationId) return;

    setLinksLoading(true);
    setLinksErr(null);

    adminJson<LocationReviewLinksResp>(`/api/admin/admin/locations/${locationId}/review-links`)
      .then((r) => {
        if (!alive) return;
        setLinks(r);
        setLinksForm({
          inherit: Boolean(r?.inherit),
          yandex_url: String(r?.override?.yandex_url ?? ""),
          twogis_url: String(r?.override?.twogis_url ?? ""),
        });
      })
      .catch((e: any) => {
        if (!alive) return;
        setLinks(null);
        setLinksErr(errToText(e, devEnabled, "Не удалось загрузить ссылки отзывов. Попробуйте позже."));
      })
      .finally(() => {
        if (!alive) return;
        setLinksLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [locationId, devEnabled]);

  async function saveReviewLinks() {
    if (!locationId) return;
    if (!canManageReviewLinks) return;
    if (linksSaving) return;

    setLinksSaving(true);
    setLinksErr(null);

    try {
      const r = await adminJson<LocationReviewLinksResp>(`/api/admin/admin/locations/${locationId}/review-links`, {
        method: "PATCH",
        body: JSON.stringify({
          inherit: Boolean(linksForm.inherit),
          yandex_url: linksForm.yandex_url,
          twogis_url: linksForm.twogis_url,
        }),
      });

      setLinks(r);
      setLinksForm({
        inherit: Boolean(r?.inherit),
        yandex_url: String(r?.override?.yandex_url ?? ""),
        twogis_url: String(r?.override?.twogis_url ?? ""),
      });
    } catch (e: any) {
      setLinksErr(errToText(e, devEnabled, "Не удалось сохранить ссылки отзывов. Попробуйте позже."));
    } finally {
      setLinksSaving(false);
    }
  }

  async function createSurvey() {
    if (!locationId) return;
    if (!canEditLocationSurveys) return;

    setLoading(true);
    setErr(null);

    try {
      const created = await adminJson<any>(`/api/admin/admin/locations/${locationId}/surveys`, {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim() || "Опрос локации",
          copy_from_location_active: true,
          make_active: false,
        }),
      });

      const s = await adminJson<SurveyItem[]>(`/api/admin/admin/locations/${locationId}/surveys`);
      setItems(s);

      if (created?.survey_id) nav(`/admin/surveys/${created.survey_id}`);
    } catch (e: any) {
      setErr(errToText(e, devEnabled));
    } finally {
      setLoading(false);
    }
  }

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
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Опросы локации</h1>

              <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                {loc ? (
                  <>
                    {loc.name}
                    {devEnabled ? (
                      <>
                        {" "}
                        • <span className="font-mono">{loc.slug}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    Локация не найдена
                    {devEnabled ? <span className="ml-2 font-mono">location_id={locationId}</span> : null}
                  </>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">

                {loc ? (
                  <>
                    <Button variant="secondary" onClick={openPublic}>
                      Открыть публичную ссылку
                    </Button>
                    <Button variant="secondary" onClick={() => setQrOpen(true)}>
                      QR (SVG)
                    </Button>
                  </>
                ) : null}

                {isService && loc ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      localStorage.setItem("pg_selected_org_id", String(loc.organization_id));
                      localStorage.setItem("pg_selected_group_key", String(loc.type || "other"));
                      nav("/admin/group-surveys");
                    }}
                  >
                    Перейти к групповым опросам
                  </Button>
                ) : null}
              </div>

              {err && <div className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{err}</div>}
              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
            </div>

            {canEditLocationSurveys ? (
              <div className="min-w-[320px]">
                <div className="text-sm text-[color:var(--pg-muted)]">Создать новый опрос</div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Button onClick={createSurvey} disabled={loading || !locationId}>Создать</Button>
                </div>
                <div className="mt-2 text-xs text-[color:var(--pg-faint)]">
                  По умолчанию копируем активную анкету локации (если есть).
                </div>
              </div>
            ) : (
              <div className="min-w-[320px]">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Только просмотр</div>
                <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  Локальные опросы локации редактируют только <b>Администратор</b>/<b>Ops director</b>.
                  Для сервис-менеджера — работа через <b>групповые опросы</b>.
                </div>
              </div>
            )}
          </div>
        </GlassCard>

        {/* Review links settings */}
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                Публичные отзывы (Яндекс / 2ГИС)
              </div>
              <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
                Эти ссылки используются на экране благодарности при высокой оценке.
              </div>
            </div>

            {!canManageReviewLinks ? (
              <div className="text-sm text-[color:var(--pg-muted)]">Только просмотр</div>
            ) : null}
          </div>

          {linksLoading ? (
            <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>
          ) : null}

          {linksErr ? (
            <div className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{linksErr}</div>
          ) : null}

          {links ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Настройки локации</div>

                <label className="mt-3 flex items-center gap-2 text-sm text-[color:var(--pg-muted)]">
                  <input
                    type="checkbox"
                    checked={Boolean(linksForm.inherit)}
                    disabled={!canManageReviewLinks || linksSaving}
                    onChange={(e) => setLinksForm((p) => ({ ...p, inherit: e.target.checked }))}
                  />
                  Наследовать ссылки группы
                </label>

                {!linksForm.inherit ? (
                  <>
                    <div className="mt-3">
                      <div className="text-xs text-[color:var(--pg-faint)]">Яндекс</div>
                      <input
                        className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                        value={linksForm.yandex_url}
                        onChange={(e) => setLinksForm((p) => ({ ...p, yandex_url: e.target.value }))}
                        placeholder="https://yandex.ru/maps/..."
                        disabled={!canManageReviewLinks || linksSaving}
                      />
                      {urlErrText(links.errors?.yandex_url ?? null) ? (
                        <div className="mt-1 text-xs text-rose-300">{urlErrText(links.errors?.yandex_url ?? null)}</div>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <div className="text-xs text-[color:var(--pg-faint)]">2ГИС</div>
                      <input
                        className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                        value={linksForm.twogis_url}
                        onChange={(e) => setLinksForm((p) => ({ ...p, twogis_url: e.target.value }))}
                        placeholder="https://2gis.ru/..."
                        disabled={!canManageReviewLinks || linksSaving}
                      />
                      {urlErrText(links.errors?.twogis_url ?? null) ? (
                        <div className="mt-1 text-xs text-rose-300">{urlErrText(links.errors?.twogis_url ?? null)}</div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-xs text-[color:var(--pg-faint)]">
                    Включено наследование — используются дефолтные ссылки группы.
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={!canManageReviewLinks || linksSaving}
                    onClick={() => void saveReviewLinks()}
                  >
                    {linksSaving ? "Сохранение…" : "Сохранить"}
                  </Button>

                  {links.effective ? (
                    <span className="text-xs text-[color:var(--pg-faint)]">Effective: есть</span>
                  ) : (
                    <span className="text-xs text-[color:var(--pg-faint)]">Effective: нет</span>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Эффективные ссылки</div>
                <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
                  Что увидит гость при высокой оценке.
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[color:var(--pg-muted)]">Яндекс</span>
                    <span className="max-w-[70%] truncate text-[color:var(--pg-text)]">
                      {links.effective?.yandex_url || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[color:var(--pg-muted)]">2ГИС</span>
                    <span className="max-w-[70%] truncate text-[color:var(--pg-text)]">
                      {links.effective?.twogis_url || "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card-hover)] p-3">
                  <div className="text-xs text-[color:var(--pg-faint)]">Дефолт группы ({links.group_key})</div>
                  <div className="mt-2 space-y-1 text-xs text-[color:var(--pg-muted)]">
                    <div>Яндекс: {links.group_default?.yandex_url || "—"}</div>
                    <div>2ГИС: {links.group_default?.twogis_url || "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </GlassCard>

        <GlassCard>
          <div className="overflow-hidden rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--pg-card-hover)] text-[color:var(--pg-muted)]">
                <tr>
                  <th className="px-4 py-3">Название</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Активная версия</th>
                  <th className="px-4 py-3">Версий</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.survey_id} className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-3 text-[color:var(--pg-text)]">{s.name}</td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {s.is_archived ? "В архиве" : "Активен"}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">
                      {s.active_version ? `v${s.active_version}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--pg-muted)]">{s.versions_count}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" onClick={() => nav(`/admin/surveys/${s.survey_id}`)}>
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}

                {!items.length && (
                  <tr className="border-t border-[color:var(--pg-border)]">
                    <td className="px-4 py-6 text-[color:var(--pg-muted)]" colSpan={5}>
                      Пока нет опросов.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      {loc ? (
        <QrModal
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          locationId={loc.id}
          slug={loc.slug}
          title={`QR: ${loc.name}`}
        />
      ) : null}
    </AppShell>
  );
}
