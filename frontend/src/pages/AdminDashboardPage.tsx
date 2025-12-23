import AppShell from "../components/AppShell";

const cards = [
  { label: "Ответов сегодня", value: "24" },
  { label: "Средняя оценка", value: "8.6" },
  { label: "Негатив (≤6)", value: "3" },
];

const last = [
  { where: "Ресторан", score: 9, text: "Очень понравилось обслуживание" },
  { where: "Отель", score: 6, text: "Шумно ночью, проснулся несколько раз" },
  { where: "Ресторан", score: 10, text: "Быстро, вкусно, вернусь ещё" },
];

export default function AdminDashboardPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Админ-панель</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Демонстрация будущей статистики и списка отзывов.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="text-sm text-neutral-500">{c.label}</div>
              <div className="mt-2 text-3xl font-semibold">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Последние отзывы</h2>
            <span className="text-xs text-neutral-500">DEMO</span>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-3 py-2">Где</th>
                  <th className="px-3 py-2">Оценка</th>
                  <th className="px-3 py-2">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {last.map((r, idx) => (
                  <tr key={idx} className="border-t border-neutral-200">
                    <td className="px-3 py-2">{r.where}</td>
                    <td className="px-3 py-2 font-semibold">{r.score}</td>
                    <td className="px-3 py-2 text-neutral-700">{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            Здесь появятся фильтры, сравнение периодов и детализация по
            индикаторам.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
