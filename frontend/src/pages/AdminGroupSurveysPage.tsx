import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import SurveyWizard from "../components/SurveyWizard";
import type { SurveyField, SurveySchema } from "../shared/surveyTypes";
import { adminJson } from "../shared/adminApi";
import { useDevMode } from "../shared/devMode";
import { useAuth } from "../shared/auth";

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

type ActivePayload = {
  survey_id: number;
  version_id: number;
  version: number;
  schema: any;
  widget_config: any;
};

type GroupSurveyResp = {
  organization_id: number;
  organization_name: string;
  group_key: string;
  group_name: string;
  binding: null | {
    id: number;
    survey_id: number;
    active_version_id: number;
  };
  survey: null | {
    id: number;
    name: string;
    is_archived: boolean;
    created_at: string | null;
  };
  active: ActivePayload | null;
  versions: { id: number; version: number; is_active: boolean; created_at: string | null }[];
  fallback: null | {
    mode: "location";
    location_id: number;
    location_name: string;
    active: ActivePayload;
  };
};

type GroupReviewLinksResp = {
  organization_id: number;
  group_key: string;
  yandex_url: string | null;
  twogis_url: string | null;
  errors?: { yandex_url?: string | null; twogis_url?: string | null };
};

const GROUP_LABELS_RU: Record<string, string> = {
  room: "Номера",
  restaurant: "Рестораны",
  conference_hall: "Конференц-залы",
  banquet_hall: "Банкетные залы",
  other: "Другое",
};

const GROUP_ORDER = ["room", "restaurant", "conference_hall", "banquet_hall", "other"];

function groupLabelRu(key: string) {
  return GROUP_LABELS_RU[key] ?? key;
}

function humanLabel(field: string, ftype?: string) {
  const key = field.toLowerCase();
  if (ftype === "email" || key.includes("email")) return "Email";
  if (key === "name" || key.includes("first_name")) return "Имя";
  if (key.includes("phone") || key.includes("tel")) return "Телефон";
  return field;
}

