-- Proves the two guards that live in the database rather than in application
-- code. Run against a freshly migrated database:
--
--   pnpm db:up && pnpm db:migrate && pnpm --filter @coral/server test:db
--
-- Cases 1-5 must each print an ERROR. Case 6 must succeed and leave one row.
-- A silent run is a failing run. The fixture is idempotent, so it repeats.
--
\set ON_ERROR_STOP 0
begin;
-- Clear what cases 4 and 6 leave behind. The event log cannot be cleaned this
-- way and does not need to be: its rows are inserted with `on conflict do
-- nothing` below, and the append-only guard is precisely what cases 2 and 3
-- exist to prove.
delete from evidence where object_id = 'bbbbbbbb-0000-0000-0000-000000000009';
delete from thought where object_id = 'bbbbbbbb-0000-0000-0000-000000000009';

insert into person (person_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111','student','Maren Reyes'),
  ('22222222-2222-2222-2222-222222222222','coach','Coach'),
  ('33333333-3333-3333-3333-333333333333','instructor','Prof')
on conflict do nothing;
insert into project (project_id, student_id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','AI and independent reasoning')
on conflict do nothing;
insert into thought (object_id, project_id, type, current_version_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','CLAIM','cccccccc-0000-0000-0000-000000000001')
on conflict do nothing;
insert into thought_version (version_id, object_id, seq, type, text, authored_by) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1,'CLAIM','Early AI assistance narrows hypothesis range.','student')
on conflict do nothing;
insert into event (event_id, project_id, seq, actor, actor_id, type, payload) values
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,'student','11111111-1111-1111-1111-111111111111','thought.created','{}')
on conflict do nothing;
insert into source (source_id, project_id, access, cite, title) values
  ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','abstract','Smith et al., 2025','AI Assistance and Hypothesis Generation'),
  ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','open_full_text','Okoro & Lind, 2024','Task Speed, Effort, and Perceived Learning')
on conflict do nothing;
insert into passage (passage_id, source_id, text, locator, provenance) values
  ('ffffffff-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000002','Comprehension scores were unchanged.','p. 11','retrieved')
on conflict do nothing;
commit;

\echo '--- 1. coach authoring a thought version (expect: rejected) ---'
insert into thought_version (version_id, object_id, seq, type, text, authored_by)
values ('cccccccc-0000-0000-0000-0000000000ff','bbbbbbbb-0000-0000-0000-000000000001',2,'CLAIM','Written by the coach.','coach');

\echo '--- 2. updating the event log (expect: rejected) ---'
update event set payload = '{"tampered":true}' where seq = 1;

\echo '--- 3. deleting from the event log (expect: rejected) ---'
delete from event where seq = 1;

\echo '--- 4. evidence from an abstract-only source (expect: rejected) ---'
insert into thought (object_id, project_id, type, current_version_id) values
  ('bbbbbbbb-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','EVIDENCE','cccccccc-0000-0000-0000-000000000001');
insert into evidence (object_id, source_id, passage_id, interpretation, warrant)
values ('bbbbbbbb-0000-0000-0000-000000000009','eeeeeeee-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002','It shows a drop.','Licenses a claim about effort.');

\echo '--- 5. evidence with an empty warrant (expect: rejected) ---'
insert into evidence (object_id, source_id, passage_id, interpretation, warrant)
values ('bbbbbbbb-0000-0000-0000-000000000009','eeeeeeee-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-000000000002','It shows a drop.','   ');

\echo '--- 6. evidence from full text with both fields (expect: accepted) ---'
insert into evidence (object_id, source_id, passage_id, interpretation, warrant)
values ('bbbbbbbb-0000-0000-0000-000000000009','eeeeeeee-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-000000000002','Effort fell while comprehension held steady.','Licenses a claim about effort, not about understanding.');
\echo 'rows in evidence:'
select count(*) from evidence;
