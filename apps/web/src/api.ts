import type {
  Actor, DomainEvent, ObservableRecord, ProjectId, ProjectState,
} from '@coral/core';

const BASE = import.meta.env['VITE_API'] ?? 'http://localhost:8787';

export interface ProjectView {
  projectId: ProjectId;
  state: ProjectState;
  events: DomainEvent[];
  record: ObservableRecord;
}

export interface ProjectSummary {
  projectId: ProjectId;
  title: string;
  group: string;
  createdAt: string;
  events: number;
}

/** A write the server refused, carrying the name of the invariant that stopped it. */
export class Refused extends Error {
  constructor(readonly invariant: string, message: string) {
    super(message);
    this.name = 'Refused';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = (await res.json()) as T & { invariant?: string; message?: string };
  if (res.status === 422) throw new Refused(body.invariant ?? 'unknown', body.message ?? 'Refused');
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
  return body;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const listProjects = (): Promise<{ projects: ProjectSummary[] }> => call('/projects');

export const createProject = (title: string, group: string): Promise<ProjectView> =>
  call('/projects', json({ title, group }));

export const loadProject = (id: ProjectId): Promise<ProjectView> => call(`/projects/${id}`);

/** The only write path. Guards run server-side; a refusal arrives as `Refused`. */
export const emit = (
  id: ProjectId,
  actor: Actor,
  type: DomainEvent['type'],
  payload: unknown,
): Promise<ProjectView> => call(`/projects/${id}/events`, json({ actor, type, payload }));

export const searchLiterature = (id: ProjectId): Promise<ProjectView> =>
  call(`/projects/${id}/search`, { method: 'POST' });

export interface Drift {
  commentId: string;
  objectId: string;
  reviewedVersionId: string;
  currentVersionId: string;
  versionsSince: number;
  stale: boolean;
}

export const loadDrift = (id: ProjectId): Promise<{ drift: Drift[] }> =>
  call(`/projects/${id}/drift`);
