import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search, Star, SlidersHorizontal, X } from "lucide-react";

import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { adminJson, adminUploadJson } from "../shared/adminApi";
import { API_BASE } from "../shared/api/public";
import { useDevMode } from "../shared/devMode";
import QrModal from "../components/QrModal";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type Loc = {
  id: number;
  organization_id: number;
  type: string;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
};

type ImportRowError = {
  row: number;
  error: string;
};

type ImportSummary = {
  ok: boolean;
  organization_id: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
};

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Не удалось выполнить действие. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;

  if (devEnabled) {
    try {
      const detail = JSON.stringify(e?.detail ?? e, null, 2);
      return detail ? `Не удалось выполнить действие. ${detail}` : "Не удалось выполнить действие.";
    } catch {
      return "Не удалось выполнить действие.";
    }
  }

  return "Не удалось выполнить действие. Обновите страницу и попробуйте снова.";
}

const TYPES = ["room", "restaurant", "conference_hall", "banquet_hall", "other"] as const;

const TYPE_LABEL: Record<string, string> = {
  room: "Номера",
  restaurant: "Ресторан",
  conference_hall: "Конференц-зал",
  banquet_hall: "Банкетный зал",
  other: "Другое",
};

function typeLabel(t: string) {
  return TYPE_LABEL[t] ?? t;
}

function matchesQuery(l: Loc, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [String(l.name ?? ""), String(l.code ?? ""), String(l.slug ?? ""), String(l.id)]
    .join(" ")
    .toLowerCase();
  return hay.includes(s);
}

