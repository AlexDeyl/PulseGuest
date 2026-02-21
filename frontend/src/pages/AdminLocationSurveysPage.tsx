import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

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

function errToText(e: any, devEnabled: boolean) {
  const base = "Не удалось загрузить опросы. Попробуйте позже.";
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

  const locationId = useMemo(() => Number(params.locationId || 0), [params.locationId]);

  const [loc, setLoc] = useState<LocationDto | null>(null);
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [newName, setNewName] = useState("Опрос локации");

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

  async function createSurvey() {
    if (!locationId) return;
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
                <Button variant="secondary" onClick={() => nav("/admin")}>Назад</Button>
              </div>

              {err && <div className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{err}</div>}
              {loading && <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Загрузка…</div>}
            </div>

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
          </div>
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
                      Пока нет опросов. Создайте первый через “Создать”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
