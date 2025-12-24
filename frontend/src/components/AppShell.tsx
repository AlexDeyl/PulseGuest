import { Link, NavLink } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import Backdrop from "./Backdrop";
import { TooltipProvider, Tooltip } from "./ui/Tooltip";
import { useTheme } from "../shared/useTheme";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "rounded-2xl px-3 py-2 text-sm font-medium transition",
          isActive
            ? "bg-[color:var(--pg-card-hover)]"
            : "hover:bg-[color:var(--pg-card-hover)]",
          "text-[color:var(--pg-muted)] hover:text-[color:var(--pg-text)]",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <TooltipProvider>
      <div className="relative min-h-screen">
        <Backdrop />

        <header className="sticky top-0 z-40 border-b border-[color:var(--pg-border)] bg-[color:var(--pg-card)]/60 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link to="/" className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                PG
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                  PulseGuest
                </div>
                <div className="text-xs text-[color:var(--pg-muted)]">
                  Feedback platform
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <nav className="hidden items-center gap-1 sm:flex">
                <NavItem to="/" label="Анкета" />
                <NavItem to="/admin/login" label="Вход" />
                <NavItem to="/admin" label="Админка" />
              </nav>

              <Tooltip content={isDark ? "Светлая тема" : "Тёмная тема"}>
                <button
                  type="button"
                  onClick={toggle}
                  className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] hover:bg-[color:var(--pg-card-hover)]"
                  aria-label="Toggle theme"
                >
                  {isDark ? (
                    <Sun className="h-5 w-5 text-[color:var(--pg-text)]" />
                  ) : (
                    <Moon className="h-5 w-5 text-[color:var(--pg-text)]" />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Mobile nav (optional, но аккуратно) */}
          <div className="mx-auto max-w-5xl px-4 pb-3 sm:hidden">
            <div className="flex gap-1">
              <NavItem to="/" label="Анкета" />
              <NavItem to="/admin/login" label="Вход" />
              <NavItem to="/admin" label="Админка" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>

        <footer className="border-t border-[color:var(--pg-border)] bg-[color:var(--pg-card)]/40 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-[color:var(--pg-muted)]">
            © {new Date().getFullYear()} PulseGuest
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
