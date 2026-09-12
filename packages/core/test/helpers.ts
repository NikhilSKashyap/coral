import type { DomainEvent, EventMeta } from '../src/events.js';
import type { ActorId, EventId, ProjectId } from '../src/ids.js';
import { sequentialIds } from '../src/ids.js';
import { append, initialState } from '../src/state.js';
import type { Actor, ProjectState } from '../src/types.js';

const ACTOR_SEAT: Record<Actor, number> = { student: 1, coach: 2, instructor: 3 };

export const PROJECT = '00000000-0000-4000-9000-000000000001' as ProjectId;

type Body = {
  type: DomainEvent['type'];
  payload: unknown;
  /** The coach move this write answers, when a test needs provenance. */
  promptedBy?: string | null;
};

/** A small fluent log so tests read like a session rather than like plumbing. */
export class Log {
  ids = sequentialIds();
  events: DomainEvent[] = [];
  state: ProjectState = initialState(PROJECT);
  private clock = 0;

  private meta(actor: Actor, promptedBy: string | null = null): EventMeta {
    this.clock += 1;
    return {
      id: `00000000-0000-4000-a000-${String(this.clock).padStart(12, '0')}` as EventId,
      projectId: PROJECT,
      seq: this.state.seq + 1,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString(),
      actor,
      actorId: `00000000-0000-4000-b000-${String(ACTOR_SEAT[actor]).padStart(12, '0')}` as ActorId,
      promptedBy: promptedBy as EventMeta['promptedBy'],
    };
  }

  /** Append through the real guard path. Throws exactly as the server would. */
  push(actor: Actor, body: Body): this {
    const { promptedBy = null, ...rest } = body;
    const event = { ...this.meta(actor, promptedBy), ...rest } as DomainEvent;
    this.state = append(this.state, event);
    this.events.push(event);
    return this;
  }

  /** Build an event without appending it, for tests that expect a rejection. */
  draft(actor: Actor, body: Body): DomainEvent {
    const { promptedBy = null, ...rest } = body;
    return { ...this.meta(actor, promptedBy), ...rest } as DomainEvent;
  }

  id<T extends string>(): T {
    return this.ids.next<never>() as unknown as T;
  }
}

export const at = (n: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
