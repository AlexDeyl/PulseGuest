import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import GlassCard from "../components/GlassCard";
import { Button } from "../components/ui/Button";
import { useAuth } from "../shared/auth";
import { adminJson } from "../shared/adminApi";

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

function errToText(e: any) {
  if (!e) return "Ошибка";
  if (typeof e?.detail === "string") return e.detail;
  if (e?.detail?.detail) return String(e.detail.detail);
  try {
    return JSON.stringify(e?.detail ?? e);
  } catch {
    return String(e?.message ?? "Ошибка");
  }
}

const TYPES = ["room", "restaurant", "conference_hall", "banquet_hall", "other"];

export default function AdminOrganizationLocationsPage() {
  const { orgId } = useParams();
  const organizationId = Number(orgId || 0);
  const nav = useNavigate();
  const { me } = useAuth();

  const canManage = useMemo(() => {
    const roles = Array.isArray(me?.roles) ? me?.roles : [];
    return roles.some((r: any) => r?.role === "director");
  }, [me]);

  const [org, setOrg] = useState<Org | null>(null);
  const [items, setItems] = useState<Loc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // единая форма create/edit
  const [locId, setLocId] = useState<number | null>(null);
  const [type, setType] = useState("other");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(""); // only create (optional)
  const [active, setActive] = useState(true);

  const resetForm = () => {
    setLocId(null);
    setType("other");
    setCode("");
    setName("");
    setSlug("");
    setActive(true);
  };

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const orgs = await adminJson<Org[]>("/api/admin/admin/organizations");
      setOrg(orgs.find((o) => o.id === organizationId) ?? null);

      const locs = await adminJson<Loc[]>(
        `/api/admin/admin/organizations/${organizationId}/locations`
      );
      setItems(locs);
    } catch (e: any) {
      setError(errToText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [organizationId]);

  const startEdit = (l: Loc) => {
    setLocId(l.id);
    setType(l.type || "other");
    setCode(l.code || "");
    setName(l.name || "");
    setActive(l.is_active);
    setSlug(""); // не редактируем slug по умолчанию
  };

  const submit = async () => {
    if (!canManage) return;
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
            slug: slug.trim() ? slug.trim() : undefined, // optional
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
      setError(errToText(e));
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest • Admin</div>
          <h1 className="mt-1 text-2xl font-semibold text-[color:var(--pg-text)]">Локации</h1>
          <div className="mt-1 text-xs text-[color:var(--pg-muted)]">
            {org ? (
              <>
                Организация: <span className="font-semibold">{org.name}</span>{" "}
                (<span className="font-mono">{org.slug}</span>)
              </>
            ) : (
              <>org_id={organizationId}</>
            )}
          </div>
        </div>

        <Button variant="secondary" onClick={() => nav("/admin/organizations")}>
          Назад к организациям
        </Button>
      </div>

      {error && (
        <GlassCard className="mb-6 border border-rose-500/30">
          <div className="text-sm text-rose-300">{error}</div>
        </GlassCard>
      )}

      {canManage && (
        <GlassCard className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[color:var(--pg-text)]">
              {locId == null ? "Создать локацию" : `Редактировать локацию #${locId}`}
            </div>
            {locId != null && (
              <Button variant="secondary" onClick={resetForm}>
                Отмена
              </Button>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Type</div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="text-xs text-[color:var(--pg-muted)]">Code</div>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            <label className="block sm:col-span-2">
              <div className="text-xs text-[color:var(--pg-muted)]">Name</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
              />
            </label>

            {locId == null && (
              <label className="block sm:col-span-2">
                <div className="text-xs text-[color:var(--pg-muted)]">
                  Slug (optional; если пусто — будет {`{org_slug}-{code}`})
                </div>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-[color:var(--pg-input-border)] bg-[color:var(--pg-input-bg)] px-4 py-3 text-sm text-[color:var(--pg-text)] outline-none"
                />
              </label>
            )}
          </div>

          {locId != null && (
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-[color:var(--pg-text)]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Активна
            </label>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={submit} disabled={!name.trim()}>
              Сохранить
            </Button>
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-[color:var(--pg-text)]">Список</div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Обновить
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-[color:var(--pg-muted)]">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-[color:var(--pg-muted)]">Пусто</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[color:var(--pg-muted)]">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Slug</th>
                  <th className="py-2 pr-4">QR URL</th>
                  <th className="py-2 pr-4">Active</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--pg-text)]">
                {items.map((l) => {
                  const rel = `/${l.slug}`;
                  const full = origin ? `${origin}${rel}` : rel;

                  return (
                    <tr key={l.id} className="border-t border-[color:var(--pg-border)]">
                      <td className="py-3 pr-4">{l.name}</td>
                      <td className="py-3 pr-4 font-mono">{l.slug}</td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link className="underline" to={rel}>
                            {rel}
                          </Link>
                          <Button variant="secondary" onClick={() => copy(full)}>
                            Copy
                          </Button>
                        </div>
                      </td>
                      <td className="py-3 pr-4">{l.is_active ? "yes" : "no"}</td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {canManage && (
                            <Button variant="secondary" onClick={() => startEdit(l)}>
                              Редактировать
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </AppShell>
  );
}
