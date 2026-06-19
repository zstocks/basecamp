-- Phase 2: workouts
-- Flow: templates -> weekly schedule -> per-day completion -> optional set actuals.

-- workout_templates: a named, reusable workout (e.g. "Push Day A")
CREATE TABLE workout_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,   -- SQLite has no bool; 0/1 soft-delete, like habits
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- template_exercises: the ordered exercises inside a template, with optional targets
CREATE TABLE template_exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   INTEGER NOT NULL,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,   -- display order within the template
  target_sets   INTEGER,
  target_reps   INTEGER,
  target_weight REAL,
  note          TEXT,
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE CASCADE
);

-- workout_schedule: maps a template to a weekday (0=Sun..6=Sat).
-- Many templates may share a weekday; a template may repeat across weekdays.
CREATE TABLE workout_schedule (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE CASCADE,
  UNIQUE (template_id, weekday)
);

-- workout_sessions: per-day completion record — "on this date I did this template".
-- template_id is SET NULL on hard-delete so completion history survives template removal.
CREATE TABLE workout_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD
  template_id INTEGER,
  completed   INTEGER NOT NULL DEFAULT 1,    -- 0/1; flag (not mere existence) so it can be un-checked
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE SET NULL,
  UNIQUE (date, template_id)
);

-- session_sets: optional logged actuals against a session.
-- exercise_name is TEXT (a snapshot), NOT a FK to template_exercises — history
-- must survive template edits/deletes.
CREATE TABLE session_sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL,
  exercise_name TEXT NOT NULL,
  set_number    INTEGER NOT NULL,
  reps          INTEGER,
  weight        REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

-- indexes for the queries we'll do most
CREATE INDEX idx_template_exercises_template ON template_exercises(template_id);
CREATE INDEX idx_workout_schedule_weekday ON workout_schedule(weekday);
CREATE INDEX idx_workout_sessions_date ON workout_sessions(date);
CREATE INDEX idx_session_sets_session ON session_sets(session_id);
