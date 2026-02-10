import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import SurveyWizard from "../components/SurveyWizard";
import GlassCard from "../components/GlassCard";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import {
  getActiveSurvey,
  resolveBySlug,
  submitSubmission,
  type ActiveSurvey,
  type ResolveResponse,
} from "../shared/api/public";

function humanLabel(field: string, ftype?: string) {
  const key = field.toLowerCase();
  if (ftype === "email" || key.includes("email")) return "Email";
  if (key === "name" || key.includes("first_name")) return "Имя";
  if (key.includes("phone") || key.includes("tel")) return "Телефон";
  return field;
}

function adaptBackendSchema(
  schema: Record<string, unknown> | null | undefined,
  locationName?: string
): SurveySchema | null {
  const title =
    (schema?.title as string | undefined) ?? locationName ?? "Анкета гостя";
  const slides = (schema?.slides as unknown[] | undefined) ?? [];
  if (!Array.isArray(slides) || slides.length === 0) return null;

  const fields: SurveyField[] = [];

  for (const slide of slides) {
    if (!slide || typeof slide !== "object") continue;
    const s = slide as Record<string, unknown>;
    const stype = String(s.type ?? "");
    const slideTitle = (s.title as string | undefined) ?? "Вопрос";

    if (stype === "rating" || stype === "nps") {
      const fieldId =
        (s.field as string | undefined) ??
        (s.id as string | undefined) ??
        `rating_${fields.length}`;
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
      const fieldId =
        (s.field as string | undefined) ??
        (s.id as string | undefined) ??
        `text_${fields.length}`;
      fields.push({
        id: fieldId,
        type: "textarea",
        label: slideTitle,
        required: Boolean(s.required),
        placeholder:
          typeof s.placeholder === "string" ? s.placeholder : "Напишите пару слов…",
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
          hint:
            ftype === "email"
              ? "Email нужен только чтобы связаться при необходимости."
              : undefined,
        });
      }
      continue;
    }
  }

  if (fields.length === 0) return null;

  return {
    id: "active",
    title,
    fields,
  };
}

export default function PublicSurveyPage({ slug: slugProp }: { slug?: string }) {
  const params = useParams();
  const slug = useMemo(
    () => slugProp ?? params.slug ?? "main",
    [params.slug, slugProp]
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [active, setActive] = useState<ActiveSurvey | null>(null);
  const [uiSchema, setUiSchema] = useState<SurveySchema | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const r = await resolveBySlug(slug);
      setResolved(r);

      // 1) Prefer active from resolve
      if (r.active?.schema) {
        setActive(r.active);
        setUiSchema(
          adaptBackendSchema(r.active.schema as Record<string, unknown>, r.location?.name)
        );
        setLoading(false);
        return;
      }

      // 2) Fallback: active-survey by location_id
      const fallback = await getActiveSurvey(r.location.id);
      const a = (fallback as any)?.active as ActiveSurvey | null | undefined;
      setActive(a ?? null);
      setUiSchema(adaptBackendSchema((a?.schema as any) ?? null, r.location?.name));
      setLoading(false);
    } catch (e: any) {
      const detail = e?.detail ?? e?.message ?? "Ошибка загрузки";
      setError(typeof detail === "string" ? detail : JSON.stringify(detail));
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const locationName = resolved?.location?.name ?? "PulseGuest";

  const wc: any =
    active?.widget_config ??
    resolved?.active?.widget_config ??
    null;

  const submitLabel: string = wc?.texts?.submit ?? "Отправить";
  const successText: string = wc?.texts?.thanks ?? "Ваш отзыв отправлен.";

  return (
      <AppShell>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-4">
            <GlassCard>
              <div className="text-sm text-[color:var(--pg-muted)]">{locationName}</div>
              <h1 className="mt-1 text-3xl font-semibold text-[color:var(--pg-text)]">
                Оставьте отзыв за 30 секунд
              </h1>
              <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                {resolved?.greeting ??
                  "Небольшая анкета помогает улучшать сервис. Спасибо, что делитесь впечатлением."}
              </p>
            </GlassCard>

            {loading ? (
              <GlassCard>
                <div className="text-sm text-[color:var(--pg-muted)]">Загружаем анкету…</div>
                <div className="mt-3 h-10 w-2/3 animate-pulse rounded-2xl bg-[color:var(--pg-card-hover)]" />
                <div className="mt-3 h-28 animate-pulse rounded-2xl bg-[color:var(--pg-card-hover)]" />
              </GlassCard>
            ) : error ? (
              <GlassCard>
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                  Не удалось загрузить анкету
                </div>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3 text-xs text-[color:var(--pg-muted)]">
                  {error}
                </pre>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={load}
                    className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-2 text-sm text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
                  >
                    Повторить
                  </button>
                </div>
              </GlassCard>
            ) : !uiSchema ? (
              <GlassCard>
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                  Активный опрос не найден
                </div>
                <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                  Похоже, для этой локации пока не включена активная версия анкеты.
                </p>
              </GlassCard>
            ) : (
              <SurveyWizard
                schema={uiSchema}
                submitLabel={submitLabel}
                successText={successText}
                onSubmit={async (answers) => {
                  const location_id = resolved?.location?.id;
                  if (!location_id) throw new Error("location_id not resolved");

                  await submitSubmission({
                    location_id,
                    version_id: active?.version_id ?? undefined,
                    answers: answers as Record<string, unknown>,
                    meta: { slug, source: "web" },
                  });
                }}
              />
            )}
          </section>

          <aside className="space-y-4">
            <GlassCard>
              <h3 className="text-sm font-semibold text-[color:var(--pg-text)]">
                Почему это удобно
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--pg-muted)]">
                <li>• Быстро — 1–2 минуты</li>
                <li>• Красиво на мобилке</li>
                <li>• Ответы сразу попадают в аналитику</li>
              </ul>
            </GlassCard>

            <GlassCard>
              <h3 className="text-sm font-semibold text-[color:var(--pg-text)]">
                Тех.инфо
              </h3>
              <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                slug: <span className="font-mono">{slug}</span>
                <br />
                location_id:{" "}
                <span className="font-mono">{resolved?.location?.id ?? "—"}</span>
                <br />
                version_id:{" "}
                <span className="font-mono">{active?.version_id ?? "—"}</span>
              </p>
            </GlassCard>
          </aside>
        </div>
      </AppShell>
    );
  }
