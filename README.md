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
pnpm test                                   # 154 unit tests: 111 over the invariants, 43 over the agent boundary
pnpm --filter @coral/server test:db        # the five guards Postgres enforces
pnpm --filter @coral/server test:e2e       # 124 checks over a whole session
pnpm --filter @coral/server probe "a query" # what retrieval returns, and at what level
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
- **Sources tab** searches the real literature and shows the access level on
  every result. Most arrive at `abstract`, so the gate is closed until you
  **Upload the paper** or **Type a passage**. Dropping a scan with no text layer
  is refused rather than promoted, which is the gate's whole point.
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

## A comment is closed by a revision, not by agreeing with it

The instructor marks a thought for revision against the version a checkpoint
froze. The student revises; the comment stays attached to the object and keeps
pointing at what was read, so *reviewed v1, now v6* comes with the words that
moved rather than a count.

Closing it is the loop, and the loop is guarded. `assertResolutionRevises`
refuses a student's resolution that names a version the instructor had already
seen — without that, "resolve" is a dismiss button and the panel shows feedback
addressed that nothing addressed. An instructor may close anything at any
version, because judging whether an objection has been met is exactly their job,
and sometimes the answer arrives as a new object rather than a new version of the
old one.

## Assignments ask for counts, never for a grade

An assignment is not an event in any project's log. The log records one
student's reasoning; an assignment exists before a project does and spans
several, so it is an ordinary row, and the link runs the other way — a
checkpoint names the assignment it answers.

It can require a number of cited sources and a counter-argument. Every check
reports what the map shows:

```
[ ] Cite at least 2 sources                0 cited as evidence, 3 on the list
[ ] Explore at least one counter-argument  none on the map
[x] Submit the AI provenance record        14 versions record the move that prompted them
```

The third is met structurally and says so. Coral records the coach move that
preceded every write as it happens, so there is no version of a project in which
a student forgot to declare AI use — it is not a hurdle they cleared, it is what
the log already holds, and every one of those versions can be opened.

There is nowhere in any of this to enter a mark.

## The brief is assembled, never generated

The **Brief** tab is the thing a student submits, and every line in it is a
string the project already holds: a thought they wrote, a passage that was
retrieved, a citation from a source record. There is no step anywhere in
`assembleBrief` that composes a sentence.

What the template contributes is headings, order, and the admission of absence.
A section with nothing behind it renders dashed and open, showing what would
close it rather than prose covering the hole:

```
WHERE THIS LEAVES ME                                    open
No synthesis yet. This is the section only you can write.
```

That is the whole difference between a brief that is defensible line by line and
a summary that reads well and answers for nothing. Every line links through to
the object it came from, so the claim can be checked rather than taken on trust,
and anything on the map the brief left out is listed at the end — nothing
vanishes quietly.

The test that holds this up collects every string in an assembled brief and
asserts each one is findable in the project state. Prose written by the server
fails it.

## What is missing, and what is in tension

**What is missing or in tension?** looks over the whole map. It has two halves,
and the difference between them matters.

Most gaps are facts about the structure — a claim with no evidence, an objection
nobody answered, a source saved and never cited, a question rewritten past the
work behind it. The graph proves every one, so they cost nothing and cannot be
wrong the way a model can. They live in `packages/core/src/gaps.ts` and the
coach, the scan and the brief all read the same list.

**Contradiction is the exception.** Whether two claims resist each other is a
question about what they mean, so it needs reading. There is deliberately no
built-in fallback for it: a keyword heuristic guessing at contradiction would
produce exactly the confident nonsense this product exists to avoid, so with no
agent installed the scan reports that it could not look.

Everything found is written as a `flag` move, which names the work and stops. A
flag never picks a winner between two claims, never writes the synthesis, and
never counts as a rung — it answers nothing the student asked for, so it cannot
advance the ladder. A gap already flagged is not flagged again.

## A detected claim is a reading, not a rewrite

Press **Which of these read as claims?** and the coach looks over the thoughts
you have written and says which ones are already doing a claim's work: asserting
something that could be disagreed with and would need evidence to hold up.

It raises proposals and stops. Accepting one **retypes your own thought** — the
same object, one version later, now a claim. The words do not change unless you
change them, which is why the accept button says *Yes, it's a claim* rather than
asking you to write anything. *Revise it first* lets you sharpen the sentence in
the same breath; the revision and the retype are separate versions, so the record
shows both.

A coach cannot do this. `thought.retyped` is a student-authored event, because
changing what a thought *is* changes what you are committed to — invariant i
wearing a different hat. Detection that has already been ruled on is never
raised again, so pressing the button twice does not nag.

This is the cheap, high-frequency half of the coach, so it runs on the smallest
model available — `haiku` on the Claude Code adapter, against a schema that
points at a numbered row rather than naming an object id. A model cannot invent
a row that resolves to something real, and the schema carries no text anywhere,
so detection cannot smuggle in a claim of its own. With no agent installed, a
deliberately shy built-in reading answers instead: it flags an idea that states
something, and misses plenty, which is the right trade when a false positive
costs the student attention.

## Version history is a record, not clutter

Splitting identity from version bought a promise the interface owed from slice
00, and this is where it is paid. A thought's history shows **what moved**, not a
list of whole sentences: a word-level diff with removals struck through, the
counts that summarise it, and the coach move that prompted the revision where
there was one.

```
CLAIM v3 · retyped     +0 −0     Same words, new type.
IDEA v2                +3 −1     …hypotheses graduate students try. try unaided.
                                 after the coach ask: Which students, and narrows compared with what?
IDEA v1            first version  Early AI assistance narrows the range of hypotheses students try.
```

