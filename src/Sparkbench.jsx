import React, { useState, useRef, useEffect } from 'react';

/* ================= Sparkbench =================
   A little circuit playground. Real electronics
   underneath: modified nodal analysis, piecewise-
   linear diodes/BJT, backward-Euler capacitors.
================================================ */

const W = 1000, H = 560, GRID = 20;

const INK = '#2b2a26', PAPER = '#f2ede0', BOARD = '#fdfbf4';
const GRID1 = '#dde6f2', GRID2 = '#c6d4ea';
const BLUE = '#2f66d0', AMBER = '#e9930f', REDC = '#cf4a3d', MUT = '#8b8374';
const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const LED_COLORS = { red: '#e5484d', green: '#2fa46a', blue: '#3d7bf0' };
const LED_VF = { red: 1.8, green: 2.1, blue: 2.8 };

/* solver constants */
const G_WIRE = 100;      // wires ~0.01 ohm
const G_SW = 4;          // closed switch ~0.25 ohm
const LED_R = 12;        // LED on-slope resistance
const VTH = 0.65, RBE = 150, BETA = 100, VSAT = 0.2, GSAT = 2;

const NAMES = { battery: 'Battery', resistor: 'Resistor', led: 'LED', buzzer: 'Buzzer', switch: 'Switch', capacitor: 'Capacitor', ldr: 'Light sensor (LDR)', npn: 'Transistor (NPN)' };
const BUZ_R = 300, BUZ_VON = 1.5; // active buzzer: ~300R load, sings above ~1.5 V forward
const R_VALUES = [100, 220, 330, 470, 1000, 4700, 10000, 100000];
const C_VALUES = [0.0001, 0.00047, 0.001, 0.0047];
const B_VALUES = [3, 6, 9];

/* ---------- formatting ---------- */
const fmtR = (v) => v >= 1e6 ? (v / 1e6) + ' MΩ' : v >= 1000 ? (+(v / 1000).toFixed(1)).toString().replace(/\.0$/, '') + ' kΩ' : Math.round(v) + ' Ω';
const fmtC = (v) => Math.round(v * 1e6) + ' µF';
const fmtV = (v) => (Math.abs(v) < 0.095 ? v.toFixed(2) : v.toFixed(1)) + ' V';
const fmtI = (a) => { const x = Math.abs(a); return x >= 1 ? x.toFixed(1) + ' A' : x >= 1e-3 ? (x * 1000).toFixed(1) + ' mA' : (x * 1e6).toFixed(0) + ' µA'; };
const snap = (v) => Math.round(v / GRID) * GRID;
const ldrR = (light) => 200000 * Math.pow(500 / 200000, light / 100); // bright 500R -> dark 200k

/* storage: uses Claude's artifact storage when present, plain localStorage otherwise */
const store = {
  async get(k) {
    if (typeof window !== 'undefined' && window.storage) return window.storage.get(k);
    const v = localStorage.getItem(k);
    return v == null ? null : { key: k, value: v };
  },
  async set(k, v) {
    if (typeof window !== 'undefined' && window.storage) return window.storage.set(k, v);
    localStorage.setItem(k, v);
    return { key: k, value: v };
  },
};

/* --- buzzer audio: Web Audio, created lazily on the first user gesture --- */
/* iOS mutes Web Audio when the ringer switch is off unless the page owns a
   "playback" audio session — hence the audioSession hint plus a silent looping
   element, which is the pre-16.4 way of achieving the same thing. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
const audio = { ctx: null, nodes: {}, muted: false, el: null, ready: false, onState: null };
function markAudio() {
  const r = !!(audio.ctx && audio.ctx.state === 'running');
  if (r !== audio.ready) { audio.ready = r; if (audio.onState) audio.onState(r); }
}
function ensureAudio() {
  try {
    // tell iOS this page plays audio, so the ringer switch doesn't silence it
    if (typeof navigator !== 'undefined' && navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
    }
    if (!audio.el) {
      const el = new Audio(SILENT_WAV);
      el.loop = true; el.volume = 0.001;
      el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', '');
      audio.el = el;
    }
    const p = audio.el.play(); if (p && p.catch) p.catch(() => {});
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio.ctx = new AC();
    }
    if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume().then(markAudio).catch(() => {});
    markAudio();
  } catch (e) { /* no sound available */ }
}
function setBuzzerLevel(id, level) {
  const ctx = audio.ctx; if (!ctx) return;
  let n = audio.nodes[id];
  const target = audio.muted ? 0 : Math.min(0.3, level * 0.3);
  if (target > 0.002 && !n) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 2100;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5200;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(tone); tone.connect(g); g.connect(ctx.destination); osc.start();
    n = audio.nodes[id] = { osc, g };
  }
  if (n) n.g.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
}
function stopBuzzer(id) {
  const n = audio.nodes[id];
  if (!n) return;
  try { n.osc.stop(); } catch (e) { /* already stopped */ }
  try { n.osc.disconnect(); n.g.disconnect(); } catch (e) { /* fine */ }
  delete audio.nodes[id];
}

/* ---------- geometry ---------- */
function getTerminals(c) {
  const r = ((c.rot || 0) * Math.PI) / 180;
  const cos = Math.round(Math.cos(r)), sin = Math.round(Math.sin(r));
  const P = (dx, dy) => ({ x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos });
  if (c.type === 'npn') return [P(0, 0), P(40, -40), P(40, 40)]; // B, C, E
  return [P(0, 0), P(80, 0)];
}
/* Wires route as an L by default. Once dragged, they carry a `mid` — the
   position of a middle segment — and route as a Z through it. */
function wirePath(p, q, vfirst, mid) {
  const pts = pathPoints(p, q, vfirst, mid);
  return 'M ' + pts.map((t) => t.x + ' ' + t.y).join(' L ');
}
function pathPoints(p, q, vfirst, mid) {
  if (mid && typeof mid.v === 'number') {
    return mid.a === 'x'
      ? [p, { x: mid.v, y: p.y }, { x: mid.v, y: q.y }, q]
      : [p, { x: p.x, y: mid.v }, { x: q.x, y: mid.v }, q];
  }
  if (p.x === q.x || p.y === q.y) return [p, q];
  return vfirst ? [p, { x: p.x, y: q.y }, q] : [p, { x: q.x, y: p.y }, q];
}
/* which way a middle segment should run for this pair of endpoints —
   perpendicular to a straight wire, so dragging it always bows out visibly */
function midAxis(p, q) {
  if (p.y === q.y) return 'y';
  if (p.x === q.x) return 'x';
  return Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? 'x' : 'y';
}

/* --- body-avoiding routing ---
   An L-shaped wire can elbow two ways. If one way ploughs through a component
   body (classically: a wire leaving the cathode and doubling back under the
   LED, which makes current look like it flows backwards), pick the other. */
function compBBox(c) {
  const ts = getTerminals(c);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  ts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  return { x0: x0 - 18, y0: y0 - 18, x1: x1 + 18, y1: y1 + 18 };
}
function segRectOverlap(A, B, r) {
  if (A.x === B.x) {
    if (A.x < r.x0 || A.x > r.x1) return 0;
    const lo = Math.max(Math.min(A.y, B.y), r.y0), hi = Math.min(Math.max(A.y, B.y), r.y1);
    return Math.max(0, hi - lo);
  }
  if (A.y === B.y) {
    if (A.y < r.y0 || A.y > r.y1) return 0;
    const lo = Math.max(Math.min(A.x, B.x), r.x0), hi = Math.min(Math.max(A.x, B.x), r.x1);
    return Math.max(0, hi - lo);
  }
  return 0;
}
function routeScore(pts, comps) {
  let s = 0;
  comps.forEach((c) => {
    const r = compBBox(c);
    for (let i = 0; i < pts.length - 1; i++) {
      if (segRectOverlap(pts[i], pts[i + 1], r) > 26) { s++; break; }
    }
  });
  return s;
}
/* the one true route for a wire — used by the renderer, hit tests and splicing */
function wireRoute(w, comps) {
  const p = termOfIn(comps, w.a), q = termOfIn(comps, w.b);
  if (!p || !q) return null;
  if (w.mid && typeof w.mid.v === 'number') return pathPoints(p, q, w.vfirst, w.mid);
  if (p.x === q.x || p.y === q.y) return [p, q];
  const hp = pathPoints(p, q, false), vp = pathPoints(p, q, true);
  const hs = routeScore(hp, comps), vs = routeScore(vp, comps);
  if (hs !== vs) return hs < vs ? hp : vp;
  return w.vfirst ? vp : hp;
}
function onSeg(P, A, B) {
  if (A.x === B.x) return P.x === A.x && P.y >= Math.min(A.y, B.y) && P.y <= Math.max(A.y, B.y);
  if (A.y === B.y) return P.y === A.y && P.x >= Math.min(A.x, B.x) && P.x <= Math.max(A.x, B.x);
  return false;
}
function pathParam(pts, P) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    if (onSeg(P, A, B)) return acc + Math.abs(P.x - A.x) + Math.abs(P.y - A.y);
    acc += Math.abs(B.x - A.x) + Math.abs(B.y - A.y);
  }
  return acc;
}
const termOfIn = (comps, ref) => {
  const c = comps.find((x) => x.id === ref.comp);
  return c ? getTerminals(c)[ref.t] : null;
};

/* When a part is dropped so its terminals touch other terminals or lie on a wire,
   connect it: coincident terminals get joined, and wires get cut and spliced
   through the part (its body becomes part of the line). */
function autoConnect(c, comps, wires, seqRef) {
  const terms = getTerminals(c);
  let ws = wires.slice();
  let changed = false;
  const wireBetween = (ra, rb) => ws.some((w) =>
    (w.a.comp === ra.comp && w.a.t === ra.t && w.b.comp === rb.comp && w.b.t === rb.t) ||
    (w.b.comp === ra.comp && w.b.t === ra.t && w.a.comp === rb.comp && w.a.t === rb.t));

  /* 1) terminal sitting exactly on another component's terminal -> join them */
  terms.forEach((P, ti) => {
    comps.forEach((d) => {
      if (d.id === c.id) return;
      getTerminals(d).forEach((Q, tj) => {
        if (Q.x === P.x && Q.y === P.y) {
          const ra = { comp: c.id, t: ti }, rb = { comp: d.id, t: tj };
          if (!wireBetween(ra, rb)) { ws.push({ id: 'w' + seqRef.current++, a: ra, b: rb }); changed = true; }
        }
      });
    });
  });

  /* 2) terminal lying on the middle of a wire -> cut the wire and splice through */
  const hits = [];
  ws.forEach((w, wi) => {
    if (w.a.comp === c.id || w.b.comp === c.id) return;
    const pts = wireRoute(w, comps);
    if (!pts) return;
    const p = pts[0], q = pts[pts.length - 1];
    terms.forEach((P, ti) => {
      if ((P.x === p.x && P.y === p.y) || (P.x === q.x && P.y === q.y)) return;
      for (let s = 0; s < pts.length - 1; s++) {
        if (onSeg(P, pts[s], pts[s + 1])) {
          hits.push({ wi, ti, param: pathParam(pts, P) });
          break;
        }
      }
    });
  });
  const byWire = {};
  hits.forEach((h) => { (byWire[h.wi] = byWire[h.wi] || []).push(h); });
  /* if one wire is crossed by 2+ terminals, that's the "drop it into the line" intent —
     splice only that wire; otherwise splice each terminal into at most one wire
     (overlapping wires would otherwise all get cut, making a mess) */
  let chosen = Object.keys(byWire).map(Number);
  const multi = chosen.filter((wi) => byWire[wi].length >= 2);
  if (multi.length) chosen = [multi[0]];
  else {
    const seen = new Set(), keep = new Set();
    hits.forEach((h) => { if (!seen.has(h.ti)) { seen.add(h.ti); keep.add(h.wi); } });
    chosen = chosen.filter((wi) => keep.has(wi));
  }
  const removeIdx = [], added = [];
  chosen.forEach((wi) => {
    const w = ws[wi];
    const hs = byWire[wi].sort((a, b) => a.param - b.param);
    removeIdx.push(wi);
    const chain = [w.a, ...hs.map((h) => ({ comp: c.id, t: h.ti })), w.b];
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i].comp === c.id && chain[i + 1].comp === c.id) continue; // the part's body is that link
      added.push({ id: 'w' + seqRef.current++, a: chain[i], b: chain[i + 1], vfirst: w.vfirst, mid: w.mid });
    }
    changed = true;
  });
  if (removeIdx.length) ws = ws.filter((_, i) => !removeIdx.includes(i));
  ws = ws.concat(added);
  return changed ? ws : null;
}

