/* ==========================================================================
 * physics.js
 * Quasi-2D soft-particle Discrete Element Method (DEM) engine.
 *
 * MODEL LEVEL: simplified engineering model (level 2 of 3).
 *   - Rigid stones (circle clumps) moving in the vertical plane through the
 *     pipe axis: 2 translations + 1 rotation. Masses are the sampled 3D
 *     stone masses; inertia from the projected ellipse.
 *   - Contacts (stone-stone and stone-wall), Cundall & Strack (1979) type:
 *       normal:     linear spring-dashpot, Fn = k*delta + c*vn, Fn >= 0,
 *                   c from the restitution coefficient e (Schaefer et al. 1996)
 *       tangential: incremental spring with Coulomb limit |Ft| <= mu*Fn
 *                   (static friction is retained, needed for stable arches)
 *       rolling:    constant directional torque Mr = muR * Reff * Fn
 *                   (one of the model families reviewed by Ai et al. 2011)
 *       stiffness:  k = kn * Reff / Reff50 (Reff from stone radii Dn/2); walls multiplied by the material
 *                   ratio E*(rock-wall)/E*(rock-rock) when enabled
 *   - Water (water.js): buoyancy; quadratic drag on the slip velocity relative
 *     to the entrained water flow, with the Di Felice voidage correction;
 *     pressure-gradient force; added mass. The drag reaction drives the
 *     1D water column along the whole string. Former still-water option:
 *     area. No fluid flow is solved (no entrained water, no pressure field).
 *   - Integration: semi-implicit (symplectic) Euler, fixed time step.
 *
 * CONTINUOUS MASS-CONTROLLED FEED
 *   Stones are released whenever the released mass is below Q_slice * t.
 *   Bodies that leave the domain return their slot to a free list after a
 *   two-step quarantine (so no stale friction history is reused).
 *   Capacity is fixed per run; if it is full the feed waits and this is
 *   counted (capacityWait) and reported.
 *
 * The engine knows nothing about blockage or drawing. It exposes typed
 * arrays that the detector and renderer read.
 * ========================================================================== */
