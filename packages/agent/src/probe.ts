/**
 * Proves the agent layer against whatever is installed on this machine.
 *
 *   pnpm --filter @coral/agent probe            # static ladder only, free
 *   pnpm --filter @coral/agent probe -- --live  # also calls your local agent
 *
 * The live run spends your own Claude or Codex quota, which is the whole point
 * of the design: Coral holds no credential and pays for no inference.
 */
import { initialState, type ObjectId, type ProjectId, type VersionId } from '@coral/core';
import { append } from '@coral/core';
import type { ActorId, DomainEvent, EventId } from '@coral/core';
import { detectProviders, renderContext, requestMove } from './index.js';

const PROJECT = '00000000-0000-4000-9000-000000000001' as ProjectId;
const live = process.argv.includes('--live');

let seq = 0;
const ids = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function build() {
  let state = initialState(PROJECT);
  const push = (type: string, payload: unknown, actor: 'student' | 'coach' = 'student'): void => {
    seq += 1;
    state = append(state, {
      id: ids(900 + seq) as EventId,
      projectId: PROJECT,
      seq,
      at: new Date().toISOString(),
      actor,
      actorId: ids(1) as ActorId,
      promptedBy: null,
      type,
      payload,
    } as DomainEvent);
  };

  const notice = ids(1) as ObjectId;
  const wonder = ids(2) as ObjectId;
  const tension = ids(3) as ObjectId;

  push('project.created', { title: 'AI and independent reasoning', group: 'AI & Learning' });
  push('thought.created', {
    objectId: notice, versionId: ids(11) as VersionId, type: 'NOTICE',
    text: 'Students complete assignments much faster when they use AI.',
    note: 'Seminar, week 3', position: { x: 0, y: 0 },
  });
  push('thought.created', {
    objectId: wonder, versionId: ids(12) as VersionId, type: 'WONDER',
    text: 'Are they actually learning more?', note: '', position: { x: 0, y: 0 },
  });
  push('relation.created', { relationId: ids(21), from: notice, to: wonder, relation: 'raises' });
  push('thought.created', {
    objectId: tension, versionId: ids(13) as VersionId, type: 'TENSION',
    text: 'Performance increases, but independent learning may not.',
    note: '', position: { x: 0, y: 0 },
  });
  push('relation.created', { relationId: ids(22), from: wonder, to: tension, relation: 'reframes' });

  return { state, selected: tension };
}

async function main(): Promise<void> {
  const { state, selected } = build();
  const context = renderContext(state, selected);

  console.log('\n--- what the coach sees -------------------------------------\n');
  console.log(context);

  console.log('\n--- providers on this machine -------------------------------\n');
  for (const p of await detectProviders()) {
    console.log(`  ${p.available ? 'yes' : 'no '}  ${p.label.padEnd(16)} ${p.detail}`);
  }

  console.log('\n--- the built-in ladder, rung by rung (no model) ------------\n');
  for (const rung of [0, 1, 2, 3] as const) {
    const outcome = await requestMove({ context, rung, adversarial: false }, 'static');
    console.log(`  rung ${rung}  ${outcome.move.kind.padEnd(22)} ${outcome.move.body}`);
  }
  const objection = await requestMove({ context, rung: 0, adversarial: true }, 'static');
  console.log(`  argue   ${objection.move.kind.padEnd(22)} ${objection.move.body}`);

  if (!live) {
    console.log('\n(pass --live to also call your own agent; that spends your quota)\n');
    return;
  }

  console.log('\n--- your local agent ----------------------------------------\n');
  for (const rung of [1, 2] as const) {
    const started = Date.now();
    const outcome = await requestMove({ context, rung, adversarial: false }, 'claude-code');
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  rung ${rung}  via ${outcome.provider} in ${secs}s`);
    if (outcome.fellBackFrom !== undefined) console.log(`         fell back from ${outcome.fellBackFrom}: ${outcome.reason}`);
    console.log(`         ${outcome.move.kind}: ${outcome.move.body}`);
    if (outcome.move.suggestedType !== undefined) {
      console.log(`         proposes a ${outcome.move.suggestedType} (${outcome.move.relation ?? 'no relation'})`);
    }
    console.log();
  }

  const argued = await requestMove({ context, rung: 0, adversarial: true }, 'claude-code');
  console.log(`  argue  via ${argued.provider}`);
  if (argued.fellBackFrom !== undefined) console.log(`         fell back from ${argued.fellBackFrom}: ${argued.reason}`);
  console.log(`         ${argued.move.kind}: ${argued.move.body}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
