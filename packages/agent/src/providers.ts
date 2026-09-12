import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { CONSTITUTION, rungInstruction } from './constitution.js';
import { MOVE_SCHEMA, MalformedMove, parseMove, type CoachRequest, type CoachMoveResult } from './move.js';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a local agent binary.
 *
 * stdin is closed rather than left open: these CLIs wait several seconds for
 * piped input before giving up, which would add that delay to every coaching
 * move. Arguments are passed as an array, never through a shell.
 */
function run(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${bin} did not answer within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Coral runs no inference and holds no credential.
 *
 * A provider drives a coding agent the student already installed and signed in
 * on their own machine. The subscription, the token and the quota stay theirs;
 * we send a prompt to a local process and read one JSON object back.
 *
 * This is the reason Coral can ship as a desktop app with no server and no
 * account: there is nothing to bill and nothing to keep secret.
 */
export interface CoachProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Is the underlying tool actually on this machine? */
  available(): Promise<boolean>;
  move(request: CoachRequest): Promise<CoachMoveResult>;
}

export type ProviderId = 'claude-code' | 'codex' | 'static';

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  available: boolean;
  detail: string;
}

/**
 * Resolve a binary on PATH without spawning a shell. Detection runs on every
 * settings screen, and a shell here would be both slower and a needless
 * injection surface.
 */
const which = async (bin: string): Promise<string | null> => {
  const path = process.env['PATH'];
  if (path === undefined) return null;
  for (const dir of path.split(':')) {
    if (dir === '') continue;
    const candidate = join(dir, bin);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
};

/**
 * Environment variables that tell a nested Claude Code it is being run from
 * inside another one. Cleared so the child behaves like a fresh invocation.
 */
const NESTING_VARS = [
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
];

const childEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of NESTING_VARS) delete env[key];
  return env;
};

interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  structured_output?: unknown;
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  permission_denials?: unknown[];
}

export interface ClaudeCodeOptions {
  /** An alias the local CLI understands: opus, sonnet, haiku. */
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
}

/**
 * Drives the student's Claude Code install in print mode.
 *
 * Three flags carry the design:
 *   --json-schema    constrains generation to the closed move set
 *   --system-prompt  replaces the coding-assistant persona outright
 *   --restricted     removes the tools that run commands, so a coaching call
 *                    can never touch the student's machine
 *
 * `--bare` is deliberately not used: it would be cheaper, but it reads only an
 * API key and never the signed-in session, which is exactly the credential we
 * are trying to stay out of the way of.
 */
export class ClaudeCodeProvider implements CoachProvider {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  private readonly options: Required<ClaudeCodeOptions>;

  constructor(options: ClaudeCodeOptions = {}) {
    this.options = {
      model: options.model ?? 'sonnet',
      effort: options.effort ?? 'medium',
      timeoutMs: options.timeoutMs ?? 90_000,
    };
  }

  async available(): Promise<boolean> {
    return (await which('claude')) !== null;
  }

  async move(request: CoachRequest): Promise<CoachMoveResult> {
    const prompt = [
      rungInstruction(request.rung, request.adversarial),
      '',
      'The reasoning as it stands:',
      '',
      request.context,
      '',
      'Return one move.',
    ].join('\n');

    const args = [
      '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(MOVE_SCHEMA),
      '--system-prompt', CONSTITUTION,
      '--restricted',
      // Not 1: the model needs a turn to think and another to emit the
      // structured result, and a tight cap makes it exit non-zero with prose
      // instead. The constitution asks for one move; this is only a runaway stop.
      '--max-turns', '6',
      '--model', this.options.model,
      '--effort', this.options.effort,
      prompt,
    ];

    const { code, stdout, stderr } = await run('claude', args, this.options.timeoutMs);
    if (code !== 0) {
      // Surface what the CLI actually said, not Node's echo of the command line.
      const detail = (stderr.trim() || stdout.trim()).split('\n').slice(-3).join(' ');
      throw new Error(`Claude Code exited ${String(code)}: ${detail.slice(0, 300)}`);
    }

    let envelope: ClaudeResult;
    try {
      envelope = JSON.parse(stdout) as ClaudeResult;
    } catch {
      throw new MalformedMove(stdout.slice(0, 400), 'the CLI did not return JSON');
    }
    if (envelope.is_error === true) {
      throw new Error(`Claude Code reported an error: ${envelope.result ?? envelope.subtype ?? 'unknown'}`);
    }

    const payload = envelope.structured_output ?? safeParse(envelope.result);
    return parseMove(payload);
  }
}

const safeParse = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Drives the student's Codex install.
 *
 * Codex was not present on the machine this was written on, so the invocation
 * below is unverified. Detection is honest about that: the provider reports
 * itself unavailable unless the binary exists, and a failed call falls back to
 * the static coach rather than pretending.
 */
export class CodexProvider implements CoachProvider {
  readonly id = 'codex' as const;
  readonly label = 'Codex';

  async available(): Promise<boolean> {
    return (await which('codex')) !== null;
  }

