import { api } from '/api.js';
import { showError } from '/toast.js';
import {
  buildResolver, buildDays, walkStreak, longestStreak, completionRate, habitStats,
  summitPredicate, perfectPredicate, SUMMIT_THRESHOLD,
} from '/streaks.js';

const VALID_TABS = ['habits', 'workouts', 'diet'];
const NUM_WEEKS = 12;
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];   // 0=Sun..6=Sat

let sessionsByDate = new Map();   // 'YYYY-MM-DD' -> [session, ...]
let habitDays = new Map();        // 'YYYY-MM-DD' -> day summary, for the habit heatmap

init().catch(showError);

async function init() {
  const tab = currentTab();
  activateTab(tab);
  if (tab === 'habits') {
    await loadHabits();
  }
  if (tab === 'workouts') {
    await loadWorkouts();
    await loadExercisePicker();
  }
  bindLogout();
}

function currentTab() {
  const t = new URLSearchParams(location.search).get('tab');
  return VALID_TABS.includes(t) ? t : 'habits';   // default: habits
}

function activateTab(tab) {
  for (const t of VALID_TABS) {
    document.getElementById(`section-${t}`).hidden = t !== tab;
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  }
}

// --- habits ---

async function loadHabits() {
  const today = new Date();
  const startSunday = weekStart(today, NUM_WEEKS);

  const [habits, versions, logRows] = await Promise.all([
    api.get('/api/habits'),
    api.get('/api/habit-versions'),
    api.get(`/api/habit-logs?from=${ymd(startSunday)}&to=${ymd(today)}`),
  ]);

  // Newest first, matching the dashboard, so the same streak walkers apply.
  const dates = [];
  for (let d = new Date(today); ymd(d) >= ymd(startSunday); d.setDate(d.getDate() - 1)) {
    dates.push(ymd(d));
  }

  const resolver = buildResolver(versions);
  const days = buildDays(dates, logRows, habits, resolver);
  habitDays = new Map(days.map(d => [d.date, d]));

  renderHabitStreaks(days);
  renderHabitHeatmap(startSunday, today);
  renderHabitBreakdown(habits, days);
}

function renderHabitStreaks(days) {
  setText('hb-summit-current', walkStreak(days, summitPredicate).streak);
  setText('hb-summit-best', longestStreak(days, summitPredicate));
  setText('hb-perfect-current', walkStreak(days, perfectPredicate).streak);
  setText('hb-perfect-best', longestStreak(days, perfectPredicate));

  document.getElementById('hb-rule').textContent =
    `A day summits at ${Math.round(SUMMIT_THRESHOLD * 100)}% of scheduled habits; `
    + `perfect means all of them. Days with nothing scheduled are rest — they neither `
    + `extend nor break a run. Measured over the last ${NUM_WEEKS} weeks.`;

  const rate = completionRate(days);
  const scheduledDays = days.filter(d => d.scheduled.length > 0).length;
  document.getElementById('hb-summary').textContent = rate === null
    ? 'No habits scheduled in this window yet.'
    : `${pct(rate)} of scheduled habits completed across ${scheduledDays} active day${scheduledDays === 1 ? '' : 's'}.`;
}

function renderHabitHeatmap(startSunday, today) {
  const hm = document.getElementById('habit-heatmap');
  hm.innerHTML = '';
  hm.appendChild(dowHeader());

  const todayStr = ymd(today);
  for (let w = 0; w < NUM_WEEKS; w++) {
    const week = document.createElement('div');
    week.className = 'hm-week';
    for (let d = 0; d < 7; d++) {
      const date = new Date(startSunday);
      date.setDate(date.getDate() + w * 7 + d);
      week.appendChild(habitCell(ymd(date), todayStr));
    }
    hm.appendChild(week);
  }
}

function habitCell(ds, todayStr) {
  const el = document.createElement('div');
  el.className = 'hm-cell';

  if (ds > todayStr) {                      // lexicographic works for YYYY-MM-DD
    el.classList.add('future');
    return el;
  }

  const day = habitDays.get(ds);
  if (!day || day.scheduled.length === 0) {
    el.classList.add('rest');
    el.title = `${ds} — rest day, nothing scheduled`;
    return el;
  }

  const ratio = day.doneCount / day.scheduled.length;
  el.classList.add(ratio === 1 ? 'perfect' : ratio >= SUMMIT_THRESHOLD ? 'summit' : 'broken');
  el.title = `${ds} — ${day.doneCount}/${day.scheduled.length} habits (${pct(ratio)})`;
  return el;
}