export default function AdminOrganizationLocationsPage() {
  const { orgId } = useParams();
  const organizationId = Number(orgId || 0);
  const nav = useNavigate();
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();

  const roleValues = useMemo(
    () => (Array.isArray(me?.roles) ? me!.roles.map((r: any) => r?.role) : []),
    [me]
  );

  const isAdmin = roleValues.includes("admin");
  const isOps = roleValues.includes("ops_director") || roleValues.includes("manager");
  const isService = roleValues.includes("service_manager");
  const isAuditor = roleValues.includes("auditor") || roleValues.includes("auditor_global");
  const isDirectorLike = roleValues.includes("director") || roleValues.includes("super_admin");
  const isAdminLike = isAdmin || isDirectorLike;

  const isStatsOnly = isAuditor && !isAdminLike && !isOps && !isService;

  const canManageLocations = isAdminLike || isOps;
  const canManageStays = isAdminLike || isOps;

  // Сервис-менеджер работает с group surveys (не с location surveys)
  const canManageSurveys = isAdminLike || isOps || isService;

  const canViewSubmissions = isAdminLike || isOps || isService;

  // navigation filters
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [sortKey, setSortKey] = useState<"code" | "name" | "type">("code");
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState(0);

  const [showManage, setShowManage] = useState(false);

  const pinnedStorageKey = organizationId ? `pg_pinned_locations_${organizationId}` : null;
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);

  const [org, setOrg] = useState<Org | null>(null);
  const [items, setItems] = useState<Loc[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOrg, setCheckingOrg] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create/edit form (director only, hidden by default)
  const [locId, setLocId] = useState<number | null>(null);
  const [type, setType] = useState("other");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [active, setActive] = useState(true);

  const canImportLocations = isAdminLike || isOps; // admin + ops_director

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importUiError, setImportUiError] = useState<string | null>(null);

  const downloadTemplate = async () => {
    if (!organizationId || Number.isNaN(organizationId) || organizationId <= 0) return;

    setDownloadingTemplate(true);
    setImportUiError(null);

    try {
      const access = localStorage.getItem("pg_access_token") || "";
      const res = await fetch(
        `${API_BASE}/api/admin/admin/organizations/${organizationId}/locations-import/template`,
        {
          headers: {
            ...(access ? { authorization: `Bearer ${access}` } : {}),
          },
        }
      );

      if (!res.ok) {
        let detail: any = null;
        try {
          const text = await res.text();
          detail = text ? JSON.parse(text) : null;
        } catch {
          // ignore
        }
        const err: any = new Error(`API ${res.status}: template`);
        err.status = res.status;
        err.detail = detail;
        throw err;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "locations_import_template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e: any) {
      setImportUiError(errToText(e, devEnabled));
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const pickImportFile = () => {
    setImportUiError(null);
    fileRef.current?.click();
  };

  const handleImportFile = async (f: File) => {
    if (!organizationId || Number.isNaN(organizationId) || organizationId <= 0) return;

    setImporting(true);
    setImportUiError(null);
    setImportSummary(null);

    try {
      const form = new FormData();
      form.append("file", f);

      const summary = await adminUploadJson<ImportSummary>(
        `/api/admin/admin/organizations/${organizationId}/locations-import`,
        form
      );

      setImportSummary(summary);

      // после успешного импорта — обновляем список локаций
      await load();
    } catch (e: any) {
      setImportUiError(errToText(e, devEnabled));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    if (!organizationId || Number.isNaN(organizationId) || organizationId <= 0) {
      nav("/admin/organizations", { replace: true });
    }
  }, [organizationId, nav]);

  // pins
  useEffect(() => {
    if (!pinnedStorageKey) {
      setPinnedIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(pinnedStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      setPinnedIds(Array.isArray(arr) ? arr.map((x) => Number(x)).filter(Number.isFinite) : []);
    } catch {
      setPinnedIds([]);
    }
  }, [pinnedStorageKey]);

  useEffect(() => {
    if (!pinnedStorageKey) return;
    try {
      localStorage.setItem(pinnedStorageKey, JSON.stringify(pinnedIds.slice(0, 200)));
    } catch {
      // ignore
    }
  }, [pinnedStorageKey, pinnedIds]);

  const togglePin = (id: number) => {
    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev]));
  };

  const resetForm = () => {
    setLocId(null);
    setType("other");
    setCode("");
    setName("");
    setSlug("");
    setActive(true);
  };

  const load = async () => {
    if (!organizationId || Number.isNaN(organizationId) || organizationId <= 0) return;

    setLoading(true);
    setError(null);
    setCheckingOrg(true);

    try {
      const o = await adminJson<Org>(`/api/admin/admin/organizations/${organizationId}`);
      setOrg(o);
      setCheckingOrg(false);

      const locs = await adminJson<Loc[]>(
        `/api/admin/admin/organizations/${organizationId}/locations`
      );
      setItems(locs);
    } catch (e: any) {
      const status = e?.status;
      if (status === 404 || status === 403) {
        nav("/admin/organizations", { replace: true });
        return;
      }
      setError(errToText(e, devEnabled));
      setCheckingOrg(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const startEdit = (l: Loc) => {
    setLocId(l.id);
    setType(l.type || "other");
    setCode(l.code || "");
    setName(l.name || "");
    setActive(l.is_active);
    setSlug("");
    setShowManage(true);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoc, setQrLoc] = useState<Loc | null>(null);

  const getPublicUrlFor = async (l: Loc) => {
    try {
      const r = await adminJson<{ public_url: string }>(
        `/api/admin/admin/locations/${l.id}/public-url`
      );
      const u = (r?.public_url || "").trim();
      if (u) return u;
    } catch {
      // ignore
    }
    const rel = `/${l.slug}`;
    return origin ? `${origin}${rel}` : rel;
  };

  const openPublic = async (l: Loc) => {
    const url = await getPublicUrlFor(l);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyPublic = async (l: Loc) => {
    const url = await getPublicUrlFor(l);
    await copy(url);
  };

  const openQr = (l: Loc) => {
    setQrLoc(l);
    setQrOpen(true);
  };

  const goToLocation = (locationId: number, target: "submissions" | "surveys" | "stays") => {
    localStorage.setItem("pg_selected_org_id", String(organizationId));
    localStorage.setItem("pg_selected_location_id", String(locationId));
    if (target === "submissions") nav("/admin/submissions");
    if (target === "surveys") nav(`/admin/locations/${locationId}/surveys`);
    if (target === "stays") nav(`/admin/locations/${locationId}/stays`);
  };

  const submit = async () => {
    if (!canManageLocations) return;
    setError(null);

    try {
      if (locId == null) {
        await adminJson("/api/admin/admin/locations", {
          method: "POST",
          body: JSON.stringify({
            organization_id: organizationId,
            type,
            code,
            name,
            slug: slug.trim() ? slug.trim() : undefined,
          }),
        });
      } else {
        await adminJson(`/api/admin/admin/locations/${locId}`, {
          method: "PATCH",
          body: JSON.stringify({
            type,
            code,
            name,
            is_active: active,
          }),
        });
      }
      resetForm();
      await load();
    } catch (e: any) {
      setError(errToText(e, devEnabled));
    }
  };

  const filtered = useMemo(() => {
    let xs = items.slice();

    if (statusFilter === "active") xs = xs.filter((l) => l.is_active);
    if (statusFilter === "inactive") xs = xs.filter((l) => !l.is_active);

    if (typeFilter !== "all") xs = xs.filter((l) => String(l.type || "other") === String(typeFilter));

    if (onlyPinned) xs = xs.filter((l) => pinnedIds.includes(l.id));

    if (q.trim()) xs = xs.filter((l) => matchesQuery(l, q));

    const pinnedSet = new Set<number>(pinnedIds);
    const cmpStr = (a: string, b: string) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });

    xs.sort((a, b) => {
      // pinned to top
      const ap = pinnedSet.has(a.id) ? 0 : 1;
      const bp = pinnedSet.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;

      if (sortKey === "name") return cmpStr(String(a.name || ""), String(b.name || ""));
      if (sortKey === "type") {
        const t = cmpStr(typeLabel(a.type || "other"), typeLabel(b.type || "other"));
        if (t !== 0) return t;
        return cmpStr(String(a.code || ""), String(b.code || ""));
      }

      // code
      const c = cmpStr(String(a.code || ""), String(b.code || ""));
      if (c !== 0) return c;
      return cmpStr(String(a.name || ""), String(b.name || ""));
    });

    return xs;
  }, [items, q, statusFilter, typeFilter, onlyPinned, pinnedIds, sortKey]);

  // reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [q, statusFilter, typeFilter, onlyPinned, sortKey, pageSize]);

  const total = filtered.length;
  const pages = Math.max(1, pageSize >= 999999 ? 1 : Math.ceil(total / pageSize));
  const curPage = Math.min(page, pages - 1);

  const view = useMemo(() => {
    if (pageSize >= 999999) return filtered;
    const start = curPage * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, curPage, pageSize]);

  const clearFilters = () => {
    setQ("");
    setTypeFilter("all");
    setStatusFilter("active");
    setOnlyPinned(false);
    setSortKey("code");
  };

  const clearDisabled =
    !q && typeFilter === "all" && statusFilter === "active" && !onlyPinned && sortKey === "code";

  if (isStatsOnly) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Доступ ограничен</div>
          <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
            Роль <b>Аудитор</b> — доступ только к статистике.
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => nav("/admin")}>На дашборд</Button>
          </div>
        </GlassCard>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Локации</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Локации организации</h1>
            <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
              {org ? (
                <>
                  Организация: <span className="font-semibold text-[color:var(--pg-text)]">{org.name}</span>
                  {devEnabled ? <span className="ml-2 font-mono text-[11px] text-[color:var(--pg-faint)]">slug: {org.slug}</span> : null}
                </>
              ) : (
                <>Организация: —</>
              )}
            </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/admin")}>Дашборд</Button>
          <Button variant="secondary" onClick={() => nav("/admin/organizations")}>Организации</Button>
        </div>
      </div>

      {checkingOrg && (
        <GlassCard className="mb-6">
          <div className="text-sm text-[color:var(--pg-muted)]">Проверяю организацию…</div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="mb-6">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        </GlassCard>
      )}

      <GlassCard className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Навигация</div>
          <div className="flex flex-wrap gap-2">
            {canImportLocations ? (
              <>
                <Button
                  variant="secondary"
                  onClick={downloadTemplate}
                  disabled={loading || downloadingTemplate || importing}
                >
                  {downloadingTemplate ? "Скачиваю шаблон…" : "Скачать шаблон"}
                </Button>

                <Button
                  variant="secondary"
                  onClick={pickImportFile}
                  disabled={loading || importing || downloadingTemplate}
                >
                  {importing ? "Импортирую…" : "Импортировать Excel"}
                </Button>
              </>
            ) : null}

            <Button variant="secondary" onClick={load} disabled={loading}>
              Обновить
            </Button>

            {canManageLocations ? (
              <Button variant="secondary" onClick={() => setShowManage((x) => !x)}>
                {showManage ? "Скрыть управление" : "Управление"}
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void handleImportFile(f);
            }}
          />

          {(importUiError || importSummary) ? (
            <div className="mt-4 grid gap-3">
              {importUiError ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 whitespace-pre-wrap">
                  {importUiError}
                </div>
              ) : null}

              {importSummary ? (
                <div
                  className={
                    importSummary.errors?.length
                      ? "rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
                      : "rounded-2xl border border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] px-4 py-3"
                  }
                >
                  <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                    Импорт завершён
                  </div>
                  <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
                    Создано: <b className="text-[color:var(--pg-text)]">{importSummary.created}</b>{" "}
                    • Обновлено: <b className="text-[color:var(--pg-text)]">{importSummary.updated}</b>{" "}
                    • Пропущено: <b className="text-[color:var(--pg-text)]">{importSummary.skipped}</b>
                  </div>

                  <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
                    Лист: <b>locations</b>. Колонки: <b>type</b>, <b>name</b>, опционально <b>code</b>, <b>slug</b>.
                    Типы: room / restaurant / conference_hall / banquet_hall / other.
                  </div>

                  {importSummary.errors?.length ? (
                    <div className="mt-3">
                      <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                        Ошибки ({importSummary.errors.length})
                      </div>
                      <div className="mt-2 max-h-48 overflow-auto rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3 text-xs text-[color:var(--pg-text)]">
                        {importSummary.errors.slice(0, 50).map((er, idx) => (
                          <div key={idx} className="py-1 border-b border-[color:var(--pg-border)] last:border-b-0">
                            <span className="font-mono text-[color:var(--pg-muted)]">row {er.row}:</span>{" "}
                            {er.error}
                          </div>
                        ))}
                        {importSummary.errors.length > 50 ? (
                          <div className="pt-2 text-[color:var(--pg-muted)]">
                            …и ещё {importSummary.errors.length - 50}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
                  </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="text-xs text-[color:var(--pg-muted)] flex items-center gap-2">
              <Search className="h-4 w-4" /> Поиск
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Номер/название (например: 203)"
                className="w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
              {q.trim() ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="grid h-11 w-11 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] hover:bg-[color:var(--pg-card-hover)]"
                  aria-label="Очистить поиск"
                >
                  <X className="h-4 w-4 text-[color:var(--pg-muted)]" />
                </button>
              ) : null}
            </div>
          </div>

          <div>
            <div className="text-xs text-[color:var(--pg-muted)] flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Фильтры
            </div>
            <div className="mt-2 grid gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              >
                <option value="all">Все типы</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              >
                <option value="active">Только активные</option>
                <option value="all">Все</option>
                <option value="inactive">Только отключённые</option>
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs text-[color:var(--pg-muted)]">Показ</div>
            <div className="mt-2 grid gap-2">
              <label className="flex items-center gap-2 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)]">
                <input
                  type="checkbox"
                  checked={onlyPinned}
                  onChange={(e) => setOnlyPinned(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4 text-amber-300/90" /> Только закреплённые
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as any)}
                  className="w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                >
                  <option value="code">Сорт: код</option>
                  <option value="name">Сорт: имя</option>
                  <option value="type">Сорт: тип</option>
                </select>

                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                >
                  <option value={50}>50 / стр</option>
                  <option value={100}>100 / стр</option>
                  <option value={200}>200 / стр</option>
                  <option value={500}>500 / стр</option>
                  <option value={999999}>Все</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[color:var(--pg-muted)]">
            Показано <span className="font-semibold text-[color:var(--pg-text)]">{view.length}</span> из {total}
            {items.length ? <span className="text-[color:var(--pg-faint)]"> (всего в организации: {items.length})</span> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={clearFilters} disabled={clearDisabled}>Сбросить</Button>

            {pages > 1 ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={curPage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>←</Button>
                <span className="text-xs text-[color:var(--pg-muted)]">Стр {curPage + 1} / {pages}</span>
                <Button variant="secondary" disabled={curPage >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>→</Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[color:var(--pg-muted)]">
              <tr>
                <th className="py-2 pr-3">⭐</th>
                <th className="py-2 pr-4">Код</th>
                <th className="py-2 pr-4">Название</th>
                <th className="py-2 pr-4">Тип</th>
                <th className="py-2 pr-4">Статус</th>
                <th className="py-2 pr-4">QR/ссылка</th>
                <th className="py-2 pr-4">Действия</th>
              </tr>
            </thead>

            <tbody className="text-[color:var(--pg-text)]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-6 text-sm text-[color:var(--pg-muted)]">Загрузка…</td>
                </tr>
              ) : view.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-sm text-[color:var(--pg-muted)]">Ничего не найдено</td>
                </tr>
              ) : (
                view.map((l) => {
                  const rel = `/${l.slug}`;
                  const full = origin ? `${origin}${rel}` : rel;
                  const pinned = pinnedIds.includes(l.id);

                  return (
                    <tr key={l.id} className="border-t border-[color:var(--pg-border)]">
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          onClick={() => togglePin(l.id)}
                          className="grid h-9 w-9 place-items-center rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] hover:bg-[color:var(--pg-card-hover)]"
                          aria-label={pinned ? "Открепить" : "Закрепить"}
                        >
                          <Star className={pinned ? "h-4 w-4 text-amber-300/90" : "h-4 w-4 text-[color:var(--pg-muted)]"} />
                        </button>
                      </td>

                      <td className="py-3 pr-4 font-mono">{l.code || "—"}</td>

                      <td className="py-3 pr-4">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{l.name}</div>
                          {devEnabled ? (
                            <div className="truncate text-xs text-[color:var(--pg-muted)]">{l.slug}</div>
                          ) : null}
                          {devEnabled ? <div className="mt-1 font-mono text-xs text-[color:var(--pg-faint)]">#{l.id}</div> : null}
                        </div>
                      </td>

                      <td className="py-3 pr-4">{typeLabel(l.type || "other")}</td>

                      <td className="py-3 pr-4">
                        {l.is_active ? (
                          <span className="rounded-full border border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] px-3 py-1 text-xs text-[color:var(--pg-success-text)]">
                            Активна
                          </span>
                        ) : (
                          <span className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs text-[color:var(--pg-muted)]">Отключена</span>
                        )}
                      </td>

                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-2">

                          <Button variant="secondary" onClick={() => openPublic(l)}>
                            Открыть
                          </Button>

                          <Button variant="secondary" onClick={() => openQr(l)}>
                            QR
                          </Button>

                          <Button variant="secondary" onClick={() => copyPublic(l)}>
                            Скопировать
                          </Button>
                        </div>
                      </td>

                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {canViewSubmissions && (
                            <Button variant="secondary" onClick={() => goToLocation(l.id, "submissions")}>
                              Отзывы
                            </Button>
                          )}

                          {canManageSurveys && (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                // service_manager: ведём на group surveys по типу локации
                                if (isService) {
                                  localStorage.setItem("pg_selected_org_id", String(organizationId));
                                  localStorage.setItem("pg_selected_group_key", String(l.type || "other"));
                                  nav("/admin/group-surveys");
                                  return;
                                }
                                goToLocation(l.id, "surveys");
                              }}
                            >
                              Опросы
                            </Button>
                          )}

                          {canManageStays && (
                            <Button variant="secondary" onClick={() => goToLocation(l.id, "stays")}>
                              Проживающие
                            </Button>
                          )}

                          {canManageLocations ? (
                            <Button variant="secondary" onClick={() => startEdit(l)}>
                              Редактировать
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* director-only management, hidden behind toggle */}
      {canManageLocations && showManage ? (
        <GlassCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">
              Управление локациями
              {locId != null && devEnabled ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{locId}</span> : null}
            </div>
            {locId != null ? <Button variant="secondary" onClick={resetForm}>Отмена</Button> : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Тип</div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Код</div>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            <label className="block sm:col-span-2">
              <div className="text-xs text-[color:var(--pg-muted)]">Название</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            {locId == null ? (
              <label className="block sm:col-span-2">
                <div className="text-xs text-[color:var(--pg-muted)]">
                  Слаг (опционально; если пусто — будет {"{org_slug}-{code}"})
                </div>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                />
              </label>
            ) : null}
          </div>

          {locId != null ? (
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Активна
            </label>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={submit} disabled={!name.trim()}>Сохранить</Button>
          </div>
        </GlassCard>
      ) : null}
       <QrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        locationId={qrLoc?.id || 0}
        slug={qrLoc?.slug || ""}
        title={qrLoc ? `QR: ${qrLoc.name}` : "QR"}
      />
    </AppShell>
  );
}
