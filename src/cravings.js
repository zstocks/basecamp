import { db } from '../db.js';

const COLS = 'id, created_at, response, resisted, note';

export function listCravingEvents({ limit = 30 } = {}) {
  return db.prepare(`
    SELECT ${COLS} FROM craving_events
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function logCravingEvent({ response, resisted = true, note }) {
  if (!['bag', 'walk', 'water', 'other'].includes(response)) {
    throw Object.assign(new Error('response must be bag, walk, water, or other'), { status: 400 });
  }

  const result = db.prepare(`
    INSERT INTO craving_events (response, resisted, note)
    VALUES (?, ?, ?)
  `).run(response, resisted ? 1 : 0, note ?? null);

  return db.prepare(`SELECT ${COLS} FROM craving_events WHERE id = ?`).get(result.lastInsertRowid);
}