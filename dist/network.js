/* Live Bitcoin network data: mempool, fees, blocks, mining, supply, Lightning and the learning hub.
   Source: the public mempool.space REST API. Falls back to network-snapshot.json when offline. */
(() => {
 const API = 'https://mempool.space/api';
 const $ = id => document.getElementById(id);
 const HALVING = 210000, EPOCH = 2016, COIN = 1e8, MAX_SUPPLY = 21e6;
 const PAST_HALVINGS = ['2009-01-03', '2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'];
 const net = { fast: {}, slow: {}, fastLive: false, slowLive: false, fastAt: 0, slowAt: 0, snapshot: null, loading: false };

 /* ---------- formatting ---------- */
 const nf = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
 const usd = (v, d) => {
  if (!Number.isFinite(v)) return '—';
  if (d === undefined) d = Math.abs(v) < 1 ? 2 : Math.abs(v) < 100 ? 2 : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
 };
 const bigUsd = v => v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : usd(v);
 const rate = r => !Number.isFinite(r) ? '—' : r < 1 ? r.toFixed(2) : r < 10 ? r.toFixed(1) : nf(r);
 const btc = (sats, d = 4) => nf(sats / COIN, d) + ' BTC';
 const ehs = h => (h / 1e18).toFixed(0) + ' EH/s';
 const trillions = d => (d / 1e12).toFixed(1) + 'T';
 const pct = (v, d = 2) => (v > 0 ? '+' : '') + v.toFixed(d) + '%';
 const ago = sec => {
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min ago';
  return Math.floor(s / 86400) + ' d ago';
 };
 const dur = ms => {
  const m = Math.max(0, ms / 60000);
  if (m < 60) return Math.round(m) + ' min';
  if (m < 1440) return (m / 60).toFixed(1) + ' hours';
  if (m < 1440 * 60) return (m / 1440).toFixed(1) + ' days';
  return Math.round(m / 1440 / 30.44) + ' months';
 };
 const day = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
 const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
 const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 /* cheap fees are cool blue, expensive fees are hot red, on a log scale from 0.1 to 100 sat/vB */
 const feeHue = r => 210 - 210 * Math.min(1, Math.max(0, (Math.log10(Math.max(r, .1)) + 1) / 3));
 const feeColor = (r, l = 60) => `hsl(${feeHue(r).toFixed(0)} 70% ${l}%)`;
 /* charts render into a smaller viewBox on phones, so type is scaled up to stay legible */
 const isPhone = () => window.innerWidth < 720;
 const text = (x, y, s, anchor = 'start', color = '#7a8798', size = 10) => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="IBM Plex Mono,monospace" font-size="${isPhone() ? size * 1.45 : size}">${s}</text>`;

 /* ---------- data ---------- */
 const price = () => (typeof quote !== 'undefined' && quote?.price) || net.fast.prices?.USD || null;
 function subsidyAt(height) { const era = Math.floor(height / HALVING); return era >= 64 ? 0 : Math.floor(50 * COIN / 2 ** era); }
 /* Supply after `height` blocks have been mined (blocks 0..height), exact to the satoshi per the issuance schedule. */
 function supplyAt(height) {
  let sats = 0;
  for (let era = 0; era < 64; era++) {
   const start = era * HALVING; if (start > height) break;
   const blocks = Math.min(height, start + HALVING - 1) - start + 1;
   sats += blocks * Math.floor(50 * COIN / 2 ** era);
  }
  return sats / COIN;
 }
 const tipHeight = () => net.fast.blocks?.[0]?.height;
 window.netSupply = () => { const h = tipHeight(); return h ? { height: h, supply: supplyAt(h) } : null; };

 async function getJSON(path) {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (!r.ok) throw Error(path + ' ' + r.status);
  return r.json();
 }
 async function snapshot() {
  if (!net.snapshot) net.snapshot = fetch('network-snapshot.json').then(r => { if (!r.ok) throw Error('No snapshot'); return r.json(); });
  return net.snapshot;
 }
 const FAST = { fees: '/v1/fees/precise', mempool: '/mempool', mempoolBlocks: '/v1/fees/mempool-blocks', blocks: '/v1/blocks', difficulty: '/v1/difficulty-adjustment', prices: '/v1/prices' };
 const SLOW = { hashrate: '/v1/mining/hashrate/1y', pools: '/v1/mining/pools/1w', rewards: '/v1/mining/reward-stats/144', lightning: '/v1/lightning/statistics/latest', lightningHistory: '/v1/lightning/statistics/1y' };
 async function loadGroup(spec, target) {
  const keys = Object.keys(spec);
  const results = await Promise.allSettled(keys.map(k => getJSON(spec[k])));
  let live = 0, snap = null;
  for (let i = 0; i < keys.length; i++) {
   if (results[i].status === 'fulfilled') { target[keys[i]] = results[i].value; live++; continue; }
   if (target[keys[i]]) continue; // keep the last good live value
   try { snap = snap || await snapshot(); target[keys[i]] = snap[keys[i]]; } catch { }
  }
  return { live: live === keys.length, partial: live > 0, snapAt: snap ? Date.parse(snap.fetched) : null };
 }
 async function refresh(includeSlow = false, manual = false) {
  if (net.loading) return; net.loading = true;
  try {
   const jobs = [loadGroup(FAST, net.fast)];
   const slowDue = includeSlow || !net.slowAt || Date.now() - net.slowAt > 15 * 60000;
   if (slowDue) jobs.push(loadGroup(SLOW, net.slow));
   const [fast, slow] = await Promise.all(jobs);
   net.fastLive = fast.partial; net.fastAt = fast.partial ? Date.now() : fast.snapAt || net.fastAt;
   if (slow) { net.slowLive = slow.partial; net.slowAt = slow.partial ? Date.now() : slow.snapAt || net.slowAt; }
   renderAll();
   if (manual && !fast.partial) window.notify?.('Network data unavailable. Showing the saved snapshot.');
  } finally { net.loading = false; }
 }
 window.refreshNetwork = manual => refresh(true, manual);

 /* ---------- status ---------- */
 function renderStatus() {
  const live = net.fastLive, at = net.fastAt;
  const label = !at ? 'Fetching network data' : live ? 'Live · mempool.space · updated ' + hhmm(at) : 'Saved snapshot · ' + day(at) + ' ' + hhmm(at);
  document.querySelectorAll('.net-status').forEach(el => el.textContent = label);
  document.querySelectorAll('.net-dot').forEach(el => el.classList.toggle('stale-dot', !live));
  document.querySelectorAll('.net-badge').forEach(el => { el.textContent = !at ? 'CONNECTING' : live ? 'LIVE' : 'SNAPSHOT'; el.classList.toggle('saved-badge', !!at && !live); });
  const h = tipHeight();
  if (h) $('net-bar-status').textContent = `Block ${nf(h)} · ${ago(net.fast.blocks[0].timestamp)}`;
 }

 /* ---------- overview pulse ---------- */
 function renderPulse() {
  const f = net.fast, s = net.slow, p = price(), h = tipHeight();
  if (h) { $('pulse-height').textContent = nf(h); $('pulse-height-note').textContent = 'mined ' + ago(f.blocks[0].timestamp); }
  if (f.fees) { $('pulse-fee').textContent = rate(f.fees.fastestFee) + ' sat/vB'; $('pulse-fee-note').textContent = p ? 'about ' + usd(f.fees.fastestFee * 141 / COIN * p) + ' for a simple payment' : 'for confirmation in ~10 min'; }
  if (f.mempool) { $('pulse-mempool').textContent = nf(f.mempool.count) + ' tx'; $('pulse-mempool-note').textContent = (f.mempool.vsize / 1e6).toFixed(1) + ' vMB · ~' + Math.max(1, Math.ceil(f.mempool.vsize / 1e6)) + ' blocks to clear'; }
  if (s.hashrate) { $('pulse-hash').textContent = ehs(s.hashrate.currentHashrate); $('pulse-hash-note').textContent = 'quintillion guesses per second'; }
  if (f.difficulty) { const d = f.difficulty; $('pulse-diff').textContent = pct(d.difficultyChange, 1); $('pulse-diff').className = d.difficultyChange >= 0 ? 'up' : 'down'; $('pulse-diff-note').textContent = 'est. change in ' + nf(d.remainingBlocks) + ' blocks'; }
  if (h) { const left = (Math.floor(h / HALVING) + 1) * HALVING - h; $('pulse-halving').textContent = nf(left * blockMs() / 86400000) + ' days'; $('pulse-halving-note').textContent = nf(left) + ' blocks · reward ' + subsidyAt(h) / COIN + ' → ' + subsidyAt(h + left) / COIN + ' BTC'; }
  if (p) { $('pulse-sats').textContent = nf(COIN / p) + ' sats'; $('pulse-sats-note').textContent = '1 sat = ' + usd(p / COIN, 5); }
  if (p && h) { $('pulse-cap').textContent = bigUsd(p * supplyAt(h)); $('pulse-cap-note').textContent = nf(supplyAt(h) / 1e6, 3) + 'M BTC × ' + usd(p, 0); }
 }
 /* Average block interval: recent epoch pace from the difficulty endpoint, clamped to sane bounds. */
 const blockMs = () => Math.min(720000, Math.max(480000, net.fast.difficulty?.timeAvg || 600000));

 /* ---------- mempool view ---------- */
 const TIERS = [['economyFee', 'No rush', 'within a day, usually'], ['hourFee', 'Low priority', 'about 1 hour'], ['halfHourFee', 'Standard', 'about 30 minutes'], ['fastestFee', 'Next block', 'about 10 minutes']];
 function renderFees() {
  const f = net.fast.fees; if (!f) return;
  const vb = Number($('tx-type').value), p = price();
  $('fee-tiers').innerHTML = TIERS.map(([k, name, eta], i) => {
   const r = f[k], sats = r * vb;
   return `<div class="fee-tier${i === 3 ? ' featured' : ''}" style="--c:${feeColor(r)}"><span class="tier-name">${name}</span><strong>${rate(r)}<small> sat/vB</small></strong><span class="tier-cost">${p ? usd(sats / COIN * p) : nf(sats) + ' sats'}</span><span class="tier-meta">${nf(Math.round(sats))} sats · ${eta}</span></div>`;
  }).join('');
  $('tx-size-note').textContent = `Estimated size ${vb} vB · minimum relay fee ${rate(f.minimumFee)} sat/vB`;
 }
 function renderRail() {
  const mb = net.fast.mempoolBlocks || [], blocks = net.fast.blocks || [];
  const upcoming = mb.slice(0, 6).map((b, i) => {
   const lo = b.feeRange?.[0], hi = b.feeRange?.at(-1), more = b.blockVSize > 1.2e6 ? Math.ceil(b.blockVSize / 1e6) : 0;
   const eta = i === mb.length - 1 && more ? `+${more} blocks` : `~${(i + 1) * 10} min`;
   return `<div class="rail-block pending" style="--c:${feeColor(b.medianFee)}"><span class="rb-top">${eta}</span><strong>~${rate(b.medianFee)}<small> sat/vB</small></strong><span>${rate(lo)} – ${rate(hi)} sat/vB</span><span>${nf(b.nTx)} tx</span><span>${btc(b.totalFees, 3)}</span></div>`;
  }).reverse();
  const mined = blocks.slice(0, 6).map(b => {
   const m = b.extras?.medianFee ?? 0;
   return `<div class="rail-block mined" style="--c:${feeColor(m)}"><span class="rb-top">#${nf(b.height)}</span><strong>~${rate(m)}<small> sat/vB</small></strong><span>${nf(b.tx_count)} tx · ${(b.size / 1e6).toFixed(2)} MB</span><span>${esc(b.extras?.pool?.name || 'Unknown')}</span><span class="rb-age" data-ts="${b.timestamp}">${ago(b.timestamp)}</span></div>`;
  });
  $('block-rail').innerHTML = `<div class="rail-side"><span class="rail-label">WAITING · NEXT BLOCKS →</span><div class="rail-row">${upcoming.join('')}</div></div><div class="rail-divider" aria-hidden="true"><span>NOW</span></div><div class="rail-side"><span class="rail-label">← JUST MINED</span><div class="rail-row">${mined.join('')}</div></div>`;
  const rail = $('block-rail'), div = rail.querySelector('.rail-divider');
  if (rail.offsetWidth && !rail.dataset.touched) rail.scrollLeft = div.offsetLeft - rail.clientWidth / 2 + div.offsetWidth / 2;
 }
 function renderMempoolStats() {
  const m = net.fast.mempool; if (!m) return; const p = price(), mb = net.fast.mempoolBlocks || [];
  const cells = [
   ['Waiting transactions', nf(m.count), 'unconfirmed right now'],
   ['Total size', (m.vsize / 1e6).toFixed(1) + ' vMB', `≈ ${Math.max(1, Math.ceil(m.vsize / 1e6))} blocks of space`],
   ['Fees on the table', btc(m.total_fee, 3), p ? usd(m.total_fee / COIN * p, 0) + ' for miners to collect' : 'for miners to collect'],
   ['Next block pays', mb[0] ? btc(mb[0].totalFees, 4) : '—', mb[0] && p ? usd(mb[0].totalFees / COIN * p, 0) + ' in fees + ' + subsidyAt(tipHeight() || 0) / COIN + ' BTC reward' : '']
  ];
  $('mempool-stats').innerHTML = cells.map(c => `<div class="stat"><span>${c[0]}</span><strong>${c[1]}</strong><em>${c[2]}</em></div>`).join('');
 }
 /* Slider is logarithmic: 0..1000 maps to 0.1..500 sat/vB */
 const sliderRate = v => 10 ** (-1 + v / 1000 * Math.log10(5000));
 function renderQueue() {
  const hist = net.fast.mempool?.fee_histogram; if (!hist) return;
  const r = sliderRate(Number($('queue-rate').value)), p = price();
  let ahead = 0; for (const [fr, vs] of hist) if (fr > r) ahead += vs;
  const blocks = Math.floor(ahead / 1e6) + 1, mins = blocks * blockMs() / 60000;
  $('queue-rate-label').textContent = rate(r) + ' sat/vB';
  $('queue-rate').style.background = `linear-gradient(90deg,${feeColor(r)} ${Number($('queue-rate').value) / 10}%,#303844 ${Number($('queue-rate').value) / 10}%)`;
  const below = net.fast.fees && r < net.fast.fees.minimumFee;
  $('queue-result').innerHTML = below ? `<strong class="down">Below the minimum relay fee</strong><p>Most nodes would not accept a transaction this cheap. Use at least ${rate(net.fast.fees.minimumFee)} sat/vB.</p>` :
   `<div><span>Queued ahead of you</span><strong>${(ahead / 1e6).toFixed(2)} vMB</strong></div><div><span>Likely block</span><strong>${blocks === 1 ? 'Next block' : '#' + blocks + ' in line'}</strong></div><div><span>Estimated wait</span><strong>${blocks === 1 ? '~10 min' : '~' + dur(mins * 60000)}</strong></div><div><span>Simple payment cost</span><strong>${p ? usd(r * 141 / COIN * p) : nf(r * 141) + ' sats'}</strong></div>`;
 }
 const BUCKETS = [0, 0.2, 0.5, 1, 2, 3, 5, 10, 20, 50, Infinity];
 function renderFeeHist() {
  const hist = net.fast.mempool?.fee_histogram; if (!hist) return;
  const sums = BUCKETS.slice(0, -1).map(() => 0);
  for (const [fr, vs] of hist) { const i = BUCKETS.findIndex((b, j) => fr >= b && fr < BUCKETS[j + 1]); if (i >= 0) sums[i] += vs; }
  const W = isPhone() ? 440 : 1100, H = isPhone() ? 300 : 260, left = 6, right = isPhone() ? 80 : 70, top = 26, bottom = isPhone() ? 48 : 40, pw = W - left - right, ph = H - top - bottom;
  const max = Math.max(1, ...sums) / 1e6, n = sums.length, bw = pw / n;
  let out = '';
  const ticks = niceTicks(0, max, 4);
  for (const t of ticks) { const y = top + ph - t / max * ph; out += `<line x1="${left}" x2="${left + pw}" y1="${y}" y2="${y}" stroke="#28303b" stroke-dasharray="3 5"/>` + text(W - right + 10, y + 3, t.toFixed(t < 1 ? 1 : 0) + ' vMB'); }
  sums.forEach((v, i) => {
   const mid = BUCKETS[i + 1] === Infinity ? 100 : Math.sqrt(Math.max(.1, BUCKETS[i]) * BUCKETS[i + 1]);
   const hgt = v / 1e6 / max * ph, x = left + i * bw + 6, y = top + ph - hgt;
   const label = BUCKETS[i + 1] === Infinity ? BUCKETS[i] + '+' : BUCKETS[i] === 0 ? '< ' + BUCKETS[1] : BUCKETS[i] + '–' + BUCKETS[i + 1];
   out += `<rect class="hist-bar" data-i="${i}" x="${x}" y="${y}" width="${bw - 12}" height="${Math.max(1, hgt)}" rx="3" fill="${feeColor(mid)}" fill-opacity=".8"/>`;
   if (v) out += text(x + (bw - 12) / 2, y - 6, (v / 1e6).toFixed(v > 1e6 ? 1 : 2), 'middle', '#c5cdd8', isPhone() ? 7.5 : 10);
   if (!isPhone() || i % 2 === 0) out += text(x + (bw - 12) / 2, H - (isPhone() ? 26 : 20), label, 'middle', '#8995a6', isPhone() ? 8 : 10);
  });
  out += text(left + pw / 2, H - 4, isPhone() ? 'fee rate (sat/vB)' : 'fee rate (sat/vB) · cheaper ←   → more expensive', 'middle', '#5f6b7b', 9);
  $('fee-hist').setAttribute('viewBox', `0 0 ${W} ${H}`); $('fee-hist').innerHTML = out;
  $('fee-hist').querySelectorAll('.hist-bar').forEach(bar => {
   const show = e => {
    const i = Number(bar.dataset.i), tip = $('fee-hist-tip'); let higher = 0; for (let j = i + 1; j < sums.length; j++) higher += sums[j];
    const lo = BUCKETS[i], hi = BUCKETS[i + 1];
    tip.innerHTML = `<strong>${hi === Infinity ? lo + '+ sat/vB' : (lo === 0 ? 'Under ' + hi : lo + ' – ' + hi) + ' sat/vB'}</strong><p>Waiting<b>${(sums[i] / 1e6).toFixed(2)} vMB</b></p><p>Higher fees ahead<b>${(higher / 1e6).toFixed(2)} vMB</b></p>`;
    placeTip(tip, e, bar.closest('.chart-container'));
   };
   bar.addEventListener('pointermove', show); bar.addEventListener('pointerleave', () => $('fee-hist-tip').hidden = true);
  });
 }
 function placeTip(tip, e, container) {
  tip.hidden = false; const r = container.getBoundingClientRect();
  tip.style.left = Math.min(Math.max(8, e.clientX - r.left + 14), Math.max(8, r.width - tip.offsetWidth - 8)) + 'px';
  tip.style.top = Math.min(Math.max(4, e.clientY - r.top - tip.offsetHeight - 10), Math.max(4, r.height - tip.offsetHeight - 8)) + 'px';
 }
 function niceTicks(lo, hi, count) {
  const span = hi - lo || 1, step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
 }

 /* ---------- generic time-series chart with hover ---------- */
 function lineChart(svgId, tipId, series, opts) {
  const svg = $(svgId); if (!svg || !series.length) return;
  const mobile = isPhone(), W = mobile ? 440 : 1100, H = mobile ? 300 : opts.height || 300, left = 6, right = mobile ? 112 : 92, top = 20, bottom = mobile ? 40 : 32, pw = W - left - right, ph = H - top - bottom;
  const t0 = series[0].t, t1 = series.at(-1).t, vals = series.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .12 || hi * .1; lo = Math.max(0, lo - pad); hi += pad;
  const x = t => left + (t - t0) / (t1 - t0 || 1) * pw, y = v => top + (hi - v) / (hi - lo) * ph;
  let out = `<defs><linearGradient id="${svgId}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${opts.color}" stop-opacity=".18"/><stop offset="1" stop-color="${opts.color}" stop-opacity="0"/></linearGradient></defs>`;
  const tagY = y(series.at(-1).v);
  for (const v of niceTicks(lo, hi, 4)) { const yy = y(v); out += `<line x1="${left}" x2="${left + pw}" y1="${yy}" y2="${yy}" stroke="#28303b" stroke-dasharray="3 5"/>` + (Math.abs(yy - tagY) < (mobile ? 26 : 18) ? '' : text(W - right + 10, yy + 3, opts.fmt(v))); }
  for (let i = 0; i <= (mobile ? 3 : 6); i++) { const t = t0 + (t1 - t0) * i / (mobile ? 3 : 6); out += text(x(t), H - (mobile ? 12 : 9), new Date(t).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }), i === 0 ? 'start' : i === (mobile ? 3 : 6) ? 'end' : 'middle'); }
  if (opts.secondary?.length) {
   const sv = opts.secondary.map(p => p.v), slo = Math.min(...sv) * .9, shi = Math.max(...sv) * 1.05, sy = v => top + (shi - v) / (shi - slo) * ph;
   let d = '', prev = null;
   for (const p of opts.secondary) { const xx = Math.max(left, x(p.t)); d += prev === null ? `M${left},${sy(p.v)}` : `L${xx},${sy(prev)} L${xx},${sy(p.v)}`; prev = p.v; }
   d += ` L${left + pw},${sy(prev)}`;
   out += `<path d="${d}" fill="none" stroke="#9babc2" stroke-width="1.3" stroke-dasharray="5 4" opacity=".75"/>`;
   opts._sy = sy;
  }
  /* split into segments wherever the data has a gap longer than 4 days */
  const segs = [[]]; series.forEach((p, i) => { if (i && p.t - series[i - 1].t > 4 * 86400000) segs.push([]); segs.at(-1).push(p); });
  if (opts.raw) out += `<path d="${series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(Math.min(hi, Math.max(lo, p.raw))).toFixed(1)}`).join(' ')}" fill="none" stroke="${opts.color}" stroke-width="1" opacity=".22"/>`;
  for (const seg of segs) {
   const path = seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
   out += `<path d="${path} L${x(seg.at(-1).t)},${top + ph} L${x(seg[0].t)},${top + ph} Z" fill="url(#${svgId}-fill)"/><path d="${path}" fill="none" stroke="${opts.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
  }
  for (let i = 1; i < segs.length; i++) { const a = x(segs[i - 1].at(-1).t), b = x(segs[i][0].t); out += `<rect x="${a}" y="${top}" width="${b - a}" height="${ph}" fill="#ffffff" opacity=".025"/>` + (b - a > 60 ? text((a + b) / 2, top + ph / 2, 'no data', 'middle', '#5f6b7b', 10) : ''); }
  const last = series.at(-1);
  out += `<circle cx="${x(last.t)}" cy="${y(last.v)}" r="3.5" fill="${opts.color}" stroke="#15191f" stroke-width="2"/><rect x="${W - right + 6}" y="${y(last.v) - (mobile ? 13 : 10)}" width="${right - 10}" height="${mobile ? 26 : 20}" rx="3" fill="${opts.color}"/>` + text(W - right + 6 + (right - 10) / 2, y(last.v) + (mobile ? 5 : 4), opts.fmt(last.v), 'middle', '#18191c', 10);
  out += `<g class="hover" style="display:none"><line y1="${top}" y2="${top + ph}" stroke="#707b8e" stroke-dasharray="3 4"/><circle r="4" fill="${opts.color}" stroke="#15191f" stroke-width="2"/></g>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = out;
  const hover = svg.querySelector('.hover'), tip = $(tipId);
  svg.onpointermove = e => {
   const r = svg.getBoundingClientRect(), xx = (e.clientX - r.left) / r.width * W; if (xx < left || xx > left + pw) return;
   const t = t0 + (xx - left) / pw * (t1 - t0); let best = series[0];
   for (const p of series) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
   hover.style.display = ''; hover.querySelector('line').setAttribute('x1', x(best.t)); hover.querySelector('line').setAttribute('x2', x(best.t));
   hover.querySelector('circle').setAttribute('cx', x(best.t)); hover.querySelector('circle').setAttribute('cy', y(best.v));
   tip.innerHTML = `<strong>${day(best.t)}</strong>` + opts.tip(best);
   placeTip(tip, e, svg.closest('.chart-container'));
  };
  svg.onpointerleave = () => { hover.style.display = 'none'; tip.hidden = true; };
 }

 /* ---------- mining view ---------- */
 function renderMining() {
  const f = net.fast, s = net.slow, p = price(), h = tipHeight();
  if (s.hashrate) {
   const diffs = s.hashrate.difficulty.map(d => ({ t: d.time * 1000, v: d.difficulty }));
   const diffAt = t => { let v = diffs[0]?.v; for (const d of diffs) if (d.t <= t) v = d.v; return v; };
   const daily = s.hashrate.hashrates.map(d => ({ t: d.timestamp * 1000, raw: d.avgHashrate / 1e18 }));
   daily.forEach((d, i) => { const w = daily.slice(Math.max(0, i - 6), i + 1); d.v = w.reduce((a, b) => a + b.raw, 0) / w.length; });
   lineChart('hash-chart', 'hash-tip', daily, {
    color: '#f6a13b', fmt: v => v.toFixed(0) + ' EH/s', secondary: diffs, raw: true,
    tip: pt => `<p>7-day average<b>${pt.v.toFixed(0)} EH/s</b></p><p>That day<b>${pt.raw.toFixed(0)} EH/s</b></p><p>Difficulty<b>${trillions(diffAt(pt.t))}</b></p>`
   });
  }
  const rw = s.rewards, d = f.difficulty;
  const cards = [];
  if (s.hashrate) cards.push(['Hashrate', ehs(s.hashrate.currentHashrate), '7-day estimate ' + ehs(s.pools?.lastEstimatedHashrate1w || s.hashrate.currentHashrate)]);
  if (s.hashrate) cards.push(['Difficulty', trillions(s.hashrate.currentDifficulty), 'guesses per block ≈ difficulty × 2³²']);
  if (h) cards.push(['Block reward', subsidyAt(h) / COIN + ' BTC', p ? usd(subsidyAt(h) / COIN * p, 0) + ' per block + fees' : 'plus transaction fees']);
  if (rw && p && s.hashrate) {
   const rev = Number(rw.totalReward) / COIN * p, feeShare = Number(rw.totalFee) / Number(rw.totalReward) * 100;
   cards.push(['Hashprice', usd(rev / (s.hashrate.currentHashrate / 1e15), 2), 'per PH/s per day · fees ' + feeShare.toFixed(1) + '% of revenue']);
  }
  $('mining-cards').innerHTML = cards.map(c => `<div class="stat card"><span>${c[0]}</span><strong>${c[1]}</strong><em>${c[2]}</em></div>`).join('');
  if (d) {
   const pctDone = d.progressPercent, up = d.difficultyChange >= 0, mins = d.timeAvg / 60000;
   $('difficulty-epoch').innerHTML = `<div class="epoch-bar"><span style="width:${pctDone.toFixed(1)}%"></span></div><div class="epoch-labels"><span>Block ${nf(d.nextRetargetHeight - EPOCH)}</span><span>${pctDone.toFixed(1)}% complete</span><span>Block ${nf(d.nextRetargetHeight)}</span></div>
   <div class="stat-grid flat"><div class="stat"><span>Estimated change</span><strong class="${up ? 'up' : 'down'}">${pct(d.difficultyChange)}</strong><em>${up ? 'blocks are coming faster than 10 min' : 'blocks are coming slower than 10 min'}</em></div><div class="stat"><span>Average block time</span><strong>${mins.toFixed(1)} min</strong><em>target is 10.0 min</em></div><div class="stat"><span>Blocks remaining</span><strong>${nf(d.remainingBlocks)}</strong><em>about ${dur(d.remainingTime)}</em></div><div class="stat"><span>Expected on</span><strong>${day(d.estimatedRetargetDate)}</strong><em>last change ${pct(d.previousRetarget)}</em></div></div>`;
  }
  if (s.pools) {
   const pools = [...s.pools.pools].sort((a, b) => b.blockCount - a.blockCount), total = s.pools.blockCount || pools.reduce((a, b) => a + b.blockCount, 0);
   let cum = 0, needed = 0; for (const pl of pools) { if (cum * 2 > total) break; cum += pl.blockCount; needed++; }
   const top = pools.slice(0, 8), other = pools.slice(8).reduce((a, b) => a + b.blockCount, 0);
   const rows = top.map(pl => [pl.name, pl.blockCount]); if (other) rows.push(['Other pools', other]);
   const colors = ['#f6a13b', '#6c97de', '#9b82d5', '#83d5a3', '#d98a6c', '#c7b46a', '#6cc3c9', '#d183b8', '#59626f'];
   $('pool-list').innerHTML = rows.map((r, i) => `<div class="bar-row"><span class="bar-name"><i style="background:${colors[i]}"></i>${esc(r[0])}</span><span class="bar-track"><span style="width:${(r[1] / rows[0][1] * 100).toFixed(1)}%;background:${colors[i]}"></span></span><span class="bar-val">${(r[1] / total * 100).toFixed(1)}%</span></div>`).join('') +
    `<p class="pool-note"><strong>${needed} pool${needed === 1 ? '' : 's'}</strong> together found more than half of the ${nf(total)} blocks this week. Pools coordinate hashpower, but individual miners can switch pools at any time.</p>`;
  }
  const blocks = f.blocks || [];
  $('blocks-table').querySelector('tbody').innerHTML = blocks.slice(0, 12).map(b => `<tr><td><span class="fee-chip" style="--c:${feeColor(b.extras?.medianFee ?? 0)}"></span>${nf(b.height)}</td><td class="rb-age" data-ts="${b.timestamp}">${ago(b.timestamp)}</td><td>${esc(b.extras?.pool?.name || 'Unknown')}</td><td class="num">${nf(b.tx_count)}</td><td class="num">${(b.size / 1e6).toFixed(2)} MB</td><td class="num">${rate(b.extras?.medianFee)} sat/vB</td><td class="num">${b.extras?.reward ? nf(b.extras.reward / COIN, 3) + ' BTC' : '—'}</td></tr>`).join('');
 }

 /* ---------- supply view ---------- */
 function renderSupply() {
  const h = tipHeight(); if (!h) return; const p = price();
  const era = Math.floor(h / HALVING), next = (era + 1) * HALVING, left = next - h, eta = Date.now() + left * blockMs();
  const done = (h - era * HALVING) / HALVING, supply = supplyAt(h), sub = subsidyAt(h) / COIN, yearly = sub * 52560;
  const days = left * blockMs() / 86400000;
  $('halving-countdown').innerHTML = `${nf(Math.floor(days))}<small> days</small> ${nf(Math.floor(days % 1 * 24))}<small> h</small>`;
  $('halving-eta').innerHTML = `Expected around <strong>${day(eta)}</strong> at block ${nf(next)}, ${nf(left)} blocks from now. The reward drops from ${sub} to ${sub / 2} BTC.`;
  const R = 50, C = 2 * Math.PI * R;
  $('halving-ring').innerHTML = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="#242a33" stroke-width="9"/><circle cx="60" cy="60" r="${R}" fill="none" stroke="#f6a13b" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * done).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>`;
  $('halving-pct').textContent = (done * 100).toFixed(1) + '%';
  const cells = [
   ['Issued so far', nf(supply, 2) + ' BTC', (supply / MAX_SUPPLY * 100).toFixed(3) + '% of 21 million'],
   ['Left to mine', nf(MAX_SUPPLY - supply, 0) + ' BTC', 'over roughly the next ' + (2140 - new Date().getUTCFullYear()) + ' years'],
   ['New coins per day', nf(sub * 144, 1) + ' BTC', p ? usd(sub * 144 * p, 0) + ' at today’s price' : '144 blocks × ' + sub + ' BTC'],
   ['Annual inflation', (yearly / supply * 100).toFixed(2) + '%', `falls to ≈ ${(yearly / 2 / supplyAt(next + 52560) * 100).toFixed(2)}% after the halving`],
   ['Stock-to-flow', nf(supply / yearly, 0) + ' years', 'existing supply ÷ yearly new supply'],
   ['Smallest unit', '1 sat', '0.00000001 BTC']
  ];
  $('supply-stats').innerHTML = cells.map(c => `<div class="stat"><span>${c[0]}</span><strong>${c[1]}</strong><em>${c[2]}</em></div>`).join('');
  drawSupplyChart(h);
  const rows = [];
  for (let e = 0; e <= era + 3; e++) {
   const start = e * HALVING, date = PAST_HALVINGS[e] ? day(Date.parse(PAST_HALVINGS[e])) : '≈ ' + day(timeAt(start, h));
   const sAt = start ? supplyAt(start - 1) : 0, cur = e === era;
   rows.push(`<tr class="${cur ? 'current' : e > era ? 'future' : ''}"><td>${e + 1}${cur ? ' <span class="badge">NOW</span>' : ''}</td><td>${nf(start)}</td><td>${date}</td><td class="num">${subsidyAt(start) / COIN} BTC</td><td class="num">${nf(sAt, 0)} BTC</td><td class="num">${(sAt / MAX_SUPPLY * 100).toFixed(2)}%</td></tr>`);
  }
  $('halving-table').querySelector('tbody').innerHTML = rows.join('');
 }
 /* Map block height <-> time using real halving dates for the past and 10-minute blocks for the future. */
 function anchors(h) { return PAST_HALVINGS.map((d, e) => [e * HALVING, Date.parse(d)]).filter(a => a[0] < h).concat([[h, Date.now()]]); }
 function timeAt(height, h) {
  const a = anchors(h); if (height >= h) return Date.now() + (height - h) * blockMs();
  for (let i = 1; i < a.length; i++) if (height <= a[i][0]) return a[i - 1][1] + (height - a[i - 1][0]) / (a[i][0] - a[i - 1][0]) * (a[i][1] - a[i - 1][1]);
  return a[0][1];
 }
 function heightAt(t, h) {
  const a = anchors(h); if (t >= Date.now()) return h + Math.round((t - Date.now()) / blockMs());
  for (let i = 1; i < a.length; i++) if (t <= a[i][1]) return Math.round(a[i - 1][0] + (t - a[i - 1][1]) / (a[i][1] - a[i - 1][1]) * (a[i][0] - a[i - 1][0]));
  return 0;
 }
 function drawSupplyChart(h) {
  const mobile = isPhone(), W = mobile ? 440 : 1100, H = mobile ? 300 : 300, left = 6, right = mobile ? 62 : 86, top = 20, bottom = mobile ? 40 : 32, pw = W - left - right, ph = H - top - bottom;
  const g = Date.UTC(2009, 0, 3), end = Date.UTC(2070, 0, 1), tAt = height => timeAt(height, h);
  const x = t => left + (t - g) / (end - g) * pw, y = v => top + ph - v / MAX_SUPPLY * ph;
  let out = `<defs><linearGradient id="supply-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6a13b" stop-opacity=".18"/><stop offset="1" stop-color="#f6a13b" stop-opacity="0"/></linearGradient></defs>`;
  for (const v of [0, 5e6, 10e6, 15e6, 21e6]) out += `<line x1="${left}" x2="${left + pw}" y1="${y(v)}" y2="${y(v)}" stroke="#28303b" stroke-dasharray="3 5"/>` + text(W - right + 10, y(v) + 3, v / 1e6 + 'M');
  for (const yr of mobile ? [2009, 2030, 2050, 2070] : [2009, 2016, 2024, 2032, 2040, 2050, 2060, 2070]) out += text(x(Date.UTC(yr, 0, 1)), H - (mobile ? 12 : 9), yr, yr === 2009 ? 'start' : yr === 2070 ? 'end' : 'middle');
  const pts = []; for (let height = 0; height <= 17 * HALVING; height += 5000) pts.push([tAt(height), supplyAt(height)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const split = pts.findIndex(p => p[0] > Date.now()), past = pts.slice(0, split).concat([[Date.now(), supplyAt(h)]]);
  const dp = past.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  out += `<path d="${d}" fill="none" stroke="#f6a13b" stroke-width="1.5" stroke-dasharray="4 4" opacity=".55"/><path d="${dp} L${x(Date.now())},${top + ph} L${left},${top + ph} Z" fill="url(#supply-fill)"/><path d="${dp}" fill="none" stroke="#f6a13b" stroke-width="2"/>`;
  for (let e = 1; e <= 7; e++) { const t = tAt(e * HALVING), xx = x(t); out += `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${top + ph}" stroke="#3a4250" stroke-dasharray="2 4"/>` + (mobile ? '' : text(xx + 4, top + 12 + (e % 2) * (mobile ? 17 : 12), +(subsidyAt(e * HALVING) / COIN).toPrecision(3) + ' BTC', 'start', '#8995a6', 9)); }
  const cx = x(Date.now()), cy = y(supplyAt(h));
  out += `<circle cx="${cx}" cy="${cy}" r="5" fill="#f6a13b" stroke="#15191f" stroke-width="2"/>` + text(cx + 10, cy + (mobile ? 24 : 16), 'Today · ' + (supplyAt(h) / MAX_SUPPLY * 100).toFixed(1) + '%', 'start', '#f6c27f', 10);
  out += `<line class="hv" y1="${top}" y2="${top + ph}" stroke="#707b8e" stroke-dasharray="3 4" style="display:none"/>`;
  const svg = $('supply-chart'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = out;
  svg.onpointermove = e => {
   const r = svg.getBoundingClientRect(), xx = (e.clientX - r.left) / r.width * W; if (xx < left || xx > left + pw) return;
   const t = g + (xx - left) / pw * (end - g), height = Math.max(0, heightAt(t, h)), line = svg.querySelector('.hv');
   line.style.display = ''; line.setAttribute('x1', xx); line.setAttribute('x2', xx);
   const tip = $('supply-tip'); tip.innerHTML = `<strong>${t > Date.now() ? '≈ ' : ''}${new Date(t).getUTCFullYear()}</strong><p>Issued<b>${(supplyAt(height) / MAX_SUPPLY * 100).toFixed(2)}%</b></p><p>Block<b>${nf(height)}</b></p><p>Supply<b>${nf(supplyAt(height), 0)} BTC</b></p><p>Reward<b>${subsidyAt(height) / COIN} BTC</b></p>`;
   placeTip(tip, e, svg.closest('.chart-container'));
  };
  svg.onpointerleave = () => { svg.querySelector('.hv').style.display = 'none'; $('supply-tip').hidden = true; };
 }

 /* ---------- lightning view ---------- */
 function renderLightning() {
  const l = net.slow.lightning?.latest, hist = net.slow.lightningHistory, p = price(); if (!l) return;
  const cap = l.total_capacity / COIN;
  $('ln-cards').innerHTML = [
   ['Capacity', nf(cap, 0) + ' BTC', p ? bigUsd(cap * p) + ' in public channels' : 'in public channels'],
   ['Channels', nf(l.channel_count), 'average ' + nf(l.avg_capacity / COIN, 3) + ' BTC each'],
   ['Nodes', nf(l.node_count), 'publicly reachable'],
   ['Median channel', nf(l.med_capacity) + ' sats', p ? usd(l.med_capacity / COIN * p, 0) : '']
  ].map(c => `<div class="stat card"><span>${c[0]}</span><strong>${c[1]}</strong><em>${c[2]}</em></div>`).join('');
  $('ln-asof').textContent = 'Network statistics as of ' + day(Date.parse(l.added)) + ' · mempool.space';
  if (hist?.length) {
   const all = [...hist].sort((a, b) => a.added - b.added).map(d => ({ t: d.added * 1000, v: d.total_capacity / COIN, ch: d.channel_count }));
   /* drop obviously broken rows (e.g. partial crawls reporting a fraction of the network) */
   const med = [...all].sort((a, b) => a.v - b.v)[all.length >> 1]?.v || 0, series = all.filter(d => d.v > med * .4);
   const span = (series.at(-1)?.t - series[0]?.t) / 86400000 || 1, coverage = series.length / span;
   if (coverage < .6) $('ln-asof').textContent += ` · source history is incomplete (${Math.round(coverage * 100)}% of days reported)`;
   lineChart('ln-chart', 'ln-tip', series, { color: '#f6c94b', height: 280, fmt: v => nf(v / 1000, 1) + 'k', tip: pt => `<p>Capacity<b>${nf(pt.v, 0)} BTC</b></p><p>Channels<b>${nf(pt.ch)}</b></p>` });
  }
  const parts = [['Tor only', l.tor_nodes, '#9b82d5'], ['Clearnet (IP) only', l.clearnet_nodes, '#6c97de'], ['Both Tor & clearnet', l.clearnet_tor_nodes, '#83d5a3'], ['Unannounced address', l.unannounced_nodes, '#59626f']];
  const total = parts.reduce((a, b) => a + b[1], 0);
  $('ln-nodes').innerHTML = `<div class="stack-bar">${parts.map(q => `<span style="width:${q[1] / total * 100}%;background:${q[2]}"></span>`).join('')}</div>` + parts.map(q => `<div class="bar-row"><span class="bar-name"><i style="background:${q[2]}"></i>${q[0]}</span><span class="bar-val">${nf(q[1])}</span><span class="bar-val">${(q[1] / total * 100).toFixed(1)}%</span></div>`).join('') + '<p class="pool-note">Tor hides a node’s IP address for privacy. Clearnet nodes are easier to reach and often route more payments.</p>';
  const ppm = l.med_fee_rate, base = l.med_base_fee_mtokens / 1000, onchain = net.fast.fees ? net.fast.fees.halfHourFee * 141 : null;
  $('ln-costs').innerHTML = [[10, 'Coffee'], [100, 'Groceries'], [1000, 'Rent-sized']].map(([amt, label]) => {
   const fee = p ? (amt / p * COIN) * ppm / 1e6 + base : null;
   return `<div class="stat"><span>${label} · ${usd(amt, 0)}</span><strong>${fee === null ? '—' : nf(fee, 0) + (Math.round(fee) === 1 ? ' sat' : ' sats')}</strong><em>${fee === null ? '' : '≈ ' + usd(fee / COIN * p, 3) + ' per hop'}</em></div>`;
  }).join('') + `<div class="stat"><span>Same payment on-chain</span><strong>${onchain ? nf(onchain, 0) + ' sats' : '—'}</strong><em>${onchain && p ? '≈ ' + usd(onchain / COIN * p) + ' flat, any amount' : ''}</em></div>`;
 }

 /* ---------- learn view ---------- */
 const CONCEPTS = [
  ['cube', 'Blocks', 'A block is a page of the shared ledger, holding a few thousand transactions. A new one is added about every 10 minutes and linked to the one before, forming the blockchain.', 'mining'],
  ['queue', 'The mempool', 'Each node’s waiting room for transactions that are valid but not yet in a block. Higher fee rates get picked first.', 'mempool'],
  ['coins', 'Fees (sat/vB)', 'Block space is limited, so you bid for it. Fees are priced per virtual byte of transaction size, not by the amount you send.', 'mempool'],
  ['cpu', 'Mining & hashrate', 'Miners spend electricity making guesses to find a valid block. The winner earns new coins plus fees. Hashrate counts guesses per second.', 'mining'],
  ['refresh', 'Difficulty', 'Every 2,016 blocks the network adjusts how hard the puzzle is, keeping blocks near 10 minutes apart however much hashpower exists.', 'mining'],
  ['hourglass', 'Halving', 'Every 210,000 blocks the new-coin reward halves. It started at 50 BTC and is now 3.125 BTC, capping total supply at 21 million.', 'supply'],
  ['bitcoin', 'Satoshis', 'Bitcoin is divisible to eight decimal places. The smallest unit, 0.00000001 BTC, is a satoshi or “sat”. You never need to buy a whole coin.', 'learn'],
  ['zap', 'Lightning', 'A second layer of payment channels for instant, near-free payments. It settles back to the main chain only when channels open or close.', 'lightning'],
  ['target', 'Confirmations', 'Each block on top of yours is one more confirmation. One is fine for small amounts; six (about an hour) is the classic standard for large ones.', 'mempool'],
  ['layers', 'UTXOs', 'Your balance is a set of unspent outputs, like bills in a wallet. Spending combines some and returns change, which is why inputs affect fees.', 'mempool'],
  ['globe', 'Nodes', 'Computers that download and check every block against the rules. Running your own means you verify, instead of trusting someone else.', 'learn'],
  ['help', 'Self-custody', 'Whoever holds the private keys controls the coins. Your seed phrase (12 or 24 words) is the master backup. Never share it with anyone.', 'learn']
 ];
 const FACTS = [['Genesis block', 'January 3, 2009'], ['Maximum supply', '21,000,000 BTC'], ['Target block time', '10 minutes'], ['Halving interval', '210,000 blocks (~4 years)'], ['Difficulty retarget', 'every 2,016 blocks (~2 weeks)'], ['Block weight limit', '4,000,000 weight units (~1 vMB)'], ['Smallest unit', '1 satoshi = 0.00000001 BTC'], ['Coinbase maturity', '100 blocks before new coins can move'], ['Final block reward', 'around the year 2140']];
 const GLOSSARY = [
  ['Address', 'A string (often starting bc1) that tells a wallet where to send coins. Reusing addresses hurts privacy.'],
  ['ASIC', 'Specialised chips built only to compute Bitcoin’s SHA-256 hashes, vastly faster than general computers.'],
  ['Block height', 'The number of blocks before a given block. The genesis block is height 0.'],
  ['CPFP', 'Child Pays For Parent: speeding up a stuck transaction by spending its output with a high fee.'],
  ['Cold storage', 'Keeping private keys on a device that never touches the internet, such as a hardware wallet.'],
  ['Halving', 'The scheduled 50% cut to the block subsidy every 210,000 blocks.'],
  ['Hash', 'A fixed-length fingerprint of data. Change one byte and the hash changes completely.'],
  ['Hashprice', 'Expected miner revenue per unit of hashrate per day, a key measure of mining profitability.'],
  ['Mempool', 'The set of valid, unconfirmed transactions a node is holding while they wait for a block.'],
  ['Multisig', 'A wallet that needs several keys to sign, such as 2 of 3, removing single points of failure.'],
  ['Node', 'Software that independently validates every block and transaction against Bitcoin’s rules.'],
  ['Nonce', 'The number miners change, over and over, while searching for a block hash below the target.'],
  ['RBF', 'Replace-By-Fee: rebroadcasting an unconfirmed transaction with a higher fee to speed it up.'],
  ['sat/vB', 'Satoshis per virtual byte. The unit for fee rates, and the price of block space.'],
  ['Seed phrase', '12 or 24 words that can regenerate all keys in a wallet. Write it down offline; never share it.'],
  ['SegWit', 'A 2017 upgrade that moved signature data, cut fees and enabled Lightning. Addresses start bc1q.'],
  ['Subsidy', 'The new bitcoin created in each block’s coinbase transaction, currently 3.125 BTC.'],
  ['Taproot', 'A 2021 upgrade for more private and efficient scripts. Addresses start bc1p.'],
  ['UTXO', 'Unspent Transaction Output: a discrete chunk of bitcoin you can spend, like a coin in a purse.'],
  ['vByte', 'A virtual byte. Transaction size with signature data discounted; 1 block ≈ 1 million vB.']
 ];
 let learnBuilt = false;
 function buildLearn() {
  if (learnBuilt) return; learnBuilt = true;
  $('learn-cards').innerHTML = CONCEPTS.map(([icon, title, body, goto]) => `<article class="learn-card"><div class="learn-head"><span class="section-icon"><i data-icon="${icon}"></i></span><h3>${title}</h3></div><p>${body}</p>${goto !== 'learn' ? `<button class="text-button" data-goto="${goto}">See it live <span>↗</span></button>` : ''}</article>`).join('');
  $('facts-table').querySelector('tbody').innerHTML = FACTS.map(f => `<tr><th>${f[0]}</th><td>${f[1]}</td></tr>`).join('');
  const gl = () => { const q = $('glossary-q').value.trim().toLowerCase(); const items = GLOSSARY.filter(g => !q || (g[0] + ' ' + g[1]).toLowerCase().includes(q)); $('glossary').innerHTML = items.length ? items.map(g => `<div><dt>${g[0]}</dt><dd>${g[1]}</dd></div>`).join('') : '<p class="muted">No matching terms.</p>'; };
  $('glossary-q').addEventListener('input', gl); gl();
  window.paintIcons?.($('learn-cards'));
 }
 /* converter */
 const conv = { last: 'btc' };
 function rates() { const pr = { ...(net.fast.prices || {}) }; delete pr.time; if (price()) pr.USD = price(); return pr; }
 function fillCurrencies() {
  const sel = $('conv-cur'), have = [...sel.options].map(o => o.value), list = Object.keys(rates());
  if (list.join() === have.join()) return;
  const cur = sel.value || 'USD'; sel.innerHTML = list.map(c => `<option${c === cur ? ' selected' : ''}>${c}</option>`).join('');
 }
 const parseNum = v => Number(String(v).replace(/[,\s_]/g, ''));
 function convert(from = conv.last) {
  conv.last = from; const r = rates()[$('conv-cur').value]; let b;
  if (from === 'btc') b = parseNum($('conv-btc').value);
  else if (from === 'sats') b = parseNum($('conv-sats').value) / COIN;
  else b = r ? parseNum($('conv-fiat').value) / r : NaN;
  if (!Number.isFinite(b)) return;
  if (from !== 'btc') $('conv-btc').value = +b.toFixed(8);
  if (from !== 'sats') $('conv-sats').value = nf(Math.round(b * COIN));
  if (from !== 'fiat' && r) $('conv-fiat').value = (b * r).toFixed(b * r < 1 ? 4 : 2);
  $('conv-note').textContent = r ? `1 BTC = ${nf(r, 0)} ${$('conv-cur').value} · 1 ${$('conv-cur').value} = ${nf(COIN / r, 0)} sats · ${(typeof quote !== 'undefined' && quote?.price && $('conv-cur').value === 'USD') ? 'Coinbase spot' : 'mempool.space price index'}` : '1 bitcoin = 100,000,000 satoshis (sats).';
 }
 for (const [id, key] of [['conv-btc', 'btc'], ['conv-sats', 'sats'], ['conv-fiat', 'fiat']]) $(id).addEventListener('input', () => convert(key));
 $('conv-cur').addEventListener('change', () => convert(conv.last === 'fiat' ? 'btc' : conv.last));

 /* ---------- wiring ---------- */
 function renderAll() {
  renderStatus(); renderPulse(); renderFees(); renderRail(); renderMempoolStats(); renderQueue(); renderFeeHist();
  renderMining(); renderSupply(); renderLightning(); buildLearn(); fillCurrencies(); convert();
  window.refreshMarketSupply?.();
 }
 $('tx-type').addEventListener('change', renderFees);
 $('block-rail').addEventListener('pointerdown', () => $('block-rail').dataset.touched = 1);
 $('block-rail').addEventListener('wheel', () => $('block-rail').dataset.touched = 1, { passive: true });
 $('queue-rate').addEventListener('input', renderQueue);
 document.addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (!b) return; window.setView?.(b.dataset.goto); window.scrollTo({ top: 0, behavior: 'smooth' }); });
 window.onNetworkView = () => { if (net.fastAt) requestAnimationFrame(renderAll); };
 const prevQuote = window.onSpotQuote; // spot.js loads first; chain onto its hook
 window.onSpotQuote = (q, live) => { prevQuote?.(q, live); if (net.fastAt) renderAll(); };
 setInterval(() => { document.querySelectorAll('.rb-age').forEach(el => el.textContent = ago(Number(el.dataset.ts))); renderStatus(); }, 30000);
 setInterval(() => { if (!document.hidden) refresh(); }, 60000);
 let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (net.fastAt) { renderMining(); renderSupply(); renderLightning(); renderFeeHist(); } }, 150); });
 refresh(true);
})();
