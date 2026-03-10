import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle, CheckCircle2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import GlassCard from "./GlassCard";
import { Tooltip } from "./ui/Tooltip";
import { Button } from "./ui/Button";
import { DatePicker } from "./ui/DatePicker";

type Answers = Record<string, unknown>;

function isEmpty(v: unknown) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function otherTextKey(fieldId: string) {
  return `${fieldId}__other_text`;
}

function normalizeOptions(field: SurveyField) {
  const raw = Array.isArray((field as any).options) ? ((field as any).options as any[]) : [];
  return raw
    .filter((o) => o && typeof o === "object")
    .map((o) => {
      const value = typeof (o as any).value === "string" ? (o as any).value : "";
      const labelRaw = (o as any).label;
      const label =
        typeof labelRaw === "string" && labelRaw.trim().length > 0
          ? labelRaw
          : typeof value === "string"
            ? value
            : "";
      return { value: value.trim(), label: label.trim() };
    })
    .filter((o) => o.value.length > 0 && o.label.length > 0);
}

export default function SurveyWizard({
  schema,
  onSubmit,
  submitLabel = "Отправить",
  successTitle = "Спасибо!",
  successText = "Ваш отзыв отправлен.",
  showSchemaTitle = true,
  schemaTitleOverride,
  renderSuccess,
}: {
  schema: SurveySchema;
  onSubmit: (answers: Answers) => Promise<void> | void;
  submitLabel?: string;
  successTitle?: string;
  successText?: string;
  showSchemaTitle?: boolean;
  schemaTitleOverride?: string;
  renderSuccess?: (ctx: { answers: Answers; reset: () => void }) => ReactNode;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const total = fields.length;

  const idx = total > 0 ? Math.min(i, total - 1) : 0;
  const field: SurveyField | null = total > 0 ? fields[idx] : null;

  const progress = total > 0 ? Math.round(((idx + 1) / total) * 100) : 0;
  const headerTitle = (schemaTitleOverride ?? schema.title ?? "").trim();

  function setField(id: string, value: unknown) {
    setAnswers((p) => ({ ...p, [id]: value }));
  }

  function canGoNext(f: SurveyField | null) {
    if (!f) return false;
    if (!f.required) return true;

    const v = answers[f.id];
    if (isEmpty(v)) return false;

    // ✅ "other" rule for single_select too
    if (f.type === "single_select") {
      const s = String(v ?? "");
      if (s === "other") {
        const otherText = String(answers[otherTextKey(f.id)] ?? "");
        if (otherText.trim().length === 0) return false;
      }
    }

    // existing rule for multi_select
    if (f.type === "multi_select") {
      const arr = Array.isArray(v) ? (v as string[]) : [];
      const hasOther = arr.includes("other");
      if (hasOther) {
        const otherText = String(answers[otherTextKey(f.id)] ?? "");
        if (otherText.trim().length === 0) return false;
      }
    }

    return true;
  }

  function reset() {
    setDone(false);
    setI(0);
    setAnswers({});
    setSubmitError(null);
    setSubmitting(false);
  }

  async function finish() {
    if (!field) return;
    if (submitting) return;
    if (!canGoNext(field)) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      await onSubmit(answers);
      setDone(true);
    } catch (e: any) {
      const msg =
        typeof e?.detail === "string"
          ? e.detail
          : e?.detail
            ? JSON.stringify(e.detail)
            : e?.message
              ? String(e.message)
              : "Не удалось отправить ответы";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (total === 0) {
    return (
      <GlassCard>
        <div className="text-lg font-semibold text-[color:var(--pg-text)]">{schema?.title ?? "Анкета"}</div>
        <div className="mt-2 text-sm text-[color:var(--pg-muted)]">Анкета пока не настроена.</div>
      </GlassCard>
    );
  }

  const f = field!;

  return (
    <AnimatePresence mode="wait">
      {done ? (
        <motion.div
          key="done"
          initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(12px)" }}
          transition={{ duration: 0.22 }}
        >
          {renderSuccess ? (
            <>{renderSuccess({ answers, reset })}</>
          ) : (
            <GlassCard className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                <CheckCircle2 className="h-7 w-7 text-emerald-400/90" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-[color:var(--pg-text)]">{successTitle}</h2>
              <p className="mt-2 text-sm text-[color:var(--pg-muted)]">{successText}</p>

              <div className="mt-6">
                <Button variant="secondary" onClick={reset}>
                  Заполнить ещё раз
                </Button>
              </div>
            </GlassCard>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="form"
          initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(12px)" }}
          transition={{ duration: 0.22 }}
        >
          <GlassCard>
            {/* Progress */}
            <div className="mb-5">
              <div className="flex items-center justify-between text-xs text-[color:var(--pg-muted)]">
                <span>
                  Шаг {idx + 1} из {total}
                </span>
                <span>{progress}%</span>
              </div>

              <div className="mt-2 h-2 w-full rounded-full bg-[color:var(--pg-card)]">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${progress}%`,
                    backgroundImage: "var(--pg-gradient)",
                  }}
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={f.id}
                initial={{ opacity: 0, x: 26 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -26 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {showSchemaTitle && headerTitle ? (
                      <div className="text-sm text-[color:var(--pg-muted)]">{headerTitle}</div>
                    ) : null}
                    <h3 className="mt-1 text-xl font-semibold text-[color:var(--pg-text)]">
                      {f.label} {f.required ? <span className="text-fuchsia-400/90">*</span> : null}
                    </h3>
                  </div>

                  {f.hint ? (
                    <Tooltip content={f.hint}>
                      <button
                        type="button"
                        className="rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-2 text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
                        aria-label="Подсказка"
                      >
                        <HelpCircle className="h-5 w-5" />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>

                <FieldRenderer
                  field={f}
                  value={answers[f.id]}
                  setValue={(v) => setField(f.id, v)}
                  getExtra={(key) => answers[key]}
                  setExtra={(key, v) => setField(key, v)}
                />
              </motion.div>
            </AnimatePresence>

            {submitError ? (
              <div
                role="alert"
                className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
              >
                {submitError}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setSubmitError(null);
                  setI((x) => Math.max(0, x - 1));
                }}
                disabled={idx === 0 || submitting}
                className={idx === 0 || submitting ? "opacity-60" : ""}
              >
                <ArrowLeft className="h-4 w-4" />
                Назад
              </Button>

              {idx < total - 1 ? (
                <Button
                  onClick={() => {
                    if (submitting) return;
                    if (!canGoNext(f)) return;

                    setSubmitError(null);
                    setI((x) => Math.min(total - 1, x + 1));
                  }}
                  disabled={submitting || !canGoNext(f)}
                  className={submitting || !canGoNext(f) ? "opacity-60" : ""}
                >
                  Далее
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={finish}
                  disabled={submitting || !canGoNext(f)}
                  className={submitting || !canGoNext(f) ? "opacity-60" : ""}
                >
                  {submitting ? "Отправляем…" : submitLabel}
                </Button>
              )}
            </div>

            <p className="mt-4 text-xs text-[color:var(--pg-faint)]">
              Нажимая «Отправить», вы соглашаетесь на обработку данных для улучшения сервиса.
            </p>
          </GlassCard>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FieldRenderer({
  field,
  value,
  setValue,
  getExtra,
  setExtra,
}: {
  field: SurveyField;
  value: unknown;
  setValue: (v: unknown) => void;
  getExtra: (key: string) => unknown;
  setExtra: (key: string, v: unknown) => void;
}) {
  const inputBase =
    "w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none placeholder:text-[color:var(--pg-placeholder)] focus:border-[color:var(--pg-input-border-focus)]";

  if (field.type === "text") {
    return (
      <input
        className={inputBase}
        placeholder={field.placeholder}
        value={String(value ?? "")}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        className={`${inputBase} resize-none`}
        rows={4}
        placeholder={field.placeholder}
        value={String(value ?? "")}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  }

  if (field.type === "date") {
    return <DatePicker value={String(value ?? "")} onChange={(iso) => setValue(iso)} placeholder="Выберите дату визита" />;
  }

  // ✅ single_select -> кнопки (radio)
  if (field.type === "single_select") {
    const options = normalizeOptions(field);
    const selected = String(value ?? "");
    const oKey = otherTextKey(field.id);
    const otherText = String(getExtra(oKey) ?? "");
    const hasOther = selected === "other";

    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const checked = selected === o.value;

            return (
              <motion.button
                key={o.value}
                type="button"
                onClick={() => {
                  setValue(o.value);
                  if (o.value !== "other") setExtra(oKey, "");
                }}
                whileTap={{ scale: 0.99 }}
                className={[
                  "group relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition",
                  checked
                    ? "border-[color:var(--pg-input-border-focus)] bg-[color:var(--pg-card-hover)] text-[color:var(--pg-text)]"
                    : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-muted)] hover:bg-[color:var(--pg-card-hover)] hover:text-[color:var(--pg-text)]",
                ].join(" ")}
              >
                <span className="font-medium">{o.label}</span>

                <span
                  className={[
                    "grid h-6 w-6 place-items-center rounded-xl border transition",
                    checked
                      ? "border-[color:var(--pg-input-border-focus)] bg-[color:var(--pg-card)]"
                      : "border-[color:var(--pg-border)] bg-transparent",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <Check className={checked ? "h-4 w-4 text-emerald-500/90" : "h-4 w-4 text-[color:var(--pg-faint)]"} />
                </span>

                {checked ? <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-[color:var(--pg-border)]" /> : null}
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence>
          {hasOther ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4"
            >
              <div className="text-xs font-semibold text-[color:var(--pg-muted)]">Уточните “Другое”</div>
              <input
                className={`mt-2 ${inputBase}`}
                placeholder="Например: музыка, температура, очереди…"
                value={otherText}
                onChange={(e) => setExtra(oKey, e.target.value)}
              />
              <div className="mt-2 text-xs text-[color:var(--pg-faint)]">Поле обязательно, если выбрано “Другое”.</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  // multi_select -> кнопки (checkbox) — как было
  if (field.type === "multi_select") {
    const options = normalizeOptions(field);

    const arr = Array.isArray(value) ? (value as string[]) : [];
    const hasOther = arr.includes("other");
    const oKey = otherTextKey(field.id);
    const otherText = String(getExtra(oKey) ?? "");

    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const checked = arr.includes(o.value);

            return (
              <motion.button
                key={o.value}
                type="button"
                onClick={() => {
                  const next = checked ? arr.filter((x) => x !== o.value) : [...arr, o.value];
                  setValue(next);

                  if (o.value === "other" && checked) {
                    setExtra(oKey, "");
                  }
                }}
                whileTap={{ scale: 0.99 }}
                className={[
                  "group relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition",
                  checked
                    ? "border-[color:var(--pg-input-border-focus)] bg-[color:var(--pg-card-hover)] text-[color:var(--pg-text)]"
                    : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-muted)] hover:bg-[color:var(--pg-card-hover)] hover:text-[color:var(--pg-text)]",
                ].join(" ")}
              >
                <span className="font-medium">{o.label}</span>

                <span
                  className={[
                    "grid h-6 w-6 place-items-center rounded-xl border transition",
                    checked
                      ? "border-[color:var(--pg-input-border-focus)] bg-[color:var(--pg-card)]"
                      : "border-[color:var(--pg-border)] bg-transparent",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <Check className={checked ? "h-4 w-4 text-emerald-500/90" : "h-4 w-4 text-[color:var(--pg-faint)]"} />
                </span>

                {checked ? <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-[color:var(--pg-border)]" /> : null}
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence>
          {hasOther ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4"
            >
              <div className="text-xs font-semibold text-[color:var(--pg-muted)]">Уточните “Другое”</div>
              <input
                className={`mt-2 ${inputBase}`}
                placeholder="Например: музыка, температура, очереди…"
                value={otherText}
                onChange={(e) => setExtra(oKey, e.target.value)}
              />
              <div className="mt-2 text-xs text-[color:var(--pg-faint)]">Поле обязательно, если выбрано “Другое”.</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  if (field.type === "range") {
    const v = Number(value ?? field.min ?? 0);
    return (
      <div>
        <input
          type="range"
          min={field.min ?? 0}
          max={field.max ?? 100}
          value={v}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-full accent-[color:var(--pg-text)]"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-[color:var(--pg-muted)]">
          <span>{field.min ?? 0}</span>
          <span className="rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-[color:var(--pg-text)]">
            {v}
          </span>
          <span>{field.max ?? 100}</span>
        </div>
      </div>
    );
  }

  // rating_1_10 (и шкалы 1–5/1–10 через field.max)
  const max = Math.max(1, Math.min(10, Number((field as any).max ?? 10)));

  return (
    <div className={["grid gap-2", max <= 5 ? "grid-cols-5" : "grid-cols-5 sm:grid-cols-10"].join(" ")}>
      {Array.from({ length: max }, (_, k) => k + 1).map((n) => {
        const active = Number(value) === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setValue(n)}
            className={[
              "h-11 rounded-2xl border text-sm font-semibold transition",
              active
                ? "border-[color:var(--pg-input-border-focus)] bg-[color:var(--pg-card-hover)] text-[color:var(--pg-text)]"
                : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-muted)] hover:bg-[color:var(--pg-card-hover)] hover:text-[color:var(--pg-text)]",
            ].join(" ")}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
