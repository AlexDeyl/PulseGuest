import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useDevMode } from "../shared/devMode";
import type { ChecklistRunDetail, ChecklistRunQuestion } from "../shared/auditApi";
import {
  completeChecklistRun,
  downloadChecklistRunPdf,
  downloadAttachmentBlob,
  getChecklistRun,
  uploadChecklistAttachment,
  upsertChecklistAnswer,
} from "../shared/auditApi";

function errToText(e: any, devEnabled: boolean) {
  if (!e) return "Ошибка запроса. Попробуйте ещё раз.";
  if (typeof e?.detail === "string") return e.detail;
  if (typeof e?.detail?.detail === "string") return e.detail.detail;
  // fastapi часто отдаёт detail: {message, ...}
  if (typeof e?.detail?.message === "string") return e.detail.message;
  if (devEnabled) {
    try {
      return JSON.stringify(e?.detail ?? e, null, 2);
    } catch {
      return String(e?.message ?? "Ошибка");
    }
  }
  return "Не удалось загрузить данные. Попробуйте обновить страницу.";
}

type DraftAnswer = { value: any; comment: string };

function answeredByValue(value: any) {
  if (!value) return false;
  if (typeof value !== "object") return true;
  if (typeof value.choice === "string" && value.choice.length) return true;
  if (typeof value.text === "string" && value.text.trim().length) return true;
  if (typeof value.score === "number") return true;
  return Object.keys(value).length > 0;
}

function qAnswered(q: ChecklistRunQuestion, local: DraftAnswer | null) {
  const v = local?.value ?? q.answer?.value;
  const c = local?.comment ?? q.answer?.comment;
  if (answeredByValue(v)) return true;
  if (typeof c === "string" && c.trim().length > 0) return true;
  return false;
}

function yesNoLabels(q: ChecklistRunQuestion): { yes: string; no: string } {
  const opts = q.options ?? {};
  return {
    yes: String(opts?.yes_label ?? "Да"),
    no: String(opts?.no_label ?? "Нет"),
  };
}

function yesNoScores(q: ChecklistRunQuestion): { yes: number | null; no: number | null } {
  const opts = q.options ?? {};
  const y = opts?.yes_score;
  const n = opts?.no_score;
  return {
    yes: typeof y === "number" ? y : null,
    no: typeof n === "number" ? n : null,
  };
}

function statusLabel(status: string | undefined | null) {
  const s = String(status || "");
  if (s === "completed") return "Завершен";
  if (s === "draft") return "Черновик";
  return s || "—";
}

