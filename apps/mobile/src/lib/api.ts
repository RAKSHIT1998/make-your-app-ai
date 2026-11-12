import type { CreateProjectInput, ProjectDto, ProjectType } from '@mya/shared';
import { supabase } from './supabase';

export const API_URL = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
  }
}

export type TokenSource = () => Promise<string | null>;

const sessionToken: TokenSource = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

export async function apiFetch<T>(path: string, init: RequestInit = {}, getToken: TokenSource = sessionToken): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { message?: unknown } | null)?.message;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : `Request failed (${res.status})`, body);
  }
  return body as T;
}

export interface Me {
  id: string;
  email: string;
  personalOrgId: string;
  organizations: { id: string; name: string; role: string; personal: boolean }[];
}
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'canceled';
export interface Run { id: string; projectId: string; kind: 'create' | 'edit' | 'repair'; status: RunStatus; prompt: string; error: string | null; creditsUsed: number; createdAt: string; finishedAt: string | null }
export interface RunEvent { id: string; type: string; agent: string | null; message: string; createdAt: string }
export interface Version { id: string; number: number; commitSha: string; message: string; createdAt: string; isHead: boolean }
export interface Approval { id: string; action: string; status: string; summary: string; createdAt: string; expiresAt: string }

export const api = {
  me: () => apiFetch<Me>('/me'),
  credits: () => apiFetch<{ balance: number }>('/credits'),
  projects: () => apiFetch<{ items: ProjectDto[]; nextCursor: string | null }>('/projects?limit=50'),
  project: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`),
  createProject: (input: Omit<CreateProjectInput, 'description'> & { description?: string; type: ProjectType }) => apiFetch<ProjectDto>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  deleteProject: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
  generate: (projectId: string, prompt: string) => apiFetch<Run>(`/projects/${projectId}/generations`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  runs: (projectId: string) => apiFetch<Run[]>(`/projects/${projectId}/generations`),
  events: (runId: string, after = '0') => apiFetch<RunEvent[]>(`/generations/${runId}/events?after=${after}`),
  files: (projectId: string) => apiFetch<{ path: string; sizeBytes: number }[]>(`/projects/${projectId}/files`),
  file: (projectId: string, path: string) => apiFetch<{ path: string; content: string | null }>(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  versions: (projectId: string) => apiFetch<Version[]>(`/projects/${projectId}/versions`),
  restore: (projectId: string, versionId: string) => apiFetch<Version[]>(`/projects/${projectId}/versions/${versionId}/restore`, { method: 'POST' }),
  approvals: (projectId: string) => apiFetch<Approval[]>(`/projects/${projectId}/approvals`),
  decide: (approvalId: string, approve: boolean) => apiFetch<{ status: string; error?: string }>(`/approvals/${approvalId}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
};
