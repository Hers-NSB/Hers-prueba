CREATE TABLE IF NOT EXISTS drop_recordings (
  creator_id INTEGER NOT NULL,
  drop_id TEXT NOT NULL,
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  PRIMARY KEY (creator_id, drop_id)
);
