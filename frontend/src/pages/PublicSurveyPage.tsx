import { useMemo, useState } from "react";
import AppShell from "../components/AppShell";

type Rating = number | null;

export default function PublicSurveyPage() {
  const [rating, setRating] = useState<Rating>(null);
  const [category, setCategory] = useState("Ресторан");
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const ratingLabel = useMemo(() => {
    if (rating == null) return "Оценка не выбрана";
    if (rating <= 6) return "Есть что улучшить";
    if (rating <= 8) return "Хорошо";
    return "Отлично";
  }, [rating]);

  function submitMock(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    // тут позже будет реальный POST /api/public/surveys/{id}/submit
  }

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Анкета гостя</h1>
              <p className="mt-1 text-sm text-neutral-600">
                Пример “standalone” формы. Этот же рендер будет использоваться в
                виджете на сайте.
              </p>
            </div>

            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-700">
              DEMO
            </span>
          </div>

          {!submitted ? (
            <form onSubmit={submitMock} className="mt-6 space-y-6">
              <div>
                <label className="text-sm font-medium text-neutral-800">
                  Где вы сейчас?
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
                >
                  <option>Ресторан</option>
                  <option>Отель</option>
                  <option>Конференц-зал</option>
                </select>
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <label className="text-sm font-medium text-neutral-800">
                    Оцените ваш опыт (1–10)
                  </label>
                  <span className="text-xs text-neutral-500">{ratingLabel}</span>
                </div>

                <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                    const active = rating === n;
                    return (
                      <button
                        type="button"
                        key={n}
                        onClick={() => setRating(n)}
                        className={[
                          "h-10 rounded-xl border text-sm font-medium transition",
                          active
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
                        ].join(" ")}
                        aria-pressed={active}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex justify-between text-xs text-neutral-500">
                  <span>Плохо</span>
                  <span>Отлично</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-neutral-800">
                  Комментарий
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  placeholder="Что понравилось? Что улучшить?"
                  className="mt-2 w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
                />
              </div>

              <button
                type="submit"
                disabled={rating == null}
                className={[
                  "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition",
                  rating == null
                    ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
                    : "bg-neutral-900 text-white hover:opacity-90",
                ].join(" ")}
              >
                Отправить
              </button>

              <p className="text-xs text-neutral-500">
                Нажимая «Отправить», вы соглашаетесь на обработку данных для
                улучшения качества сервиса.
              </p>
            </form>
          ) : (
            <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
              <h2 className="text-lg font-semibold">Спасибо!</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Ваш отзыв сохранён (демо). Позже здесь будет реальное сохранение
                в базу и отправка уведомлений.
              </p>

              <div className="mt-4 grid gap-2 text-sm">
                <div className="flex justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-neutral-500">Категория</span>
                  <span className="font-medium">{category}</span>
                </div>
                <div className="flex justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-neutral-500">Оценка</span>
                  <span className="font-medium">{rating}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setRating(null);
                  setComment("");
                }}
                className="mt-6 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-neutral-50"
              >
                Заполнить ещё раз
              </button>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold">Как это будет в виджете</h3>
            <p className="mt-2 text-sm text-neutral-600">
              Виджет будет рендерить этот же компонент формы, но получая схему
              анкеты с API. Стили будут подстраиваться под сайт через CSS
              переменные.
            </p>
            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              <div className="font-mono">
                &lt;div id="pulseguest-widget" data-client="..." data-survey="..."
                &gt;&lt;/div&gt;
                <br />
                &lt;script async src=".../widget.js"&gt;&lt;/script&gt;
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold">Дальше по плану</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-700">
              <li>Схема анкеты с бэка (JSON) → динамический рендер</li>
              <li>Отправка ответов → сохранение + email-уведомления</li>
              <li>Админка: статистика, фильтры, роли</li>
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
