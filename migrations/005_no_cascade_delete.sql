-- Stop a habit deletion from destroying its history.
--
-- habit_logs and habit_versions both had ON DELETE CASCADE, so a single
-- `DELETE FROM habits WHERE id = ?` would silently erase every log and every
-- version for that habit. The UI only ever soft-deletes (active = 0), so
-- nothing triggers it today — which is exactly why it is worth closing now,
-- before real data accumulates and a stray query costs months of history.
--
-- RESTRICT rather than SET NULL: a habit_log whose habit_id is NULL records
-- that *something* was done on a date, with no way to know what. That is not
-- preserved history, it is debris. Blocking the delete keeps the data whole and
-- makes destruction deliberate — archive the habit instead, which is what the
-- app already does. If you ever genuinely want a habit gone, delete its logs
-- and versions first, as an explicit decision.
--
-- SQLite cannot ALTER a foreign key, so each table is rebuilt: create, copy,
-- drop, rename. Safe inside the migration transaction because nothing
-- references habit_logs or habit_versions, so no other table's FK clauses are
-- rewritten by the rename.

-- --- habit_logs ---------------------------------------------------------
CREATE TABLE habit_logs_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   INTEGER NOT NULL,
  date       TEXT NOT NULL,        -- YYYY-MM-DD, local date
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE RESTRICT,
  UNIQUE (habit_id, date)
);

INSERT INTO habit_logs_new (id, habit_id, date, done, created_at)
SELECT id, habit_id, date, done, created_at FROM habit_logs;

DROP TABLE habit_logs;
ALTER TABLE habit_logs_new RENAME TO habit_logs;
CREATE INDEX idx_habit_logs_date ON habit_logs(date);

-- --- habit_versions ------------------------------------------------------
CREATE TABLE habit_versions_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id       INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  cadence_type   TEXT NOT NULL CHECK (cadence_type IN ('daily', 'weekly', 'weekdays')),
  cadence_count  INTEGER,
  cadence_days   TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE RESTRICT,
  UNIQUE (habit_id, effective_from)
);

INSERT INTO habit_versions_new (id, habit_id, effective_from, cadence_type, cadence_count, cadence_days, active, created_at)
SELECT id, habit_id, effective_from, cadence_type, cadence_count, cadence_days, active, created_at FROM habit_versions;

DROP TABLE habit_versions;
ALTER TABLE habit_versions_new RENAME TO habit_versions;
CREATE INDEX idx_habit_versions_habit ON habit_versions(habit_id, effective_from);
