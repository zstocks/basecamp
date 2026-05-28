-- habits: the library of habits you're tracking
CREATE TABLE habits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  note          TEXT,
  cadence_type  TEXT NOT NULL CHECK (cadence_type IN ('daily', 'weekly', 'weekdays')),
  cadence_count INTEGER,           -- e.g. 3 for "3x per week"; NULL for daily/weekdays
  cadence_days  TEXT,              -- comma-separated weekday numbers, e.g. "1,4" for Mon,Thu
  active        INTEGER NOT NULL DEFAULT 1,   -- SQLite has no bool; 0/1
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- habit_logs: one row per habit per day you checked it
CREATE TABLE habit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   INTEGER NOT NULL,
  date       TEXT NOT NULL,        -- YYYY-MM-DD, local date
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  UNIQUE (habit_id, date)
);

-- body_metrics: weight and water, one row per day
CREATE TABLE body_metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL UNIQUE,
  weight     REAL,                 -- pounds
  water_ml   INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- settings: a single-row table for your targets
CREATE TABLE settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  goal_weight      REAL,
  target_calories  INTEGER,
  target_protein_g INTEGER,
  target_water_ml  INTEGER,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO settings (id) VALUES (1);

-- craving_events: every time you tap an emergency button
CREATE TABLE craving_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  response   TEXT NOT NULL CHECK (response IN ('bag', 'walk', 'water', 'other')),
  resisted   INTEGER NOT NULL DEFAULT 1,
  note       TEXT
);

-- indexes for the queries we'll do most
CREATE INDEX idx_habit_logs_date ON habit_logs(date);
CREATE INDEX idx_body_metrics_date ON body_metrics(date);
CREATE INDEX idx_craving_events_created_at ON craving_events(created_at);