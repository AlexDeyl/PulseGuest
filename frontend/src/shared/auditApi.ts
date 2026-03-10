import { API_BASE } from "./api/public";
import { adminJson, adminUploadJson, adminBlob } from "./adminApi";

// IMPORTANT: if backend mounts audit module under another prefix (e.g. /api/admin/audit),
// change ONLY this constant.
export const AUDIT_BASE = "/api/audit";

export type ChecklistTemplate = {
  id: number;
  organization_id: number | null;
  name: string;
  description: string;
  scope: "organization" | "group" | "location" | string;
  location_type: string | null;
  version: number;
  is_active: boolean;
};

export type ChecklistRun = {
  id: number;
  template_id: number;
  organization_id: number;
  location_id: number | null;
  auditor_user_id: number;
  status: "draft" | "completed" | string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type ChecklistRunQuestion = {
  id: number;
  order: number;
  section: string;
  text: string;
  answer_type: string;
  options: any;
  is_required: boolean;
  allow_comment: boolean;
  allow_photos: boolean;
  answer: { value: any; comment: string } | null;
  attachments: {
    id: number;
    file_name: string;
    content_type: string;
    size_bytes: number;
    created_at: string;
  }[];
};

export type ChecklistRunDetail = ChecklistRun & {
  template: ChecklistTemplate;
  questions: ChecklistRunQuestion[];
  answered_count: number;
  total_questions: number;
};

export async function listChecklistTemplates() {
  return adminJson<ChecklistTemplate[]>(`${AUDIT_BASE}/templates`);
}

export async function createChecklistRun(payload: {
  template_id: number;
  organization_id: number;
  location_id?: number | null;
}) {
  return adminJson<ChecklistRun>(`${AUDIT_BASE}/runs`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getChecklistRun(runId: number) {
  return adminJson<ChecklistRunDetail>(`${AUDIT_BASE}/runs/${runId}`);
}

export async function upsertChecklistAnswer(params: {
  runId: number;
  questionId: number;
  value: any;
  comment: string;
}) {
  const { runId, questionId, value, comment } = params;
  return adminJson<{ id: number; question_id: number; updated_at: string }>(
    `${AUDIT_BASE}/runs/${runId}/questions/${questionId}/answer`,
    {
      method: "PUT",
      body: JSON.stringify({ value: value ?? {}, comment: comment ?? "" }),
    }
  );
}

export async function uploadChecklistAttachment(params: {
  runId: number;
  questionId: number;
  file: File;
}) {
  const { runId, questionId, file } = params;
  const form = new FormData();
  form.append("file", file);
  return adminUploadJson<{ id: number }>(
    `${AUDIT_BASE}/runs/${runId}/questions/${questionId}/attachments`,
    form,
    "POST"
  );
}

export async function downloadAttachmentBlob(attachmentId: number): Promise<Blob> {
  const access = localStorage.getItem("pg_access_token") || "";
  const res = await fetch(`${API_BASE}${AUDIT_BASE}/attachments/${attachmentId}`, {
    headers: {
      ...(access ? { authorization: `Bearer ${access}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err: any = new Error(`Attachment ${res.status}`);
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  return await res.blob();
}



export async function downloadAuditImportTemplate(organizationId: number) {
  return adminBlob(`${AUDIT_BASE}/templates-import/template?organization_id=${organizationId}`);
}

export async function importAuditTemplatesFromExcel(
  organizationId: number,
  file: File,
  groupValue?: string | null
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("group_value", groupValue ? String(groupValue) : "");

  const token =
    localStorage.getItem("pg_access_token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    "";

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `${AUDIT_BASE}/templates-import?organization_id=${organizationId}`,
    {
      method: "POST",
      headers,
      body: fd,
    }
  );

  const text = await res.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!res.ok) {
    if (data && typeof data === "object") throw data;
    throw new Error(typeof data === "string" && data ? data : `HTTP ${res.status}`);
  }

  return data;
}

export type ChecklistRunListItem = {
  location_name: string;
  id: number;
  organization_id: number;
  location_id: number | null;
  template_id: number;
  template_name: string;
  status: "draft" | "completed";
  created_at: string | null;
  completed_at: string | null;
  answered_count: number;
  total_questions: number;
};

export async function listChecklistRuns(organizationId?: number) {
  const q = organizationId ? `?organization_id=${organizationId}` : "";
  return adminJson<ChecklistRunListItem[]>(`${AUDIT_BASE}/runs${q}`);
}

export async function completeChecklistRun(runId: number) {
  return adminJson<{ ok: boolean; status: "completed"; completed_at?: string }>(
    `${AUDIT_BASE}/runs/${runId}/complete`,
    { method: "POST" }
  );
}

export async function downloadChecklistRunPdf(runId: number) {
  return adminBlob(`${AUDIT_BASE}/runs/${runId}/pdf`);
}
