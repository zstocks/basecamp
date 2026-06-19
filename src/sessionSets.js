import { db } from '../db.js';

const COLS = 'id, session_id, exercise_name, set_number, reps, weight, created_at';

const insertSet = db.prepare(`
  INSERT INTO session_sets (session_id, exercise_name, set_number, reps, weight)
  VALUES (?, ?, ?, ?, ?)
`);

// Ordered by id so insertion order (= the array order the client sent, i.e.
// template/exercise order) is preserved on read.
export function getSetsForSession(sessionId) {
  return db
    .prepare(`SELECT ${COLS} FROM session_sets WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId);
}

// Replace-all: wipe a session's sets and re-insert from the array. exercise_name
// is a text snapshot (no FK), so logged history survives later template edits or
// deletes. Returns the fresh rows, or null if the session doesn't exist.
export function setSessionSets(sessionId, sets) {
  const session = db
    .prepare('SELECT id FROM workout_sessions WHERE id = ?')
    .get(sessionId);
  if (!session) return null;
  if (!Array.isArray(sets)) {
    throw Object.assign(new Error('sets must be an array'), { status: 400 });
  }

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM session_sets WHERE session_id = ?').run(sessionId);
    sets.forEach((s, i) => {
      if (!s || !s.exercise_name || typeof s.exercise_name !== 'string') {
        throw Object.assign(new Error('each set needs an exercise_name'), { status: 400 });
      }
      insertSet.run(
        sessionId,
        s.exercise_name,
        // set_number is a per-exercise label; default to array position if omitted.
        Number.isInteger(s.set_number) ? s.set_number : i + 1,
        s.reps ?? null,
        s.weight ?? null,
      );
    });
  });

  replace();
  return getSetsForSession(sessionId);
}
