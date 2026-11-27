CREATE TABLE IF NOT EXISTS manual_drop_chains (
  id TEXT PRIMARY KEY,
  creator_id INTEGER NOT NULL,
  creator_name TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  start_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  write_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_drop_steps (
  chain_id TEXT NOT NULL REFERENCES manual_drop_chains(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  send_time TEXT NOT NULL,
  text TEXT NOT NULL,
  photo TEXT,
  PRIMARY KEY (chain_id, position)
);

CREATE TABLE IF NOT EXISTS manual_drop_deliveries (
  chain_id TEXT NOT NULL REFERENCES manual_drop_chains(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  position INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('publishing', 'retry', 'published', 'failed', 'uncertain')),
  updated_at INTEGER NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  post_id TEXT,
  error TEXT,
  PRIMARY KEY (chain_id, local_date, position)
);

CREATE INDEX IF NOT EXISTS manual_drop_deliveries_date ON manual_drop_deliveries(local_date, state);
