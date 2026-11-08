/* Accumulation signal: a transparent, rules-based valuation score built only from
   Bitcoin's own price history. 0 = historically cheapest, 100 = historically hottest.

   Three lenses, each ranked against all history up to that day (no lookahead):
     1. Power-law position: log distance of price from the long-term trend
        (trend refitted every 30 days using only data known at the time).
     2. Mayer multiple: price / 200-day moving average.
     3. Drawdown: distance below the all-time high so far.
   The score is the average of the three percentile ranks. The backtest below
   reports what buying on days in each zone returned 1 and 2 years later. */
(() => {
 const $s = id => document.getElementById(id);
 const ZONES = [
  { max: 20, name: 'Deep value', color: '#5fd39a', read: 'Bitcoin is cheaper than it has been on most days in its history, on all three measures. Historically one of the strongest times to accumulate.' },
  { max: 40, name: 'Value', color: '#8fd36a', read: 'Bitcoin is priced below its historical norms. Historically a favourable time to accumulate steadily.' },
  { max: 60, name: 'Neutral', color: '#d3c46a', read: 'Bitcoin is priced around its historical middle. Steady, scheduled buying (dollar-cost averaging) has fit these periods best.' },
  { max: 80, name: 'Warm', color: '#e6a04f', read: 'Bitcoin is priced above most of its history. Gains from here have historically been smaller and less reliable.' },
  { max: 101, name: 'Overheated', color: '#e0705f', read: 'Bitcoin is near the most stretched levels in its history. Buying in these periods has historically been close to a coin flip a year later, with deep drawdowns.' }
 ];
 const zoneOf = s => ZONES.find(z => s < z.max);
 const pctFmt = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
 const G = Date.UTC(2009, 0, 3), DAY = 86400000;
 let cache = null; // backtest is computed once per history length

 function insort(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } arr.splice(lo, 0, v); }
 function rankIn(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo / arr.length; }

 function compute(pts) {
  const n = pts.length, X = pts.map(p => Math.log10((p.t - G) / DAY)), Y = pts.map(p => Math.log10(p.p));
  const pl = new Array(n).fill(null), ma = new Array(n).fill(null), dd = new Array(n);
  let hi = 0, sum = 0, fa = null;
  const fit = m => { let mx = 0, my = 0; for (let i = 0; i < m; i++) { mx += X[i]; my += Y[i]; } mx /= m; my /= m; let xx = 0, xy = 0; for (let i = 0; i < m; i++) { xx += (X[i] - mx) ** 2; xy += (X[i] - mx) * (Y[i] - my); } const b = xy / xx; return [my - b * mx, b]; };
  for (let i = 0; i < n; i++) {
   hi = Math.max(hi, pts[i].p); dd[i] = pts[i].p / hi - 1; sum += pts[i].p;
   if (i >= 200) { sum -= pts[i - 200].p; ma[i] = pts[i].p / (sum / 200); }
   if (i >= 730 && (!fa || i % 30 === 0)) fa = fit(i + 1);
   if (fa) pl[i] = Y[i] - (fa[0] + fa[1] * X[i]);
  }
  const sorted = { pl: [], ma: [], dd: [] }, score = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
   if (pl[i] !== null) insort(sorted.pl, pl[i]); if (ma[i] !== null) insort(sorted.ma, ma[i]); insort(sorted.dd, dd[i]);
   if (i >= 1095) score[i] = 100 * (rankIn(sorted.pl, pl[i]) + rankIn(sorted.ma, ma[i]) + rankIn(sorted.dd, dd[i])) / 3;
  }
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const stats = ZONES.map((z, k) => {
   const lo = k ? ZONES[k - 1].max : 0, r1 = [], r2 = []; let days = 0;
   for (let i = 0; i < n; i++) { const s = score[i]; if (s === null || s < lo || s >= z.max) continue; days++; if (i + 365 < n) r1.push(pts[i + 365].p / pts[i].p - 1); if (i + 730 < n) r2.push(pts[i + 730].p / pts[i].p - 1); }
   return { days, n1: r1.length, med1: r1.length ? median(r1) : null, pos1: r1.length ? r1.filter(r => r > 0).length / r1.length : null, worst1: r1.length ? Math.min(...r1) : null, med2: r2.length ? median(r2) : null, pos2: r2.length ? r2.filter(r => r > 0).length / r2.length : null };
  });
  return { n, pl, ma, dd, score, sorted, stats, fa, X };
 }

 /* Today's reading, using the live spot price when available. */
 function today(c, pts, spot) {
  const i = c.n - 1, p = spot || pts[i].p, t = spot ? Date.now() : pts[i].t;
  const x = Math.log10((t - G) / DAY), pl = Math.log10(p) - (c.fa[0] + c.fa[1] * x);
  let s200 = 0; for (let k = i - 198; k <= i; k++) s200 += pts[k].p; const ma = p / ((s200 + p) / 200);
  const ath = Math.max(...pts.map(q => q.p), p), dd = p / ath - 1;
  const r = { pl: rankIn(c.sorted.pl, pl), ma: rankIn(c.sorted.ma, ma), dd: rankIn(c.sorted.dd, dd) };
  return { score: 100 * (r.pl + r.ma + r.dd) / 3, r, pl, ma, dd, p, trend: p / 10 ** pl };
 }

 function gauge(score, zone) {
  const R = 80, cx = 100, cy = 96, a = Math.PI * (1 - score / 100), x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
  let arcs = ''; let from = 0;
  for (const z of ZONES) { const to = Math.min(100, z.max), a0 = Math.PI * (1 - from / 100), a1 = Math.PI * (1 - to / 100);
   arcs += `<path d="M${cx + R * Math.cos(a0)},${cy - R * Math.sin(a0)} A${R},${R} 0 0 1 ${cx + R * Math.cos(a1)},${cy - R * Math.sin(a1)}" stroke="${z.color}" stroke-width="12" fill="none" opacity="${z === zone ? 1 : .28}"/>`; from = to; }
  return `${arcs}<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#edf0f4" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="#edf0f4"/>`;
 }

 function history(c, pts) {
  const svg = $s('signal-history'); if (!svg) return;
  const mobile = window.innerWidth < 720, W = mobile ? 440 : 1100, H = mobile ? 260 : 240, left = 6, right = mobile ? 52 : 46, top = 14, bottom = 30, pw = W - left - right, ph = H - top - bottom;
  const first = c.score.findIndex(s => s !== null), t0 = pts[first].t, t1 = pts.at(-1).t, x = t => left + (t - t0) / (t1 - t0) * pw, y = s => top + (1 - s / 100) * ph;
  const fs = mobile ? 14 : 10;
  let out = ''; let from = 0;
  for (const z of ZONES) { const to = Math.min(100, z.max); out += `<rect x="${left}" y="${y(to)}" width="${pw}" height="${y(from) - y(to)}" fill="${z.color}" opacity=".07"/><text x="${W - right + 8}" y="${y(to) + 4}" fill="#8a94a3" font-family="IBM Plex Mono,monospace" font-size="${fs - 2}">${to}</text><line x1="${left}" x2="${left + pw}" y1="${y(to)}" y2="${y(to)}" stroke="#28303b" stroke-dasharray="3 5"/>`; from = to; }
  let d = ''; for (let i = first; i < c.n; i += 3) d += `${d ? 'L' : 'M'}${x(pts[i].t).toFixed(1)},${y(c.score[i]).toFixed(1)}`;
  out += `<path d="${d}" fill="none" stroke="#edf0f4" stroke-width="1.4" opacity=".85"/>`;
  const y0 = new Date(t0).getUTCFullYear() + 1, y1 = new Date(t1).getUTCFullYear(), step = mobile ? 3 : 2;
  for (let yr = y0; yr <= y1; yr += step) out += `<text x="${x(Date.UTC(yr, 0, 1))}" y="${H - 8}" text-anchor="middle" fill="#8a94a3" font-family="IBM Plex Mono,monospace" font-size="${fs}">${yr}</text>`;
  const s = c.score[c.n - 1]; out += `<circle cx="${x(t1)}" cy="${y(s)}" r="4" fill="${zoneOf(s).color}" stroke="#111419" stroke-width="2"/>`;
  out += `<g class="sig-hover" style="display:none"><line y1="${top}" y2="${top + ph}" stroke="#707b8e" stroke-dasharray="3 4"/><circle r="5" stroke="#111419" stroke-width="2"/></g>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = out;
  hist = { x, y, t0, t1, first, left, pw, W, H, pts, c };
 }

 function render() {
  if (typeof points === 'undefined' || !points.length) return;
  if (!cache || cache.n !== points.length) cache = compute(points);
  const live = typeof quote !== 'undefined' && quote?.price ? quote.price : null, now = today(cache, points, live), zone = zoneOf(now.score), st = cache.stats[ZONES.indexOf(zone)];
  const card = $s('signal-card');
  if (card) { $s('signal-card-score').textContent = Math.round(now.score); $s('signal-card-zone').textContent = zone.name; $s('signal-card-zone').style.color = zone.color; $s('signal-card-note').textContent = st.pos1 !== null ? `Bought in this zone, BTC was up a year later ${Math.round(st.pos1 * 100)}% of the time (median ${pctFmt(st.med1)}).` : ''; }
  if (!$s('signal-gauge') || state.view !== 'signal') return;
  $s('signal-gauge').innerHTML = gauge(now.score, zone);
  $s('signal-score').textContent = Math.round(now.score); $s('signal-zone').textContent = zone.name; $s('signal-zone').style.color = zone.color;
  $s('signal-read').textContent = zone.read;
  $s('signal-basis').textContent = (live ? 'Live spot ' : 'Last daily close ') + money(now.p) + ' · score 0 = historically cheapest, 100 = historically hottest';
  const comps = [
   ['Power-law position', now.r.pl, `${pctFmt(10 ** now.pl - 1)} vs trend (${money(now.trend)})`, 'How far the price sits above or below Bitcoin’s long-term growth trend.'],
   ['Mayer multiple', now.r.ma, `${now.ma.toFixed(2)}× the 200-day average`, 'Price divided by its 200-day moving average. Below 1 means below the recent long-run average.'],
   ['Drawdown from peak', now.r.dd, `${pctFmt(now.dd)} from the all-time high`, 'How far below its highest price Bitcoin is trading.']];
  $s('signal-components').innerHTML = comps.map(([name, r, val, help]) => { const z = zoneOf(r * 100); return `<div class="sig-comp"><div class="sig-comp-head"><strong>${name}</strong><span style="color:${z.color}">${Math.round(r * 100)}</span></div><div class="sig-bar"><span style="width:${Math.max(2, r * 100)}%;background:${z.color}"></span></div><p><b>${val}</b> · pricier than ${Math.round(r * 100)}% of past days on this measure. ${help}</p></div>`; }).join('');
  const cell = (v, f) => v === null ? '—' : f(v);
  $s('signal-backtest').querySelector('tbody').innerHTML = ZONES.map((z, k) => { const s = cache.stats[k], lo = k ? ZONES[k - 1].max : 0; return `<tr class="${z === zone ? 'current' : ''}"><td><span class="fee-chip" style="--c:${z.color}"></span>${z.name}${z === zone ? '<span class="badge">NOW</span>' : ''}</td><td class="num">${lo}–${Math.min(100, z.max)}</td><td class="num">${s.days.toLocaleString()}</td><td class="num">${cell(s.med1, pctFmt)}</td><td class="num">${cell(s.pos1, v => Math.round(v * 100) + '%')}</td><td class="num">${cell(s.worst1, pctFmt)}</td><td class="num">${cell(s.med2, pctFmt)}</td><td class="num">${cell(s.pos2, v => Math.round(v * 100) + '%')}</td></tr>`; }).join('');
  history(cache, points);
 }
 let hist = null, hoverIdx = null;
 function showAt(i) {
  const h = hist; if (!h) return; i = Math.max(h.first, Math.min(h.c.n - 1, i)); hoverIdx = i;
  const svg = $s('signal-history'), g = svg.querySelector('.sig-hover'), tip = $s('signal-tip'), p = h.pts[i], sc = h.c.score[i], z = zoneOf(sc);
  const cx = h.x(p.t), cy = h.y(sc); g.style.display = ''; const ln = g.querySelector('line'), dot = g.querySelector('circle');
  ln.setAttribute('x1', cx); ln.setAttribute('x2', cx); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('fill', z.color);
  const later = i + 365 < h.c.n ? h.pts[i + 365].p / p.p - 1 : null;
  tip.innerHTML = `<strong>${dateLabel(p.t)}</strong><p>Score<b style="color:${z.color}">${Math.round(sc)} · ${z.name}</b></p><p>Price<b>${money(p.p)}</b></p>${later === null ? '' : `<p>1 year later<b style="color:${later >= 0 ? '#83d5a3' : '#df8b8b'}">${pctFmt(later)}</b></p>`}`;
  tip.hidden = false; const box = svg.getBoundingClientRect(), wrap = svg.parentElement.getBoundingClientRect(), px = (cx / h.W) * box.width + box.left - wrap.left;
  tip.style.left = Math.min(Math.max(8, px + 14), wrap.width - tip.offsetWidth - 8) + 'px'; const py = (cy / h.H) * box.height + box.top - wrap.top; tip.style.top = Math.max(4, Math.min(py < wrap.height / 2 ? py + 14 : py - tip.offsetHeight - 14, wrap.height - tip.offsetHeight - 4)) + 'px';
 }
 function hideTip() { hoverIdx = null; const g = $s('signal-history')?.querySelector('.sig-hover'); if (g) g.style.display = 'none'; const t = $s('signal-tip'); if (t) t.hidden = true; }
 function idxAt(e) { const h = hist, box = $s('signal-history').getBoundingClientRect(), vx = (e.clientX - box.left) / box.width * h.W, t = h.t0 + (vx - h.left) / h.pw * (h.t1 - h.t0); return Math.round((t - h.pts[0].t) / DAY); }
 (() => {
  const svg = $s('signal-history'); if (!svg) return;
  svg.setAttribute('tabindex', '0'); svg.style.touchAction = 'pan-y';
  svg.addEventListener('pointermove', e => hist && showAt(idxAt(e)));
  svg.addEventListener('pointerdown', e => hist && showAt(idxAt(e)));
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
  svg.addEventListener('keydown', e => { if (!hist) return; const step = e.shiftKey ? 365 : 30;
   if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showAt((hoverIdx ?? hist.c.n - 1) + (e.key === 'ArrowRight' ? step : -step)); }
   else if (e.key === 'Escape') hideTip(); });
  svg.addEventListener('blur', hideTip);
 })();
 window.renderSignal = render;
 let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
})();
