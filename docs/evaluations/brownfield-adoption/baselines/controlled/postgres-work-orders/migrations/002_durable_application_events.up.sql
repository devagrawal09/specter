CREATE TABLE application_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  enqueued_at timestamptz
);

CREATE INDEX application_events_pending_idx
  ON application_events (created_at, id)
  WHERE enqueued_at IS NULL;

CREATE TABLE notification_deliveries (
  event_id uuid PRIMARY KEY REFERENCES application_events(id) ON DELETE CASCADE,
  work_order_id text NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
