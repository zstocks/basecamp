# Basecamp — project context

A personal health tracker (habits, body metrics, cravings, workouts, meals) built as a learning project. Single-user, self-hosted on a Hetzner VPS.

## Where we are
**Phases 1–3 are built and deployed.** Live at `basecamp.zacharystocks.com`, container healthy, running the latest commit (`065f3d6`).

- Phase 1 (habits, body metrics, cravings, settings, HMAC auth, dashboard, management UI, Docker deploy) — done.
- Phase 2 (workouts: templates → weekly schedule → completion → set logging → drill-down stats) — done.
- Phase 3 (meals: food library → planned meals → eaten log → daily calorie/macro rollup) — done.
- Phase 4 (stats and trends) — **partially done.** `stats.html` exists with a Workouts tab (12-week consistency heatmap + per-exercise top-set progress). The **Habits tab and Diet tab are still `Coming soon` placeholders.**

Also shipped beyond the original plan: login rate limiting (`src/rateLimit.js` + an Nginx `limit_req` zone), a full favicon/PWA icon set and web manifest, and a `/health` endpoint used by the compose healthcheck.

### Known gaps (the honest list)
- **No backups.** See the WAL warning under "Deploy target" — this is the top risk.
- **Habits and Diet stats are unbuilt.** Two placeholder cards in `stats.html`.
- **Cravings are write-only.** The dashboard POSTs to `/api/cravings` and nothing ever reads it back. There is a `GET /api/cravings` route with no UI behind it — you can log a craving but never see the pattern.
- **No weight/trend history anywhere.** `body_metrics` accumulates but is only ever read for *today*. `goal_weight` is stored in settings and never compared against actuals. There are no charts in the app at all.
- **Workouts and meals don't feed the streak.** The streak is habits-only (see "Streak rule").
- **No tests.** No test script, no test files.
- **The local dev DB is stale** — it sits at migration `001` while production is at `003`. Starting the server locally will auto-apply `002` and `003`; expect that on first run.
- **Dates are client-derived** (browser-local `ymd()`), while server defaults use `datetime('now')` (UTC). No `TZ` is set in compose. Harmless so far because the client supplies dates on writes, but worth knowing before adding server-side date logic.

## Architecture
- Node 22, custom HTTP server, **no framework** (no Express/Fastify/Koa). ESM throughout.
- SQLite via `better-sqlite3` — synchronous; ideal for single-user. WAL mode.
- HMAC-signed cookie auth from `APP_SECRET` + `APP_PASSWORD` env vars; 30-day cookie, `Secure` unless `COOKIE_SECURE=false`. Browser HTML requests without auth redirect to `/login.html`; everything else returns 401 JSON.
- **Data layer** lives in `src/<domain>.js` — pure functions, no HTTP knowledge.
- **HTTP layer** lives in `server.js` — routing, JSON parsing, auth gate, calls into the data layer. Flat `if (pathname === ... && req.method === ...)` chain plus regex matches for `/:id` routes.
- **Frontend**: vanilla JS, dark theme, no build step. ES modules served from `public/`. One page per screen — `index.html` (dashboard), `habits.html`, `workouts.html` + `schedule.html`, `meals.html` + `foods.html`, `stats.html`, `settings.html` — sharing `api.js` (fetch wrapper), `toast.js` (notifications; no `alert()`), and `rollup.js` (nutrition totals).
- **Migrations**: numbered `.sql` files in `migrations/`, applied at startup by `db.js` and tracked in a `_migrations` table.

## Conventions (don't break without sign-off)
- Every query uses `db.prepare(sql)` with `?` parameter binding. Never interpolate user input into SQL strings.
- Dynamic UPDATEs use a hardcoded column allow-list; user input never picks columns.
- `done`, `active`, `resisted`, `completed` come back as 0/1 integers (SQLite has no bool type) — compare with `=== 1`, not `=== true`.
- Dates as ISO `YYYY-MM-DD`; timestamps via `datetime('now')`. Day-of-week is JS native: **0=Sun..6=Sat**.
- Cookie + password compares use `crypto.timingSafeEqual`. Server refuses to start if `APP_SECRET` (<32 chars) or `APP_PASSWORD` is empty.
- `.env` is gitignored; `.env.example` is committed. **`CLAUDE.md` is also gitignored** — it is not version-controlled, so it can't be recovered from git history.

## Schema (all built)
**Phase 1** — `001_initial.sql`
- `habits` — `cadence_type ∈ {daily, weekly, weekdays}`, optional `cadence_count` and `cadence_days` ("1,4" = Mon,Thu), `active` flag for soft-delete.
- `habit_logs` — `UNIQUE(habit_id, date)`; upsert via `ON CONFLICT (...) DO UPDATE`.
- `body_metrics` — `UNIQUE(date)`; partial-update upsert via `COALESCE(excluded.col, body_metrics.col)` so weight-only updates don't wipe water_ml.
- `craving_events` — append-only log; `response ∈ {bag, walk, water, other}`.
- `settings` — single row (`CHECK (id = 1)`), seeded by migration. Columns: `goal_weight`, `target_calories`, `target_protein_g`, `target_water_ml`, plus the Phase 3 additions below.

