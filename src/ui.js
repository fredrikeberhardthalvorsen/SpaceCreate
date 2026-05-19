import { physicsOf, fmtSci } from './bodyinfo.js';

// DOM control panel: time controls, scene presets, add/edit/delete bodies.
export function setupUI(world, api) {
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => Number(n).toLocaleString(undefined,
    { maximumFractionDigits: d, minimumFractionDigits: d });

  let stepCb = () => {};

  // --- logarithmic rate mapping ------------------------------------------
  // slider pos ∈ [-1000,1000] → rate ∈ ±[1e-3 .. 1e6] yr/s, 0 in the centre.
  const MIN_E = -3, MAX_E = 6, SPAN = MAX_E - MIN_E;
  const slider = $('rate');

  function posToRate(p) {
    if (p === 0) return 0;
    const mag = Math.abs(p) / 1000;
    return Math.sign(p) * Math.pow(10, MIN_E + mag * SPAN);
  }
  function rateToPos(r) {
    if (r === 0) return 0;
    const mag = (Math.log10(Math.abs(r)) - MIN_E) / SPAN;
    return Math.sign(r) * Math.max(0, Math.min(1, mag)) * 1000;
  }
  function rateStr(r) {
    const a = Math.abs(r);
    if (a === 0) return '0 yr/s';
    if (a < 0.01 || a >= 1e4) return r.toExponential(2) + ' yr/s';
    if (a < 1) return r.toFixed(3) + ' yr/s';
    if (a < 100) return r.toFixed(2) + ' yr/s';
    return Math.round(r).toLocaleString() + ' yr/s';
  }
  function setRate(r) {
    world.rate = r;
    slider.value = String(Math.round(rateToPos(r)));
    $('rateLabel').textContent = rateStr(r);
  }

  // --- time ---------------------------------------------------------------
  $('btnPause').onclick = () => {
    world.paused = !world.paused;
    $('btnPause').textContent = world.paused ? '▶ Resume' : '⏸ Pause';
  };
  $('btnStep').onclick = () => stepCb();
  $('btnReverse').onclick = () => setRate(-world.rate);
  $('btnSlower').onclick = () => setRate((world.rate || 1) / 10);
  $('btnFaster').onclick = () => setRate((world.rate || 0.1) * 10);
  $('btnReal').onclick = () => setRate(Math.sign(world.rate) || 1);
  slider.oninput = (e) => {
    world.rate = posToRate(parseInt(e.target.value, 10));
    $('rateLabel').textContent = rateStr(world.rate);
  };
  setRate(1);
  $('trails').onchange = (e) => { world.trails = e.target.checked; };
  $('exagg').onchange = (e) => { world.exaggerate = e.target.checked; };

  // --- presets ------------------------------------------------------------
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.onclick = () => api.load(btn.dataset.preset);
  }

  // --- add body -----------------------------------------------------------
  const btnPlace = $('btnPlace');
  const btnCancel = $('btnPlaceCancel');
  btnPlace.onclick = () => {
    api.startPlacing({
      type: $('newType').value,
      name: $('newName').value || 'New body',
      mass: Math.max(1e-9, parseFloat($('newMass').value) || 3e-6),
    });
    armPlacing(true);
  };
  btnCancel.onclick = () => { api.cancelPlacing(); armPlacing(false); };
  function armPlacing(on) {
    btnPlace.classList.toggle('armed', on);
    btnPlace.textContent = on ? '◎ Click in scene…' : '＋ Place in orbit';
    btnCancel.hidden = !on;
  }

  // --- day length (rotation period) <-> spin (rad/yr) ---------------------
  // body.spin is rad/year; period[days] = 2π·365.25 / |spin|.
  const YR_D = 365.25, TWO_PI = Math.PI * 2;
  const L0 = -1, L1 = Math.log10(700);            // 0.1 day … ~23 months
  function posToSpin(p) {
    if (p === 0) return 0;
    const days = Math.pow(10, L0 + (Math.abs(p) / 200) * (L1 - L0));
    return Math.sign(p) * (TWO_PI * YR_D) / days;
  }
  function spinToPos(s) {
    if (!s) return 0;
    const days = (TWO_PI * YR_D) / Math.abs(s);
    const mag = Math.max(0, Math.min(1, (Math.log10(days) - L0) / (L1 - L0)));
    return Math.round(Math.sign(s) * mag * 200);
  }
  function dayStr(s) {
    if (!s) return 'tidally locked (no spin)';
    const days = (TWO_PI * YR_D) / Math.abs(s);
    const dir = s < 0 ? ' ◀ retrograde' : '';
    let t;
    if (days < 2) t = (days * 24).toFixed(1) + ' h';
    else if (days < 60) t = days.toFixed(1) + ' days';
    else t = (days / 30.44).toFixed(1) + ' months';
    return t + dir;
  }

  // --- radius (real, km) on a log slider ----------------------------------
  const RK0 = Math.log10(0.5), RK1 = Math.log10(2.5e6);   // 0.5 km … ~3.5 R☉
  const posToKm = (p) => Math.pow(10, RK0 + (p / 1000) * (RK1 - RK0));
  const kmToPos = (km) => Math.round(
    Math.max(0, Math.min(1, (Math.log10(km) - RK0) / (RK1 - RK0))) * 1000);
  const radiusStr = (km) =>
    fmtSci(km, 'km', km < 100 ? 1 : 0) +
    '  (' + (km / 6371).toPrecision(3) + ' R⊕)';

  // --- editor -------------------------------------------------------------
  const ed = $('editor');
  function showEditor(b) {
    if (!b) { ed.hidden = true; return; }
    ed.hidden = false;
    $('selName').textContent = b.name;
    $('edName').value = b.name;
    $('edMass').value = b.mass;
    $('edRadius').value = kmToPos(b.radiusKm || 1);
    $('edRadiusVal').textContent = radiusStr(b.radiusKm || 1);
    $('edDay').value = spinToPos(b.spin || 0);
    $('edDayVal').textContent = dayStr(b.spin || 0);
    $('edColor').value = '#' + b.color.toString(16).padStart(6, '0');
    $('edBoost').value = 1;
  }
  $('edDay').oninput = (e) => {
    if (!world.selected) return;
    world.selected.spin = posToSpin(parseInt(e.target.value, 10));
    $('edDayVal').textContent = dayStr(world.selected.spin);
  };
  $('edName').oninput = (e) => { if (world.selected) world.selected.name = e.target.value; };
  $('edMass').oninput = (e) => {
    if (world.selected) world.selected.mass = Math.max(1e-9, parseFloat(e.target.value) || 1e-9);
  };
  $('edRadius').oninput = (e) => {
    const b = world.selected;
    if (!b) return;
    const km = posToKm(parseInt(e.target.value, 10));
    if ($('edKeepDensity').checked && b.radiusKm > 0) {
      // hold density constant → mass ∝ r³, so its real gravitational pull
      // (and orbital influence on everything else) grows fast.
      b.mass = Math.max(1e-12, b.mass * Math.pow(km / b.radiusKm, 3));
      $('edMass').value = b.mass;
    }
    b.radiusKm = km;
    $('edRadiusVal').textContent = radiusStr(km);
  };
  $('edColor').oninput = (e) => {
    if (!world.selected) return;
    world.selected.color = parseInt(e.target.value.slice(1), 16);
    world.selected.mesh?.material.color.set(world.selected.color);
    if (world.selected.glow) world.selected.glow.material.color.set(world.selected.color);
    if (world.selected.trailLine) world.selected.trailLine.material.color.set(world.selected.color);
  };
  $('btnApplyBoost').onclick = () => {
    if (!world.selected) return;
    world.selected.vel.multiplyScalar(parseFloat($('edBoost').value));
    $('edBoost').value = 1;
  };
  $('btnFocus').onclick = () => { if (world.selected) api.focus(world.selected); };
  $('btnDelete').onclick = () => {
    if (!world.selected) return;
    api.deleteBody(world.selected);
    showEditor(null);
  };

  // --- per-frame HUD ------------------------------------------------------
  const EPOCH = Date.UTC(2000, 0, 1);
  function tick() {
    $('speedVal').textContent = fmt(api._speed?.() ?? 0, 0) + ' u/s';
    const d = new Date(EPOCH + world.time * 365.25 * 86400000);
    $('simDate').textContent = isFinite(d) ? d.toISOString().slice(0, 10) : '—';
    $('simTime').textContent = fmt(world.time, 1);
    $('simRate').textContent = rateStr(world.rate);
    $('pausedTag').textContent = world.paused ? '· PAUSED' : '';
    const b = world.selected;
    if (!b || ed.hidden) { $('selReadout').textContent = ''; return; }
    const v = b.vel.length(), r = b.pos.length();
    const p = physicsOf(b);
    $('selReadout').textContent =
      `mass     ${b.mass.toExponential(3)} M☉\n` +
      `radius   ${fmtSci(b.radiusKm, 'km', 0)}  (${p.radiusEarth.toPrecision(3)} R⊕)\n` +
      `density  ${fmtSci(p.densityCC, 'g/cm³', 2)}\n` +
      `gravity  ${fmtSci(p.gravityG, 'g', 2)}` +
        (p.gravNote ? `  — ${p.gravNote}` : '') + `\n` +
      `escape   ${fmtSci(p.escapeKmS, 'km/s', 2)}\n` +
      `orbit    ${fmt(r, 3)} AU · ${fmt(v, 3)} AU/yr\n` +
      `\n→ ${p.klass}` +
      (p.note ? `\n  ${p.note}` : '');
  }

  return {
    refresh() { showEditor(world.selected); },
    showEditor,
    armPlacing,
    tick,
    onStepRequest(cb) { stepCb = cb; },
  };
}
