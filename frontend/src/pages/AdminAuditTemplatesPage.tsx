import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson } from "../shared/adminApi";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";
import type { ChecklistTemplate } from "../shared/auditApi";
import { createChecklistRun, listChecklistTemplates } from "../shared/auditApi";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type LocShort = {
  id: number;
  organization_id: number;
  name: string;
  slug: string;
  code: string;
  type: string;
  is_active: boolean;
};

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Не удалось загрузить данные. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;
  if (typeof e?.detail?.message === "string") return e.detail.message;
  if (devEnabled) {
    try {
      const detail = JSON.stringify(e?.detail ?? e, null, 2);
      return detail ? `Не удалось загрузить данные. ${detail}` : "Не удалось загрузить данные.";
    } catch {
      return "Не удалось загрузить данные.";
    }
  }
  return "Не удалось загрузить данные. Обновите страницу и попробуйте снова.";
}

function normalizeScope(scope: string) {
  const s = String(scope || "").trim().toLowerCase();
  if (s === "location") return "group";
  if (s === "group") return "group";
  return "organization";
}

function scopeLabel(scope: string) {
  const s = normalizeScope(scope);
  return s === "group" ? "На группу локаций" : "На организацию";
}

function groupLabelRu(key: string) {
  const raw = String(key || "").trim().toLowerCase();

  if (raw === "room" || raw === "rooms") return "Номера";
  if (raw === "restaurant" || raw === "restaurants") return "Рестораны";
  if (
    raw === "conference_hall" ||
    raw === "conference_halls" ||
    raw === "conference_room" ||
    raw === "conference_rooms"
  ) {
    return "Конференц-залы";
  }
  if (raw === "banquet_hall" || raw === "banquet_halls") return "Банкетные залы";
  if (raw === "other") return "Другое";

  return key;
}

