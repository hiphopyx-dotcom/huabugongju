CREATE TABLE IF NOT EXISTS studio_service_diagnostics (
  name text PRIMARY KEY CHECK (name='image-connection'),
  result jsonb NOT NULL,
  updated bigint NOT NULL
);
