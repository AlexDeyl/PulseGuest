import { Link, useLocation, useNavigate } from "react-router-dom";
import { Code2, LogOut, Moon, Sun } from "lucide-react";
import Backdrop from "./Backdrop";
import { TooltipProvider, Tooltip } from "./ui/Tooltip";
import { useTheme } from "../shared/useTheme";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";

type ShellMode = "public" | "auth" | "admin";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  const { isAuthenticated, logout } = useAuth();
  const { available: devAvailable, enabled: devEnabled, setEnabled: setDevEnabled } =
    useDevMode();

  const loc = useLocation();
  const nav = useNavigate();

  const mode: ShellMode = (() => {
    if (loc.pathname === "/") return "auth";
    if (loc.pathname === "/admin/login") return "auth";
    if (loc.pathname.startsWith("/admin")) return "admin";
    return "public"; // /:slug
  })();

  const onLogout = async () => {
    await logout();
    nav("/", { replace: true });
  };

  return (
    <TooltipProvider>
      <div className="relative min-h-screen">
        <Backdrop />

        <header className="sticky top-0 z-40 border-b border-[color:var(--pg-border)] bg-[color:var(--pg-card)]/60 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            {mode === "public" ? (
              <div className="flex items-center gap-3" aria-label="PulseGuest">
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
              </div>
            ) : (
              <Link to={mode === "admin" ? "/admin" : "/"} className="flex items-center gap-3">
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
            )}

            <div className="flex items-center gap-2">
              {mode === "admin" && devAvailable && (
                <Tooltip content={devEnabled ? "Dev mode: ON" : "Dev mode: OFF"}>
                  <button
                    type="button"
                    onClick={() => setDevEnabled(!devEnabled)}
                    className={[
                      "inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition",
                      devEnabled
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
                    ].join(" ")}
                    aria-label="Toggle dev mode"
                  >
                    <Code2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Dev</span>
                  </button>
                </Tooltip>
              )}

              {mode === "admin" && isAuthenticated && (
                <Tooltip content="Выйти">
                  <button
                    type="button"
                    onClick={onLogout}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 text-sm font-medium text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]"
                  >
                    <LogOut className="h-4 w-4 text-[color:var(--pg-muted)]" />
                    <span className="hidden sm:inline">Выйти</span>
                  </button>
                </Tooltip>
              )}

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
