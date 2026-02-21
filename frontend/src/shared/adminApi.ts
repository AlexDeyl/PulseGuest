import { API_BASE } from "./api/public";

export type ApiError = Error & { status?: number; detail?: any };

async function readJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
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
      ...(init?.headers || {}),
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
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

// For file uploads (FormData). IMPORTANT: don't set content-type manually.
export async function adminUploadJson<T>(
  path: string,
  form: FormData,
  method: string = "POST"
): Promise<T> {
  const access = localStorage.getItem("pg_access_token") || "";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    body: form,
    headers: {
      ...(access ? { authorization: `Bearer ${access}` } : {}),
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
