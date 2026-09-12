import {
  NO_REQUIREMENTS, checkRequirements, commentDrift, openComments, requirementsMet,
  type AssignmentId, type CommentId, type ProjectId, type RequirementCheck,
  type Requirements,
} from '@coral/core';
import { pool } from './db.js';
import { SEATS, ensureSeats, loadProject } from './repo.js';

/**
 * Assignments, and the instructor's view of the work against them.
 *
 * An assignment is not an event in any project's log. The log is the record of
 * one student's reasoning, and an assignment exists before a project does and
 * spans several, so it is an ordinary row. The link runs the other way: a
 * checkpoint names the assignment it answers, which is already in the event
 * payload.
 *
 * Everything the dashboard reports is a count or a date. There is no field here
 * for a mark, and the requirement checks say what the map shows rather than
 * whether it is any good.
 */

export interface Assignment {
  assignmentId: AssignmentId;
  title: string;
  instructions: string;
  dueAt: string | null;
  requirements: Requirements;
  publishedAt: string | null;
  createdAt: string;
}

interface AssignmentRow {
  assignment_id: string;
  title: string;
  instructions: string;
  due_at: Date | null;
  require_sources: number;
  require_counterargument: boolean;
  require_ai_provenance: boolean;
  published_at: Date | null;
  created_at: Date;
}

const toAssignment = (row: AssignmentRow): Assignment => ({
  assignmentId: row.assignment_id as AssignmentId,
  title: row.title,
  instructions: row.instructions,
  dueAt: row.due_at?.toISOString() ?? null,
  requirements: {
    sources: Number(row.require_sources),
    counterArgument: row.require_counterargument,
    aiProvenance: row.require_ai_provenance,
  },
  publishedAt: row.published_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
});

export interface AssignmentInput {
  title?: string;
  instructions?: string;
  dueAt?: string | null;
  requirements?: Partial<Requirements>;
  publish?: boolean;
}

export async function createAssignment(input: AssignmentInput): Promise<Assignment> {
  await ensureSeats();
  const requirements = { ...NO_REQUIREMENTS, ...input.requirements };

  const { rows } = await pool.query<AssignmentRow>(
    `insert into assignment
       (instructor_id, title, instructions, due_at,
        require_sources, require_counterargument, require_ai_provenance, published_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [
      SEATS.instructor,
      input.title ?? 'Untitled assignment',
      input.instructions ?? '',
      input.dueAt ?? null,
      Math.max(0, Math.trunc(requirements.sources)),
      requirements.counterArgument,
      requirements.aiProvenance,
      input.publish === true ? new Date().toISOString() : null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the assignment was not created');
  return toAssignment(row);
}

export async function listAssignments(): Promise<Assignment[]> {
  const { rows } = await pool.query<AssignmentRow>(
    'select * from assignment order by created_at desc',
  );
  return rows.map(toAssignment);
}

export async function publishAssignment(id: AssignmentId): Promise<Assignment> {
  const { rows } = await pool.query<AssignmentRow>(
    `update assignment set published_at = coalesce(published_at, now())
     where assignment_id = $1 returning *`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`unknown assignment ${id}`);
  return toAssignment(row);
}

/** Point a project at an assignment. The student's log is untouched. */
export async function attachProject(
  projectId: ProjectId,
  assignmentId: AssignmentId | null,
): Promise<void> {
  await pool.query(
    'update project set assignment_id = $2 where project_id = $1',
    [projectId, assignmentId],
  );
}

/* ------------------------------------------------------------------ */
/* The dashboard                                                       */
/* ------------------------------------------------------------------ */

export interface ProgressRow {
  projectId: ProjectId;
  title: string;
  /** The assignment this project answers, if any. */
  assignmentId: AssignmentId | null;
  /** When the student last submitted, or null if they have not. */
  submittedAt: string | null;
  checkpoints: number;
  /** Objects frozen by the most recent checkpoint. */
  frozen: number;
  requirements: RequirementCheck[];
  requirementsMet: boolean;
  openComments: number;
  /** Comments the student has revised past since they were written. */
  staleComments: number;
  events: number;
}

export interface Dashboard {
  assignment: Assignment | null;
  rows: ProgressRow[];
}

/**
 * Progress at checkpoint level, which is all an instructor sees before a
 * submission.
 *
 * The lane breakdown is deliberate about this: during framing and claim work the
 * instructor column is empty. Watching someone think is not the same as
 * reviewing what they have decided to show you, and the second is what this
 * reports.
 */
export async function dashboard(assignmentId: AssignmentId | null): Promise<Dashboard> {
  const assignment = assignmentId === null
    ? null
    : (await listAssignments()).find((a) => a.assignmentId === assignmentId) ?? null;

  const { rows } = await pool.query<{ project_id: string; title: string; assignment_id: string | null }>(
    assignmentId === null
      ? 'select project_id, title, assignment_id from project order by created_at desc limit 50'
      : 'select project_id, title, assignment_id from project where assignment_id = $1 order by created_at desc',
    assignmentId === null ? [] : [assignmentId],
  );

  /**
   * Each project is measured against its own assignment.
   *
   * Not against the filter: an unfiltered dashboard lists projects answering
   * different assignments, and checking them all against one set of
   * requirements would report a project as complete because nothing was asked
   * of it. A project attached to nothing is measured against nothing, which is
   * the honest reading of an unattached project rather than a passing grade.
   */
  const all = await listAssignments();
  const requirementsFor = (id: string | null): Requirements =>
    all.find((a) => a.assignmentId === id)?.requirements ?? NO_REQUIREMENTS;

  const progress = await Promise.all(rows.map(async (row): Promise<ProgressRow> => {
    const view = await loadProject(row.project_id as ProjectId);
    const requirements = requirementsFor(row.assignment_id);
    const snapshots = Object.values(view.state.snapshots)
      .sort((a, b) => a.at.localeCompare(b.at));
    const latest = snapshots[snapshots.length - 1];

    const checks = checkRequirements(view.state, requirements);
    const open = openComments(view.state);
    const stale = open.filter((c) => commentDrift(view.state, c.commentId as CommentId)?.stale === true);

    return {
      projectId: row.project_id as ProjectId,
      title: row.title,
      assignmentId: row.assignment_id as AssignmentId | null,
      submittedAt: latest?.at ?? null,
      checkpoints: snapshots.length,
      frozen: latest?.entries.length ?? 0,
      requirements: checks,
      requirementsMet: requirementsMet(checks),
      openComments: open.length,
      staleComments: stale.length,
      events: view.state.seq,
    };
  }));

  return { assignment, rows: progress };
}
