-- ============================================================================
-- Noesis / Epistemic Research Studio - slice 00
--
-- The `event` table is the source of truth. Every other table in this file is a
-- projection of it and can be dropped and rebuilt by replaying the log.
--
-- Two rules are enforced here rather than in application code, because an
-- interface check is a suggestion and a constraint is not:
--   * the event log cannot be updated or deleted (append_only_guard)
--   * evidence cannot exist without a passage from a source that carries real
--     text (enforce_evidence_gate)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type actor as enum ('student', 'coach', 'instructor');

create type thought_type as enum (
  'NOTICE', 'WONDER', 'TENSION', 'UNKNOWN', 'QUESTION', 'IDEA',
  'CLAIM', 'EVIDENCE', 'CHALLENGE', 'ALTERNATIVE', 'ASSUMPTION', 'SYNTHESIS'
);

create type relation_kind as enum (
  'raises', 'suggests', 'challenges', 'supports',
  'contradicts', 'leaves_uncertain', 'leads_to', 'reframes'
);

-- Search surfaces all four. Only the last two carry text a claim can be traced to.
create type source_access as enum ('metadata', 'abstract', 'open_full_text', 'user_upload');

-- No 'generated' member, by design: the system never implies a passage it has
-- not retrieved, and the type gives that failure mode nowhere to live.
create type passage_provenance as enum ('retrieved', 'uploaded', 'student_transcribed');

create type coach_move_kind as enum (
  'reflect', 'ask', 'offer_structure', 'offer_sentence_frame',
  'propose_branch', 'flag', 'retrieve', 'challenge'
);

create type comment_kind as enum ('comment', 'question', 'mark_for_revision');
create type proposal_kind as enum ('claim', 'branch', 'challenge');
create type proposal_status as enum ('open', 'accepted', 'dismissed');

-- ---------------------------------------------------------------------------
-- Course scaffolding
-- ---------------------------------------------------------------------------

create table person (
  person_id   uuid primary key default gen_random_uuid(),
  role        actor not null,
  display_name text not null,
  email       text unique,
  created_at  timestamptz not null default now()
);

