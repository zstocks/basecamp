# Basecamp — project context

A personal health tracker (habits, body metrics, cravings, workouts, meals) built as a learning project. Single-user, self-hosted on a Hetzner VPS.

## Where we are
**Phases 1–3 are built and deployed.** Live at `basecamp.zacharystocks.com`, container healthy.

- Phase 1 (habits, body metrics, cravings, settings, HMAC auth, dashboard, management UI, Docker deploy) — done.
- Phase 2 (workouts: templates → weekly schedule → completion → set logging → drill-down stats) — done.
- Phase 3 (meals: food library → planned meals → eaten log → daily calorie/macro rollup) — done.
- Phase 4 (stats and trends) — **mostly done.** Habits, Body and Workouts tabs are built; **Diet is the last placeholder**. Also delivered here: permanent habit history (`habit_versions`), uncapped streaks, perfect-day and per-habit streaks, and the first test suite.

Also shipped beyond the original plan: login rate limiting (`src/rateLimit.js` + an Nginx `limit_req` zone), a full favicon/PWA icon set and web manifest, and a `/health` endpoint used by the compose healthcheck.

### Known gaps (the honest list)
- **The Diet stats tab is unbuilt.** Needs a per-day rollup endpoint (`meal_entries` is single-date only) before calories/macros can be charted against targets.
- **Cravings are write-only.** The dashboard POSTs to `/api/cravings` and nothing ever reads it back. There is a `GET /api/cravings` route with no UI behind it — you can log a craving but never see the pattern.
- **Workouts and meals don't feed the streak.** The streak is habits-only (see "Streak rules").
- **Test coverage is partial.** `npm test` runs 22 tests (node's built-in runner, no dependencies) over `streaks.js` and `chart.js` — the scheduling/streak rules and the chart maths. The data layer, HTTP routes, and every other page have no tests.
- **Dates are client-derived** (browser-local `ymd()`), while server defaults use `datetime('now')` (UTC). No `TZ` is set in compose. Harmless so far because the client supplies dates on writes, but worth knowing before adding server-side date logic — `habit_versions.effective_from` uses the server's date.

## Architecture
- Node 22, custom HTTP server, **no framework** (no Express/Fastify/Koa). ESM throughout.
- SQLite via `better-sqlite3` — synchronous; ideal for single-user. WAL mode.
- HMAC-signed cookie auth from `APP_SECRET` + `APP_PASSWORD` env vars; 30-day cookie, `Secure` unless `COOKIE_SECURE=false`. Browser HTML requests without auth redirect to `/login.html`; everything else returns 401 JSON.
- **Data layer** lives in `src/<domain>.js` — pure functions, no HTTP knowledge.
- **HTTP layer** lives in `server.js` — routing, JSON parsing, auth gate, calls into the data layer. Flat `if (pathname === ... && req.method === ...)` chain plus regex matches for `/:id` routes.
- **Frontend**: vanilla JS, dark theme, no build step. ES modules served from `public/`. One page per screen — `index.html` (dashboard), `habits.html`, `workouts.html` + `schedule.html`, `meals.html` + `foods.html`, `stats.html`, `settings.html` — sharing `api.js` (fetch wrapper), `toast.js` (notifications; no `alert()`), `rollup.js` (nutrition totals), `streaks.js` (scheduling + streak rules) and `chart.js` (inline-SVG line charts, no dependencies).
- **Stats page** has four tabs via `?tab=`: Habits (streak tiles, 12-week heatmap, per-habit breakdown), Body (weight vs `goal_weight` with a 7-day average, water vs target, 30/90/365-day ranges), Workouts (consistency heatmap, per-exercise progress), Diet (not built yet).
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

**Phase 4** — `004_habit_versions.sql`, `005_no_cascade_delete.sql`
- `habit_versions` — append-only history of habit definitions; `UNIQUE(habit_id, effective_from)`. `habits` holds the *current* definition; versions are authoritative for any question about the past. Only scheduling-relevant edits create a version (a rename doesn't); two edits in one day upsert, since a day has one answer.
- `005` rebuilds `habit_logs` and `habit_versions` to drop `ON DELETE CASCADE` in favour of **`ON DELETE RESTRICT`**. A single `DELETE FROM habits` used to erase all of that habit's history. RESTRICT rather than SET NULL because a log with a NULL `habit_id` is debris, not preserved history — archive habits (`active = 0`) instead; deletion must be deliberate.

## Streak rules (in `public/streaks.js`)
One walker, several predicates — shared by the dashboard and the stats page so they can't disagree. Tunable in one place.

- **summit day** — `completed ÷ scheduled ≥ 0.5` (the forgiving headline streak).
- **perfect day** — every scheduled habit completed (100%).
- **rest day** — nothing scheduled; neither extends nor breaks a streak.
- **per-habit** — consecutive days the habit was scheduled *and* done; days it wasn't scheduled pass through as rest, so a Tue/Thu habit isn't broken by Wednesday.

Scheduling resolves against `habit_versions` — the definition in effect **on that date** — never the habit's current definition. That's what stops an edit today from rewriting whether last month's days summited.

**`weekly` cadence ("N× per week") never counts toward a day's percentage.** It names no specific days, so counting it daily would penalise the days you legitimately skip it and make a 100% day unreachable. It stays *visible* on the dashboard every day (you pick when) but is measured per week. `daily` and `weekdays` behave exactly as you'd expect.

The streak has **no ceiling** — the dashboard loads `DAY_WINDOW` (90) days and walks older chunks on demand. **Workouts and meals do not affect it.**

## What's next
- ~~Step A — back up the database.~~ **Done 2026-09-26.** See "Backups" below.
- **Step B — trends.** Weight vs `goal_weight`, the Habits stats tab, the Diet stats tab, and a cravings review view. Logging currently pays out nothing, which is the likeliest reason it stopped.
  - Fold in: surface "last backup age" from `last-backup.json` on a page you see daily, so the app reports its own backup failures instead of waiting to be asked.
- **Step C — refinement for ease of use.** Reduce the taps a normal day costs. The app is feature-complete; the remaining work is friction, not surface area.

## Deploy target
- Hetzner CX22, Ubuntu 24.04, IP 5.78.195.72, SSH on port 2222 (alias `vps` configured).
- Subdomain `basecamp.zacharystocks.com`; wildcard cert at `/etc/letsencrypt/live/zacharystocks.com-0001/`, carried by `snippets/ssl.conf`.
- App dir `~/apps/basecamp` on the VPS; deploy via `~/deploy.sh basecamp` (git pull + `docker compose down/up`).
- Nginx block is committed at `deploy/nginx/basecamp.conf` (includes the `limit_req` rule on `/login`).
- Docker port binding: **`127.0.0.1:3005:3000`** — never `0.0.0.0` (bypasses UFW via Docker's iptables rules).
- Multi-stage Dockerfile: Alpine build stage `apk add python3 make g++` + `npm rebuild better-sqlite3` (no musl prebuild exists), then a toolchain-free runtime stage.

### Backups — see `docs/BACKUP.md` for the restore runbook
Automated since 2026-09-26. Daily snapshot at 03:30 and a weekly restore drill on Sundays at 04:00, both systemd timers on the **host** (not in the container, so they survive the app being broken or stopped). Off-site copy goes to Hetzner Storage Box sub-account `u613904-sub3` (base dir `/basecamp/`, key `/root/.ssh/box_basecamp`). Retention 14 daily / 8 weekly / 12 monthly; ~6 KB per snapshot.

**Never back up by copying `basecamp.db`.** The database runs in **WAL mode**. On 2026-09-26 live `basecamp.db` was **4 KB (header only)** while `basecamp.db-wal` held **1.2 MB** — every row was in the WAL. Copying the `.db` alone was tested and restored to **zero tables**. Use `sqlite3 "$DB" ".backup out.db"` (online backup API, folds in the WAL, safe on a live database), or take **all three** of `.db`, `-wal`, `-shm` together.

- `scripts/backup.sh` — snapshot → `integrity_check` → assert every expected table exists and rows > 0 → gzip → retain → rsync → confirm the file is listed remotely.
- `scripts/verify-backup.sh` — downloads the newest **off-site** copy and proves it restores; fails if it is over 48h old, so a stopped timer surfaces loudly.
- `scripts/pre-deploy.sh` — local snapshot before `docker compose up` applies migrations. Invoked by a generic hook in `~/deploy.sh`.
- rsync runs **without `--delete`** — the remote is append-only, so local corruption cannot replicate to the last surviving copy.
- Verified end to end on 2026-09-26: restored-from-Storage-Box row counts matched live exactly across all 12 tables.

**Nothing notifies you when a backup fails** — check `systemctl list-timers 'basecamp-*'` or `journalctl -u basecamp-backup.service`. Planned fix is in Step B.

⚠️ **`~/deploy.sh` on the VPS is not version-controlled.** It gained a generic pre-deploy hook (runs `scripts/pre-deploy.sh` if present and executable; apps without one are unaffected). Original saved at `~/deploy.sh.bak-2026-09-26`. Deploying basecamp now prompts for a sudo password at the hook.

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
