import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { adminJson, downloadBlob } from "../shared/adminApi";
import { useAuth } from "../shared/auth";
import { useDevMode } from "../shared/devMode";
import { downloadAuditImportTemplate, importAuditTemplatesFromExcel } from "../shared/auditApi";

type Org = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
};

type LocShort = {
  id: number;
  organization_id: number;
  type: string;
};

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

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Не удалось выполнить импорт. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;
  if (typeof e?.detail?.message === "string") return e.detail.message;
  if (typeof e?.message === "string" && e.message.trim()) {
    return e.message;
  }
  if (devEnabled) {
    try {
      const detail = JSON.stringify(e?.detail ?? e, null, 2);
      return detail ? `Не удалось выполнить импорт. ${detail}` : "Не удалось выполнить импорт.";
    } catch {
      return "Не удалось выполнить импорт.";
    }
  }
  return "Не удалось выполнить импорт. Проверьте файл и попробуйте снова.";
}

export default function AdminAuditImportPage() {
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

  const [groupValue, setGroupValue] = useState<string>("__org__");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

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

  const availableGroups = useMemo(() => {
    if (orgId === "") return [];
    return Array.from(
      new Set(
        allowedLocations
          .filter((l) => Number(l.organization_id) === Number(orgId))
          .map((l) => String(l.type || "").trim())
          .filter((x) => x.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [allowedLocations, orgId]);

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ value: String(o.id), label: o.name })),
    [orgs]
  );

  const groupOptions = useMemo(
    () => [
      { value: "__org__", label: "Без группы локаций" },
      ...availableGroups.map((g) => ({ value: g, label: groupLabelRu(g) })),
    ],
    [availableGroups]
  );

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-[color:var(--pg-text)]">Импорт шаблонов аудита</div>
          <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
            Загрузите Excel-файл и выберите, к какой организации или группе локаций будет относиться шаблон.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/admin/audits")}>
            На дашборд аудитов
          </Button>
          <Button variant="secondary" onClick={() => nav("/admin/audits/templates")}>
            К чек-листам
          </Button>
        </div>
      </div>

      <GlassCard className="p-5">
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
                value={groupValue}
                onValueChange={setGroupValue}
                options={groupOptions}
                placeholder="Выберите группу…"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={!orgId}
            onClick={async () => {
              setImportMsg(null);
              if (!orgId) {
                setImportMsg("Сначала выберите организацию.");
                return;
              }
              try {
                const { blob, filename } = await downloadAuditImportTemplate(Number(orgId));
                downloadBlob(blob, filename || "audit_import_template.xlsx");
              } catch (e) {
                setImportMsg(errToText(e, devEnabled));
              }
            }}
          >
            Скачать шаблон
          </Button>

          <input
            className="block rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-2 text-sm text-[color:var(--pg-text)] file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-[color:var(--pg-text)]"
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setImportFile(f);
              setImportMsg(null);
            }}
          />

          <Button
            disabled={!orgId || !importFile || importBusy}
            onClick={async () => {
              setImportMsg(null);
              if (!orgId) {
                setImportMsg("Сначала выберите организацию.");
                return;
              }
              if (!importFile) {
                setImportMsg("Выберите .xlsx файл.");
                return;
              }

              try {
                setImportBusy(true);
                const res = await importAuditTemplatesFromExcel(
                  Number(orgId),
                  importFile,
                  groupValue === "__org__" ? null : groupValue
                );
                setImportMsg(
                  `Импорт завершён. Версия: ${res.version}. Вопросов загружено: ${res.questions_count}.`
                );
                setImportFile(null);
              } catch (e: any) {
                console.error("audit import failed", e);
                setImportMsg(errToText(e, devEnabled));
              } finally {
                setImportBusy(false);
              }
            }}
          >
            {importBusy ? "Импортирую…" : "Импортировать"}
          </Button>
        </div>

        <div className="mt-4 text-xs text-[color:var(--pg-muted)]">
          После загрузки шаблон будет доступен в выбранной организации и, при необходимости, в выбранной группе локаций.
        </div>

        {importMsg && (
          <div className="mt-4 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-4 py-3 text-sm text-[color:var(--pg-text)]">
            {importMsg}
          </div>
        )}
      </GlassCard>
    </AppShell>
  );
}