function formatDT(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function adaptBackendSchema(schema: Record<string, unknown> | null | undefined, titleFallback: string): SurveySchema | null {
  const title = (schema?.title as string | undefined) ?? titleFallback;
  const slides = (schema?.slides as unknown[] | undefined) ?? [];
  if (!Array.isArray(slides) || slides.length === 0) return null;

  const fields: SurveyField[] = [];

  for (const slide of slides) {
    if (!slide || typeof slide !== "object") continue;
    const s = slide as Record<string, unknown>;
    const stype = String(s.type ?? "");
    const slideTitle = (s.title as string | undefined) ?? "Вопрос";

    if (stype === "rating" || stype === "nps") {
      const fieldId =
        (s.field as string | undefined) ?? (s.id as string | undefined) ?? `rating_${fields.length}`;

      fields.push({
        id: fieldId,
        type: "rating_1_10",
        label: slideTitle,
        required: Boolean(s.required),
        hint: typeof s.hint === "string" ? s.hint : undefined,
        max: Number((s as any).scale ?? 10),
      } as any);
      continue;
    }

    if (stype === "text") {
      const fieldId =
        (s.field as string | undefined) ?? (s.id as string | undefined) ?? `text_${fields.length}`;
      fields.push({
        id: fieldId,
        type: "textarea",
        label: slideTitle,
        required: Boolean(s.required),
        placeholder: typeof s.placeholder === "string" ? s.placeholder : "Напишите пару слов…",
        hint: typeof s.hint === "string" ? s.hint : undefined,
      });
      continue;
    }

    // ✅ choice (single/multi)
    if (stype === "choice") {
      const fieldId = (s as any).field as string | undefined;
      if (!fieldId) continue;

      const mode = String((s as any).mode ?? "single");
      const rawOptions = (s as any).options;

      const options = Array.isArray(rawOptions)
        ? rawOptions
            .filter((o: any) => o && typeof o === "object")
            .map((o: any) => ({
              value: String(o.value ?? "").trim(),
              label: String(o.label ?? o.value ?? "").trim(),
            }))
            .filter((o: any) => o.value && o.label)
        : [];

      fields.push({
        id: fieldId,
        type: mode === "multi" ? "multi_select" : "single_select",
        label: slideTitle,
        required: Boolean((s as any).required),
        options,
        hint: typeof (s as any).hint === "string" ? (s as any).hint : undefined,
      } as any);
      continue;
    }

    if (stype === "contact") {
      const contactFields = (s.fields as unknown[] | undefined) ?? [];
      if (!Array.isArray(contactFields)) continue;

      for (const f of contactFields) {
        if (!f || typeof f !== "object") continue;
        const ff = f as Record<string, unknown>;
        const fieldId = ff.field as string | undefined;
        if (!fieldId) continue;

        const ftype = ff.type as string | undefined;
        fields.push({
          id: fieldId,
          type: "text",
          label: humanLabel(fieldId, ftype),
          required: Boolean(ff.required),
          placeholder: ftype === "email" ? "name@example.com" : undefined,
          hint: ftype === "email" ? "Email нужен только чтобы связаться при необходимости." : undefined,
        });
      }
      continue;
    }
  }

  if (fields.length === 0) return null;
  return { id: "group-preview", title, fields };
}

function errToText(e: any, devEnabled: boolean, fallback: string) {
  if (!devEnabled) return fallback;
  try {
    const st = e?.status ? `status=${e.status}` : "";
    const detail =
      e?.detail == null
        ? ""
        : typeof e.detail === "string"
          ? e.detail.slice(0, 400)
          : JSON.stringify(e.detail).slice(0, 400);
    return [fallback, st, detail].filter(Boolean).join(" • ");
  } catch {
    return fallback;
  }
}

function urlErrText(code?: string | null) {
  if (!code) return null;
  if (code === "invalid_url") return "Некорректная ссылка (нужен http/https).";
  return "Некорректное значение.";
}

export default function AdminGroupSurveysPage() {
  const nav = useNavigate();
  const { enabled: devEnabled } = useDevMode();
  const { me } = useAuth();

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

  const canManageGroupSurveys = isAdminLike || isOps || isService;

  const allowedOrgIds = useMemo(() => {
    const xs = Array.isArray(me?.allowed_organization_ids) ? me!.allowed_organization_ids : [];
    return xs.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
  }, [me]);

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

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<number | "">(() => {
    const raw = localStorage.getItem("pg_selected_org_id");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : "";
  });

  const [locations, setLocations] = useState<Loc[]>([]);
  const [groupKey, setGroupKey] = useState<string>(() => localStorage.getItem("pg_selected_group_key") || "all");

  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [groupData, setGroupData] = useState<Record<string, GroupSurveyResp | null>>({});
  const [groupErr, setGroupErr] = useState<Record<string, string | null>>({});
  const [previewOpen, setPreviewOpen] = useState<string | null>(null);

  // busy token: "group|action|id"
  const [busyToken, setBusyToken] = useState<string | null>(null);

  // Review links (group default): edit only for selected group (groupKey != 'all')
  const [reviewLinksLoading, setReviewLinksLoading] = useState(false);
  const [reviewLinksErr, setReviewLinksErr] = useState<string | null>(null);
  const [reviewLinksLoadedKey, setReviewLinksLoadedKey] = useState<string | null>(null);
  const [reviewLinksForm, setReviewLinksForm] = useState<{ yandex_url: string; twogis_url: string }>({
    yandex_url: "",
    twogis_url: "",
  });
  const [reviewLinksFieldErrors, setReviewLinksFieldErrors] = useState<{
    yandex_url?: string | null;
    twogis_url?: string | null;
  }>({});

  const [autoPreviewKey, setAutoPreviewKey] = useState<string | null>(
    () => localStorage.getItem("pg_auto_preview_group_key")
  );

  const readOnlyAll = groupKey === "all";

  // Organizations
  useEffect(() => {
    let alive = true;
    setLoadingOrgs(true);
    adminJson<Org[]>("/api/admin/admin/organizations")
      .then((xs) => {
        if (!alive) return;
        setOrgs(xs ?? []);
      })
      .catch((e: any) => {
        if (!alive) return;
        setOrgs([]);
        setErr(errToText(e, devEnabled, "Не удалось загрузить организации."));
      })
      .finally(() => {
        if (!alive) return;
        setLoadingOrgs(false);
      });
    return () => {
      alive = false;
    };
  }, [devEnabled]);

  const orgOptions = useMemo(() => {
    const base = devEnabled ? orgs : orgs.filter((o) => o.is_active);

    // Важно: показываем только те org, к которым есть доступ (иначе получим 403 на /organizations/{id}/locations)
    const allowedSet = new Set(allowedOrgIds);
    const xs = allowedOrgIds.length ? base.filter((o) => allowedSet.has(o.id)) : base;

    return xs.sort((a, b) => a.name.localeCompare(b.name));
  }, [orgs, devEnabled, allowedOrgIds]);

  // Ensure org selected
  useEffect(() => {
    if (!orgOptions.length) {
      setOrgId("");
      return;
    }
    const ids = new Set(orgOptions.map((o) => o.id));
    const cur = orgId === "" ? null : Number(orgId);
    if (cur == null || !ids.has(cur)) setOrgId(orgOptions[0].id);
  }, [orgOptions, orgId]);

  useEffect(() => {
    if (orgId === "") return;
    localStorage.setItem("pg_selected_org_id", String(orgId));
  }, [orgId]);

  // Locations for org (derive group tabs)
  useEffect(() => {
    let alive = true;

    if (orgId === "") {
      setLocations([]);
      return;
    }

    const oid = Number(orgId);
    if (!Number.isFinite(oid)) {
      setLocations([]);
      return;
    }

    // если доступов нет в me — не блокируем (на случай, если backend не вернул allowed_organization_ids)
    // но если доступы есть — строго проверяем
    if (allowedOrgIds.length && !allowedOrgIds.includes(oid)) {
      setLocations([]);
      setErr("Нет доступа к выбранной организации.");
      return;
    }

    setErr(null);
    adminJson<Loc[]>(`/api/admin/admin/organizations/${oid}/locations`)
      .then((xs) => {
        if (!alive) return;
        setLocations(xs ?? []);
      })
      .catch((e: any) => {
        if (!alive) return;
        setLocations([]);
        setErr(errToText(e, devEnabled, "Не удалось загрузить локации организации."));
      });

    return () => {
      alive = false;
    };
  }, [orgId, devEnabled, allowedOrgIds]);

  const groupOptions = useMemo(() => {
    const typeToCount = new Map<string, number>();
    for (const l of locations) {
      if (!l.is_active) continue;
      const k = String(l.type || "other");
      typeToCount.set(k, (typeToCount.get(k) ?? 0) + 1);
    }

    const keys = Array.from(typeToCount.keys());
    keys.sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return groupLabelRu(a).localeCompare(groupLabelRu(b));
    });

    return keys.map((k) => ({ key: k, label: groupLabelRu(k), count: typeToCount.get(k) ?? 0 }));
  }, [locations]);

  // Keep groupKey sane
  useEffect(() => {
    if (groupKey === "all") return;
    const keys = new Set(groupOptions.map((g) => g.key));
    if (!keys.has(groupKey)) setGroupKey("all");
  }, [groupKey, groupOptions]);

  useEffect(() => {
    localStorage.setItem("pg_selected_group_key", groupKey);
  }, [groupKey]);

  // Load review links for currently selected group
  useEffect(() => {
    let alive = true;

    if (orgId === "" || readOnlyAll) {
      setReviewLinksLoadedKey(null);
      setReviewLinksErr(null);
      return;
    }

    setReviewLinksLoading(true);
    setReviewLinksErr(null);

    adminJson<GroupReviewLinksResp>(
      `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(groupKey)}/review-links`
    )
      .then((r) => {
        if (!alive) return;
        setReviewLinksForm({
          yandex_url: String(r?.yandex_url ?? ""),
          twogis_url: String(r?.twogis_url ?? ""),
        });
        setReviewLinksFieldErrors(r?.errors ?? {});
        setReviewLinksLoadedKey(groupKey);
      })
      .catch((e: any) => {
        if (!alive) return;
        setReviewLinksErr(errToText(e, devEnabled, "Не удалось загрузить ссылки отзывов."));
        setReviewLinksLoadedKey(groupKey);
      })
      .finally(() => {
        if (!alive) return;
        setReviewLinksLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [orgId, groupKey, readOnlyAll, devEnabled]);

  async function refreshGroup(gkey: string) {
    if (orgId === "") return;
    try {
      const fresh = await adminJson<GroupSurveyResp>(
        `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(gkey)}/survey`
      );
      setGroupData((prev) => ({ ...prev, [gkey]: fresh }));
      setGroupErr((prev) => ({ ...prev, [gkey]: null }));
    } catch (e: any) {
      setGroupErr((prev) => ({ ...prev, [gkey]: errToText(e, devEnabled, "Не удалось обновить группу.") }));
    }
  }

  // Load group cards
  useEffect(() => {
    let alive = true;
    if (orgId === "" || groupOptions.length === 0) {
      setGroupData({});
      setGroupErr({});
      setLoadingGroups(false);
      return;
    }

    setLoadingGroups(true);
    setGroupData({});
    setGroupErr({});

    (async () => {
      const nextData: Record<string, GroupSurveyResp | null> = {};
      const nextErr: Record<string, string | null> = {};

      const calls = groupOptions.map(async (g) => {
        try {
          const resp = await adminJson<GroupSurveyResp>(
            `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(g.key)}/survey`
          );
          nextData[g.key] = resp;
          nextErr[g.key] = null;
        } catch (e: any) {
          nextData[g.key] = null;
          nextErr[g.key] = errToText(e, devEnabled, "Не удалось загрузить опрос группы.");
        }
      });

      await Promise.all(calls);
      if (!alive) return;
      setGroupData(nextData);
      setGroupErr(nextErr);
      setLoadingGroups(false);
    })();

    return () => {
      alive = false;
    };
  }, [orgId, groupOptions, devEnabled]);

  const shownGroups = useMemo(() => {
    if (groupKey === "all") return groupOptions;
    return groupOptions.filter((g) => g.key === groupKey);
  }, [groupKey, groupOptions]);

  const previewModel = useMemo(() => {
    if (!previewOpen) return null;
    const d = groupData[previewOpen];
    if (!d) return null;

    const payload = d.active ?? d.fallback?.active ?? null;
    if (!payload) return null;

    const uiSchema = adaptBackendSchema(payload.schema as any, `Опрос: ${d.group_name || groupLabelRu(d.group_key)}`);
    const wc: any = payload.widget_config ?? null;

    return {
      group_key: d.group_key,
      group_name: d.group_name || groupLabelRu(d.group_key),
      uiSchema,
      submitLabel: String(wc?.texts?.submit ?? "Отправить"),
      successText: String(wc?.texts?.thanks ?? "Спасибо за отзыв!"),
      mode: d.active ? "group" : d.fallback ? "fallback" : "none",
      fallback_location_name: d.fallback?.location_name ?? null,
    };
  }, [previewOpen, groupData]);

  // auto preview after return from editor
  useEffect(() => {
    if (!autoPreviewKey) return;
    if (orgId === "") return;

    if (!(autoPreviewKey in groupData)) return;

    const d = groupData[autoPreviewKey];
    if (d) {
      setGroupKey(autoPreviewKey);
      setPreviewOpen(autoPreviewKey);
    }

    localStorage.removeItem("pg_auto_preview_group_key");
    setAutoPreviewKey(null);
  }, [autoPreviewKey, orgId, groupData]);

  const ensureGroupSurveyAndOpenEditor = async (gkey: string) => {
    if (orgId === "") return;
    if (busyToken) return;

    setErr(null);
    setBusyToken(`${gkey}|bootstrap`);

    try {
      const current = groupData[gkey];
      let versionId =
        current?.active?.version_id ??
        current?.binding?.active_version_id ??
        null;

      if (!versionId) {
        try {
          const boot = await adminJson<{ ok: boolean; active_version_id: number }>(
            `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(gkey)}/survey/bootstrap`,
            { method: "POST", body: JSON.stringify({}) }
          );
          versionId = boot?.active_version_id ?? null;
        } catch (e: any) {
          if (e?.status !== 409) throw e;
        }

        await refreshGroup(gkey);

        const fresh = groupData[gkey];
        versionId =
          fresh?.active?.version_id ??
          fresh?.binding?.active_version_id ??
          versionId;
      }

      if (!versionId) throw new Error("No active_version_id after bootstrap");

      nav(`/admin/survey-versions/${versionId}`);
    } catch (e: any) {
      setErr(errToText(e, devEnabled, "Не удалось создать/открыть опрос группы."));
    } finally {
      setBusyToken(null);
    }
  };

  const openVersion = (versionId: number) => {
    nav(`/admin/survey-versions/${versionId}`);
  };

  const createNewVersion = async (gkey: string) => {
    if (orgId === "") return;
    if (busyToken) return;

    setErr(null);
    setBusyToken(`${gkey}|new_version`);

    try {
      // копия активной версии по умолчанию
      const created = await adminJson<{ id: number; version: number; is_active: boolean }>(
        `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(gkey)}/survey/versions`,
        { method: "POST", body: JSON.stringify({}) }
      );

      await refreshGroup(gkey);

      if (created?.id) nav(`/admin/survey-versions/${created.id}`);
    } catch (e: any) {
      setErr(errToText(e, devEnabled, "Не удалось создать новую версию."));
    } finally {
      setBusyToken(null);
    }
  };

  const activateVersion = async (gkey: string, versionId: number) => {
    if (orgId === "") return;
    if (busyToken) return;

    setErr(null);
    setBusyToken(`${gkey}|activate|${versionId}`);

    try {
      await adminJson(
        `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(gkey)}/survey/activate`,
        { method: "POST", body: JSON.stringify({ version_id: versionId }) }
      );

      await refreshGroup(gkey);
    } catch (e: any) {
      setErr(errToText(e, devEnabled, "Не удалось активировать версию."));
    } finally {
      setBusyToken(null);
    }
  };

  const saveReviewLinksForGroup = async () => {
    if (orgId === "" || readOnlyAll) return;
    if (!canManageGroupSurveys) return;
    if (busyToken) return;

    setReviewLinksErr(null);
    setBusyToken(`${groupKey}|review_links`);

    try {
      const r = await adminJson<GroupReviewLinksResp>(
        `/api/admin/admin/organizations/${orgId}/groups/${encodeURIComponent(groupKey)}/review-links`,
        {
          method: "PATCH",
          body: JSON.stringify({
            yandex_url: reviewLinksForm.yandex_url,
            twogis_url: reviewLinksForm.twogis_url,
          }),
        }
      );

      setReviewLinksForm({
        yandex_url: String(r?.yandex_url ?? ""),
        twogis_url: String(r?.twogis_url ?? ""),
      });
      setReviewLinksFieldErrors(r?.errors ?? {});
      setReviewLinksLoadedKey(groupKey);
    } catch (e: any) {
      setReviewLinksErr(errToText(e, devEnabled, "Не удалось сохранить ссылки отзывов."));
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <GlassCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
              <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Опросы</h1>
              <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
                Управление анкетами по группам локаций (group_key = Location.type).
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="text-sm text-[color:var(--pg-muted)]">Организация:</div>
                <select
                  className="rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                  value={orgId}
                  onChange={(e) => setOrgId(Number(e.target.value))}
                  disabled={!orgOptions.length}
                >
                  {orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {devEnabled ? ` • ${o.slug}` : ""}
                    </option>
                  ))}
                </select>

                {(loadingOrgs || loadingGroups) && (
                  <span className="text-xs text-[color:var(--pg-faint)]">Загрузка…</span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="text-sm text-[color:var(--pg-muted)]">Группа:</div>

                <Button
                  variant="secondary"
                  className={`px-3 py-2 text-xs ${groupKey === "all" ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
                  onClick={() => {
                    setGroupKey("all");
                    setPreviewOpen(null);
                  }}
                >
                  Все
                </Button>

                {groupOptions.map((g) => (
                  <Button
                    key={g.key}
                    variant="secondary"
                    className={`px-3 py-2 text-xs ${groupKey === g.key ? "ring-2 ring-[color:var(--pg-input-border-focus)]" : ""}`}
                    onClick={() => {
                      setGroupKey(g.key);
                      setPreviewOpen(null);
                    }}
                  >
                    {g.label}
                    <span className="text-[color:var(--pg-faint)]">• {g.count}</span>
                  </Button>
                ))}
              </div>

              {readOnlyAll ? (
                <div className="mt-3 text-xs text-[color:var(--pg-faint)]">
                  Режим “Все” — только просмотр. Чтобы создавать версии/активировать — выбери конкретную группу.
                </div>
              ) : null}


              {err && <div className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{err}</div>}
              {!loadingOrgs && orgOptions.length === 0 && (
                <div className="mt-3 text-xs text-[color:var(--pg-faint)]">Нет доступных организаций.</div>
              )}
            </div>
          </div>
        </GlassCard>

        <section className="space-y-4">
          {shownGroups.map((g) => {
            const d = groupData[g.key];
            const e = groupErr[g.key];

            const hasGroupSurvey = Boolean(d?.binding);
            const active = d?.active ?? null;
            const fallback = d?.fallback ?? null;
            const hasPreview = Boolean(active || fallback?.active);

            const activeLabel = active
              ? `v${active.version}`
              : fallback?.active
                ? `fallback v${fallback.active.version}`
                : "—";

            const isOpen = previewOpen === g.key;

            const busyForThisGroup = busyToken?.startsWith(`${g.key}|`) ?? false;

            const activeVersionId =
              d?.binding?.active_version_id ??
              d?.active?.version_id ??
              null;

            return (
              <GlassCard key={g.key}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-[color:var(--pg-muted)]">Группа</div>
                    <h2 className="mt-1 text-xl font-semibold text-[color:var(--pg-text)]">
                      {g.label}
                      <span className="ml-2 text-sm text-[color:var(--pg-faint)]">• {g.count} локаций</span>
                      {devEnabled ? (
                        <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">{g.key}</span>
                      ) : null}
                    </h2>

                    <div className="mt-2 text-sm text-[color:var(--pg-muted)]">
                      Активная анкета: <span className="text-[color:var(--pg-text)]">{activeLabel}</span>
                      {hasGroupSurvey ? (
                        <span className="ml-2 text-[color:var(--pg-faint)]">• group survey</span>
                      ) : fallback ? (
                        <span className="ml-2 text-[color:var(--pg-faint)]">• fallback по локации: {fallback.location_name}</span>
                      ) : (
                        <span className="ml-2 text-[color:var(--pg-faint)]">• нет опроса</span>
                      )}
                    </div>

                    {e && <div className="mt-2 whitespace-pre-wrap text-xs text-rose-300">{e}</div>}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={!hasPreview}
                      onClick={() => setPreviewOpen((cur) => (cur === g.key ? null : g.key))}
                    >
                      {isOpen ? "Скрыть preview" : "Preview"}
                    </Button>

                    {!hasGroupSurvey ? (
                      <Button
                        variant="secondary"
                        disabled={!canManageGroupSurveys || readOnlyAll || busyToken !== null}
                        onClick={() => void ensureGroupSurveyAndOpenEditor(g.key)}
                      >
                        {busyForThisGroup ? "Подготовка…" : "Создать опрос"}
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          disabled={readOnlyAll || busyToken !== null || !activeVersionId}
                          onClick={() => activeVersionId && openVersion(activeVersionId)}
                        >
                          Открыть активную
                        </Button>

                        <Button
                          variant="secondary"
                          disabled={!canManageGroupSurveys || readOnlyAll || busyToken !== null}
                          onClick={() => void createNewVersion(g.key)}
                        >
                          Новая версия
                        </Button>
                      </>
                    )}

                    {!hasGroupSurvey && fallback?.location_id ? (
                      <Button
                        variant="secondary"
                        onClick={() => nav(`/admin/locations/${fallback.location_id}/surveys`)}
                      >
                        Открыть опросы локации
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Versions + actions */}
                {/* Review links (group default) */}
                  {!readOnlyAll && g.key === groupKey ? (
                    <div className="mt-5 rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[color:var(--pg-text)]">
                            Публичные отзывы (Яндекс / 2ГИС)
                          </div>
                          <div className="mt-1 text-xs text-[color:var(--pg-faint)]">
                            Дефолтные ссылки для группы “{g.label}”. Показываются гостю при высокой оценке, если у локации нет override.
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {reviewLinksLoading && reviewLinksLoadedKey === groupKey ? (
                            <span className="text-xs text-[color:var(--pg-faint)]">Загрузка…</span>
                          ) : null}
                          <Button
                            variant="secondary"
                            disabled={!canManageGroupSurveys || busyToken !== null}
                            onClick={() => void saveReviewLinksForGroup()}
                          >
                            {busyToken?.startsWith(`${groupKey}|review_links`) ? "Сохранение…" : "Сохранить"}
                          </Button>
                        </div>
                      </div>

                      {reviewLinksErr ? (
                        <div className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{reviewLinksErr}</div>
                      ) : null}

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs text-[color:var(--pg-faint)]">Яндекс</div>
                          <input
                            className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                            value={reviewLinksForm.yandex_url}
                            onChange={(e) => setReviewLinksForm((p) => ({ ...p, yandex_url: e.target.value }))}
                            placeholder="https://yandex.ru/maps/..."
                            disabled={!canManageGroupSurveys || busyToken !== null}
                          />
                          {urlErrText(reviewLinksFieldErrors?.yandex_url ?? null) ? (
                            <div className="mt-1 text-xs text-rose-300">
                              {urlErrText(reviewLinksFieldErrors?.yandex_url ?? null)}
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <div className="text-xs text-[color:var(--pg-faint)]">2ГИС</div>
                          <input
                            className="mt-1 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-2 text-sm text-[color:var(--pg-text)] outline-none"
                            value={reviewLinksForm.twogis_url}
                            onChange={(e) => setReviewLinksForm((p) => ({ ...p, twogis_url: e.target.value }))}
                            placeholder="https://2gis.ru/..."
                            disabled={!canManageGroupSurveys || busyToken !== null}
                          />
                          {urlErrText(reviewLinksFieldErrors?.twogis_url ?? null) ? (
                            <div className="mt-1 text-xs text-rose-300">
                              {urlErrText(reviewLinksFieldErrors?.twogis_url ?? null)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                {hasGroupSurvey ? (
                  <div className="mt-5">
                    <div className="text-sm text-[color:var(--pg-muted)]">Версии:</div>

                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs text-[color:var(--pg-faint)]">
                          <tr>
                            <th className="py-2 pr-3">Версия</th>
                            <th className="py-2 pr-3">Создана</th>
                            <th className="py-2 pr-3">Статус</th>
                            <th className="py-2 pr-3">Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(d?.versions ?? []).map((v) => {
                            const isActive = Boolean(v.is_active);
                            const canEdit = !readOnlyAll && busyToken === null;
                            const canActivate = canManageGroupSurveys && !readOnlyAll && busyToken === null && !isActive;

                            return (
                              <tr key={v.id} className="border-t border-[color:var(--pg-border)]">
                                <td className="py-3 pr-3 font-semibold text-[color:var(--pg-text)]">
                                  v{v.version}
                                  {devEnabled ? <span className="ml-2 font-mono text-xs text-[color:var(--pg-muted)]">#{v.id}</span> : null}
                                </td>

                                <td className="py-3 pr-3 text-[color:var(--pg-muted)]">
                                  {formatDT(v.created_at)}
                                </td>

                                <td className="py-3 pr-3">
                                  {isActive ? (
                                    <span className="rounded-full border border-[color:var(--pg-success-border)] bg-[color:var(--pg-success-bg)] px-3 py-1 text-xs text-[color:var(--pg-success-text)]">
                                      ACTIVE
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] px-3 py-1 text-xs text-[color:var(--pg-muted)]">
                                      draft
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 pr-3">
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      variant="secondary"
                                      disabled={!canEdit}
                                      onClick={() => openVersion(v.id)}
                                    >
                                      Открыть
                                    </Button>

                                    <Button
                                      variant="secondary"
                                      disabled={!canActivate}
                                      onClick={() => void activateVersion(g.key, v.id)}
                                    >
                                      Сделать активной
                                    </Button>
                                  </div>

                                  {readOnlyAll ? (
                                    <div className="mt-1 text-xs text-[color:var(--pg-faint)]">
                                      Выбери группу, чтобы редактировать/активировать.
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}

                          {(d?.versions ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-3 text-xs text-[color:var(--pg-faint)]">
                                Пока нет версий.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {/* Preview */}
                {isOpen && previewModel?.uiSchema ? (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-2xl border border-[color:var(--pg-border)] bg-[color:var(--pg-card)] p-3 text-sm text-[color:var(--pg-muted)]">
                      Preview “как у гостя”. Ответы <b>никуда не отправляются</b>.
                      {previewModel.mode === "fallback" && previewModel.fallback_location_name ? (
                        <span> (Сейчас показываем fallback из локации: {previewModel.fallback_location_name})</span>
                      ) : null}
                    </div>

                    <SurveyWizard
                      schema={previewModel.uiSchema}
                      submitLabel={previewModel.submitLabel}
                      successText={previewModel.successText}
                      onSubmit={async () => {
                        await new Promise((r) => setTimeout(r, 150));
                      }}
                    />
                  </div>
                ) : isOpen && hasPreview ? (
                  <div className="mt-6 text-sm text-[color:var(--pg-muted)]">
                    Схема не распознана (slides пустые или формат неожиданный).
                  </div>
                ) : null}
              </GlassCard>
            );
          })}

          {!shownGroups.length && !loadingGroups && (
            <GlassCard>
              <div className="text-sm text-[color:var(--pg-muted)]">
                В выбранной организации нет активных локаций, поэтому групп нет.
              </div>
            </GlassCard>
          )}
        </section>
      </div>
    </AppShell>
  );
}