export default function AdminAuditTemplatesPage() {
  const { me } = useAuth();
  const { enabled: devEnabled } = useDevMode();
  const nav = useNavigate();

  const allowedLocations: LocShort[] = (me?.allowed_locations ?? []) as any;

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_org_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [groupFilter, setGroupFilter] = useState<string>(() => {
    return localStorage.getItem("pg_audit_group_filter") || "__all__";
  });

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [creatingId, setCreatingId] = useState<number | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const xs = await adminJson<Org[]>("/api/admin/admin/organizations");
        if (!alive) return;
        setOrgs(devEnabled ? xs : xs.filter((o) => o.is_active));
      } catch {
        const ids = Array.from(new Set(allowedLocations.map((l) => l.organization_id)));
        const fallback = ids.map((id, idx) => ({
          id,
          name: `Организация ${idx + 1}`,
          slug: `org-${id}`,
          is_active: true,
        }));
        if (!alive) return;
        setOrgs(fallback);
      }
    })();

    return () => {
      alive = false;
    };
  }, [allowedLocations, devEnabled]);

  useEffect(() => {
    if (!orgs.length) return;
    const ids = new Set(orgs.map((o) => o.id));
    const cur = orgId === "" ? null : Number(orgId);
    if (cur == null || !ids.has(cur)) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  useEffect(() => {
    if (orgId !== "") localStorage.setItem("pg_selected_org_id", String(orgId));
  }, [orgId]);

  useEffect(() => {
    localStorage.setItem("pg_audit_group_filter", groupFilter);
  }, [groupFilter]);

  const orgLocations = useMemo(() => {
    if (orgId === "") return [];
    return allowedLocations
      .filter((l) => Number(l.organization_id) === Number(orgId))
      .filter((l) => !!l.is_active)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [allowedLocations, orgId]);

  const availableGroups = useMemo(() => {
    return Array.from(
      new Set(
        orgLocations
          .map((l) => String(l.type || "").trim())
          .filter((x) => x.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [orgLocations]);

  const groupOptions = useMemo(
    () => [
      { value: "__all__", label: "Все группы" },
      ...availableGroups.map((g) => ({ value: g, label: groupLabelRu(g) })),
    ],
    [availableGroups]
  );

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ value: String(o.id), label: o.name })),
    [orgs]
  );

  const refreshTemplates = async () => {
    setLoading(true);
    setErr(null);
    try {
      const xs = await listChecklistTemplates();
      setTemplates(xs ?? []);
    } catch (e) {
      setTemplates([]);
      setErr(errToText(e, devEnabled));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshTemplates();
  }, [orgId, devEnabled]);

  const templateList = useMemo(() => {
    if (orgId === "") return [];

    return templates
      .filter((t) => t.organization_id == null || Number(t.organization_id) === Number(orgId))
      .filter((t) => {
        const scope = normalizeScope(t.scope);
        const lt = String(t.location_type || "").trim();

        if (groupFilter === "__all__") {
          if (scope === "organization") return true;
          return lt.length > 0 && availableGroups.includes(lt);
        }

        if (scope === "organization") return false;
        return lt === groupFilter;
      });
  }, [templates, orgId, groupFilter, availableGroups]);

  const startRun = async (t: ChecklistTemplate) => {
    if (orgId === "") return;
    setCreateErr(null);
    setCreatingId(t.id);
    try {
      const run = await createChecklistRun({
        template_id: t.id,
        organization_id: Number(orgId),
        location_id: null,
      });
      nav(`/admin/audits/runs/${run.id}`);
    } catch (e) {
      setCreateErr(errToText(e, devEnabled));
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-[color:var(--pg-text)]">Шаблоны чек-листов</div>
          <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
            Выберите организацию и группу локаций, чтобы открыть нужные шаблоны для аудита.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/admin/audits")}>
            На дашборд аудитов
          </Button>
          <Button variant="secondary" onClick={() => nav("/admin/audits/history")}>
            История
          </Button>
          <Button variant="secondary" onClick={() => void refreshTemplates()} disabled={loading}>
            Обновить
          </Button>
        </div>
      </div>

      <GlassCard className="mb-6 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs text-[color:var(--pg-muted)]">Организация</div>
            <div className="mt-2">
              <Select
                value={orgId === "" ? "" : String(orgId)}
                onValueChange={(v) => setOrgId(Number(v))}
                options={orgOptions}
                placeholder="Выберите организацию…"
              />
            </div>
          </div>

          <div>
            <div className="text-xs text-[color:var(--pg-muted)]">Группа локаций</div>
            <div className="mt-2">
              <Select
                value={groupFilter}
                onValueChange={setGroupFilter}
                options={groupOptions}
                placeholder="Выберите группу…"
              />
            </div>
          </div>
        </div>

        {createErr && (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {createErr}
          </div>
        )}
      </GlassCard>

      {err && (
        <GlassCard className="mb-6">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {err}
          </div>
        </GlassCard>
      )}

      {loading && <div className="text-sm text-[color:var(--pg-faint)]">Загрузка…</div>}

      {!loading && !templateList.length && (
        <GlassCard className="mb-6 p-6">
          <div className="text-sm text-[color:var(--pg-text)]">Подходящие шаблоны пока не найдены.</div>
          <div className="mt-2 text-xs text-[color:var(--pg-muted)]">
            Проверьте выбранную организацию, группу локаций и наличие загруженных шаблонов.
          </div>
        </GlassCard>
      )}

      <div className="grid gap-4">
        {templateList.map((t) => (
          <GlassCard key={t.id} className="p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-semibold text-[color:var(--pg-text)]">{t.name}</div>

                  <span className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-0.5 text-xs text-[color:var(--pg-muted)]">
                    {scopeLabel(t.scope)}
                  </span>

                  {t.location_type && (
                    <span className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-0.5 text-xs text-[color:var(--pg-muted)]">
                      Группа: {groupLabelRu(t.location_type)}
                    </span>
                  )}

                  <span className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-2 py-0.5 text-xs text-[color:var(--pg-muted)]">
                    v{t.version}
                  </span>

                  {t.organization_id == null && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                      Доступен для всех организаций
                    </span>
                  )}
                </div>

                {t.description && (
                  <div className="mt-2 line-clamp-3 text-sm text-[color:var(--pg-muted)]">
                    {t.description === "Импортировано из Exel. Редактируйте вопросы в шаблоне Exel."
                      ? "Шаблон успешно импортирован и готов к использованию."
                      : t.description}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button onClick={() => void startRun(t)} disabled={creatingId === t.id || orgId === ""}>
                  {creatingId === t.id ? "Создаю…" : "Начать"}
                </Button>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </AppShell>
  );
}
