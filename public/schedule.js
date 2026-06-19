import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';

// 0=Sun..6=Sat — matches the server's day-of-week convention.
const DOW = [
  { n: 0, label: 'Sunday' },
  { n: 1, label: 'Monday' },
  { n: 2, label: 'Tuesday' },
  { n: 3, label: 'Wednesday' },
  { n: 4, label: 'Thursday' },
  { n: 5, label: 'Friday' },
  { n: 6, label: 'Saturday' },
];

const els = {
  form: document.getElementById('assign-form'),
  template: document.getElementById('template'),
  weekday: document.getElementById('weekday'),
  assignBtn: document.getElementById('assign-btn'),
  schedule: document.getElementById('schedule'),
};

let templates = [];
let schedule = [];

init().catch(showError);

async function init() {
  buildWeekdayOptions();
  await load();
  bindEvents();
}

async function load() {
  [templates, schedule] = await Promise.all([
    api.get('/api/workout-templates'),
    api.get('/api/workout-schedule'),
  ]);
  buildTemplateOptions();
  render();
}

// --- form selects ---

function buildWeekdayOptions() {
  els.weekday.innerHTML = '';
  for (const d of DOW) {
    const opt = document.createElement('option');
    opt.value = String(d.n);
    opt.textContent = d.label;
    els.weekday.appendChild(opt);
  }
  // Default to today for convenience (getDay(): 0=Sun..6=Sat, same convention).
  els.weekday.value = String(new Date().getDay());
}

function buildTemplateOptions() {
  const active = templates.filter(t => t.active === 1);
  els.template.innerHTML = '';

  if (active.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No templates — create one first';
    opt.value = '';
    els.template.appendChild(opt);
    els.template.disabled = true;
    els.assignBtn.disabled = true;
    return;
  }

  els.template.disabled = false;
  els.assignBtn.disabled = false;
  for (const t of active) {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = t.name;          // textContent — XSS-safe
    els.template.appendChild(opt);
  }
}

// --- weekly list (vertical, one block per day — mobile-friendly) ---

function render() {
  els.schedule.innerHTML = '';
  for (const d of DOW) {
    const entries = schedule.filter(s => s.weekday === d.n);
    els.schedule.appendChild(dayBlock(d, entries));
  }
}

function dayBlock(day, entries) {
  const block = document.createElement('div');
  block.className = 'sched-day';

  const h = document.createElement('h3');
  h.textContent = day.label;
  block.appendChild(h);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sched-empty';
    empty.textContent = 'Rest day';
    block.appendChild(empty);
    return block;
  }

  const ul = document.createElement('ul');
  ul.className = 'sched-items';
  for (const e of entries) ul.appendChild(entryItem(e));
  block.appendChild(ul);
  return block;
}

function entryItem(entry) {
  const li = document.createElement('li');
  li.className = 'sched-item';

  const name = document.createElement('span');
  name.className = 'sched-name';
  name.textContent = entry.template_name;   // textContent — XSS-safe
  li.appendChild(name);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost remove-sched';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove ${entry.template_name}`);
  remove.addEventListener('click', () => removeEntry(entry));
  li.appendChild(remove);

  return li;
}

// --- actions ---

async function removeEntry(entry) {
  try {
    await api.delete(`/api/workout-schedule/${entry.id}`);
    await load();
    showSuccess(`Removed "${entry.template_name}"`);
  } catch (err) {
    showError(err);
  }
}

function bindEvents() {
  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const template_id = Number(els.template.value);
    const weekday = Number(els.weekday.value);
    if (!template_id) return showError(new Error('Pick a workout'));
    try {
      await api.post('/api/workout-schedule', { template_id, weekday });
      await load();
      showSuccess('Added to schedule');
    } catch (err) {
      showError(err);
    }
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
