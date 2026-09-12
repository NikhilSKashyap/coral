import type { FastifyInstance } from 'fastify';
import {
  EVENT_TYPES, RELATIONS, SOURCE_ACCESS, THOUGHT_TYPES, commentDrift,
  type CommentId, type ProjectId, type ProposalId,
} from '@coral/core';
import { coach, detectProviders, type CoachRequestBody } from './coach.js';
import { StageOutOfOrder, draftProblemFrame, writeStage, type StageWriteBody } from './spine.js';
import {
  ProposalRefused, acceptProposal, dismissProposal, type AcceptProposalBody,
} from './proposals.js';
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

  /**
   * One stage of the framing walk: the student's thought, the relation into it,
   * and the two rung-zero moves that answer it. Out-of-order stages are refused
   * here rather than silently reordered, because the sequence is the lesson.
   */
  /**
   * Accept a proposal by writing the thought it stands for.
   *
   * The only route that can satisfy invariant iii. There is no variant of it
   * that accepts without text, which is why a proposal cannot become a thought
   * the student did not write.
   */
  app.post<{ Params: { id: string; proposalId: string }; Body: AcceptProposalBody }>(
    '/projects/:id/proposals/:proposalId/accept',
    async (request, reply) => {
      try {
        return await acceptProposal(
          request.params.id as ProjectId,
          request.params.proposalId as ProposalId,
          request.body,
        );
      } catch (error) {
        if (error instanceof ProposalRefused) {
          return reply.status(422).send({ invariant: error.invariant, message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string; proposalId: string } }>(
    '/projects/:id/proposals/:proposalId/dismiss',
    async (request, reply) => {
      try {
        return await dismissProposal(
          request.params.id as ProjectId,
          request.params.proposalId as ProposalId,
        );
      } catch (error) {
        if (error instanceof ProposalRefused) {
          return reply.status(422).send({ invariant: error.invariant, message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: StageWriteBody }>(
    '/projects/:id/spine',
    async (request, reply) => {
      try {
        return await writeStage(request.params.id as ProjectId, request.body);
      } catch (error) {
        if (error instanceof StageOutOfOrder) {
          return reply.status(422).send({ invariant: 'spine.order', message: error.message });
        }
        throw error;
      }
    },
  );

  /** Assemble the Problem Frame from objects that already exist. */
  app.post<{ Params: { id: string }; Body: { answers?: Record<string, string> } }>(
    '/projects/:id/frame',
    async (request) =>
      draftProblemFrame(request.params.id as ProjectId, request.body?.answers ?? {}),
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
