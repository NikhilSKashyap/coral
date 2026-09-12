import { create } from 'zustand';
import {
  initialState,
  type Actor, type DomainEvent, type ObjectId, type ObservableRecord,
  type ProjectId, type ProjectState,
} from '@coral/core';
import {
  Refused, askCoach, createProject, emit, listProjects, listProviders, loadDrift,
  loadProject, searchLiterature,
  type CoachResponse, type Drift, type ProjectSummary, type ProviderId, type ProviderStatus,
} from './api.js';

export type View = 'map' | 'focus';

interface Studio {
  projectId: ProjectId | null;
  projects: ProjectSummary[];
  state: ProjectState;
  events: DomainEvent[];
  record: ObservableRecord | null;
  drift: Drift[];
  providers: ProviderStatus[];
  provider: ProviderId;
  lastMove: CoachResponse | null;
  selected: ObjectId | null;
  view: View;
  role: Actor;
  busy: boolean;
  refusal: { invariant: string; message: string } | null;

  refreshProjects: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  setProvider: (provider: ProviderId) => void;
  ask: (objectId: ObjectId, opts: { escalate?: boolean; argue?: boolean }) => Promise<void>;
  newProject: (title: string, group: string) => Promise<void>;
  open: (id: ProjectId) => Promise<void>;
  write: (actor: Actor, type: DomainEvent['type'], payload: unknown) => Promise<boolean>;
  search: () => Promise<void>;
  select: (id: ObjectId | null) => void;
  setView: (view: View) => void;
  setRole: (role: Actor) => void;
  dismiss: () => void;
}

const BLANK = '00000000-0000-4000-9000-000000000000' as ProjectId;

export const useStudio = create<Studio>((set, get) => ({
  projectId: null,
  projects: [],
  state: initialState(BLANK),
  events: [],
  record: null,
  drift: [],
  providers: [],
  provider: 'claude-code',
  lastMove: null,
  selected: null,
  view: 'map',
  role: 'student',
  busy: false,
  refusal: null,

  refreshProjects: async () => {
    const { projects } = await listProjects();
    set({ projects });
  },

  refreshProviders: async () => {
    const { providers } = await listProviders();
    const preferred = providers.find((p) => p.available && p.id !== 'static') ?? providers[providers.length - 1];
    set({ providers, provider: preferred?.id ?? 'static' });
  },

  setProvider: (provider) => set({ provider }),

  /**
   * One coaching move from the student's own agent. Slow by nature — a local
   * model run is seconds, not milliseconds — so `busy` drives a real wait state.
   */
  ask: async (objectId, opts) => {
    const { projectId, provider } = get();
    if (projectId === null) return;
    set({ busy: true, refusal: null });
    try {
      const res = await askCoach(projectId, { objectId, ...opts, provider });
      set({ state: res.state, events: res.events, record: res.record, lastMove: res, busy: false });
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'coach',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
    }
  },

  newProject: async (title, group) => {
    set({ busy: true });
    const view = await createProject(title, group);
    set({
      projectId: view.projectId, state: view.state, events: view.events,
      record: view.record, selected: null, drift: [], busy: false,
    });
    await get().refreshProjects();
  },

  open: async (id) => {
    set({ busy: true });
    const view = await loadProject(id);
    const { drift } = await loadDrift(id);
    const first = Object.keys(view.state.thoughts)[0] ?? null;
    set({
      projectId: view.projectId, state: view.state, events: view.events, record: view.record,
      drift, selected: first as ObjectId | null, busy: false, refusal: null,
    });
  },

  /**
   * Every change goes through here. A refusal is kept in state and shown, rather
   * than thrown away, because which invariant stopped the write is the most
   * interesting thing the product has to say.
   */
  write: async (actor, type, payload) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await emit(projectId, actor, type, payload);
      const { drift } = await loadDrift(projectId);
      set({ state: view.state, events: view.events, record: view.record, drift, busy: false });
      return true;
    } catch (error) {
      if (error instanceof Refused) {
        set({ refusal: { invariant: error.invariant, message: error.message }, busy: false });
      } else {
        set({
          refusal: { invariant: 'network', message: error instanceof Error ? error.message : String(error) },
          busy: false,
        });
      }
      return false;
    }
  },

  search: async () => {
    const { projectId } = get();
    if (projectId === null) return;
    set({ busy: true });
    const view = await searchLiterature(projectId);
    set({ state: view.state, events: view.events, record: view.record, busy: false });
  },

  select: (id) => set({ selected: id, refusal: null }),
  setView: (view) => set({ view }),
  setRole: (role) => set({ role, refusal: null }),
  dismiss: () => set({ refusal: null }),
}));

export const uuid = <T extends string>(): T => crypto.randomUUID() as T;
