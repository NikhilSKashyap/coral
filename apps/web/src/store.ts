import { create } from 'zustand';
import { spineComplete, type Brief, type Thought } from '@coral/core';
import {
  initialState,
  type Actor, type DomainEvent, type ObjectId, type ObservableRecord,
  type ProjectId, type ProjectState, type ProposalId, type Relation, type SpineStage,
} from '@coral/core';
import {
  Refused, acceptProposal, askCoach, createProject, detectClaims, dismissProposal, draftFrame,
  emit, listProjects, listProviders, loadBrief, loadDrift, loadProject, retrievalStatus,
  scanMap, searchLiterature, transcribePassage, uploadPaper, writeStage,
  type CoachResponse, type DetectResult, type Drift, type ProjectSummary, type ProviderId,
  type ProviderStatus, type ScanResult, type SearchResult,
} from './api.js';

export type View = 'frame' | 'map' | 'focus' | 'brief';

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
  ask: (objectId: ObjectId, opts: { escalate?: boolean; argue?: boolean; provider?: ProviderId }) => Promise<void>;
  writeStage: (stage: SpineStage, text: string) => Promise<boolean>;
  acceptProposal: (
    proposalId: ProposalId,
    body: { text?: string; relation?: Relation },
  ) => Promise<boolean>;
  detect: () => Promise<void>;
  lastDetection: DetectResult | null;
  scan: () => Promise<void>;
  lastScan: ScanResult | null;
  brief: Brief | null;
  omitted: Thought[];
  refreshBrief: () => Promise<void>;
  dismissProposal: (proposalId: ProposalId) => Promise<boolean>;
  draftFrame: (answers: Record<string, string>) => Promise<boolean>;
  newProject: (title: string, group: string) => Promise<void>;
  open: (id: ProjectId) => Promise<void>;
  write: (actor: Actor, type: DomainEvent['type'], payload: unknown) => Promise<boolean>;
  search: (query?: string) => Promise<void>;
  lastSearch: SearchResult | null;
  fullTextAvailable: boolean | null;
  refreshRetrieval: () => Promise<void>;
  uploadPaper: (sourceId: string, file: File) => Promise<boolean>;
  transcribe: (sourceId: string, text: string, locator: string) => Promise<boolean>;
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
  view: 'frame',
  role: 'student',
  busy: false,
  refusal: null,
  lastSearch: null,
  lastDetection: null,
  lastScan: null,
  brief: null,
  omitted: [],
  fullTextAvailable: null,

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
      // The framing walk pins itself to the built-in ladder: slice 01 has no
      // model in it, and a student on that walk should not spend their quota.
      const res = await askCoach(projectId, { objectId, ...opts, provider: opts.provider ?? provider });
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

  /**
   * One stage of the framing walk.
   *
   * Deliberately not `write`: a stage is four appends that belong together, and
   * the server owns which ones. All the browser sends is the student's words.
   */
  writeStage: async (stage, text) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await writeStage(projectId, stage, text);
      set({ state: view.state, events: view.events, record: view.record, busy: false });
      await get().refreshProjects();
      return true;
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'network',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
      return false;
    }
  },

  /**
   * Rule on a proposal.
   *
   * Accepting takes the student's own words; there is no button anywhere that
   * turns a suggestion into a thought without them.
   */
  acceptProposal: async (proposalId, body) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await acceptProposal(projectId, proposalId, {
        ...(body.text === undefined ? {} : { text: body.text.trim() }),
        ...(body.relation === undefined ? {} : { relation: body.relation }),
      });
      set({ state: view.state, events: view.events, record: view.record, busy: false });
      return true;
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'network',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
      return false;
    }
  },

  dismissProposal: async (proposalId) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await dismissProposal(projectId, proposalId);
      set({ state: view.state, events: view.events, record: view.record, busy: false });
      return true;
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'network',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
      return false;
    }
  },

  draftFrame: async (answers) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await draftFrame(projectId, answers);
      set({ state: view.state, events: view.events, record: view.record, busy: false });
      return true;
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'network',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
      return false;
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
      view: spineComplete(view.state) ? 'map' : 'frame',
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

  /**
   * Literature search.
   *
   * An empty query means the project's own research question, which is almost
   * always what a student wants on the first press.
   */
  search: async (query) => {
    const { projectId } = get();
    if (projectId === null) return;
    set({ busy: true, refusal: null });
    try {
      const view = await searchLiterature(projectId, query);
      set({
        state: view.state, events: view.events, record: view.record,
        lastSearch: view, busy: false,
      });
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'retrieval',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
    }
  },

  /**
   * Ask which thoughts read as claims.
   *
   * Raises proposals and nothing else, so the result is always something to
   * rule on rather than something that happened.
   */
  detect: async () => {
    const { projectId, provider } = get();
    if (projectId === null) return;
    set({ busy: true, refusal: null });
    try {
      const view = await detectClaims(projectId, provider);
      set({
        state: view.state, events: view.events, record: view.record,
        lastDetection: view, busy: false,
      });
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'detection',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
    }
  },

  /**
   * Look over the whole map for what is missing or in tension.
   *
   * Writes flags and nothing else, so the result is always something to look
   * at rather than something that happened.
   */
  scan: async () => {
    const { projectId, provider } = get();
    if (projectId === null) return;
    set({ busy: true, refusal: null });
    try {
      const view = await scanMap(projectId, provider);
      set({
        state: view.state, events: view.events, record: view.record,
        lastScan: view, busy: false,
      });
      await get().refreshBrief();
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'scan',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
    }
  },

  /** Assembled server-side, so the browser cannot drift from what a checkpoint would freeze. */
  refreshBrief: async () => {
    const { projectId } = get();
    if (projectId === null) return;
    try {
      const { brief, omitted } = await loadBrief(projectId);
      set({ brief, omitted });
    } catch {
      set({ brief: null, omitted: [] });
    }
  },

  refreshRetrieval: async () => {
    try {
      const { fullText } = await retrievalStatus();
      set({ fullTextAvailable: fullText });
    } catch {
      set({ fullTextAvailable: false });
    }
  },

  /** Drop a PDF on a source. A scan with no text layer is refused, not promoted. */
  uploadPaper: async (sourceId, file) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await uploadPaper(projectId, sourceId, file);
      set({ state: view.state, events: view.events, record: view.record, busy: false });
      return true;
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'upload',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
      return false;
    }
  },

  transcribe: async (sourceId, text, locator) => {
    const { projectId } = get();
    if (projectId === null) return false;
    set({ busy: true, refusal: null });
    try {
      const view = await transcribePassage(projectId, sourceId, { text, locator });
      set({ state: view.state, events: view.events, record: view.record, busy: false });
      return true;
    } catch (error) {
      set({
        refusal: {
          invariant: error instanceof Refused ? error.invariant : 'upload',
          message: error instanceof Error ? error.message : String(error),
        },
        busy: false,
      });
      return false;
    }
  },

  select: (id) => set({ selected: id, refusal: null }),
  setView: (view) => set({ view }),
  setRole: (role) => set({ role, refusal: null }),
  dismiss: () => set({ refusal: null }),
}));

export const uuid = <T extends string>(): T => crypto.randomUUID() as T;