The instructor's panel uses the same diff for the comparison a comment has always
owed the student: not *3 revisions since* but the words that moved between the
version that was read and the one that is live.

## A source is not evidence

Search is real: OpenAlex, no key and no email, with the four fixture papers as
the floor when the network is not there. The response says which answered.

The whole slice turns on one distinction. A result can be open access *somewhere*
and still not be a paper we can quote — the publisher link may refuse us, and a
landing page is not a passage. So the access level is **derived from what we
hold**, in `accessFrom`, and the structure it reads has no field for "is open
access", "has a PDF url", or "full text is offered". The only thing that earns
`open_full_text` is characters in hand.

In practice that means most results arrive at `abstract`, and the probe prints
the number that makes it concrete:

```
levels: {"abstract":8}
offered but not held: 8
```

Eight papers whose publishers offer full text; none of them promoted. Set `OPENALEX_API_KEY` in `.env` (free, from openalex.org/users) and OpenAlex's
own structured text becomes reachable, so a passage arrives with the section
heading it sat under — which is what makes a locator findable again.

```bash
cp -n .env.example .env
printf 'OPENALEX_API_KEY=%s\n' 'your-key' >> .env
```

The server loads `.env` with `--env-file-if-exists`, so a clone without one still
starts and simply never claims `open_full_text`. With a key set, the same query
reads:

```
levels: {"open_full_text":5,"abstract":1}
offered but not held: 0
```

The one that stayed at `abstract` is the one OpenAlex holds no text for.

The passage a search captures is the first quotable paragraph under a section
heading — front matter, bylines and mid-sentence fragments are skipped. It is a
starting point rather than the quote the student wants, and picking the passage
properly belongs to them; **Type a passage** already covers that case.

**Two ways past the gate, and both are the student's.** *Upload the paper* takes
a PDF as its own bytes, extracts the text, and promotes the source. A file that
is not a PDF, or a scan with no text layer, is refused with `ii.evidence` and the
level does not move — a source at `user_upload` carrying no text would be a hole
straight through the invariant. *Type a passage* is the honest path for a library
book or a PDF that will not extract: it is recorded as `student_transcribed`,
never as something retrieved, and it asks for a locator because a quote nobody
can find again is not much better than one that was invented.

There is still no passage provenance meaning "generated".

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
| `POST /projects/:id/detect` | which of the student's thoughts already read as claims |
| `POST /projects/:id/scan` | gaps the graph can prove, plus contradictions if a model can look |
| `GET /projects/:id/brief` | the Reasoning Brief, assembled from existing objects |
| `GET` `POST /assignments` | list and author assignments |
| `GET /dashboard` | progress at checkpoint level, each project against its own assignment |
| `POST /projects/:id/assignment` | point a project at an assignment |
| `POST /projects/:id/proposals/:pid/accept` | the student writes the thought a proposal stands for |
| `POST /projects/:id/proposals/:pid/dismiss` | decline it, on the record |
| `POST /projects/:id/search` | OpenAlex, with the fixture as the floor; an empty query uses the question |
| `GET /retrieval` | whether a content key is set, so full text is reachable |
| `POST /projects/:id/sources/:sid/upload` | a PDF as its own bytes; refused unless it carries text |
| `POST /projects/:id/sources/:sid/transcribe` | a passage typed from a paper the student holds |
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

**Done (slice 03).** Real retrieval, and the gate holding against it. The access
level is derived from what we hold rather than asserted, so a paper that is open
access somewhere still arrives at `abstract` until its text is in hand. PDF
upload and student transcription ship with the slice, because without them the
gate would block every paywalled paper.

Only OpenAlex is used. Unpaywall requires an identifying email on every request
and reports OA status OpenAlex already carries; Crossref and Semantic Scholar
would add a canonical citation string and a plain-text abstract, neither of
which was worth a second service yet. Semantic Scholar's `tldr` is deliberately
not used: it is a generated summary, and there is no provenance for that.

**Done (slice 04).** Claims and versions. Detection runs on the smallest model
and raises proposals; accepting one retypes the student's own thought, keeping
the identity and minting a version. Version history became a diff rather than a
list, and the instructor's comment finally shows what moved since it was read.

Two gaps the slice closed by accident, both found by running it: `thought.retyped`
was not in `STUDENT_AUTHORED_EVENTS`, so a coach retyping a student's thought was
stopped only by a database constraint and not by the guard the browser runs; and
`claimsCreated` counted only thoughts typed as claims from the start, so a claim
that arrived by retype was invisible to the instructor's panel.

**Done (slice 05).** Synthesis and the brief. Structural gaps moved into core so
one list serves the coach, the scan and the brief. Contradiction scanning reads
claims pairwise on the cheap model and reports pairs without picking a winner.
The Reasoning Brief assembles from existing objects, renders an empty section as
an open gap rather than prose, and links every line to the object behind it.

**Done (slice 06).** Instructor review. Assignments are authored with
requirements and published; a project is attached to one; the dashboard reports
progress at checkpoint level with every figure a count or a date. The resolve
loop closed: a student ends a comment by naming the version that answers it, and
cannot end one by agreeing with it.

**Next.** Slice 07 is the evidence panel — the counts already exist in
`observableRecord` and are rendered in the sidebar, so what remains is making
every number link to the objects behind it, and the thinking-evolution timeline
over the log.

Also outstanding from earlier slices: the three seats are still fixed rows, so
there is no auth and one student. That is the next real piece of infrastructure
rather than a slice.

Known gaps: there is no auth, and the three seats are fixed rows. The Codex
adapter is written but still unverified, since Codex is not installed here.
Retrieval holds no full text without a content key, which is honest but means
upload carries more weight than it eventually should.
