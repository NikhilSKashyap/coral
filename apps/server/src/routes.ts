import type { FastifyInstance } from 'fastify';
import {
  EVENT_TYPES, RELATIONS, SOURCE_ACCESS, THOUGHT_TYPES, assembleBrief, commentDrift,
  omittedFrom,
  type AssignmentId, type CommentId, type ProjectId, type ProposalId, type SourceId,
} from '@coral/core';
import { coach, detectProviders, type CoachRequestBody } from './coach.js';
import { StageOutOfOrder, draftProblemFrame, writeStage, type StageWriteBody } from './spine.js';
import {
  ProposalRefused, acceptProposal, dismissProposal, type AcceptProposalBody,
} from './proposals.js';
import { canRetrieveFullText, runSearch, type SearchBody } from './retrieval.js';
import { detectClaims, type DetectBody } from './detection.js';
import { scan, type ScanBody } from './scan.js';
import {
  attachProject, createAssignment, dashboard, listAssignments, publishAssignment,
  type AssignmentInput,
} from './assignments.js';
import { MAX_PDF_BYTES, UploadRefused, transcribePassage, uploadPaper } from './upload.js';
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
   * Literature search.
   *
   * Real retrieval against OpenAlex, with the fixture as the floor when the
   * network or the service is not there. The response says which answered and
   * how many results OpenAlex claimed full text for that we declined to claim,
   * because that number is the gate doing its job.
   */
  app.post<{ Params: { id: string }; Body: SearchBody }>(
    '/projects/:id/search',
    async (request) => runSearch(request.params.id as ProjectId, request.body ?? {}),
  );

  /**
   * Drop a PDF on a source.
   *
   * Taken as a raw `application/pdf` body rather than multipart: the browser
   * can post a File directly, and it saves a dependency whose only job would be
   * to unwrap one part.
   */
  app.post<{ Params: { id: string; sourceId: string }; Body: Buffer }>(
    '/projects/:id/sources/:sourceId/upload',
    async (request, reply) => {
      try {
        return await uploadPaper(
          request.params.id as ProjectId,
          request.params.sourceId as SourceId,
          new Uint8Array(request.body),
        );
      } catch (error) {
        if (error instanceof UploadRefused) {
          return reply.status(422).send({ invariant: error.invariant, message: error.message });
        }
        throw error;
      }
    },
  );

  /** A passage typed from a paper the student holds but cannot upload. */
  app.post<{
    Params: { id: string; sourceId: string };
    Body: { text: string; locator: string };
  }>(
    '/projects/:id/sources/:sourceId/transcribe',
    async (request, reply) => {
      try {
        return await transcribePassage(
          request.params.id as ProjectId,
          request.params.sourceId as SourceId,
          request.body,
        );
      } catch (error) {
        if (error instanceof UploadRefused) {
          return reply.status(422).send({ invariant: error.invariant, message: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * Which of the student's thoughts are already doing the work of a claim.
   *
   * Raises proposals and nothing else. A thought the student has already ruled
   * on is skipped, so pressing this twice does not start nagging.
   */
  app.post<{ Params: { id: string }; Body: DetectBody }>(
    '/projects/:id/detect',
    async (request) => detectClaims(request.params.id as ProjectId, request.body ?? {}),
  );

  /**
   * What is missing or in tension across the whole map.
   *
   * Structural gaps are proved from the graph and cost nothing. Contradiction
   * needs reading, so it needs a model, and the response says whether one
   * actually looked.
   */
  app.post<{ Params: { id: string }; Body: ScanBody }>(
    '/projects/:id/scan',
    async (request) => scan(request.params.id as ProjectId, request.body ?? {}),
  );

  /** The Reasoning Brief, assembled from objects that already exist. */
  app.get<{ Params: { id: string } }>('/projects/:id/brief', async (request) => {
    const view = await loadProject(request.params.id as ProjectId);
    const brief = assembleBrief(view.state);
    return { brief, omitted: omittedFrom(view.state, brief) };
  });

  /* ---- the instructor's side -------------------------------------- */

  app.get('/assignments', async () => ({ assignments: await listAssignments() }));

  app.post<{ Body: AssignmentInput }>('/assignments', async (request, reply) =>
    reply.status(201).send(await createAssignment(request.body ?? {})));

  app.post<{ Params: { id: string } }>('/assignments/:id/publish', async (request) =>
    publishAssignment(request.params.id as AssignmentId));

  /**
   * Progress at checkpoint level.
   *
   * Every figure is a count or a date. Without an assignment it reports every
   * project, which is what a single-seat demo needs.
   */
  app.get<{ Querystring: { assignment?: string } }>('/dashboard', async (request) =>
    dashboard((request.query.assignment ?? '') === ''
      ? null
      : request.query.assignment as AssignmentId));

  /** Point a project at an assignment. The student's log is untouched. */
  app.post<{ Params: { id: string }; Body: { assignmentId: string | null } }>(
    '/projects/:id/assignment',
    async (request) => {
      await attachProject(
        request.params.id as ProjectId,
        (request.body?.assignmentId ?? null) as AssignmentId | null,
      );
      return { ok: true };
    },
  );

  /** Whether this machine can reach full text at all. */
  app.get('/retrieval', async () => ({
    fullText: canRetrieveFullText(),
    detail: canRetrieveFullText()
      ? 'A content key is set, so an open paper can supply a quotable passage.'
      : 'No content key, so retrieval stops at the abstract. Upload a paper to go further.',
  }));

  /** How far a live object has moved since an instructor read it. */
  app.get<{ Params: { id: string } }>('/projects/:id/drift', async (request) => {
    const view = await loadProject(request.params.id as ProjectId);
    const drift = Object.keys(view.state.comments)
      .map((id) => commentDrift(view.state, id as CommentId))
      .filter((d) => d !== undefined);
    return { drift };
  });
}
