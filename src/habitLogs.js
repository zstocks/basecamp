import { db } from '../db.js';

export function getLogsForDate(date) {
  return db.prepare(`
    SELECT habit_id, date, done
    FROM habit_logs
    WHERE date = ?
  `).all(date);
}

export function setHabitLog({ habit_id, date, done }) {
  if (!habit_id || !date) {
    throw Object.assign(new Error('habit_id and date are required'), { status: 400 });
  }

  // Upsert: insert a new log row, or update the existing one for this (habit, date).
  db.prepare(`
    INSERT INTO habit_logs (habit_id, date, done)
    VALUES (?, ?, ?)
    ON CONFLICT (habit_id, date) DO UPDATE SET done = excluded.done
  `).run(habit_id, date, done ? 1 : 0);

  return db.prepare(
    `SELECT habit_id, date, done FROM habit_logs WHERE habit_id = ? AND date = ?`
  ).get(habit_id, date);
}