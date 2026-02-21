const RAW_BASE =
  import.meta.env.VITE_API_BASE ??
  import.meta.env.VITE_API_URL ??
  "http://localhost:8000";

export const API_BASE = RAW_BASE.replace(/\/+$/, "");

export type ActiveSurvey = {
  survey_id: number;
  version_id: number;
  version: number;
  schema: any;
  widget_config: any;
};

export type GuestContext = {
  stay_id?: number;
  room?: string;
  guest_name?: string | null;
  checkin_at?: string | null;
  checkout_at?: string | null;
  reservation_code?: string | null;
  source?: string | null;
};

export type ResolveResponse = {
  location: {
    id: number;
    organization_id: number;
    type: string;
    code: string;
    name: string;
    slug: string;
  };
  active: ActiveSurvey | null;
  guest?: GuestContext | null;
  greeting: string;
};

export type SubmissionPayload = {
  version_id?: number;
  location_id: number;
  answers: Record<string, unknown>;
  meta?: Record<string, unknown>;
  stay_id?: number;
  room?: string;
};

async function readJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const detail = await readJsonSafe(res);
    const err: any = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return (await readJsonSafe(res)) as T;
}

export function resolveBySlug(slug: string, room?: string) {
  const qs = room ? `?room=${encodeURIComponent(room)}` : "";
  return fetchJson<ResolveResponse>(`/api/public/resolve/${encodeURIComponent(slug)}${qs}`);
}

// Legacy endpoint (оставили чтобы фронт не падал)
export function getActiveSurvey(locationId: number) {
  return fetchJson<any>(`/api/public/locations/${locationId}/active-survey`);
}

export function submitSubmission(payload: SubmissionPayload) {
  return fetchJson<{ ok: boolean; id: number }>(`/api/public/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