async function downloadBlobAsFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function openBlobInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // не ревоким сразу, чтобы вкладка успела загрузить
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export default function AdminAuditRunPage() {
  const { runId } = useParams();
  const rid = Number(runId);
  const nav = useNavigate();
  const { enabled: devEnabled } = useDevMode();

  const [data, setData] = useState<ChecklistRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uiMsg, setUiMsg] = useState<string | null>(null);

  const [activeQid, setActiveQid] = useState<number | null>(null);

  const [draft, setDraft] = useState<Record<number, DraftAnswer>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [savedAt, setSavedAt] = useState<Record<number, string>>({});
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});

  const timersRef = useRef<Record<number, any>>({});
  const seqRef = useRef<Record<number, number>>({});
  const draftRef = useRef<Record<number, DraftAnswer>>({});

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const isReadOnly = data?.status === "completed";

  const refresh = async () => {
    if (!Number.isFinite(rid) || rid <= 0) return;
    setLoading(true);
    setErr(null);
    try {
      const run = await getChecklistRun(rid);
      setData(run);
      // гарантируем что активный вопрос выбран
      if (run.questions?.length) {
        const exists = run.questions.find((q) => q.id === activeQid);
        if (!exists) {
          setActiveQid(run.questions[0].id);
        }
      }
    } catch (e) {
      setErr(errToText(e, devEnabled));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);

  // Build image previews (authorized fetch -> blob -> object URL)
  useEffect(() => {
    let cancelled = false;

    const build = async () => {
      const run = data;
      if (!run) return;

      const next: Record<number, string> = {};
      for (const [id, url] of Object.entries(previewUrls)) next[Number(id)] = url;

      const need: number[] = [];
      for (const q of run.questions ?? []) {
        for (const a of q.attachments ?? []) {
          if (next[a.id]) continue;
          if (!String(a.content_type || "").startsWith("image/")) continue;
          need.push(a.id);
        }
      }
      if (!need.length) return;

      for (const aid of need.slice(0, 20)) {
        try {
          const blob = await downloadAttachmentBlob(aid);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          next[aid] = url;
          setPreviewUrls((prev) => ({ ...prev, [aid]: url }));
        } catch {
          // ignore preview errors
        }
      }
    };

    void build();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrls)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const questions = data?.questions ?? [];

  const activeQ: ChecklistRunQuestion | null = useMemo(() => {
    if (!questions.length) return null;

    if (activeQid) {
      const q = questions.find((x) => x.id === activeQid);
      if (q) return q;
    }

    // fallback
    return questions[0];
  }, [activeQid, questions]);

  const sections = useMemo(() => {
    const map = new Map<string, ChecklistRunQuestion[]>();
    for (const q of questions) {
      const s = String(q.section || "Без раздела");
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(q);
    }
    return Array.from(map.entries()).map(([section, qs]) => ({
      section,
      questions: qs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
  }, [questions]);

  const answeredCount = useMemo(() => {
    let n = 0;
    for (const q of questions) {
      const local = draft[q.id] ?? null;
      if (qAnswered(q, local)) n += 1;
    }
    return n;
  }, [questions, draft]);

  const setAnswerValue = (questionId: number, nextValue: any) => {
    if (!data) return;
    if (data.status !== "draft") return;

    setDraft((prev) => {
      const cur = prev[questionId] ?? { value: {}, comment: "" };
      return { ...prev, [questionId]: { ...cur, value: nextValue ?? {} } };
    });
    scheduleSave(questionId);
  };

  const setAnswerComment = (questionId: number, nextComment: string) => {
    if (!data) return;
    if (data.status !== "draft") return;

    setDraft((prev) => {
      const cur = prev[questionId] ?? { value: {}, comment: "" };
      return { ...prev, [questionId]: { ...cur, comment: nextComment ?? "" } };
    });
    scheduleSave(questionId);
  };

  const scheduleSave = (questionId: number) => {
    if (!data) return;
    if (data.status !== "draft") return;

    // debounce per question
    if (timersRef.current[questionId]) {
      clearTimeout(timersRef.current[questionId]);
    }

    timersRef.current[questionId] = setTimeout(async () => {
      const seq = (seqRef.current[questionId] ?? 0) + 1;
      seqRef.current[questionId] = seq;

      setSaving((p) => ({ ...p, [questionId]: true }));

      const q = questions.find((x) => x.id === questionId);
      const local = draftRef.current[questionId];
      const value = local?.value ?? q?.answer?.value ?? {};
      const comment = local?.comment ?? q?.answer?.comment ?? "";

      try {
        await upsertChecklistAnswer({ runId: data.id, questionId, value, comment });
        if (seqRef.current[questionId] !== seq) return; // stale
        setSavedAt((p) => ({ ...p, [questionId]: new Date().toISOString() }));
      } catch {
        // keep silent; auditor can continue filling
      } finally {
        if (seqRef.current[questionId] !== seq) return;
        setSaving((p) => ({ ...p, [questionId]: false }));
      }
    }, 650);
  };

  const onUpload = async (q: ChecklistRunQuestion, file: File) => {
    if (!data) return;
    if (data.status !== "draft") return;

    setUploading((p) => ({ ...p, [q.id]: true }));
    try {
      await uploadChecklistAttachment({ runId: data.id, questionId: q.id, file });
      await refresh();
    } catch {
      // ignore
    } finally {
      setUploading((p) => ({ ...p, [q.id]: false }));
    }
  };

  const openAttachment = async (attachmentId: number, fileName: string, contentType?: string) => {
    try {
      const blob = await downloadAttachmentBlob(attachmentId);
      const isImg = String(contentType || "").startsWith("image/");
      if (isImg) {
        await openBlobInNewTab(blob);
      } else {
        await downloadBlobAsFile(blob, fileName || `attachment_${attachmentId}`);
      }
    } catch {
      // ignore
    }
  };

  const onSend = async () => {
    if (!data) return;
    if (data.status !== "draft") return;

    setUiMsg(null);

    // блокируем отправку если не все вопросы заполнены
    const total = questions.length;
    if (answeredCount < total) {
      const missing = total - answeredCount;
      setUiMsg(`Нельзя отправить: заполните все ответы. Осталось: ${missing}`);
      return;
    }

    try {
      await completeChecklistRun(data.id);
      await refresh();
      setUiMsg("Чек-лист отправлен. Теперь доступен только для просмотра.");
    } catch (e) {
      setUiMsg(errToText(e, devEnabled));
    }
  };

  const onPdf = async () => {
    if (!data) return;
    try {
      const { blob, filename } = await downloadChecklistRunPdf(data.id);
      await downloadBlobAsFile(blob, filename || `audit_run_${data.id}.pdf`);
    } catch (e) {
      setUiMsg(errToText(e, devEnabled));
    }
  };

  const renderAnswerControl = (q: ChecklistRunQuestion) => {
    const local = draft[q.id] ?? null;
    const readOnly = isReadOnly;
    const comment = local?.comment ?? q.answer?.comment ?? "";
    const value = local?.value ?? q.answer?.value ?? {};

    const t = String(q.answer_type || "");

    if (t === "yesno" || t === "yesno_score") {
      const labels = yesNoLabels(q);
      const scores = yesNoScores(q);
      const choice = typeof value?.choice === "string" ? value.choice : "";

      const setChoice = (c: "yes" | "no") => {
        const next: any = { choice: c };
        if (t === "yesno_score") {
          next.score = c === "yes" ? scores.yes : scores.no;
        }
        setAnswerValue(q.id, next);
      };

      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={choice === "yes" ? "primary" : "secondary"}
            className="px-4 py-2"
            onClick={() => setChoice("yes")}
            disabled={isReadOnly}
          >
            {labels.yes}
          </Button>
          <Button
            variant={choice === "no" ? "primary" : "secondary"}
            className="px-4 py-2"
            onClick={() => setChoice("no")}
            disabled={isReadOnly}
          >
            {labels.no}
          </Button>
        </div>
      );
    }

    // default: text
    return (
      <div className="mt-3">
        <textarea
          value={typeof value?.text === "string" ? value.text : ""}
          onChange={(e) => setAnswerValue(q.id, { ...value, text: e.target.value })}
          disabled={data?.status !== "draft"}
          placeholder="Введите ответ…"
          className="h-28 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 text-sm text-[color:var(--pg-text)] outline-none"
        />
      </div>
    );
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-[color:var(--pg-text)]">
            {data ? data.template.name : "Чек-лист"}
          </div>

          <div className="mt-1 text-sm text-[color:var(--pg-muted)]">
            {data ? (
              <>
                Статус:{" "}
                <span className="text-[color:var(--pg-text)]">{statusLabel(data.status)}</span>
                <span className="mx-2 text-[color:var(--pg-faint)]">•</span>
                Заполнено:{" "}
                <span className="text-[color:var(--pg-text)]">
                  {answeredCount}/{questions.length}
                </span>
                {data.completed_at ? (
                  <>
                    <span className="mx-2 text-[color:var(--pg-faint)]">•</span>
                    Дата:{" "}
                    <span className="text-[color:var(--pg-text)]">
                      {new Date(data.completed_at).toLocaleDateString("ru-RU")}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              ""
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/admin/audits/history")}>
              К истории
            </Button>
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
            Обновить
          </Button>

          {data?.status === "completed" && (
            <Button variant="secondary" onClick={() => void onPdf()}>
              Скачать PDF
            </Button>
          )}

          {data?.status === "draft" && (
            <Button onClick={() => void onSend()}>
              Отправить
            </Button>
          )}
        </div>
      </div>

      {isReadOnly && (
        <GlassCard className="mb-6">
          <div className="text-sm text-[color:var(--pg-muted)]">
            Чек-лист завершён. Просмотр доступен только в режиме чтения.
          </div>
        </GlassCard>
      )}

      {uiMsg && (
        <GlassCard className="mb-6">
          <div className="text-sm text-[color:var(--pg-text)]">{uiMsg}</div>
        </GlassCard>
      )}

      {err && (
        <GlassCard className="mb-6 border border-rose-500/30">
          <div className="text-sm text-rose-300">{err}</div>
        </GlassCard>
      )}

      {loading && <div className="mb-4 text-sm text-[color:var(--pg-faint)]">Загрузка…</div>}

      {!data ? null : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          {/* LEFT: questions list */}
          <GlassCard className="p-4">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">Вопросы</div>
            <div className="mt-3 max-h-[68vh] overflow-auto pr-1">
              {sections.map((s) => (
                <div key={s.section} className="mb-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--pg-muted)]">
                    {s.section}
                  </div>

                  <div className="grid gap-1">
                    {s.questions.map((q) => {
                      const isActive = q.id === activeQid;
                      const isDone = qAnswered(q, draft[q.id] ?? null);
                      const hasPhotos = (q.attachments?.length ?? 0) > 0;

                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setActiveQid(q.id)}
                          className={[
                            "flex w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition",
                            "border-[color:var(--pg-border)]",
                            isActive
                              ? "bg-[color:var(--pg-card-hover)]"
                              : "bg-[color:var(--pg-card)] hover:bg-[color:var(--pg-card-hover)]",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                              isDone ? "bg-emerald-400/80" : "bg-[color:var(--pg-faint)]",
                            ].join(" ")}
                            aria-label={isDone ? "Заполнено" : "Пусто"}
                          />
                          <span className="flex min-w-0 items-start gap-2">
                            <span className="line-clamp-2 text-[color:var(--pg-text)]">{q.text}</span>
                            {hasPhotos && (
                              <span title="Есть фотофиксация" className="text-xs opacity-80">
                                📷
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {isReadOnly && (
              <div className="mt-4 text-xs text-[color:var(--pg-muted)]">
                Чек-лист завершён. Редактирование отключено.
              </div>
            )}
          </GlassCard>

          {/* RIGHT: active question */}
          <div className="grid gap-4">
            {!activeQ && questions.length === 0 ? (
              <GlassCard className="p-6">
                <div className="text-sm text-[color:var(--pg-muted)]">Выберите вопрос слева.</div>
              </GlassCard>
            ) : (
              <GlassCard className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-[color:var(--pg-muted)]">Вопрос</div>
                    <div className="mt-1 text-lg font-semibold text-[color:var(--pg-text)]">
                      {activeQ.text}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--pg-muted)]">
                      <span>type: {activeQ.answer_type}</span>
                      {activeQ.is_required && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                          обязательный
                        </span>
                      )}
                      {data.status === "draft" && saving[activeQ.id] && (
                        <span className="text-[color:var(--pg-faint)]">Сохранение…</span>
                      )}
                      {data.status === "draft" && !saving[activeQ.id] && savedAt[activeQ.id] && (
                        <span className="text-[color:var(--pg-faint)]">Сохранено</span>
                      )}
                      {data.status !== "draft" && (
                        <span className="text-[color:var(--pg-faint)]">только просмотр</span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const idx = questions.findIndex((x) => x.id === activeQ.id);
                        if (idx >= 0 && idx < questions.length - 1) setActiveQid(questions[idx + 1].id);
                      }}
                    >
                      Следующий
                    </Button>
                  </div>
                </div>

                {/* Answer control */}
                <div className="mt-4">
                  <div className="text-sm font-semibold text-[color:var(--pg-text)]">Ответ</div>
                  {renderAnswerControl(activeQ)}
                </div>

                {/* Comment */}
                {activeQ.allow_comment && (
                  <div className="mt-6">
                    <div className="text-sm font-semibold text-[color:var(--pg-text)]">Комментарий</div>
                    <textarea
                      disabled={isReadOnly}
                      value={
                        typeof (draft[activeQ.id]?.comment ?? activeQ.answer?.comment) === "string"
                          ? (draft[activeQ.id]?.comment ?? activeQ.answer?.comment)
                          : ""
                      }
                      onChange={(e) => setAnswerComment(activeQ.id, e.target.value)}
                      placeholder="Произвольный комментарий…"
                      className="mt-3 h-24 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] p-4 text-sm text-[color:var(--pg-text)] outline-none"
                    />
                  </div>
                )}

                {/* Attachments */}
                {activeQ.allow_photos && (
                  <div className="mt-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-[color:var(--pg-text)]">Фото</div>
                      <div className="text-xs text-[color:var(--pg-muted)]">
                        {data.status === "draft"
                          ? uploading[activeQ.id]
                            ? "Загрузка…"
                            : "Можно прикрепить с камеры или из файлов"
                          : "Фотофиксация доступна для просмотра"}
                      </div>
                    </div>

                    {/* Upload only in draft */}
                    {data.status === "draft" && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <input
                          type="file"
                          disabled={isReadOnly}
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            void onUpload(activeQ, f);
                            e.currentTarget.value = "";
                          }}
                          className="block w-full max-w-xs text-xs text-[color:var(--pg-muted)] file:mr-3 file:rounded-xl file:border-0 file:bg-[color:var(--pg-card-hover)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[color:var(--pg-text)] hover:file:opacity-95"
                        />
                      </div>
                    )}

                    {/* Photo fixation + open photos */}
                    {(activeQ.attachments?.length ?? 0) > 0 && (
                      <div className="mt-4">
                        <div className="text-xs text-[color:var(--pg-muted)]">
                          Имеется фотофиксация: {activeQ.attachments.length}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {activeQ.attachments.map((a, idx) => (
                            <Button
                              key={a.id}
                              variant="secondary"
                              className="px-3 py-2 text-xs"
                              onClick={() => void openAttachment(a.id, a.file_name, a.content_type)}
                            >
                              Фото {idx + 1}
                            </Button>
                          ))}
                        </div>

                        {/* Thumbnails grid (удобно визуально) */}
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {activeQ.attachments.map((a) => {
                            const isImg = String(a.content_type || "").startsWith("image/");
                            const preview = previewUrls[a.id] || "";
                            return (
                              <div
                                key={a.id}
                                className="flex items-start gap-3 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3"
                              >
                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card-hover)]">
                                  {isImg && preview ? (
                                    <img src={preview} alt={a.file_name} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="grid h-full w-full place-items-center text-xs text-[color:var(--pg-muted)]">
                                      файл
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="line-clamp-2 text-xs font-semibold text-[color:var(--pg-text)]">
                                    {a.file_name}
                                  </div>
                                  <div className="mt-1 text-xs text-[color:var(--pg-muted)]">{a.content_type}</div>
                                  <div className="mt-2">
                                    <Button
                                      variant="secondary"
                                      className="px-3 py-2 text-xs"
                                      onClick={() => void openAttachment(a.id, a.file_name, a.content_type)}
                                    >
                                      Открыть
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-8 text-xs text-[color:var(--pg-muted)]">
                  {isReadOnly
                    ? "Чек-лист завершен. Изменения недоступны."
                    : "Автосейв: изменения сохраняются через ~0.6 сек после ввода."}
                </div>
              </GlassCard>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
