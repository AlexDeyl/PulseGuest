import AppShell from "../components/AppShell";

export default function AdminLoginPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Вход</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Сотрудник / Руководитель / Сервис-менеджер
        </p>

        <form className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-neutral-800">Email</label>
            <input
              type="email"
              placeholder="name@company.com"
              className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-800">
              Пароль
            </label>
            <input
              type="password"
              placeholder="••••••••"
              className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>

          <button
            type="button"
            className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            Войти (демо)
          </button>

          <p className="text-xs text-neutral-500">
            Позже подключим JWT и разграничение по ролям.
          </p>
        </form>
      </div>
    </AppShell>
  );
}
