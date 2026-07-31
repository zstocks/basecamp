import { db } from '../db.js';

const COLS =
  'id, name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, active, created_at, updated_at';

// Nutrition columns: optional, non-negative numbers. '' / null / undefined -> null.
const NUTRITION = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'];

function numOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400 });
  }
  return n;
}

// activeOnly is for the planner's food picker; the library page lists all (active first).
export function listFoods({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE active = 1' : '';
  return db.prepare(`SELECT ${COLS} FROM foods ${where} ORDER BY active DESC, name ASC`).all();
}

export function getFood(id) {
  return db.prepare(`SELECT ${COLS} FROM foods WHERE id = ?`).get(id);
}

export function createFood(fields) {
  const { name } = fields;
  if (!name || typeof name !== 'string') {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  const nutrition = NUTRITION.map(f => numOrNull(fields[f], f));
  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO foods (name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(name, fields.serving_size ?? null, ...nutrition);
  return getFood(lastInsertRowid);
}

export function updateFood(id, fields) {
  const existing = getFood(id);
  if (!existing) return null;

  // Dynamic UPDATE over a hardcoded allow-list; user input never picks columns.
  const allowed = ['name', 'serving_size', ...NUTRITION, 'active'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (!(key in fields)) continue;
    let value;
    if (key === 'active') {
      value = fields[key] ? 1 : 0;           // better-sqlite3 can't bind JS booleans
    } else if (NUTRITION.includes(key)) {
      value = numOrNull(fields[key], key);
    } else if (key === 'name') {
      if (!fields.name || typeof fields.name !== 'string') {
        throw Object.assign(new Error('name is required'), { status: 400 });
      }
      value = fields.name;
    } else {
      value = fields[key];
    }
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return existing;

  sets.push(`updated_at = datetime('now')`);
  values.push(id);
  db.prepare(`UPDATE foods SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getFood(id);
}
