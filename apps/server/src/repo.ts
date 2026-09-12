import {
  append, initialState, observableRecord, replay,
  type Actor, type ActorId, type DomainEvent, type EventId, type ObjectId,
  type ProjectId, type ProjectState,
} from '@coral/core';
import { pool, withTransaction } from './db.js';
import { project } from './projector.js';

/** Fixed seats for the demo. Slice 06 replaces these with real course rosters. */
export const SEATS: Record<Actor, ActorId> = {
  student: '00000000-0000-4000-b000-000000000001' as ActorId,
  coach: '00000000-0000-4000-b000-000000000002' as ActorId,
  instructor: '00000000-0000-4000-b000-000000000003' as ActorId,
};

export async function ensureSeats(): Promise<void> {
  await pool.query(
    `insert into person (person_id, role, display_name) values
       ($1,'student','Maren Reyes'), ($2,'coach','Epistemic Coach'), ($3,'instructor','Prof. Iyer')
     on conflict (person_id) do nothing`,
    [SEATS.student, SEATS.coach, SEATS.instructor],
  );
}

interface EventRow {
  event_id: string; project_id: string; seq: string; at: Date;
  actor: Actor; actor_id: string; type: string; payload: unknown; prompted_by: string | null;
}

const toEvent = (row: EventRow): DomainEvent => ({
  id: row.event_id as EventId,
  projectId: row.project_id as ProjectId,
  seq: Number(row.seq),
  at: row.at.toISOString(),
  actor: row.actor,
  actorId: row.actor_id as ActorId,
  promptedBy: row.prompted_by as DomainEvent['promptedBy'],
  type: row.type,
  payload: row.payload,
} as DomainEvent);

export async function loadEvents(projectId: ProjectId): Promise<DomainEvent[]> {
  const { rows } = await pool.query<EventRow>(
    `select * from event where project_id = $1 order by seq asc`, [projectId],
  );
  return rows.map(toEvent);
}

export interface ProjectView {
  projectId: ProjectId;
  state: ProjectState;
  events: DomainEvent[];
  record: ReturnType<typeof observableRecord>;
}

export async function loadProject(projectId: ProjectId): Promise<ProjectView> {
  const events = await loadEvents(projectId);
  const state = replay(projectId, events);
  return { projectId, state, events, record: observableRecord(state, events) };
}

export interface AppendInput {
  actor: Actor;
  type: DomainEvent['type'];
  payload: unknown;
  promptedBy?: string | null;
}

/**
 * The only write path.
 *
 * Guards run first, in `@coral/core`, exactly as they do in the browser. The
 * event row goes in next, and the projection last, so a constraint the database
 * enforces rolls the whole append back rather than leaving the log ahead of the
 * tables.
 */
export async function appendEvent(
  projectId: ProjectId,
  input: AppendInput,
): Promise<ProjectView> {
  const events = await loadEvents(projectId);
  const state = replay(projectId, events);

  const event = {
    id: crypto.randomUUID() as EventId,
    projectId,
    seq: state.seq + 1,
    at: new Date().toISOString(),
    actor: input.actor,
    actorId: SEATS[input.actor],
    promptedBy: (input.promptedBy ?? null) as DomainEvent['promptedBy'],
    type: input.type,
    payload: input.payload,
  } as DomainEvent;

  // Throws InvariantViolation before anything touches the database.
  const nextState = append(state, event);

  await withTransaction(async (q) => {
    await q.query('set constraints all deferred');
    await q.query(
      `insert into event (event_id, project_id, seq, at, actor, actor_id, type, payload, prompted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [event.id, projectId, event.seq, event.at, event.actor, event.actorId,
       event.type, JSON.stringify(event.payload), event.promptedBy],
    );
    await project(q, event);
  });

  const all = [...events, event];
  return { projectId, state: nextState, events: all, record: observableRecord(nextState, all) };
}

export async function createProject(title: string, group: string): Promise<ProjectView> {
  await ensureSeats();
  const projectId = crypto.randomUUID() as ProjectId;
  await pool.query(
    `insert into project (project_id, student_id, title, project_group) values ($1,$2,$3,$4)`,
    [projectId, SEATS.student, title, group],
  );
  return appendEvent(projectId, {
    actor: 'student', type: 'project.created', payload: { title, group },
  });
}

export interface ProjectSummary {
  projectId: ProjectId; title: string; group: string; createdAt: string; events: number;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { rows } = await pool.query<{
    project_id: string; title: string; project_group: string; created_at: Date; events: string;
  }>(`select p.project_id, p.title, p.project_group, p.created_at,
             count(e.event_id) as events
      from project p left join event e on e.project_id = p.project_id
      group by p.project_id order by p.created_at desc`);
  return rows.map((r) => ({
    projectId: r.project_id as ProjectId,
    title: r.title,
    group: r.project_group,
    createdAt: r.created_at.toISOString(),
    events: Number(r.events),
  }));
}

export const emptyStateFor = (projectId: ProjectId): ProjectState => initialState(projectId);
export type { ObjectId };
