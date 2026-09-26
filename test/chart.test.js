// Tests for public/chart.js — the inline-SVG line chart.
//
// chart.js only ever touches el.innerHTML, so it can be exercised with a plain
// object standing in for the element. No DOM, no browser, no test harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineChart } from '../public/chart.js';

const el = () => ({ innerHTML: '' });
const days = n => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date('2026-09-01T00:00:00');
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

// Pull the y coordinate of every point on a path, in order.
const pathYs = (svg, cls) => {
  const m = svg.match(new RegExp(`class="${cls}" d="([^"]+)"`));
  if (!m) return null;
  return m[1].split(/[ML]/).filter(Boolean).map(seg => Number(seg.trim().split(/\s+/)[1]));
};

test('an empty series renders an empty state, not a broken chart', () => {
  const e = el();
  lineChart(e, { series: [] });
  assert.match(e.innerHTML, /class="empty"/);
  assert.doesNotMatch(e.innerHTML, /<svg/);
});

test('non-numeric and missing values are dropped', () => {
  const e = el();
  lineChart(e, { series: [
    { date: '2026-09-01', value: null },
    { date: '2026-09-02', value: undefined },
    { date: '2026-09-03', value: 'nonsense' },
  ] });
  assert.match(e.innerHTML, /class="empty"/, 'nothing plottable left');
});

test('a single point still renders without dividing by zero', () => {
  const e = el();
  lineChart(e, { series: [{ date: '2026-09-01', value: 200 }] });
  assert.match(e.innerHTML, /<svg/);
  const ys = pathYs(e.innerHTML, 'ch-line');
  assert.equal(ys.length, 1);
  assert.ok(Number.isFinite(ys[0]), `y must be finite, got ${ys[0]}`);
});

test('higher values sit higher on the chart', () => {
  // SVG y grows downward, so a larger value must produce a SMALLER y.
  const e = el();
  lineChart(e, { series: [
    { date: '2026-09-01', value: 100 },
    { date: '2026-09-02', value: 200 },
  ] });
  const [y1, y2] = pathYs(e.innerHTML, 'ch-line');
  assert.ok(y2 < y1, `200 should plot above 100 (${y2} !< ${y1})`);
});

test('series order does not matter — points are sorted by date', () => {
  const sorted = el();
  const shuffled = el();
  const series = [
    { date: '2026-09-01', value: 100 },
    { date: '2026-09-02', value: 150 },
    { date: '2026-09-03', value: 120 },
  ];
  lineChart(sorted, { series });
  lineChart(shuffled, { series: [series[2], series[0], series[1]] });
  assert.equal(pathYs(shuffled.innerHTML, 'ch-line').join(), pathYs(sorted.innerHTML, 'ch-line').join());
});

test('the goal line is included in the vertical range', () => {
  // A goal far below every logged value must still be visible, not clipped off
  // the bottom of the chart — otherwise it silently looks like it isn't set.
  const e = el();
  lineChart(e, {
    series: [{ date: '2026-09-01', value: 230 }, { date: '2026-09-02', value: 228 }],
    goal: 195,
    height: 200,
  });
  const goalLine = e.innerHTML.match(/class="ch-goal" x1="[\d.]+" y1="([\d.]+)"/);
  assert.ok(goalLine, 'goal line is drawn');
  const gy = Number(goalLine[1]);
  assert.ok(gy > 0 && gy < 200, `goal line must be inside the chart, got y=${gy}`);
  assert.match(e.innerHTML, /goal 195\.0/, 'and is labelled');
});

test('no goal means no goal line', () => {
  const e = el();
  lineChart(e, { series: [{ date: '2026-09-01', value: 230 }], goal: null });
  assert.doesNotMatch(e.innerHTML, /ch-goal/);
});

test('the moving average smooths a spike', () => {
  // Flat 100s with one spike to 200. The raw line must show the spike; the
  // 7-day average must not reach it.
  const d = days(10);
  const series = d.map((date, i) => ({ date, value: i === 5 ? 200 : 100 }));
  const e = el();
  lineChart(e, { series, average: 7 });

  const raw = pathYs(e.innerHTML, 'ch-line');
  const avg = pathYs(e.innerHTML, 'ch-avg');
  assert.equal(raw.length, avg.length);

  // Smaller y = higher value. The average at the spike must sit BELOW the raw
  // spike (i.e. a larger y), meaning it was damped.
  assert.ok(avg[5] > raw[5], `average should damp the spike (avg y ${avg[5]} !> raw y ${raw[5]})`);
});

test('the average window is measured in days, not in points', () => {
  // Two points 60 days apart: a 7-day window must NOT average them together,
  // even though they are adjacent in the array.
  const e = el();
  lineChart(e, {
    series: [{ date: '2026-07-01', value: 100 }, { date: '2026-08-30', value: 200 }],
    average: 7,
  });
  const raw = pathYs(e.innerHTML, 'ch-line');
  const avg = pathYs(e.innerHTML, 'ch-avg');
  assert.equal(avg, null, 'too few points to average');
  assert.equal(raw.length, 2);

  // With three points where only two fall inside the window, the third is
  // averaged only against itself.
  const e2 = el();
  lineChart(e2, {
    series: [
      { date: '2026-07-01', value: 100 },
      { date: '2026-07-02', value: 100 },
      { date: '2026-08-30', value: 200 },
    ],
    average: 7,
  });
  const raw2 = pathYs(e2.innerHTML, 'ch-line');
  const avg2 = pathYs(e2.innerHTML, 'ch-avg');
  assert.equal(avg2[2], raw2[2], 'the far point averages only with itself');
});

test('dots are dropped once they would crowd the line', () => {
  const few = el();
  lineChart(few, { series: days(10).map((date, i) => ({ date, value: 100 + i })) });
  assert.match(few.innerHTML, /ch-dot/);

  const many = el();
  lineChart(many, { series: days(90).map((date, i) => ({ date, value: 100 + i })) });
  assert.doesNotMatch(many.innerHTML, /ch-dot/);
});

test('the chart carries an accessible label', () => {
  const e = el();
  lineChart(e, { series: [
    { date: '2026-09-01', value: 230 },
    { date: '2026-09-10', value: 225 },
  ], unit: ' lb' });
  assert.match(e.innerHTML, /role="img"/);
  assert.match(e.innerHTML, /aria-label="Trend from 230\.0 lb on 2026-09-01 to 225\.0 lb on 2026-09-10"/);
});