**Phase 2** — `002_workouts.sql`
- `workout_templates`, `template_exercises` (ordered by `position`, optional targets), `workout_schedule` (template → weekday, `UNIQUE(template_id, weekday)`), `workout_sessions` (`UNIQUE(date, template_id)`; `completed` is a flag, not mere row existence, so it can be un-checked; `template_id` is `ON DELETE SET NULL` so history survives template deletion), `session_sets`.
- **`session_sets.exercise_name` is text, not a FK to `template_exercises`** — deliberate: history is a snapshot, immune to template edits/deletes.

**Phase 3** — `003_meals.sql`
- `foods` — nutrition stated per ONE serving; `serving_size` is a descriptive label; `active` soft-delete.
- `meal_entries` — one table with a `kind ∈ {planned, eaten}` discriminator, `bucket ∈ {breakfast, lunch, dinner, snacks}`, `quantity` = servings.
  - `planned` rows JOIN `foods` live, so food edits flow through while you're still planning.
  - `eaten` rows are a **snapshot** (`food_name` + frozen per-serving nutrition), like `session_sets`. `food_id` is a soft pointer (`ON DELETE SET NULL`); the snapshot is the source of truth.
- Adds `target_carbs_g`, `target_fat_g`, `target_fiber_g`, `target_sugar_g` to `settings`. Floor/ceiling **direction is not stored** — it's hardcoded in the rollup (one tunable place): calories ceiling, protein floor, carbs ceiling, fat floor, fiber floor, sugar ceiling.

## Streak rule (in `public/app.js`)
A day "summits" if completed_habits ÷ scheduled_habits ≥ 0.5 (with at least one scheduled habit). Days with zero scheduled = rest — neither extend nor break. Streak = consecutive non-broken days ending today. Tunable in one place. **Workouts and meals do not currently affect it.**

## What's next
- **Step A — back up the database (do this first).** Nothing else matters if the data can vanish. See the WAL warning below.
- **Step B — close the daily loop.** The app is feature-complete but logging stopped in early August; the remaining work is about making daily use frictionless rather than adding more surface area.
- **Step C — finish Phase 4:** the Habits stats tab, the Diet stats tab, weight trend vs `goal_weight`, and a cravings review view.

## Deploy target
- Hetzner CX22, Ubuntu 24.04, IP 5.78.195.72, SSH on port 2222 (alias `vps` configured).
- Subdomain `basecamp.zacharystocks.com`; wildcard cert at `/etc/letsencrypt/live/zacharystocks.com-0001/`, carried by `snippets/ssl.conf`.
- App dir `~/apps/basecamp` on the VPS; deploy via `~/deploy.sh basecamp` (git pull + `docker compose down/up`).
- Nginx block is committed at `deploy/nginx/basecamp.conf` (includes the `limit_req` rule on `/login`).
- Docker port binding: **`127.0.0.1:3005:3000`** — never `0.0.0.0` (bypasses UFW via Docker's iptables rules).
- Multi-stage Dockerfile: Alpine build stage `apk add python3 make g++` + `npm rebuild better-sqlite3` (no musl prebuild exists), then a toolchain-free runtime stage.

### Backing up: do NOT just copy basecamp.db
The database runs in **WAL mode**, and the WAL is not checkpointed on any schedule. As of 2026-09-26, production `basecamp.db` was **4 KB (header only)** while `basecamp.db-wal` held **1.2 MB** — every row lived in the WAL. Copying `basecamp.db` alone was verified to yield a database with **zero tables**. The old "back up by copying the file" note in this doc was wrong and would have produced silently empty backups.

Use SQLite's own backup, which checkpoints correctly and is safe on a live DB:

    docker exec basecamp node -e "const D=require('better-sqlite3');new D('/app/data/basecamp.db').backup('/app/data/backup.db')"

or `sqlite3 basecamp.db ".backup out.db"`. If you ever copy files by hand, you must take **all three** of `basecamp.db`, `-wal`, and `-shm` together. There is currently **no crontab and no `~/backups` directory** on the VPS — backups are entirely unimplemented.

## Developer preferences
- Concept-first explanations with rationale before code. Surface tradeoffs for sign-off; don't decide silently.
- Iterate in small, verified steps; confirm before generating large amounts of code.
- Maintain main-branch hygiene; no force-pushes.
- Primary dev: Maingear (Windows 11, Node 22 via nvm-windows, PowerShell). Test PowerShell with `Invoke-RestMethod -SessionVariable`/`-WebSession` for auth flows.

## Don't
- Add a framework.
- Bind Docker containers to `0.0.0.0`.
- Commit `.env`.
- Back up by copying `basecamp.db` alone (see the WAL warning).
- Change established schema patterns without sign-off (esp. the `session_sets` snapshot, the `meal_entries` discriminator, and the single-row `settings`).
- Use `Express`-style middleware patterns — keep request handling explicit in `server.js`.
