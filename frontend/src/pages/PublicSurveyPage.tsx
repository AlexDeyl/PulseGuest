import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
  if (key.includes("comment")) return "Комментарий";
  if (key.includes("rating")) return "Оценка";
  return field;
}

function adaptBackendSchema(active: ActiveSurvey): SurveySchema {
  const schema = active.schema ?? {};
  const title = schema?.title ?? "Анкета";
  const slides = schema?.slides ?? [];

  const fields: SurveyField[] = [];

  for (const s of slides) {
    if (!s || typeof s !== "object") continue;

    const stype = (s as any).type;

    if (stype === "rating" || stype === "nps") {
      const fieldId = (s as any).field || "rating_overall";
      fields.push({
        id: fieldId,
        type: "rating_1_10",
        label: (s as any).title ?? humanLabel(fieldId, stype),
        required: Boolean((s as any).required),
        min: 0,
        max: Number((s as any).scale ?? 10),
      });
    }

    if (stype === "text") {
      const fieldId = (s as any).field;
      if (!fieldId) continue;
      fields.push({
        id: fieldId,
        type: "textarea",
        label: (s as any).title ?? humanLabel(fieldId, stype),
        required: Boolean((s as any).required),
        placeholder: (s as any).placeholder ?? "",
        hint: (s as any).hint ?? "",
      });
    }

    if (stype === "contact") {
      const ff = (s as any).fields ?? [];
      if (!Array.isArray(ff)) continue;

      for (const f of ff) {
        if (!f || typeof f !== "object") continue;
        const fieldId = (f as any).field;
        if (!fieldId) continue;

        // SurveyWizard поддерживает "text"/"textarea"/"rating_1_10".
        // Email поле пока рендерим как text (валидирует сервер).
        fields.push({
          id: fieldId,
          type: "text",
          label: (f as any).label ?? humanLabel(fieldId, (f as any).type),
          required: Boolean((f as any).required),
          placeholder:
            (f as any).type === "email" ? "name@example.com" : (f as any).placeholder ?? "",
        });
      }
    }
  }

  return { id: String(active.version_id), title, fields };
}

export default function PublicSurveyPage(props: { slug?: string }) {
  const params = useParams();
  const slug = props.slug ?? params.slug ?? "main";

  const [searchParams] = useSearchParams();
  const room = useMemo(() => {
    const r = (searchParams.get("room") || "").trim();
    return r || null;
  }, [searchParams]);

  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [active, setActive] = useState<ActiveSurvey | null>(null);
  const [schema, setSchema] = useState<SurveySchema | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const r = await resolveBySlug(slug, room || undefined);
        if (!alive) return;

        setResolved(r);

        let a = r.active as any;

        // fallback: legacy endpoint
        if (!a) {
          const fallback = await getActiveSurvey(r.location.id);
          a = (fallback as any)?.active ?? (fallback as any);
        }

        if (!a || !a.schema) {
          setActive(null);
          setSchema(null);
          return;
        }

        setActive(a);
        setSchema(adaptBackendSchema(a));
      } catch (e: any) {
        const detail = e?.detail ? JSON.stringify(e.detail) : "";
        setErr(`Не удалось загрузить анкету\n${detail}`);
        setResolved(null);
        setActive(null);
        setSchema(null);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [slug, room]);

  async function onSubmit(answers: Record<string, unknown>) {
    if (!resolved) throw new Error("No resolved");
    if (!active) throw new Error("No active");

    const meta: Record<string, unknown> = {
      slug,
      source: "web",
    };

    if (room) meta.room = room;
    if (resolved.guest?.stay_id) meta.stay_id = resolved.guest.stay_id;

    await submitSubmission({
      location_id: resolved.location.id,
      version_id: active.version_id,
      answers,
      meta,
      // legacy shortcuts (server всё равно перепроверит)
      room: room || undefined,
      stay_id: resolved.guest?.stay_id,
    });
  }

  const greeting = resolved?.greeting ?? "Оставьте отзыв за 30 секунд";

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <GlassCard>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">{greeting}</h1>
            <p className="text-sm text-[color:var(--pg-muted)]">
              Небольшая анкета помогает улучшать сервис. Спасибо, что делитесь впечатлением.
            </p>

            {room && (
              <div className="text-xs text-[color:var(--pg-faint)]">
                Комната: <span className="text-[color:var(--pg-text)]">{room}</span>
              </div>
            )}

            {resolved?.guest?.guest_name && (
              <div className="text-xs text-[color:var(--pg-faint)]">
                Гость:{" "}
                <span className="text-[color:var(--pg-text)]">{resolved.guest.guest_name}</span>
              </div>
            )}
          </div>
        </GlassCard>

        {loading && (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
          </GlassCard>
        )}

        {err && (
          <GlassCard>
            <div className="whitespace-pre-wrap text-sm text-red-600">{err}</div>
          </GlassCard>
        )}

        {!loading && !err && !schema && (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">
              Для этой локации пока нет активной анкеты.
            </div>
          </GlassCard>
        )}

        {!loading && !err && schema && (
          <SurveyWizard schema={schema} onSubmit={onSubmit} />
        )}
      </div>
    </AppShell>
  );
}
