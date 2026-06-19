import { db } from '../db.js';

// Schedule entries always join to their template so callers get a name to show.
// INNER JOIN + active = 1 means soft-deleted templates drop out of every view
// (their rows linger but stay hidden; reactivating the template restores them).
const SELECT = `
  SELECT ws.id, ws.template_id, ws.weekday, wt.name AS template_name
  FROM workout_schedule ws
  JOIN workout_templates wt ON wt.id = ws.template_id
  WHERE wt.active = 1
`;

function validWeekday(weekday) {
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;
}

export function listSchedule({ weekday } = {}) {
  if (weekday !== undefined && weekday !== null) {
    if (!validWeekday(weekday)) {
      throw Object.assign(new Error('weekday must be an integer 0-6'), { status: 400 });
    }
    return db
      .prepare(`${SELECT} AND ws.weekday = ? ORDER BY wt.name ASC`)
      .all(weekday);
  }
  return db.prepare(`${SELECT} ORDER BY ws.weekday ASC, wt.name ASC`).all();
}

export function addScheduleEntry({ template_id, weekday }) {
  if (!validWeekday(weekday)) {
    throw Object.assign(new Error('weekday must be an integer 0-6'), { status: 400 });
  }
  const template = db
    .prepare('SELECT id FROM workout_templates WHERE id = ?')
    .get(template_id);
  if (!template) {
    throw Object.assign(new Error('template_id does not exist'), { status: 400 });
  }

  // Idempotent: re-adding an existing (template, weekday) pair is a no-op.
  db.prepare(`
    INSERT INTO workout_schedule (template_id, weekday) VALUES (?, ?)
    ON CONFLICT (template_id, weekday) DO NOTHING
  `).run(template_id, weekday);

  // Return the canonical row (joined name), whether just-created or pre-existing.
  return db
    .prepare(`${SELECT} AND ws.template_id = ? AND ws.weekday = ?`)
    .get(template_id, weekday);
}

export function removeScheduleEntry(id) {
  const result = db.prepare('DELETE FROM workout_schedule WHERE id = ?').run(id);
  return result.changes > 0;
}
