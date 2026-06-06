import './db.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import * as habitsRepo from './src/habits.js';
import * as logsRepo from './src/habitLogs.js';
import * as metricsRepo from './src/bodyMetrics.js';
import * as cravingsRepo from './src/cravings.js';
import * as settingsRepo from './src/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

// --- helpers ---

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// --- API ---

async function handleApi(req, res, pathname) {
  // GET /api/habits
  if (pathname === '/api/habits' && req.method === 'GET') {
    return sendJson(res, 200, habitsRepo.listHabits());
  }
  // POST /api/habits
  if (pathname === '/api/habits' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, habitsRepo.createHabit(body));
  }
  // PUT /api/habits/:id
  const habitMatch = pathname.match(/^\/api\/habits\/(\d+)$/);
  if (habitMatch && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const habit = habitsRepo.updateHabit(Number(habitMatch[1]), body);
    if (!habit) return sendJson(res, 404, { error: 'Habit not found' });
    return sendJson(res, 200, habit);
  }

  // GET /api/habit-logs?date=YYYY-MM-DD
  if (pathname === '/api/habit-logs' && req.method === 'GET') {
    const date = new URL(req.url, 'http://x').searchParams.get('date');
    if (!date) return sendJson(res, 400, { error: 'date query param required' });
    return sendJson(res, 200, logsRepo.getLogsForDate(date));
  }
  // PUT /api/habit-logs
  if (pathname === '/api/habit-logs' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, logsRepo.setHabitLog(body));
  }

  // GET /api/body-metrics?date=YYYY-MM-DD       → one row (or null)
  // GET /api/body-metrics?from=...&to=...       → array
  if (pathname === '/api/body-metrics' && req.method === 'GET') {
    const params = new URL(req.url, 'http://x').searchParams;
    const date = params.get('date');
    if (date) return sendJson(res, 200, metricsRepo.getBodyMetricForDate(date) ?? null);
    return sendJson(res, 200, metricsRepo.listBodyMetrics({
      from: params.get('from'),
      to: params.get('to'),
    }));
  }
  // PUT /api/body-metrics
  if (pathname === '/api/body-metrics' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, metricsRepo.setBodyMetric(body));
  }

  // GET /api/cravings?limit=N
  if (pathname === '/api/cravings' && req.method === 'GET') {
    const limit = Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 30;
    return sendJson(res, 200, cravingsRepo.listCravingEvents({ limit }));
  }
  // POST /api/cravings
  if (pathname === '/api/cravings' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, cravingsRepo.logCravingEvent(body));
  }

  // GET /api/settings, PUT /api/settings
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, settingsRepo.getSettings());
  }
  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, settingsRepo.updateSettings(body));
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// --- server ---

const server = createServer(async (req, res) => {
  try {
    const pathname = req.url.split('?')[0];

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    if (pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', app: 'basecamp' });
    }

    // Static (GET/HEAD only)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }
    const path = pathname === '/' ? '/index.html' : pathname;
    if (path.includes('..')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const file = await readFile(join(PUBLIC_DIR, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : file);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404).end('Not Found');
    } else {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      sendJson(res, status, { error: err.message });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Basecamp running on http://localhost:${PORT}`);
});