// Minimal inline-SVG line chart. No dependencies, no build step — the same
// reasoning as the rest of the front end. Deliberately small and general: the
// weight trend uses it now, the diet tab will use it for calories vs target.
//
// Renders into a viewBox and scales with CSS, so it stays sharp at any width and
// needs no resize handling. Colours come from CSS custom properties, so it
// follows the theme rather than hardcoding it.

const W = 640;
const PAD = { top: 14, right: 14, bottom: 24, left: 46 };

// series: [{ date: 'YYYY-MM-DD', value: Number }] in any order
// goal:   optional horizontal reference line (e.g. goal_weight)
// average: optional trailing window in DAYS for a smoothed line (e.g. 7)
export function lineChart(el, {
  series = [],
  goal = null,
  goalLabel = 'goal',
  average = null,
  unit = '',
  decimals = 1,
  height = 200,
} = {}) {
  el.innerHTML = '';

  const points = series
    .filter(p => p.value !== null && p.value !== undefined && Number.isFinite(Number(p.value)))
    .map(p => ({ t: Date.parse(p.date + 'T00:00:00'), v: Number(p.value), date: p.date }))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) {
    el.innerHTML = '<p class="empty">Nothing logged in this range yet.</p>';
    return;
  }

  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Include the goal in the vertical range, or a goal far from your current
  // weight would sit off-chart and silently look like it didn't exist.
  const values = points.map(p => p.v);
  if (goal !== null && Number.isFinite(Number(goal))) values.push(Number(goal));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) { lo -= 1; hi += 1; }          // a single value still needs a band
  const padY = (hi - lo) * 0.12;
  lo -= padY; hi += padY;

  // A single point has no time span; give it one so x() doesn't divide by zero.
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const span = tMax - tMin || 86400000;

  const x = t => PAD.left + ((t - tMin) / span) * plotW;
  const y = v => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const parts = [];

  // --- horizontal gridlines with value labels ---
  for (const frac of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * frac;
    const gy = y(v);
    parts.push(`<line class="ch-grid" x1="${PAD.left}" y1="${gy.toFixed(1)}" x2="${W - PAD.right}" y2="${gy.toFixed(1)}"/>`);
    parts.push(`<text class="ch-axis" x="${PAD.left - 6}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${v.toFixed(decimals)}</text>`);
  }

  // --- goal reference line ---
  if (goal !== null && Number.isFinite(Number(goal))) {
    const gy = y(Number(goal));
    parts.push(`<line class="ch-goal" x1="${PAD.left}" y1="${gy.toFixed(1)}" x2="${W - PAD.right}" y2="${gy.toFixed(1)}"/>`);
    parts.push(`<text class="ch-goal-label" x="${W - PAD.right}" y="${(gy - 5).toFixed(1)}" text-anchor="end">${goalLabel} ${Number(goal).toFixed(decimals)}${unit}</text>`);
  }

  // --- the series itself ---
  parts.push(`<path class="ch-line" d="${pathFor(points, x, y)}"/>`);

  // --- smoothed line, to read the trend through day-to-day noise ---
  if (average && points.length > 2) {
    const avg = movingAverage(points, average);
    parts.push(`<path class="ch-avg" d="${pathFor(avg, x, y)}"/>`);
  }

  // Dots only when they won't turn the line into a caterpillar.
  if (points.length <= 60) {
    for (const p of points) {
      parts.push(`<circle class="ch-dot" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"><title>${p.date}: ${p.v.toFixed(decimals)}${unit}</title></circle>`);
    }
  }

  // --- date labels at each end ---
  parts.push(`<text class="ch-axis" x="${PAD.left}" y="${H - 6}" text-anchor="start">${shortDate(points[0].date)}</text>`);
  if (points.length > 1) {
    parts.push(`<text class="ch-axis" x="${W - PAD.right}" y="${H - 6}" text-anchor="end">${shortDate(points[points.length - 1].date)}</text>`);
  }

  const first = points[0].v.toFixed(decimals);
  const last = points[points.length - 1].v.toFixed(decimals);
  const label = `Trend from ${first}${unit} on ${points[0].date} to ${last}${unit} on ${points[points.length - 1].date}`;

  el.innerHTML =
    `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${label}">`
    + parts.join('')
    + '</svg>';
}

function pathFor(points, x, y) {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(' ');
}

// Trailing average over a window of DAYS, not of points — with irregular
// logging those are very different, and the day-based one is the honest answer.
function movingAverage(points, days) {
  const windowMs = (days - 1) * 86400000;
  return points.map(p => {
    const from = p.t - windowMs;
    const inWindow = points.filter(q => q.t >= from && q.t <= p.t);
    return { t: p.t, v: inWindow.reduce((sum, q) => sum + q.v, 0) / inWindow.length };
  });
}

function shortDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
