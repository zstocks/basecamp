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

// Distinct exercise names ever logged — drives the progress-view picker.
export function listExerciseNames() {
  return db
    .prepare('SELECT DISTINCT exercise_name FROM session_sets ORDER BY exercise_name ASC')
    .all()
    .map(r => r.exercise_name);
}

// All logged sets for one exercise across sessions, with each set's session date.
// The frontend rolls these up into a top-set-per-day progress view.
export function listSetsByExercise(exerciseName) {
  if (!exerciseName) {
    throw Object.assign(new Error('exercise query param required'), { status: 400 });
  }
  return db.prepare(`
    SELECT ss.id, ss.session_id, ss.exercise_name, ss.set_number, ss.reps, ss.weight,
           s.date, s.completed
    FROM session_sets ss
    JOIN workout_sessions s ON s.id = ss.session_id
    WHERE ss.exercise_name = ?
    ORDER BY s.date ASC, ss.set_number ASC
  `).all(exerciseName);
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
