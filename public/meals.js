import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';
import { renderRollup } from '/rollup.js';

const BUCKETS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
];

const els = {
  dateDisplay: document.getElementById('date-display'),
  prevDay: document.getElementById('prev-day'),
  nextDay: document.getElementById('next-day'),
  todayBtn: document.getElementById('today-btn'),
  rollup: document.getElementById('rollup'),
  loggedBadge: document.getElementById('logged-badge'),
  buckets: document.getElementById('buckets'),
};

const fmt = n => (n == null ? '—' : String(Math.round(n * 10) / 10));

const TODAY = ymd(new Date());
let selectedDate = TODAY;
let day = null;
let foods = [];

init().catch(showError);

async function init() {
  foods = await api.get('/api/foods?activeOnly=1');   // picker options; loaded once
  await loadDay();
  bindEvents();
}

async function loadDay() {
  day = await api.get(`/api/meals?date=${selectedDate}`);
  render();
}

// mutation endpoints return the fresh day, so we just swap state and re-render.
function setDay(fresh) {
  day = fresh;
  render();
}

// --- date helpers (local YYYY-MM-DD, matching the dashboard) ---

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function diffDays(iso) {
  const a = new Date(iso + 'T00:00:00');
  const b = new Date(TODAY + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}
function formatDate(iso) {
  const nice = new Date(iso + 'T00:00:00')
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const diff = diffDays(iso);
  const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null;
  return rel ? `${rel} · ${nice}` : nice;
}

// --- render ---

function render() {
  els.dateDisplay.textContent = formatDate(selectedDate);
  els.todayBtn.hidden = selectedDate === TODAY;
  els.loggedBadge.hidden = !day.logged;

  els.rollup.replaceChildren(renderRollup(day.planned.rollup));

  els.buckets.replaceChildren(...BUCKETS.map(bucketCard));
}

function bucketCard(b) {
  const entries = day.planned.buckets[b.key] ?? [];
  const card = document.createElement('section');
  card.className = 'card meal-bucket';

  const head = document.createElement('div');
  head.className = 'bucket-head';
  const title = document.createElement('h3');
  title.textContent = b.label;
  const sub = document.createElement('span');
  sub.className = 'bucket-sub';
  const kcal = entries.reduce((s, e) => s + Number(e.quantity) * (e.calories ?? 0), 0);
  sub.textContent = `${fmt(kcal)} kcal`;
  head.append(title, sub);
  card.appendChild(head);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty bucket-empty';
    empty.textContent = 'Nothing slotted.';
    card.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'bucket-entries';
    for (const e of entries) ul.appendChild(entryRow(e));
    card.appendChild(ul);
  }

  card.appendChild(addControl(b.key));
  return card;
}

function entryRow(e) {
  const li = document.createElement('li');
  li.className = 'bucket-entry';

  const qty = document.createElement('input');
  qty.type = 'number';
  qty.className = 'entry-qty';
  qty.min = '0.1';
  qty.step = '0.1';
  qty.value = e.quantity;
  qty.setAttribute('aria-label', `Servings of ${e.food_name ?? 'food'}`);
  qty.addEventListener('change', () => changeQty(e, qty));

  const info = document.createElement('div');
  info.className = 'entry-info';
  const name = document.createElement('span');
  name.className = 'entry-name';
  name.textContent = e.food_name ?? '(deleted food)';   // textContent — XSS-safe
  const meta = document.createElement('span');
  meta.className = 'entry-meta';
  meta.textContent = e.calories == null ? '—' : `${fmt(Number(e.quantity) * e.calories)} kcal`;
  info.append(name, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost entry-remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove ${e.food_name ?? 'food'}`);
  remove.addEventListener('click', () => removeEntry(e));

  li.append(qty, info, remove);
  return li;
}

function addControl(bucketKey) {
  const wrap = document.createElement('div');
  wrap.className = 'bucket-add';

  if (foods.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = 'No foods yet — add some on the Foods tab.';
    wrap.appendChild(note);
    return wrap;
  }

  const select = document.createElement('select');
  select.className = 'add-food';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Add food…';
  select.appendChild(ph);
  for (const f of foods) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.serving_size ? `${f.name} (${f.serving_size})` : f.name;
    select.appendChild(o);
  }

  const qty = document.createElement('input');
  qty.type = 'number';
  qty.className = 'add-qty';
  qty.min = '0.1';
  qty.step = '0.1';
  qty.value = '1';
  qty.setAttribute('aria-label', 'Servings');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost add-btn';
  btn.textContent = 'Add';
  btn.addEventListener('click', () => addEntry(bucketKey, select, qty));

  wrap.append(select, qty, btn);
  return wrap;
}

// --- actions ---

async function addEntry(bucket, select, qtyEl) {
  const food_id = Number(select.value);
  if (!food_id) return showError(new Error('Pick a food first'));
  const quantity = Number(qtyEl.value);
  if (!Number.isFinite(quantity) || quantity <= 0) return showError(new Error('Servings must be positive'));
  try {
    setDay(await api.post('/api/meal-entries', { date: selectedDate, bucket, food_id, quantity }));
    showSuccess('Added');
  } catch (err) {
    showError(err);
  }
}

async function changeQty(entry, qtyEl) {
  const quantity = Number(qtyEl.value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    qtyEl.value = entry.quantity;   // revert the input
    return showError(new Error('Servings must be positive'));
  }
  try {
    setDay(await api.put(`/api/meal-entries/${entry.id}`, { quantity }));
  } catch (err) {
    showError(err);
  }
}

async function removeEntry(entry) {
  try {
    setDay(await api.delete(`/api/meal-entries/${entry.id}`));
    showSuccess('Removed');
  } catch (err) {
    showError(err);
  }
}

// --- events ---

async function go(date) {
  selectedDate = date;
  try {
    await loadDay();
  } catch (err) {
    showError(err);
  }
}

function bindEvents() {
  els.prevDay.addEventListener('click', () => go(addDays(selectedDate, -1)));
  els.nextDay.addEventListener('click', () => go(addDays(selectedDate, 1)));
  els.todayBtn.addEventListener('click', () => go(TODAY));

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.post('/logout');
      window.location.href = '/login.html';
    } catch (err) {
      showError(err);
    }
  });
}
