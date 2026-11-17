-- X is metered, so one publish has a price and the price depends on the post's shape: $0.015 a post,
-- $0.20 when it carries a link (docs/001-PRD.md §8). The estimate is shown before the send and stored
-- with the result, so the operator can always answer "what did that post cost" from the row rather
-- than from a memory of the preview (openspec m5-publishing 5.3).
--
-- REAL, not integer cents: this is an estimate, not a ledger. A spend cap (PRD R-4) sums these, and
-- the sum of two estimates is still an estimate.
alter table publish_results add column estimated_cost_usd real;
