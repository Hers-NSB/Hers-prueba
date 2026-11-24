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
