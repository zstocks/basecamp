import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';

const els = {
  form: document.getElementById('template-form'),
  formTitle: document.getElementById('form-title'),
  id: document.getElementById('template-id'),
  name: document.getElementById('name'),
  note: document.getElementById('note'),
  exerciseList: document.getElementById('exercise-list'),
  addExercise: document.getElementById('add-exercise'),
  submitBtn: document.getElementById('submit-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  activeList: document.getElementById('active-list'),
  activeEmpty: document.getElementById('active-empty'),
  archivedCard: document.getElementById('archived-card'),
  archivedList: document.getElementById('archived-list'),
};

let templates = [];

init().catch(showError);

async function init() {
  addExerciseRow();          // start the form with one empty row
  await load();
  bindEvents();
}

async function load() {
  templates = await api.get('/api/workout-templates');
  render();
}

// --- exercise rows (the form's dynamic part) ---

function inputEl(type, placeholder, value) {
  const el = document.createElement('input');
  el.type = type;
  el.placeholder = placeholder;
  el.value = value ?? '';
  el.autocomplete = 'off';
  return el;
}

function addExerciseRow(ex = {}) {
  const row = document.createElement('div');
  row.className = 'exercise-row';

  const name = inputEl('text', 'Exercise', ex.name);
  name.classList.add('ex-name');
  name.maxLength = 120;
  const sets = inputEl('number', 'Sets', ex.target_sets);
  const reps = inputEl('number', 'Reps', ex.target_reps);
  const weight = inputEl('number', 'Weight', ex.target_weight);
  sets.min = reps.min = weight.min = '0';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost remove-exercise';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove exercise');
  remove.addEventListener('click', () => row.remove());

  row.append(name, sets, reps, weight, remove);
  els.exerciseList.appendChild(row);
  return row;
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}
function numOrNull(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function readExercises() {
  const exercises = [];
  for (const row of els.exerciseList.querySelectorAll('.exercise-row')) {
    const [name, sets, reps, weight] = row.querySelectorAll('input');
    const exName = name.value.trim();
    if (!exName) continue;   // skip blank rows (e.g. the trailing empty one)
    exercises.push({
      name: exName,
      target_sets: intOrNull(sets.value),
      target_reps: intOrNull(reps.value),
      target_weight: numOrNull(weight.value),
    });
  }
  return exercises;
}

function readForm() {
  const name = els.name.value.trim();
  if (!name) throw new Error('Name is required');
  return {
    name,
    note: els.note.value.trim() || null,
    exercises: readExercises(),
  };
}

function resetForm() {
  els.form.reset();
  els.id.value = '';
  els.exerciseList.innerHTML = '';
  addExerciseRow();
  els.formTitle.textContent = 'Add a workout template';
  els.submitBtn.textContent = 'Add template';
  els.cancelBtn.hidden = true;
}

// List rows carry no exercises (the list endpoint omits them), so fetch the
// full template before populating the edit form.
async function startEdit(template) {
  const full = await api.get(`/api/workout-templates/${template.id}`);
  els.id.value = full.id;
  els.name.value = full.name;
  els.note.value = full.note ?? '';
  els.exerciseList.innerHTML = '';
  const exs = full.exercises ?? [];
  if (exs.length === 0) addExerciseRow();
  else exs.forEach(ex => addExerciseRow(ex));
  els.formTitle.textContent = 'Edit template';
  els.submitBtn.textContent = 'Save changes';
  els.cancelBtn.hidden = false;
  els.name.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- list rendering ---

function render() {
  const active = templates.filter(t => t.active === 1);
  const archived = templates.filter(t => t.active !== 1);

  els.activeList.innerHTML = '';
  els.activeEmpty.hidden = active.length > 0;
  for (const t of active) els.activeList.appendChild(rowEl(t, false));

  els.archivedCard.hidden = archived.length === 0;
  els.archivedList.innerHTML = '';
  for (const t of archived) els.archivedList.appendChild(rowEl(t, true));
}

function rowEl(t, isArchived) {
  const li = document.createElement('li');
  li.className = 'manage-item';

  const info = document.createElement('div');
  info.className = 'manage-info';
  const name = document.createElement('span');
  name.className = 'manage-name';
  name.textContent = t.name;                 // textContent — XSS-safe
  const meta = document.createElement('span');
  meta.className = 'manage-meta';
  const count = t.exercise_count ?? 0;
  meta.textContent = `${count} exercise${count === 1 ? '' : 's'}` + (t.note ? ` · ${t.note}` : '');
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'manage-actions';
  if (isArchived) {
    actions.appendChild(button('Reactivate', 'ghost', () => setActive(t, true)));
  } else {
    actions.appendChild(button('Edit', 'ghost', () => startEdit(t).catch(showError)));
    actions.appendChild(button('Archive', 'danger', () => setActive(t, false)));
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

async function setActive(t, active) {
  try {
    await api.put(`/api/workout-templates/${t.id}`, { active });
    await load();
    showSuccess(active ? `Reactivated "${t.name}"` : `Archived "${t.name}"`);
  } catch (err) {
    showError(err);
  }
}

function bindEvents() {
  els.addExercise.addEventListener('click', () => {
    const row = addExerciseRow();
    row.querySelector('input').focus();
  });
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
        await api.put(`/api/workout-templates/${editingId}`, payload);
      } else {
        await api.post('/api/workout-templates', payload);
      }
      await load();
      resetForm();
      showSuccess(editingId ? 'Template saved' : 'Template added');
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
