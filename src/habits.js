import { db } from '../db.js';

const COLS = 'id, name, note, cadence_type, cadence_count, cadence_days, active, created_at, updated_at';

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

  const result = db.prepare(`
    INSERT INTO habits (name, note, cadence_type, cadence_count, cadence_days)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, note ?? null, cadence_type, cadence_count ?? null, cadence_days ?? null);

  return getHabit(result.lastInsertRowid);
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

  db.prepare(`UPDATE habits SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getHabit(id);
}