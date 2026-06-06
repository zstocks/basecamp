import { db } from '../db.js';

const COLS = 'id, date, weight, water_ml, created_at, updated_at';

export function getBodyMetricForDate(date) {
  return db.prepare(`SELECT ${COLS} FROM body_metrics WHERE date = ?`).get(date);
}

export function listBodyMetrics({ from, to } = {}) {
  const conditions = [];
  const params = [];
  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to)   { conditions.push('date <= ?'); params.push(to); }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT ${COLS} FROM body_metrics${where} ORDER BY date DESC`).all(...params);
}

export function setBodyMetric({ date, weight, water_ml }) {
  if (!date) throw Object.assign(new Error('date is required'), { status: 400 });

  // COALESCE keeps the existing value when the new one is null —
  // so {date, weight: 220} alone doesn't wipe out water_ml.
  db.prepare(`
    INSERT INTO body_metrics (date, weight, water_ml)
    VALUES (?, ?, ?)
    ON CONFLICT (date) DO UPDATE SET
      weight = COALESCE(excluded.weight, body_metrics.weight),
      water_ml = COALESCE(excluded.water_ml, body_metrics.water_ml),
      updated_at = datetime('now')
  `).run(date, weight ?? null, water_ml ?? null);

  return getBodyMetricForDate(date);
}