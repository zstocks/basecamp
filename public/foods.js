import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';

// Per-serving nutrition columns, in form + payload order.
const NUTRITION = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'];

const els = {
  form: document.getElementById('food-form'),
  formTitle: document.getElementById('form-title'),
  id: document.getElementById('food-id'),
  name: document.getElementById('name'),
  serving: document.getElementById('serving_size'),
  submitBtn: document.getElementById('submit-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  activeList: document.getElementById('active-list'),
  activeEmpty: document.getElementById('active-empty'),
  archivedCard: document.getElementById('archived-card'),
  archivedList: document.getElementById('archived-list'),
};
// The six nutrition <input>s by column name.
const nutritionEls = Object.fromEntries(NUTRITION.map(k => [k, document.getElementById(k)]));

let foods = [];

init().catch(showError);

async function init() {
  await load();
  bindEvents();
}

async function load() {
  foods = await api.get('/api/foods');
  render();
}

// --- form ---

function resetForm() {
  els.form.reset();
  els.id.value = '';
  els.formTitle.textContent = 'Add a food';
  els.submitBtn.textContent = 'Add food';
  els.cancelBtn.hidden = true;
}

function startEdit(food) {
  els.id.value = food.id;
  els.name.value = food.name;
  els.serving.value = food.serving_size ?? '';
  for (const key of NUTRITION) nutritionEls[key].value = food[key] ?? '';
  els.formTitle.textContent = 'Edit food';
  els.submitBtn.textContent = 'Save changes';
  els.cancelBtn.hidden = false;
  els.name.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function readForm() {
  const name = els.name.value.trim();
  if (!name) throw new Error('Name is required');

  const payload = {
    name,
    serving_size: els.serving.value.trim() || null,
  };
  for (const key of NUTRITION) {
    const raw = nutritionEls[key].value.trim();
    if (raw === '') { payload[key] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${labelFor(key)} must be a non-negative number`);
    }
    payload[key] = n;
  }
  return payload;
}

function labelFor(key) {
  return { calories: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs',
           fat_g: 'Fat', fiber_g: 'Fiber', sugar_g: 'Sugar' }[key] ?? key;
}

// --- list rendering ---

function render() {
  const active = foods.filter(f => f.active === 1);
  const archived = foods.filter(f => f.active !== 1);

  els.activeList.innerHTML = '';
  els.activeEmpty.hidden = active.length > 0;
  for (const f of active) els.activeList.appendChild(row(f, false));

  els.archivedCard.hidden = archived.length === 0;
  els.archivedList.innerHTML = '';
  for (const f of archived) els.archivedList.appendChild(row(f, true));
}

function fmt(n) {
  return n == null ? '—' : String(Math.round(n * 100) / 100);
}

// e.g. "170 g · 100 kcal · 17 P / 6 C / 0.7 F"
function metaText(f) {
  const parts = [];
  if (f.serving_size) parts.push(f.serving_size);
  parts.push(`${fmt(f.calories)} kcal`);
  parts.push(`${fmt(f.protein_g)} P / ${fmt(f.carbs_g)} C / ${fmt(f.fat_g)} F`);
  return parts.join(' · ');
}

function row(food, isArchived) {
  const li = document.createElement('li');
  li.className = 'manage-item';

  const info = document.createElement('div');
  info.className = 'manage-info';
  const name = document.createElement('span');
  name.className = 'manage-name';
  name.textContent = food.name;             // textContent — XSS-safe
  const meta = document.createElement('span');
  meta.className = 'manage-meta';
  meta.textContent = metaText(food);
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'manage-actions';
  if (isArchived) {
    actions.appendChild(button('Reactivate', 'ghost', () => setActive(food, true)));
  } else {
    actions.appendChild(button('Edit', 'ghost', () => startEdit(food)));
    actions.appendChild(button('Archive', 'danger', () => setActive(food, false)));
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

async function setActive(food, active) {
  try {
    await api.put(`/api/foods/${food.id}`, { active });
    await load();
    showSuccess(active ? `Reactivated "${food.name}"` : `Archived "${food.name}"`);
  } catch (err) {
    showError(err);
  }
}

function bindEvents() {
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
        await api.put(`/api/foods/${editingId}`, payload);
      } else {
        await api.post('/api/foods', payload);
      }
      await load();
      resetForm();
      showSuccess(editingId ? 'Food saved' : 'Food added');
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
