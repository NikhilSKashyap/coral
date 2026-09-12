import type { DomainEvent } from './events.js';
import type { ProjectId, SnapshotId } from './ids.js';
import { replay } from './state.js';
import type { ProjectState } from './types.js';

/**
 * The project as it stood when a checkpoint was submitted.
 *
 * A brief assembled from live state is the wrong document to review. The
 * instructor commented on what was handed in; if the student has revised since,
 * a live brief defends them with text nobody read. The identity-versus-version
 * split exists precisely so this can be reconstructed without cloning anything,
 * and this is where it gets used.
 *
 * Replaying to the checkpoint's own event does most of the work: every thought
 * is at the version that was current then, because that is what the checkpoint
 * froze. The entries are still honoured afterwards, because a client may submit
 * a subset, and a brief that included work deliberately held back would be
 * showing the instructor something that was not handed in.
 */
export function stateAtCheckpoint(
  projectId: ProjectId,
  events: readonly DomainEvent[],
  snapshotId: SnapshotId,
): ProjectState | undefined {
  const at = events.findIndex(
    (e) => e.type === 'checkpoint.submitted' && e.payload.snapshotId === snapshotId,
  );
  if (at < 0) return undefined;

  const then = replay(projectId, events.slice(0, at + 1));
  const snapshot = then.snapshots[snapshotId];
  if (snapshot === undefined) return undefined;

  const frozen = new Map(snapshot.entries.map((entry) => [entry.objectId as string, entry.versionId]));

  const thoughts: ProjectState['thoughts'] = {};
  const versions: ProjectState['versions'] = {};

  for (const [objectId, thought] of Object.entries(then.thoughts)) {
    const versionId = frozen.get(objectId);
    if (versionId === undefined) continue;

    // Replay already put the thought at its then-current version. If a snapshot
    // named an older one, honour the snapshot: it is the record of what was
    // handed in, and replay is only how we got here.
    const history = then.versions[objectId] ?? [];
    const index = history.findIndex((v) => v.versionId === versionId);
    const version = index < 0 ? undefined : history[index];

    thoughts[objectId] = version === undefined
      ? thought
      : {
        ...thought,
        currentVersionId: version.versionId,
        type: version.type,
        text: version.text,
        note: version.note,
      };
    versions[objectId] = index < 0 ? history : history.slice(0, index + 1);
  }

  // Relations pointing at something that was not submitted would render as
  // edges to nowhere.
  const relations = Object.fromEntries(
    Object.entries(then.relations).filter(
      ([, edge]) => thoughts[edge.from] !== undefined && thoughts[edge.to] !== undefined,
    ),
  );

  return { ...then, thoughts, versions, relations };
}

/** Checkpoints in the order they were submitted. */
export const checkpointsOf = (state: ProjectState): Array<{ snapshotId: SnapshotId; at: string; entries: number }> =>
  Object.values(state.snapshots)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((s) => ({ snapshotId: s.snapshotId, at: s.at, entries: s.entries.length }));
