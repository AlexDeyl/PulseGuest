import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  HelpCircle,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Check,
} from "lucide-react";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import GlassCard from "./GlassCard";
import { Tooltip } from "./ui/Tooltip";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { DatePicker } from "./ui/DatePicker";

type Answers = Record<string, unknown>;

function isEmpty(v: unknown) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export default function SurveyWizard({
  schema,
  onSubmit,
}: {
  schema: SurveySchema;
  onSubmit: (answers: Answers) => Promise<void> | void;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);
  const field = schema.fields[i];

  const progress = useMemo(() => {
    return Math.round(((i + 1) / schema.fields.length) * 100);
  }, [i, schema.fields.length]);

  function setField(id: string, value: unknown) {
    setAnswers((p) => ({ ...p, [id]: value }));
  }

  function otherTextKey(fieldId: string) {
    return `${fieldId}__other_text`;
  }

  function canGoNext(f: SurveyField) {
    if (!f.required) return true;

    const v = answers[f.id];
    if (isEmpty(v)) return false;

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

  async function finish() {
    await onSubmit(answers);
    setDone(true);
  }

  if (done) {
    return (
      <GlassCard className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
          <CheckCircle2 className="h-7 w-7 text-emerald-400/90" />
        </div>
        <h2 className="mt-4 text-xl font-semibold text-[color:var(--pg-text)]">
          Спасибо!
        </h2>
        <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
          Отзыв отправлен (демо). Дальше подключим сохранение и уведомления.
        </p>
        <div className="mt-6">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false);
              setI(0);
              setAnswers({});
            }}
          >
            Заполнить ещё раз
          </Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      {/* Progress */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-xs text-[color:var(--pg-muted)]">
          <span>
            Шаг {i + 1} из {schema.fields.length}
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
          key={field.id}
          initial={{ opacity: 0, x: 26 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -26 }}
          transition={{ duration: 0.18 }}
          className="space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">
                {schema.title}
              </div>
              <h3 className="mt-1 text-xl font-semibold text-[color:var(--pg-text)]">
                {field.label}{" "}
                {field.required ? (
                  <span className="text-fuchsia-400/90">*</span>
                ) : null}
              </h3>
            </div>

            {field.hint ? (
              <Tooltip content={field.hint}>
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
            field={field}
            value={answers[field.id]}
            setValue={(v) => setField(field.id, v)}
            getExtra={(key) => answers[key]}
            setExtra={(key, v) => setField(key, v)}
          />
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => setI((x) => Math.max(0, x - 1))}
          disabled={i === 0}
          className={i === 0 ? "opacity-60" : ""}
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Button>

        {i < schema.fields.length - 1 ? (
          <Button
            onClick={() => {
              if (!canGoNext(field)) return;
              setI((x) => Math.min(schema.fields.length - 1, x + 1));
            }}
            disabled={!canGoNext(field)}
            className={!canGoNext(field) ? "opacity-60" : ""}
          >
            Далее
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={finish}
            disabled={!canGoNext(field)}
            className={!canGoNext(field) ? "opacity-60" : ""}
          >
            Отправить
          </Button>
        )}
      </div>

      <p className="mt-4 text-xs text-[color:var(--pg-faint)]">
        Нажимая «Отправить», вы соглашаетесь на обработку данных для улучшения
        сервиса.
      </p>
    </GlassCard>
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
    return (
      <DatePicker
        value={String(value ?? "")}
        onChange={(iso) => setValue(iso)}
        placeholder="Выберите дату визита"
      />
    );
  }

  if (field.type === "single_select") {
    return (
      <Select
        value={String(value ?? "")}
        onValueChange={(v) => setValue(v)}
        options={(field.options ?? []).map((o) => ({
          value: o.value,
          label: o.label,
        }))}
        placeholder="Выберите…"
      />
    );
  }

  if (field.type === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    const hasOther = arr.includes("other");
    const otherKey = `${field.id}__other_text`;
    const otherText = String(getExtra(otherKey) ?? "");

    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {(field.options ?? []).map((o) => {
            const checked = arr.includes(o.value);

            return (
              <motion.button
                key={o.value}
                type="button"
                onClick={() => {
                  const next = checked
                    ? arr.filter((x) => x !== o.value)
                    : [...arr, o.value];
                  setValue(next);

                  if (o.value === "other" && checked) {
                    setExtra(otherKey, "");
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
                  <Check
                    className={
                      checked
                        ? "h-4 w-4 text-emerald-500/90"
                        : "h-4 w-4 text-[color:var(--pg-faint)]"
                    }
                  />
                </span>

                {checked ? (
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-[color:var(--pg-border)]" />
                ) : null}
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
              <div className="text-xs font-semibold text-[color:var(--pg-muted)]">
                Уточните “Другое”
              </div>
              <input
                className={`mt-2 ${inputBase}`}
                placeholder="Например: музыка, температура, очереди…"
                value={otherText}
                onChange={(e) => setExtra(otherKey, e.target.value)}
              />
              <div className="mt-2 text-xs text-[color:var(--pg-faint)]">
                Поле обязательно, если выбрано “Другое”.
              </div>
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

  // rating_1_10
  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
      {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => {
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
