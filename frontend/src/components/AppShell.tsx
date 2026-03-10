import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Code2,
  LayoutDashboard,
  LogOut,
  Moon,
  Sun,
  ClipboardList,
} from "lucide-react";
import Backdrop from "./Backdrop";
import { TooltipProvider, Tooltip } from "./ui/Tooltip";
import { useTheme } from "../shared/useTheme";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";

type ShellMode = "public" | "auth" | "admin";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  const { isAuthenticated, logout, me } = useAuth();
  const { available: devAvailable, enabled: devEnabled, setEnabled: setDevEnabled } =
    useDevMode();

  const roleValues = Array.isArray(me?.roles) ? me!.roles.map((r: any) => r?.role) : [];
  const isAdmin = roleValues.includes("admin");
  const isOps = roleValues.includes("ops_director");
  const isService = roleValues.includes("service_manager");
  const isAuditor = roleValues.includes("auditor");
  const isStatsOnlyAuditor = isAuditor && !isAdmin && !isOps && !isService;
  const canSwitchDashboards = isStatsOnlyAuditor || isAdmin || isOps;

  const loc = useLocation();
  const nav = useNavigate();

  const mode: ShellMode = (() => {
    if (loc.pathname === "/") return "auth";
    if (loc.pathname === "/admin/login") return "auth";
    if (loc.pathname === "/admin/forgot-password") return "auth";
    if (loc.pathname.startsWith("/admin/reset-password")) return "auth";
    if (loc.pathname.startsWith("/admin")) return "admin";
    return "public"; // /:slug
  })();

  const [headerScrolled, setHeaderScrolled] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");

    const update = () => {
      if (!mq.matches) {
        setHeaderScrolled(false);
        return;
      }
      const y =
        window.scrollY ||
        document.documentElement.scrollTop ||
        (document.body ? document.body.scrollTop : 0) ||
        0;

      setHeaderScrolled(y > 10);
    };

    update();

    const onScroll = () => update();
    window.addEventListener("scroll", onScroll, { passive: true });

    const onChange = () => update();
    // @ts-ignore
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    // @ts-ignore
    else mq.addListener(onChange);

    return () => {
      window.removeEventListener("scroll", onScroll);
      // @ts-ignore
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      // @ts-ignore
      else mq.removeListener(onChange);
    };
  }, []);

  const onLogout = async () => {
    await logout();
    nav("/", { replace: true });
  };

  const onBack = () => {
    const fallback = mode === "admin" ? "/admin" : "/";
    if (window.history.length > 1) {
      nav(-1);
      return;
    }
    nav(fallback);
  };

  const isFeedbackDashboardActive = useMemo(() => {
    return loc.pathname === "/admin";
  }, [loc.pathname]);

  const isAuditDashboardActive = useMemo(() => {
    return loc.pathname === "/admin/audits";
  }, [loc.pathname]);

  return (
    <TooltipProvider>
      <div className="relative min-h-screen">
        <Backdrop />

        <header
          className={[
            "pg-header relative sticky top-0 z-40 border-b border-[color:var(--pg-border)] bg-[color:var(--pg-card)]/60 backdrop-blur-xl",
            headerScrolled ? "pg-header--scrolled" : "",
          ].join(" ")}
        >
          <div className="pg-header__noise" aria-hidden="true" />

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
                    Платформа обратной связи
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-3"
                aria-label="Назад"
              >
                <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)]">
                  <ArrowLeft className="h-5 w-5 text-[color:var(--pg-text)]" />
                </div>
                <div className="leading-tight text-left">
                  <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                    PulseGuest
                  </div>
                  <div className="text-xs text-[color:var(--pg-muted)]">
                    Feedback platform
                  </div>
                </div>
              </button>
            )}

            <div className="flex items-center gap-2">
              {mode === "admin" && canSwitchDashboards && (
                <div className="hidden items-center gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => nav("/admin")}
                    className={[
                      "inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition",
                      isFeedbackDashboardActive
                        ? "border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] text-[color:var(--pg-success-text)]"
                        : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
                    ].join(" ")}
                    aria-label="Открыть дашборд отзывов"
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Отзывы</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => nav("/admin/audits")}
                    className={[
                      "inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition",
                      isAuditDashboardActive
                        ? "border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] text-[color:var(--pg-success-text)]"
                        : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
                    ].join(" ")}
                    aria-label="Открыть дашборд аудитов"
                  >
                    <ClipboardList className="h-4 w-4" />
                    <span>Аудиты</span>
                  </button>
                </div>
              )}

              {mode === "admin" && devAvailable && isAdmin && (
                <Tooltip content={devEnabled ? "Режим разработчика включён" : "Режим разработчика выключен"}>
                  <button
                    type="button"
                    onClick={() => setDevEnabled(!devEnabled)}
                    className={[
                      "inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition",
                      devEnabled
                        ? "border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] text-[color:var(--pg-success-text)]"
                        : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
                    ].join(" ")}
                    aria-label="Переключить режим разработчика"
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
                  aria-label="Переключить тему"
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

          {mode === "admin" && canSwitchDashboards && (
            <div className="mx-auto max-w-5xl px-4 pb-4 sm:hidden">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => nav("/admin")}
                  className={[
                    "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-medium transition",
                    isFeedbackDashboardActive
                      ? "border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] text-[color:var(--pg-success-text)]"
                      : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
                  ].join(" ")}
                  aria-label="Открыть дашборд отзывов"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Отзывы</span>
                </button>

                <button
                  type="button"
                  onClick={() => nav("/admin/audits")}
                  className={[
                    "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-medium transition",
                    isAuditDashboardActive
                      ? "border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] text-[color:var(--pg-success-text)]"
                      : "border-[color:var(--pg-border)] bg-[color:var(--pg-card)] text-[color:var(--pg-text)] hover:bg-[color:var(--pg-card-hover)]",
                  ].join(" ")}
                  aria-label="Открыть дашборд аудитов"
                >
                  <ClipboardList className="h-4 w-4" />
                  <span>Аудиты</span>
                </button>
              </div>
            </div>
          )}
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
