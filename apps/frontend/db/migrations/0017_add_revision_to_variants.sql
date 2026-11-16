-- Autosave needs a monotonic revision, or a slow in-flight save overwrites newer text.
--
-- The client sends the revision it believes it is writing over; the server refuses anything older than
-- what it holds. That is what makes "autosave" safe instead of a race nobody notices until they lose a
-- paragraph.
alter table variants add column revision integer not null default 0;
