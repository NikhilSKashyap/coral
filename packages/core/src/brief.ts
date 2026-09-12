import { structuralGaps, synthesisOpening, type Gap } from './gaps.js';
import type { ObjectId, SourceId } from './ids.js';
import { childrenOf, liveThoughts, parentsOf, thoughtsOfType } from './selectors.js';
import type { ProjectState, StructuralFlag, Thought, ThoughtType } from './types.js';

/**
 * The Reasoning Brief.
 *
 * Invariant iv in one module: assembled, never generated. Every line below is a
 * string that already exists somewhere in the project — a thought the student
 * wrote, a passage that was retrieved, a citation from a source record. There is
 * no step in this file that composes a sentence.
 *
 * What the template contributes is headings, ordering, and the honest admission
 * of absence. A section with nothing behind it renders as a gap with a prompt
 * saying what would close it, rather than as prose covering for the hole. That
 * is the whole difference between a brief a student can defend line by line and
 * a summary that reads well and answers for nothing.
 */

export type BriefSectionId =
  | 'question' | 'framing' | 'claims' | 'challenges'
  | 'alternatives' | 'synthesis' | 'sources';

/** A line of the brief, and the object it came from. */
export interface BriefLine {
  /** Null only for a source line, which cites a source rather than a thought. */
  objectId: ObjectId | null;
  sourceId: SourceId | null;
  type: ThoughtType | null;
  /** Verbatim from the project. Never composed here. */
  text: string;
  /** A label the template supplies, such as "evidence" or "warrant". */
  role: string | null;
  children: BriefLine[];
  flags: StructuralFlag[];
}

export interface BriefSection {
  id: BriefSectionId;
  title: string;
  lines: BriefLine[];
  /** True when nothing backs this section. The prompt is shown instead. */
  gap: boolean;
  /** What the student would have to do to close it. */
  gapPrompt: string;
}

export interface Brief {
  title: string;
  /** The research question, verbatim, or null if there is not one yet. */
  question: string | null;
  sections: BriefSection[];
  gaps: Gap[];
  /** Openings are not failings: things worth doing, not things done wrong. */
  synthesisOpening: boolean;
  /** Every object the brief cites, so an interface can prove nothing was invented. */
  cited: ObjectId[];
}

const line = (
  thought: Thought,
  extra: Partial<BriefLine> = {},
): BriefLine => ({
  objectId: thought.objectId,
  sourceId: null,
  type: thought.type,
  text: thought.text,
  role: null,
  children: [],
  flags: [],
  ...extra,
});

const oldestFirst = (a: Thought, b: Thought): number =>
  a.createdAt.localeCompare(b.createdAt);

