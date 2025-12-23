import { Link, NavLink } from "react-router-dom";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "rounded-xl px-3 py-2 text-sm font-medium transition",
          isActive
            ? "bg-neutral-900 text-white"
            : "text-neutral-700 hover:bg-neutral-100",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-neutral-900 text-white">
              PG
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">PulseGuest</div>
              <div className="text-xs text-neutral-500">Feedback platform</div>
            </div>
          </Link>

          <nav className="flex items-center gap-1">
            <NavItem to="/" label="Анкета" />
            <NavItem to="/admin/login" label="Вход" />
            <NavItem to="/admin" label="Админка" />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-neutral-500">
          © {new Date().getFullYear()} PulseGuest
        </div>
      </footer>
    </div>
  );
}
