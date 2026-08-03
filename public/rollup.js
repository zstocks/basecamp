// Shared daily nutrient rollup renderer — used by the planner and the dashboard.
// Input: the rollup map from GET /api/meals, keyed by nutrient. Each value is
//   { total, target, direction: 'ceiling'|'floor', met: true|false|null }.
// Direction is the goal shape: ceiling = "stay under" (↓), floor = "reach at least" (↑).

const LABELS = {
  calories: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs',
  fat_g: 'Fat', fiber_g: 'Fiber', sugar_g: 'Sugar',
};
const ORDER = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'];

const fmt = n => (n == null ? '—' : String(Math.round(n * 10) / 10));
const unit = key => (key === 'calories' ? '' : ' g');

export function renderRollup(rollup) {
  const wrap = document.createElement('div');
  wrap.className = 'rollup';
  for (const key of ORDER) {
    if (rollup[key]) wrap.appendChild(rollupRow(key, rollup[key]));
  }
  return wrap;
}

function rollupRow(key, r) {
  const row = document.createElement('div');
  row.className = 'rollup-row';
  // Colour by outcome: met = ok (green); over a ceiling = danger; under a floor = warn.
  row.classList.add(
    r.target == null ? 'rollup-none'
      : r.met ? 'rollup-ok'
      : r.direction === 'ceiling' ? 'rollup-over'
      : 'rollup-under',
  );

  const name = document.createElement('span');
  name.className = 'rollup-name';
  name.textContent = LABELS[key];
  const dir = document.createElement('span');
  dir.className = 'rollup-dir';
  dir.textContent = r.direction === 'ceiling' ? ' ↓' : ' ↑';   // ↓ stay under · ↑ reach
  name.appendChild(dir);

  const val = document.createElement('span');
  val.className = 'rollup-value';
  val.textContent = r.target == null
    ? `${fmt(r.total)}${unit(key)}`
    : `${fmt(r.total)} / ${fmt(r.target)}${unit(key)}`;

  const note = document.createElement('span');
  note.className = 'rollup-note';
  note.textContent = statusNote(r);

  row.append(name, val, note);
  return row;
}

function statusNote(r) {
  if (r.target == null) return 'no target';
  if (r.met) return '✓';
  if (r.direction === 'ceiling') return `${fmt(r.total - r.target)} over`;
  return `${fmt(r.target - r.total)} to go`;
}
