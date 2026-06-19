import { db } from '../db.js';

// Sessions join their template for a display name. LEFT JOIN (not INNER) so a
// session whose template was later hard-deleted (template_id -> NULL) still shows.
const SELECT = `
  SELECT s.id, s.date, s.template_id, s.completed, s.note, s.created_at,
         wt.name AS template_name
  FROM workout_sessions s
  LEFT JOIN workout_templates wt ON wt.id = s.template_id
`;

export function getSessionsForDate(date) {
  if (!date) {
    throw Object.assign(new Error('date is required'), { status: 400 });
  }
  return db.prepare(`${SELECT} WHERE s.date = ? ORDER BY wt.name ASC`).all(date);
}

export function setSession({ date, template_id, completed, note }) {
  if (!date || !template_id) {
    throw Object.assign(new Error('date and template_id are required'), { status: 400 });
  }
  const template = db
    .prepare('SELECT id FROM workout_templates WHERE id = ?')
    .get(template_id);
  if (!template) {
    throw Object.assign(new Error('template_id does not exist'), { status: 400 });
  }

  // completed is explicit per call; omitting it on a fresh session defaults to
  // done (you logged a session because you did it). note is preserved on update
  // when omitted (COALESCE), so a completion-toggle won't wipe an existing note.
  const completedVal = completed === undefined ? 1 : completed ? 1 : 0;

  db.prepare(`
    INSERT INTO workout_sessions (date, template_id, completed, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (date, template_id) DO UPDATE SET
      completed = excluded.completed,
      note = COALESCE(excluded.note, workout_sessions.note)
  `).run(date, template_id, completedVal, note ?? null);

  return db
    .prepare(`${SELECT} WHERE s.date = ? AND s.template_id = ?`)
    .get(date, template_id);
}
