ALTER TABLE work_orders
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

-- Existing closed rows predate the explicit close timestamp; their last legacy update is the
-- recoverable best approximation and allows down/up migration cycles without losing validity.
UPDATE work_orders
SET closed_at = updated_at
WHERE status = 'closed' AND closed_at IS NULL;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_closed_at_consistency
  CHECK ((status = 'closed') = (closed_at IS NOT NULL));
