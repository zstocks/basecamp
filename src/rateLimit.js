const WINDOW_MS = 15 * 60 * 1000;   // 15 minutes
const MAX_ATTEMPTS = 10;

const attempts = new Map(); // ip -> [timestamp, timestamp, ...]

function pruneAndGet(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (list.length > 0) attempts.set(ip, list);
  else attempts.delete(ip);
  return list;
}

export function isLoginRateLimited(ip) {
  return pruneAndGet(ip).length >= MAX_ATTEMPTS;
}

export function recordLoginAttempt(ip) {
  const list = pruneAndGet(ip);
  list.push(Date.now());
  attempts.set(ip, list);
}