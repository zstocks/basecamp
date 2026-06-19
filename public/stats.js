import { api } from '/api.js';
import { showError } from '/toast.js';

const VALID_TABS = ['habits', 'workouts', 'diet'];
const NUM_WEEKS = 12;
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];   // 0=Sun..6=Sat

let sessionsByDate = new Map();   // 'YYYY-MM-DD' -> [session, ...]

init().catch(showError);

async function init() {
  const tab = currentTab();
  activateTab(tab);
  if (tab === 'workouts') await loadWorkouts();
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