  async move(request: CoachRequest): Promise<CoachMoveResult> {
    const prompt = [
      CONSTITUTION,
      '',
      rungInstruction(request.rung, request.adversarial),
      '',
      'Reply with one JSON object and nothing else, matching this schema:',
      JSON.stringify(MOVE_SCHEMA),
      '',
      'The reasoning as it stands:',
      '',
      request.context,
    ].join('\n');

    const { code, stdout, stderr } = await run('codex', ['exec', '--json', prompt], 90_000);
    if (code !== 0) {
      const detail = (stderr.trim() || stdout.trim()).split('\n').slice(-3).join(' ');
      throw new Error(`Codex exited ${String(code)}: ${detail.slice(0, 300)}`);
    }
    return parseMove(extractJson(stdout));
  }
}

/** Pulls the last JSON object out of a noisy stream. */
function extractJson(text: string): unknown {
  const start = text.lastIndexOf('{');
  if (start < 0) throw new MalformedMove(text.slice(0, 400), 'no JSON object in the output');
  for (let end = text.length; end > start; end -= 1) {
    const slice = text.slice(start, end);
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      continue;
    }
  }
  throw new MalformedMove(text.slice(0, 400), 'could not parse a JSON object');
}

/**
 * The coach with no model behind it.
 *
 * This is not a degraded mode bolted on for errors. It is the slice-01 ladder,
 * and it is the reason Coral works on a laptop with nothing installed, on a
 * plane, and when someone's quota has run out. Every other provider falls back
 * to it.
 */
export class StaticProvider implements CoachProvider {
  readonly id = 'static' as const;
  readonly label = 'Built-in ladder';

  async available(): Promise<boolean> {
    return true;
  }

  async move(request: CoachRequest): Promise<CoachMoveResult> {
    const type = /type:\s*([A-Z]+)/.exec(request.context)?.[1] ?? 'DEFAULT';
    const rung = LADDER[type] ?? LADDER['DEFAULT'] ?? [];
    const step = rung[request.rung] ?? rung[rung.length - 1];
    if (request.adversarial) {
      const objection = CHALLENGES[type] ?? CHALLENGES['DEFAULT'];
      return { kind: 'challenge', body: objection ?? 'What would have to be true for the opposite to hold?' };
    }
    return step ?? { kind: 'ask', body: 'What follows from this?' };
  }
}

const LADDER: Record<string, CoachMoveResult[]> = {
  NOTICE: [
    { kind: 'reflect', body: 'You are recording something you saw rather than explaining it, which is the right order.' },
    { kind: 'ask', body: 'What about this did you not expect?' },
    { kind: 'offer_structure', body: 'Separate the event you observed from your explanation of it. Only the event belongs in a notice.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: I noticed that ___, which I did not expect because ___.' },
  ],
  WONDER: [
    { kind: 'reflect', body: 'That reads as an open question rather than a conclusion.' },
    { kind: 'ask', body: 'Which two things here are hard to hold together?' },
    { kind: 'offer_structure', body: 'A wonder becomes useful when it names two claims that resist each other.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: I wonder whether ___ actually means ___.' },
  ],
  TENSION: [
    { kind: 'reflect', body: 'You are holding a visible gain against a possible hidden cost.' },
    { kind: 'ask', body: 'Which of the two would you notice first if you were wrong?' },
    { kind: 'offer_structure', body: 'A tension holds two claims that are both plausible and hard to reconcile. Name each one separately.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: Although ___, ___.' },
  ],
  UNKNOWN: [
    { kind: 'reflect', body: 'This is a gap evidence could close, not a topic.' },
    { kind: 'ask', body: 'What observation would tell those two possibilities apart?' },
    { kind: 'offer_structure', body: 'An unknown names a population and an activity, not a subject area.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: It is not yet known whether ___ can ___ without ___.' },
  ],
  QUESTION: [
    { kind: 'reflect', body: 'This is a first version. Some of its terms still carry more than one meaning.' },
    { kind: 'ask', body: 'Which term here would two readers define differently?' },
    { kind: 'offer_structure', body: 'A researchable question names who you are studying, what is uncertain, and under what conditions.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: For ___, how does ___ affect ___ during ___?' },
  ],
  EVIDENCE: [
    { kind: 'reflect', body: 'The finding is the paper’s. The inference is yours.' },
    { kind: 'ask', body: 'What does this let you claim, and what does it not?' },
    { kind: 'offer_structure', body: 'A warrant states the step from finding to claim. Write the step, not the finding again.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: This shows ___, which licenses ___ but not ___.' },
  ],
  DEFAULT: [
    { kind: 'reflect', body: 'This thought is yours to develop.' },
    { kind: 'ask', body: 'What follows from it?' },
    { kind: 'offer_structure', body: 'Say what it commits you to, and what it rules out.' },
    { kind: 'offer_sentence_frame', body: 'Try completing: If this holds, then ___, which means ___.' },
  ],
};

const CHALLENGES: Record<string, string> = {
  NOTICE: 'You are treating speed as the salient feature of what you saw. What else changed at the same time that you did not record?',
  TENSION: 'What alternative explanation could produce the same observation without the tension being real?',
  QUESTION: 'Your question assumes the effect runs in one direction. What would it look like if it ran the other way?',
  EVIDENCE: 'A reader could accept the finding and still reject your claim. On what grounds?',
  DEFAULT: 'What would someone have to believe to disagree with you?',
};
