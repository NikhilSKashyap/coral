import type {
  ActorId, AssignmentId, CommentId, EventId, MoveId, ObjectId, PassageId,
  ProjectId, ProposalId, RelationId, SnapshotId, SourceId, VersionId,
} from './ids.js';
import type {
  Actor, CoachMoveKind, CommentKind, HintLevel, PassageProvenance, Point,
  ProposalKind, Relation, SnapshotEntry, SourceAccess, StructuralFlag, ThoughtType,
} from './types.js';

/**
 * The event log is the source of truth. Everything else in this package is a
 * projection of it: current state, version history, the coach thread, the
 * instructor's evidence panel, and undo.
 *
 * Events are append-only. There is no delete event for anything a student wrote;
 * archiving sets a flag and the thought stays on the map.
 */

export interface EventMeta {
  id: EventId;
  projectId: ProjectId;
  /** Monotonic within a project. The ordering that replay depends on. */
  seq: number;
  at: string;
  actor: Actor;
  actorId: ActorId;
  /** The coach move this write answers, when there was one. Provenance, in one column. */
  promptedBy: MoveId | null;
}

type Def<T extends string, P> = EventMeta & { type: T; payload: P };

/* --- project and framing ------------------------------------------ */

export type ProjectCreated = Def<'project.created', {
  title: string;
  group: string;
}>;

export type FrameDrafted = Def<'frame.drafted', {
  question: string;
  concepts: string[];
  assumptions: string[];
}>;

export type FrameAccepted = Def<'frame.accepted', Record<string, never>>;

/* --- thoughts ------------------------------------------------------ */

export type ThoughtCreated = Def<'thought.created', {
  objectId: ObjectId;
  versionId: VersionId;
  type: ThoughtType;
  text: string;
  note: string;
  position: Point;
}>;

/** A new version against the same permanent identity. Never an overwrite. */
export type ThoughtRevised = Def<'thought.revised', {
  objectId: ObjectId;
  versionId: VersionId;
  parentVersionId: VersionId;
  text: string;
  note: string;
}>;

export type ThoughtRetyped = Def<'thought.retyped', {
  objectId: ObjectId;
  versionId: VersionId;
  parentVersionId: VersionId;
  type: ThoughtType;
}>;

/** Layout only. Carries no provenance weight and mints no version. */
export type ThoughtMoved = Def<'thought.moved', {
  objectId: ObjectId;
  position: Point;
}>;

export type ThoughtArchived = Def<'thought.archived', { objectId: ObjectId }>;
export type ThoughtRestored = Def<'thought.restored', { objectId: ObjectId }>;

/* --- relations ----------------------------------------------------- */

export type RelationCreated = Def<'relation.created', {
  relationId: RelationId;
  from: ObjectId;
  to: ObjectId;
  relation: Relation;
}>;

export type RelationRetyped = Def<'relation.retyped', {
  relationId: RelationId;
  relation: Relation;
}>;

export type RelationRemoved = Def<'relation.removed', { relationId: RelationId }>;

/* --- sources, passages, evidence ----------------------------------- */

export type SourceDiscovered = Def<'source.discovered', {
  sourceId: SourceId;
  access: SourceAccess;
  cite: string;
  title: string;
  method: string | null;
  abstract: string | null;
  externalUrl: string | null;
  doi: string | null;
}>;

export type SourceSaved = Def<'source.saved', { sourceId: SourceId }>;

/** Promotes a source to `user_upload` once its text is actually in hand. */
export type SourceUploaded = Def<'source.uploaded', { sourceId: SourceId }>;

/** Real text, with a stated origin. There is no origin meaning "made up". */
export type PassageCaptured = Def<'passage.captured', {
  passageId: PassageId;
  sourceId: SourceId;
  text: string;
  locator: string;
  provenance: PassageProvenance;
}>;

/**
 * Gated twice: the source must carry real text, and the student must have
 * written both the interpretation and the warrant.
 */
