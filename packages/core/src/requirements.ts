import type { ObjectId } from './ids.js';
import { liveThoughts, thoughtsOfType } from './selectors.js';
import type { ProjectState } from './types.js';

/**
 * What an assignment asks for, and whether the map shows it.
 *
 * Every check here is a count off the graph, which is the same discipline as
 * the instructor's panel: it reports what is there, not whether it is any good.
 * "Two sources cited" is a fact. "Well sourced" would be a grade, and grading is
 * out of scope for the MVP entirely.
 *
 * An assignment lives in SQL rather than in a project's event log. The log is
 * the record of one student's reasoning; an assignment exists before any project
 * does and spans several, so the link runs the other way — a checkpoint names
 * the assignment it answers.
 */

export interface Requirements {
  /** Minimum number of distinct sources actually cited as evidence. */
  sources: number;
  /** At least one challenge or alternative on the map. */
  counterArgument: boolean;
  /** The provenance record must accompany the submission. */
  aiProvenance: boolean;
}

export const NO_REQUIREMENTS: Requirements = {
  sources: 0,
  counterArgument: false,
  aiProvenance: true,
};

export type RequirementId = 'sources' | 'counter_argument' | 'ai_provenance';

export interface RequirementCheck {
  id: RequirementId;
  label: string;
  met: boolean;
  /** What the log actually shows. A count, never a verdict. */
  detail: string;
  /** The objects behind the number, so every figure can be opened. */
  objectIds: ObjectId[];
}

export function checkRequirements(
  state: ProjectState,
  requirements: Requirements,
): RequirementCheck[] {
  const checks: RequirementCheck[] = [];

  if (requirements.sources > 0) {
    const citing = liveThoughts(state).filter((t) => t.evidence !== undefined);
    const distinct = new Set(citing.map((t) => t.evidence?.sourceId));
    checks.push({
      id: 'sources',
      label: `Cite at least ${String(requirements.sources)} source${requirements.sources === 1 ? '' : 's'}`,
      met: distinct.size >= requirements.sources,
      detail: `${String(distinct.size)} cited as evidence`
        + `, ${String(Object.keys(state.sources).length)} on the list`,
      objectIds: citing.map((t) => t.objectId),
    });
  }

  if (requirements.counterArgument) {
    const counters = [
      ...thoughtsOfType(state, 'CHALLENGE'),
      ...thoughtsOfType(state, 'ALTERNATIVE'),
    ];
    checks.push({
      id: 'counter_argument',
      label: 'Explore at least one counter-argument',
      met: counters.length > 0,
      detail: counters.length === 0
        ? 'none on the map'
        : `${String(counters.length)} on the map`,
      objectIds: counters.map((t) => t.objectId),
    });
  }

  if (requirements.aiProvenance) {
    /**
     * This one is met structurally, and saying so is the honest answer.
     *
     * Coral records the coach move that preceded every write as it happens, so
     * there is no version of this project in which a student forgot to declare
     * AI use. The number below is not a hurdle they cleared; it is what the log
     * already holds, and an instructor can open every one of them.
     */
     const prompted = Object.values(state.versions)
       .flat()
       .filter((v) => v.promptedBy !== null);
    checks.push({
      id: 'ai_provenance',
      label: 'Submit the AI provenance record',
      met: true,
      detail: prompted.length === 0
        ? 'nothing here was written after a coach move'
        : `${String(prompted.length)} version${prompted.length === 1 ? '' : 's'} record the move that prompted them`,
      objectIds: [...new Set(prompted.map((v) => v.objectId))],
    });
  }

  return checks;
}

export const requirementsMet = (checks: readonly RequirementCheck[]): boolean =>
  checks.every((check) => check.met);

/** The ones still outstanding, for an interface that wants to say what is left. */
export const outstanding = (checks: readonly RequirementCheck[]): RequirementCheck[] =>
  checks.filter((check) => !check.met);
