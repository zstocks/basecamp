-- Phase 3: meals
-- Flow: food library -> slot foods into a day's buckets (planned) -> "Log Today's Food"
-- snapshots the plan into eaten actuals -> daily rollup vs settings targets.

-- foods: the reusable library. Nutrition is stated per ONE serving; serving_size is a
-- descriptive label for what one serving is. Soft-delete via active, like habits/templates.
CREATE TABLE foods (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  serving_size TEXT,                -- label for one serving, e.g. "1 cup (240 ml)"
  calories     REAL,
  protein_g    REAL,
  carbs_g      REAL,
  fat_g        REAL,
  fiber_g      REAL,
  sugar_g      REAL,
  active       INTEGER NOT NULL DEFAULT 1,   -- SQLite has no bool; 0/1 soft-delete
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- meal_entries: one table, kind discriminator (planned | eaten), identical shape.
--   planned rows reference a live food_id and JOIN foods for nutrition (so edits to a
--     food flow through while you're still planning).
--   eaten rows are a SNAPSHOT — food_name + per-serving nutrition frozen at log time,
--     like session_sets — so logged history survives food edits/deletes. food_id is kept
--     only as a soft pointer (ON DELETE SET NULL); the snapshot is the source of truth.
-- quantity = number of servings; it multiplies the per-serving nutrition at rollup.
CREATE TABLE meal_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,                 -- YYYY-MM-DD
  kind       TEXT NOT NULL CHECK (kind IN ('planned', 'eaten')),
  bucket     TEXT NOT NULL CHECK (bucket IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  food_id    INTEGER,
  quantity   REAL NOT NULL DEFAULT 1,       -- servings; multiplies the nutrition
  position   INTEGER NOT NULL DEFAULT 0,    -- display order within a (date, kind, bucket)
  -- snapshot columns: populated on 'eaten', left NULL on 'planned' (JOIN foods instead)
  food_name  TEXT,
  calories   REAL,
  protein_g  REAL,
  carbs_g    REAL,
  fat_g      REAL,
  fiber_g    REAL,
  sugar_g    REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE SET NULL
);

-- Diet targets on the single-row settings table. target_calories and target_protein_g
-- already exist (Phase 1); add the rest. The floor/ceiling DIRECTION is not stored — it's
-- hardcoded in the rollup (one tunable place):
--   calories ceiling, protein floor, carbs ceiling, fat floor, fiber floor, sugar ceiling.
ALTER TABLE settings ADD COLUMN target_carbs_g INTEGER;
ALTER TABLE settings ADD COLUMN target_fat_g   INTEGER;
ALTER TABLE settings ADD COLUMN target_fiber_g INTEGER;
ALTER TABLE settings ADD COLUMN target_sugar_g INTEGER;

-- indexes for the queries we'll do most
CREATE INDEX idx_foods_active ON foods(active);
CREATE INDEX idx_meal_entries_day ON meal_entries(date, kind);
