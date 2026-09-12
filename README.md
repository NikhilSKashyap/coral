# Coral — Epistemic Research Studio

A research workspace that will not do the student's thinking. The refusal is the
data model and the write path, not a policy in a prompt.

Design sources: the Figma master user flow and the two `.dc.html` studio
prototypes kept in `Visual conflict determines build/`.

## Layout

```
packages/core      domain model, event log, projections, invariants  ← the product
apps/server        Fastify + Postgres; the migration is the same model in SQL
apps/web           React + Vite studio; Geist and the signal red
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
pnpm test                                   # 21 unit tests over the invariants
pnpm --filter @coral/server test:db        # the guards Postgres enforces
pnpm --filter @coral/server test:e2e       # 26 checks over a whole session
```

The end-to-end script drives a full session against a running server: a student
builds a map, a coach offers moves, evidence is created from a passage, a
checkpoint is submitted, an instructor comments, the student revises twice. Lines
marked `REFUSED` must fail, with a 422 and the name of the invariant that stopped
them. A run where everything succeeds is a failing run.

Three things in the interface exist to be tried rather than read:

- **Coach tab → "Let the coach write a thought"** is refused in front of you, and
  names the invariant.
- **Sources tab** returns four papers at different access levels. Two carry a
  retrievable passage and two do not, so the evidence gate can be tried against
  both. A paywalled source becomes usable only after **Upload the paper**.
- **Review tab**, in the instructor seat, shows a comment that survived two
  revisions: *reviewed v1, now v3*, with the text then and the text now.

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
| `POST /projects/:id/search` | fixture literature until real retrieval lands |
| `GET /projects/:id/drift` | how far each commented object has moved since review |

## Slice status

**Done (slice 00).** The model, the log, the guards, the projections, the
migration, the server, and a studio with a map view, a focus view, sources, the
coach ladder, checkpoints and instructor feedback.

**Next.** Slice 01 is the guided framing spine, driven by the static prompt copy
from the v1 prototype with no model in the loop. Slice 02 puts a real coach
behind the buttons that are currently wired to fixed moves.

Known gaps: literature search is a fixture, not retrieval; the Problem Frame
events are recorded but not yet rendered; there is no auth, and the three seats
are fixed rows.
