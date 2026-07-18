ALTER TABLE work_orders
  DROP CONSTRAINT IF EXISTS work_orders_closed_at_consistency,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS closed_at;