function renderHabitBreakdown(habits, days) {
  const wrap = document.getElementById('habit-breakdown');
  wrap.innerHTML = '';

  // Only habits that were actually scheduled at some point in the window —
  // one archived last year shouldn't clutter the list with a 0/0 row.
  const rows = habits
    .map(h => ({ habit: h, stats: habitStats(h.id, days) }))
    .filter(r => r.stats.scheduled > 0);

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No habits were scheduled in this window yet.';
    wrap.appendChild(p);
    return;
  }

  rows.sort((a, b) => (b.stats.rate ?? 0) - (a.stats.rate ?? 0));

  for (const { habit, stats } of rows) {
    const row = document.createElement('div');
    row.className = 'hb-row';

    const name = document.createElement('span');
    name.className = 'hb-name';
    name.textContent = habit.name;          // textContent — XSS-safe
    if (!habit.active) name.classList.add('archived');

    const bar = document.createElement('div');
    bar.className = 'hb-bar';
    const fill = document.createElement('div');
    fill.className = 'hb-fill';
    fill.style.width = `${Math.round((stats.rate ?? 0) * 100)}%`;
    bar.appendChild(fill);

    const figures = document.createElement('span');
    figures.className = 'hb-figures';
    figures.textContent = `${pct(stats.rate)} · ${stats.done}/${stats.scheduled}`;

    const streak = document.createElement('span');
    streak.className = 'hb-streaks';
    streak.textContent = `now ${stats.current} · best ${stats.longest}`;
    streak.title = 'Current run · longest run in this window';

    row.append(name, bar, figures, streak);
    wrap.appendChild(row);
  }
}

// Sunday, `weeks` weeks back — the top-left cell of a heatmap.
function weekStart(today, weeks) {
  const d = new Date(today);
  d.setDate(d.getDate() - d.getDay() - (weeks - 1) * 7);
  return d;
}

function dowHeader() {
  const head = document.createElement('div');
  head.className = 'hm-head';
  for (const l of DOW_LABELS) {
    const c = document.createElement('span');
    c.className = 'hm-dow';
    c.textContent = l;
    head.appendChild(c);
  }
  return head;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function pct(rate) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

// --- workout consistency heatmap ---

async function loadWorkouts() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Start on the Sunday of the earliest week so rows align to weeks.
  const startSunday = new Date(today);
  startSunday.setDate(startSunday.getDate() - today.getDay() - (NUM_WEEKS - 1) * 7);

  const summary = document.getElementById('wk-summary');
  let sessions;
  try {
    sessions = await api.get(`/api/workout-sessions?from=${ymd(startSunday)}&to=${ymd(today)}`);
  } catch (err) {
    summary.textContent = '';
    return showError(err);
  }

  sessionsByDate = new Map();
  for (const s of sessions) {
    if (!sessionsByDate.has(s.date)) sessionsByDate.set(s.date, []);
    sessionsByDate.get(s.date).push(s);
  }

  const completed = sessions.filter(s => s.completed === 1);
  const dayCount = new Set(completed.map(s => s.date)).size;
  summary.textContent =
    `${completed.length} workout${completed.length === 1 ? '' : 's'} completed on `
    + `${dayCount} day${dayCount === 1 ? '' : 's'} in the last ${NUM_WEEKS} weeks.`;

  renderHeatmap(startSunday, today);
}

function renderHeatmap(startSunday, today) {
  const hm = document.getElementById('heatmap');
  hm.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'hm-head';
  for (const l of DOW_LABELS) {
    const c = document.createElement('span');
    c.className = 'hm-dow';
    c.textContent = l;
    head.appendChild(c);
  }
  hm.appendChild(head);

  const todayStr = ymd(today);
  for (let w = 0; w < NUM_WEEKS; w++) {
    const week = document.createElement('div');
    week.className = 'hm-week';
    for (let d = 0; d < 7; d++) {
      const date = new Date(startSunday);
      date.setDate(date.getDate() + w * 7 + d);
      week.appendChild(cell(date, todayStr));
    }
    hm.appendChild(week);
  }
}

function cell(date, todayStr) {
  const ds = ymd(date);
  const el = document.createElement('div');
  el.className = 'hm-cell';
  el.dataset.date = ds;

  const future = ds > todayStr;          // lexicographic works for YYYY-MM-DD
  const daySessions = sessionsByDate.get(ds) || [];
  const done = daySessions.some(s => s.completed === 1);

  if (future) el.classList.add('future');
  else if (done) el.classList.add('done');

  el.title = ds + (daySessions.length
    ? ` — ${daySessions.map(s => s.template_name || 'Workout').join(', ')}`
    : '');

  if (!future && daySessions.length) {
    el.classList.add('clickable');
    el.addEventListener('click', () => selectDay(ds, el));
  }
  return el;
}

