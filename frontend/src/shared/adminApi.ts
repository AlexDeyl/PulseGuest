import { API_BASE } from "./api/public";

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

export async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const access = localStorage.getItem("pg_access_token") || "";

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(access ? { authorization: `Bearer ${access}` } : {}),
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
