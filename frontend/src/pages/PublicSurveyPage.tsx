import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import AppShell from "../components/AppShell";
import SurveyWizard from "../components/SurveyWizard";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { cn } from "../shared/cn";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import {
  getActiveSurvey,
  resolveBySlug,
  submitSubmission,
  type ActiveSurvey,
  type ResolveResponse,
} from "../shared/api/public";

type ReviewLinks = {
  yandex_url?: string;
  twogis_url?: string;
} | null | undefined;

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

    if (stype === "choice") {
      const fieldId = (s as any).field;
      if (!fieldId) continue;

      const mode = String((s as any).mode ?? "single"); // "single" | "multi"
      const rawOptions = (s as any).options;

      const options = Array.isArray(rawOptions)
        ? rawOptions
            .filter((o: any) => o && typeof o === "object")
            .map((o: any) => ({
              value: String(o.value ?? ""),
              label: String(o.label ?? o.value ?? ""),
            }))
            .filter((o: any) => o.value && o.label)
        : [];

      fields.push({
        id: fieldId,
        type: mode === "multi" ? "multi_select" : "single_select",
        label: (s as any).title ?? humanLabel(fieldId, stype),
        required: Boolean((s as any).required),
        options,
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

function toIntSafe(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function pickPrimaryRating(activeSchema: any): { fieldId: string; scale: number } | null {
  const slides = Array.isArray(activeSchema?.slides) ? activeSchema.slides : [];
  const meta = activeSchema?.meta && typeof activeSchema.meta === "object" ? activeSchema.meta : null;

  const metaField =
    (typeof meta?.scoreField === "string" && meta.scoreField) ||
    (typeof meta?.score_field === "string" && meta.score_field) ||
    (typeof meta?.primaryField === "string" && meta.primaryField) ||
    (typeof meta?.primary_field === "string" && meta.primary_field) ||
    (typeof meta?.overallField === "string" && meta.overallField) ||
    (typeof meta?.overall_field === "string" && meta.overall_field) ||
    null;

  let first: { fieldId: string; scale: number } | null = null;

  for (const s of slides) {
    if (!s || typeof s !== "object") continue;
    const stype = (s as any).type;
    if (stype !== "rating" && stype !== "nps") continue;

    const fieldId = String((s as any).field || "rating_overall");
    const scale = Number((s as any).scale ?? 10);

    if (metaField && fieldId === metaField) return { fieldId, scale };
    if (!first) first = { fieldId, scale };
  }

  return first;
}

function computeOverallScore(activeSchema: any, answers: Record<string, unknown>): { score: number; scale: number } | null {
  const primary = pickPrimaryRating(activeSchema);
  if (!primary) return null;

  const v = toIntSafe(answers[primary.fieldId]);
  if (typeof v === "number" && v >= 1 && v <= primary.scale) {
    return { score: v, scale: primary.scale };
  }

  // Optional fallback: average over all rating/nps only if same scale and the scale is 5 or 10
  const slides = Array.isArray(activeSchema?.slides) ? activeSchema.slides : [];
  const ratingSlides = slides
    .filter((s: any) => s && typeof s === "object" && (s.type === "rating" || s.type === "nps"))
    .map((s: any) => ({
      fieldId: String(s.field || "rating_overall"),
      scale: Number(s.scale ?? 10),
    }));

  if (ratingSlides.length === 0) return null;

  const scale = ratingSlides[0].scale;
  if (!ratingSlides.every((x) => x.scale === scale)) return null;
  if (scale !== 5 && scale !== 10) return null;

  const nums = ratingSlides
    .map((x) => toIntSafe(answers[x.fieldId]))
    .filter((n): n is number => typeof n === "number" && n >= 1 && n <= scale);

  if (nums.length === 0) return null;

  const avg = Math.floor(nums.reduce((a, b) => a + b, 0) / nums.length);
  return { score: avg, scale };
}

function classifyScore(score: number, scale: number): "negative" | "high" | "neutral" | "unknown" {
  if (scale === 5) {
    if (score <= 3) return "negative";
    if (score >= 4) return "high"; // CTA для "положительно" (4–5)
    return "neutral";
  }
  if (scale === 10) {
    if (score <= 6) return "negative";
    if (score >= 9) return "high"; // NPS promoter-style (9–10)
    return "neutral";
  }
  return "unknown";
}

function LinkButton({
  href,
  children,
  variant = "secondary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold",
        "focus:outline-none focus:ring-2 focus:ring-[color:var(--pg-input-border-focus)] active:scale-[0.99]",
        variant === "primary" &&
          "bg-[image:var(--pg-gradient)] text-[color:var(--pg-on-primary)] shadow-[0_12px_40px_rgba(0,0,0,0.20)] hover:opacity-95",
        variant === "secondary" &&
          "border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
      )}
    >
      {children}
      <ExternalLink className="h-4 w-4 opacity-80" />
    </a>
  );
}

function ThankYou({
  kind,
  reviewLinks,
  onReset,
}: {
  kind: "negative" | "high" | "neutral" | "unknown";
  reviewLinks: ReviewLinks;
  onReset: () => void;
}) {
  const y = (reviewLinks?.yandex_url ?? "").trim();
  const g = (reviewLinks?.twogis_url ?? "").trim();
  const hasCta = Boolean(y || g);

  if (kind === "negative") {
    return (
      <GlassCard className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-7 w-7 text-amber-300/90" />
        </div>

        <h2 className="mt-4 text-xl font-semibold text-[color:var(--pg-text)]">Нам очень жаль 🙏</h2>
        <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
          Спасибо, что поделились. Мы разберёмся в ситуации и постараемся исправить то, что пошло не так.
        </p>

        <div className="mt-6">
          <Button variant="secondary" onClick={onReset}>
            Заполнить ещё раз
          </Button>
        </div>
      </GlassCard>
    );
  }

  if (kind === "high") {
    return (
      <GlassCard className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
          <CheckCircle2 className="h-7 w-7 text-emerald-400/90" />
        </div>

        <h2 className="mt-4 text-xl font-semibold text-[color:var(--pg-text)]">Спасибо! 💛</h2>
        <p className="mt-2 text-sm text-[color:var(--pg-muted)]">Ваш отзыв отправлен.</p>

        {hasCta ? (
          <div className="mt-6 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4 text-left">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">Поделитесь впечатлением публично</div>
            <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
              Если у вас есть минутка — оставьте отзыв на удобной площадке. Это очень помогает сервису.
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {y ? <LinkButton href={y}>Яндекс Карты</LinkButton> : null}
              {g ? <LinkButton href={g}>2ГИС</LinkButton> : null}
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <Button variant="secondary" onClick={onReset}>
            Заполнить ещё раз
          </Button>
        </div>
      </GlassCard>
    );
  }

  // neutral / unknown
  return (
    <GlassCard className="text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
        <CheckCircle2 className="h-7 w-7 text-emerald-400/90" />
      </div>

      <h2 className="mt-4 text-xl font-semibold text-[color:var(--pg-text)]">Спасибо за отзыв!</h2>
      <p className="mt-2 text-sm text-[color:var(--pg-muted)]">Ваш отзыв отправлен.</p>

      <div className="mt-6">
        <Button variant="secondary" onClick={onReset}>
          Заполнить ещё раз
        </Button>
      </div>
    </GlassCard>
  );
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

  const [stage, setStage] = useState<"welcome" | "survey">("welcome");

  // Each new slug/room starts from the welcome screen.
  useEffect(() => {
    setStage("welcome");
  }, [slug, room]);

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
        const status = Number(e?.status ?? 0);

        if (status === 404) {
          setErr("Анкета не найдена или сейчас недоступна.");
        } else if (status === 403) {
          setErr("Анкета временно недоступна.");
        } else {
          setErr("Не удалось открыть анкету. Попробуйте обновить страницу чуть позже.");
        }

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
  const ready = !loading && !err && Boolean(schema) && Boolean(resolved);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        {loading && (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
          </GlassCard>
        )}

        {err && (
          <GlassCard>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
              {err}
            </div>
          </GlassCard>
        )}

        {!loading && !err && !schema && (
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">
              Для этой локации пока нет активной анкеты.
            </div>
          </GlassCard>
        )}

        {ready ? (
          <AnimatePresence mode="wait">
            {stage === "welcome" ? (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(12px)" }}
                transition={{ duration: 0.24 }}
              >
                <GlassCard>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">{greeting}</h1>
                      <p className="text-sm text-[color:var(--pg-muted)]">
                        Небольшая анкета помогает улучшать сервис. Спасибо, что делитесь впечатлением.
                      </p>
                    </div>

                    {resolved?.guest?.guest_name ? (
                      <div className="text-xs text-[color:var(--pg-faint)]">
                        Гость: <span className="text-[color:var(--pg-text)]">{resolved.guest.guest_name}</span>
                      </div>
                    ) : null}

                    {resolved?.location?.type === "room" &&
                    (resolved?.guest?.room || room || resolved?.location?.code || resolved?.location?.name) ? (
                      <div className="text-xs text-[color:var(--pg-faint)]">
                        Номер проживания:{" "}
                        <span className="text-[color:var(--pg-text)]">
                          {resolved?.guest?.room || room || resolved?.location?.code || resolved?.location?.name}
                        </span>
                      </div>
                    ) : null}

                    <div className="pt-2">
                      <Button onClick={() => setStage("survey")} className="w-full">
                        Оставить отзыв
                      </Button>
                      <div className="mt-2 text-center text-xs text-[color:var(--pg-faint)]">Займёт 1–2 минуты</div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ) : (
              <motion.div
                key="survey"
                initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(12px)" }}
                transition={{ duration: 0.24 }}
              >
                <SurveyWizard
                  schema={schema!}
                  onSubmit={onSubmit}
                  showSchemaTitle={false}
                  renderSuccess={({ answers, reset }) => {
                    const overall = computeOverallScore(active?.schema, answers);
                    const kind = overall ? classifyScore(overall.score, overall.scale) : "unknown";

                    const effectiveLinks = resolved?.review_links ?? (active as any)?.review_links ?? null;

                    return <ThankYou kind={kind} reviewLinks={effectiveLinks} onReset={reset} />;
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        ) : null}
      </div>
    </AppShell>
  );
}
