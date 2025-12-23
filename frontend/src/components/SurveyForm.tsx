import { useMemo, useState } from "react";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";

type Answers = Record<string, unknown>;

function isEmpty(v: unknown) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export default function SurveyForm({
  schema,
  onSubmit,
}: {
  schema: SurveySchema;
  onSubmit: (answers: Answers) => Promise<void> | void;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const requiredIds = useMemo(
    () => schema.fields.filter((f) => f.required).map((f) => f.id),
    [schema.fields]
  );

  const canSubmit = useMemo(() => {
    return requiredIds.every((id) => !isEmpty(answers[id]));
  }, [answers, requiredIds]);

  function setField(id: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  function validate(fields: SurveyField[]) {
    const e: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && isEmpty(answers[f.id])) {
        e[f.id] = "Это поле обязательно";
      }
    }
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const e2 = validate(schema.fields);
    if (Object.keys(e2).length) {
      setErrors(e2);
      return;
    }
    await onSubmit(answers);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
        <h2 className="text-lg font-semibold">Спасибо!</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Ответ отправлен (пока демо). Дальше подключим сохранение в БД и уведомления.
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            setAnswers({});
            setErrors({});
          }}
          className="mt-6 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-neutral-50"
        >
          Заполнить ещё раз
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {schema.fields.map((f) => {
        const err = errors[f.id];
        const base =
          "mt-2 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";
        const border = err ? "border-red-300" : "border-neutral-200";

        return (
          <div key={f.id}>
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-neutral-800">
                {f.label} {f.required ? <span className="text-red-500">*</span> : null}
              </label>
              {err ? <span className="text-xs text-red-600">{err}</span> : null}
            </div>

            {f.type === "text" && (
              <input
                className={`${base} ${border}`}
                placeholder={f.placeholder}
                value={String(answers[f.id] ?? "")}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            )}

            {f.type === "textarea" && (
              <textarea
                className={`${base} ${border} resize-none`}
                rows={4}
                placeholder={f.placeholder}
                value={String(answers[f.id] ?? "")}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            )}

            {f.type === "date" && (
              <input
                type="date"
                className={`${base} ${border}`}
                value={String(answers[f.id] ?? "")}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            )}

            {f.type === "range" && (
              <div className="mt-3">
                <input
                  type="range"
                  min={f.min ?? 0}
                  max={f.max ?? 100}
                  value={Number(answers[f.id] ?? f.min ?? 0)}
                  onChange={(e) => setField(f.id, Number(e.target.value))}
                  className="w-full"
                />
                <div className="mt-1 flex justify-between text-xs text-neutral-500">
                  <span>{f.min ?? 0}</span>
                  <span className="font-semibold text-neutral-700">
                    {Number(answers[f.id] ?? f.min ?? 0)}
                  </span>
                  <span>{f.max ?? 100}</span>
                </div>
              </div>
            )}

            {f.type === "single_select" && (
              <select
                className={`${base} ${border}`}
                value={String(answers[f.id] ?? "")}
                onChange={(e) => setField(f.id, e.target.value)}
              >
                <option value="">Выберите…</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}

            {f.type === "multi_select" && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(f.options ?? []).map((o) => {
                  const arr = Array.isArray(answers[f.id]) ? (answers[f.id] as string[]) : [];
                  const checked = arr.includes(o.value);
                  return (
                    <label
                      key={o.value}
                      className={[
                        "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                        checked ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked ? arr.filter((x) => x !== o.value) : [...arr, o.value];
                          setField(f.id, next);
                        }}
                        className="hidden"
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            )}

            {f.type === "rating_1_10" && (
              <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                  const active = Number(answers[f.id]) === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setField(f.id, n)}
                      className={[
                        "h-10 rounded-xl border text-sm font-semibold transition",
                        active
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
                      ].join(" ")}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={!canSubmit}
        className={[
          "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition",
          !canSubmit
            ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
            : "bg-neutral-900 text-white hover:opacity-90",
        ].join(" ")}
      >
        Отправить
      </button>

      <p className="text-xs text-neutral-500">
        Нажимая «Отправить», вы соглашаетесь на обработку данных для улучшения качества сервиса.
      </p>
    </form>
  );
}
