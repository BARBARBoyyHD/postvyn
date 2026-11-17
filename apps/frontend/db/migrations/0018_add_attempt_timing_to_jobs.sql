-- When the latest attempt started and finished, so a board can show "took 4.2s" without parsing
-- activity_log. Latest attempt only: a job row is one job, not one attempt, and a full per-attempt
-- history would be its own table — nobody has asked for that yet.
alter table jobs add column attempt_started_at integer;
alter table jobs add column attempt_finished_at integer;