export type EvidenceCreated = Def<'evidence.created', {
  objectId: ObjectId;
  versionId: VersionId;
  sourceId: SourceId;
  passageId: PassageId;
  interpretation: string;
  warrant: string;
  position: Point;
}>;

/* --- proposals ----------------------------------------------------- */

/** The coach detects; it does not accept. */
export type ProposalRaised = Def<'proposal.raised', {
  proposalId: ProposalId;
  kind: ProposalKind;
  suggestedType: ThoughtType;
  targetObjectId: ObjectId | null;
  rationale: string;
}>;

export type ProposalAccepted = Def<'proposal.accepted', {
  proposalId: ProposalId;
  objectId: ObjectId;
}>;

export type ProposalDismissed = Def<'proposal.dismissed', { proposalId: ProposalId }>;

/* --- coach thread -------------------------------------------------- */

export type CoachMoved = Def<'coach.moved', {
  moveId: MoveId;
  kind: CoachMoveKind;
  targetObjectId: ObjectId | null;
  hintLevel: HintLevel;
  body: string;
  flag: StructuralFlag | null;
}>;

export type StudentReplied = Def<'student.replied', {
  moveId: MoveId;
  text: string;
}>;

/* --- checkpoints and feedback -------------------------------------- */

export type CheckpointSubmitted = Def<'checkpoint.submitted', {
  snapshotId: SnapshotId;
  assignmentId: AssignmentId | null;
  entries: SnapshotEntry[];
}>;

export type CommentCreated = Def<'comment.created', {
  commentId: CommentId;
  snapshotId: SnapshotId;
  objectId: ObjectId;
  versionId: VersionId;
  kind: CommentKind;
  body: string;
}>;

export type CommentResolved = Def<'comment.resolved', {
  commentId: CommentId;
  byVersionId: VersionId;
}>;

/* ------------------------------------------------------------------ */

export type DomainEvent =
  | ProjectCreated | FrameDrafted | FrameAccepted
  | ThoughtCreated | ThoughtRevised | ThoughtRetyped | ThoughtMoved
  | ThoughtArchived | ThoughtRestored
  | RelationCreated | RelationRetyped | RelationRemoved
  | SourceDiscovered | SourceSaved | SourceUploaded | PassageCaptured | EvidenceCreated
  | ProposalRaised | ProposalAccepted | ProposalDismissed
  | CoachMoved | StudentReplied
  | CheckpointSubmitted | CommentCreated | CommentResolved;

export type DomainEventType = DomainEvent['type'];

export const EVENT_TYPES = [
  'project.created', 'frame.drafted', 'frame.accepted',
  'thought.created', 'thought.revised', 'thought.retyped', 'thought.moved',
  'thought.archived', 'thought.restored',
  'relation.created', 'relation.retyped', 'relation.removed',
  'source.discovered', 'source.saved', 'source.uploaded', 'passage.captured', 'evidence.created',
  'proposal.raised', 'proposal.accepted', 'proposal.dismissed',
  'coach.moved', 'student.replied',
  'checkpoint.submitted', 'comment.created', 'comment.resolved',
] as const satisfies readonly DomainEventType[];

/**
 * Events that write text the student owns. Only a student may emit one.
 * `evidence.created` is here because the interpretation and the warrant are the
 * student's reasoning, not the paper's.
 */
export const STUDENT_AUTHORED_EVENTS = [
  'thought.created', 'thought.revised', 'evidence.created', 'student.replied',
] as const satisfies readonly DomainEventType[];

/** Events only the coach emits. None of them writes a thought's text. */
export const COACH_ONLY_EVENTS = [
  'coach.moved', 'proposal.raised', 'source.discovered', 'passage.captured',
] as const satisfies readonly DomainEventType[];

/** Events only an instructor emits. They never touch the graph. */
export const INSTRUCTOR_ONLY_EVENTS = [
  'comment.created',
] as const satisfies readonly DomainEventType[];
