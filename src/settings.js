import { db } from '../db.js';

const COLS = 'id, goal_weight, target_calories, target_protein_g, target_water_ml, updated_at';

export function getSettings() {
  return db.prepare(`SELECT ${COLS} FROM settings WHERE id = 1`).get();
}

export function updateSettings(fields) {
  const allowed = ['goal_weight', 'target_calories', 'target_protein_g', 'target_water_ml'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (sets.length === 0) return getSettings();

  sets.push(`updated_at = datetime('now')`);
  db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`).run(...values);
  return getSettings();
}