export function assembleBrief(state: ProjectState): Brief {
  const gaps = structuralGaps(state);
  const flagsFor = (objectId: ObjectId): StructuralFlag[] =>
    gaps.filter((g) => g.objectIds.includes(objectId)).map((g) => g.flag);

  const question = thoughtsOfType(state, 'QUESTION').sort(oldestFirst)[0];

  /* --- the question ------------------------------------------------- */
  const questionSection: BriefSection = {
    id: 'question',
    title: 'The question',
    lines: question === undefined ? [] : [line(question, { flags: flagsFor(question.objectId) })],
    gap: question === undefined,
    gapPrompt: 'There is no question yet. Write one on the framing walk.',
  };

  /* --- how the question was arrived at ------------------------------- */
  const framing = (['NOTICE', 'WONDER', 'TENSION', 'UNKNOWN'] as const)
    .flatMap((type) => thoughtsOfType(state, type).sort(oldestFirst).slice(0, 1))
    .map((t) => line(t, { role: t.type.toLowerCase() }));

  const framingSection: BriefSection = {
    id: 'framing',
    title: 'How the question was arrived at',
    lines: framing,
    gap: framing.length === 0,
    gapPrompt: 'Nothing records how you got to the question. The framing walk keeps that record.',
  };

  /* --- claims, each with what supports it ---------------------------- */
  const claims = thoughtsOfType(state, 'CLAIM').sort(oldestFirst).map((claim) => {
    // Evidence is an EVIDENCE thought joined to the claim by `supports`. The
    // student's interpretation and warrant are their own words about a passage
    // we actually hold, so both are quotable here.
    const support = parentsOf(state, claim.objectId)
      .filter((edge) => edge.relation === 'supports')
      .map((edge) => state.thoughts[edge.from])
      .filter((t): t is Thought => t !== undefined && t.type === 'EVIDENCE' && !t.archived)
      .flatMap((evidence): BriefLine[] => {
        const body = evidence.evidence;
        if (body === undefined) return [line(evidence, { role: 'evidence' })];
        const source = state.sources[body.sourceId];
        const passage = state.passages[body.passageId];
        return [{
          objectId: evidence.objectId,
          sourceId: body.sourceId,
          type: 'EVIDENCE',
          text: passage?.text ?? evidence.text,
          role: source === undefined ? 'passage' : `passage — ${source.cite}`,
          flags: [],
          children: [
            {
              objectId: evidence.objectId, sourceId: null, type: null,
              text: body.interpretation, role: 'your reading', children: [], flags: [],
            },
            {
              objectId: evidence.objectId, sourceId: null, type: null,
              text: body.warrant, role: 'what it licenses', children: [], flags: [],
            },
          ],
        }];
      });

    return line(claim, { children: support, flags: flagsFor(claim.objectId) });
  });

  const claimsSection: BriefSection = {
    id: 'claims',
    title: 'What I claim, and what supports it',
    lines: claims,
    gap: claims.length === 0,
    gapPrompt: 'No claims yet. A claim asserts something that evidence could settle.',
  };

  /* --- objections, and whether they were answered -------------------- */
  const challenges = thoughtsOfType(state, 'CHALLENGE').sort(oldestFirst).map((challenge) => {
    const answers = childrenOf(state, challenge.objectId)
      .map((edge) => state.thoughts[edge.to])
      .filter((t): t is Thought => t !== undefined && !t.archived)
      .map((t) => line(t, { role: 'answered by' }));
    return line(challenge, { children: answers, flags: flagsFor(challenge.objectId) });
  });

  const challengesSection: BriefSection = {
    id: 'challenges',
    title: 'Objections raised against this',
    lines: challenges,
    gap: challenges.length === 0,
    gapPrompt: 'No objections recorded. Ask the coach to argue with a claim.',
  };

  /* --- alternatives considered --------------------------------------- */
  const alternatives = thoughtsOfType(state, 'ALTERNATIVE').sort(oldestFirst).map((t) => line(t));
  const alternativesSection: BriefSection = {
    id: 'alternatives',
    title: 'Alternatives considered',
    lines: alternatives,
    gap: alternatives.length === 0,
    gapPrompt: 'No alternative explanations recorded.',
  };

  /* --- synthesis ------------------------------------------------------ */
  const synthesis = thoughtsOfType(state, 'SYNTHESIS').sort(oldestFirst).map((t) => line(t));
  const synthesisSection: BriefSection = {
    id: 'synthesis',
    title: 'Where this leaves me',
    lines: synthesis,
    gap: synthesis.length === 0,
    gapPrompt: 'No synthesis yet. This is the section only you can write.',
  };

  /* --- what was read, and what was used ------------------------------- */
  const cited = new Set(
    Object.values(state.thoughts)
      .map((t) => t.evidence?.sourceId)
      .filter((id): id is SourceId => id !== undefined),
  );
  const sources: BriefLine[] = Object.values(state.sources)
    .filter((s) => s.saved || cited.has(s.sourceId))
    .map((source) => ({
      objectId: null,
      sourceId: source.sourceId,
      type: null,
      text: source.cite,
      role: cited.has(source.sourceId) ? 'cited' : 'saved, not cited',
      children: [],
      flags: cited.has(source.sourceId) ? [] : ['source_saved_never_cited'],
    }));

  const sourcesSection: BriefSection = {
    id: 'sources',
    title: 'Sources',
    lines: sources,
    gap: sources.length === 0,
    gapPrompt: 'No sources saved. Search the literature from the Sources tab.',
  };

  const sections = [
    questionSection, framingSection, claimsSection,
    challengesSection, alternativesSection, synthesisSection, sourcesSection,
  ];

  return {
    title: state.title,
    question: question?.text ?? null,
    sections,
    gaps,
    synthesisOpening: synthesisOpening(state) !== null,
    cited: [...new Set(collectIds(sections))],
  };
}

function collectIds(sections: readonly BriefSection[]): ObjectId[] {
  const out: ObjectId[] = [];
  const walk = (lines: readonly BriefLine[]): void => {
    for (const l of lines) {
      if (l.objectId !== null) out.push(l.objectId);
      walk(l.children);
    }
  };
  for (const section of sections) walk(section.lines);
  return out;
}

/** Sections with nothing behind them. What the student has left to close. */
export const briefGaps = (brief: Brief): BriefSection[] =>
  brief.sections.filter((s) => s.gap);

/**
 * Is this brief ready to submit?
 *
 * Only the two sections nothing else can stand in for. Objections and
 * alternatives being empty is a thin brief, not an incomplete one, and the
 * product does not grade thinness.
 */
export const briefIsAnswerable = (brief: Brief): boolean =>
  !brief.sections.some((s) => (s.id === 'question' || s.id === 'claims') && s.gap);

/** Every live thought the brief left out, so nothing silently vanishes. */
export function omittedFrom(state: ProjectState, brief: Brief): Thought[] {
  const cited = new Set<string>(brief.cited);
  return liveThoughts(state).filter((t) => !cited.has(t.objectId));
}