/* ---------- linear solve (partial pivoting) ---------- */
function gauss(A, z) {
  const n = z.length;
  if (!n) return new Float64Array(0);
  for (let col = 0; col < n; col++) {
    let piv = col, mx = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(A[r][col]); if (v > mx) { mx = v; piv = r; } }
    if (mx < 1e-12) return null;
    if (piv !== col) { const t = A[piv]; A[piv] = A[col]; A[col] = t; const tz = z[piv]; z[piv] = z[col]; z[col] = tz; }
    const d = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / d; if (f === 0) continue;
      A[r][col] = 0;
      for (let k = col + 1; k < n; k++) A[r][k] -= f * A[col][k];
      z[r] -= f * z[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = z[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/* ---------- circuit simulation (MNA) ---------- */
function simulate(comps, wires, dev, dt, light) {
  const bats = comps.filter((c) => c.type === 'battery');
  if (!bats.length || !comps.length) return null;

  const nodeOf = {}; let n = 0;
  comps.forEach((c) => { const t = c.type === 'npn' ? 3 : 2; for (let i = 0; i < t; i++) nodeOf[c.id + ':' + i] = n++; });
  const gnd = nodeOf[bats[0].id + ':1'];
  const ridx = new Int32Array(n); let k = 0;
  for (let i = 0; i < n; i++) ridx[i] = i === gnd ? -1 : k++;
  const nV = n - 1, M = nV + bats.length;

  comps.forEach((c) => { if (!dev[c.id]) dev[c.id] = { vPrev: 0, on: false, mode: 'off', hot: 0, blown: false }; });

  let sol = null;
  for (let iter = 0; iter < 40; iter++) {
    const A = []; for (let i = 0; i < M; i++) A.push(new Float64Array(M));
    const z = new Float64Array(M);
    const addG = (a, b, g) => { const i = ridx[a], j = ridx[b]; if (i >= 0) A[i][i] += g; if (j >= 0) A[j][j] += g; if (i >= 0 && j >= 0) { A[i][j] -= g; A[j][i] -= g; } };
    const addI = (a, b, cur) => { const i = ridx[a], j = ridx[b]; if (i >= 0) z[i] += cur; if (j >= 0) z[j] -= cur; };
    for (let i = 0; i < nV; i++) A[i][i] += 1e-9;

    wires.forEach((w) => {
      const a = nodeOf[w.a.comp + ':' + w.a.t], b = nodeOf[w.b.comp + ':' + w.b.t];
      if (a != null && b != null) addG(a, b, G_WIRE);
    });

    comps.forEach((c) => {
      const st = dev[c.id];
      const n0 = nodeOf[c.id + ':0'], n1 = nodeOf[c.id + ':1'];
      switch (c.type) {
        case 'resistor': addG(n0, n1, 1 / c.value); break;
        case 'ldr': addG(n0, n1, 1 / ldrR(light)); break;
        case 'buzzer': addG(n0, n1, 1 / BUZ_R); break;
        case 'switch': if (c.closed) addG(n0, n1, G_SW); break;
        case 'capacitor': { const g = c.value / dt; addG(n0, n1, g); addI(n0, n1, g * st.vPrev); break; }
        case 'led': if (!st.blown && st.on) { const g = 1 / LED_R; addG(n0, n1, g); addI(n0, n1, g * LED_VF[c.value]); } break;
        case 'battery': {
          const vi = nV + bats.indexOf(c); const p = ridx[n0], q = ridx[n1];
          if (p >= 0) { A[p][vi] += 1; A[vi][p] += 1; }
          if (q >= 0) { A[q][vi] -= 1; A[vi][q] -= 1; }
          z[vi] += c.value; break;
        }
        case 'npn': {
          const nb = n0, nc = n1, ne = nodeOf[c.id + ':2'];
          if (st.mode !== 'off') {
            const g = 1 / RBE; addG(nb, ne, g); addI(nb, ne, g * VTH);
            if (st.mode === 'active') {
              const gm = BETA * g, ib = ridx[nb], ic = ridx[nc], ie = ridx[ne];
              if (ic >= 0) { if (ib >= 0) A[ic][ib] += gm; if (ie >= 0) A[ic][ie] -= gm; z[ic] += gm * VTH; }
              if (ie >= 0) { if (ib >= 0) A[ie][ib] -= gm; A[ie][ie] += gm; z[ie] -= gm * VTH; }
            } else { addG(nc, ne, GSAT); addI(nc, ne, GSAT * VSAT); }
          }
          break;
        }
        default: break;
      }
    });

    sol = gauss(A, z);
    if (!sol) return null;
    const V = (key) => { const i = ridx[nodeOf[key]]; return i < 0 ? 0 : sol[i]; };

    let changed = false;
    comps.forEach((c) => {
      const st = dev[c.id];
      if (c.type === 'led' && !st.blown) {
        const vd = V(c.id + ':0') - V(c.id + ':1');
        if (st.on) { if ((vd - LED_VF[c.value]) / LED_R < -1e-9) { st.on = false; changed = true; } }
        else if (vd > LED_VF[c.value] + 1e-4) { st.on = true; changed = true; }
      } else if (c.type === 'npn') {
        const vbe = V(c.id + ':0') - V(c.id + ':2');
        const vce = V(c.id + ':1') - V(c.id + ':2');
        const m = st.mode; let nm = m;
        if (m === 'off') { if (vbe > VTH + 2e-3) nm = 'active'; }
        else if (m === 'active') { if (vbe < VTH - 2e-3) nm = 'off'; else if (vce < VSAT - 2e-3) nm = 'saturated'; }
        else { if (vbe < VTH - 2e-3) nm = 'off'; else { const ib = Math.max(0, vbe - VTH) / RBE; if (GSAT * (vce - VSAT) > BETA * ib + 1e-6) nm = 'active'; } }
        if (nm !== m) { st.mode = nm; changed = true; }
      }
    });
    if (!changed) break;
  }

  const V = (key) => { const i = ridx[nodeOf[key]]; return i < 0 ? 0 : sol[i]; };
  const out = { comp: {}, wire: {}, short: false };

  comps.forEach((c) => {
    const st = dev[c.id];
    const v0 = V(c.id + ':0'), v1 = V(c.id + ':1');
    let d = { I: 0, V: v0 - v1 };
    switch (c.type) {
      case 'battery': { const I = -sol[nV + bats.indexOf(c)]; d = { I, V: c.value }; if (Math.abs(I) > 0.4) out.short = true; break; }
      case 'resistor': d.I = (v0 - v1) / c.value; break;
      case 'ldr': d.I = (v0 - v1) / ldrR(light); d.R = ldrR(light); break;
      case 'buzzer': d.I = (v0 - v1) / BUZ_R; d.sounding = (v0 - v1) > BUZ_VON; break;
      case 'switch': d.I = c.closed ? (v0 - v1) * G_SW : 0; break;
      case 'capacitor': { const g = c.value / dt; const vNow = v0 - v1; d.I = g * (vNow - st.vPrev); st.vPrev = vNow; d.V = vNow; break; }
      case 'led': {
        if (!st.blown && st.on) d.I = Math.max(0, (v0 - v1 - LED_VF[c.value]) / LED_R);
        if (d.I > 0.03) { st.hot += dt; if (st.hot > 0.12 && !st.blown) { st.blown = true; st.on = false; d.I = 0; } } else st.hot = 0;
        d.blown = st.blown; break;
      }
      case 'npn': {
        const ve = V(c.id + ':2'); const vbe = v0 - ve, vce = v1 - ve;
        let ib = 0, ic = 0;
        if (st.mode !== 'off') { ib = Math.max(0, vbe - VTH) / RBE; ic = st.mode === 'active' ? BETA * ib : Math.max(0, GSAT * (vce - VSAT)); }
        d = { I: ic, ib, ic, vbe, vce, mode: st.mode, V: vce }; break;
      }
      default: break;
    }
    out.comp[c.id] = d;
  });

  wires.forEach((w) => {
    const a = nodeOf[w.a.comp + ':' + w.a.t], b = nodeOf[w.b.comp + ':' + w.b.t];
    if (a == null || b == null) { out.wire[w.id] = 0; return; }
    const va = ridx[a] < 0 ? 0 : sol[ridx[a]], vb = ridx[b] < 0 ? 0 : sol[ridx[b]];
    out.wire[w.id] = (va - vb) * G_WIRE;
  });
  return out;
}

/* ---------- preset circuits ---------- */
const PRESETS = [
  {
    label: '⚡ First light',
    comps: [
      { id: 'a1', type: 'battery', x: 260, y: 160, rot: 90, value: 9 },
      { id: 'a2', type: 'resistor', x: 380, y: 120, rot: 0, value: 470 },
      { id: 'a3', type: 'led', x: 540, y: 120, rot: 0, value: 'red' },
      { id: 'a4', type: 'switch', x: 620, y: 200, rot: 90, closed: false },
    ],
    wires: [
      { id: 'aw1', a: { comp: 'a1', t: 0 }, b: { comp: 'a2', t: 0 }, vfirst: true },
      { id: 'aw2', a: { comp: 'a2', t: 1 }, b: { comp: 'a3', t: 0 } },
      { id: 'aw3', a: { comp: 'a3', t: 1 }, b: { comp: 'a4', t: 0 } },
      { id: 'aw4', a: { comp: 'a4', t: 1 }, b: { comp: 'a1', t: 1 } },
    ],
  },
  {
    label: '🌙 Dark detector',
    comps: [
      { id: 'b1', type: 'battery', x: 180, y: 220, rot: 90, value: 9 },
      { id: 'b2', type: 'resistor', x: 360, y: 120, rot: 90, value: 10000 },
      { id: 'b3', type: 'ldr', x: 360, y: 240, rot: 90 },
      { id: 'b4', type: 'resistor', x: 420, y: 240, rot: 0, value: 1000 },
      { id: 'b5', type: 'npn', x: 560, y: 240, rot: 0 },
      { id: 'b6', type: 'resistor', x: 700, y: 40, rot: 90, value: 470 },
      { id: 'b7', type: 'led', x: 700, y: 140, rot: 90, value: 'red' },
    ],
    wires: [
      { id: 'bw1', a: { comp: 'b1', t: 0 }, b: { comp: 'b2', t: 0 }, vfirst: true },
      { id: 'bw2', a: { comp: 'b2', t: 0 }, b: { comp: 'b6', t: 0 }, vfirst: true },
      { id: 'bw3', a: { comp: 'b2', t: 1 }, b: { comp: 'b3', t: 0 } },
      { id: 'bw4', a: { comp: 'b3', t: 0 }, b: { comp: 'b4', t: 0 } },
      { id: 'bw5', a: { comp: 'b4', t: 1 }, b: { comp: 'b5', t: 0 } },
      { id: 'bw6', a: { comp: 'b6', t: 1 }, b: { comp: 'b7', t: 0 } },
      { id: 'bw7', a: { comp: 'b7', t: 1 }, b: { comp: 'b5', t: 1 } },
      { id: 'bw8', a: { comp: 'b5', t: 2 }, b: { comp: 'b3', t: 1 }, vfirst: true },
      { id: 'bw9', a: { comp: 'b3', t: 1 }, b: { comp: 'b1', t: 1 } },
    ],
  },
  {
    label: '🔋 Charge & flash',
    comps: [
      { id: 'c1', type: 'battery', x: 240, y: 200, rot: 90, value: 9 },
      { id: 'c2', type: 'resistor', x: 360, y: 160, rot: 0, value: 470 },
      { id: 'c3', type: 'led', x: 520, y: 160, rot: 0, value: 'red' },
      { id: 'c4', type: 'capacitor', x: 520, y: 240, rot: 90, value: 0.001 },
      { id: 'c5', type: 'switch', x: 680, y: 240, rot: 90, closed: true },
    ],
    wires: [
      { id: 'cw1', a: { comp: 'c1', t: 0 }, b: { comp: 'c2', t: 0 }, vfirst: true },
      { id: 'cw2', a: { comp: 'c2', t: 1 }, b: { comp: 'c3', t: 0 } },
      { id: 'cw3', a: { comp: 'c3', t: 1 }, b: { comp: 'c4', t: 0 }, vfirst: true },
      { id: 'cw4', a: { comp: 'c4', t: 0 }, b: { comp: 'c5', t: 0 } },
      { id: 'cw5', a: { comp: 'c5', t: 1 }, b: { comp: 'c4', t: 1 } },
      { id: 'cw6', a: { comp: 'c4', t: 1 }, b: { comp: 'c1', t: 1 } },
    ],
  },
];

/* ---------- tutorials: scripted steps with deterministic completion checks ----------
   Each check is a plain predicate over the live circuit — the app knows exactly
   when the child has done the step, so the ✓ appears by itself. No AI involved. */
function firstOf(ctx, type) { return ctx.comps.find((c) => c.type === type); }
function compD(ctx, c) { return c && ctx.res ? ctx.res.comp[c.id] : null; }
function isSelType(ctx, type) {
  if (!ctx.sel || ctx.sel.kind !== 'comp') return false;
  const c = ctx.comps.find((x) => x.id === ctx.sel.id);
  return !!c && c.type === type;
}
function fullyWired(ctx, c) {
  if (!c) return false;
  const s = new Set();
  ctx.wires.forEach((w) => { s.add(w.a.comp + ':' + w.a.t); s.add(w.b.comp + ':' + w.b.t); });
  return s.has(c.id + ':0') && s.has(c.id + ':1');
}

const TUT_LOOP = (rv) => ({
  comps: [
    { id: 'tb', type: 'battery', x: 260, y: 160, rot: 90, value: 9 },
    { id: 'tr', type: 'resistor', x: 380, y: 120, rot: 0, value: rv },
    { id: 'tl', type: 'led', x: 540, y: 120, rot: 0, value: 'red' },
  ],
  wires: [
    { id: 'tw1', a: { comp: 'tb', t: 0 }, b: { comp: 'tr', t: 0 }, vfirst: true },
    { id: 'tw2', a: { comp: 'tr', t: 1 }, b: { comp: 'tl', t: 0 } },
    { id: 'tw3', a: { comp: 'tl', t: 1 }, b: { comp: 'tb', t: 1 } },
  ],
});

const TUTORIALS = [
  {
    id: 't1', title: 'First light', emoji: '⚡',
    blurb: 'Build your first circuit — and blow your first LED',
    start: { clear: true },
    steps: [
      {
        text: 'Every circuit needs a push. Add a battery — tap it in the palette, then tap the board.',
        hint: 'battery',
        check: (ctx) => !!firstOf(ctx, 'battery'),
        done: 'That’s your pump: it pushes charge out of + and pulls it home at −.',
      },
      {
        text: 'Now something to power: add an LED.',
        hint: 'led',
        check: (ctx) => !!firstOf(ctx, 'led'),
        done: 'The triangle is an arrow — current can only flow the way it points.',
      },
      {
        text: 'Wire the LED and battery into a loop: tap one terminal dot, then another. Make the triangle point the way round the loop.',
        check: (ctx) => {
          const l = firstOf(ctx, 'led');
          if (!l) return false;
          const st = ctx.dev[l.id] || {};
          const d = compD(ctx, l);
          return !!st.blown || (d && d.I > 1e-3);
        },
        done: '💥 Poof! With nothing to slow it down, over half an amp stampeded through. An LED can never set its own current.',
      },
      {
        text: 'Bring it back to life: long-press the LED and tap ✨ Replace.',
        check: (ctx) => {
          const l = firstOf(ctx, 'led');
          return !!l && !(ctx.dev[l.id] || {}).blown;
        },
        done: 'Good as new. This time, let’s protect it.',
      },
      {
        text: 'Add a resistor to guard the LED — drag one from the palette and drop it right onto a wire to splice it in.',
        hint: 'resistor',
        check: (ctx) => {
          const l = firstOf(ctx, 'led');
          const d = compD(ctx, l);
          return !!firstOf(ctx, 'resistor') && d && d.I > 1e-3 && d.I < 0.03 && !(ctx.dev[l.id] || {}).blown;
        },
        done: 'Lit — and safe. The resistor sets the current; the LED just enjoys it.',
      },
      {
        text: 'Tap the LED and look at its numbers in the panel.',
        check: (ctx) => isSelType(ctx, 'led'),
        done: 'About 1.8 V and a healthy current. Push, limit, payload, loop — the fundamental circuit. 🎉',
      },
    ],
  },
  {
    id: 't2', title: 'Ohm’s playground', emoji: '🎛',
    blurb: 'Turn the current up and down with resistance',
    start: TUT_LOOP(1000),
    steps: [
      {
        text: 'Here’s a working loop. Tap the resistor to meet Ohm’s law with your real numbers.',
        check: (ctx) => isSelType(ctx, 'resistor'),
        done: 'V = I × R — the resistor charges a voltage toll for letting current through.',
      },
      {
        text: 'More current, please: set the resistor to 470 Ω with the value chips in the panel.',
        check: (ctx) => ctx.comps.some((c) => c.type === 'resistor' && c.value === 470),
        done: 'Brighter! Half the resistance, roughly double the current.',
      },
      {
        text: 'Now nudge your luck: try 330 Ω and keep an eye on Diagnostics.',
        check: (ctx) => ctx.comps.some((c) => c.type === 'resistor' && c.value === 330),
        done: 'About 21 mA — running hot. Diagnostics is warning you: it works, but past ~30 mA it’s smoke.',
      },
      {
        text: 'Be kind again: 1 kΩ or higher.',
        check: (ctx) => ctx.comps.some((c) => c.type === 'resistor' && c.value >= 1000),
        done: 'A gentle few milliamps — dimmer, but this LED will outlive us all.',
      },
      {
        text: 'Last one: tap the battery. Its power, P = V × I, changed every time you did.',
        check: (ctx) => isSelType(ctx, 'battery'),
        done: 'The resistor decides the current, and the current decides everything else. 🎉',
      },
    ],
  },
  {
    id: 't3', title: 'Take control', emoji: '🕹',
    blurb: 'Switches, and where the volts wait',
    start: TUT_LOOP(470),
    steps: [
      {
        text: 'Add a switch — drag one out and drop it straight onto the bottom wire to splice it in.',
        hint: 'switch',
        check: (ctx) => fullyWired(ctx, firstOf(ctx, 'switch')),
        done: 'In the loop. Tapping a switch flips it.',
      },
      {
        text: 'Turn the LED off with the switch.',
        check: (ctx) => { const s = firstOf(ctx, 'switch'); return !!s && !s.closed; },
        done: 'Loop broken — the current stops everywhere at once, not just at the gap.',
      },
      {
        text: 'Where did the 9 volts go? Tap the switch, then check “where the volts go” in the panel.',
        check: (ctx) => isSelType(ctx, 'switch'),
        done: 'The open switch holds almost the whole 9 V across its gap — pressure waiting for a path.',
      },
      {
        text: 'Let it flow: close the switch.',
        check: (ctx) => {
          const s = firstOf(ctx, 'switch'), l = firstOf(ctx, 'led');
          const d = compD(ctx, l);
          return !!s && !!s.closed && d && d.I > 1e-3;
        },
        done: 'And pressure becomes flow. That’s every light switch in your house. 🎉',
      },
    ],
  },
];

/* ---------- schematic symbols (local coords, terminals at (0,0) and (80,0)) ---------- */
function SymbolBody({ c, st, d, light }) {
  const rot = c.rot || 0;
  const sw = 2.2;
  const upright = (x, y, children) => (
    <g transform={`translate(${x},${y}) rotate(${-rot})`}>{children}</g>
  );
  switch (c.type) {
    case 'battery':
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round">
          <line x1="0" y1="0" x2="34" y2="0" />
          <line x1="46" y1="0" x2="80" y2="0" />
          <line x1="34" y1="-15" x2="34" y2="15" strokeWidth="2.6" />
          <line x1="46" y1="-8" x2="46" y2="8" strokeWidth="5" />
          {upright(24, -15, <text textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fontFamily={MONO} fill={INK} stroke="none">+</text>)}
          {upright(57, -13, <text textAnchor="middle" dominantBaseline="central" fontSize="12" fontFamily={MONO} fill={MUT} stroke="none">−</text>)}
        </g>
      );
    case 'resistor':
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1="0" y1="0" x2="16" y2="0" />
          <line x1="64" y1="0" x2="80" y2="0" />
          <polyline points="16,0 22,-9 34,9 46,-9 58,9 64,0" />
        </g>
      );
    case 'led': {
      const blown = st && st.blown;
      const lit = !blown && d ? Math.min(1, (d.I || 0) / 0.015) : 0;
      const col = LED_COLORS[c.value] || LED_COLORS.red;
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round">
          <line x1="0" y1="0" x2="30" y2="0" />
          <line x1="50" y1="0" x2="80" y2="0" />
          <polygon points="30,-11 30,11 50,0" fill={blown ? '#cfc8ba' : lit > 0.02 ? col : '#efe9da'} fillOpacity={blown ? 1 : lit > 0.02 ? 0.35 + 0.65 * lit : 1} />
          <line x1="50" y1="-11" x2="50" y2="11" />
          <line x1="41" y1="-12" x2="49" y2="-21" strokeWidth="1.8" />
          <line x1="48" y1="-9" x2="56" y2="-18" strokeWidth="1.8" />
          {blown && <path d="M 34 -7 L 40 2 L 36 8 M 42 -6 L 45 4" stroke="#8a8378" strokeWidth="1.6" fill="none" />}
        </g>
      );
    }
    case 'buzzer': {
      const lvl = d && d.sounding && (d.I || 0) > 5e-4 ? Math.min(1, Math.abs(d.I) / 0.02) : 0;
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round" fill="none">
          <line x1="0" y1="0" x2="24" y2="0" />
          <line x1="56" y1="0" x2="80" y2="0" />
          <circle cx="40" cy="0" r="16" fill={lvl > 0 ? '#fdf3df' : BOARD} />
          <polygon points="33,-4 38,-4 44,-10 44,10 38,4 33,4" fill={INK} stroke="none" />
          {upright(12, -13, <text textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fontFamily={MONO} fill={INK} stroke="none">+</text>)}
          <path d="M 60 -8 q 7 8 0 16" strokeWidth="1.7" opacity={0.15 + 0.85 * lvl} />
          <path d="M 66 -12 q 10 12 0 24" strokeWidth="1.7" opacity={lvl > 0.02 ? 0.1 + 0.9 * lvl : 0.08} />
        </g>
      );
    }
    case 'switch': {
      const closed = !!c.closed;
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round">
          <line x1="0" y1="0" x2="26" y2="0" />
          <line x1="54" y1="0" x2="80" y2="0" />
          <circle cx="26" cy="0" r="3" fill={INK} stroke="none" />
          <circle cx="54" cy="0" r="3" fill={INK} stroke="none" />
          <line x1="26" y1="0" x2={closed ? 54 : 48} y2={closed ? 0 : -17.5} strokeWidth="2.6" style={{ transition: 'all 0.12s ease' }} />
        </g>
      );
    }
    case 'capacitor': {
      const vp = st ? st.vPrev || 0 : 0;
      const q = Math.min(1, Math.abs(vp) / 6);
      const s = vp >= 0;
      const px = s ? 28 : 52, mx = s ? 52 : 28;
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round">
          <line x1="0" y1="0" x2="35" y2="0" />
          <line x1="45" y1="0" x2="80" y2="0" />
          <line x1="35" y1="-15" x2="35" y2="15" strokeWidth="3" />
          <line x1="45" y1="-15" x2="45" y2="15" strokeWidth="3" />
          {q > 0.05 && [-9, 0, 9].map((yy) => (
            <g key={yy} opacity={q * 0.9}>
              {upright(px, yy, <text textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fontFamily={MONO} fill={AMBER} stroke="none">+</text>)}
              {upright(mx, yy, <text textAnchor="middle" dominantBaseline="central" fontSize="10" fontFamily={MONO} fill={BLUE} stroke="none">−</text>)}
            </g>
          ))}
        </g>
      );
    }
    case 'ldr':
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1="0" y1="0" x2="22" y2="0" />
          <line x1="58" y1="0" x2="80" y2="0" />
          <circle cx="40" cy="0" r="18" />
          <polyline points="22,0 27,-7 35,7 43,-7 51,7 58,0" />
          <line x1="14" y1="-31" x2="24" y2="-20" strokeWidth="1.8" />
          <line x1="25" y1="-35" x2="35" y2="-24" strokeWidth="1.8" />
        </g>
      );
    case 'npn':
      return (
        <g stroke={INK} strokeWidth={sw} strokeLinecap="round">
          <line x1="0" y1="0" x2="18" y2="0" />
          <line x1="18" y1="-15" x2="18" y2="15" strokeWidth="3" />
          <line x1="18" y1="-6" x2="40" y2="-24" />
          <line x1="40" y1="-24" x2="40" y2="-40" />
          <line x1="18" y1="6" x2="40" y2="24" />
          <line x1="40" y1="24" x2="40" y2="40" />
          <polygon points="37,21.5 28.9,18.7 32.7,14.1" fill={INK} stroke="none" />
          {upright(-2, -11, <text textAnchor="middle" dominantBaseline="central" fontSize="9" fontFamily={MONO} fill={MUT} stroke="none">B</text>)}
          {upright(50, -38, <text textAnchor="middle" dominantBaseline="central" fontSize="9" fontFamily={MONO} fill={MUT} stroke="none">C</text>)}
          {upright(50, 38, <text textAnchor="middle" dominantBaseline="central" fontSize="9" fontFamily={MONO} fill={MUT} stroke="none">E</text>)}
        </g>
      );
    default:
      return null;
  }
}

