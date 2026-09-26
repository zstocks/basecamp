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
import * as templatesRepo from './src/workoutTemplates.js';
import * as scheduleRepo from './src/workoutSchedule.js';
import * as sessionsRepo from './src/workoutSessions.js';
import * as sessionSetsRepo from './src/sessionSets.js';
import * as foodsRepo from './src/foods.js';
import * as mealsRepo from './src/meals.js';
import {
  signCookieValue,
  verifyPassword,
  buildSetCookieHeader,
  isAuthenticated,
} from './src/auth.js';
import { isLoginRateLimited, recordLoginAttempt } from './src/rateLimit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
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

// Serve a file from public/. ENOENT propagates to the caller's try/catch (→ 404).
async function serveStatic(req, res, pathname) {
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
}

// --- auth ---

async function handleLogin(req, res) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  if (isLoginRateLimited(ip)) {
    return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
  }

  const body = await readJsonBody(req);
  if (!verifyPassword(body.password)) {
    recordLoginAttempt(ip);
    return sendJson(res, 401, { error: 'Invalid password' });
  }

  const cookie = signCookieValue();
  res.setHeader('Set-Cookie', buildSetCookieHeader({ value: cookie }));
  sendJson(res, 200, { ok: true });
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
  // GET /api/habit-logs?date=YYYY-MM-DD    → logs for one day
  // GET /api/habit-logs?from=...&to=...    → logs across an inclusive range
  if (pathname === '/api/habit-logs' && req.method === 'GET') {
    const params = new URL(req.url, 'http://x').searchParams;
    const date = params.get('date');
    if (date) return sendJson(res, 200, logsRepo.getLogsForDate(date));

    const from = params.get('from');
    const to = params.get('to');
    if (from && to) return sendJson(res, 200, logsRepo.getLogsForRange(from, to));

    return sendJson(res, 400, { error: 'date, or both from and to, query params required' });
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

  // GET /api/workout-templates
  if (pathname === '/api/workout-templates' && req.method === 'GET') {
    return sendJson(res, 200, templatesRepo.listTemplates());
  }
  // POST /api/workout-templates
  if (pathname === '/api/workout-templates' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, templatesRepo.createTemplate(body));
  }
  // GET /api/workout-templates/:id  → template with nested exercises
  const templateMatch = pathname.match(/^\/api\/workout-templates\/(\d+)$/);
  if (templateMatch && req.method === 'GET') {
    const template = templatesRepo.getTemplate(Number(templateMatch[1]));
    if (!template) return sendJson(res, 404, { error: 'Template not found' });
    return sendJson(res, 200, template);
  }
  // PUT /api/workout-templates/:id
  if (templateMatch && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const template = templatesRepo.updateTemplate(Number(templateMatch[1]), body);
    if (!template) return sendJson(res, 404, { error: 'Template not found' });
    return sendJson(res, 200, template);
  }

  // GET /api/workout-schedule[?weekday=N]
  if (pathname === '/api/workout-schedule' && req.method === 'GET') {
    const raw = new URL(req.url, 'http://x').searchParams.get('weekday');
    const weekday = raw === null ? undefined : Number(raw);
    return sendJson(res, 200, scheduleRepo.listSchedule({ weekday }));
  }
  // POST /api/workout-schedule
  if (pathname === '/api/workout-schedule' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, scheduleRepo.addScheduleEntry(body));
  }
  // DELETE /api/workout-schedule/:id
  const scheduleMatch = pathname.match(/^\/api\/workout-schedule\/(\d+)$/);
  if (scheduleMatch && req.method === 'DELETE') {
    const removed = scheduleRepo.removeScheduleEntry(Number(scheduleMatch[1]));
    if (!removed) return sendJson(res, 404, { error: 'Schedule entry not found' });
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/workout-sessions?date=YYYY-MM-DD   → one day
  // GET /api/workout-sessions?from=...&to=...    → range (stats heatmap)
  if (pathname === '/api/workout-sessions' && req.method === 'GET') {
    const params = new URL(req.url, 'http://x').searchParams;
    const date = params.get('date');
    if (date) return sendJson(res, 200, sessionsRepo.getSessionsForDate(date));
    const from = params.get('from');
    const to = params.get('to');
    if (from || to) return sendJson(res, 200, sessionsRepo.listSessions({ from, to }));
    return sendJson(res, 400, { error: 'date or from/to query param required' });
  }
  // PUT /api/workout-sessions
  if (pathname === '/api/workout-sessions' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, sessionsRepo.setSession(body));
  }
  // GET /api/exercise-names  → distinct logged exercise names (progress picker)
  if (pathname === '/api/exercise-names' && req.method === 'GET') {
    return sendJson(res, 200, sessionSetsRepo.listExerciseNames());
  }
  // GET /api/session-sets?exercise=Name  → all logged sets for one exercise
  if (pathname === '/api/session-sets' && req.method === 'GET') {
    const exercise = new URL(req.url, 'http://x').searchParams.get('exercise');
    if (!exercise) return sendJson(res, 400, { error: 'exercise query param required' });
    return sendJson(res, 200, sessionSetsRepo.listSetsByExercise(exercise));
  }

  // GET/PUT /api/workout-sessions/:id/sets  → logged actuals, replace-all on PUT
  const setsMatch = pathname.match(/^\/api\/workout-sessions\/(\d+)\/sets$/);
  if (setsMatch && req.method === 'GET') {
    return sendJson(res, 200, sessionSetsRepo.getSetsForSession(Number(setsMatch[1])));
  }
  if (setsMatch && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const sets = sessionSetsRepo.setSessionSets(Number(setsMatch[1]), body.sets);
    if (sets === null) return sendJson(res, 404, { error: 'Session not found' });
    return sendJson(res, 200, sets);
  }

  // GET /api/settings, PUT /api/settings
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, settingsRepo.getSettings());
  }
  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, settingsRepo.updateSettings(body));
  }

  // --- meals (Phase 3) ---

  // GET /api/foods[?activeOnly=1]   (activeOnly is for the planner's food picker)
  if (pathname === '/api/foods' && req.method === 'GET') {
    const activeOnly = new URL(req.url, 'http://x').searchParams.get('activeOnly') === '1';
    return sendJson(res, 200, foodsRepo.listFoods({ activeOnly }));
  }
  // POST /api/foods
  if (pathname === '/api/foods' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, foodsRepo.createFood(body));
  }
  // GET /api/foods/:id
  const foodMatch = pathname.match(/^\/api\/foods\/(\d+)$/);
  if (foodMatch && req.method === 'GET') {
    const food = foodsRepo.getFood(Number(foodMatch[1]));
    if (!food) return sendJson(res, 404, { error: 'Food not found' });
    return sendJson(res, 200, food);
  }
  // PUT /api/foods/:id   (soft-delete via { active: false })
  if (foodMatch && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const food = foodsRepo.updateFood(Number(foodMatch[1]), body);
    if (!food) return sendJson(res, 404, { error: 'Food not found' });
    return sendJson(res, 200, food);
  }

  // GET /api/meals?date=YYYY-MM-DD  → { date, planned, eaten, logged }
  if (pathname === '/api/meals' && req.method === 'GET') {
    const date = new URL(req.url, 'http://x').searchParams.get('date');
    if (!date) return sendJson(res, 400, { error: 'date query param required' });
    return sendJson(res, 200, mealsRepo.getDay(date));
  }
  // POST /api/meals/log { date }  → snapshot the plan into eaten actuals; returns fresh day
  if (pathname === '/api/meals/log' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!body.date) return sendJson(res, 400, { error: 'date is required' });
    return sendJson(res, 200, mealsRepo.logDay(body.date));
  }

  // POST /api/meal-entries  → slot a food into a day's bucket; returns the fresh day
  if (pathname === '/api/meal-entries' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const entry = mealsRepo.addPlannedEntry(body);
    return sendJson(res, 201, mealsRepo.getDay(entry.date));
  }
  // PUT/DELETE /api/meal-entries/:id  → adjust or remove a planned slot; returns fresh day
  const mealEntryMatch = pathname.match(/^\/api\/meal-entries\/(\d+)$/);
  if (mealEntryMatch && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const entry = mealsRepo.updatePlannedEntry(Number(mealEntryMatch[1]), body);
    if (!entry) return sendJson(res, 404, { error: 'Meal entry not found' });
    return sendJson(res, 200, mealsRepo.getDay(entry.date));
  }
  if (mealEntryMatch && req.method === 'DELETE') {
    const id = Number(mealEntryMatch[1]);
    const entry = mealsRepo.getPlannedEntry(id);
    if (!entry) return sendJson(res, 404, { error: 'Meal entry not found' });
    mealsRepo.deletePlannedEntry(id);
    return sendJson(res, 200, mealsRepo.getDay(entry.date));
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// --- server ---

const server = createServer(async (req, res) => {
  try {
    const pathname = req.url.split('?')[0];

    // --- public routes ---
    if (pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { status: 'ok', app: 'basecamp' });
    }
    if (pathname === '/login' && req.method === 'POST') {
      return await handleLogin(req, res);
    }
    if (pathname === '/login.html' && req.method === 'GET') {
      const file = await readFile(join(PUBLIC_DIR, 'login.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(file);
    }
    // Icons + manifest load before auth so they show on the login page too.
    if (req.method === 'GET' &&
        (pathname === '/favicon.ico' ||
         pathname === '/site.webmanifest' ||
         pathname.startsWith('/icons/'))) {
      return await serveStatic(req, res, pathname);
    }

    // --- auth gate ---
    if (!isAuthenticated(req)) {
      // Browser HTML requests redirect to login; everything else gets JSON 401.
      if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
        res.writeHead(302, { Location: '/login.html' });
        return res.end();
      }
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    // --- authenticated routes ---
    if (pathname === '/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', buildSetCookieHeader({ clear: true }));
      return sendJson(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    // static files (also gated)
    return await serveStatic(req, res, pathname);
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