import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';

const today = ymd(new Date());
const todayDow = new Date().getDay();   // 0=Sun..6=Sat

let habits = [];
let todaysLogs = [];
let todaysMetrics = null;
let settings = null;
let weekData = [];      // [{ date, dow, scheduled, doneCount, summit }]
let todaysWorkouts = [];  // schedule entries for today's weekday
let todaysSessions = [];  // workout_sessions for today

init().catch(showError);

async function init() {
  await loadData();
  renderTodayHeader();
  renderHabits();
  renderWorkouts();
  renderMetrics();
  renderWeek();
  renderStreak();
  bindEvents();
}

async function loadData() {
  const dates = lastNDates(7); // index 0 = today, newest first

  const [habitsRes, settingsRes, metricsRes, scheduleRes, sessionsRes, ...logsByDate] = await Promise.all([
    api.get('/api/habits'),
    api.get('/api/settings'),
    api.get(`/api/body-metrics?date=${today}`),
    api.get(`/api/workout-schedule?weekday=${todayDow}`),
    api.get(`/api/workout-sessions?date=${today}`),
    ...dates.map(d => api.get(`/api/habit-logs?date=${d}`)),
  ]);

  habits = habitsRes;
  settings = settingsRes;
  todaysMetrics = metricsRes;
  todaysWorkouts = scheduleRes;
  todaysSessions = sessionsRes;
  todaysLogs = logsByDate[0];

  weekData = dates.map((date, i) => {
    const dow = new Date(date + 'T00:00:00').getDay();
    const scheduled = habits.filter(h => isScheduledForDay(h, dow));
    const doneIds = new Set(logsByDate[i].filter(l => l.done === 1).map(l => l.habit_id));
    const doneCount = scheduled.filter(h => doneIds.has(h.id)).length;
    const summit = scheduled.length === 0 ? null : (doneCount / scheduled.length) >= 0.5;
    return { date, dow, scheduled, doneCount, summit };
  });
}

function isScheduledForDay(habit, dow) {
  if (!habit.active) return false;
  if (habit.cadence_type === 'daily') return true;
  if (habit.cadence_type === 'weekly') return true;  // shows every day; user picks when
  if (habit.cadence_type === 'weekdays') {
    return (habit.cadence_days || '').split(',').map(Number).includes(dow);
  }
  return false;
}

