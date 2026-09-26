-- Phase 4: make habit history permanent.
--
-- PROBLEM: scheduled-ness was recomputed from a habit's CURRENT definition, so
-- editing a habit rewrote the past. Archive a habit and it vanished from every
-- previous day's scheduled count; change a cadence from Mon/Thu to daily and
-- months of days silently re-evaluated as if they had always been daily. With a
-- weekly tracker that was invisible. With long-term history it corrupts streaks.
--
-- FIX: the same snapshot thinking already used by session_sets.exercise_name and
-- the eaten rows in meal_entries. A habit's definition is versioned; "was habit H
-- scheduled on date D?" reads the version in effect on D, not the one in effect
-- now. Append-only: edits add a row, they never mutate or delete history.
--
-- habits still holds the CURRENT definition (so existing reads are unchanged);
-- habit_versions is the authoritative record for any question about the past.

CREATE TABLE habit_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id       INTEGER NOT NULL,
  effective_from TEXT NOT NULL,                 -- YYYY-MM-DD, inclusive
  cadence_type   TEXT NOT NULL CHECK (cadence_type IN ('daily', 'weekly', 'weekdays')),
  cadence_count  INTEGER,                       -- e.g. 3 for "3x per week"
  cadence_days   TEXT,                          -- "1,4" = Mon,Thu
  active         INTEGER NOT NULL DEFAULT 1,    -- 0/1; an archived habit still counts
                                                -- for the days before it was archived
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  -- One version per habit per day: editing a habit twice in one day replaces
  -- that day's version rather than stacking ambiguous rows.
  UNIQUE (habit_id, effective_from)
);

CREATE INDEX idx_habit_versions_habit ON habit_versions(habit_id, effective_from);

-- Backfill: every existing habit gets an opening version dated from its creation,
-- so days before a habit existed correctly show it as not scheduled.
INSERT INTO habit_versions (habit_id, effective_from, cadence_type, cadence_count, cadence_days, active)
SELECT id, date(created_at), cadence_type, cadence_count, cadence_days, active
FROM habits;
