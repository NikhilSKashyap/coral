import type { DomainEvent } from '@coral/core';
import type { TxClient } from './db.js';

/**
 * Writes one event into the projection tables.
 *
 * The event row is the record; these tables are a convenience for reading. They
 * matter anyway because two of the product's refusals are enforced here rather
 * than in application code: `thought_version` will not accept a row the coach
 * authored, and `evidence` will not accept a row whose source carries no
 * retrievable passage. Routing every write through this projector is what puts
 * those guards on the real path instead of in a comment.
 */
export async function project(q: TxClient, event: DomainEvent): Promise<void> {
  const { projectId } = event;

  switch (event.type) {
    case 'project.created':
      await q.query(
        `update project set title = $2, project_group = $3 where project_id = $1`,
        [projectId, event.payload.title, event.payload.group],
      );
      return;

    case 'thought.created': {
      const p = event.payload;
      await q.query(
        `insert into thought (object_id, project_id, type, current_version_id, pos_x, pos_y, created_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [p.objectId, projectId, p.type, p.versionId, p.position.x, p.position.y, event.at],
      );
      await q.query(
        `insert into thought_version
           (version_id, object_id, parent_version_id, seq, type, text, note, authored_by, prompted_by, at)
         values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9)`,
        [p.versionId, p.objectId, event.seq, p.type, p.text, p.note, event.actor, event.promptedBy, event.at],
      );
      return;
    }

    case 'evidence.created': {
      const p = event.payload;
      await q.query(
        `insert into thought (object_id, project_id, type, current_version_id, pos_x, pos_y, created_at)
         values ($1,$2,'EVIDENCE',$3,$4,$5,$6)`,
        [p.objectId, projectId, p.versionId, p.position.x, p.position.y, event.at],
      );
      await q.query(
        `insert into thought_version
           (version_id, object_id, parent_version_id, seq, type, text, note, authored_by, prompted_by, at)
         values ($1,$2,null,$3,'EVIDENCE',$4,$5,$6,$7,$8)`,
        [p.versionId, p.objectId, event.seq, p.interpretation, p.warrant, event.actor, event.promptedBy, event.at],
      );
      // The evidence_gate trigger runs on this insert.
      await q.query(
        `insert into evidence (object_id, source_id, passage_id, interpretation, warrant)
         values ($1,$2,$3,$4,$5)`,
        [p.objectId, p.sourceId, p.passageId, p.interpretation, p.warrant],
      );
      await q.query(`update source set saved = true where source_id = $1`, [p.sourceId]);
      return;
    }

    case 'thought.revised': {
      const p = event.payload;
      await q.query(
        `insert into thought_version
           (version_id, object_id, parent_version_id, seq, type, text, note, authored_by, prompted_by, at)
         select $1, $2, $3, $4, t.type, $5, $6, $7, $8, $9 from thought t where t.object_id = $2`,
        [p.versionId, p.objectId, p.parentVersionId, event.seq, p.text, p.note, event.actor, event.promptedBy, event.at],
      );
      await q.query(`update thought set current_version_id = $2 where object_id = $1`,
        [p.objectId, p.versionId]);
      return;
    }

    case 'thought.retyped': {
      const p = event.payload;
      await q.query(
        `insert into thought_version
           (version_id, object_id, parent_version_id, seq, type, text, note, authored_by, prompted_by, at)
         select $1, $2, $3, $4, $5, v.text, v.note, $6, $7, $8
         from thought_version v where v.version_id = $3`,
        [p.versionId, p.objectId, p.parentVersionId, event.seq, p.type, event.actor, event.promptedBy, event.at],
      );
      await q.query(`update thought set type = $2, current_version_id = $3 where object_id = $1`,
        [p.objectId, p.type, p.versionId]);
      return;
    }

    case 'thought.moved':
      await q.query(`update thought set pos_x = $2, pos_y = $3 where object_id = $1`,
        [event.payload.objectId, event.payload.position.x, event.payload.position.y]);
      return;

    case 'thought.archived':
    case 'thought.restored':
      await q.query(`update thought set archived = $2 where object_id = $1`,
        [event.payload.objectId, event.type === 'thought.archived']);
      return;

    case 'relation.created':
      await q.query(
        `insert into relation (relation_id, project_id, from_object, to_object, relation, authored_by)
         values ($1,$2,$3,$4,$5,$6)`,
        [event.payload.relationId, projectId, event.payload.from, event.payload.to,
         event.payload.relation, event.actor],
      );
      return;

    case 'relation.retyped':
      await q.query(`update relation set relation = $2 where relation_id = $1`,
        [event.payload.relationId, event.payload.relation]);
      return;

    case 'relation.removed':
      await q.query(`update relation set removed = true where relation_id = $1`,
        [event.payload.relationId]);
      return;

    case 'source.discovered': {
      const p = event.payload;
      await q.query(
        `insert into source (source_id, project_id, access, cite, title, method, abstract, external_url, doi, discovered_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [p.sourceId, projectId, p.access, p.cite, p.title, p.method, p.abstract, p.externalUrl, p.doi, event.at],
      );
      return;
    }

    case 'source.saved':
      await q.query(`update source set saved = true where source_id = $1`, [event.payload.sourceId]);
      return;

    case 'source.uploaded':
      await q.query(`update source set saved = true, access = 'user_upload' where source_id = $1`,
        [event.payload.sourceId]);
      return;

    case 'passage.captured':
      await q.query(
        `insert into passage (passage_id, source_id, text, locator, provenance) values ($1,$2,$3,$4,$5)`,
        [event.payload.passageId, event.payload.sourceId, event.payload.text,
         event.payload.locator, event.payload.provenance],
      );
      return;

    case 'proposal.raised':
      await q.query(
        `insert into proposal (proposal_id, project_id, kind, suggested_type, target_object_id, rationale)
         values ($1,$2,$3,$4,$5,$6)`,
        [event.payload.proposalId, projectId, event.payload.kind, event.payload.suggestedType,
         event.payload.targetObjectId, event.payload.rationale],
      );
      return;

    case 'proposal.accepted':
      await q.query(`update proposal set status = 'accepted', accepted_as = $2 where proposal_id = $1`,
        [event.payload.proposalId, event.payload.objectId]);
      return;

    case 'proposal.dismissed':
      await q.query(`update proposal set status = 'dismissed' where proposal_id = $1`,
        [event.payload.proposalId]);
      return;

    case 'coach.moved':
      await q.query(
        `insert into coach_move (move_id, project_id, kind, target_object_id, hint_level, body, flag, at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [event.payload.moveId, projectId, event.payload.kind, event.payload.targetObjectId,
         event.payload.hintLevel, event.payload.body, event.payload.flag, event.at],
      );
      return;

    case 'student.replied':
      await q.query(`insert into student_reply (move_id, text, at) values ($1,$2,$3)`,
        [event.payload.moveId, event.payload.text, event.at]);
      return;

    case 'checkpoint.submitted': {
      const p = event.payload;
      await q.query(`insert into snapshot (snapshot_id, project_id, assignment_id, at) values ($1,$2,$3,$4)`,
        [p.snapshotId, projectId, p.assignmentId, event.at]);
      for (const entry of p.entries) {
        await q.query(
          `insert into snapshot_object (snapshot_id, object_id, version_id) values ($1,$2,$3)`,
          [p.snapshotId, entry.objectId, entry.versionId],
        );
      }
      return;
    }

    case 'comment.created': {
      const p = event.payload;
      await q.query(
        `insert into instructor_comment
           (comment_id, snapshot_id, object_id, version_id, kind, body, author_id, at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.commentId, p.snapshotId, p.objectId, p.versionId, p.kind, p.body, event.actorId, event.at],
      );
      return;
    }

    case 'comment.resolved':
      await q.query(`update instructor_comment set resolved_by_version_id = $2 where comment_id = $1`,
        [event.payload.commentId, event.payload.byVersionId]);
      return;

    case 'frame.drafted':
    case 'frame.accepted':
      // Held in the log only until the framing phase lands in slice 01.
      return;
  }
}
