// Tests for public/streaks.js — the habit scheduling and streak rules.
//
// Run with: npm test   (node's built-in runner; no dependencies, no framework)
//
// streaks.js is deliberately pure — no DOM, no fetch, no database — precisely
// so these rules can be tested directly. The rules decide whether a day counted
// and whether a streak survives, and they read history that must never change
// retroactively, so they are the part of this project most worth pinning down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResolver, isScheduledOn, scheduledOn, visibleOn,
  buildDays, walkStreak, longestStreak, completionRate, habitStats,
  summitPredicate, perfectPredicate, habitPredicate,
} from '../public/streaks.js';

// Habit 1: created 2026-01-01 as daily; switched to Tue/Thu on 2026-06-01;
//          archived on 2026-09-01.
// Habit 2: an "N x per week" habit, created 2026-03-01.
const VERSIONS = [
  { habit_id: 1, effective_from: '2026-01-01', cadence_type: 'daily',    cadence_count: null, cadence_days: null,  active: 1 },
  { habit_id: 1, effective_from: '2026-06-01', cadence_type: 'weekdays', cadence_count: null, cadence_days: '2,4', active: 1 },
  { habit_id: 1, effective_from: '2026-09-01', cadence_type: 'weekdays', cadence_count: null, cadence_days: '2,4', active: 0 },
  { habit_id: 2, effective_from: '2026-03-01', cadence_type: 'weekly',   cadence_count: 3,    cadence_days: null,  active: 1 },
];
const HABITS = [{ id: 1, name: 'Guitar' }, { id: 2, name: 'Gym' }];

// Build a day summary without going through the database.
const day = (date, scheduledIds, doneIds) => ({
  date,
  dow: new Date(date + 'T00:00:00').getDay(),
  scheduled: scheduledIds.map(id => ({ id })),
  doneIds: new Set(doneIds),
  doneCount: doneIds.filter(id => scheduledIds.includes(id)).length,
  logCount: doneIds.length,
});

test('resolver picks the version in effect on a date', () => {
  const r = buildResolver(VERSIONS);
  assert.equal(r.versionOn(1, '2025-12-31'), null, 'before creation there is no version');
  assert.equal(r.versionOn(1, '2026-05-31').cadence_type, 'daily');
  assert.equal(r.versionOn(1, '2026-06-02').cadence_type, 'weekdays');
  assert.equal(r.versionOn(1, '2026-12-25').active, 0, 'latest version keeps applying');
});

// The reason habit_versions exists at all.
test('editing a habit does not rewrite its past', () => {
  const r = buildResolver(VERSIONS);

  // Habit 1 is archived as of 2026-09-01 and changed cadence on 2026-06-01.
  // Neither edit may change what was true in March, when it was daily.
  assert.equal(isScheduledOn(r.versionOn(1, '2026-03-04'), '2026-03-04'), true,
    'a habit archived later still counts for earlier days');

  // 2026-06-03 is a Wednesday, 2026-06-04 a Thursday.
  assert.equal(isScheduledOn(r.versionOn(1, '2026-06-03'), '2026-06-03'), false);
  assert.equal(isScheduledOn(r.versionOn(1, '2026-06-04'), '2026-06-04'), true);

  // 2026-09-08 is a Tuesday, but the habit was archived on the 1st.
  assert.equal(isScheduledOn(r.versionOn(1, '2026-09-08'), '2026-09-08'), false);
});

test('"N x per week" never counts toward a single day', () => {
  const r = buildResolver(VERSIONS);
  // It names no specific days, so counting it daily would penalise the days you
  // legitimately skip it and make a 100% day unreachable.
  assert.equal(isScheduledOn(r.versionOn(2, '2026-06-03'), '2026-06-03'), false);
  assert.deepEqual(scheduledOn(HABITS, r, '2026-06-04').map(h => h.id), [1],
    'excluded from the day\'s scheduled set');
  assert.deepEqual(visibleOn(HABITS, r, '2026-06-04').map(h => h.id), [1, 2],
    'but still shown so you can tick it');
});

test('buildDays resolves scheduling per date, not per today', () => {
  const r = buildResolver(VERSIONS);
  // 2026-06-04 Thu (habit 1 scheduled), 2026-06-03 Wed (not scheduled).
  const days = buildDays(['2026-06-04', '2026-06-03'], [
    { habit_id: 1, date: '2026-06-04', done: 1 },
  ], HABITS, r);

  assert.deepEqual(days[0].scheduled.map(h => h.id), [1]);
  assert.equal(days[0].doneCount, 1);
  assert.deepEqual(days[1].scheduled.map(h => h.id), [], 'Wednesday schedules nothing');
});

