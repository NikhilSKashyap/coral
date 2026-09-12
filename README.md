# Coral — Epistemic Research Studio

A research workspace that will not do the student's thinking. The refusal is the
data model and the write path, not a policy in a prompt.

Design sources: the Figma master user flow and the two `.dc.html` studio
prototypes kept in `Visual conflict determines build/`.

## Layout

```
packages/core      domain model, event log, projections, invariants  ← the product
packages/agent     drives the coding agent you already signed in to
apps/server        Fastify + Postgres; the migration is the same model in SQL
apps/web           React + Vite studio; Geist and the signal red
apps/desktop       Tauri shell
```

`packages/core` has no dependencies and no I/O. The browser and the server run
the same guards over the same events, so a write refused in one is refused
identically in the other.

## Running it

```bash
pnpm install
pnpm db:up                                  # postgres 16 on localhost:5433
pnpm db:migrate
pnpm dev                                    # server on :8787, studio on :5173
```

Open http://localhost:5173, press **New question**, and build a map.

## Testing it

```bash
pnpm test                                   # 69 unit tests: 45 over the invariants, 24 over the agent boundary
pnpm --filter @coral/server test:db        # the five guards Postgres enforces
pnpm --filter @coral/server test:e2e       # 71 checks over a whole session
```

The end-to-end script drives a full session against a running server: a student
walks the framing spine, builds a map, a coach offers moves, evidence is created
from a passage, a checkpoint is submitted, an instructor comments, the student
revises twice. Lines marked `REFUSED` must fail, with a 422 and the name of the
invariant that stopped them. A run where everything succeeds is a failing run.

Four things in the interface exist to be tried rather than read:

- **Coach tab → "Let the coach write a thought"** is refused in front of you, and
  names the invariant.
- **Coach tab → "Argue with this thought"** produces an objection and leaves it
  **on the table**. The only button that clears it is *Write it myself*, and it
  stays disabled until you have written something.
- **Sources tab** returns four papers at different access levels. Two carry a
  retrievable passage and two do not, so the evidence gate can be tried against
  both. A paywalled source becomes usable only after **Upload the paper**.
- **Review tab**, in the instructor seat, shows a comment that survived two
  revisions: *reviewed v1, now v3*, with the text then and the text now.

## The framing walk

Press **New question** and the studio opens on **Frame**, not on the map. Five
stages, one at a time: what you noticed, what you wonder, what is in tension,
what is unknown, and only then the question. Each one is an ordinary thought,
wired to the stage before it with an ordinary relation, so the walk and the map
are one graph rendered two ways — accept the frame and the same five nodes are
sitting on the canvas.

Every word the coach says here is the v1 prototype's copy, read out of
`SPINE` in `packages/core/src/spine.ts`. No model runs. That is the point of the
slice: the ladder either teaches before it costs anything, or it does not teach.

- Writing a stage is one request. The server appends the thought, the relation,
  a rung-one reflection on what you wrote, and the handoff question that opens
  the next stage — so `promptedBy` chains the walk and every coach utterance is
  in the log.
- **More help** climbs one rung: a reflection, a question, a structure, and only
  then a sentence frame. The button relabels itself at the last rung and then
  says *No further help*. `assertHintLadder` refuses a jump, so rung four cannot
  be reached without passing through the other three.
- The stage order is checked server-side against the walk's own position. A
  client that asks to start at `QUESTION` gets a 422 naming `spine.order`.
- At the question, **What you have established** lists your four earlier stages
  under their labels and stops. Assembling them into a sentence is the step the
  product refuses to take.
- The **Problem Frame** is a template fill over objects that already exist. The
  question is your thought word for word, and a refinement prompt you did not
  answer stays a gap rather than becoming prose.

## The coach suggests a kind of thought; you write the sentence

Two of the eight moves leave something to act on, and both go through the same
gate. `propose_branch` names a type of thought that might come next.
`challenge` states an objection — the one move where the prose is the coach's,
because an objection is something to argue with rather than something you wrote.

Either way the result is a **proposal**, and a proposal is not a node. It sits
open in the Coach tab under *On the table* until you rule on it:

- **Write it myself** takes your sentence and your choice of relation, creates
  the thought under your name, and closes the proposal. The type came from the
  coach; every word came from you. The new thought records which move prompted
  it, so the map can show where a branch came from.
- **Not this** records the decision. Nothing is deleted, and the instructor's
  panel counts proposals raised against accepted and dismissed — which is an
  observable of judgment being exercised, not of compliance.

There is no route on the server that turns a proposal into a thought without
text arriving from the student in the same request. Accepting with an empty
body is a 422 naming `iii.proposal`, as is accepting twice, accepting one that
was dismissed, or picking a relation outside the eight.

That is also what makes a challenge answerable. An objection that can only be
read in a thread is a remark; here it becomes a CHALLENGE node wired to the
thought it contests, so several competing objections can sit on one claim at
once and none of them is a mode the project is in.

## The coach runs on your own subscription

Coral holds no API key, runs no inference, and has no account. When you ask for a
coaching move it drives a coding agent already installed and signed in on your
machine — Claude Code, or Codex — as a subprocess, and reads one JSON object
back. The credential, the quota and the bill stay entirely yours.

