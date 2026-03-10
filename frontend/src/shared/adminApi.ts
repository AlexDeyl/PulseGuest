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

function extractFilename(res: Response): string | null {
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)\"?/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
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

// Raw fetch with auth + error shaping (for blobs / svg / etc.)
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const access = localStorage.getItem("pg_access_token") || "";

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
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

  return res;
}

export async function adminBlob(
  path: string,
  init?: RequestInit
): Promise<{ blob: Blob; filename: string | null; contentType: string | null }> {
  const res = await adminFetch(path, init);
  const blob = await res.blob();
  return {
    blob,
    filename: extractFilename(res),
    contentType: res.headers.get("content-type"),
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
