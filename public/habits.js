import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';

// 0=Sun..6=Sat — matches the server's day-of-week convention.
const DOW = [
  { n: 0, label: 'Sun' },
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
];

const els = {
  form: document.getElementById('habit-form'),
  formTitle: document.getElementById('form-title'),
  id: document.getElementById('habit-id'),
  name: document.getElementById('name'),
  note: document.getElementById('note'),
  cadenceType: document.getElementById('cadence_type'),
  countField: document.getElementById('count-field'),
  cadenceCount: document.getElementById('cadence_count'),
  daysField: document.getElementById('days-field'),
  dayPicker: document.getElementById('day-picker'),
  submitBtn: document.getElementById('submit-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  activeList: document.getElementById('active-list'),
  activeEmpty: document.getElementById('active-empty'),
  archivedCard: document.getElementById('archived-card'),
  archivedList: document.getElementById('archived-list'),
};

let habits = [];

init().catch(showError);

async function init() {
  buildDayPicker();
  syncCadenceFields();
  await load();
  bindEvents();
}

async function load() {
  habits = await api.get('/api/habits');
  render();
}

// --- form ---

function buildDayPicker() {
  els.dayPicker.innerHTML = '';
  for (const d of DOW) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-toggle';
    btn.dataset.dow = d.n;
    btn.textContent = d.label;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!on));
    });
    els.dayPicker.appendChild(btn);
  }
}

function syncCadenceFields() {
  const type = els.cadenceType.value;
  els.countField.hidden = type !== 'weekly';
  els.daysField.hidden = type !== 'weekdays';
}

function selectedDays() {
  return [...els.dayPicker.querySelectorAll('[aria-pressed="true"]')]
    .map(b => Number(b.dataset.dow))
    .sort((a, b) => a - b);
}

function setSelectedDays(csv) {
  const set = new Set((csv || '').split(',').filter(Boolean).map(Number));
  for (const btn of els.dayPicker.querySelectorAll('.day-toggle')) {
    btn.setAttribute('aria-pressed', String(set.has(Number(btn.dataset.dow))));
  }
}

function resetForm() {
  els.form.reset();
  els.id.value = '';
  setSelectedDays('');
  syncCadenceFields();
  els.formTitle.textContent = 'Add a habit';
  els.submitBtn.textContent = 'Add habit';
  els.cancelBtn.hidden = true;
}

function startEdit(habit) {
  els.id.value = habit.id;
  els.name.value = habit.name;
  els.note.value = habit.note ?? '';
  els.cadenceType.value = habit.cadence_type;
  els.cadenceCount.value = habit.cadence_count ?? '';
  setSelectedDays(habit.cadence_days);
  syncCadenceFields();
  els.formTitle.textContent = 'Edit habit';
  els.submitBtn.textContent = 'Save changes';
  els.cancelBtn.hidden = false;
  els.name.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function readForm() {
  const name = els.name.value.trim();
  if (!name) throw new Error('Name is required');

  const type = els.cadenceType.value;
  const payload = {
    name,
    note: els.note.value.trim() || null,
    cadence_type: type,
    cadence_count: null,
    cadence_days: null,
  };

  if (type === 'weekly') {
    const n = parseInt(els.cadenceCount.value, 10);
    payload.cadence_count = Number.isInteger(n) ? n : null;
  } else if (type === 'weekdays') {
    const days = selectedDays();
    if (days.length === 0) throw new Error('Pick at least one day');
    payload.cadence_days = days.join(',');
  }
  return payload;
}

// --- list rendering ---

function render() {
  const active = habits.filter(h => h.active === 1);
  const archived = habits.filter(h => h.active !== 1);

  els.activeList.innerHTML = '';
  els.activeEmpty.hidden = active.length > 0;
  for (const h of active) els.activeList.appendChild(row(h, false));

  els.archivedCard.hidden = archived.length === 0;
  els.archivedList.innerHTML = '';
  for (const h of archived) els.archivedList.appendChild(row(h, true));
}

function cadenceText(h) {
  if (h.cadence_type === 'daily') return 'Daily';
  if (h.cadence_type === 'weekly') {
    return h.cadence_count ? `${h.cadence_count}× per week` : 'Weekly';
  }
  if (h.cadence_type === 'weekdays') {
    const labels = (h.cadence_days || '').split(',').filter(Boolean)
      .map(n => DOW[Number(n)]?.label).filter(Boolean);
    return labels.length ? labels.join(', ') : 'No days set';
  }
  return h.cadence_type;
}

function row(habit, isArchived) {
  const li = document.createElement('li');
  li.className = 'manage-item';

  const info = document.createElement('div');
  info.className = 'manage-info';
  const name = document.createElement('span');
  name.className = 'manage-name';
  name.textContent = habit.name;            // textContent — XSS-safe
  const meta = document.createElement('span');
  meta.className = 'manage-meta';
  meta.textContent = cadenceText(habit) + (habit.note ? ` · ${habit.note}` : '');
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'manage-actions';
  if (isArchived) {
    actions.appendChild(button('Reactivate', 'ghost', () => setActive(habit, true)));
  } else {
    actions.appendChild(button('Edit', 'ghost', () => startEdit(habit)));
    actions.appendChild(button('Archive', 'danger', () => setActive(habit, false)));
  }

  li.append(info, actions);
  return li;
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

// --- actions ---

async function setActive(habit, active) {
  try {
    await api.put(`/api/habits/${habit.id}`, { active });
    await load();
    showSuccess(active ? `Reactivated "${habit.name}"` : `Archived "${habit.name}"`);
  } catch (err) {
    showError(err);
  }
}

function bindEvents() {
  els.cadenceType.addEventListener('change', syncCadenceFields);
  els.cancelBtn.addEventListener('click', resetForm);

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let payload;
    try {
      payload = readForm();
    } catch (err) {
      return showError(err);
    }
    const editingId = els.id.value;
    try {
      if (editingId) {
        await api.put(`/api/habits/${editingId}`, payload);
      } else {
        await api.post('/api/habits', payload);
      }
      await load();
      resetForm();
      showSuccess(editingId ? 'Habit saved' : 'Habit added');
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