Three flags carry the design on the Claude Code adapter: `--json-schema`
constrains generation to a closed set of moves, `--system-prompt` replaces the
coding-assistant persona with the coach's, and `--restricted` removes the tools
that run commands, so a coaching call can never touch your files. `--bare` is
deliberately avoided: it is cheaper but reads only an API key and never your
signed-in session.

Nothing that comes back is trusted. A returned move is validated against the
closed set and then written through the same guarded append as every other
event, so a local model that returns something out of bounds is refused exactly
as a hand-rolled request would be.

If no agent is installed, the session expires, the quota runs out or the reply is
malformed, the built-in ladder answers instead. It is the slice-01 coach with no
model behind it, and it means Coral works offline and on a machine with nothing
installed.

```bash
pnpm --filter @coral/agent probe            # the ladder, free
pnpm --filter @coral/agent probe -- --live  # also calls your agent, spends your quota
curl localhost:8787/providers               # what this machine can run
```

## The model in one paragraph

The `event` table is the source of truth. Everything else — current state,
version history, the coach thread, the instructor's panel — is a projection of
it, produced by replaying the log. Identity and version are two different
columns: an `object_id` is permanent and a `version_id` names one revision of it,
so a checkpoint can freeze an `(object_id, version_id)` pair without cloning
anything, and an instructor comment stays attached to a claim the student keeps
editing while still pointing at the version that was read.

## What the write path refuses

Each guard lives in `packages/core/src/invariants.ts` and has a test.

| # | Invariant | Where it is enforced |
|---|---|---|
| i | The coach never writes thought text | `assertAuthorship`, plus a `check` constraint on `thought_version` |
| ii | Evidence needs real text and a written interpretation | `assertEvidenceGate`, plus the `enforce_evidence_gate` trigger |
| iii | A detected claim is a proposal until a student accepts it | `assertProposalNotAutoAccepted` |
| iv | A checkpoint freezes pairs and mints no second identity | `assertSnapshotIdentity`, `assertCommentTarget`, composite FK |
| v | Support escalates one rung at a time, on request | `assertHintLadder` |
| vi | Nothing is overwritten and nothing is deleted | `assertStableIdentity`, `append_only_guard` trigger |
| vii | The coach describes the work, never the worker | no event type records an assessment; asserted by test |

The coach's one licence to write prose is a `challenge` move. That is an
objection to argue with, not the student's thought.

## Vocabulary

Twelve thought types, eight relations, four source access levels. All three lists
live in `packages/core/src/types.ts` and are served from `/vocabulary`, so the
client cannot drift from the server.

Sources are surfaced at every access level. Only `open_full_text` and
`user_upload` carry a passage, and only a passage can back an Evidence object.
There is no passage provenance meaning "generated", so the failure mode where the
system implies text it never retrieved has nowhere to live.

## API

| | |
|---|---|
| `GET /vocabulary` | the three lists above |
| `GET /projects` | every project with an event count |
| `POST /projects` | create one |
| `GET /projects/:id` | replayed state, the event log, the observable record |
| `POST /projects/:id/events` | the only write path; 422 carries the invariant name |
| `POST /projects/:id/spine` | one stage of the framing walk, with its relation and its two coach moves |
| `POST /projects/:id/frame` | assemble the Problem Frame from existing objects |
| `POST /projects/:id/coach` | one move from the student's own agent, written through the guards |
| `POST /projects/:id/proposals/:pid/accept` | the student writes the thought a proposal stands for |
| `POST /projects/:id/proposals/:pid/dismiss` | decline it, on the record |
| `POST /projects/:id/search` | fixture literature until real retrieval lands |
| `GET /projects/:id/drift` | how far each commented object has moved since review |

## Slice status

**Done (slice 00).** The model, the log, the guards, the projections, the
migration, the server, and a studio with a map view, a focus view, sources, the
coach ladder, checkpoints and instructor feedback.

**Done (slice 01).** The guided framing spine: five stages, the escalating
ladder, the established-pieces list, and the Problem Frame drafted and accepted.
The copy is the v1 prototype's and no model is in the loop, so the pedagogy can
be put in front of a student before a single call is paid for. The static ladder
the agent falls back to now reads the same `SPINE` table, so there is one copy of
the hints rather than two that drift.

**Done (slice 02).** The coach under constraint. The prompt now carries what a
thought type is *for* and which stage the walk owes next, both read from `SPINE`,
so a move lands on the thing the stage exists to teach. The framing ladder is no
longer pinned to the built-in copy: it uses whichever provider is selected, and
says which one and who is paying. Proposals got the path they were missing —
`propose_branch` and `challenge` both raise one, and the only way through it is
the student writing the sentence.

The slice's claim is that the model cannot write a student's thought even when
asked, and it is tests rather than prompt text: 24 of them over the agent
boundary, asserting that the schema has no field a thought could arrive in, that
fields outside it are dropped rather than passed through, that a reply cannot
talk its way into a rung, and that a provider which errors, returns nonsense or
is missing lands on the ladder instead of on the student.

**Next.** Slice 03 replaces the literature fixture with retrieval — OpenAlex,
Semantic Scholar, Crossref and Unpaywall — and ships PDF upload with it, since
the evidence gate blocks paywalled work without it.

Known gaps: literature search is a fixture, not retrieval; there is no auth, and
the three seats are fixed rows. The Codex adapter is written but still
unverified, since Codex is not installed here.
