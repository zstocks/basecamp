import { db } from '../db.js';

const COLS = 'id, habit_id, effective_from, cadence_type, cadence_count, cadence_days, active';

// Append-only history of habit definitions. A habit's row in `habits` is the
// CURRENT definition; these rows are what any question about the past must read,
// so that editing a habit never rewrites whether earlier days summited.
//
// Editing the same habit twice in one day replaces that day's version rather
// than stacking two rows with the same effective_from — the day only has one
// answer to "what was this habit that day?", and the last edit wins.
export function recordVersion({ habit_id, effective_from, cadence_type, cadence_count, cadence_days, active }) {
  db.prepare(`
    INSERT INTO habit_versions (habit_id, effective_from, cadence_type, cadence_count, cadence_days, active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (habit_id, effective_from) DO UPDATE SET
      cadence_type  = excluded.cadence_type,
      cadence_count = excluded.cadence_count,
      cadence_days  = excluded.cadence_days,
      active        = excluded.active
  `).run(
    habit_id,
    effective_from,
    cadence_type,
    cadence_count ?? null,
    cadence_days ?? null,
    active ? 1 : 0,
  );
}

// Every version for every habit, oldest first. Small (one row per habit per
// edit), so the client fetches the lot once and resolves dates locally — which
// keeps the streak rule in one place on the front end.
export function listHabitVersions() {
  return db.prepare(`SELECT ${COLS} FROM habit_versions ORDER BY habit_id, effective_from`).all();
}

// The definition in effect for a habit on a given date, or null if the habit did
// not exist yet. Used server-side; the client mirrors this logic.
export function versionOn(habit_id, date) {
  return db.prepare(`
    SELECT ${COLS} FROM habit_versions
    WHERE habit_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC
    LIMIT 1
  `).get(habit_id, date) ?? null;
}

// True when a definition change is worth recording. Renaming a habit or editing
// its note does not affect scheduling, so it must not create a version.
export function differsFrom(existing, next) {
  return existing.cadence_type  !== next.cadence_type
      || (existing.cadence_count ?? null) !== (next.cadence_count ?? null)
      || (existing.cadence_days  ?? null) !== (next.cadence_days  ?? null)
      || (existing.active ? 1 : 0) !== (next.active ? 1 : 0);
}
