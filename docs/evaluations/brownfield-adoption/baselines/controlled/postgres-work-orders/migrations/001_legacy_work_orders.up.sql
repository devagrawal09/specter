CREATE TABLE work_orders (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'closed', 'cancelled')),
  inspection_passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order_history (
  id bigserial PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_order_history_work_order_created_idx
  ON work_order_history (work_order_id, created_at, id);
