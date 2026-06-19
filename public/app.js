import { api } from '/api.js';
import { showError } from '/toast.js';

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
    const li = document.createElement('li');
    const id = `workout-${w.template_id}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.dataset.templateId = w.template_id;
    checkbox.checked = completed.has(w.template_id);
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = w.template_name;   // textContent — XSS-safe
    li.append(checkbox, label);
    list.appendChild(li);
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