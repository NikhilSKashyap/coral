/**
 * Identity is two things, not one.
 *
 * An `ObjectId` is permanent: a Claim keeps it from creation until the end of the
 * project, across every revision and every checkpoint. A `VersionId` names one
 * revision of that object. Snapshots freeze `(ObjectId, VersionId)` pairs; they
 * never mint a second identity for the same reasoning object.
 *
 * Every id is a UUID. The client mints them, so a thought carries the same
 * identity from the moment it appears on screen through the database row, with
 * no server round trip in between and no id to reconcile afterwards.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type ObjectId = Brand<string, 'ObjectId'>;
export type VersionId = Brand<string, 'VersionId'>;
export type RelationId = Brand<string, 'RelationId'>;
export type SourceId = Brand<string, 'SourceId'>;
export type PassageId = Brand<string, 'PassageId'>;
export type ProposalId = Brand<string, 'ProposalId'>;
export type MoveId = Brand<string, 'MoveId'>;
export type SnapshotId = Brand<string, 'SnapshotId'>;
export type CommentId = Brand<string, 'CommentId'>;
export type EventId = Brand<string, 'EventId'>;
export type AssignmentId = Brand<string, 'AssignmentId'>;
export type ActorId = Brand<string, 'ActorId'>;

export type AnyId =
  | ProjectId | ObjectId | VersionId | RelationId | SourceId | PassageId
  | ProposalId | MoveId | SnapshotId | CommentId | EventId | AssignmentId | ActorId;

export interface IdFactory {
  next<T extends AnyId>(): T;
}

export const randomIds = (): IdFactory => ({
  next<T extends AnyId>(): T {
    return crypto.randomUUID() as T;
  },
});

/** Deterministic and still UUID-shaped, so a replayed log can hit real columns. */
export const sequentialIds = (seed = 0): IdFactory => {
  let n = seed;
  return {
    next<T extends AnyId>(): T {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as T;
    },
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);
