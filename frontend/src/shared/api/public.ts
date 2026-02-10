const RAW_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

export const API_BASE = RAW_BASE.replace(/\/$/, "");

type ApiError = Error & { status?: number; detail?: unknown };

async function readJsonSafe(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const detail = await readJsonSafe(res);
    const err: ApiError = new Error(`API ${res.status}: ${String(path)}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return (await readJsonSafe(res)) as T;
}

export type ResolveResponse = {
  location: {
    id: number;
    organization_id: number;
    type: string;
    code: string | null;
    name: string;
    slug: string;
  };
  active: ActiveSurvey | null;
  greeting: string;
  guest: unknown;
};

export type ActiveSurvey = {
  survey_id: number;
  version_id: number;
  version: number;
  schema: Record<string, unknown> | null;
  widget_config: Record<string, unknown> | null;
};

export function resolveBySlug(slug: string) {
  return apiJson<ResolveResponse>(
    `/api/public/public/resolve/${encodeURIComponent(slug)}`
  );
}

export function getActiveSurvey(locationId: number) {
  return apiJson<{ active: ActiveSurvey | null } & Record<string, unknown>>(
    `/api/public/public/locations/${locationId}/active-survey`
  );
}

// (Шаг B) submitSubmission добавим/используем чуть ниже
export function submitSubmission(payload: {
  location_id: number;
  version_id?: number;
  answers: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) {
  return apiJson<{ ok: true; id: number }>(`/api/public/public/submissions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
