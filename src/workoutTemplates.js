import { db } from '../db.js';

const TEMPLATE_COLS = 'id, name, note, active, created_at, updated_at';
const EXERCISE_COLS =
  'id, template_id, name, position, target_sets, target_reps, target_weight, note';

const insertExercise = db.prepare(`
  INSERT INTO template_exercises
    (template_id, name, position, target_sets, target_reps, target_weight, note)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Replace-all: wipe a template's exercises and re-insert from the given array.
// position falls out of array order; callers may override per-row. Must run
// inside a transaction (createTemplate/updateTemplate do).
function replaceExercises(templateId, exercises) {
  db.prepare('DELETE FROM template_exercises WHERE template_id = ?').run(templateId);
  exercises.forEach((ex, i) => {
    if (!ex || !ex.name || typeof ex.name !== 'string') {
      throw Object.assign(new Error('each exercise needs a name'), { status: 400 });
    }
    insertExercise.run(
      templateId,
      ex.name,
      ex.position ?? i,
      ex.target_sets ?? null,
      ex.target_reps ?? null,
      ex.target_weight ?? null,
      ex.note ?? null,
    );
  });
}

export function listTemplates() {
  return db
    .prepare(`SELECT ${TEMPLATE_COLS} FROM workout_templates ORDER BY active DESC, name ASC`)
    .all();
}

export function getTemplate(id) {
  const template = db
    .prepare(`SELECT ${TEMPLATE_COLS} FROM workout_templates WHERE id = ?`)
    .get(id);
  if (!template) return undefined;
  template.exercises = db
    .prepare(`SELECT ${EXERCISE_COLS} FROM template_exercises WHERE template_id = ? ORDER BY position ASC, id ASC`)
    .all(id);
  return template;
}

export function createTemplate({ name, note, exercises }) {
  if (!name || typeof name !== 'string') {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  if (exercises !== undefined && !Array.isArray(exercises)) {
    throw Object.assign(new Error('exercises must be an array'), { status: 400 });
  }

  const create = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO workout_templates (name, note) VALUES (?, ?)')
      .run(name, note ?? null);
    if (exercises) replaceExercises(lastInsertRowid, exercises);
    return lastInsertRowid;
  });

  return getTemplate(create());
}

export function updateTemplate(id, fields) {
  const existing = getTemplate(id);
  if (!existing) return null;

  const update = db.transaction(() => {
    // Dynamic UPDATE for only the template columns the caller sent.
    const allowed = ['name', 'note', 'active'];
    const sets = [];
    const values = [];
    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        // better-sqlite3 can't bind JS booleans — store active as 0/1.
        values.push(key === 'active' ? (fields[key] ? 1 : 0) : fields[key]);
      }
    }
    if (sets.length > 0) {
      sets.push(`updated_at = datetime('now')`);
      values.push(id);
      db.prepare(`UPDATE workout_templates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    // Replace-all on exercises, but only when the caller actually sent the array.
    if ('exercises' in fields) {
      if (!Array.isArray(fields.exercises)) {
        throw Object.assign(new Error('exercises must be an array'), { status: 400 });
      }
      replaceExercises(id, fields.exercises);
    }
  });

  update();
  return getTemplate(id);
}
