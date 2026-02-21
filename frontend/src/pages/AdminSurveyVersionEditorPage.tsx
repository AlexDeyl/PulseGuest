import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { API_BASE } from "../shared/api/public";
import { useDevMode } from "../shared/devMode";

type Resp = {
  id: number;
  survey_id: number;
  location_id: number;
  version: number;
  is_active: boolean;
  schema: any;
  widget_config: any;
  created_at: string | null;
};

async function adminFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const access = localStorage.getItem("pg_access_token") || "";
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    const detail = ct.includes("application/json") ? await res.json() : await res.text();
    const err: any = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return (await res.json()) as T;
}

function safeStringify(x: any) {
  return JSON.stringify(x ?? {}, null, 2);
}

export default function AdminSurveyVersionEditorPage() {
  const { versionId } = useParams();
  const id = Number(versionId || 0);
  const nav = useNavigate();
  const { available: devAvailable, enabled: devEnabled, setEnabled: setDevEnabled } = useDevMode();

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [schemaText, setSchemaText] = useState("");
  const [widgetText, setWidgetText] = useState("");

  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const header = useMemo(() => {
    if (!data) return `version_id=${id}`;
    return `survey_id=${data.survey_id} • v${data.version} • version_id=${data.id}${data.is_active ? " • ACTIVE" : ""}`;
  }, [data, id]);

  useEffect(() => {
    if (!id || Number.isNaN(id) || id <= 0) {
      nav("/admin", { replace: true });
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setErr(null);
      setValidateMsg(null);
      setSaveMsg(null);

      try {
        const resp = await adminFetchJson<Resp>(`/api/admin/admin/survey-versions/${id}`);
        if (cancelled) return;

        setData(resp);
        setSchemaText(safeStringify(resp.schema));
        setWidgetText(safeStringify(resp.widget_config));
      } catch (e: any) {
        if (cancelled) return;

        const detail = e?.detail ? JSON.stringify(e.detail) : "";
        setErr(`Не удалось загрузить версию. ${detail}`);

        if (e?.status === 403 || e?.status === 404) nav("/admin", { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [id, nav]);

  const back = () => {
    if (data?.survey_id) nav(`/admin/surveys/${data.survey_id}`);
    else nav("/admin");
  };

  const validate = () => {
    setValidateMsg(null);
    setSaveMsg(null);
    try {
      const schema = JSON.parse(schemaText);
      const wc = JSON.parse(widgetText);

      if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
        throw new Error("schema должен быть объектом");
      }
      if (typeof schema.title !== "string" || !schema.title.trim()) {
        throw new Error("schema.title обязателен");
      }
      if (!Array.isArray(schema.slides)) {
        throw new Error("schema.slides должен быть массивом");
      }
      if (typeof wc !== "object" || wc === null || Array.isArray(wc)) {
        throw new Error("widget_config должен быть объектом");
      }

      setValidateMsg("OK: JSON валиден (базовая проверка пройдена)");
    } catch (e: any) {
      setValidateMsg(`Ошибка: ${e?.message ?? String(e)}`);
    }
  };

  const resetFromServer = () => {
    if (!data) return;
    setSchemaText(safeStringify(data.schema));
    setWidgetText(safeStringify(data.widget_config));
    setValidateMsg(null);
    setSaveMsg(null);
  };

  const save = async () => {
    if (!data) return;

    setErr(null);
    setValidateMsg(null);
    setSaveMsg(null);

    let schema: any;
    let wc: any;

    try {
      schema = JSON.parse(schemaText);
      wc = JSON.parse(widgetText);
    } catch (e: any) {
      setValidateMsg(`Ошибка: JSON не парсится — ${e?.message ?? String(e)}`);
      return;
    }

    setSaving(true);
    try {
      await adminFetchJson(`/api/admin/admin/survey-versions/${data.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema, widget_config: wc }),
      });

      setSaveMsg("Сохранено.");
      // перезагрузим с сервера, чтобы быть уверенными
      const fresh = await adminFetchJson<Resp>(`/api/admin/admin/survey-versions/${data.id}`);
      setData(fresh);
      setSchemaText(safeStringify(fresh.schema));
      setWidgetText(safeStringify(fresh.widget_config));
    } catch (e: any) {
      const detail = e?.detail ? JSON.stringify(e.detail) : "";
      setErr(`Не удалось сохранить. ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const openPreview = () => {
    if (!data) return;
    nav(`/admin/locations/${data.location_id}/surveys/${data.survey_id}/versions/${data.id}/preview`);
  };

  // ✅ ВОТ ЭТО ВСТАВЛЯЕМ ПЕРЕД ОСНОВНЫМ return
  if (!devEnabled) {
    return (
      <AppShell>
        <GlassCard>
          <h1 className="text-2xl font-semibold text-[color:var(--pg-text)]">Редактор версии</h1>
          <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
            Редактор схемы скрыт (только Dev mode). Используй Preview.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={back}>
              Назад
            </Button>

            <Button variant="secondary" onClick={openPreview} disabled={!data}>
              Preview
            </Button>

            {devAvailable && (
              <Button variant="secondary" onClick={() => setDevEnabled(true)}>
                Включить Dev mode
              </Button>
            )}
          </div>
        </GlassCard>

        {loading && (
          <div className="mt-4 text-sm text-[color:var(--pg-faint)]">Loading…</div>
        )}
      </AppShell>
    );
  }

  // ✅ ДАЛЬШЕ — ТВОЙ ОРИГИНАЛЬНЫЙ return (почти без изменений)
  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Редактор версии</h1>
          <div className="mt-1 text-xs text-[color:var(--pg-muted)]">{header}</div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={back}>
            Назад
          </Button>
          <Button variant="secondary" onClick={validate}>
            Validate
          </Button>
          <Button variant="secondary" onClick={openPreview} disabled={!data}>
            Preview
          </Button>
          <Button variant="secondary" onClick={resetFromServer} disabled={!data}>
            Reset
          </Button>
          <Button onClick={save} disabled={!data || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {err && (
        <GlassCard className="mb-6 border border-rose-500/30">
          <div className="text-sm text-rose-300">{err}</div>
        </GlassCard>
      )}

      {validateMsg && (
        <GlassCard className="mb-6">
          <div className="text-sm text-[color:var(--pg-text)]">{validateMsg}</div>
        </GlassCard>
      )}

      {saveMsg && (
        <GlassCard className="mb-6">
          <div className="text-sm text-[color:var(--pg-text)]">{saveMsg}</div>
        </GlassCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">schema (JSON)</div>
          <textarea
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            spellCheck={false}
            className="mt-3 h-[560px] w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 font-mono text-xs text-[color:var(--pg-text)] outline-none"
          />
        </GlassCard>

        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">widget_config (JSON)</div>
          <textarea
            value={widgetText}
            onChange={(e) => setWidgetText(e.target.value)}
            spellCheck={false}
            className="mt-3 h-[560px] w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 font-mono text-xs text-[color:var(--pg-text)] outline-none"
          />
        </GlassCard>
      </div>

      {loading && (
        <div className="mt-4 text-sm text-[color:var(--pg-faint)]">Loading…</div>
      )}
    </AppShell>
  );
}