(function (FP) {
  'use strict';

  const MAXS = 8; // sub-circles per body slot

  function gammaFromE(e) {
    e = Math.min(Math.max(e, 1e-4), 1);
    if (e >= 1) return 0;
    const l = Math.log(e);
    return -l / Math.sqrt(Math.PI * Math.PI + l * l);
  }

  function Engine(cfg, geom, fac, dv, seed) {
    this.cfg = cfg; this.geom = geom; this.fac = fac; this.dv = dv;
    this.rng = FP.particles.rng(seed == null ? cfg.run.seed : seed);
    this.seedUsed = seed == null ? cfg.run.seed : seed;
    const N = this.cap = dv.cap;
    this.N = N;
    const SC = this.subCap = N * MAXS;
    const F = (n) => new Float64Array(n);

    // Bodies
    this.x = F(N); this.y = F(N); this.vx = F(N); this.vy = F(N); this.th = F(N); this.w = F(N);
    this.m = F(N); this.invM = F(N); this.invI = F(N);
    this.d = F(N); this.rn = F(N); this.L = F(N); this.Bd = F(N); this.Td = F(N); this.br = F(N); this.aPlane = F(N); this.aDrag = F(N);
    this.fx = F(N); this.fy = F(N); this.tq = F(N); this.troll = F(N);
    this.tSpawn = F(N); this.tEnter = F(N); this.tExit = F(N);
    this.alive = new Uint8Array(N); this.entered = new Uint8Array(N); this.exited = new Uint8Array(N);
    this.wallMask = new Uint8Array(N); this.cls = new Uint8Array(N); this.wet = new Uint8Array(N);
    this.subCount = new Uint8Array(N);
    this.serial = new Int32Array(N); this.nextSerial = 1;
    this.active = new Int32Array(N); this.nActive = 0; this.dirty = false;
    this.free = []; for (let b = N - 1; b >= 0; b--) this.free.push(b);
    this.quarantine = [];

    // Sub-circles (fixed MAXS slots per body)
    this.sox = F(SC); this.soy = F(SC); this.sr = F(SC); this.sx = F(SC); this.sy = F(SC);
    this.sb = new Int32Array(SC); this.cellOf = new Int32Array(SC); this.next = new Int32Array(SC);
    for (let q = 0; q < SC; q++) this.sb[q] = (q / MAXS) | 0;

    // Contact record (body pairs) for the detector
    this.cCap = N * 24;
    this.cA = new Int32Array(this.cCap); this.cB = new Int32Array(this.cCap); this.cF = F(this.cCap);
    this.cN = 0;

    // Parameters
    const P = cfg.physics;
    this.dt = dv.dt; this.kn = dv.kn; this.kt = dv.kt;
    const gpp = gammaFromE(P.ePP);
    this.cnPP = 2 * gpp * Math.sqrt(this.kn); this.ctPP = 2 * gpp * Math.sqrt(this.kt);
    this.muPP = P.muPP; this.mrPP = P.muRollPP;
    this.gEff = P.g * dv.buoy;
    this.dragK = P.fluid ? 0.5 * P.rhoF * P.cd : 0;
    // dry part in the moonpool: full gravity, air drag (rho_air 1.2 kg/m3), no added mass
    this.gAir = P.g; this.dragKair = P.fluid ? 0.5 * 1.2 * P.cd : 0;

    // Walls with per-segment material contact properties
    const S = geom.segments, NS = this.nSeg = S.length;
    this.wx1 = F(NS); this.wy1 = F(NS); this.wex = F(NS); this.wey = F(NS); this.wl2 = F(NS);
    this.wGate = new Uint8Array(NS); this.gateOpen = !cfg.feed.prefill; this.settleTime = cfg.feed.prefill ? (cfg.feed.settle || 3) : 0;
    this.wside = new Uint8Array(NS); this.wMu = F(NS); this.wCn = F(NS); this.wCt = F(NS); this.wK = F(NS); this.wMr = F(NS);
    S.forEach((s, k) => {
      this.wx1[k] = s.x1; this.wy1[k] = s.y1; this.wex[k] = s.x2 - s.x1; this.wey[k] = s.y2 - s.y1;
      this.wl2[k] = this.wex[k] * this.wex[k] + this.wey[k] * this.wey[k];
      this.wside[k] = s.side; this.wGate[k] = s.tag === 'gate' ? 1 : 0;
      const wp = dv.wallProps[s.mat] || { mu: P.muPW, e: P.ePW, muRoll: P.muRollPW, kRatio: 1 };
      const gw = gammaFromE(wp.e);
      this.wMu[k] = wp.mu; this.wK[k] = wp.kRatio; this.wMr[k] = wp.muRoll;
      this.wCn[k] = 2 * gw * Math.sqrt(this.kn); this.wCt[k] = 2 * gw * Math.sqrt(this.kt);
    });

    // Uniform grid for neighbour search
    const bb = geom.bbox;
    this.h = Math.max(2 * fac.maxSubR * 1.02, 0.02);
    this.gx0 = bb.xmin; this.gy0 = bb.ymin;
    this.nx = Math.max(1, Math.ceil((bb.xmax - bb.xmin) / this.h));
    this.ny = Math.max(1, Math.ceil((bb.ymax - bb.ymin) / this.h));
    this.head = new Int32Array(this.nx * this.ny);
    const cs = new Array(this.nx * this.ny);
    for (let c = 0; c < cs.length; c++) cs[c] = [];
    S.forEach((s, k) => {
      const x0 = Math.min(s.x1, s.x2) - this.h, x1 = Math.max(s.x1, s.x2) + this.h;
      const y0 = Math.min(s.y1, s.y2) - this.h, y1 = Math.max(s.y1, s.y2) + this.h;
      const i0 = Math.max(0, Math.floor((x0 - this.gx0) / this.h)), i1 = Math.min(this.nx - 1, Math.floor((x1 - this.gx0) / this.h));
      const j0 = Math.max(0, Math.floor((y0 - this.gy0) / this.h)), j1 = Math.min(this.ny - 1, Math.floor((y1 - this.gy0) / this.h));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = this.gx0 + (i + 0.5) * this.h, cy = this.gy0 + (j + 0.5) * this.h;
        const ex = s.x2 - s.x1, ey = s.y2 - s.y1, l2 = ex * ex + ey * ey;
        let t = l2 > 0 ? ((cx - s.x1) * ex + (cy - s.y1) * ey) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = s.x1 + t * ex - cx, qy = s.y1 + t * ey - cy;
        if (qx * qx + qy * qy <= 2.5 * this.h * this.h) cs[j * this.nx + i].push(k);
      }
    });
    this.cellSegs = cs.map(a => Int32Array.from(a));

    // Tangential spring history: slots per sub-circle (partner id, value), double-buffered.
    this.K = 12;
    this.hIdO = new Int32Array(SC * this.K); this.hValO = F(SC * this.K); this.hCntO = new Uint8Array(SC);
    this.hIdN = new Int32Array(SC * this.K); this.hValN = F(SC * this.K); this.hCntN = new Uint8Array(SC);
    this.histOverflow = 0;

    // Feed
    this.pending = null; this.feedBlocked = false; this.feedBlockedTime = 0; this.capacityWait = 0;
    const W = geom.inletWidth;
    this.feedHalf = Math.min(cfg.feed.opening / 1000, W) / 2;
    this.feedOffset = cfg.feed.offset / 1000;
    this.maxStones = cfg.feed.maxStones > 0 ? cfg.feed.maxStones : Infinity;
    this.massRate = dv.massRateSlice;
    this.feedZone = cfg.feed.fillZone != null ? cfg.feed.fillZone : 0.7; // upper share of the chute used for release
    this.hopper = cfg.feed.mode === 'hopper';      // keep the feed zone full (gravity-fed hopper, choke flow)
    this.prefillPending = !!cfg.feed.prefill;      // restart with the window full of rock

    // Water in the pipe (entrained flow, hindered drag, pressure gradient, added mass)
    this.water = new FP.water.Water(cfg, geom, dv);
    this.waterDt = cfg.detect.sampleDt; this.nextWater = 0;
    this.Ca = this.water.Ca; this.rhoRatio = P.fluid ? P.rhoF / cfg.grade.rho : 0;
    // Pipe tilt (bucket string shape): the DEM pipe stays straight and gravity is rotated by the
    // local link angle theta(s): g_pipe = (-g sin theta, -g cos theta). Curvature terms v^2/R are
    // neglected (R of hundreds of metres for angles of a few degrees per joint).
    {
      const WT0 = this.water, nb = WT0.nb, sh = geom.shape && geom.shape.active ? geom.shape : null;
      this.tSin = new Float64Array(nb); this.tCos = new Float64Array(nb).fill(1);
      if (sh) for (let j = 0; j < nb; j++) {
        const th = sh.thetaAt(Math.max(0, WT0.s0w + (j + 0.5) * WT0.h + (geom.s0Global || 0)));
        this.tSin[j] = Math.sin(th); this.tCos[j] = Math.cos(th);
      }
    }
    this.rhoS = cfg.grade.rho;

    // Counters and diagnostics
    this.t = 0; this.steps = 0;
    this.spawned = 0; this.spawnedMass = 0; this.feedMass = 0; this.cappedStones = 0;
    this.inCount = 0; this.inMass = 0; this.outCount = 0; this.outMass = 0;
    this.lostCount = 0; this.lostMass = 0; this.lostLog = [];
    this.resSum = 0; this.resMax = 0;
    this.maxOverlapStep = 0; this.maxOverlapRun = 0; this.overlapOver5 = 0; this.maxWallOverlapRun = 0; this.maxSubOverlapRun = 0;
    this.tLastOut = -1; this.tFirstOut = -1; this.tFirstIn = -1;
    this.contactOverflow = false; this.peakBodies = 0;
  }

  Engine.MAXS = MAXS;

  Engine.prototype.rebuildActive = function () {
    let n = 0;
    for (let b = 0; b < this.cap; b++) if (this.alive[b]) this.active[n++] = b;
    this.nActive = n; this.dirty = false;
  };

  Engine.prototype.feeding = function () {
    return this.spawned - (this.prefilled || 0) < this.maxStones;
  };

  /**
   * Restart case: fill the DEM window with stones at rest (pipe full of rock
   * after a stoppage). Random placement with the same shape-level overlap
   * test, until 400 consecutive attempts fail.
   */
  Engine.prototype.prefill = function () {
    const g = this.geom, A = g.axis;
    let fails = 0, placed = 0;
    while (fails < 400 && this.free.length) {
      const p = this.fac.make(this.rng);
      const s0 = p.br + this.rng() * Math.max(0, g.L - 2 * p.br);
      const w2 = g.widthAt(s0) / 2;
      const th = this.rng() * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      let eN = 0; for (const q of p.subs) { const wx = c * q[0] - sn * q[1], wy = sn * q[0] + c * q[1]; eN = Math.max(eN, Math.abs(wx * A.wx + wy * A.wy) + q[2]); }
      if (eN > w2 * 0.97) { fails++; continue; }
      const n0 = (this.rng() * 2 - 1) * (w2 - eN);
      const pos = g.toWorld(s0, n0);
      if (!this.fits(p, pos, th)) { fails++; continue; }
      this.addBody(p, pos[0], pos[1], th, 0);
      const nb = this.active[this.nActive - 1];
      this.feedMass -= p.m;                           // pre-filled stones are not part of the feed
      this.entered[nb] = 1; this.tEnter[nb] = 0; this.inCount++; this.inMass += p.m;
      this.prefilled = (this.prefilled || 0) + 1; this.prefillMass = (this.prefillMass || 0) + p.m;
      fails = 0; placed++;
    }
    return placed;
  };

  /** Shape-level overlap test of a new stone against present stones and walls. */
  Engine.prototype.fits = function (p, pos, th) {
    const c = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < this.nActive; k++) {
      const b = this.active[k];
      const dx = this.x[b] - pos[0], dy = this.y[b] - pos[1], R = this.br[b] + p.br;
      if (dx * dx + dy * dy >= R * R) continue;
      const cb = Math.cos(this.th[b]), sb = Math.sin(this.th[b]), o = b * MAXS;
      for (const q of p.subs) {
        const qx = pos[0] + c * q[0] - sn * q[1], qy = pos[1] + sn * q[0] + c * q[1];
        for (let i = 0; i < this.subCount[b]; i++) {
          const bx = this.x[b] + cb * this.sox[o + i] - sb * this.soy[o + i], by = this.y[b] + sb * this.sox[o + i] + cb * this.soy[o + i];
          const rr = q[2] + this.sr[o + i];
          if ((qx - bx) * (qx - bx) + (qy - by) * (qy - by) < rr * rr) return false;
        }
      }
    }
    // walls (prefill places stones inside cones with lips and ledges)
    for (const q of p.subs) {
      const qx = pos[0] + c * q[0] - sn * q[1], qy = pos[1] + sn * q[0] + c * q[1];
      for (let k = 0; k < this.nSeg; k++) {
        const px = qx - this.wx1[k], py = qy - this.wy1[k];
        let tt = (px * this.wex[k] + py * this.wey[k]) / this.wl2[k]; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const ex = this.wx1[k] + tt * this.wex[k] - qx, ey = this.wy1[k] + tt * this.wey[k] - qy;
        if (ex * ex + ey * ey < q[2] * q[2]) return false;
      }
    }
    return true;
  };

  /**
   * Continuous feed. Stones are released anywhere in the upper part of the
   * feed chute (a hopper-like fill zone), at random lateral position and
   * orientation, with up to 40 placement attempts per time step. Overlap is
   * checked circle-by-circle against the stones already present, so long
   * stones can pack as densely as their shape allows. The released mass
   * follows Q_slice * t; if the chute is physically full the shortfall is
   * recorded (feed acceptance) and reported as an inlet choke.
   */
  Engine.prototype.spawn = function () {
    while (this.quarantine.length && this.quarantine[0][1] <= this.steps) this.free.push(this.quarantine.shift()[0]);
    if (!this.feeding()) { this.feedBlocked = false; return; }
    const target = this.hopper ? Infinity : this.massRate * (this.t + this.dt);
    let tries = 0, blocked = false;
    const g = this.geom, A = g.axis;
    const bandTop = -g.feedLen, bandLen = Math.max(0.05, this.feedZone * g.feedLen);
    while (this.feedMass < target && this.feeding() && tries < 40) {
      if (!this.free.length) { this.capacityWait++; blocked = true; break; }
      const p = this.pending || this.fac.make(this.rng);
      tries++;
      // orientation: random; if the stone cannot fit across the chute, align it with the axis
      const axisAng = Math.atan2(A.uy, A.ux);
      let th = this.rng() * Math.PI * 2;
      const ext = (ang) => { const c = Math.cos(ang), sn = Math.sin(ang); let e = 0; for (const q of p.subs) { const wx = c * q[0] - sn * q[1], wy = sn * q[0] + c * q[1]; e = Math.max(e, Math.abs(wx * A.wx + wy * A.wy) + q[2]); } return e; };
      const s0 = bandTop + p.br + this.rng() * Math.max(0, bandLen - 2 * p.br);
      const W2 = g.widthAt(s0) / 2;
      let eN = ext(th);
      if (eN > W2 * 0.98) { th = axisAng + (this.rng() < 0.5 ? 0 : Math.PI); eN = ext(th); }
      const lim = Math.max(0, Math.min(this.feedHalf * W2 / (g.inletWidth / 2), W2) - eN);
      const n0 = Math.max(-lim, Math.min(lim, this.feedOffset + (this.rng() * 2 - 1) * lim));
      const pos = g.toWorld(s0, n0);
      if (!this.fits(p, pos, th)) { this.pending = p; blocked = true; continue; }
      this.addBody(p, pos[0], pos[1], th);
      this.pending = null;
    }
    this.feedBlocked = blocked && (this.hopper || this.feedMass < target);
    if (this.feedBlocked) this.feedBlockedTime += this.dt;
  };

  Engine.prototype.addBody = function (p, x, y, th, vIn) {
    const b = this.free.pop();
    const A = this.geom.axis, v0 = vIn != null ? vIn : this.dv.v0;
    this.x[b] = x; this.y[b] = y; this.vx[b] = v0 * A.ux; this.vy[b] = v0 * A.uy;
    this.th[b] = th != null ? th : p.rot + (this.rng() < 0.5 ? 0 : Math.PI); this.w[b] = 0;
    this.m[b] = p.m; this.invM[b] = 1 / (p.m * (1 + this.Ca * this.rhoRatio)); this.invI[b] = 1 / p.I; // added mass on translation
    this.wet[b] = 2; // unknown: set on the first force evaluation
    this.cls[b] = Math.max(0, ['equant', 'prolate', 'oblate', 'bladed', 'rounded', 'ellipsoid'].indexOf(p.cls));
    this.d[b] = p.Dn; this.rn[b] = p.Dn / 2; this.L[b] = p.L; this.Bd[b] = p.B; this.Td[b] = p.T;
    this.br[b] = p.br; this.aPlane[b] = p.areaPlane; this.aDrag[b] = p.dragArea;
    this.tSpawn[b] = this.t; this.alive[b] = 1; this.entered[b] = 0; this.exited[b] = 0;
    this.serial[b] = this.nextSerial++;
    const n = Math.min(MAXS, p.subs.length), o = b * MAXS;
    this.subCount[b] = n;
    for (let i = 0; i < n; i++) {
      const s = p.subs[i];
      this.sox[o + i] = s[0]; this.soy[o + i] = s[1]; this.sr[o + i] = s[2];
      this.hCntO[o + i] = 0;
    }
    if (p.capped) this.cappedStones++;
    this.spawned++; this.spawnedMass += p.m; this.feedMass += p.m;
    this.active[this.nActive++] = b;
    if (this.nActive > this.peakBodies) this.peakBodies = this.nActive;
  };

  Engine.prototype.kill = function (b) {
    this.alive[b] = 0; this.dirty = true;
    this.quarantine.push([b, this.steps + 2]);
  };

  Engine.prototype.step = function () {
    const dt = this.dt;
    if (this.prefillPending) { this.prefillPending = false; this.prefill(); }
    if (!this.gateOpen && this.t >= this.settleTime) this.gateOpen = true;
    if (this.gateOpen) this.spawn();       // feed waits while a restart column settles on the gate
    if (this.dirty) this.rebuildActive();

    const x = this.x, y = this.y, vx = this.vx, vy = this.vy, th = this.th, w = this.w;
    const m = this.m, fx = this.fx, fy = this.fy, tq = this.tq, troll = this.troll;
    const sox = this.sox, soy = this.soy, sr = this.sr, sx = this.sx, sy = this.sy, sb = this.sb;
    const head = this.head, next = this.next, cellOf = this.cellOf, subCount = this.subCount;
    const nx = this.nx, ny = this.ny, inv = 1 / this.h, gx0 = this.gx0, gy0 = this.gy0;
    const act = this.active, nAct = this.nActive;
    const gEff = this.gEff, dragK = this.dragK;
    const WT = this.water, wUf = WT.uf, wHin = WT.hinder, wGP = WT.gradP, Ax = this.geom.axis, Lpipe = this.geom.L;
    let Jw = 0; // drag reaction on the water inside the window pipe, axial, this step [N]

    // 1. sub-circle world positions, grid, body forces
    head.fill(-1);
    for (let k = 0; k < nAct; k++) {
      const b = act[k];
      const c = Math.cos(th[b]), s = Math.sin(th[b]);
      const s0 = b * MAXS, s1 = s0 + subCount[b];
      for (let q = s0; q < s1; q++) {
        const px = x[b] + c * sox[q] - s * soy[q], py = y[b] + s * sox[q] + c * soy[q];
        sx[q] = px; sy[q] = py;
        const ci = Math.floor((px - gx0) * inv), cj = Math.floor((py - gy0) * inv);
        if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) { cellOf[q] = -1; continue; }
        const cell = cj * nx + ci;
        next[q] = head[cell]; head[cell] = q; cellOf[q] = cell;
      }
      // drag on the slip velocity relative to the local interstitial water velocity
      const sAx = (x[b] - Ax.ox) * Ax.ux + (y[b] - Ax.oy) * Ax.uy;
      const isWet = dragK > 0 && WT.wetAt(sAx) ? 1 : 0;
      const jt = WT.bin(sAx), tS = this.tSin[jt], tC = this.tCos[jt];
      if (isWet !== this.wet[b]) { this.wet[b] = isWet; this.invM[b] = 1 / (m[b] * (1 + (isWet ? this.Ca * this.rhoRatio : 0))); }
      if (isWet) {
        const jw = WT.bin(sAx), uw = wUf[jw];
        const rx = vx[b] - uw * Ax.ux, ry = vy[b] - uw * Ax.uy;
        const sp = Math.sqrt(rx * rx + ry * ry);
        const dk = dragK * this.aDrag[b] * sp * wHin[jw];
        // pressure-gradient force of the flowing water: -V dp'/ds along the axis
        const fpg = -(m[b] / this.rhoS) * wGP[jw];
        fx[b] = -dk * rx + fpg * Ax.ux - m[b] * gEff * tS;
        fy[b] = -m[b] * gEff * tC - dk * ry + fpg * Ax.uy;
        if (sAx >= 0 && sAx <= Lpipe) Jw += dk * (rx * Ax.ux + ry * Ax.uy);
      } else {
        // in air (moonpool dry part, or no fluid): full weight, air drag
        const sp = Math.sqrt(vx[b] * vx[b] + vy[b] * vy[b]);
        const dk = this.dragKair * this.aDrag[b] * sp;
        const gg = dragK > 0 ? this.gAir : gEff;
        fx[b] = -dk * vx[b] - m[b] * gg * tS;
        fy[b] = -m[b] * gg * tC - dk * vy[b];
      }
      tq[b] = 0; troll[b] = 0; this.wallMask[b] = 0;
    }

    const kn = this.kn, kt = this.kt, K = this.K, rn = this.rn;
    const kScaleInv = 4 / this.dv.d50;
    const hIdO = this.hIdO, hValO = this.hValO, hCntO = this.hCntO, hIdN = this.hIdN, hValN = this.hValN, hCntN = this.hCntN;
    const histGet = (a, id) => { const o = a * K, n = hCntO[a]; for (let z = 0; z < n; z++) if (hIdO[o + z] === id) return hValO[o + z]; return 0; };
    const histSet = (a, id, v) => { const n = hCntN[a]; if (n < K) { hIdN[a * K + n] = id; hValN[a * K + n] = v; hCntN[a] = n + 1; } else this.histOverflow++; };
    for (let k = 0; k < nAct; k++) { const b = act[k]; const s0 = b * MAXS, s1 = s0 + subCount[b]; for (let q = s0; q < s1; q++) hCntN[q] = 0; }
    let maxOv = 0, maxOvW = 0, maxOvSub = 0, cN = 0;
    const cA = this.cA, cB = this.cB, cF = this.cF, cCap = this.cCap;

    // 2. stone-stone contacts
    {
      const cn0 = this.cnPP, ct0 = this.ctPP, mu = this.muPP, mr = this.mrPP;
      for (let k = 0; k < nAct; k++) {
        const A = act[k];
        const s0 = A * MAXS, s1 = s0 + subCount[A];
        for (let a = s0; a < s1; a++) {
          const cell = cellOf[a];
          if (cell < 0) continue;
          const ci = cell % nx, cj = (cell - ci) / nx;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = cj + dj; if (jj < 0 || jj >= ny) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = ci + di; if (ii < 0 || ii >= nx) continue;
              for (let b = head[jj * nx + ii]; b !== -1; b = next[b]) {
                if (b <= a) continue;
                const B = sb[b];
                if (B === A) continue;
                const dx = sx[b] - sx[a], dy = sy[b] - sy[a], R = sr[a] + sr[b];
                const d2 = dx * dx + dy * dy;
                if (d2 >= R * R || d2 === 0) continue;
                const dist = Math.sqrt(d2), nX = dx / dist, nY = dy / dist, delta = R - dist;
                const off = sr[a] - 0.5 * delta;
                const cx = sx[a] + nX * off, cy = sy[a] + nY * off;
                const rax = cx - x[A], ray = cy - y[A], rbx = cx - x[B], rby = cy - y[B];
                const rvx = (vx[A] - w[A] * ray) - (vx[B] - w[B] * rby);
                const rvy = (vy[A] + w[A] * rax) - (vy[B] + w[B] * rbx);
                const vn = rvx * nX + rvy * nY;
                const meff = m[A] * m[B] / (m[A] + m[B]);
                const ks = (rn[A] * rn[B] / (rn[A] + rn[B])) * kScaleInv; // stone-size based stiffness
                const sq = Math.sqrt(meff * ks);
                let Fn = kn * ks * delta + cn0 * sq * vn; if (Fn < 0) Fn = 0;
                const tX = -nY, tY = nX, vt = rvx * tX + rvy * tY;
                let st = histGet(a, b) + vt * dt;
                let Ft = -kt * ks * st - ct0 * sq * vt;
                const Fm = mu * Fn;
                if (Ft > Fm || Ft < -Fm) { Ft = Ft > 0 ? Fm : -Fm; st = -Ft / (kt * ks); }
                histSet(a, b, st);
                const Fax = -Fn * nX + Ft * tX, Fay = -Fn * nY + Ft * tY;
                fx[A] += Fax; fy[A] += Fay; fx[B] -= Fax; fy[B] -= Fay;
                tq[A] += rax * Fay - ray * Fax;
                tq[B] -= rbx * Fay - rby * Fax;
                const wr = w[A] - w[B];
                if (mr > 0 && wr !== 0) {
                  const Mr = mr * (sr[a] * sr[b] / R) * Fn * (wr > 0 ? 1 : -1);
                  troll[A] -= Mr; troll[B] += Mr;
                }
                const ov = delta / Math.min(rn[A], rn[B]); if (ov > maxOv) maxOv = ov;
                const ovs = delta / Math.min(sr[a], sr[b]); if (ovs > maxOvSub) maxOvSub = ovs;
                if (cN < cCap) { cA[cN] = A; cB[cN] = B; cF[cN] = Fn; cN++; } else this.contactOverflow = true;
              }
            }
          }
        }
      }
    }

    // 3. stone-wall contacts (per-segment material)
    {
      const wx1 = this.wx1, wy1 = this.wy1, wex = this.wex, wey = this.wey, wl2 = this.wl2, wside = this.wside;
      const wMu = this.wMu, wCn = this.wCn, wCt = this.wCt, wK = this.wK, wMr = this.wMr;
      const cellSegs = this.cellSegs;
      for (let k = 0; k < nAct; k++) {
        const A = act[k];
        const s0 = A * MAXS, s1 = s0 + subCount[A];
        for (let a = s0; a < s1; a++) {
          const cell = cellOf[a];
          if (cell < 0) continue;
          const list = cellSegs[cell];
          const r = sr[a];
          for (let z = 0; z < list.length; z++) {
            const q = list[z];
            if (this.wGate[q] && this.gateOpen) continue;
            const px = sx[a] - wx1[q], py = sy[a] - wy1[q];
            let tt = (px * wex[q] + py * wey[q]) / wl2[q];
            if (tt >= 1) continue;            // end vertex is owned by the next segment
            if (tt < 0) tt = 0;
            const dx = wx1[q] + tt * wex[q] - sx[a], dy = wy1[q] + tt * wey[q] - sy[a];
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r || d2 === 0) continue;
            const dist = Math.sqrt(d2), nX = dx / dist, nY = dy / dist, delta = r - dist;
            const cx = sx[a] + dx, cy = sy[a] + dy;
            const rax = cx - x[A], ray = cy - y[A];
            const rvx = vx[A] - w[A] * ray, rvy = vy[A] + w[A] * rax;
            const vn = rvx * nX + rvy * nY;
            const ks = 0.5 * rn[A] * kScaleInv * wK[q];
            const sq = Math.sqrt(m[A] * ks);
            let Fn = kn * ks * delta + wCn[q] * sq * vn; if (Fn < 0) Fn = 0;
            const tX = -nY, tY = nX, vt = rvx * tX + rvy * tY;
            let st = histGet(a, -(q + 1)) + vt * dt;
            let Ft = -kt * ks * st - wCt[q] * sq * vt;
            const Fm = wMu[q] * Fn;
            if (Ft > Fm || Ft < -Fm) { Ft = Ft > 0 ? Fm : -Fm; st = -Ft / (kt * ks); }
            histSet(a, -(q + 1), st);
            const Fax = -Fn * nX + Ft * tX, Fay = -Fn * nY + Ft * tY;
            fx[A] += Fax; fy[A] += Fay;
            tq[A] += rax * Fay - ray * Fax;
            if (wMr[q] > 0 && w[A] !== 0) troll[A] -= wMr[q] * r * Fn * (w[A] > 0 ? 1 : -1);
            const ov = delta / rn[A]; if (ov > maxOvW) maxOvW = ov;
            const ovs = delta / r; if (ovs > maxOvSub) maxOvSub = ovs;
            this.wallMask[A] |= wside[q];
          }
        }
      }
    }
    this.cN = cN;
    const mo = Math.max(maxOv, maxOvW);
    this.maxOverlapStep = mo;
    if (mo > this.maxOverlapRun) this.maxOverlapRun = mo;
    if (maxOvW > this.maxWallOverlapRun) this.maxWallOverlapRun = maxOvW;
    if (maxOvSub > this.maxSubOverlapRun) this.maxSubOverlapRun = maxOvSub;
    if (mo > 0.05) this.overlapOver5++;

    // 4. integrate and boundary bookkeeping
    const invM = this.invM, invI = this.invI, g = this.geom, A0 = g.axis;
    const L = g.L, exitS = g.exitS, bb = g.bbox, t1 = this.t + dt;
    for (let k = 0; k < nAct; k++) {
      const b = act[k];
      vx[b] += fx[b] * invM[b] * dt;
      vy[b] += fy[b] * invM[b] * dt;
      let wn = w[b] + tq[b] * invI[b] * dt;
      if (troll[b] !== 0) {
        const w2 = wn + troll[b] * invI[b] * dt;
        wn = (wn > 0 && w2 < 0) || (wn < 0 && w2 > 0) ? 0 : w2;
      }
      w[b] = wn;
      x[b] += vx[b] * dt; y[b] += vy[b] * dt; th[b] += wn * dt;

      const s = (x[b] - A0.ox) * A0.ux + (y[b] - A0.oy) * A0.uy;
      if (!this.entered[b] && s >= 0) {
        this.entered[b] = 1; this.tEnter[b] = t1; this.inCount++; this.inMass += m[b];
        if (this.tFirstIn < 0) this.tFirstIn = t1;
      }
      if (this.entered[b] && !this.exited[b] && s >= L) {
        this.exited[b] = 1; this.tExit[b] = t1; this.outCount++; this.outMass += m[b];
        const res = t1 - this.tEnter[b]; this.resSum += res; if (res > this.resMax) this.resMax = res;
        this.tLastOut = t1; if (this.tFirstOut < 0) this.tFirstOut = t1;
      }
      if (s > exitS) { this.kill(b); continue; }
      if (x[b] < bb.xmin || x[b] > bb.xmax || y[b] < bb.ymin || y[b] > bb.ymax) {
        if (!this.exited[b]) {
          this.lostCount++; this.lostMass += m[b];
          if (this.lostLog.length < 50) this.lostLog.push({ t: t1, s, n: g.nOf(x[b], y[b]), d: this.d[b] });
        }
        this.kill(b);
      }
    }

    // swap tangential history
    this.hIdO = hIdN; this.hValO = hValN; this.hCntO = hCntN;
    this.hIdN = hIdO; this.hValN = hValO; this.hCntN = hCntO;
    this.t = t1; this.steps++;
    this.water.addImpulse(Jw * dt, dt);
    if (this.t >= this.nextWater) { this.water.update(this, this.waterDt); this.nextWater += this.waterDt; }
  };

  /** Stones currently inside the pipe (entered, not yet past the outlet). */
  Engine.prototype.insideCount = function () {
    if (this.dirty) this.rebuildActive();
    let n = 0, mass = 0;
    for (let k = 0; k < this.nActive; k++) {
      const b = this.active[k];
      if (this.entered[b] && !this.exited[b]) { n++; mass += this.m[b]; }
    }
    return { n, mass };
  };

  /** Stones alive anywhere in the domain. */
  Engine.prototype.aliveMass = function () {
    if (this.dirty) this.rebuildActive();
    let n = 0, mass = 0, nEx = 0, mEx = 0;
    for (let k = 0; k < this.nActive; k++) {
      const b = this.active[k]; n++; mass += this.m[b];
      if (this.exited[b]) { nEx++; mEx += this.m[b]; }
    }
    return { n, mass, nExitedAlive: nEx, mExitedAlive: mEx };
  };

  FP.physics = { Engine, gammaFromE, MAXS };
})(self.FP = self.FP || {});
