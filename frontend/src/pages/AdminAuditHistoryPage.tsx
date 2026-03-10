import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson } from "../shared/adminApi";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";
import type { ChecklistRunListItem } from "../shared/auditApi";
import { listChecklistRuns } from "../shared/auditApi";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type LocShort = {
  id: number;
  organization_id: number;
};

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Не удалось загрузить историю аудитов. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;
  if (typeof e?.detail?.message === "string") return e.detail.message;
  if (devEnabled) {
    try {
      const detail = JSON.stringify(e?.detail ?? e, null, 2);
      return detail ? `Не удалось загрузить историю аудитов. ${detail}` : "Не удалось загрузить историю аудитов.";
    } catch {
      return "Не удалось загрузить историю аудитов.";
    }
  }
  return "Не удалось загрузить историю аудитов. Обновите страницу и попробуйте снова.";
}

export default function AdminAuditHistoryPage() {
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

  const [runs, setRuns] = useState<ChecklistRunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    if (orgId === "") return;
    localStorage.setItem("pg_selected_org_id", String(orgId));
  }, [orgId]);

  const refreshRuns = async (selectedOrgId: number | "") => {
    setLoading(true);
    setErr(null);
    try {
      const rr = selectedOrgId === "" ? [] : await listChecklistRuns(Number(selectedOrgId));
      setRuns(rr ?? []);
    } catch (e) {
      setRuns([]);
      setErr(errToText(e, devEnabled));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshRuns(orgId);
  }, [orgId]);

  const orgOptions = useMemo(() => orgs.map((o) => ({ value: String(o.id), label: o.name })), [orgs]);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-[color:var(--pg-text)]">История аудитов</div>
          <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
            Здесь собраны завершённые и незавершённые проверки по выбранной организации.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/admin/audits")}>
            На дашборд аудитов
          </Button>
          <Button variant="secondary" onClick={() => nav("/admin/audits/templates")}>
            К шаблонам
          </Button>
          <Button variant="secondary" onClick={() => void refreshRuns(orgId)} disabled={loading}>
            Обновить
          </Button>
        </div>
      </div>

      <GlassCard className="mb-6 p-5">
        <div className="max-w-md">
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
      </GlassCard>

      {err && (
        <GlassCard className="mb-6">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {err}
          </div>
        </GlassCard>
      )}

      {loading && <div className="text-sm text-[color:var(--pg-faint)]">Загрузка…</div>}

      {!loading && (
        <GlassCard className="p-5">
          <div className="space-y-2">
            {(!runs || runs.length === 0) && (
              <div className="text-xs text-[color:var(--pg-muted)]">Для выбранной организации проверки пока не найдены.</div>
            )}

            {(runs || []).map((r) => {
              const dt = r.completed_at || r.created_at;
              const titleBase = r.location_name && r.location_name.trim().length ? r.location_name : r.template_name;
              const progress = `${r.answered_count}/${r.total_questions}`;

              return (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[color:var(--pg-text)]">{titleBase}</div>
                    <div className="mt-0.5 text-xs text-[color:var(--pg-muted)]">
                      {r.status === "completed" ? "Завершена" : "Черновик"}
                      {dt ? ` · ${new Date(dt).toLocaleDateString("ru-RU")}` : ""}
                      {` · Заполнено: ${progress}`}
                    </div>
                  </div>

                  <Button variant="secondary" onClick={() => nav(`/admin/audits/runs/${r.id}`)}>
                    Открыть проверку
                  </Button>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </AppShell>
  );
}
