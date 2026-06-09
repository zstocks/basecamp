import { api } from '/api.js';
import { showError, showSuccess } from '/toast.js';

const FIELDS = ['goal_weight', 'target_calories', 'target_protein_g', 'target_water_ml'];

const form = document.getElementById('settings-form');

init().catch(showError);

async function init() {
  const settings = await api.get('/api/settings');
  for (const key of FIELDS) {
    document.getElementById(key).value = settings?.[key] ?? '';
  }
  bindEvents();
}

function readForm() {
  const payload = {};
  for (const key of FIELDS) {
    const raw = document.getElementById(key).value.trim();
    payload[key] = raw === '' ? null : Number(raw);
  }
  return payload;
}

function bindEvents() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/settings', readForm());
      showSuccess('Targets saved');
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
