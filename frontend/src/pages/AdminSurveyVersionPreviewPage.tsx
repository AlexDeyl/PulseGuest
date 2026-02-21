import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import SurveyWizard from "../components/SurveyWizard";
import { Button } from "../components/ui/Button";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import { useAuth } from "../shared/auth";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";

type Resp = {
  id: number;
  survey_id: number;
  location_id: number;
  version: number;
  is_active: boolean;
  schema: any;
  widget_config: any;
  created_at: string | null;
};

function errToText(e: any, devEnabled: boolean) {
  const base = "Не удалось открыть предпросмотр. Попробуйте позже.";
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

function humanLabel(field: string, ftype?: string) {
  const key = field.toLowerCase();
  if (ftype === "email" || key.includes("email")) return "Email";
  if (key === "name" || key.includes("first_name")) return "Имя";
  if (key.includes("phone") || key.includes("tel")) return "Телефон";
  return field;
}

function adaptBackendSchema(schema: Record<string, unknown> | null | undefined, locationName?: string): SurveySchema | null {
  const title = (schema?.title as string | undefined) ?? locationName ?? "Анкета гостя";
  const slides = (schema?.slides as unknown[] | undefined) ?? [];
  if (!Array.isArray(slides) || slides.length === 0) return null;

  const fields: SurveyField[] = [];

  for (const slide of slides) {
    if (!slide || typeof slide !== "object") continue;
    const s = slide as Record<string, unknown>;
    const stype = String(s.type ?? "");
    const slideTitle = (s.title as string | undefined) ?? "Вопрос";

    if (stype === "rating" || stype === "nps") {
      const fieldId = (s.field as string | undefined) ?? (s.id as string | undefined) ?? `rating_${fields.length}`;
      fields.push({
        id: fieldId,
        type: "rating_1_10",
        label: slideTitle,
        required: Boolean(s.required),
        hint: typeof s.hint === "string" ? s.hint : undefined,
      });
      continue;
    }

    if (stype === "text") {
      const fieldId = (s.field as string | undefined) ?? (s.id as string | undefined) ?? `text_${fields.length}`;
      fields.push({
        id: fieldId,
        type: "textarea",
        label: slideTitle,
        required: Boolean(s.required),
        placeholder: typeof s.placeholder === "string" ? s.placeholder : "Напишите пару слов…",
        hint: typeof s.hint === "string" ? s.hint : undefined,
      });
      continue;
    }

    if (stype === "contact") {
      const contactFields = (s.fields as unknown[] | undefined) ?? [];
      if (!Array.isArray(contactFields)) continue;

      for (const f of contactFields) {
        if (!f || typeof f !== "object") continue;
        const ff = f as Record<string, unknown>;
        const fieldId = ff.field as string | undefined;
        if (!fieldId) continue;

        const ftype = ff.type as string | undefined;
        fields.push({
          id: fieldId,
          type: "text",
          label: humanLabel(fieldId, ftype),
          required: Boolean(ff.required),
          placeholder: ftype === "email" ? "name@example.com" : undefined,
          hint: ftype === "email" ? "Email нужен только чтобы связаться при необходимости." : undefined,
        });
      }
    }
  }

  if (fields.length === 0) return null;

  return { id: "preview", title, fields };
}

export default function AdminSurveyVersionPreviewPage() {
  const nav = useNavigate();
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();

  const params = useParams();
  const locationId = Number(params.locationId || 0);
  const surveyId = Number(params.surveyId || 0);
  const versionId = Number(params.versionId || 0);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [uiSchema, setUiSchema] = useState<SurveySchema | null>(null);

  const location = useMemo(() => {
    const locs = me?.allowed_locations ?? [];
    return locs.find((l: any) => l.id === locationId) ?? null;
  }, [me, locationId]);

  useEffect(() => {
    if (!versionId || versionId <= 0) {
      nav("/admin", { replace: true });
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const resp = await adminJson<Resp>(`/api/admin/admin/survey-versions/${versionId}`);
        if (cancelled) return;

        setData(resp);
        setUiSchema(adaptBackendSchema(resp.schema as any, location?.name));
      } catch (e: any) {
        if (cancelled) return;
        setErr(errToText(e, devEnabled));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [versionId, nav, location?.name, devEnabled]);

  const wc: any = data?.widget_config ?? null;
  const submitLabel: string = wc?.texts?.submit ?? "Отправить";
  const successText: string = wc?.texts?.thanks ?? "Ваш отзыв отправлен.";

  const openPublic = () => {
    if (!location?.slug) return;
    window.open(`/${location.slug}`, "_blank", "noreferrer");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">
                Предпросмотр анкеты
              </h1>

              <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                Локация: <span className="text-[color:var(--pg-text)]">{location?.name ?? "—"}</span>{" "}
                • Версия: <span className="text-[color:var(--pg-text)]">{data ? `v${data.version}` : "—"}</span>
                {data?.is_active ? <span className="ml-2 text-[color:var(--pg-text)]">• Активная</span> : null}
                {devEnabled ? (
                  <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">
                    loc_id={locationId} survey_id={surveyId} version_id={versionId}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3 text-sm text-[color:var(--pg-muted)]">
                Это предпросмотр “как у гостя”. Ответы <b>никуда не отправляются</b>.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => nav(`/admin/surveys/${surveyId}`)}>
                Назад к опросу
              </Button>

              {devEnabled && (
                <Button variant="secondary" onClick={() => nav(`/admin/survey-versions/${versionId}`)}>
                  Редактор (Dev)
                </Button>
              )}

              <Button variant="secondary" onClick={openPublic} disabled={!location?.slug}>
                Открыть Public
              </Button>
            </div>
          </div>
        </GlassCard>

        {loading ? (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
          </GlassCard>
        ) : err ? (
          <GlassCard className="border border-rose-500/30">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">Ошибка</div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-rose-300">{err}</div>
          </GlassCard>
        ) : !uiSchema ? (
          <GlassCard>
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">Анкета пустая</div>
            <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
              В этой версии нет вопросов или схема не распозналась.
            </p>
          </GlassCard>
        ) : (
          <section className="space-y-4">
            <GlassCard>
              <div className="text-sm text-[color:var(--pg-muted)]">{location?.name ?? "PulseGuest"}</div>
              <h2 className="mt-1 text-3xl font-semibold text-[color:var(--pg-text)]">
                Оставьте отзыв за 30 секунд
              </h2>
              <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                Предпросмотр должен выглядеть так же, как на public-странице.
              </p>
            </GlassCard>

            <SurveyWizard
              schema={uiSchema}
              submitLabel={submitLabel}
              successText={successText}
              onSubmit={async () => {
                await new Promise((r) => setTimeout(r, 150));
              }}
            />

            {devEnabled && (
              <GlassCard>
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Dev</div>
                <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  slug: <span className="font-mono">{location?.slug ?? "—"}</span>
                  <br />
                  submitLabel: <span className="font-mono">{submitLabel}</span>
                  <br />
                  successText: <span className="font-mono">{successText}</span>
                </div>
              </GlassCard>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