// --- day drill-down ---

async function selectDay(ds, el) {
  document.querySelectorAll('.hm-cell.selected').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  const detail = document.getElementById('day-detail');
  detail.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = prettyDate(ds);
  detail.appendChild(heading);

  for (const session of sessionsByDate.get(ds) || []) {
    detail.appendChild(await sessionDetail(session));
  }
}

async function sessionDetail(session) {
  const wrap = document.createElement('div');
  wrap.className = 'session-detail';

  const h = document.createElement('h4');
  h.textContent = (session.template_name || 'Workout') + (session.completed === 1 ? ' ✓' : '');
  wrap.appendChild(h);

  let sets = [];
  try {
    sets = await api.get(`/api/workout-sessions/${session.id}/sets`);
  } catch (err) {
    showError(err);
  }

  if (sets.length === 0) {
    const p = document.createElement('p');
    p.className = 'sched-empty';
    p.textContent = 'No sets logged.';
    wrap.appendChild(p);
    return wrap;
  }

  const groups = new Map();   // exercise_name -> [set, ...]
  for (const s of sets) {
    if (!groups.has(s.exercise_name)) groups.set(s.exercise_name, []);
    groups.get(s.exercise_name).push(s);
  }

  const ul = document.createElement('ul');
  ul.className = 'detail-exercises';
  for (const [name, rows] of groups) {
    const li = document.createElement('li');
    const exName = document.createElement('span');
    exName.className = 'detail-ex-name';
    exName.textContent = name;                 // textContent — XSS-safe
    const setsText = document.createElement('span');
    setsText.className = 'detail-sets';
    setsText.textContent = rows.map(fmtSet).join(', ');
    li.append(exName, setsText);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function fmtSet(r) {
  const reps = r.reps ?? '—';
  return r.weight == null ? `${reps}` : `${reps}×${r.weight}`;
}

// --- per-exercise progress (top set per day) ---

async function loadExercisePicker() {
  const select = document.getElementById('exercise-select');
  let names = [];
  try {
    names = await api.get('/api/exercise-names');
  } catch (err) {
    return showError(err);
  }

  select.innerHTML = '';
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No logged exercises yet';
    opt.value = '';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;            // textContent — XSS-safe
    select.appendChild(opt);
  }
  select.addEventListener('change', () => renderProgress(select.value));
  await renderProgress(select.value);
}

async function renderProgress(exercise) {
  const list = document.getElementById('progress-list');
  const hint = document.getElementById('progress-hint');
  list.innerHTML = '';
  if (!exercise) { hint.hidden = true; return; }

  let sets = [];
  try {
    sets = await api.get(`/api/session-sets?exercise=${encodeURIComponent(exercise)}`);
  } catch (err) {
    return showError(err);
  }

  // Reduce to the top set per day: heaviest weight, tie-break by reps. For
  // bodyweight exercises (no weight) this falls back to most reps.
  const byDate = new Map();
  for (const s of sets) {
    const cur = byDate.get(s.date);
    if (!cur || isBetter(s, cur)) byDate.set(s.date, s);
  }
  const days = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])); // newest first

  hint.hidden = days.length === 0;
  if (days.length === 0) {
    const p = document.createElement('p');
    p.className = 'sched-empty';
    p.textContent = 'No sets logged for this exercise.';
    list.appendChild(p);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'detail-exercises';
  for (const [date, best] of days) {
    const li = document.createElement('li');
    const d = document.createElement('span');
    d.className = 'detail-ex-name';
    d.textContent = shortDate(date);
    const v = document.createElement('span');
    v.className = 'detail-sets';
    v.textContent = fmtSet(best);
    li.append(d, v);
    ul.appendChild(li);
  }
  list.appendChild(ul);
}

function isBetter(a, b) {
  const aw = a.weight ?? -1;
  const bw = b.weight ?? -1;
  if (aw !== bw) return aw > bw;
  return (a.reps ?? -1) > (b.reps ?? -1);
}

function shortDate(ds) {
  return new Date(ds + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- helpers ---

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(ds) {
  return new Date(ds + 'T00:00:00')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function bindLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.post('/logout');
      window.location.href = '/login.html';
    } catch (err) {
      showError(err);
    }
  });
}