// Two daily habits. Newest first. Day 3 is half done; day 6 is a total miss.
const DAYS = [
  day('2026-09-26', [1, 2], [1, 2]),   // perfect
  day('2026-09-25', [1, 2], [1, 2]),   // perfect
  day('2026-09-24', [1, 2], [1]),      // 50% — summits, not perfect
  day('2026-09-23', [1, 2], [1, 2]),
  day('2026-09-22', [1, 2], [1, 2]),
  day('2026-09-21', [1, 2], []),       // 0% — breaks both
  day('2026-09-20', [1, 2], [1, 2]),
];

test('summit and perfect streaks diverge correctly', () => {
  assert.equal(walkStreak(DAYS, summitPredicate).streak, 5, '>=50% days extend the run');
  assert.equal(walkStreak(DAYS, perfectPredicate).streak, 2, 'the 50% day breaks a perfect run');
});

test('per-habit streaks ignore days the habit was not scheduled', () => {
  assert.equal(walkStreak(DAYS, habitPredicate(1)).streak, 5);
  assert.equal(walkStreak(DAYS, habitPredicate(2)).streak, 2, 'habit 2 was missed on the 24th');

  // A Tue/Thu habit must not be broken by Wednesday.
  const tueThu = [
    day('2026-09-26', [2], [2]),       // habit 1 not scheduled (Fri)
    day('2026-09-25', [1, 2], [1, 2]), // Thu — scheduled and done
    day('2026-09-24', [2], [2]),       // Wed — not scheduled
    day('2026-09-23', [1, 2], [1, 2]), // Tue — scheduled and done
  ];
  assert.equal(walkStreak(tueThu, habitPredicate(1)).streak, 2);
});

test('rest days bridge a streak instead of breaking it', () => {
  const withRest = [
    day('2026-09-26', [1], [1]),
    day('2026-09-25', [], []),         // nothing scheduled
    day('2026-09-24', [1], [1]),
    day('2026-09-23', [1], []),        // break
  ];
  assert.equal(walkStreak(withRest, summitPredicate).streak, 2);
});

test('ranOut tells the caller whether to keep walking back', () => {
  assert.equal(walkStreak(DAYS.slice(0, 2), summitPredicate).ranOut, true,
    'unbroken to the end of the window — there may be more history');
  assert.equal(walkStreak(DAYS, summitPredicate).ranOut, false,
    'a break was found, so the streak is settled');
});

test('longestStreak finds the best run, not just the current one', () => {
  // Deliberately shaped so the current run (3) is SHORTER than an earlier one
  // (6). If longestStreak simply walked from today it would report 3.
  const days = [
    day('2026-09-26', [1], [1]),
    day('2026-09-25', [1], [1]),
    day('2026-09-24', [1], [1]),     // current run ends here: 3
    day('2026-09-23', [1], []),      // break
    day('2026-09-22', [1], [1]),
    day('2026-09-21', [1], [1]),
    day('2026-09-20', [1], [1]),
    day('2026-09-19', [1], [1]),
    day('2026-09-18', [1], [1]),
    day('2026-09-17', [1], [1]),     // earlier run: 6
    day('2026-09-16', [1], []),      // break
  ];

  assert.equal(walkStreak(days, summitPredicate).streak, 3, 'current run');
  assert.equal(longestStreak(days, summitPredicate), 6, 'best run anywhere in the window');
});

test('completion rate counts scheduled habit-days only', () => {
  // 7 days x 2 habits = 14 scheduled; 11 done.
  assert.equal(completionRate(DAYS), 11 / 14);
  assert.equal(completionRate([day('2026-09-26', [], [])]), null,
    'nothing ever scheduled reports null, not 0% — 0% would be a lie');
});

test('habitStats judges a habit only on its own scheduled days', () => {
  const tueThu = [
    day('2026-09-26', [2], [2]),
    day('2026-09-25', [1, 2], [1, 2]),
    day('2026-09-24', [2], [2]),
    day('2026-09-23', [1, 2], [2]),    // habit 1 scheduled but missed
  ];
  const s = habitStats(1, tueThu);
  assert.equal(s.scheduled, 2, 'only the two days it was actually scheduled');
  assert.equal(s.done, 1);
  assert.equal(s.rate, 0.5);
  assert.equal(s.current, 1);
});
