import type { FastifyInstance } from 'fastify';
import {
  EVENT_TYPES, RELATIONS, SOURCE_ACCESS, THOUGHT_TYPES, commentDrift,
  type CommentId, type ProjectId,
} from '@coral/core';
import { coach, detectProviders, type CoachRequestBody } from './coach.js';
import { FIXTURE_PAPERS } from './fixtures.js';
import { appendEvent, createProject, listProjects, loadProject } from './repo.js';

export async function routes(app: FastifyInstance): Promise<void> {
  app.get('/vocabulary', async () => ({
    thoughtTypes: THOUGHT_TYPES,
    relations: RELATIONS,
    sourceAccess: SOURCE_ACCESS,
    eventTypes: EVENT_TYPES,
  }));

  app.get('/projects', async () => ({ projects: await listProjects() }));

  /** What this machine can run. Coral holds no credential of its own. */
  app.get('/providers', async () => ({ providers: await detectProviders() }));

  /** One coaching move, produced by the student's own agent. */
  app.post<{ Params: { id: string }; Body: CoachRequestBody }>(
    '/projects/:id/coach',
    async (request) => coach(request.params.id as ProjectId, request.body),
  );

  app.post<{ Body: { title?: string; group?: string } }>('/projects', async (request, reply) => {
    const title = request.body?.title ?? 'Untitled question';
    const group = request.body?.group ?? 'Unfiled';
    const view = await createProject(title, group);
    return reply.status(201).send(view);
  });

  app.get<{ Params: { id: string } }>('/projects/:id', async (request) =>
    loadProject(request.params.id as ProjectId));

  /** Every write goes through here. Guards run before anything is persisted. */
  app.post<{
    Params: { id: string };
    Body: { actor: 'student' | 'coach' | 'instructor'; type: string; payload: unknown; promptedBy?: string | null };
  }>('/projects/:id/events', async (request) => {
    const { actor, type, payload, promptedBy } = request.body;
    return appendEvent(request.params.id as ProjectId, {
      actor,
      type: type as never,
      payload,
      promptedBy: promptedBy ?? null,
    });
  });

  /**
   * Stand-in for literature search. Emits the fixture papers as coach events,
   * capturing a passage only where one genuinely exists.
   */
  app.post<{ Params: { id: string } }>('/projects/:id/search', async (request) => {
    const projectId = request.params.id as ProjectId;
    let view = await loadProject(projectId);
    if (Object.keys(view.state.sources).length > 0) return view;

    for (const paper of FIXTURE_PAPERS) {
      const sourceId = crypto.randomUUID();
      view = await appendEvent(projectId, {
        actor: 'coach',
        type: 'source.discovered',
        payload: {
          sourceId,
          access: paper.access,
          cite: paper.cite,
          title: paper.title,
          method: paper.method,
          abstract: paper.abstract === '' ? null : paper.abstract,
          externalUrl: null,
          doi: null,
        },
      });
      if (paper.passage !== null) {
        view = await appendEvent(projectId, {
          actor: 'coach',
          type: 'passage.captured',
          payload: {
            passageId: crypto.randomUUID(),
            sourceId,
            text: paper.passage.text,
            locator: paper.passage.locator,
            provenance: paper.passage.provenance,
          },
        });
      }
    }
    return view;
  });

  /** How far a live object has moved since an instructor read it. */
  app.get<{ Params: { id: string } }>('/projects/:id/drift', async (request) => {
    const view = await loadProject(request.params.id as ProjectId);
    const drift = Object.keys(view.state.comments)
      .map((id) => commentDrift(view.state, id as CommentId))
      .filter((d) => d !== undefined);
    return { drift };
  });
}
