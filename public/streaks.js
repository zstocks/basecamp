// Habit scheduling and streak rules — the single place these are defined.
// Shared by the dashboard (app.js) and the stats page, so the two can never
// disagree about what counts as a completed day.
//
// THE RULES
//   perfect day : every habit scheduled that day was completed        (100%)
//   summit day  : at least half were completed                        (>= 50%)
//   rest day    : nothing was scheduled — neither extends nor breaks a streak
//   per-habit   : consecutive days the habit was scheduled AND done;
//                 days it wasn't scheduled pass through as rest
//
// Scheduling is resolved against habit_versions — the definition in effect on
// that date — never against the habit's current definition. That is what stops
// an edit today from rewriting whether last month's days summited.

export const SUMMIT_THRESHOLD = 0.5;

// ---- resolving a habit's definition as of a given date ----

export function buildResolver(versions) {
  const byHabit = new Map();
  for (const v of versions) {
    if (!byHabit.has(v.habit_id)) byHabit.set(v.habit_id, []);
    byHabit.get(v.habit_id).push(v);
  }
  // Oldest first, so the last row at or before a date is the one in effect.
  // ISO dates sort lexically, so a plain string compare is a date compare.
  for (const list of byHabit.values()) {
    list.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  }

  return {
    versionOn(habitId, date) {
      const list = byHabit.get(habitId);
      if (!list) return null;
      let inEffect = null;
      for (const v of list) {
        if (v.effective_from > date) break;
        inEffect = v;
      }
      return inEffect;   // null = the habit did not exist yet on that date
    },
  };
}

// Does this habit count toward the date's completion percentage?
export function isScheduledOn(version, date) {
  if (!version) return false;        // didn't exist yet
  if (!version.active) return false; // archived as of this date
  if (version.cadence_type === 'daily') return true;
  if (version.cadence_type === 'weekdays') {
    const dow = new Date(date + 'T00:00:00').getDay();   // 0=Sun..6=Sat
    return (version.cadence_days || '').split(',').map(Number).includes(dow);
  }
  // 'weekly' means "N times a week, you pick the days" — it names no specific
  // days, so it is not an obligation on any particular one. Counting it every
  // day would penalise the days you legitimately skip it and make a 100% day
  // unreachable. It is measured per week instead (see weeklyProgress).
  return false;
}

// Habits that count toward the day's percentage.
export function scheduledOn(habits, resolver, date) {
  return habits.filter(h => isScheduledOn(resolver.versionOn(h.id, date), date));
}

// Habits shown on the dashboard so you can tick them. A weekly "N x per week"
// habit appears every day — you pick when — even though it doesn't count toward
// that day's percentage.
export function visibleOn(habits, resolver, date) {
  return habits.filter(h => {
    const v = resolver.versionOn(h.id, date);
    if (!v || !v.active) return false;
    return isScheduledOn(v, date) || v.cadence_type === 'weekly';
  });
}

// ---- streaks ----

// Walk days newest-first. A predicate returns:
//   true  -> the day extends the streak
//   false -> the day breaks it, stop
//   null  -> rest; passes through without extending or breaking
// ranOut means we reached the end of the supplied days still unbroken, so the
// caller may want to load older days and keep going.
export function walkStreak(days, predicate) {
  let streak = 0;
  for (const day of days) {
    const verdict = predicate(day);
    if (verdict === null) continue;
    if (verdict === false) return { streak, ranOut: false };
    streak++;
  }
  return { streak, ranOut: true };
}

export function summitPredicate(day) {
  if (day.scheduled.length === 0) return null;
  return day.doneCount / day.scheduled.length >= SUMMIT_THRESHOLD;
}

export function perfectPredicate(day) {
  if (day.scheduled.length === 0) return null;
  return day.doneCount === day.scheduled.length;
}

// Days this habit wasn't scheduled are rest for *this* habit — a Tue/Thu habit
// isn't broken by Wednesday.
export function habitPredicate(habitId) {
  return day => {
    if (!day.scheduled.some(h => h.id === habitId)) return null;
    return day.doneIds.has(habitId);
  };
}

// ---- weekly-cadence habits ----

// Progress toward an "N x per week" target for the week containing `date`.
// Weeks run Sun..Sat to match the 0=Sun..6=Sat convention used everywhere else.
export function weeklyProgress(habitId, target, days, date) {
  const end = new Date(date + 'T00:00:00');
  const weekStart = new Date(end);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const from = ymd(weekStart);
  const to = ymd(new Date(weekStart.getTime() + 6 * 86400000));

  const done = days.filter(d => d.date >= from && d.date <= to && d.doneIds.has(habitId)).length;
  return { done, target, met: target ? done >= target : false, from, to };
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