function compLabel(c, light) {
  switch (c.type) {
    case 'battery': return c.value + ' V';
    case 'resistor': return fmtR(c.value);
    case 'capacitor': return fmtC(c.value);
    case 'ldr': return 'LDR · ' + fmtR(ldrR(light));
    case 'npn': return 'NPN';
    default: return '';
  }
}

/* ---------- tiny palette icons ---------- */
function MiniIcon({ type }) {
  const p = { stroke: INK, strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  let body = null;
  switch (type) {
    case 'battery': body = (<g {...p}><line x1="6" y1="0" x2="32" y2="0" /><line x1="48" y1="0" x2="74" y2="0" /><line x1="32" y1="-11" x2="32" y2="11" /><line x1="48" y1="-6" x2="48" y2="6" strokeWidth="4" /></g>); break;
    case 'resistor': body = (<g {...p}><line x1="6" y1="0" x2="18" y2="0" /><line x1="62" y1="0" x2="74" y2="0" /><polyline points="18,0 24,-8 34,8 44,-8 54,8 62,0" /></g>); break;
    case 'led': body = (<g {...p}><line x1="6" y1="0" x2="28" y2="0" /><line x1="50" y1="0" x2="74" y2="0" /><polygon points="28,-9 28,9 48,0" fill="#efe9da" /><line x1="48" y1="-9" x2="48" y2="9" /><line x1="42" y1="-10" x2="50" y2="-18" strokeWidth="1.6" /></g>); break;
    case 'buzzer': body = (<g {...p}><line x1="6" y1="2" x2="26" y2="2" /><line x1="54" y1="2" x2="74" y2="2" /><circle cx="40" cy="2" r="13" /><polygon points="34,-1 38,-1 43,-6 43,10 38,5 34,5" fill={INK} /><path d="M 56 -4 q 5 6 0 12" strokeWidth="1.5" /></g>); break;
    case 'switch': body = (<g {...p}><line x1="6" y1="2" x2="26" y2="2" /><line x1="54" y1="2" x2="74" y2="2" /><circle cx="26" cy="2" r="2.5" fill={INK} /><circle cx="54" cy="2" r="2.5" fill={INK} /><line x1="26" y1="2" x2="49" y2="-13" /></g>); break;
    case 'capacitor': body = (<g {...p}><line x1="6" y1="0" x2="34" y2="0" /><line x1="46" y1="0" x2="74" y2="0" /><line x1="34" y1="-11" x2="34" y2="11" strokeWidth="3" /><line x1="46" y1="-11" x2="46" y2="11" strokeWidth="3" /></g>); break;
    case 'ldr': body = (<g {...p}><line x1="6" y1="2" x2="24" y2="2" /><line x1="56" y1="2" x2="74" y2="2" /><circle cx="40" cy="2" r="13" /><polyline points="27,2 32,-4 40,7 48,-4 53,2" /><line x1="18" y1="-16" x2="26" y2="-8" strokeWidth="1.6" /></g>); break;
    case 'npn': body = (<g {...p}><line x1="8" y1="2" x2="28" y2="2" /><line x1="28" y1="-10" x2="28" y2="14" strokeWidth="2.6" /><line x1="28" y1="-3" x2="48" y2="-14" /><line x1="28" y1="7" x2="48" y2="18" /><polygon points="46,16.5 38,14 41.5,9.5" fill={INK} /></g>); break;
    default: break;
  }
  return (<svg viewBox="0 0 80 44" width="42" height="23" style={{ display: 'block' }}><g transform="translate(0,22)">{body}</g></svg>);
}

/* ---------- selection info text ---------- */
function readout(c, d) {
  if (!d) return 'no power — the circuit needs a battery in a complete loop';
  switch (c.type) {
    case 'battery': return 'delivering ' + fmtI(d.I);
    case 'resistor': return fmtI(d.I) + ' · ' + fmtV(Math.abs(d.V)) + ' across it';
    case 'led': return d.blown ? '💥 blown — too much current went through it' : d.I > 1e-4 ? 'lit · ' + fmtI(d.I) : 'dark — no current flowing';
    case 'switch': return c.closed ? 'closed · ' + fmtI(d.I) : 'open — tap it to close';
    case 'capacitor': return Math.abs(d.I) > 2e-4 ? (d.I * d.V >= 0 ? 'charging' : 'draining') + ' · ' + fmtV(Math.abs(d.V)) + ' stored' : 'holding ' + fmtV(Math.abs(d.V));
    case 'ldr': return fmtR(d.R || 0) + ' right now · ' + fmtI(d.I);
    case 'npn':
      if (d.mode === 'off') return 'off — base below 0.65 V';
      if (d.mode === 'active') return 'amplifying · base ' + fmtI(d.ib) + ' → ' + fmtI(d.ic);
      return 'saturated (fully on) · ' + fmtI(d.ic);
    case 'buzzer': return d.sounding && d.I > 5e-4 ? '🔊 buzzing · ' + fmtI(d.I) : d.I < -1e-3 ? 'silent — wired backwards' : 'silent — no current';
    default: return '';
  }
}

function fmtP(w) {
  const x = Math.abs(w);
  return x >= 1 ? x.toFixed(2) + ' W' : x >= 1e-3 ? (x * 1000).toFixed(1) + ' mW' : (x * 1e6).toFixed(0) + ' µW';
}

const DATASHEET = {
  battery: 'Pushes charge round the loop with a fixed voltage (its EMF). This one is ideal — no internal resistance — so a dead short draws silly current. Real batteries sag and get warm instead.',
  resistor: 'Opposes flow: V = I × R. Double the resistance, halve the current for the same push. The energy it takes out of the circuit leaves as heat: P = V × I.',
  led: 'A diode that emits light. It needs its forward voltage before it conducts at all (red 1.8 V · green 2.1 V · blue 2.8 V), then current climbs very steeply — so it never sets its own current. Always give it a series resistor: R = (V_supply − V_f) ÷ I. Happy around 5–20 mA; past ~30 mA the magic smoke escapes.',
  buzzer: 'An active piezo buzzer. Give its + side about 1.5 V more than the other and it sings at ~1.8 kHz, drawing V ÷ 300 Ω. It is polarised: backwards it still passes current but stays silent.',
  switch: 'Closed: a ~0.25 Ω contact, almost invisible to the circuit. Open: no path at all — and the entire leftover loop voltage appears across its gap, waiting.',
  capacitor: 'Two plates that never touch. It stores charge Q = C × V and energy E = ½ C V², filling through whatever resistance feeds it (τ = R × C). Once full, it blocks steady current completely — it needs a separate path to drain.',
  ldr: 'A light-dependent resistor: about 500 Ω in bright light, rising to ~200 kΩ in the dark. On its own it just dims things — its real job is as half of a voltage divider, turning light into a voltage.',
  npn: 'A current-operated valve. The base–emitter junction wakes at ~0.65 V; then collector current is the base current amplified: I_C ≈ β × I_B (β = 100 here) — until the collector circuit cannot supply that much, and it saturates: fully on, V_CE ≈ 0.2 V.',
};

function formulaLines(c, d, light) {
  const L = [];
  const V = Math.abs(d.V || 0), I = Math.abs(d.I || 0);
  switch (c.type) {
    case 'battery':
      L.push({ eq: 'power out · P = V × I', sub: c.value + ' V × ' + fmtI(I) + ' = ' + fmtP(c.value * I) });
      break;
    case 'resistor':
      L.push({ eq: "Ohm's law · V = I × R", sub: fmtI(I) + ' × ' + fmtR(c.value) + ' = ' + fmtV(V) });
      L.push({ eq: 'heat · P = V × I', sub: fmtP(V * I) });
      break;
    case 'ldr':
      L.push({ eq: "Ohm's law · V = I × R", sub: fmtI(I) + ' × ' + fmtR(d.R || ldrR(light)) + ' = ' + fmtV(V) });
      break;
    case 'led':
      L.push({ eq: 'doorstep · needs ≈ ' + LED_VF[c.value] + ' V to light', sub: fmtV(d.V) + ' across it now' });
      if (I > 1e-4) L.push({ eq: 'light + heat · P = V × I', sub: fmtP(V * I) });
      break;
    case 'capacitor':
      L.push({ eq: 'charge stored · Q = C × V', sub: (c.value * V * 1000).toFixed(2) + ' mC' });
      L.push({ eq: 'energy stored · E = ½ C V²', sub: (0.5 * c.value * V * V * 1000).toFixed(2) + ' mJ' });
      break;
    case 'switch':
      L.push(c.closed
        ? { eq: 'closed · contact ≈ 0.25 Ω', sub: 'only ' + fmtV(V) + ' lost across it' }
        : { eq: 'open · takes the leftover voltage', sub: fmtV(V) + ' across the gap' });
      break;
    case 'npn':
      if (d.mode === 'active') L.push({ eq: 'gain · I_C = β × I_B', sub: '100 × ' + fmtI(d.ib) + ' = ' + fmtI(d.ic) });
      else if (d.mode === 'saturated') {
        L.push({ eq: 'wants · β × I_B', sub: '100 × ' + fmtI(d.ib) + ' = ' + fmtI(100 * d.ib) });
        L.push({ eq: 'circuit only allows', sub: fmtI(d.ic) + ' → fully on, V_CE ≈ 0.2 V' });
      } else L.push({ eq: 'V_BE below the 0.65 V doorstep', sub: fmtV(d.vbe || 0) + ' right now' });
      break;
    case 'buzzer':
      L.push({ eq: 'sings when + is ≈1.5 V up', sub: fmtV(d.V) + ' across · ' + fmtP(V * I) });
      break;
    default: break;
  }
  return L;
}

function loopRowName(c, light) {
  switch (c.type) {
    case 'resistor': return fmtR(c.value) + ' resistor';
    case 'led': return c.value + ' LED';
    case 'switch': return c.closed ? 'switch (closed)' : 'switch (open)';
    case 'capacitor': return fmtC(c.value) + ' capacitor';
    case 'ldr': return 'LDR (' + fmtR(ldrR(light)) + ')';
    case 'buzzer': return 'buzzer';
    default: return NAMES[c.type] || c.type;
  }
}

/* Walk the circuit from the battery's + terminal. If it is one simple series ring,
   return the parts in order so we can show Kirchhoff's voltage budget. */
function seriesLoop(comps, wires) {
  const bats = comps.filter((c) => c.type === 'battery');
  if (bats.length !== 1 || comps.some((c) => c.type === 'npn')) return null;
  const bat = bats[0];
  const par = {};
  const add = (k) => { if (!(k in par)) par[k] = k; };
  const find = (k) => { add(k); while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
  comps.forEach((c) => { add(c.id + ':0'); add(c.id + ':1'); });
  wires.forEach((w) => { par[find(w.a.comp + ':' + w.a.t)] = find(w.b.comp + ':' + w.b.t); });
  const adj = {};
  comps.forEach((c) => {
    const n0 = find(c.id + ':0'), n1 = find(c.id + ':1');
    if (n0 === n1) return;
    (adj[n0] = adj[n0] || []).push({ c, t: 0, other: n1 });
    (adj[n1] = adj[n1] || []).push({ c, t: 1, other: n0 });
  });
  const startNode = find(bat.id + ':0'), endNode = find(bat.id + ':1');
  if (startNode === endNode) return null;
  const rows = [];
  let node = startNode, prevId = bat.id;
  for (let g = 0; g <= comps.length + 1; g++) {
    if (node === endNode) return rows.length ? rows : null;
    const cand = (adj[node] || []).filter((e) => e.c.id !== prevId);
    if (cand.length !== 1 || cand[0].c.id === bat.id) return null;
    const e = cand[0];
    rows.push({ c: e.c, enterT: e.t });
    prevId = e.c.id; node = e.other;
  }
  return null;
}

/* Deterministic diagnostics: every finding comes with its evidence, and clicking
   one selects the culprit on the board. */
function diagnose(comps, wires, res, dev, running, audioOn) {
  const out = [];
  const push = (level, text, evidence, compId) => out.push({ level, text, evidence, compId });
  if (!running) { push('info', 'Simulation stopped', 'press ▶ Run to power the circuit'); return out; }
  if (!comps.length) { push('info', 'Empty bench', 'add parts from the palette, or load an example above'); return out; }
  const bats = comps.filter((c) => c.type === 'battery');
  if (!bats.length) { push('bad', 'No power source', 'every circuit needs a battery to push charge around the loop'); return out; }
  const connected = new Set();
  wires.forEach((w) => { connected.add(w.a.comp + ':' + w.a.t); connected.add(w.b.comp + ':' + w.b.t); });
  const loose = [];
  comps.forEach((c) => {
    const n = c.type === 'npn' ? 3 : 2;
    for (let i = 0; i < n; i++) if (!connected.has(c.id + ':' + i)) loose.push(c);
  });
  const flowing = res && bats.some((b) => Math.abs((res.comp[b.id] || { I: 0 }).I) > 1e-5);
  if (res && res.short) {
    const bd = res.comp[bats[0].id] || { I: 0 };
    push('bad', 'Short circuit', 'current found a path with almost no resistance — the battery is pushing ' + fmtI(bd.I) + '; put a resistor in the loop', bats[0].id);
  }
  comps.forEach((c) => {
    const d = res && res.comp[c.id];
    const st = dev[c.id] || {};
    if (c.type === 'led') {
      if (st.blown) push('bad', 'An LED has blown', 'too much current went through it — select it, tap Replace, and give it a series resistor', c.id);
      else if (d && d.V < -1) push('warn', 'An LED is in backwards', 'the triangle points the way current flows; it is blocking with ' + fmtV(Math.abs(d.V)) + ' across it and 0 mA through — rotate it twice', c.id);
      else if (d && d.I > 0.02) push('warn', 'An LED is running hot', fmtI(d.I) + ' through it — above ~20 mA its life shortens fast; try a bigger resistor', c.id);
    }
    if (c.type === 'buzzer' && d && d.I < -1e-3) {
      push('warn', 'Buzzer is in backwards', fmtI(Math.abs(d.I)) + ' is flowing the wrong way through it, so it stays silent — rotate it twice', c.id);
    }
    if (c.type === 'npn') {
      const bWired = connected.has(c.id + ':0');
      const ceWired = connected.has(c.id + ':1') || connected.has(c.id + ':2');
      if (!bWired && ceWired) push('warn', 'Transistor base is floating', 'nothing feeds the base — it needs a small current into B (through a resistor) before it will switch on', c.id);
    }
    if (c.type === 'capacitor' && d && Math.abs(d.I) < 3e-4 && Math.abs(st.vPrev || 0) > 1) {
      push('info', 'Capacitor is full', 'holding ' + fmtV(Math.abs(st.vPrev)) + ' — a full capacitor blocks steady current; it needs its own path to drain', c.id);
    }
  });
  if (!flowing && !(res && res.short)) {
    const openSw = comps.find((c) => c.type === 'switch' && !c.closed);
    const hasRevLed = out.some((o) => o.text === 'An LED is in backwards');
    if (openSw) push('info', 'No current yet — a switch is open', 'tap the switch to close the loop', openSw.id);
    else if (!hasRevLed && loose.length) push('warn', 'The loop is not complete', loose.length + ' terminal' + (loose.length > 1 ? 's' : '') + ' (hollow dots) still need wiring', loose[0].id);
    else if (!out.length) push('warn', 'No current is flowing', 'check the loop runs from + through every part and back to −');
  }
  const buzzing = comps.some((c) => c.type === 'buzzer' && res && res.comp[c.id] && res.comp[c.id].sounding && res.comp[c.id].I > 5e-4);
  if (buzzing && !audioOn) {
    push('info', 'Buzzer is sounding but you may not hear it', 'tap the board once to let the page play audio — and on iPhone check the side silent switch, since it mutes web audio');
  }
  if (!out.length) push('ok', 'Circuit looks healthy', 'complete loop · sensible values · nothing overheating');
  return out;
}

/* ================= App ================= */
export default function Sparkbench() {
  const [comps, setComps] = useState([]);
  const [wires, setWires] = useState([]);
  const [placing, setPlacing] = useState(null);
  const [wiring, setWiring] = useState(null);
  const [sel, setSel] = useState(null);
  const [hovT, setHovT] = useState(null);
  const [light, setLight] = useState(100);
  const [running, setRunning] = useState(true);
  const [muted, setMuted] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, w: W });
  const [histLen, setHistLen] = useState(0);
  const [boxAR, setBoxAR] = useState(H / W);
  const [narrow, setNarrow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [sheetH, setSheetH] = useState(38);   // % of viewport height, user-adjustable
  const sheetDragRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [tut, setTut] = useState(null);          // { id, step }
  const [tutDone, setTutDone] = useState({});
  const tutLatchRef = useRef({});
  const [, setTick] = useState(0);

  const svgRef = useRef(null);
  const compsRef = useRef(comps); compsRef.current = comps;
  const wiresRef = useRef(wires); wiresRef.current = wires;
  const lightRef = useRef(light); lightRef.current = light;
  const devRef = useRef({});
  const phaseRef = useRef({});
  const resultRef = useRef(null);
  const dragRef = useRef(null);
  const ptrRef = useRef(null);
  const seqRef = useRef(100);
  const loadedRef = useRef(false);
  const runningRef = useRef(running); runningRef.current = running;
  const panRef = useRef(null);
  const palRef = useRef(null);
  const histRef = useRef([]);
  const boxARRef = useRef(H / W); boxARRef.current = boxAR;
  const narrowRef = useRef(false); narrowRef.current = narrow;
  const viewRef = useRef(view); viewRef.current = view;
  const ptrsRef = useRef(new Map());
  const pinchRef = useRef(null);
  const wireDragRef = useRef(null);
  const lpRef = useRef(null);
  const clearLP = () => { if (lpRef.current) { clearTimeout(lpRef.current); lpRef.current = null; } };
  const armLP = (fn) => { clearLP(); lpRef.current = setTimeout(fn, 430); };

  useEffect(() => {
    audio.onState = setAudioReady;
    setAudioReady(audio.ready);
    return () => { audio.onState = null; };
  }, []);

  /* --- load / save --- */
  const loadPreset = (i) => {
    if (loadedRef.current) pushHist();
    const p = JSON.parse(JSON.stringify(PRESETS[i]));
    devRef.current = {}; phaseRef.current = {};
    setComps(p.comps); setWires(p.wires);
    setSel(null); setWiring(null); setPlacing(null); setLight(100);
    fitTo(p.comps);
  };
  useEffect(() => {
    (async () => {
      try {
        try {
          const tr = await store.get('sparkbench:tut');
          if (tr && tr.value) setTutDone(JSON.parse(tr.value));
        } catch (e) { /* fresh start */ }
        const r = await store.get('sparkbench:v1');
        if (r && r.value) {
          const d = JSON.parse(r.value);
          if (d.comps && d.comps.length) {
            setComps(d.comps); setWires(d.wires || []);
            seqRef.current = d.seq || 100;
            loadedRef.current = true; return;
          }
        }
      } catch (e) { /* nothing saved yet */ }
      loadPreset(0); loadedRef.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => {
      try { store.set('sparkbench:v1', JSON.stringify({ comps, wires, seq: seqRef.current })).catch(() => {}); } catch (e) { /* best effort */ }
    }, 500);
    return () => clearTimeout(t);
  }, [comps, wires]);

  /* --- simulation loop --- */
  useEffect(() => {
    let raf, last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, Math.max(0.002, (now - last) / 1000)); last = now;
      const res = runningRef.current ? simulate(compsRef.current, wiresRef.current, devRef.current, dt, lightRef.current) : null;
      resultRef.current = res;
      if (res) {
        wiresRef.current.forEach((w) => {
          const I = res.wire[w.id] || 0;
          if (Math.abs(I) > 2e-4) {
            const sp = Math.min(150, Math.abs(I) * 30000);
            phaseRef.current[w.id] = (phaseRef.current[w.id] || 0) - Math.sign(I) * sp * dt;
          }
        });
      }
      const cl = compsRef.current;
      cl.forEach((c) => {
        if (c.type !== 'buzzer') return;
        const d = res && res.comp[c.id];
        setBuzzerLevel(c.id, d && d.sounding ? Math.min(1, Math.abs(d.I) / 0.02) : 0);
      });
      Object.keys(audio.nodes).forEach((id) => { if (!cl.some((c) => c.id === id)) stopBuzzer(id); });
      setTick((t) => t + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); Object.keys(audio.nodes).forEach(stopBuzzer); };
  }, []);

  /* --- wheel zoom (native listener so preventDefault works) --- */
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.pow(1.0016, e.deltaY);
      setView((v) => {
        const w = Math.min(2400, Math.max(320, v.w * f));
        const oh = v.w * boxARRef.current, h = w * boxARRef.current;
        const px = v.x + ((e.clientX - r.left) * v.w) / r.width;
        const py = v.y + ((e.clientY - r.top) * oh) / r.height;
        const kx = (px - v.x) / v.w, ky = (py - v.y) / oh;
        return { x: px - kx * w, y: py - ky * h, w };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* --- keyboard --- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { setPlacing(null); setWiring(null); setSel(null); setCtxMenu(null); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (!e.ctrlKey && !e.metaKey && (e.key === 'r' || e.key === 'R')) rotateSel();
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* --- board size & viewport --- */
  const viewH = view.w * boxAR;
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) setBoxAR(r.height / r.width);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    else window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 820);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /* --- pinch to zoom (capture phase, so it works over components too) --- */
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const pt = (e) => ({ x: e.clientX, y: e.clientY });
    const down = (e) => {
      ptrsRef.current.set(e.pointerId, pt(e));
      if (ptrsRef.current.size === 2) {
        const [a, b] = Array.from(ptrsRef.current.values());
        dragRef.current = null; panRef.current = null;   // a pinch is not a drag
        if (lpRef.current) { clearTimeout(lpRef.current); lpRef.current = null; }
        setWiring(null); setPlacing(null);
        pinchRef.current = {
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          v0: viewRef.current,
          rect: el.getBoundingClientRect(),
        };
      }
    };
    const move = (e) => {
      if (!ptrsRef.current.has(e.pointerId)) return;
      ptrsRef.current.set(e.pointerId, pt(e));
      const p = pinchRef.current;
      if (!p || ptrsRef.current.size < 2) return;
      const [a, b] = Array.from(ptrsRef.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 8 || p.d0 < 8) return;
      const ar = boxARRef.current;
      const w = Math.min(2400, Math.max(320, (p.v0.w * p.d0) / d));
      const kx = (p.mid.x - p.rect.left) / p.rect.width;
      const ky = (p.mid.y - p.rect.top) / p.rect.height;
      const px = p.v0.x + kx * p.v0.w, py = p.v0.y + ky * (p.v0.w * ar);
      setView({ x: px - kx * w, y: py - ky * (w * ar), w });
      e.preventDefault();
    };
    const up = (e) => {
      ptrsRef.current.delete(e.pointerId);
      if (ptrsRef.current.size < 2) pinchRef.current = null;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
    };
  }, []);

  /* --- helpers --- */
  const clientToWorld = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return {
      x: view.x + ((cx - r.left) * view.w) / r.width,
      y: view.y + ((cy - r.top) * viewH) / r.height,
    };
  };
  const svgPt = (e) => clientToWorld(e.clientX, e.clientY);
  const zoomBy = (f) => setView((v) => {
    const w = Math.min(2400, Math.max(320, v.w * f));
    const oh = v.w * boxARRef.current, h = w * boxARRef.current;
    return { x: v.x + v.w / 2 - w / 2, y: v.y + oh / 2 - h / 2, w };
  });
  const fitTo = (cs) => {
    const ar = boxARRef.current || H / W;
    if (!cs || !cs.length) { setView({ x: 0, y: 0, w: W }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    cs.forEach((c) => getTerminals(c).forEach((p) => {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }));
    const pad = 70;
    const bw = (x1 - x0) + pad * 2, bh = (y1 - y0) + pad * 2;
    const w = Math.min(2400, Math.max(320, Math.max(bw, bh / ar)));
    setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * ar) / 2, w });
  };
  const resetView = () => fitTo(compsRef.current);

  /* --- undo history --- */
  const pushSnap = (s) => {
    histRef.current.push(s);
    if (histRef.current.length > 60) histRef.current.shift();
    setHistLen(histRef.current.length);
  };
  const pushHist = () => pushSnap(JSON.stringify({ comps: compsRef.current, wires: wiresRef.current }));
  const undo = () => {
    const s = histRef.current.pop(); setHistLen(histRef.current.length);
    if (!s) return;
    const d = JSON.parse(s);
    setComps(d.comps); setWires(d.wires);
    setSel(null); setWiring(null); setPlacing(null);
  };

  const defaults = { battery: { value: 9 }, resistor: { value: 1000 }, led: { value: 'red' }, buzzer: {}, switch: { closed: false }, capacitor: { value: 0.00047 }, ldr: {}, npn: {} };
  const placeAtType = (type, p) => {
    pushHist();
    const id = 'c' + seqRef.current++;
    const nc = { id, type, x: snap(p.x), y: snap(p.y), rot: 0, ...defaults[type] };
    setComps((cs) => [...cs, nc]);
    const nw = autoConnect(nc, compsRef.current, wiresRef.current, seqRef);
    if (nw) setWires(nw);
    setPlacing(null); setSel({ kind: 'comp', id });
  };
  const placeAt = (p) => placeAtType(placing, p);

  /* --- palette: tap to arm, or drag straight onto the board --- */
  const overSvg = (e) => {
    const r = svgRef.current && svgRef.current.getBoundingClientRect();
    return r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const onPalDown = (e, t) => {
    e.preventDefault();
    ensureAudio();
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    palRef.current = { type: t, sx: e.clientX, sy: e.clientY, drag: false };
  };
  const onPalMove = (e) => {
    const p = palRef.current; if (!p) return;
    const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
    if (!p.drag) {
      const started = narrowRef.current
        ? (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx))  // drag up onto the board; sideways scrolls the row
        : Math.hypot(dx, dy) > 7;
      if (started) { p.drag = true; setPlacing(p.type); setWiring(null); setSel(null); }
    }
    if (p.drag) ptrRef.current = overSvg(e) ? clientToWorld(e.clientX, e.clientY) : null;
  };
  const onPalUp = (e) => {
    const p = palRef.current; palRef.current = null;
    if (!p) return;
    if (p.drag) {
      if (overSvg(e)) placeAtType(p.type, clientToWorld(e.clientX, e.clientY));
      else setPlacing(null);
    } else {
      setPlacing(placing === p.type ? null : p.type); setWiring(null); setSel(null);
    }
  };
  const startTutorial = (t) => {
    pushHist();
    devRef.current = {}; phaseRef.current = {};
    if (t.start && t.start.comps) {
      const p = JSON.parse(JSON.stringify(t.start));
      setComps(p.comps); setWires(p.wires);
      fitTo(p.comps);
    } else {
      setComps([]); setWires([]);
      setView({ x: 0, y: 0, w: W });
    }
    setSel(null); setWiring(null); setPlacing(null); setCtxMenu(null); setMenuOpen(false);
    setLight(100); setRunning(true);
    tutLatchRef.current = {};
    setTut({ id: t.id, step: 0 });
  };
  const exitTutorial = () => setTut(null);
  const advanceTut = () => {
    if (!tut) return;
    const def = TUTORIALS.find((t) => t.id === tut.id);
    if (!def) { setTut(null); return; }
    if (tut.step >= def.steps.length - 1) {
      const next = { ...tutDone, [tut.id]: true };
      setTutDone(next);
      try { store.set('sparkbench:tut', JSON.stringify(next)).catch(() => {}); } catch (e) { /* best effort */ }
      setTut(null);
    } else {
      setTut({ id: tut.id, step: tut.step + 1 });
    }
  };

  const rotateBy = (id, deg) => {
    const cur = compsRef.current.find((x) => x.id === id);
    if (!cur) return;
    pushHist();
    const rc = { ...cur, rot: ((cur.rot || 0) + deg) % 360 };
    setComps((cs) => cs.map((x) => (x.id === id ? rc : x)));
    const nw = autoConnect(rc, compsRef.current, wiresRef.current, seqRef);
    if (nw) setWires(nw);
  };
  const rotateSel = () => { if (sel && sel.kind === 'comp') rotateBy(sel.id, 90); };
  const duplicateComp = (id) => {
    const cur = compsRef.current.find((x) => x.id === id);
    if (!cur) return;
    pushHist();
    const nid = 'c' + seqRef.current++;
    const nc = { ...cur, id: nid, x: snap(cur.x + 40), y: snap(cur.y + 40) };
    setComps((cs) => [...cs, nc]);
    const nw = autoConnect(nc, compsRef.current, wiresRef.current, seqRef);
    if (nw) setWires(nw);
    setSel({ kind: 'comp', id: nid });
  };
  const deleteSel = () => {
    if (!sel) return;
    pushHist();
    if (sel.kind === 'comp') {
      setComps((cs) => cs.filter((x) => x.id !== sel.id));
      setWires((ws) => ws.filter((w) => w.a.comp !== sel.id && w.b.comp !== sel.id));
      delete devRef.current[sel.id];
    } else {
      setWires((ws) => ws.filter((w) => w.id !== sel.id));
    }
    setSel(null);
  };
  const clearAll = () => {
    if (compsRef.current.length || wiresRef.current.length) pushHist();
    setComps([]); setWires([]); devRef.current = {}; phaseRef.current = {};
    setSel(null); setWiring(null); setPlacing(null);
  };

  /* --- pointer handlers --- */
  const onBgDown = (e) => {
    ensureAudio();
    setCtxMenu(null);
    setMenuOpen(false);
    const p = svgPt(e);
    if (placing) { placeAt(p); return; }
    if (wiring) { setWiring(null); return; }
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
  };
  const onCompDown = (e, c) => {
    e.stopPropagation();
    ensureAudio();
    setCtxMenu(null);
    const p = svgPt(e);
    if (placing) { placeAt(p); return; }
    dragRef.current = {
      id: c.id, dx: p.x - c.x, dy: p.y - c.y, sx: p.x, sy: p.y, moved: false,
      hist: JSON.stringify({ comps: compsRef.current, wires: wiresRef.current }),
    };
    const cx = e.clientX, cy = e.clientY;
    armLP(() => {
      const dr = dragRef.current;
      if (!dr || dr.id !== c.id || dr.moved) return;
      dragRef.current = null;
      const r = svgRef.current.getBoundingClientRect();
      setSel({ kind: 'comp', id: c.id });
      setCtxMenu({ kind: 'comp', id: c.id, x: cx - r.left, y: cy - r.top });
    });
  };
  const onTermDown = (e, cid, t) => {
    e.stopPropagation();
    setCtxMenu(null);
    if (placing) { placeAt(svgPt(e)); return; }
    if (!wiring) { setWiring({ comp: cid, t }); return; }
    if (wiring.comp === cid && wiring.t === t) { setWiring(null); return; }
    const dup = wires.some((w) =>
      (w.a.comp === cid && w.a.t === t && w.b.comp === wiring.comp && w.b.t === wiring.t) ||
      (w.b.comp === cid && w.b.t === t && w.a.comp === wiring.comp && w.a.t === wiring.t));
    if (!dup) {
      pushHist();
      const id = 'w' + seqRef.current++;
      setWires((ws) => [...ws, { id, a: { ...wiring }, b: { comp: cid, t } }]);
    }
    setWiring(null);
  };
  const onMove = (e) => {
    if (pinchRef.current) { clearLP(); return; }
    const p = svgPt(e); ptrRef.current = p;
    const wd = wireDragRef.current;
    if (wd) {
      if (!wd.moved && Math.hypot(p.x - wd.sx, p.y - wd.sy) > 6) { wd.moved = true; clearLP(); }
      if (wd.moved) {
        const v = snap(wd.axis === 'x' ? p.x : p.y);
        setWires((ws) => ws.map((w) => (w.id === wd.id ? { ...w, mid: { a: wd.axis, v } } : w)));
      }
      return;
    }
    const pn = panRef.current;
    if (pn) {
      if (Math.hypot(e.clientX - pn.sx, e.clientY - pn.sy) > 5) pn.moved = true;
      if (pn.moved) {
        const r = svgRef.current.getBoundingClientRect();
        const dx = ((e.clientX - pn.sx) * view.w) / r.width;
        const dy = ((e.clientY - pn.sy) * viewH) / r.height;
        setView((v) => ({ ...v, x: pn.ox - dx, y: pn.oy - dy }));
      }
      return;
    }
    const dr = dragRef.current;
    if (dr) {
      if (Math.hypot(p.x - dr.sx, p.y - dr.sy) > 6) { dr.moved = true; clearLP(); }
      if (dr.moved) {
        const nx = snap(p.x - dr.dx), ny = snap(p.y - dr.dy);
        setComps((cs) => cs.map((x) => (x.id === dr.id ? { ...x, x: nx, y: ny } : x)));
      }
    }
  };
  const onUp = () => {
    clearLP();
    if (pinchRef.current || ptrsRef.current.size > 1) { dragRef.current = null; panRef.current = null; wireDragRef.current = null; return; }
    const wd = wireDragRef.current;
    if (wd) {
      wireDragRef.current = null;
      if (wd.moved) pushSnap(wd.hist);
      else {
        // tap on a straight-run wire it has been dragged before: reset to auto routing
        const w = wiresRef.current.find((x) => x.id === wd.id);
        if (w && w.mid && sel && sel.kind === 'wire' && sel.id === wd.id) {
          pushHist();
          setWires((ws) => ws.map((x) => (x.id === wd.id ? { ...x, mid: undefined } : x)));
        }
      }
      return;
    }
    const pn = panRef.current;
    if (pn) { panRef.current = null; if (!pn.moved) setSel(null); return; }
    const dr = dragRef.current;
    if (dr) {
      dragRef.current = null;
      if (!dr.moved) {
        const c = compsRef.current.find((x) => x.id === dr.id);
        if (c) {
          const wired = wiresRef.current.some((w) => w.a.comp === c.id || w.b.comp === c.id);
          const already = sel && sel.kind === 'comp' && sel.id === c.id;
          if (c.type === 'switch') setComps((cs) => cs.map((x) => (x.id === c.id ? { ...x, closed: !x.closed } : x)));
          else if (already && !wired) {
            // nothing attached, so spinning it can't break anything — tap again to turn
            pushHist();
            setComps((cs) => cs.map((x) => (x.id === c.id ? { ...x, rot: ((x.rot || 0) + 90) % 360 } : x)));
          }
          setSel({ kind: 'comp', id: c.id });
        }
      } else {
        pushSnap(dr.hist);
        const c = compsRef.current.find((x) => x.id === dr.id);
        if (c) {
          const nw = autoConnect(c, compsRef.current, wiresRef.current, seqRef);
          if (nw) setWires(nw);
        }
      }
    }
  };

  /* --- derived --- */
  const res = resultRef.current;
  const termOf = (ref) => termOfIn(comps, ref);
  const connectedT = new Set();
  wires.forEach((w) => { connectedT.add(w.a.comp + ':' + w.a.t); connectedT.add(w.b.comp + ':' + w.b.t); });
  const selComp = sel && sel.kind === 'comp' ? comps.find((x) => x.id === sel.id) : null;
  const anyLdr = comps.some((c) => c.type === 'ldr');
  const anyBlown = comps.some((c) => c.type === 'led' && devRef.current[c.id] && devRef.current[c.id].blown);

  /* transient only — nothing permanent sitting over the circuit */
  const hint = tut ? null
    : res && res.short ? null
    : placing ? 'Drop the ' + NAMES[placing].toLowerCase() + ' on the board'
    : wiring ? 'Tap another terminal dot to finish the wire'
    : anyBlown ? 'An LED has blown — select it and tap Replace'
    : comps.length === 0 && !Object.keys(tutDone).length ? 'New here? Tap ' + (narrow ? '⋯' : '🎓 Learn') + ' for a guided start'
    : null;

  const loop = running && res ? seriesLoop(comps, wires) : null;
  const diags = diagnose(comps, wires, res, devRef.current, running, audioReady);

  const tutDef = tut ? TUTORIALS.find((t) => t.id === tut.id) : null;
  const tutStep = tutDef ? tutDef.steps[tut.step] : null;
  if (tutStep) {
    let okNow = false;
    try { okNow = !!tutStep.check({ comps, wires, res, dev: devRef.current, sel, light }); } catch (e) { okNow = false; }
    if (okNow) tutLatchRef.current[tut.step] = true;
  }
  const stepOk = tutStep ? !!tutLatchRef.current[tut.step] : false;
  const hintPal = tutStep && !stepOk ? tutStep.hint : null;

  /* --- styles --- */
  const chip = (active, extra) => ({
    fontFamily: MONO, fontSize: 12.5, padding: '6px 11px', borderRadius: 8,
    border: '1.5px solid ' + (active ? AMBER : '#d9d2bf'),
    background: active ? '#fdf3df' : '#fffdf6', color: INK, cursor: 'pointer',
    lineHeight: 1.2, ...extra,
  });
  const palBtn = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    fontFamily: MONO, fontSize: 9.5, padding: '4px 7px 3px', borderRadius: 9,
    border: '1.5px solid ' + (active ? AMBER : '#d9d2bf'),
    background: active ? '#fdf3df' : 'rgba(255,253,246,0.94)', color: '#5a5548', cursor: 'grab',
    touchAction: narrow ? 'pan-x' : 'none', flex: '0 0 auto',
  });
  const overlayBar = {
    display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(253,251,244,0.9)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    border: '1.5px solid #ded6c2', borderRadius: 11, padding: 4,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: PAPER, color: INK, fontFamily: MONO,
      paddingTop: narrow ? 'env(safe-area-inset-top)' : 12,
      paddingBottom: narrow ? 0 : 8,
      paddingLeft: narrow ? 'env(safe-area-inset-left)' : 12,
      paddingRight: narrow ? 'env(safe-area-inset-right)' : 12,
      boxSizing: 'border-box', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      overscrollBehavior: 'none',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        .sb-pulse { animation: sbp 1s ease-in-out infinite; }
        .sb-hint { animation: sbh 1.15s ease-in-out infinite; }
        @keyframes sbh { 0%,100% { box-shadow: 0 0 0 0 rgba(233,147,15,0); } 50% { box-shadow: 0 0 0 6px rgba(233,147,15,0.35); } }
        @keyframes sbp { 0%,100%{opacity:.95} 50%{opacity:.25} }
        button { -webkit-tap-highlight-color: transparent; }
        button:hover { filter: brightness(0.98); }
        input[type=range] { accent-color: ${AMBER}; }
        .sb-scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .sb-scroll::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) { .sb-pulse { animation: none; } }
      `}</style>

      <div style={{ maxWidth: narrow ? '100%' : 1360, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: narrow ? '8px 12px 6px' : 0, marginBottom: narrow ? 0 : 10, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: narrow ? 21 : 30, letterSpacing: '0.01em' }}>Sparkbench</span>
            {!narrow && <span style={{ fontSize: 11.5, color: MUT }}>draw a circuit · watch it come alive</span>}
          </div>
          {!narrow && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={chip(menuOpen, { fontWeight: 700 })} onClick={() => setMenuOpen((m) => !m)}>🎓 Learn</button>
              {PRESETS.map((p, i) => (
                <button key={i} style={chip(false)} onClick={() => loadPreset(i)}>{p.label}</button>
              ))}
              <button style={chip(false, { color: MUT })} onClick={clearAll}>Clear</button>
            </div>
          )}
          {narrow && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <button title={running ? 'Stop' : 'Run'} style={chip(!running, { fontWeight: 700, padding: '5px 9px' })} onClick={() => setRunning((r) => !r)}>{running ? '⏸' : '▶'}</button>
              <button title="Undo" disabled={!histLen} style={chip(false, { padding: '5px 9px', opacity: histLen ? 1 : 0.35 })} onClick={undo}>↩</button>
              <button title="Clear the board" style={chip(false, { padding: '5px 9px', color: MUT })} onClick={clearAll}>⌫</button>
              <button title={muted ? 'Unmute' : 'Mute'} style={chip(false, { padding: '5px 9px' })} onClick={() => { ensureAudio(); audio.muted = !audio.muted; setMuted(audio.muted); }}>{muted ? '🔇' : audioReady ? '🔊' : '🔈'}</button>
              <button title="Examples" style={chip(menuOpen, { padding: '5px 9px' })} onClick={() => setMenuOpen((m) => !m)}>⋯</button>
            </div>
          )}
        </div>

        {/* learn + examples menu */}
        {menuOpen && (
          <div style={{ position: 'absolute', top: narrow ? 44 : 54, right: 12, zIndex: 20, width: 272, background: '#fffdf6', border: '1.5px solid #d9d2bf', borderRadius: 12, padding: 6, boxShadow: '0 6px 20px rgba(60,50,20,0.16)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10.5, color: MUT, padding: '2px 8px 0' }}>Tutorials</div>
            {TUTORIALS.map((t) => (
              <button key={t.id} style={chip(false, { textAlign: 'left', display: 'block' })} onClick={() => startTutorial(t)}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{t.emoji} {t.title}</span>
                  {tutDone[t.id] && <span style={{ color: '#2fa46a' }}>✓</span>}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: MUT, marginTop: 1 }}>{t.blurb}</span>
              </button>
            ))}
            {narrow && (
              <>
                <div style={{ fontSize: 10.5, color: MUT, padding: '4px 8px 0' }}>Examples</div>
                {PRESETS.map((p, i) => (
                  <button key={i} style={chip(false, { textAlign: 'left' })} onClick={() => { loadPreset(i); setMenuOpen(false); }}>{p.label}</button>
                ))}
              </>
            )}
          </div>
        )}

        {/* board + inspector */}
        <div style={{ display: 'flex', gap: narrow ? 0 : 12, alignItems: 'stretch', flexDirection: narrow ? 'column' : 'row', flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ position: 'relative', flex: narrow ? '1 1 auto' : '3 1 560px', minWidth: 0, minHeight: 180, borderRadius: narrow ? 0 : 14, border: narrow ? 'none' : '1.5px solid #d5cdb8', borderTop: narrow ? '1.5px solid #e2dac6' : undefined, boxShadow: narrow ? 'none' : '0 2px 10px rgba(60,50,20,0.07)', overflow: 'hidden', background: BOARD }}>
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${viewH}`}
            style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: placing ? 'copy' : 'default' }}
            onPointerDown={onBgDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => { dragRef.current = null; panRef.current = null; clearLP(); }}
          >
            <defs>
              <pattern id="sbgrid" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M 20 0 V 100 M 40 0 V 100 M 60 0 V 100 M 80 0 V 100 M 0 20 H 100 M 0 40 H 100 M 0 60 H 100 M 0 80 H 100" stroke={GRID1} strokeWidth="0.7" />
                <path d="M 100 0 V 100 M 0 100 H 100" stroke={GRID2} strokeWidth="1" />
              </pattern>
              <filter id="sbglow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>
            <rect x={view.x} y={view.y} width={view.w} height={viewH} fill={BOARD} />
            <rect x={view.x} y={view.y} width={view.w} height={viewH} fill="url(#sbgrid)" />

            {/* LED glow layer */}
            {res && comps.filter((c) => c.type === 'led').map((c) => {
              const I = (res.comp[c.id] && res.comp[c.id].I) || 0;
              if (I < 5e-4) return null;
              const t = getTerminals(c);
              const mx = (t[0].x + t[1].x) / 2, my = (t[0].y + t[1].y) / 2;
              return <circle key={'g' + c.id} cx={mx} cy={my} r={20 + Math.min(18, I * 700)} fill={LED_COLORS[c.value] || '#e5484d'} opacity={Math.min(0.7, I / 0.02)} filter="url(#sbglow)" />;
            })}

            {/* wires */}
            {wires.map((w) => {
              const pts = wireRoute(w, comps);
              if (!pts) return null;
              const p = pts[0], q = pts[pts.length - 1];
              const d = 'M ' + pts.map((t) => t.x + ' ' + t.y).join(' L ');
              const I = res ? res.wire[w.id] || 0 : 0;
              const isSel = sel && sel.kind === 'wire' && sel.id === w.id;
              /* arrow on the longest segment, pointing the way current flows */
              let arrow = null;
              if (Math.abs(I) > 3e-4) {
                let bi = 0, bl = 0;
                for (let i = 0; i < pts.length - 1; i++) {
                  const L = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
                  if (L > bl) { bl = L; bi = i; }
                }
                if (bl > 34) {
                  const A = pts[bi], B = pts[bi + 1];
                  let ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI;
                  if (I < 0) ang += 180;
                  arrow = (
                    <g transform={`translate(${(A.x + B.x) / 2},${(A.y + B.y) / 2}) rotate(${ang})`}
                      opacity={Math.min(1, Math.abs(I) / 0.003)} pointerEvents="none">
                      <path d="M -5.5 -4.5 L 7 0 L -5.5 4.5 Z" fill={AMBER} stroke={BOARD} strokeWidth="1.2" strokeLinejoin="round" />
                    </g>
                  );
                }
              }
              return (
                <g key={w.id}>
                  <path d={d} stroke={isSel ? BLUE : INK} strokeWidth="2.4" fill="none" strokeLinejoin="round" />
                  {Math.abs(I) > 2e-4 && (
                    <path d={d} stroke={AMBER} strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray="0.1 11" strokeDashoffset={phaseRef.current[w.id] || 0}
                      opacity={Math.min(1, Math.abs(I) / 0.002)} />
                  )}
                  {arrow}
                  <path d={d} stroke="rgba(0,0,0,0)" strokeWidth="18" fill="none"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setCtxMenu(null);
                      if (placing) { placeAt(svgPt(e)); return; }
                      const s = svgPt(e);
                      wireDragRef.current = {
                        id: w.id, sx: s.x, sy: s.y, moved: false,
                        axis: w.mid ? w.mid.a : midAxis(p, q),
                        hist: JSON.stringify({ comps: compsRef.current, wires: wiresRef.current }),
                      };
                      setSel({ kind: 'wire', id: w.id });
                      const cx = e.clientX, cy = e.clientY;
                      armLP(() => {
                        const wd = wireDragRef.current;
                        if (!wd || wd.id !== w.id || wd.moved) return;
                        wireDragRef.current = null;
                        const r = svgRef.current.getBoundingClientRect();
                        setCtxMenu({ kind: 'wire', id: w.id, x: cx - r.left, y: cy - r.top });
                      });
                    }} />
                </g>
              );
            })}

            {/* wire preview */}
            {wiring && ptrRef.current && (() => {
              const p = termOf(wiring);
              if (!p) return null;
              return <path d={wirePath(p, { x: ptrRef.current.x, y: ptrRef.current.y }, false)} stroke={BLUE} strokeWidth="2" strokeDasharray="5 5" fill="none" opacity="0.7" />;
            })()}

            {/* components */}
            {comps.map((c) => {
              const rot = c.rot || 0;
              const st = devRef.current[c.id];
              const d = res ? res.comp[c.id] : null;
              const isSel = sel && sel.kind === 'comp' && sel.id === c.id;
              const lbl = compLabel(c, light);
              const isN = c.type === 'npn';
              return (
                <g key={c.id} transform={`translate(${c.x},${c.y}) rotate(${rot})`} style={{ cursor: 'grab' }} onPointerDown={(e) => onCompDown(e, c)}>
                  <rect x={isN ? -16 : -12} y={isN ? -56 : -30} width={isN ? 72 : 104} height={isN ? 112 : 60} rx="12" fill="rgba(0,0,0,0)" stroke="none" />
                  {isSel && <rect x={isN ? -12 : -8} y={isN ? -54 : -28} width={isN ? 64 : 96} height={isN ? 108 : 56} rx="10" fill={BLUE} fillOpacity="0.06" stroke={BLUE} strokeWidth="1.5" />}
                  <SymbolBody c={c} st={st} d={d} light={light} />
                  {lbl && (
                    <g transform={`translate(${isN ? 14 : 40},${isN ? 58 : -22}) rotate(${-rot})`}>
                      <text textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily={MONO} fill={MUT}>{lbl}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* terminals */}
            {comps.flatMap((c) => getTerminals(c).map((p, i) => {
              const active = wiring && wiring.comp === c.id && wiring.t === i;
              const hov = hovT && hovT.comp === c.id && hovT.t === i;
              const conn = connectedT.has(c.id + ':' + i);
              return (
                <g key={c.id + 't' + i} style={{ cursor: 'crosshair' }}
                  onPointerDown={(e) => onTermDown(e, c.id, i)}
                  onPointerEnter={() => setHovT({ comp: c.id, t: i })}
                  onPointerLeave={() => setHovT(null)}>
                  <circle cx={p.x} cy={p.y} r="15" fill="rgba(0,0,0,0)" />
                  <circle cx={p.x} cy={p.y} r={conn ? 3.6 : 3.9} fill={conn ? INK : BOARD} stroke={conn ? 'none' : INK} strokeWidth="1.7" />
                  {(active || hov || wiring) && (
                    <circle cx={p.x} cy={p.y} r="8.5" fill="none"
                      stroke={active ? AMBER : BLUE} strokeWidth="2"
                      className={active ? 'sb-pulse' : ''}
                      opacity={active || hov ? 1 : 0.3} />
                  )}
                </g>
              );
            }))}

            {/* ghost while placing */}
            {placing && ptrRef.current && (
              <g transform={`translate(${snap(ptrRef.current.x)},${snap(ptrRef.current.y)})`} opacity="0.45" pointerEvents="none">
                <SymbolBody c={{ type: placing, rot: 0, ...defaults[placing] }} st={null} d={null} light={light} />
              </g>
            )}
          </svg>

          {/* overlay: view controls (top-right) */}
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={overlayBar}>
              {!narrow && (
                <>
                  <button title={running ? 'Stop the simulation' : 'Run the simulation'} style={chip(!running, { fontWeight: 700, padding: '5px 10px', border: 'none', background: running ? 'transparent' : '#fdf3df' })} onClick={() => setRunning((r) => !r)}>{running ? '⏸ Stop' : '▶ Run'}</button>
                  <button title="Undo (Ctrl+Z)" disabled={!histLen} style={chip(false, { padding: '5px 10px', border: 'none', background: 'transparent', opacity: histLen ? 1 : 0.35 })} onClick={undo}>↩ Undo</button>
                  <button title={muted ? 'Unmute buzzers' : audioReady ? 'Mute buzzers' : 'Tap to enable sound'} style={chip(false, { padding: '5px 9px', border: 'none', background: 'transparent' })} onClick={() => { ensureAudio(); audio.muted = !audio.muted; setMuted(audio.muted); }}>{muted ? '🔇' : audioReady ? '🔊' : '🔈'}</button>
                  <div style={{ width: 1, alignSelf: 'stretch', background: '#e3dbc6', margin: '3px 2px' }} />
                </>
              )}
              <button title="Zoom out" style={chip(false, { padding: '5px 9px', border: 'none', background: 'transparent' })} onClick={() => zoomBy(1.25)}>−</button>
              <button title="Reset view" style={chip(false, { padding: '5px 9px', border: 'none', background: 'transparent' })} onClick={resetView}>⌂</button>
              <button title="Zoom in" style={chip(false, { padding: '5px 9px', border: 'none', background: 'transparent' })} onClick={() => zoomBy(1 / 1.25)}>+</button>
            </div>
            {anyLdr && (
              <div style={{ ...overlayBar, padding: '5px 10px', gap: 7 }}>
                <span style={{ fontSize: 14 }}>☾</span>
                <input type="range" min="0" max="100" value={light} onChange={(e) => setLight(+e.target.value)} style={{ width: narrow ? 96 : 120 }} aria-label="Room light" />
                <span style={{ fontSize: 14 }}>☀</span>
              </div>
            )}
          </div>

          {/* overlay: palette dock (scrolls sideways) */}
          <div className="sb-scroll" style={{ position: 'absolute', left: 8, bottom: 8, width: 'calc(100% - 16px)', boxSizing: 'border-box', zIndex: 5, display: 'flex', gap: 5, padding: 4, justifyContent: narrow ? 'flex-start' : 'safe center', background: 'rgba(253,251,244,0.82)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', border: '1.5px solid #ded6c2', borderRadius: 12 }}>
            {Object.keys(NAMES).map((t) => (
              <button key={t} style={palBtn(placing === t)}
                className={hintPal === t ? 'sb-hint' : undefined}
                onPointerDown={(e) => onPalDown(e, t)}
                onPointerMove={onPalMove}
                onPointerUp={onPalUp}
                onPointerCancel={() => { palRef.current = null; setPlacing(null); }}>
                <MiniIcon type={t} />
                <span>{t === 'ldr' ? 'LDR' : t === 'npn' ? 'NPN' : NAMES[t]}</span>
              </button>
            ))}
          </div>

          {/* long-press context menu */}
          {ctxMenu && (() => {
            const c = ctxMenu.kind === 'comp' ? comps.find((x) => x.id === ctxMenu.id) : null;
            const wSel = ctxMenu.kind === 'wire' ? wires.find((x) => x.id === ctxMenu.id) : null;
            if (!c && !wSel) return null;
            const r = svgRef.current ? svgRef.current.getBoundingClientRect() : { width: 600, height: 400 };
            const wired = c && wires.some((x) => x.a.comp === c.id || x.b.comp === c.id);
            const item = (label, fn, danger) => (
              <button key={label}
                style={{ display: 'block', width: '100%', textAlign: 'left', fontFamily: MONO, fontSize: 12.5, padding: '8px 14px', border: 'none', background: 'transparent', color: danger ? REDC : INK, cursor: 'pointer' }}
                onClick={() => { setCtxMenu(null); fn(); }}>{label}</button>
            );
            return (
              <div style={{ position: 'absolute', left: Math.max(8, Math.min(ctxMenu.x, r.width - 175)), top: Math.max(8, Math.min(ctxMenu.y, r.height - 250)), zIndex: 9, minWidth: 160, background: '#fffdf6', border: '1.5px solid #d9d2bf', borderRadius: 12, boxShadow: '0 8px 26px rgba(60,50,20,0.2)', padding: '3px 0', overflow: 'hidden' }}>
                <div style={{ fontSize: 10.5, color: MUT, padding: '6px 14px 2px' }}>{c ? NAMES[c.type] : 'Wire'}</div>
                {c && item('⟳  Rotate 90°', () => rotateBy(c.id, 90))}
                {c && item('⇅  Rotate 180°', () => rotateBy(c.id, 180))}
                {c && item('⧉  Duplicate', () => duplicateComp(c.id))}
                {c && wired && item('✂  Disconnect', () => { pushHist(); setWires((ws) => ws.filter((x) => x.a.comp !== c.id && x.b.comp !== c.id)); })}
                {c && c.type === 'led' && devRef.current[c.id] && devRef.current[c.id].blown && item('✨  Replace LED', () => { devRef.current[c.id] = { vPrev: 0, on: false, mode: 'off', hot: 0, blown: false }; })}
                {wSel && wSel.mid && item('↔  Straighten', () => { pushHist(); setWires((ws) => ws.map((x) => (x.id === wSel.id ? { ...x, mid: undefined } : x))); })}
                {item('🗑  Delete', deleteSel, true)}
              </div>
            );
          })()}

          {/* tutorial card */}
          {tutDef && tutStep && (
            <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 7, width: 'min(310px, 64%)', background: 'rgba(255,253,246,0.97)', border: '1.5px solid #d9d2bf', borderRadius: 12, padding: '9px 12px', boxShadow: '0 4px 16px rgba(60,50,20,0.14)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15 }}>{tutDef.emoji} {tutDef.title}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 10, color: MUT }}>step {tut.step + 1}/{tutDef.steps.length}</span>
                  <button title="Exit tutorial" style={{ border: 'none', background: 'transparent', color: MUT, cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: MONO }} onClick={exitTutorial}>✕</button>
                </span>
              </div>
              <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{tutStep.text}</div>
              {stepOk && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: '#22794f', lineHeight: 1.45 }}>✓ {tutStep.done}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <button disabled={!stepOk}
                  className={stepOk ? 'sb-hint' : undefined}
                  style={chip(stepOk, { fontWeight: 700, padding: '5px 14px', opacity: stepOk ? 1 : 0.4, cursor: stepOk ? 'pointer' : 'default' })}
                  onClick={advanceTut}>
                  {tut.step === tutDef.steps.length - 1 ? 'Finish 🎉' : 'Next →'}
                </button>
                <button style={{ border: 'none', background: 'transparent', color: MUT, fontSize: 10.5, cursor: 'pointer', fontFamily: MONO, padding: 0 }} onClick={advanceTut}>skip</button>
              </div>
            </div>
          )}

          {/* short circuit banner */}
          {res && res.short && (
            <div style={{ position: 'absolute', ...(tutDef ? { bottom: 62, left: 8 } : { top: 8, left: 8 }), maxWidth: '58%', zIndex: 6, background: '#fdeae7', border: '1.5px solid ' + REDC, color: '#8c2f26', borderRadius: 10, padding: '6px 11px', fontSize: 11.5, boxShadow: '0 3px 10px rgba(140,47,38,0.15)' }}>
              ⚡ Short circuit — add a resistor in the loop
            </div>
          )}

          {/* transient hint */}
          {hint && (
            <div style={{ position: 'absolute', bottom: 58, left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', color: '#6d6656', fontSize: 11, background: 'rgba(253,251,244,0.92)', border: '1px solid #e4dcc8', borderRadius: 8, padding: '3px 10px', whiteSpace: 'nowrap' }}>
              {hint}
            </div>
          )}
        </div>

        {/* inspector */}
        <div style={{
          flex: narrow ? '0 0 auto' : '1 1 300px', minWidth: narrow ? 0 : 270, maxWidth: narrow ? '100%' : 420,
          background: '#fffdf6', border: narrow ? 'none' : '1.5px solid #d9d2bf', borderTop: narrow ? '1.5px solid #ded6c2' : undefined,
          borderRadius: narrow ? 0 : 14,
          padding: narrow ? '0 12px' : '12px 14px',
          paddingBottom: narrow ? 'env(safe-area-inset-bottom)' : 14,
          fontSize: 12.5,
          boxShadow: narrow ? '0 -3px 14px rgba(60,50,20,0.06)' : '0 2px 10px rgba(60,50,20,0.06)',
          height: narrow ? (sheetOpen ? `calc(${sheetH}dvh + env(safe-area-inset-bottom))` : 'calc(42px + env(safe-area-inset-bottom))') : undefined,
          boxSizing: 'border-box',
          overflowY: 'auto', overflowX: 'hidden',
          overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
        }}>
          {narrow && (
            <div
              onPointerDown={(e) => {
                if (!sheetOpen) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                sheetDragRef.current = { y: e.clientY, h: sheetH, moved: false };
              }}
              onPointerMove={(e) => {
                const s = sheetDragRef.current; if (!s) return;
                const dvh = ((s.y - e.clientY) / window.innerHeight) * 100;
                if (Math.abs(dvh) > 0.8) s.moved = true;
                if (s.moved) setSheetH(Math.max(18, Math.min(72, s.h + dvh)));
              }}
              onPointerUp={() => {
                const s = sheetDragRef.current; sheetDragRef.current = null;
                if (s && !s.moved) setSheetOpen((o) => !o);
              }}
              onClick={() => { if (!sheetOpen) setSheetOpen(true); }}
              style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fffdf6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 0 7px', cursor: sheetOpen ? 'ns-resize' : 'pointer', touchAction: 'none' }}>
              <span style={{ fontSize: 11.5, color: MUT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sheetOpen ? 'Circuit · diagnostics · selected part' : (diags[0] ? diags[0].text : 'Details')}
              </span>
              <span style={{ color: '#c9c1ad', fontSize: 13, letterSpacing: 1 }}>{sheetOpen ? '⌃⌄' : '⌃'}</span>
            </div>
          )}

          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18 }}>Circuit</div>
          {!running ? (
            <div style={{ color: MUT, marginTop: 4 }}>stopped — press ▶ Run to power it</div>
          ) : !res ? (
            <div style={{ color: MUT, marginTop: 4 }}>no power yet — the bench needs a battery in a complete loop</div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {comps.filter((c) => c.type === 'battery').map((b) => {
                const d = res.comp[b.id] || { I: 0 };
                return (
                  <div key={b.id} style={{ fontSize: 12, color: '#5a5548' }}>
                    {b.value} V battery · {fmtI(Math.abs(d.I))} · {fmtP(b.value * Math.abs(d.I))}
                  </div>
                );
              })}
              {loop && loop.length > 0 && (() => {
                const bat = comps.find((c) => c.type === 'battery');
                const sum = loop.reduce((s, { c, enterT }) => {
                  const d = res.comp[c.id]; return d ? s + (enterT === 0 ? d.V : -d.V) : s;
                }, 0);
                return (
                  <div style={{ marginTop: 7, background: '#faf6ea', border: '1px solid #eadfc4', borderRadius: 9, padding: '7px 9px' }}>
                    <div style={{ color: MUT, fontSize: 10.5, marginBottom: 3 }}>where the volts go — Kirchhoff's loop</div>
                    {loop.map(({ c, enterT }, i) => {
                      const d = res.comp[c.id]; if (!d) return null;
                      const drop = enterT === 0 ? d.V : -d.V;
                      return (
                        <div key={i} onClick={() => setSel({ kind: 'comp', id: c.id })}
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '1px 0', cursor: 'pointer' }}>
                          <span style={{ color: '#5a5548' }}>{loopRowName(c, light)}</span>
                          <span>{fmtV(drop)}</span>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, borderTop: '1px solid #eadfc4', marginTop: 3, paddingTop: 3 }}>
                      <span style={{ color: MUT }}>adds up to</span>
                      <span>{fmtV(sum)} ≈ {bat.value} V ✓</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, marginTop: 13 }}>Diagnostics</div>
          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {diags.slice(0, 5).map((g, i) => {
              const col = g.level === 'bad' ? REDC : g.level === 'warn' ? AMBER : g.level === 'ok' ? '#2fa46a' : '#7a92c4';
              return (
                <div key={i} onClick={() => g.compId && setSel({ kind: 'comp', id: g.compId })}
                  style={{ borderLeft: '3px solid ' + col, background: '#fbf8ef', borderRadius: 7, padding: '5px 8px', cursor: g.compId ? 'pointer' : 'default' }}>
                  <div style={{ fontSize: 12, color: INK }}>{g.text}</div>
                  <div style={{ fontSize: 10.5, color: MUT, marginTop: 1, lineHeight: 1.45 }}>{g.evidence}</div>
                </div>
              );
            })}
          </div>

          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, marginTop: 13 }}>Selected part</div>
          {selComp ? (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>{NAMES[selComp.type]}</span>
                <span style={{ color: MUT, fontSize: 11.5 }}>{running ? readout(selComp, res ? res.comp[selComp.id] : null) : 'stopped'}</span>
              </div>
              {selComp.type === 'resistor' && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '7px 0' }}>
                  {R_VALUES.map((v) => (
                    <button key={v} style={chip(selComp.value === v, { padding: '3px 8px', fontSize: 11.5 })}
                      onClick={() => { pushHist(); setComps((cs) => cs.map((x) => x.id === selComp.id ? { ...x, value: v } : x)); }}>{fmtR(v)}</button>
                  ))}
                </div>
              )}
              {selComp.type === 'battery' && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '7px 0' }}>
                  {B_VALUES.map((v) => (
                    <button key={v} style={chip(selComp.value === v, { padding: '3px 8px', fontSize: 11.5 })}
                      onClick={() => { pushHist(); setComps((cs) => cs.map((x) => x.id === selComp.id ? { ...x, value: v } : x)); }}>{v} V</button>
                  ))}
                </div>
              )}
              {selComp.type === 'capacitor' && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '7px 0' }}>
                  {C_VALUES.map((v) => (
                    <button key={v} style={chip(selComp.value === v, { padding: '3px 8px', fontSize: 11.5 })}
                      onClick={() => { pushHist(); setComps((cs) => cs.map((x) => x.id === selComp.id ? { ...x, value: v } : x)); }}>{fmtC(v)}</button>
                  ))}
                </div>
              )}
              {selComp.type === 'led' && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '7px 0' }}>
                  {Object.keys(LED_COLORS).map((v) => (
                    <button key={v} style={chip(selComp.value === v, { padding: '3px 8px', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 })}
                      onClick={() => { pushHist(); setComps((cs) => cs.map((x) => x.id === selComp.id ? { ...x, value: v } : x)); }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: LED_COLORS[v], display: 'inline-block' }} />
                      {v} · {LED_VF[v]} V
                    </button>
                  ))}
                </div>
              )}
              {running && res && res.comp[selComp.id] && formulaLines(selComp, res.comp[selComp.id], light).length > 0 && (
                <div style={{ margin: '7px 0', background: '#faf6ea', border: '1px solid #eadfc4', borderRadius: 9, padding: '7px 9px' }}>
                  {formulaLines(selComp, res.comp[selComp.id], light).map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1.5px 0' }}>
                      <span style={{ color: MUT, fontSize: 10.5 }}>{l.eq}</span>
                      <span style={{ fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.sub}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button style={chip(false, { padding: '4px 10px' })} onClick={rotateSel}>⟳ Rotate</button>
                {wires.some((w) => w.a.comp === selComp.id || w.b.comp === selComp.id) && (
                  <button style={chip(false, { padding: '4px 10px' })}
                    onClick={() => { pushHist(); setWires((ws) => ws.filter((w) => w.a.comp !== selComp.id && w.b.comp !== selComp.id)); }}>
                    ✂ Disconnect
                  </button>
                )}
                {selComp.type === 'led' && devRef.current[selComp.id] && devRef.current[selComp.id].blown && (
                  <button style={chip(false, { padding: '4px 10px', borderColor: AMBER, background: '#fdf3df' })}
                    onClick={() => { devRef.current[selComp.id] = { vPrev: 0, on: false, mode: 'off', hot: 0, blown: false }; }}>
                    Replace LED
                  </button>
                )}
                <button style={chip(false, { padding: '4px 10px', color: REDC, borderColor: '#e5c3bb' })} onClick={deleteSel}>Delete</button>
              </div>
              <details style={{ marginTop: 9, fontSize: 11.5, color: '#5a5548' }}>
                <summary style={{ cursor: 'pointer', color: MUT }}>📋 datasheet</summary>
                <div style={{ marginTop: 5, lineHeight: 1.55 }}>{DATASHEET[selComp.type]}</div>
              </details>
            </div>
          ) : sel ? (
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>Wire</span>
              {running && res && <span style={{ color: MUT, fontSize: 11.5 }}>{fmtI(Math.abs(res.wire[sel.id] || 0))} through it</span>}
              <span style={{ color: MUT, fontSize: 11 }}>drag it to reroute</span>
              {wires.some((w) => w.id === sel.id && w.mid) && (
                <button style={chip(false, { padding: '4px 10px' })}
                  onClick={() => { pushHist(); setWires((ws) => ws.map((w) => (w.id === sel.id ? { ...w, mid: undefined } : w))); }}>
                  ↔ Straighten
                </button>
              )}
              <button style={chip(false, { padding: '4px 10px', color: REDC, borderColor: '#e5c3bb' })} onClick={deleteSel}>Delete</button>
            </div>
          ) : (
            <div style={{ color: MUT, marginTop: 4, lineHeight: 1.5 }}>tap a part on the board — its live numbers, the law behind them, and its datasheet appear here</div>
          )}
        </div>
        </div>

        {!narrow && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: '#a29a86', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' }}>
          drop parts onto wires to splice · hollow dots = unconnected · long-press for options · drag board to pan · scroll to zoom · LEDs past ~30 mA really blow · autosaves
        </div>
        )}
      </div>
    </div>
  );
}
