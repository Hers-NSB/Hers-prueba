CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bot_id TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  creator_name TEXT NOT NULL,
  creator_username TEXT,
  encrypted_secrets TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_model ON profiles(creator_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS drop_publications (
  creator_id INTEGER NOT NULL,
  creator_name TEXT NOT NULL,
  drop_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  post_id TEXT NOT NULL,
  manual INTEGER NOT NULL CHECK (manual IN (0, 1)),
  confirmed_at INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  PRIMARY KEY (creator_id, post_id),
  UNIQUE (creator_id, drop_id, position)
);

CREATE INDEX IF NOT EXISTS drop_publications_daily
  ON drop_publications(local_date, creator_id, drop_id);

CREATE TABLE IF NOT EXISTS bot_activity (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_leases (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1))
);

CREATE TABLE IF NOT EXISTS drop_recordings (
  creator_id INTEGER NOT NULL,
  drop_id TEXT NOT NULL,
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  PRIMARY KEY (creator_id, drop_id)
);
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