create table assignment (
  assignment_id  uuid primary key default gen_random_uuid(),
  instructor_id  uuid not null references person(person_id),
  title          text not null,
  instructions   text not null default '',
  due_at         timestamptz,
  require_sources          int  not null default 0,
  require_counterargument  bool not null default false,
  require_ai_provenance    bool not null default true,
  published_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table project (
  project_id    uuid primary key default gen_random_uuid(),
  student_id    uuid not null references person(person_id),
  assignment_id uuid references assignment(assignment_id),
  title         text not null default 'Untitled question',
  project_group text not null default 'Unfiled',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------

create table event (
  event_id    uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(project_id),
  seq         bigint not null,
  at          timestamptz not null default now(),
  actor       actor not null,
  actor_id    uuid not null references person(person_id),
  type        text not null,
  payload     jsonb not null,
  -- The coach move this write answers, when there was one. Provenance in a column.
  prompted_by uuid,
  constraint event_seq_unique unique (project_id, seq),
  constraint event_seq_positive check (seq > 0)
);

create index event_project_seq_idx on event (project_id, seq);
create index event_type_idx on event (project_id, type);

create or replace function append_only_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'event log is append-only: % on event is not permitted', tg_op
    using hint = 'Record a compensating event instead. Archiving sets a flag; nothing is erased.';
end;
$$;

create trigger event_no_update before update on event
  for each row execute function append_only_guard();
create trigger event_no_delete before delete on event
  for each row execute function append_only_guard();

-- ---------------------------------------------------------------------------
-- Projections: thoughts and versions
-- ---------------------------------------------------------------------------

-- object_id is permanent. It is minted once and survives every revision and
-- every checkpoint.
create table thought (
  object_id          uuid primary key,
  project_id         uuid not null references project(project_id),
  type               thought_type not null,
  current_version_id uuid not null,
  pos_x              double precision not null default 0,
  pos_y              double precision not null default 0,
  archived           bool not null default false,
  created_at         timestamptz not null default now()
);

create index thought_project_idx on thought (project_id) where not archived;

-- version_id names one revision of that permanent object.
create table thought_version (
  version_id        uuid primary key,
  object_id         uuid not null references thought(object_id),
  parent_version_id uuid references thought_version(version_id),
  seq               bigint not null,
  type              thought_type not null,
  text              text not null,
  note              text not null default '',
  authored_by       actor not null,
  prompted_by       uuid,
  at                timestamptz not null default now(),
  -- i. The coach never writes thought text.
  constraint thought_version_student_authored check (authored_by = 'student')
);

create index thought_version_object_idx on thought_version (object_id, seq);

alter table thought
  add constraint thought_current_version_fk
  foreign key (current_version_id) references thought_version(version_id)
  deferrable initially deferred;

create table relation (
  relation_id uuid primary key,
  project_id  uuid not null references project(project_id),
  from_object uuid not null references thought(object_id),
  to_object   uuid not null references thought(object_id),
  relation    relation_kind not null,
  authored_by actor not null,
  removed     bool not null default false,
  constraint relation_no_self_loop check (from_object <> to_object)
);

create index relation_from_idx on relation (from_object) where not removed;
create index relation_to_idx on relation (to_object) where not removed;

-- ---------------------------------------------------------------------------
-- Projections: sources, passages, evidence
-- ---------------------------------------------------------------------------

create table source (
  source_id     uuid primary key,
  project_id    uuid not null references project(project_id),
  access        source_access not null,
  cite          text not null,
  title         text not null,
  method        text,
  abstract      text,
  external_url  text,
  doi           text,
  saved         bool not null default false,
  discovered_at timestamptz not null default now()
);

create table passage (
  passage_id uuid primary key,
  source_id  uuid not null references source(source_id),
  text       text not null,
  locator    text not null default '',
  provenance passage_provenance not null,
  constraint passage_has_text check (length(btrim(text)) > 0)
);

-- An Evidence row is the student's reading of a passage. Both fields are theirs.
create table evidence (
  object_id      uuid primary key references thought(object_id),
  source_id      uuid not null references source(source_id),
  passage_id     uuid not null references passage(passage_id),
  interpretation text not null,
  warrant        text not null,
  constraint evidence_interpretation_written check (length(btrim(interpretation)) > 0),
  constraint evidence_warrant_written check (length(btrim(warrant)) > 0)
);

-- ii. Evidence needs real text. A source held at metadata or abstract level can
-- be saved and can sit on the map; it cannot back a claim.
create or replace function enforce_evidence_gate() returns trigger
language plpgsql as $$
declare
  src_access source_access;
  psg_source uuid;
begin
  select access into src_access from source where source_id = new.source_id;
  if src_access not in ('open_full_text', 'user_upload') then
    raise exception 'evidence gate: source % is at %, which carries no retrievable passage',
      new.source_id, src_access
      using hint = 'Open the source externally or upload the paper, then capture a passage.';
  end if;

  select source_id into psg_source from passage where passage_id = new.passage_id;
  if psg_source is null then
    raise exception 'evidence gate: passage % was never captured', new.passage_id;
  end if;
  if psg_source <> new.source_id then
    raise exception 'evidence gate: passage % belongs to source %, not %',
      new.passage_id, psg_source, new.source_id;
  end if;

  return new;
end;
$$;

create trigger evidence_gate before insert or update on evidence
  for each row execute function enforce_evidence_gate();

-- ---------------------------------------------------------------------------
-- Projections: coach thread and proposals
-- ---------------------------------------------------------------------------

-- iii. The coach detects. It does not accept.
create table proposal (
  proposal_id      uuid primary key,
  project_id       uuid not null references project(project_id),
  kind             proposal_kind not null,
  suggested_type   thought_type not null,
  target_object_id uuid references thought(object_id),
  rationale        text not null default '',
  status           proposal_status not null default 'open',
  accepted_as      uuid references thought(object_id),
  constraint proposal_accepted_has_object
    check ((status = 'accepted') = (accepted_as is not null))
);

create table coach_move (
  move_id          uuid primary key,
  project_id       uuid not null references project(project_id),
  kind             coach_move_kind not null,
  target_object_id uuid references thought(object_id),
  hint_level       smallint not null default 0,
  body             text not null default '',
  flag             text,
  at               timestamptz not null default now(),
  constraint coach_move_hint_rung check (hint_level between 0 and 3)
);

create table student_reply (
  move_id uuid primary key references coach_move(move_id),
  text    text not null,
  at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projections: checkpoints and feedback
-- ---------------------------------------------------------------------------

create table snapshot (
  snapshot_id   uuid primary key,
  project_id    uuid not null references project(project_id),
  assignment_id uuid references assignment(assignment_id),
  at            timestamptz not null default now()
);

-- iv. A checkpoint freezes (object, version) pairs. It clones nothing and mints
-- no second identity, which is what lets a comment outlive five revisions.
create table snapshot_object (
  snapshot_id uuid not null references snapshot(snapshot_id),
  object_id   uuid not null references thought(object_id),
  version_id  uuid not null references thought_version(version_id),
  primary key (snapshot_id, object_id)
);

-- A comment must name the exact version a checkpoint froze, so the composite
-- key below is the reference target for instructor_comment.
create unique index snapshot_object_triple_idx
  on snapshot_object (snapshot_id, object_id, version_id);

create table instructor_comment (
  comment_id  uuid primary key,
  snapshot_id uuid not null references snapshot(snapshot_id),
  -- the stable identity: the thread follows the live object
  object_id   uuid not null references thought(object_id),
  -- what was actually on screen when this was written
  version_id  uuid not null references thought_version(version_id),
  kind        comment_kind not null default 'comment',
  body        text not null,
  author_id   uuid not null references person(person_id),
  resolved_by_version_id uuid references thought_version(version_id),
  at          timestamptz not null default now(),
  -- the comment must name the version the checkpoint actually froze
  foreign key (snapshot_id, object_id, version_id)
    references snapshot_object (snapshot_id, object_id, version_id)
);

create index comment_object_idx on instructor_comment (object_id)
  where resolved_by_version_id is null;

-- ---------------------------------------------------------------------------
-- Read model for the instructor panel: counts, never judgments.
-- ---------------------------------------------------------------------------

create view observable_record as
select
  p.project_id,
  count(*) filter (where t.type = 'CLAIM' and not t.archived)        as claims_live,
  count(*) filter (where t.type = 'CLAIM' and t.archived)            as claims_archived,
  count(*) filter (where t.type = 'CHALLENGE' and not t.archived)    as challenges_explored,
  count(*) filter (where t.type = 'ALTERNATIVE' and not t.archived)  as alternatives_explored,
  count(*) filter (where t.type = 'EVIDENCE' and not t.archived)     as evidence_created
from project p
left join thought t on t.project_id = p.project_id
group by p.project_id;
