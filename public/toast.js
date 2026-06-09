// Shared toast notifications. Replaces alert() everywhere.
// Lazily injects a single fixed container, then stacks dismissible toasts.

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

export function toast(message, type = 'error', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;            // textContent — never inject HTML
  el.addEventListener('click', () => dismiss(el));
  ensureContainer().appendChild(el);

  // next frame so the CSS transition runs from the initial state
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => dismiss(el), ms);
  return el;
}

function dismiss(el) {
  if (!el.isConnected) return;
  el.classList.remove('show');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

export const showError = (err) => toast(err?.message || String(err), 'error');
export const showSuccess = (msg) => toast(msg, 'success', 2500);