function renderTodayHeader() {
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function renderHabits() {
  const list = document.getElementById('habits-list');
  const empty = document.getElementById('habits-empty');
  list.innerHTML = '';

  const scheduled = habits.filter(h => isScheduledForDay(h, todayDow));
  if (scheduled.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  const doneIds = new Set(todaysLogs.filter(l => l.done === 1).map(l => l.habit_id));

  for (const habit of scheduled) {
    const li = document.createElement('li');
    const id = `habit-${habit.id}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.dataset.habitId = habit.id;
    checkbox.checked = doneIds.has(habit.id);
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = habit.name;   // setting textContent avoids XSS, no escape() needed
    li.append(checkbox, label);
    list.appendChild(li);
  }
}

function renderWorkouts() {
  const list = document.getElementById('workouts-list');
  const empty = document.getElementById('workouts-empty');
  list.innerHTML = '';

  if (todaysWorkouts.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  const completed = new Set(
    todaysSessions.filter(s => s.completed === 1).map(s => s.template_id)
  );

  for (const w of todaysWorkouts) {
    list.appendChild(workoutItem(w, completed.has(w.template_id)));
  }
}

function workoutItem(w, isComplete) {
  const li = document.createElement('li');
  li.className = 'workout-item';

  const row = document.createElement('div');
  row.className = 'workout-row';

  const id = `workout-${w.template_id}`;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = id;
  checkbox.dataset.templateId = w.template_id;
  checkbox.checked = isComplete;

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = w.template_name;   // textContent — XSS-safe

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ghost toggle-sets';
  toggle.textContent = 'Log sets';

  const panel = document.createElement('div');
  panel.className = 'workout-sets';
  panel.hidden = true;

  toggle.addEventListener('click', () => toggleSetsPanel(w, panel, toggle));

  row.append(checkbox, label, toggle);
  li.append(row, panel);
  return li;
}

// --- inline set logging ---

async function toggleSetsPanel(w, panel, toggle) {
  if (!panel.hidden) {                 // collapse
    panel.hidden = true;
    toggle.textContent = 'Log sets';
    return;
  }
  panel.hidden = false;
  toggle.textContent = 'Hide sets';
  if (panel.dataset.loaded) return;    // build the grid only once

  panel.textContent = 'Loading…';
  try {
    const template = await api.get(`/api/workout-templates/${w.template_id}`);
    const session = todaysSessions.find(s => s.template_id === w.template_id);
    const existing = session
      ? await api.get(`/api/workout-sessions/${session.id}/sets`)
      : [];
    buildSetsPanel(panel, w, template, existing);
    panel.dataset.loaded = '1';
  } catch (err) {
    panel.hidden = true;
    toggle.textContent = 'Log sets';
    showError(err);
  }
}

function buildSetsPanel(panel, w, template, existing) {
  panel.textContent = '';

  const grid = document.createElement('div');
  grid.className = 'sets-grid';
  // Existing logged sets win; otherwise pre-fill from the template's targets.
  // Either way each group carries its planned target so we can show plan vs actual.
  const planned = plannedMap(template);
  const groups = existing.length
    ? groupExisting(existing, planned)
    : groupFromTemplate(template);
  for (const g of groups) grid.appendChild(exerciseGroup(g));
  panel.appendChild(grid);

  if (groups.length === 0) {
    const note = document.createElement('p');
    note.className = 'sched-empty';
    note.textContent = 'This template has no exercises.';
    panel.appendChild(note);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary save-sets';
  save.textContent = 'Save sets';
  save.addEventListener('click', () => saveSets(w, grid, save));
  panel.appendChild(save);
}

// Planned target per exercise name (from the template), shown muted beside each actual.
function plannedMap(template) {
  const m = new Map();
  for (const ex of template.exercises ?? []) {
    m.set(ex.name, { reps: ex.target_reps ?? '', weight: ex.target_weight ?? '' });
  }
  return m;
}

function groupFromTemplate(template) {
  return (template.exercises ?? []).map(ex => {
    const n = Number.isInteger(ex.target_sets) && ex.target_sets > 0 ? ex.target_sets : 1;
    const planned = { reps: ex.target_reps ?? '', weight: ex.target_weight ?? '' };
    const sets = [];
    for (let i = 0; i < n; i++) {
      // Actuals start empty so an unfilled box reads as "not done yet"; the muted
      // planned hint beside it shows the target to aim for.
      sets.push({ reps: '', weight: '' });
    }
    return { name: ex.name, planned, sets };
  });
}

function groupExisting(rows, planned) {
  const map = new Map();      // exercise_name -> [{reps, weight}], first-seen order
  for (const r of rows) {
    if (!map.has(r.exercise_name)) map.set(r.exercise_name, []);
    map.get(r.exercise_name).push({ reps: r.reps ?? '', weight: r.weight ?? '' });
  }
  return [...map.entries()].map(([name, sets]) => ({
    name,
    planned: planned.get(name) ?? { reps: '', weight: '' },
    sets,
  }));
}

function exerciseGroup(g) {
  const wrap = document.createElement('div');
  wrap.className = 'exercise-group';
  wrap.dataset.exercise = g.name;

  const h = document.createElement('h4');
  h.className = 'exercise-name';
  h.textContent = g.name;                // textContent — XSS-safe
  wrap.appendChild(h);

  // Column header so the muted numbers read as "planned", the boxes as "actual".
  const head = document.createElement('div');
  head.className = 'set-head';
  for (const text of ['', 'reps', 'weight', '']) {
    const cell = document.createElement('span');
    cell.className = 'set-col';
    cell.textContent = text;
    head.appendChild(cell);
  }
  wrap.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'set-rows';
  wrap.appendChild(rows);

  for (const s of g.sets) rows.appendChild(setRow(s, rows, g.planned));
  renumber(rows);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ghost add-set';
  add.textContent = '+ Add set';
  add.addEventListener('click', () => {
    rows.appendChild(setRow({ reps: '', weight: '' }, rows, g.planned));
    renumber(rows);
  });
  wrap.appendChild(add);

  return wrap;
}

function setRow(s, rows, planned) {
  const row = document.createElement('div');
  row.className = 'set-row';

  const num = document.createElement('span');
  num.className = 'set-num';

  const reps = setField('Reps', s.reps, '1', 'set-reps', planned.reps);
  const weight = setField('Weight', s.weight, '0.5', 'set-weight', planned.weight);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost remove-set';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove set');
  remove.addEventListener('click', () => { row.remove(); renumber(rows); });

  row.append(num, reps, weight, remove);
  return row;
}

// One field cell: muted planned target ("10 →") + the editable actual input.
function setField(placeholder, actual, step, inputClass, plannedVal) {
  const cell = document.createElement('div');
  cell.className = 'set-field';

  const plan = document.createElement('span');
  plan.className = 'set-planned';
  plan.textContent = plannedVal === '' || plannedVal == null ? '' : `${plannedVal} →`;

  const input = numberInput(placeholder, actual, step);
  input.classList.add(inputClass);

  cell.append(plan, input);
  return cell;
}

function numberInput(placeholder, value, step) {
  const el = document.createElement('input');
  el.type = 'number';
  el.placeholder = placeholder;
  el.value = value ?? '';
  el.min = '0';
  el.step = step;
  return el;
}

function renumber(rows) {
  [...rows.children].forEach((row, i) => {
    const num = row.querySelector('.set-num');
    if (num) num.textContent = `Set ${i + 1}`;
  });
}

function readSets(grid) {
  const sets = [];
  for (const group of grid.querySelectorAll('.exercise-group')) {
    const name = group.dataset.exercise;
    [...group.querySelectorAll('.set-row')].forEach((row, i) => {
      const reps = row.querySelector('.set-reps').value;
      const weight = row.querySelector('.set-weight').value;
      sets.push({
        exercise_name: name,
        set_number: i + 1,
        reps: reps === '' ? null : Number(reps),
        weight: weight === '' ? null : Number(weight),
      });
    });
  }
  return sets;
}

async function saveSets(w, grid, btn) {
  btn.disabled = true;
  try {
    // A session must exist to hang sets on; create one (preserving the current
    // completion checkbox) only if today doesn't have one yet.
    let session = todaysSessions.find(s => s.template_id === w.template_id);
    if (!session) {
      const checkbox = document.getElementById(`workout-${w.template_id}`);
      session = await api.put('/api/workout-sessions', {
        date: today,
        template_id: w.template_id,
        completed: checkbox?.checked ?? false,
      });
      todaysSessions = await api.get(`/api/workout-sessions?date=${today}`);
    }
    await api.put(`/api/workout-sessions/${session.id}/sets`, { sets: readSets(grid) });
    showSuccess('Sets saved');
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
  }
}

function renderMetrics() {
  document.getElementById('weight-input').value = todaysMetrics?.weight ?? '';
  document.getElementById('water-current').textContent = todaysMetrics?.water_ml ?? 0;
  document.getElementById('water-target').textContent =
    settings?.target_water_ml ? ` / ${settings.target_water_ml}` : '';
}

function renderWeek() {
  const strip = document.getElementById('week-strip');
  strip.innerHTML = '';
  // weekData is newest first; render oldest first so the strip reads left-to-right
  for (const day of [...weekData].reverse()) {
    const li = document.createElement('li');
    li.className = day.summit === true ? 'summit'
                 : day.summit === false ? 'broken'
                 : 'rest';
    const dayLabel = new Date(day.date + 'T00:00:00')
      .toLocaleDateString('en-US', { weekday: 'narrow' });
    li.innerHTML = `<span class="day">${dayLabel}</span><span class="dot"></span>`;
    li.title = `${day.date}: ${day.doneCount}/${day.scheduled.length} habits`;
    strip.appendChild(li);
  }
}

function renderStreak() {
  // Walk from today backwards: rest days pass through, broken days stop the count.
  let streak = 0;
  for (const day of weekData) {
    if (day.summit === false) break;
    if (day.summit === true) streak++;
  }
  document.getElementById('streak-number').textContent = streak;
}

function bindEvents() {
  document.getElementById('habits-list').addEventListener('change', async (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    const habitId = Number(e.target.dataset.habitId);
    const done = e.target.checked;
    try {
      await api.put('/api/habit-logs', { habit_id: habitId, date: today, done });
      await loadData();
      renderWeek();
      renderStreak();
    } catch (err) {
      e.target.checked = !done;
      showError(err);
    }
  });

  document.getElementById('workouts-list').addEventListener('change', async (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    const templateId = Number(e.target.dataset.templateId);
    const completed = e.target.checked;
    try {
      await api.put('/api/workout-sessions', { date: today, template_id: templateId, completed });
      // Refresh today's sessions so state stays in sync (workouts don't feed the streak yet).
      todaysSessions = await api.get(`/api/workout-sessions?date=${today}`);
    } catch (err) {
      e.target.checked = !completed;
      showError(err);
    }
  });

  document.getElementById('weight-input').addEventListener('change', async (e) => {
    const weight = parseFloat(e.target.value);
    if (Number.isNaN(weight)) return;
    try {
      todaysMetrics = await api.put('/api/body-metrics', { date: today, weight });
    } catch (err) {
      showError(err);
    }
  });

  document.querySelectorAll('.water-buttons button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const amount = Number(btn.dataset.amount);
      const current = todaysMetrics?.water_ml ?? 0;
      try {
        todaysMetrics = await api.put('/api/body-metrics', { date: today, water_ml: current + amount });
        renderMetrics();
      } catch (err) {
        showError(err);
      }
    });
  });

  document.querySelectorAll('.emergency button').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.post('/api/cravings', { response: btn.dataset.response, resisted: true });
        btn.classList.add('logged');
        setTimeout(() => btn.classList.remove('logged'), 1500);
      } catch (err) {
        showError(err);
      }
    });
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.post('/logout');
      window.location.href = '/login.html';
    } catch (err) {
      showError(err);
    }
  });
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lastNDates(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}