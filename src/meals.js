import { db } from '../db.js';
import { getSettings } from './settings.js';

// Meal planning + logging. Flow: slot foods into a day's buckets (kind='planned'),
// then logDay() snapshots the plan into kind='eaten' actuals. See migrations/003_meals.sql.

export const BUCKETS = ['breakfast', 'lunch', 'dinner', 'snacks'];

// Each tracked nutrient maps to a settings target column and a fixed goal direction:
//   ceiling = "stay under", floor = "eat at least". Direction is defined here (one place).
export const NUTRIENTS = [
  { key: 'calories',  target: 'target_calories',  direction: 'ceiling' },
  { key: 'protein_g', target: 'target_protein_g', direction: 'floor' },
  { key: 'carbs_g',   target: 'target_carbs_g',   direction: 'ceiling' },
  { key: 'fat_g',     target: 'target_fat_g',     direction: 'floor' },
  { key: 'fiber_g',   target: 'target_fiber_g',   direction: 'floor' },
  { key: 'sugar_g',   target: 'target_sugar_g',   direction: 'ceiling' },
];

const round1 = n => Math.round(n * 10) / 10;

function assertDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 });
  }
  return d;
}
function assertBucket(b) {
  if (!BUCKETS.includes(b)) {
    throw Object.assign(new Error(`bucket must be one of: ${BUCKETS.join(', ')}`), { status: 400 });
  }
  return b;
}
function assertQuantity(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error('quantity must be a positive number'), { status: 400 });
  }
  return n;
}

// planned rows carry LIVE food nutrition (JOIN foods) so edits flow through while planning.
// LEFT JOIN so a slot whose food was hard-deleted still returns (with null nutrition).
const plannedByDate = db.prepare(`
  SELECT me.id, me.food_id, me.bucket, me.quantity, me.position,
         f.name AS food_name, f.serving_size,
         f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.sugar_g
  FROM meal_entries me
  LEFT JOIN foods f ON f.id = me.food_id
  WHERE me.date = ? AND me.kind = 'planned'
  ORDER BY me.position ASC, me.id ASC
`);
const plannedById = db.prepare(`
  SELECT me.id, me.food_id, me.bucket, me.quantity, me.position,
         f.name AS food_name, f.serving_size,
         f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.sugar_g
  FROM meal_entries me
  LEFT JOIN foods f ON f.id = me.food_id
  WHERE me.id = ? AND me.kind = 'planned'
`);
// eaten rows read from their own SNAPSHOT columns — immune to later food edits/deletes.
const eatenByDate = db.prepare(`
  SELECT me.id, me.food_id, me.bucket, me.quantity, me.position,
         me.food_name, NULL AS serving_size,
         me.calories, me.protein_g, me.carbs_g, me.fat_g, me.fiber_g, me.sugar_g
  FROM meal_entries me
  WHERE me.date = ? AND me.kind = 'eaten'
  ORDER BY me.position ASC, me.id ASC
`);

// Entry nutrition columns are PER SERVING; a line's contribution is value * quantity.
function rollup(entries, settings) {
  const out = {};
  for (const { key, target, direction } of NUTRIENTS) {
    let total = 0;
    for (const e of entries) total += Number(e.quantity) * (e[key] ?? 0);
    total = round1(total);
    const t = settings[target] ?? null;
    const met = t == null ? null : (direction === 'ceiling' ? total <= t : total >= t);
    out[key] = { total, target: t, direction, met };
  }
  return out;
}

function groupBuckets(entries) {
  const buckets = {};
  for (const b of BUCKETS) buckets[b] = [];   // always all four, in order
  for (const e of entries) buckets[e.bucket].push(e);
  return buckets;
}

function buildSide(entries, settings) {
  return { buckets: groupBuckets(entries), rollup: rollup(entries, settings), count: entries.length };
}

// The one read the dashboard + planner use: both sides of a day plus whether it's logged.
export function getDay(date) {
  assertDate(date);
  const settings = getSettings();
  const planned = buildSide(plannedByDate.all(date), settings);
  const eaten = buildSide(eatenByDate.all(date), settings);
  return {
    date,
    planned: { buckets: planned.buckets, rollup: planned.rollup },
    eaten: { buckets: eaten.buckets, rollup: eaten.rollup },
    logged: eaten.count > 0,
  };
}

export function getPlannedEntry(id) {
  return plannedById.get(id);
}

export function addPlannedEntry({ date, bucket, food_id, quantity }) {
  assertDate(date);
  assertBucket(bucket);
  const fid = Number(food_id);
  if (!Number.isInteger(fid) || !db.prepare('SELECT 1 FROM foods WHERE id = ?').get(fid)) {
    throw Object.assign(new Error('food not found'), { status: 400 });
  }
  const q = assertQuantity(quantity ?? 1);
  // Append to the end of the bucket for that day.
  const { p } = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p
              FROM meal_entries WHERE date = ? AND kind = 'planned' AND bucket = ?`)
    .get(date, bucket);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO meal_entries (date, kind, bucket, food_id, quantity, position)
              VALUES (?, 'planned', ?, ?, ?, ?)`)
    .run(date, bucket, fid, q, p);
  return getPlannedEntry(lastInsertRowid);
}

export function updatePlannedEntry(id, fields) {
  const existing = getPlannedEntry(id);
  if (!existing) return null;

  const sets = [];
  const values = [];
  if ('bucket' in fields) { sets.push('bucket = ?'); values.push(assertBucket(fields.bucket)); }
  if ('quantity' in fields) { sets.push('quantity = ?'); values.push(assertQuantity(fields.quantity)); }
  if ('position' in fields) {
    const pos = Number(fields.position);
    if (!Number.isInteger(pos) || pos < 0) {
      throw Object.assign(new Error('position must be a non-negative integer'), { status: 400 });
    }
    sets.push('position = ?'); values.push(pos);
  }
  if (sets.length === 0) return existing;

  values.push(id);
  db.prepare(`UPDATE meal_entries SET ${sets.join(', ')} WHERE id = ? AND kind = 'planned'`).run(...values);
  return getPlannedEntry(id);
}

export function deletePlannedEntry(id) {
  const info = db.prepare(`DELETE FROM meal_entries WHERE id = ? AND kind = 'planned'`).run(id);
  return info.changes > 0;
}

// "Log Today's Food": replace-all snapshot of the day's plan into eaten actuals.
// Idempotent — re-logging after a swap wipes and re-snapshots. Nutrition is frozen from
// the food AT THIS MOMENT (INSERT ... SELECT), so later food edits won't rewrite history.
export function logDay(date) {
  assertDate(date);
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM meal_entries WHERE date = ? AND kind = 'eaten'`).run(date);
    db.prepare(`
      INSERT INTO meal_entries
        (date, kind, bucket, food_id, quantity, position,
         food_name, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g)
      SELECT me.date, 'eaten', me.bucket, me.food_id, me.quantity, me.position,
             f.name, f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.sugar_g
      FROM meal_entries me
      LEFT JOIN foods f ON f.id = me.food_id
      WHERE me.date = ? AND me.kind = 'planned'
    `).run(date);
  });
  run();
  return getDay(date);
}
