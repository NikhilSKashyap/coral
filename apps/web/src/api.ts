import type {
  Actor, DomainEvent, ObservableRecord, ProjectId, ProjectState, ProposalId,
  Relation, SpineStage,
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

/**
 * Write one stage of the framing walk.
 *
 * The stage travels with the request but the server checks it against the walk's
 * own position, so a client asking to start at QUESTION is refused with
 * `spine.order` rather than obeyed.
 */
export const writeStage = (
  id: ProjectId,
  stage: SpineStage,
  text: string,
): Promise<ProjectView> => call(`/projects/${id}/spine`, json({ stage, text }));

/**
 * Accept a proposal by writing the thought it stands for.
 *
 * The text is required by the route, not just by the form, so there is no way to
 * accept a suggestion without having written something.
 */
export const acceptProposal = (
  id: ProjectId,
  proposalId: ProposalId,
  body: { text: string; relation: Relation },
): Promise<ProjectView> =>
  call(`/projects/${id}/proposals/${proposalId}/accept`, json(body));

export const dismissProposal = (
  id: ProjectId,
  proposalId: ProposalId,
): Promise<ProjectView> =>
  call(`/projects/${id}/proposals/${proposalId}/dismiss`, { method: 'POST' });

/** Assemble the Problem Frame from objects that already exist. Nothing is generated. */
export const draftFrame = (
  id: ProjectId,
  answers: Record<string, string>,
): Promise<ProjectView> => call(`/projects/${id}/frame`, json({ answers }));

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

export type ProviderId = 'claude-code' | 'codex' | 'static';

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  available: boolean;
  detail: string;
}

export const listProviders = (): Promise<{ providers: ProviderStatus[] }> => call('/providers');

export interface CoachMove {
  kind: string;
  body: string;
  suggestedType?: string;
  relation?: string;
  flag?: string;
  query?: string;
}

export interface CoachResponse extends ProjectView {
  move: CoachMove;
  provider: ProviderId;
  fellBackFrom?: ProviderId;
  reason?: string;
  rung: number;
  /** Set when the move left something for the student to rule on. */
  proposalId?: ProposalId;
}

/** Asks the student's own agent for one move. Coral holds no credential. */
export const askCoach = (
  id: ProjectId,
  body: { objectId: string; escalate?: boolean; argue?: boolean; provider?: ProviderId },
): Promise<CoachResponse> => call(`/projects/${id}/coach`, json(body));
