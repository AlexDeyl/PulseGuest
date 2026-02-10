import { API_BASE } from "./public";

const ACCESS_KEY = "pg_access_token";

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
  const access = localStorage.getItem(ACCESS_KEY) || "";
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
    const err: any = new Error(`API ${res.status}: ${path}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return (await readJsonSafe(res)) as T;
}
