import type {
  ActorId, AssignmentId, CommentId, MoveId, ObjectId, PassageId, ProjectId,
  ProposalId, RelationId, SnapshotId, SourceId, VersionId,
} from './ids.js';

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** The twelve thought types carried over from the v2 studio prototype. */
export const THOUGHT_TYPES = [
  'NOTICE', 'WONDER', 'TENSION', 'UNKNOWN', 'QUESTION', 'IDEA',
  'CLAIM', 'EVIDENCE', 'CHALLENGE', 'ALTERNATIVE', 'ASSUMPTION', 'SYNTHESIS',
] as const;
export type ThoughtType = (typeof THOUGHT_TYPES)[number];

/** The student picks the relation. It is never inferred from the two endpoints. */
export const RELATIONS = [
  'raises', 'suggests', 'challenges', 'supports',
  'contradicts', 'leaves_uncertain', 'leads_to', 'reframes',
] as const;
export type Relation = (typeof RELATIONS)[number];

/** Who acted. Recorded on every event, which is where provenance comes from. */
export const ACTORS = ['student', 'coach', 'instructor'] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * How much of a source we actually hold.
 *
 * Search surfaces all four. Only the bottom two carry real text, and only real
 * text can back an Evidence object.
 */
export const SOURCE_ACCESS = ['metadata', 'abstract', 'open_full_text', 'user_upload'] as const;
export type SourceAccess = (typeof SOURCE_ACCESS)[number];

export const EVIDENCE_CAPABLE_ACCESS = ['open_full_text', 'user_upload'] as const satisfies readonly SourceAccess[];
export type EvidenceCapableAccess = (typeof EVIDENCE_CAPABLE_ACCESS)[number];

export const canBackEvidence = (access: SourceAccess): access is EvidenceCapableAccess =>
  (EVIDENCE_CAPABLE_ACCESS as readonly SourceAccess[]).includes(access);

/**
 * Where a passage's text came from.
 *
 * There is deliberately no `generated` member. The system never renders,
 * paraphrases, or implies a passage it has not retrieved, so the type system
 * gives that failure mode nowhere to live.
 */
export const PASSAGE_PROVENANCE = ['retrieved', 'uploaded', 'student_transcribed'] as const;
export type PassageProvenance = (typeof PASSAGE_PROVENANCE)[number];

/**
 * The coach's closed tool set. Its output is a move, never content.
 *
 * `challenge` is the single kind that carries prose, and what it carries is an
 * objection to argue with rather than the student's own thought.
 */
export const COACH_MOVE_KINDS = [
  'reflect', 'ask', 'offer_structure', 'offer_sentence_frame',
  'propose_branch', 'flag', 'retrieve', 'challenge',
] as const;
export type CoachMoveKind = (typeof COACH_MOVE_KINDS)[number];

/** Support escalates only on request. Rung 4 is never volunteered. */
export const HINT_LADDER = ['reflect', 'ask', 'offer_structure', 'offer_sentence_frame'] as const;
export type HintLevel = 0 | 1 | 2 | 3;

export const STRUCTURAL_FLAGS = [
  'claim_without_evidence', 'unresolved_challenge', 'contradiction',
  'question_drift', 'source_saved_never_cited',
] as const;
export type StructuralFlag = (typeof STRUCTURAL_FLAGS)[number];

export const COMMENT_KINDS = ['comment', 'question', 'mark_for_revision'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const PROPOSAL_KINDS = ['claim', 'branch', 'challenge'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/* ------------------------------------------------------------------ */
/* Materialized entities (projections of the event log)                */
/* ------------------------------------------------------------------ */

export interface Point { x: number; y: number }

export interface ThoughtVersion {
  versionId: VersionId;
  objectId: ObjectId;
  type: ThoughtType;
  text: string;
  note: string;
  parentVersionId: VersionId | null;
  authoredBy: Actor;
  /** The coach move that immediately preceded this write, when there was one. */
  promptedBy: MoveId | null;
  at: string;
  seq: number;
}

export interface Thought {
  objectId: ObjectId;
  type: ThoughtType;
  currentVersionId: VersionId;
  text: string;
  note: string;
  position: Point;
  archived: boolean;
  createdAt: string;
  /** Present only on EVIDENCE thoughts. */
  evidence?: EvidenceBody;
}

/** An Evidence thought is a claim about a passage, written by the student. */
export interface EvidenceBody {
  sourceId: SourceId;
  passageId: PassageId;
  /** What the student thinks the passage shows. */
  interpretation: string;
  /** What it licenses them to claim, and what it does not. */
  warrant: string;
}

export interface RelationEdge {
  relationId: RelationId;
  from: ObjectId;
  to: ObjectId;
  relation: Relation;
  authoredBy: Actor;
  removed: boolean;
}

export interface Source {
  sourceId: SourceId;
  access: SourceAccess;
  cite: string;
  title: string;
  method: string | null;
  abstract: string | null;
  externalUrl: string | null;
  doi: string | null;
  saved: boolean;
  discoveredAt: string;
}

export interface Passage {
  passageId: PassageId;
  sourceId: SourceId;
  text: string;
  /** Page, section, or offset. Whatever makes the quote findable again. */
  locator: string;
  provenance: PassageProvenance;
}

export interface Proposal {
  proposalId: ProposalId;
  kind: ProposalKind;
  suggestedType: ThoughtType;
  targetObjectId: ObjectId | null;
  /** The coach's wording of the prompt, not of the thought. */
  rationale: string;
  status: 'open' | 'accepted' | 'dismissed';
  acceptedAs: ObjectId | null;
}

export interface CoachMove {
  moveId: MoveId;
  kind: CoachMoveKind;
  targetObjectId: ObjectId | null;
  hintLevel: HintLevel;
  /** Prose the coach is permitted to write: a reflection, a question, an objection. */
  body: string;
  flag: StructuralFlag | null;
  at: string;
}

export interface StudentReply {
  moveId: MoveId;
  text: string;
  at: string;
}

/** A frozen (ObjectId, VersionId) pair. The identity is shared with the live object. */
export interface SnapshotEntry {
  objectId: ObjectId;
  versionId: VersionId;
}

export interface Snapshot {
  snapshotId: SnapshotId;
  projectId: ProjectId;
  assignmentId: AssignmentId | null;
  entries: SnapshotEntry[];
  at: string;
}

export interface Comment {
  commentId: CommentId;
  snapshotId: SnapshotId;
  /** Stable identity: the thread stays attached as the student keeps editing. */
  objectId: ObjectId;
  /** What was actually on screen when the instructor wrote this. */
  versionId: VersionId;
  kind: CommentKind;
  body: string;
  authorId: ActorId;
  resolvedByVersionId: VersionId | null;
  at: string;
}

export interface ProblemFrame {
  question: string;
  concepts: string[];
  assumptions: string[];
  acceptedAt: string | null;
}

export interface ProjectState {
  projectId: ProjectId;
  title: string;
  group: string;
  frame: ProblemFrame | null;
  thoughts: Record<string, Thought>;
  versions: Record<string, ThoughtVersion[]>;
  relations: Record<string, RelationEdge>;
  sources: Record<string, Source>;
  passages: Record<string, Passage>;
  proposals: Record<string, Proposal>;
  snapshots: Record<string, Snapshot>;
  comments: Record<string, Comment>;
  thread: Array<CoachMove | StudentReply>;
  seq: number;
}
