import { API_BASE } from "./public";

export type ApiError = Error & { status?: number; detail?: any };

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

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/auth/password-reset/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const detail = await readJsonSafe(res);
    const err: ApiError = new Error(`API ${res.status}: password-reset/request`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });

  if (!res.ok) {
    const detail = await readJsonSafe(res);
    const err: ApiError = new Error(`API ${res.status}: password-reset/confirm`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
}
