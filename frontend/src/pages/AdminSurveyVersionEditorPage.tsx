import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import SurveyWizard from "../components/SurveyWizard";
import { useDevMode } from "../shared/devMode";
import { adminJson } from "../shared/adminApi";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import { useAuth } from "../shared/auth";

type Resp = {
  id: number;
  survey_id: number;
  location_id: number | null;
  organization_id?: number | null;
  group_key?: string | null;
  version: number;
  is_active: boolean;
  schema: any;
  widget_config: any;
  created_at: string | null;
};

type QKind = "rating" | "text" | "single_select" | "multi_select";

type Option = { value: string; label: string };

type BuilderQuestion = {
  id: string;
  kind: QKind;
  field: string;
  title: string;
  required: boolean;

  // rating
  scale?: 5 | 10;

  // text
  placeholder?: string;
  maxLength?: number;

  // select
  options?: Option[];
};

type ContactState = {
  enabled: boolean;
  name: { enabled: boolean; required: boolean };
  email: { enabled: boolean; required: boolean };
  phone: { enabled: boolean; required: boolean };
};

function safeStringify(x: any) {
  return JSON.stringify(x ?? {}, null, 2);
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function defaultContact(): ContactState {
  return {
    enabled: false,
    name: { enabled: true, required: false },
    email: { enabled: true, required: false },
    phone: { enabled: false, required: false },
  };
}

function normalizeOptions(raw: any): Option[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((o) => o && typeof o === "object")
    .map((o) => ({
      value: String((o as any).value ?? "").trim(),
      label: String((o as any).label ?? (o as any).value ?? "").trim(),
    }))
    .filter((o) => o.value && o.label);
}

function coerceOptionsKeepEmpty(raw: any): Option[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((o) => o && typeof o === "object")
    .map((o) => ({
      value: String((o as any).value ?? ""),
      label: String((o as any).label ?? ""),
    }));
}

function parseSchema(schema: any): {
  title: string;
  questions: BuilderQuestion[];
  contact: ContactState;
  unknownSlides: any[];
  meta: any;
} {
  const title = typeof schema?.title === "string" ? schema.title : "Анкета";
  const slides = Array.isArray(schema?.slides) ? schema.slides : [];
  const meta = schema?.meta && typeof schema.meta === "object" && !Array.isArray(schema.meta) ? schema.meta : {};

  const questions: BuilderQuestion[] = [];
  const contact = defaultContact();
  const unknownSlides: any[] = [];

  for (const s of slides) {
    if (!s || typeof s !== "object") continue;
    const stype = String((s as any).type ?? "");
    const field = String((s as any).field ?? "");

    if ((stype === "rating" || stype === "nps") && field) {
      const scaleRaw = Number((s as any).scale ?? 10);
      const scale = scaleRaw <= 5 ? 5 : 10;

      questions.push({
        id: uid("q"),
        kind: "rating",
        field,
        title: String((s as any).title ?? "Оценка"),
        required: Boolean((s as any).required),
        scale,
      });
      continue;
    }

    if (stype === "text" && field) {
      questions.push({
        id: uid("q"),
        kind: "text",
        field,
        title: String((s as any).title ?? "Комментарий"),
        required: Boolean((s as any).required),
        placeholder: typeof (s as any).placeholder === "string" ? (s as any).placeholder : "",
        maxLength: (s as any).maxLength != null ? Number((s as any).maxLength) : undefined,
      });
      continue;
    }

    if (stype === "choice" && field) {
      const mode = String((s as any).mode ?? "single");
      const opts = normalizeOptions((s as any).options);

      questions.push({
        id: uid("q"),
        kind: mode === "multi" ? "multi_select" : "single_select",
        field,
        title: String((s as any).title ?? "Выбор"),
        required: Boolean((s as any).required),
        options: opts.length ? opts : [{ value: "opt_1", label: "Вариант 1" }],
      });
      continue;
    }

    if (stype === "contact") {
      contact.enabled = true;

      const ff = (s as any).fields;
      if (Array.isArray(ff)) {
        contact.name.enabled = false;
        contact.email.enabled = false;
        contact.phone.enabled = false;

        for (const f of ff) {
          if (!f || typeof f !== "object") continue;
          const fld = String((f as any).field ?? "");
          const required = Boolean((f as any).required);

          if (fld === "name") {
            contact.name.enabled = true;
            contact.name.required = required;
          } else if (fld === "email") {
            contact.email.enabled = true;
            contact.email.required = required;
          } else if (fld === "phone") {
            contact.phone.enabled = true;
            contact.phone.required = required;
          }
        }
      }

      continue;
    }

    unknownSlides.push(s);
  }

  if (questions.length === 0) {
    questions.push({
      id: uid("q"),
      kind: "rating",
      field: "rating_overall",
      title: "Как вам у нас?",
      required: true,
      scale: 10,
    });
  }

  return { title, questions, contact, unknownSlides, meta };
}

function buildSchema(params: {
  title: string;
  questions: BuilderQuestion[];
  contact: ContactState;
  unknownSlides: any[];
  baseMeta: any;
}) {
  const { title, questions, contact, unknownSlides, baseMeta } = params;

  const meta = baseMeta && typeof baseMeta === "object" && !Array.isArray(baseMeta) ? { ...baseMeta } : {};
  meta.builder = true;

  const slides: any[] = [];

  questions.forEach((q, idx) => {
    const sid = `s${idx + 1}`;

    if (q.kind === "rating") {
      slides.push({
        id: sid,
        type: "rating",
        field: q.field,
        title: q.title,
        required: Boolean(q.required),
        scale: Number(q.scale ?? 10) <= 5 ? 5 : 10,
      });
      return;
    }

    if (q.kind === "text") {
      slides.push({
        id: sid,
        type: "text",
        field: q.field,
        title: q.title,
        required: Boolean(q.required),
        ...(q.placeholder ? { placeholder: q.placeholder } : {}),
        ...(q.maxLength ? { maxLength: Number(q.maxLength) } : {}),
      });
      return;
    }

    // ✅ choice
    const mode = q.kind === "multi_select" ? "multi" : "single";
    const options = normalizeOptions(q.options ?? []);
    slides.push({
      id: sid,
      type: "choice",
      mode,
      field: q.field,
      title: q.title,
      required: Boolean(q.required),
      options,
    });
  });

  if (contact.enabled) {
    const fields: any[] = [];
    if (contact.name.enabled) fields.push({ type: "text", field: "name", required: Boolean(contact.name.required) });
    if (contact.email.enabled) fields.push({ type: "email", field: "email", required: Boolean(contact.email.required) });
    if (contact.phone.enabled) fields.push({ type: "text", field: "phone", required: Boolean(contact.phone.required) });

    slides.push({
      id: "contact",
      type: "contact",
      title: "Контакт (если хотите)",
      fields,
    });
  }

  for (const u of unknownSlides) slides.push(u);

  return { meta, title, slides };
}

function toPreviewSchema(title: string, questions: BuilderQuestion[], contact: ContactState): SurveySchema {
  const fields: SurveyField[] = [];

  for (const q of questions) {
    if (q.kind === "rating") {
      fields.push({
        id: q.field,
        type: "rating_1_10",
        label: q.title,
        required: q.required,
        max: q.scale ?? 10,
      } as any);
      continue;
    }

    if (q.kind === "text") {
      fields.push({
        id: q.field,
        type: "textarea",
        label: q.title,
        required: q.required,
        placeholder: q.placeholder ?? "",
      });
      continue;
    }

    const options = normalizeOptions(q.options ?? []);
    fields.push({
      id: q.field,
      type: q.kind === "multi_select" ? "multi_select" : "single_select",
      label: q.title,
      required: q.required,
      options,
    } as any);
  }

  if (contact.enabled) {
    if (contact.name.enabled) fields.push({ id: "name", type: "text", label: "Имя", required: contact.name.required });
    if (contact.email.enabled) fields.push({ id: "email", type: "text", label: "Email", required: contact.email.required, placeholder: "name@example.com" });
    if (contact.phone.enabled) fields.push({ id: "phone", type: "text", label: "Телефон", required: contact.phone.required });
  }

  return { id: "builder-preview", title, fields };
}

export default function AdminSurveyVersionEditorPage() {
  const { versionId } = useParams();
  const id = Number(versionId || 0);
  const nav = useNavigate();
  const { enabled: devEnabled } = useDevMode();
  const { me } = useAuth();

  const roleValues = Array.isArray(me?.roles) ? (me as any).roles.map((r: any) => r?.role) : [];
  const isAdmin = roleValues.includes("admin");
  const isOps = roleValues.includes("ops_director") || roleValues.includes("manager");
  const isService = roleValues.includes("service_manager");
  const isAuditor = roleValues.includes("auditor") || roleValues.includes("auditor_global");
  const isDirectorLike = roleValues.includes("director") || roleValues.includes("super_admin");
  const isAdminLike = isAdmin || isDirectorLike;

  const isStatsOnly = isAuditor && !isAdminLike && !isOps && !isService;

  if (isStatsOnly) {
    return (
      <AppShell>
        <GlassCard>
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Доступ ограничен</div>
          <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
            Для аудитора доступен только просмотр статистики и результатов.
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => nav("/admin")}>На дашборд</Button>
          </div>
        </GlassCard>
      </AppShell>
    );
  }

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tab, setTab] = useState<"builder" | "json">("builder");
  const [schemaText, setSchemaText] = useState("");
  const [widgetText, setWidgetText] = useState("");

  const [title, setTitle] = useState("Анкета");
  const [questions, setQuestions] = useState<BuilderQuestion[]>([]);
  const [contact, setContact] = useState<ContactState>(defaultContact());
  const [unknownSlides, setUnknownSlides] = useState<any[]>([]);
  const [baseMeta, setBaseMeta] = useState<any>({});

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!devEnabled && tab === "json") setTab("builder");
  }, [devEnabled, tab]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      setSaveMsg(null);

      try {
        const resp = await adminJson<Resp>(`/api/admin/admin/survey-versions/${id}`);
        if (!alive) return;

        setData(resp);
        setSchemaText(safeStringify(resp.schema));
        setWidgetText(safeStringify(resp.widget_config));

        const parsed = parseSchema(resp.schema ?? {});
        setTitle(parsed.title);
        setQuestions(parsed.questions);
        setContact(parsed.contact);
        setUnknownSlides(parsed.unknownSlides);
        setBaseMeta(parsed.meta);
      } catch (e: any) {
        if (!alive) return;
        setErr(typeof e?.detail === "string" ? e.detail : "Не удалось загрузить версию анкеты.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const previewSchema = useMemo(() => toPreviewSchema(title, questions, contact), [title, questions, contact]);

  const addQuestion = (kind: QKind) => {
    const q: BuilderQuestion =
      kind === "rating"
        ? { id: uid("q"), kind: "rating", field: uid("rating"), title: "Оцените сервис", required: false, scale: 10 }
        : kind === "text"
          ? { id: uid("q"), kind: "text", field: uid("comment"), title: "Комментарий", required: false, placeholder: "Напишите пару слов…", maxLength: 800 }
          : { id: uid("q"), kind, field: uid("choice"), title: "Выберите вариант", required: false, options: [{ value: "opt_1", label: "Вариант 1" }, { value: "opt_2", label: "Вариант 2" }] };

    setQuestions((p) => [...p, q]);
    setSaveMsg(null);
  };

  const move = (idx: number, dir: -1 | 1) => {
    setQuestions((p) => {
      const next = [...p];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return p;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setSaveMsg(null);
  };

  const remove = (idx: number) => {
    setQuestions((p) => p.filter((_, i) => i !== idx));
    setSaveMsg(null);
  };

  const patchQ = (idx: number, patch: Partial<BuilderQuestion>) => {
    setQuestions((p) => p.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
    setSaveMsg(null);
  };

  const addOption = (qIdx: number) => {
    const q = questions[qIdx];
    const opts = coerceOptionsKeepEmpty(q.options ?? []);
    const n = opts.length + 1;
    patchQ(qIdx, { options: [...opts, { value: `opt_${n}`, label: `Вариант ${n}` }] });
  };

  const removeOption = (qIdx: number, optIdx: number) => {
    const q = questions[qIdx];
    const opts = coerceOptionsKeepEmpty(q.options ?? []).filter((_, i) => i !== optIdx);
    patchQ(qIdx, { options: opts });
  };

  const patchOption = (qIdx: number, optIdx: number, patch: Partial<Option>) => {
    const q = questions[qIdx];
    const opts = coerceOptionsKeepEmpty(q.options ?? []).map((o, i) => (i === optIdx ? { ...o, ...patch } : o));
    patchQ(qIdx, { options: opts });
  };

  const save = async () => {
    if (!data) return;
    setErr(null);
    setSaveMsg(null);

    if (!title.trim()) return setErr("Заголовок анкеты не должен быть пустым.");
    if (!questions.length) return setErr("Добавь хотя бы один вопрос.");

    for (const q of questions) {
      if (q.kind === "single_select" || q.kind === "multi_select") {
        const raw = coerceOptionsKeepEmpty(q.options ?? []);
        if (raw.length === 0) return setErr(`Вопрос “${q.title}”: добавь хотя бы один вариант ответа.`);

        // Do not silently drop empty options on save — show a clear validation error instead.
        for (let i = 0; i < raw.length; i++) {
          const label = String(raw[i]?.label ?? "").trim();
          const value = String(raw[i]?.value ?? "").trim();
          if (!label) return setErr(`Вопрос “${q.title}”: вариант №${i + 1} не должен быть пустым.`);
          if (devEnabled && !value) return setErr(`Вопрос “${q.title}”: у варианта №${i + 1} должен быть заполнен служебный код.`);
        }
      }
    }

    const schema = buildSchema({ title: title.trim(), questions, contact, unknownSlides, baseMeta });

    setSaving(true);
    try {
      await adminJson(`/api/admin/admin/survey-versions/${data.id}`, {
        method: "PATCH",
        body: JSON.stringify({ schema, widget_config: data.widget_config ?? {} }),
      });
      setSaveMsg("Изменения сохранены.");

      const fresh = await adminJson<Resp>(`/api/admin/admin/survey-versions/${data.id}`);
      setData(fresh);
      setSchemaText(safeStringify(fresh.schema));
      setWidgetText(safeStringify(fresh.widget_config));

      const parsed = parseSchema(fresh.schema ?? {});
      setTitle(parsed.title);
      setQuestions(parsed.questions);
      setContact(parsed.contact);
      setUnknownSlides(parsed.unknownSlides);
      setBaseMeta(parsed.meta);
    } catch (e: any) {
      setErr(typeof e?.detail === "string" ? e.detail : "Не удалось сохранить.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Анкеты</div>
            <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Редактор анкеты</h1>
            {data ? (
              <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
                Версия {data.version}
                {data.is_active ? " • Активная" : ""}
              </div>
            ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={!data || saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className={tab === "builder" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}
          onClick={() => setTab("builder")}
        >
          Конструктор
        </Button>

        {devEnabled ? (
          <Button
            variant="secondary"
            className={tab === "json" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}
            onClick={() => setTab("json")}
          >
            Служебные данные
          </Button>
        ) : null}
      </div>

      {err ? (
        <GlassCard className="mb-4">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 whitespace-pre-wrap text-sm text-rose-300">
            {err}
          </div>
        </GlassCard>
      ) : null}

      {saveMsg ? (
        <GlassCard className="mb-4">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
            {saveMsg}
          </div>
        </GlassCard>
      ) : null}

      {loading ? (
        <GlassCard>
          <div className="text-sm text-[color:var(--pg-muted)]">Загрузка…</div>
        </GlassCard>
      ) : null}

      {tab === "json" && devEnabled ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard>
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">Структура анкеты</div>
            <textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              spellCheck={false}
              className="mt-3 h-[560px] w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 font-mono text-xs text-[color:var(--pg-text)] outline-none"
            />
          </GlassCard>

          <GlassCard>
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">Настройки виджета</div>
            <textarea
              value={widgetText}
              onChange={(e) => setWidgetText(e.target.value)}
              spellCheck={false}
              className="mt-3 h-[560px] w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 font-mono text-xs text-[color:var(--pg-text)] outline-none"
            />
          </GlassCard>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* LEFT */}
          <div className="space-y-4">
            <GlassCard>
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">Заголовок анкеты</div>
              <input
                className="mt-3 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Оцените ваш опыт"
              />
            </GlassCard>

            <GlassCard>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Шаги / вопросы</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => addQuestion("rating")}>+ Шкала</Button>
                  <Button variant="secondary" onClick={() => addQuestion("text")}>+ Текст</Button>
                  <Button variant="secondary" onClick={() => addQuestion("single_select")}>+ Выбор 1</Button>
                  <Button variant="secondary" onClick={() => addQuestion("multi_select")}>+ Выбор N</Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {questions.map((q, idx) => (
                  <div key={q.id} className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-[color:var(--pg-muted)]">Шаг {idx + 1}</div>
                        <div className="mt-1 text-sm font-semibold text-[color:var(--pg-text)]">
                          {q.title || "(без названия)"}{" "}
                          <span className="text-xs text-[color:var(--pg-faint)]">
                            • {q.kind === "rating" ? "Шкала" : q.kind === "text" ? "Текст" : q.kind === "single_select" ? "Один вариант" : "Несколько вариантов"}
                          </span>
                        </div>
                        {devEnabled ? (
                          <div className="mt-1 font-mono text-[11px] text-[color:var(--pg-faint)]">
                            Код поля: {q.field}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</Button>
                        <Button variant="secondary" onClick={() => move(idx, 1)} disabled={idx === questions.length - 1}>↓</Button>
                        <Button variant="secondary" onClick={() => remove(idx)}>Удалить</Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-[color:var(--pg-muted)]">Тип</div>
                        <select
                          className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                          value={q.kind}
                          onChange={(e) => {
                            const next = e.target.value as QKind;
                            if (next === q.kind) return;

                            if (next === "rating") patchQ(idx, { kind: "rating", scale: 10, options: undefined, placeholder: undefined, maxLength: undefined });
                            else if (next === "text") patchQ(idx, { kind: "text", placeholder: "Напишите пару слов…", maxLength: 800, options: undefined, scale: undefined });
                            else patchQ(idx, { kind: next, options: [{ value: "opt_1", label: "Вариант 1" }, { value: "opt_2", label: "Вариант 2" }], scale: undefined, placeholder: undefined, maxLength: undefined });
                          }}
                        >
                          <option value="rating">Шкала</option>
                          <option value="text">Текст</option>
                          <option value="single_select">Один вариант</option>
                          <option value="multi_select">Несколько вариантов</option>
                        </select>
                      </div>

                      <div>
                        <div className="text-xs text-[color:var(--pg-muted)]">Название</div>
                        <input
                          className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                          value={q.title}
                          onChange={(e) => patchQ(idx, { title: e.target.value })}
                        />
                      </div>

                      <label className="flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
                        <input type="checkbox" checked={q.required} onChange={(e) => patchQ(idx, { required: e.target.checked })} />
                        Обязательный
                      </label>

                      {q.kind === "rating" ? (
                        <div>
                          <div className="text-xs text-[color:var(--pg-muted)]">Шкала</div>
                          <select
                            className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                            value={Number(q.scale ?? 10) <= 5 ? 5 : 10}
                            onChange={(e) => patchQ(idx, { scale: Number(e.target.value) as 5 | 10 })}
                          >
                            <option value={5}>1–5</option>
                            <option value={10}>1–10</option>
                          </select>
                        </div>
                      ) : null}

                      {q.kind === "text" ? (
                        <>
                          <div className="sm:col-span-2">
                            <div className="text-xs text-[color:var(--pg-muted)]">Подсказка в поле</div>
                            <input
                              className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                              value={q.placeholder ?? ""}
                              onChange={(e) => patchQ(idx, { placeholder: e.target.value })}
                            />
                          </div>

                          <div>
                            <div className="text-xs text-[color:var(--pg-muted)]">Максимальная длина</div>
                            <input
                              type="number"
                              min={1}
                              className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                              value={q.maxLength ?? ""}
                              onChange={(e) => patchQ(idx, { maxLength: e.target.value ? Number(e.target.value) : undefined })}
                            />
                          </div>
                        </>
                      ) : null}

                      {q.kind === "single_select" || q.kind === "multi_select" ? (
                        <div className="sm:col-span-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-[color:var(--pg-muted)]">Варианты</div>
                            <Button variant="secondary" onClick={() => addOption(idx)}>+ Вариант</Button>
                          </div>

                          <div className="mt-2 space-y-2">
                            {coerceOptionsKeepEmpty(q.options ?? []).map((o, oi) => (
                              <div key={`${o.value}-${oi}`} className="flex flex-wrap items-center gap-2">
                                {devEnabled ? (
                                  <input
                                    className="w-[160px] rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                                    value={o.value}
                                    onChange={(e) => patchOption(idx, oi, { value: e.target.value })}
                                    placeholder="value"
                                  />
                                ) : null}

                                <input
                                  className="flex-1 min-w-[220px] rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-3 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                                  value={o.label}
                                  onChange={(e) => patchOption(idx, oi, { label: e.target.value })}
                                  placeholder="Текст варианта"
                                />

                                <Button variant="secondary" onClick={() => removeOption(idx, oi)}>Удалить</Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[color:var(--pg-text)]">Контактный блок</div>
                <label className="flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
                  <input type="checkbox" checked={contact.enabled} onChange={(e) => setContact((p) => ({ ...p, enabled: e.target.checked }))} />
                  Включить
                </label>
              </div>

              {contact.enabled ? (
                <div className="mt-3 space-y-3">
                  {(["name", "email", "phone"] as const).map((k) => (
                    <div key={k} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3">
                      <div className="text-sm text-[color:var(--pg-text)]">{k === "name" ? "Имя" : k === "email" ? "Email" : "Телефон"}</div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
                          <input
                            type="checkbox"
                            checked={(contact as any)[k].enabled}
                            onChange={(e) => setContact((p) => ({ ...p, [k]: { ...(p as any)[k], enabled: e.target.checked } }))}
                          />
                          Поле
                        </label>

                        <label className="flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
                          <input
                            type="checkbox"
                            checked={(contact as any)[k].required}
                            disabled={!(contact as any)[k].enabled}
                            onChange={(e) => setContact((p) => ({ ...p, [k]: { ...(p as any)[k], required: e.target.checked } }))}
                          />
                          Обязательное
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-[color:var(--pg-muted)]">Контактный блок будет скрыт для гостя.</div>
              )}
            </GlassCard>
          </div>

          {/* RIGHT */}
          <div className="space-y-4">
            <GlassCard>
              <div className="text-sm font-semibold text-[color:var(--pg-text)]">Предпросмотр (как у гостя)</div>
              <div className="mt-3">
                <SurveyWizard
                  schema={previewSchema}
                  submitLabel="(Preview)"
                  successText="(Preview) Ответы не отправляются."
                  onSubmit={async () => {
                    await new Promise((r) => setTimeout(r, 120));
                  }}
                />
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </AppShell>
  );
}
