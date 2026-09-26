import { db } from '../db.js';
import { recordVersion, differsFrom } from './habitVersions.js';

const COLS = 'id, name, note, cadence_type, cadence_count, cadence_days, active, created_at, updated_at';

// Today per the server clock. effective_from is a date, not a timestamp: a
// habit edited at any hour takes effect for that whole day.
function serverToday() {
  return db.prepare(`SELECT date('now') AS d`).get().d;
}

export function listHabits() {
  return db.prepare(`SELECT ${COLS} FROM habits ORDER BY active DESC, name ASC`).all();
}

export function getHabit(id) {
  return db.prepare(`SELECT ${COLS} FROM habits WHERE id = ?`).get(id);
}

export function createHabit({ name, note, cadence_type, cadence_count, cadence_days }) {
  if (!name || typeof name !== 'string') {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  if (!['daily', 'weekly', 'weekdays'].includes(cadence_type)) {
    throw Object.assign(new Error('cadence_type must be daily, weekly, or weekdays'), { status: 400 });
  }

  // The habit and its opening version must land together — a habit with no
  // version has no history to read, so this is one transaction, not two writes.
  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO habits (name, note, cadence_type, cadence_count, cadence_days)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, note ?? null, cadence_type, cadence_count ?? null, cadence_days ?? null);

    recordVersion({
      habit_id: result.lastInsertRowid,
      effective_from: serverToday(),
      cadence_type,
      cadence_count,
      cadence_days,
      active: 1,
    });

    return result.lastInsertRowid;
  });

  return getHabit(create());
}

export function updateHabit(id, fields) {
  const existing = getHabit(id);
  if (!existing) return null;

  // Build a dynamic UPDATE for only the fields the caller actually sent.
  const allowed = ['name', 'note', 'cadence_type', 'cadence_count', 'cadence_days', 'active'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      // SQLite/better-sqlite3 can't bind JS booleans — store active as 0/1.
      values.push(key === 'active' ? (fields[key] ? 1 : 0) : fields[key]);
    }
  }
  if (sets.length === 0) return existing;

  sets.push(`updated_at = datetime('now')`);
  values.push(id);

  const update = db.transaction(() => {
    db.prepare(`UPDATE habits SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    const next = getHabit(id);

    // Only scheduling-relevant changes get a version. Renaming a habit or
    // editing its note must not create one, or history fills with noise.
    if (differsFrom(existing, next)) {
      recordVersion({
        habit_id: id,
        effective_from: serverToday(),
        cadence_type: next.cadence_type,
        cadence_count: next.cadence_count,
        cadence_days: next.cadence_days,
        active: next.active,
      });
    }
    return next;
  });

  return update();
}