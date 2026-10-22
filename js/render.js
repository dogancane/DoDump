/* ==========================================================================
 * render.js
 * Canvas visualisation of the section plane: walls, particles, critical
 * features, solid-fraction strip, bridge highlight. Zoom (wheel / pinch),
 * pan (drag) and view rotation. Reads engine and detector state only.
 * ========================================================================== */
(function (FP) {
  'use strict';
  // shape-class colours (Okabe-Ito, colour-blind safe): equant, prolate, oblate, bladed, rounded, ellipsoid (L/T model)
  const WATER = '#2a8bd6';
  const CLASS_COL = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#8a8f98'];


  // Perceptually ordered sequential map (dark blue -> teal -> yellow), readable on both themes
  const CMAP = [[0.00, [43, 52, 120]], [0.25, [38, 104, 160]], [0.50, [33, 154, 140]], [0.75, [150, 196, 70]], [1.00, [250, 220, 60]]];
  function cmap(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < CMAP.length - 1; i++) {
      const a = CMAP[i], b = CMAP[i + 1];
      if (t <= b[0]) {
        const u = (t - a[0]) / (b[0] - a[0]);
        return 'rgb(' + Math.round(a[1][0] + u * (b[1][0] - a[1][0])) + ',' + Math.round(a[1][1] + u * (b[1][1] - a[1][1])) + ',' + Math.round(a[1][2] + u * (b[1][2] - a[1][2])) + ')';
      }
    }
    return 'rgb(250,220,60)';
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function Renderer(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.scale = 60; this.cx = 0; this.cy = -3; this.rot = 0;
    this.opts = { colorBy: 'size', wallAlpha: 0.35, showStrip: true, showFeatures: true, showVectors: false, showContacts: false, showSpheres: false };
    this.geom = null; this.colors = {};
    this.refreshColors();
    this.bindInput();
  }

  Renderer.prototype.refreshColors = function () {
    this.colors = {
      bg: css('--canvas-bg'), wall: css('--wall'), wallLine: css('--wall-line'), ink: css('--ink'), muted: css('--muted'),
      grid: css('--grid'), red: css('--st-red'), orange: css('--st-orange'), yellow: css('--st-yellow'), accent: css('--accent'),
      partEdge: css('--part-edge')
    };
  };

  Renderer.prototype.setGeometry = function (geom, fit) { this.geom = geom; if (fit) this.fit(); };
  /** Colour scale ranges from the stone sample: Dn [m] (log) and L [m]. */
  Renderer.prototype.setRanges = function (fac) {
    const sm = fac.stats.sample;
    const dn = sm.map(s => s.Dn), L = sm.map(s => s.L);
    this.sizeRange = [Math.min.apply(null, dn), Math.max.apply(null, dn)];
    this.lenRange = [Math.min.apply(null, L), Math.max.apply(null, L)];
  };

  Renderer.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = dpr;
  };

  Renderer.prototype.fit = function () {
    if (!this.geom) return;
    this.resize();
    const b = this.geom.bbox;
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    // rotated bbox extents
    const pts = [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]].map(p => [c * p[0] - s * p[1], s * p[0] + c * p[1]]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const bw = Math.max.apply(null, xs) - Math.min.apply(null, xs), bh = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    const pad = Math.min(170, W * 0.32); // room for feature labels on the right
    this.scale = Math.min((W - 30 - pad) / bw, (H - 30) / bh);
    const mx = (b.xmin + b.xmax) / 2, my = (b.ymin + b.ymax) / 2;
    // shift the view so the drawing sits left of centre by pad/2 (screen space, rotated back to world)
    const sh = (pad / 2) / this.scale, ci = Math.cos(-this.rot), si = Math.sin(-this.rot);
    this.cx = mx + ci * sh; this.cy = my + si * sh;
  };

  Renderer.prototype.zoomTo = function (x, y, halfSpan) {
    this.resize();
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    this.scale = Math.min(W, H) / (2 * halfSpan); this.cx = x; this.cy = y;
  };

  /** world -> screen (CSS px) */
  Renderer.prototype.toScreen = function (x, y) {
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    const dx = x - this.cx, dy = y - this.cy;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const rx = c * dx - s * dy, ry = s * dx + c * dy;
    return [W / 2 + rx * this.scale, H / 2 - ry * this.scale];
  };
  Renderer.prototype.toWorld = function (px, py) {
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    const rx = (px - W / 2) / this.scale, ry = -(py - H / 2) / this.scale;
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
    return [this.cx + c * rx - s * ry, this.cy + s * rx + c * ry];
  };

  Renderer.prototype.bindInput = function () {
    const cv = this.cv;
    const pts = new Map(); let lastDist = 0;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const before = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.scale *= Math.exp(-e.deltaY * 0.0015);
      this.scale = Math.max(2, Math.min(20000, this.scale));
      const after = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.cx += before[0] - after[0]; this.cy += before[1] - after[1];
      this.requestDraw && this.requestDraw();
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const v = [...pts.values()]; lastDist = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); } });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        const a = this.toWorld(prev[0], prev[1]), b = this.toWorld(e.clientX, e.clientY);
        this.cx -= b[0] - a[0]; this.cy -= b[1] - a[1];
      } else if (pts.size === 2) {
        const v = [...pts.values()];
        const d = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]);
        if (lastDist > 0) this.scale = Math.max(2, Math.min(20000, this.scale * d / lastDist));
        lastDist = d;
      }
      this.requestDraw && this.requestDraw();
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) lastDist = 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  };

  Renderer.prototype.draw = function (eng, det, dv, cfg) {
    const ctx = this.ctx, g = this.geom, C = this.colors, O = this.opts;
    this.resize();
    const dpr = this.dpr, W = this.cv.width / dpr, H = this.cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (!g) return;
    // world transform
    const sc = this.scale;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(sc, -sc); ctx.rotate(this.rot); ctx.translate(-this.cx, -this.cy);
    const px = 1 / sc; // one CSS pixel in metres

    // axial ticks along the axis
    const A = g.axis;
    ctx.lineWidth = px; ctx.strokeStyle = C.grid;
    const step = niceStep(80 / sc);
    for (let s = 0; s <= g.L + 1e-9; s += step) {
      const wv = g.widthAt(s) / 2 + 0.06;
      const p1 = g.toWorld(s, -wv - 0.25), p2 = g.toWorld(s, -wv - 0.08);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }

    // solid fraction strip beside side B
    if (O.showStrip && det) {
      for (let j = 0; j < det.nb; j++) {
        const s0 = det.s0 + j * det.binLen, s1 = s0 + det.binLen;
        const phi = det.binPhi[j];
        if (phi <= 0.005) continue;
        const off = g.widthAt(Math.max(0, (s0 + s1) / 2)) / 2 + 0.12;
        const a = g.toWorld(s0, off), b = g.toWorld(s1, off), c2 = g.toWorld(s1, off + 0.12), d = g.toWorld(s0, off + 0.12);
        ctx.fillStyle = cmap(Math.min(1, phi / 0.85));
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        if (det.stalledBins.indexOf(j) >= 0) { ctx.strokeStyle = C.yellow; ctx.lineWidth = 2 * px; ctx.stroke(); }
      }
    }

    // features: overlap bands and openings
    if (O.showFeatures) {
      g.features.forEach(f => {
        if (f.kind === 'overlap') {
          const w1 = g.widthAt(f.s) / 2 + 0.03;
          const a = g.toWorld(f.s, -w1 - 0.35), b = g.toWorld(f.s2, -w1 - 0.35), c2 = g.toWorld(f.s2, -w1 - 0.28), d = g.toWorld(f.s, -w1 - 0.28);
          ctx.fillStyle = C.accent; ctx.globalAlpha = 0.5;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        } else if (f.kind === 'opening') {
          const w1 = f.width / 2;
          const a = g.toWorld(f.s, -w1), b = g.toWorld(f.s, w1);
          ctx.setLineDash([4 * px, 4 * px]); ctx.strokeStyle = C.muted; ctx.lineWidth = px;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
        }
      });
    }

    // water surfaces: outside level in the moonpool and the free surface inside the pipe
    if (eng && eng.water && eng.water.freeSurface) {
      const WT = eng.water, s0g = g.s0Global || 0;
      const lines = [[WT.sW - s0g, [6 * px, 4 * px]]];
      if (WT.on && Math.abs(WT.surfS - WT.sW) > 0.02) lines.push([WT.surfS - s0g, []]);
      lines.forEach(([sl, dash]) => {
        if (sl < -g.feedLen || sl > g.L) return;
        const w1 = g.widthAt(Math.max(0, sl)) / 2 + (dash.length ? 0.6 : 0);
        const a = g.toWorld(sl, -w1), b = g.toWorld(sl, w1);
        ctx.setLineDash(dash); ctx.strokeStyle = WATER; ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      });
    }

    // walls
    g.polys.forEach(pl => {
      ctx.beginPath();
      pl.pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.globalAlpha = pl.feed ? O.wallAlpha * 0.6 : O.wallAlpha;
      ctx.fillStyle = C.wall; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.2 * px; ctx.strokeStyle = C.wallLine; ctx.stroke();
    });

    // water flow arrows along side A of the window (length proportional to velocity)
    if (eng && eng.water && eng.water.on) {
      const Wt = eng.water, step2 = Math.max(0.5, niceStep(90 / sc));
      ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent; ctx.lineWidth = 1.5 * px;
      for (let sA = -g.feedLen + step2 / 2; sA < g.L; sA += step2) {
        const u = Wt.uf[Wt.bin(sA)];
        if (Math.abs(u) < 0.02) continue;
        const len = Math.max(-0.8, Math.min(0.8, u * 0.25)) * Math.min(1, step2);
        const n = -(g.widthAt(Math.max(0, sA)) / 2) + 0.12;
        const a1 = g.toWorld(sA - len / 2, n), a2 = g.toWorld(sA + len / 2, n);
        ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();
        const ax = g.axis, dir = len > 0 ? 1 : -1, hs = 0.05;
        const h1 = [a2[0] - dir * hs * ax.ux + hs * 0.6 * ax.wx, a2[1] - dir * hs * ax.uy + hs * 0.6 * ax.wy];
        const h2 = [a2[0] - dir * hs * ax.ux - hs * 0.6 * ax.wx, a2[1] - dir * hs * ax.uy - hs * 0.6 * ax.wy];
        ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(h1[0], h1[1]); ctx.lineTo(h2[0], h2[1]); ctx.closePath(); ctx.fill();
      }
    }

    // bridge band
    const arch = det && det.arch;
    if (arch) {
      const w1 = arch.width / 2 + 0.1;
      const band = Math.max(det.dMaxGrade || 0.3, 0.05);
      const a = g.toWorld(arch.s - band, -w1), b = g.toWorld(arch.s - band, w1), c2 = g.toWorld(arch.s + 0.3 * band, w1), d = g.toWorld(arch.s + 0.3 * band, -w1);
      ctx.fillStyle = det.level >= 3 ? C.red : C.orange; ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // particles
    if (eng) {
      const rng = this.sizeRange || [0.1, 0.5];
      const dLo = rng[0], dHi = rng[1];
      const LR = this.lenRange || [0.1, 1];
      const vHi = dv && isFinite(dv.vTermMax) ? Math.max(0.5, dv.vTermMax * 1.3) : 6;
      const archSet = arch ? new Set(arch.members) : null;
      const showSlow = O.colorBy === 'state';
      const vSt = cfg.detect.vStall;
      for (let k = 0; k < eng.nActive; k++) {
        const b = eng.active[k];
        if (!eng.alive[b]) continue;
        let col;
        const sp = Math.hypot(eng.vx[b], eng.vy[b]);
        if (O.colorBy === 'velocity') col = cmap(sp / vHi);
        else if (showSlow) col = sp < vSt ? C.orange : C.muted;
        else if (O.colorBy === 'class') col = CLASS_COL[eng.cls ? eng.cls[b] : 5];
        else if (O.colorBy === 'length') col = cmap(LR[1] > LR[0] ? (eng.L[b] - LR[0]) / (LR[1] - LR[0]) : 0.5);
        else col = cmap(dHi > dLo ? (Math.log(eng.d[b]) - Math.log(dLo)) / (Math.log(dHi) - Math.log(dLo)) : 0.5);
        const c = Math.cos(eng.th[b]), s = Math.sin(eng.th[b]);
        const s0 = b * FP.physics.MAXS, s1 = s0 + eng.subCount[b];
        ctx.beginPath();
        if (!O.showSpheres && s1 - s0 > 1) {
          // stone outline = convex hull of the contact spheres (cached per slot, body frame)
          const hp = this.hullOf(eng, b, s0, s1);
          for (let i = 0; i < hp.length; i += 2) {
            const x = eng.x[b] + c * hp[i] - s * hp[i + 1], y = eng.y[b] + s * hp[i] + c * hp[i + 1];
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.closePath();
        } else for (let q = s0; q < s1; q++) {
          const x = eng.x[b] + c * eng.sox[q] - s * eng.soy[q], y = eng.y[b] + s * eng.sox[q] + c * eng.soy[q];
          ctx.moveTo(x + eng.sr[q], y);
          ctx.arc(x, y, eng.sr[q], 0, Math.PI * 2);
        }
        // outline of the union: stroke all circles at double width, then fill over
        // the interior so only the outer edge of the clump remains visible
        if (archSet && archSet.has(b)) { ctx.lineWidth = 5 * px; ctx.strokeStyle = det.level >= 3 ? C.red : C.orange; ctx.stroke(); }
        else if (sc * eng.d[b] > 6) { ctx.lineWidth = 1.6 * px; ctx.strokeStyle = C.partEdge; ctx.stroke(); }
        ctx.fillStyle = col;
        ctx.fill();
        // orientation tick so rotation is visible
        if (sc * eng.d[b] > 14) {
          const r = eng.d[b] * 0.35;
          ctx.beginPath(); ctx.moveTo(eng.x[b], eng.y[b]); ctx.lineTo(eng.x[b] + c * r, eng.y[b] + s * r);
          ctx.lineWidth = px; ctx.strokeStyle = C.partEdge; ctx.stroke();
        }
        if (O.showVectors) {
          const f = 0.15;
          ctx.beginPath(); ctx.moveTo(eng.x[b], eng.y[b]); ctx.lineTo(eng.x[b] + eng.vx[b] * f, eng.y[b] + eng.vy[b] * f);
          ctx.lineWidth = px; ctx.strokeStyle = C.ink; ctx.stroke();
        }
      }
      if (O.showContacts) {
        // force chains: line width proportional to normal force
        let fMax = 0; for (let c = 0; c < eng.cN; c++) fMax = Math.max(fMax, eng.cF[c]);
        if (fMax > 0) {
          ctx.strokeStyle = C.ink;
          for (let c = 0; c < eng.cN; c++) {
            const a = eng.cA[c], b = eng.cB[c];
            const wdt = (0.5 + 4 * eng.cF[c] / fMax) * px;
            ctx.lineWidth = wdt;
            ctx.beginPath(); ctx.moveTo(eng.x[a], eng.y[a]); ctx.lineTo(eng.x[b], eng.y[b]); ctx.stroke();
          }
        }
      }
    }
    ctx.restore();

    // screen-space labels
    ctx.font = '11px ' + css('--font-mono');
    ctx.fillStyle = C.muted; ctx.textBaseline = 'middle';
    for (let s = 0; s <= g.L + 1e-9; s += step) {
      const wv = g.widthAt(s) / 2 + 0.06;
      const p = this.toScreen.apply(this, g.toWorld(s, -wv - 0.3));
      ctx.textAlign = 'right';
      ctx.fillText((g.s0Global ? 'z ' : 's ') + (s + (g.s0Global || 0)).toFixed(step < 1 ? 1 : 0), p[0] - 2, p[1]);
    }
    if (O.showFeatures && sc > 25) {
      ctx.textAlign = 'left';
      g.features.forEach(f => {
        if (f.kind !== 'opening' && f.kind !== 'overlap') return;
        const w1 = (f.width || g.widthAt(f.s)) / 2;
        const p = this.toScreen.apply(this, g.toWorld(f.kind === 'overlap' ? (f.s + f.s2) / 2 : f.s, w1 + 0.3));
        ctx.fillText(f.kind === 'overlap' ? f.label : f.label + ' ' + (f.width * 1000).toFixed(0) + ' mm', p[0] + 4, p[1]);
      });
    }
    // pipe tilt: gravity direction in the pipe frame at each bucket (the DEM pipe is drawn straight)
    if (g.shape && g.shape.active && g.buckets) {
      ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = 1.5; ctx.textAlign = 'left';
      g.buckets.forEach(bk => {
        const sm = (bk.sTop + bk.sBot) / 2, th = g.shape.thetaAt(sm + (g.s0Global || 0));
        const w0 = g.toWorld(sm, -(g.widthAt(sm) / 2 + 1.7));
        const p1 = this.toScreen(w0[0], w0[1]), p2 = this.toScreen(w0[0] - 0.7 * Math.sin(th), w0[1] - 0.7 * Math.cos(th));
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        const a = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        ctx.beginPath(); ctx.moveTo(p2[0], p2[1]); ctx.lineTo(p2[0] - 7 * Math.cos(a - 0.4), p2[1] - 7 * Math.sin(a - 0.4)); ctx.lineTo(p2[0] - 7 * Math.cos(a + 0.4), p2[1] - 7 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
        ctx.fillText('g ' + (th * 180 / Math.PI).toFixed(1) + '\u00b0', p1[0] + 4, p1[1] - 6);
      });
      ctx.fillStyle = C.muted;
    }
    if (eng && eng.water && eng.water.freeSurface) {
      const WT = eng.water, s0g = g.s0Global || 0;
      ctx.textAlign = 'left'; ctx.fillStyle = WATER;
      const lab = (sl, t) => { if (sl < -g.feedLen || sl > g.L) return; const p = this.toScreen.apply(this, g.toWorld(sl, g.widthAt(Math.max(0, sl)) / 2 + 0.65)); ctx.fillText(t, p[0] + 4, p[1]); };
      lab(WT.sW - s0g, 'Water level (moonpool)');
      if (WT.on && Math.abs(WT.surfS - WT.sW) > 0.02) lab(WT.surfS - s0g, 'Water level in pipe (' + (WT.z >= 0 ? '-' : '+') + Math.abs(WT.z).toFixed(2) + ' m)');
      ctx.fillStyle = C.muted;
    }
    if (arch) {
      const p = this.toScreen.apply(this, g.toWorld(arch.s, -arch.width / 2 - 0.15));
      ctx.textAlign = 'right'; ctx.font = '600 12px ' + css('--font-mono');
      ctx.fillStyle = det.level >= 3 ? C.red : C.orange;
      const lbl = (arch.type === 'single' ? 'OBSTRUCTION' : 'BRIDGE') + ' at ' + (arch.sGlobal != null ? arch.sGlobal : arch.s).toFixed(2) + ' m';
      const tw = ctx.measureText(lbl).width;
      ctx.textAlign = 'left';
      ctx.fillText(lbl, Math.max(6, Math.min(W - tw - 6, p[0] - 6 - tw)), Math.max(14, Math.min(H - 40, p[1])));
    }
    // scale bar
    const barM = niceStep(120 / sc);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.textAlign = 'left'; ctx.font = '11px ' + css('--font-mono'); ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.moveTo(14, H - 16); ctx.lineTo(14 + barM * sc, H - 16); ctx.stroke();
    ctx.fillText(barM >= 1 ? barM + ' m' : (barM * 1000).toFixed(0) + ' mm', 14, H - 28);
    void A;
  };

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  /** Convex hull (body frame) of a stone's contact spheres; cached until the slot is reused. */
  Renderer.prototype.hullOf = function (eng, b, s0, s1) {
    this._hull = this._hull || new Map();
    const key = eng.d[b] + ':' + eng.sox[s0] + ':' + eng.sr[s0];
    const h = this._hull.get(b);
    if (h && h.key === key) return h.pts;
    const P = [], n = 16;
    for (let q = s0; q < s1; q++) for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; P.push([eng.sox[q] + eng.sr[q] * Math.cos(a), eng.soy[q] + eng.sr[q] * Math.sin(a)]); }
    P.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    const cr = (o, a2, b2) => (a2[0] - o[0]) * (b2[1] - o[1]) - (a2[1] - o[1]) * (b2[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const hull = lo.slice(0, -1).concat(up.slice(0, -1)), pts = new Float32Array(hull.length * 2);
    hull.forEach((p, i) => { pts[2 * i] = p[0]; pts[2 * i + 1] = p[1]; });
    this._hull.set(b, { key, pts });
    return pts;
  };

  FP.render = { CLASS_COL, Renderer, cmap };
})(self.FP = self.FP || {});
